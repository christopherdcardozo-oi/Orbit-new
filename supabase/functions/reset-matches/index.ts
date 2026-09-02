// Matchmaking for Orbit — Supabase Edge Function, reached two different
// ways for two different jobs:
//
//   1. pg_cron, every 15 min, empty body {} (see
//      supabase/migrations/014_frequent_matchmaking_cron.sql). Checks
//      every active campus: did we just cross THAT campus's real local
//      midnight (per its university_config.timezone)? If yes, expire its
//      active matches and fresh-match everyone active there. If no,
//      does nothing — this path never does top-up matching, and never
//      runs more often than every 15 min, since a full-campus reset is
//      the only thing that's actually time-triggered.
//
//   2. A Postgres trigger, body { mode: 'topup', domain }, fired once,
//      the instant a specific user finishes onboarding (see migration
//      015_instant_topup_on_signup.sql — tied to their personality
//      answers being saved, not raw account creation, so nobody gets
//      matched on a still-blank profile). Tries to pair just that one
//      campus's currently-unmatched active users, right now — unless
//      it's within 2 hours of that campus's next reset, in which case
//      it skips (not enough time left to make a new match worth it).
//      Never resets anyone — only the cron does that.
//
// This design replaces an earlier one where a single once-a-day UTC cron
// did both jobs, which had two real bugs: (1) it assumed UTC midnight ==
// every campus's local midnight, true only for UTC+0 — Iowa State
// (America/Chicago) was actually resetting matches ~5-6 hours before its
// real local midnight; (2) mid-day signups sat unmatched until the next
// full daily cycle instead of being matched right away.
//
// Auth: verify_jwt is disabled at deploy time; instead we check a shared
// secret in the Authorization header, set as a function env var and
// included in both the pg_cron call and the trigger's net.http_post call.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// ---------- Types (mirror @orbit/shared) ----------

type Profile = {
  id: string;
  email_domain: string;
  display_alias: string;
  major: string | null;
  hobbies: string[] | null;
  activities: string[] | null;
  personality: string[] | null; // answers to lib/personality.ts's 4 questions, same index order
  year_in_school: string | null;
  is_active: boolean;
  fcm_token: string | null; // actually holds an Expo push token, see notes
};

type UniversityConfig = {
  email_domain: string;
  timezone: string | null;
};

type CampusResult = {
  domain: string;
  mode: 'reset' | 'topup' | 'skipped';
  matched: number;
  oddManOut: string[];
  errors: string[];
};

type MatchmakingResults = {
  campuses: CampusResult[];
};

// ---------- Time helpers ----------

// How many seconds remain until this timezone's next local midnight.
// Ported from apps/mobile/app/(app)/index.tsx's countdown — same approach,
// duplicated here because this runs in Deno, not the RN bundle.
function getSecondsUntilMidnight(timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = get('hour') % 24; // hour12:false reports the 00:00:00 instant as "24"
  const minute = get('minute');
  const second = get('second');

  const elapsed = hour * 3600 + minute * 60 + second;
  return 86400 - elapsed;
}

// ---------- Helpers ----------

function fisherYatesShuffle<T>(array: T[]): T[] {
  const out = [...array];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Compatibility score between two eligible candidates. Higher is better.
// Weights are deliberately ordered by how strongly each signal correlates
// with "these two will have something to talk about":
//   +3 per matching personality answer (same question index, same choice)
//      — up to 4 questions, so 0-12 points. Weighted highest since it's
//      the newest, most deliberate signal a user gives (a whole dedicated
//      onboarding step), and directly reflects compatibility rather than
//      just a shared label.
//   +2 per shared hobby     — free-text overlap, strong shared-interest
//                              signal, already what generateIcebreaker()
//                              prioritizes first.
//   +1 per shared activity  — campus-org overlap, weaker/more common
//                              signal (lots of people share "Intramurals").
//   +1 same major           — a nice-to-have, not chosen as strongly as
//                              hobbies/personality (people don't sign up
//                              *for* their major the way they pick hobbies).
function compatibilityScore(a: Profile, b: Profile): number {
  let score = 0;

  const personalityA = a.personality ?? [];
  const personalityB = b.personality ?? [];
  for (let i = 0; i < Math.min(personalityA.length, personalityB.length); i++) {
    if (personalityA[i] && personalityA[i] === personalityB[i]) {
      score += 3;
    }
  }

  const hobbiesA = a.hobbies ?? [];
  const hobbiesB = b.hobbies ?? [];
  const sharedHobbies = hobbiesA.filter((h) => hobbiesB.includes(h)).length;
  score += sharedHobbies * 2;

  const activitiesA = a.activities ?? [];
  const activitiesB = b.activities ?? [];
  const sharedActivities = activitiesA.filter((x) => activitiesB.includes(x)).length;
  score += sharedActivities;

  if (a.major && b.major && a.major === b.major) {
    score += 1;
  }

  return score;
}

// Short topic phrases for each personality question, matching
// apps/mobile/lib/personality.ts BY INDEX. Duplicated here (not
// imported) because this edge function deploys as a standalone file
// bundle, not the whole repo — keep in sync by hand if that file's
// question order/count ever changes.
const PERSONALITY_TOPICS = [
  'how you two recharge',
  'how you two make big decisions',
  'how you two approach daily life',
  'your general outlook',
];

type Signal =
  | { kind: 'personality'; topic: string; answer: string }
  | { kind: 'hobby'; value: string }
  | { kind: 'activity'; value: string }
  | { kind: 'majorSame'; value: string }
  | { kind: 'majorDifferent'; a: string; b: string }
  | { kind: 'year'; value: string };

// Detects every kind of overlap between two profiles (not just the
// first one found), so generateIcebreaker can lead with the strongest
// signal and still mention a second one if there is one — instead of
// only ever revealing a single axis of "what you have in common."
function detectSignals(a: Profile, b: Profile): Signal[] {
  const signals: Signal[] = [];

  const personalityA = a.personality ?? [];
  const personalityB = b.personality ?? [];
  for (let i = 0; i < Math.min(personalityA.length, personalityB.length); i++) {
    if (personalityA[i] && personalityA[i] === personalityB[i]) {
      signals.push({
        kind: 'personality',
        topic: PERSONALITY_TOPICS[i] ?? 'this one thing',
        answer: personalityA[i],
      });
      break; // one personality mention is plenty even if several match
    }
  }

  const hobbiesA = a.hobbies ?? [];
  const hobbiesB = b.hobbies ?? [];
  const sharedHobby = hobbiesA.find((h) => hobbiesB.includes(h));
  if (sharedHobby) signals.push({ kind: 'hobby', value: sharedHobby });

  const activitiesA = a.activities ?? [];
  const activitiesB = b.activities ?? [];
  const sharedActivity = activitiesA.find((x) => activitiesB.includes(x));
  if (sharedActivity) signals.push({ kind: 'activity', value: sharedActivity });

  if (a.major && b.major) {
    if (a.major === b.major) {
      signals.push({ kind: 'majorSame', value: a.major });
    } else {
      signals.push({ kind: 'majorDifferent', a: a.major, b: b.major });
    }
  }

  if (a.year_in_school && b.year_in_school && a.year_in_school === b.year_in_school) {
    signals.push({ kind: 'year', value: a.year_in_school });
  }

  return signals;
}

// Higher-priority signals lead the icebreaker; lower ones only ever
// show up as the trailing "also, ..." sentence. Personality leads
// because it's the most deliberate thing anyone tells us about
// themselves (a whole dedicated onboarding step), same reasoning as
// its weight in compatibilityScore().
const SIGNAL_PRIORITY: Signal['kind'][] = [
  'personality',
  'hobby',
  'activity',
  'majorSame',
  'majorDifferent',
  'year',
];

function primaryLine(s: Signal): string {
  switch (s.kind) {
    case 'personality':
      return pickRandom([
        `🧠 You're both "${s.answer}" on ${s.topic} — that's not nothing. What's a moment that proved it?`,
        `✨ Same wavelength: you both said "${s.answer}" for ${s.topic}. Does that track with how people describe you?`,
        `🔮 Turns out you're both "${s.answer}" about ${s.topic}. Who's more extreme about it?`,
      ]);
    case 'hobby':
      return pickRandom([
        `🎯 Plot twist — you both love ${s.value}! What got you into it?`,
        `✨ Hidden connection: ${s.value} fans unite! What's your hot take on it?`,
        `🔥 You both listed ${s.value}. If you could do it anywhere in the world, where?`,
        `💫 ${s.value} people, both of you. What's your best ${s.value} memory?`,
      ]);
    case 'activity':
      return pickRandom([
        `🏛️ Campus connection: you're both involved in ${s.value}. What's the best part?`,
        `🎪 Small world — ${s.value} brought you both here. What's your favorite memory from it?`,
        `🌠 ${s.value} squad reporting in — what drew you to it?`,
      ]);
    case 'majorSame':
      return pickRandom([
        `📚 You're both studying ${s.value}! What class has been your favorite so far?`,
        `🧠 Fellow ${s.value} majors! What made you choose this path?`,
        `🛰️ Two ${s.value} minds in one match — team up on a project, what would you build?`,
      ]);
    case 'majorDifferent':
      return pickRandom([
        `🌈 One of you studies ${s.a}, the other ${s.b}. What's something from your field that would blow the other's mind?`,
        `🔬 ${s.a} meets ${s.b} — what invention would you create together?`,
        `🪐 ${s.a} + ${s.b} — that's a hackathon team waiting to happen.`,
      ]);
    case 'year':
      return pickRandom([
        `🌟 Both ${s.value}s — how's that chapter going for you?`,
        `🎓 Two ${s.value}s crossing paths. Any survival tips for each other?`,
      ]);
  }
}

function secondaryClause(s: Signal): string {
  switch (s.kind) {
    case 'personality':
      return ` You also both said "${s.answer}" about ${s.topic}.`;
    case 'hobby':
      return ` You're also both into ${s.value}.`;
    case 'activity':
      return ` Bonus: you're both in ${s.value} too.`;
    case 'majorSame':
      return ` Also, you're both ${s.value} majors.`;
    case 'majorDifferent':
      return ` Also: ${s.a} and ${s.b} — different worlds, same match.`;
    case 'year':
      return ` Both ${s.value}s, too.`;
  }
}

function generateIcebreaker(a: Profile, b: Profile): string {
  const signals = detectSignals(a, b);

  if (signals.length === 0) {
    return pickRandom([
      "🌌 Two strangers in the cosmos — what's the most surprising thing about you?",
      '🎲 The universe paired you tonight! What\'s something you\'ve never told anyone?',
      '🚀 Fresh connection! If you could have dinner with anyone, living or dead, who?',
      "💫 Mystery match! What's the last thing that genuinely made you laugh?",
      "🛸 No overlap on paper, infinite possibilities in person. Ask them your own weird icebreaker.",
    ]);
  }

  const byPriority = [...signals].sort(
    (x, y) => SIGNAL_PRIORITY.indexOf(x.kind) - SIGNAL_PRIORITY.indexOf(y.kind),
  );
  const primary = byPriority[0];
  const secondary = byPriority.find((s) => s.kind !== primary.kind);

  return primaryLine(primary) + (secondary ? secondaryClause(secondary) : '');
}

// ---------- Per-campus matchmaking ----------

const RESET_WINDOW_SECONDS = 15 * 60; // matches the cron's 15-minute tick
const SKIP_WINDOW_SECONDS = 2 * 60 * 60; // don't start new matches this close to reset

// Two call sites, two different jobs — never both at once:
//   cron tick        → { allowReset: true,  allowTopup: false }
//     Only ever checks "did we just cross this campus's local midnight?"
//     If yes: expire + fresh-match everyone. If no: do nothing — top-up
//     is handled instantly by the on-profile-onboarding-complete trigger
//     instead of being polled for here (see migration 015).
//   onboarding trigger → { allowReset: false, allowTopup: true }
//     Fires once, right when a specific user finishes signup. Tries to
//     top-up-match just that campus, right now, unless it's within
//     SKIP_WINDOW_SECONDS of that campus's next reset. Never triggers a
//     mass reset — only the cron does that.
async function runMatchmakingForCampus(
  supabase: SupabaseClient,
  university: UniversityConfig,
  domainProfiles: Profile[],
  options: { allowReset: boolean; allowTopup: boolean },
): Promise<CampusResult> {
  const domain = university.email_domain;
  const result: CampusResult = { domain, mode: 'skipped', matched: 0, oddManOut: [], errors: [] };

  if (domainProfiles.length === 0) {
    return result;
  }

  const tz = university.timezone || 'America/Chicago';
  const secondsUntilMidnight = getSecondsUntilMidnight(tz);
  const secondsSinceMidnight = 86400 - secondsUntilMidnight;

  const justPassedMidnight = options.allowReset && secondsSinceMidnight < RESET_WINDOW_SECONDS;

  const domainProfileIds = domainProfiles.map((p) => p.id);

  // expires_at for every match created this tick = the UTC instant of
  // THIS campus's next local midnight — not the server clock's midnight
  // (Deno's runtime is UTC, so the old `new Date(); setHours(24,0,0,0)`
  // silently computed UTC midnight regardless of the campus's real
  // timezone). Computed early (not just before the main pairing loop)
  // because the scheduled-matches fulfillment step below also needs it.
  const expiresAt = new Date(Date.now() + secondsUntilMidnight * 1000);

  if (justPassedMidnight) {
    // Daily reset: expire this campus's active matches so everyone is
    // eligible for a fresh match today. Scoped to this campus's profile
    // ids only — other campuses' matches are untouched.
    const { error: expireError } = await supabase
      .from('matches')
      .update({ status: 'expired' })
      .eq('status', 'active')
      .in('user1_id', domainProfileIds);
    if (expireError) {
      result.errors.push(`Failed to expire matches for ${domain}: ${expireError.message}`);
      return result;
    }
    result.mode = 'reset';
  } else if (!options.allowTopup) {
    // Cron tick, not in the reset window — nothing to do here. Top-up is
    // event-driven now.
    result.mode = 'skipped';
    return result;
  } else if (secondsUntilMidnight <= SKIP_WINDOW_SECONDS) {
    // Onboarding trigger, but too close to this campus's reset to bother
    // starting a new match that would just get expired shortly after.
    result.mode = 'skipped';
    return result;
  } else {
    result.mode = 'topup';
  }

  // Admin "Schedule Match" fulfillment (migration 042) — only at the
  // actual reset, so a pairing queued because someone was mid-match
  // gets applied the instant they're free again, before the normal
  // algorithm has a chance to pair either of them with someone else.
  const scheduledFulfilled = new Set<string>();
  if (justPassedMidnight) {
    const { data: scheduled, error: scheduledError } = await supabase
      .from('scheduled_matches')
      .select('id, user1_id, user2_id')
      .is('fulfilled_at', null)
      .in('user1_id', domainProfileIds)
      .in('user2_id', domainProfileIds);

    if (scheduledError) {
      result.errors.push(`Failed to fetch scheduled matches for ${domain}: ${scheduledError.message}`);
    } else {
      const profileById = new Map(domainProfiles.map((p) => [p.id, p]));
      for (const s of scheduled ?? []) {
        // One person can only fulfill one schedule per tick — skip a
        // second queued pairing involving someone already just matched.
        if (scheduledFulfilled.has(s.user1_id) || scheduledFulfilled.has(s.user2_id)) continue;
        const userA = profileById.get(s.user1_id);
        const userB = profileById.get(s.user2_id);
        if (!userA || !userB) continue; // shouldn't happen — both already filtered to this campus

        const icebreaker = generateIcebreaker(userA, userB);
        const { error: insertErr } = await supabase.from('matches').insert({
          user1_id: s.user1_id,
          user2_id: s.user2_id,
          status: 'active',
          icebreaker,
          expires_at: expiresAt.toISOString(),
        });
        if (insertErr) {
          result.errors.push(`Failed to fulfill scheduled match ${s.id}: ${insertErr.message}`);
          continue;
        }
        await supabase.from('match_history').insert({ user1_id: s.user1_id, user2_id: s.user2_id });
        await supabase.from('scheduled_matches').update({ fulfilled_at: new Date().toISOString() }).eq('id', s.id);
        scheduledFulfilled.add(s.user1_id);
        scheduledFulfilled.add(s.user2_id);
        result.matched++;
      }
    }
  }

  // Who currently has an active match? (Correct in both modes: right
  // after a reset this is empty except for anyone just paired by the
  // scheduled-match fulfillment above; in top-up mode it reflects real
  // in-progress matches.)
  const { data: activeMatches, error: activeError } = await supabase
    .from('matches')
    .select('user1_id, user2_id')
    .eq('status', 'active')
    .in('user1_id', domainProfileIds);

  if (activeError) {
    result.errors.push(`Failed to fetch active matches for ${domain}: ${activeError.message}`);
    return result;
  }

  const alreadyMatchedIds = new Set<string>();
  for (const m of activeMatches ?? []) {
    alreadyMatchedIds.add(m.user1_id);
    alreadyMatchedIds.add(m.user2_id);
  }

  const eligibleProfiles = domainProfiles.filter(
    (p) => !alreadyMatchedIds.has(p.id) && !scheduledFulfilled.has(p.id),
  );
  if (eligibleProfiles.length < 2) {
    result.oddManOut = eligibleProfiles.map((p) => p.id);
    return result;
  }

  // No-repeat window: 30 days.
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: history, error: historyError } = await supabase
    .from('match_history')
    .select('user1_id, user2_id')
    .gte('matched_at', thirtyDaysAgo.toISOString().split('T')[0]);

  if (historyError) {
    result.errors.push(`Failed to fetch history for ${domain}: ${historyError.message}`);
    return result;
  }

  const historySet = new Set<string>();
  for (const h of history ?? []) {
    historySet.add([h.user1_id, h.user2_id].sort().join('_'));
  }

  // Rematch window: pairs older than 14 days are eligible again.
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const { data: oldHistory } = await supabase
    .from('match_history')
    .select('user1_id, user2_id')
    .lte('matched_at', fourteenDaysAgo.toISOString().split('T')[0]);

  const allowedHistorySet = new Set<string>();
  for (const h of oldHistory ?? []) {
    allowedHistorySet.add([h.user1_id, h.user2_id].sort().join('_'));
  }

  // Blocked pairs — if either direction of (a,b) is in the table, they
  // never match. Keyed the same way as historySet so the check inside
  // the greedy loop is one Set.has() call.
  const { data: blocks, error: blocksError } = await supabase
    .from('blocked_pairs')
    .select('blocker_id, blocked_id')
    .or(`blocker_id.in.(${domainProfileIds.join(',')}),blocked_id.in.(${domainProfileIds.join(',')})`);

  if (blocksError) {
    result.errors.push(`Failed to fetch blocks for ${domain}: ${blocksError.message}`);
    // Not fatal — a block-lookup failure shouldn't block all matching.
  }

  const blockedSet = new Set<string>();
  for (const b of blocks ?? []) {
    blockedSet.add([b.blocker_id, b.blocked_id].sort().join('_'));
  }

  // Priority order for the greedy pass below. The greedy algorithm is
  // order-sensitive — whoever comes first gets to pick their best
  // available partner while the full pool is still open; whoever comes
  // last gets whatever's left (or nobody). Two tiers, each shuffled
  // internally for random tie-breaking:
  //   1. Never-matched users (zero match_history rows, ever) — so a
  //      brand-new signup reliably gets matched promptly instead of
  //      landing at the back of the line with zero activity to their
  //      name.
  //   2. Everyone else, ranked by messages sent in the trailing 14
  //      days (most active first) — rewards people actually using the
  //      app with first pick of the best-compatibility partner.
  // history/oldHistory (fetched above) together cover the ENTIRE
  // match_history table unscoped by date (history >= 30 days ago,
  // oldHistory <= 14 days ago — their ranges overlap and union to
  // "all time"), so no extra query is needed to know who's ever matched.
  const everMatchedIds = new Set<string>();
  for (const h of [...(history ?? []), ...(oldHistory ?? [])]) {
    everMatchedIds.add(h.user1_id);
    everMatchedIds.add(h.user2_id);
  }

  const fourteenDaysAgoActivity = new Date();
  fourteenDaysAgoActivity.setDate(fourteenDaysAgoActivity.getDate() - 14);
  const { data: recentMessages } = await supabase
    .from('messages')
    .select('sender_id')
    .in('sender_id', domainProfileIds)
    .gte('created_at', fourteenDaysAgoActivity.toISOString());

  const activityCount = new Map<string, number>();
  for (const m of recentMessages ?? []) {
    activityCount.set(m.sender_id, (activityCount.get(m.sender_id) ?? 0) + 1);
  }

  const neverMatched = fisherYatesShuffle(eligibleProfiles.filter((p) => !everMatchedIds.has(p.id)));
  const everyoneElse = fisherYatesShuffle(eligibleProfiles.filter((p) => everMatchedIds.has(p.id)));
  // Array.prototype.sort is stable (guaranteed since ES2019), so ties
  // (equal or zero activity) keep the random order from the shuffle
  // above rather than silently reverting to insertion order.
  everyoneElse.sort((a, b) => (activityCount.get(b.id) ?? 0) - (activityCount.get(a.id) ?? 0));
  const shuffled = [...neverMatched, ...everyoneElse];
  const matched = new Set<string>();

  const newMatches: Array<{
    user1_id: string;
    user2_id: string;
    status: 'active';
    icebreaker: string;
    expires_at: string;
  }> = [];
  const newHistory: Array<{ user1_id: string; user2_id: string }> = [];

  for (let i = 0; i < shuffled.length; i++) {
    const userA = shuffled[i];
    if (matched.has(userA.id)) continue;

    let foundMatch: Profile | null = null;
    let bestScore = -1;
    for (let j = i + 1; j < shuffled.length; j++) {
      const userB = shuffled[j];
      if (matched.has(userB.id)) continue;

      const key = [userA.id, userB.id].sort().join('_');
      if (blockedSet.has(key)) continue;
      if (!historySet.has(key) || allowedHistorySet.has(key)) {
        const score = compatibilityScore(userA, userB);
        if (score > bestScore) {
          bestScore = score;
          foundMatch = userB;
        }
      }
    }

    if (foundMatch) {
      matched.add(userA.id);
      matched.add(foundMatch.id);

      const icebreaker = generateIcebreaker(userA, foundMatch);
      const [user1_id, user2_id] = [userA.id, foundMatch.id].sort();

      newMatches.push({
        user1_id,
        user2_id,
        status: 'active',
        icebreaker,
        expires_at: expiresAt.toISOString(),
      });
      newHistory.push({ user1_id, user2_id });

      result.matched++;
    }
  }

  // Fallback pass: on tiny campus pools everyone can end up cooldowned
  // against everyone else, and the primary loop above matches zero
  // people. A rematch with someone you talked to a few weeks ago is
  // better than "no match today, come back tomorrow." Second pass runs
  // only over the leftovers from pass 1 and ignores the history filter,
  // but still respects blocked_pairs. Pairs are ranked by
  // days-since-their-last-match (bigger = prefer), so the freshest
  // possible rematch wins and same-partner-two-nights-in-a-row is the
  // absolute last resort.
  const leftovers = shuffled.filter((p) => !matched.has(p.id));
  if (leftovers.length >= 2) {
    const daysSinceLastByPair = new Map<string, number>();
    for (const h of history ?? []) {
      const key = [h.user1_id, h.user2_id].sort().join('_');
      const days = Math.floor((Date.now() - new Date(h.matched_at).getTime()) / 86400000);
      daysSinceLastByPair.set(
        key,
        Math.min(daysSinceLastByPair.get(key) ?? Number.POSITIVE_INFINITY, days),
      );
    }
    // 999 sentinel = "no record in the last 30 days" — treat as very
    // fresh so brand-new pairs beat any rematch.
    const daysAgoFor = (key: string) => daysSinceLastByPair.get(key) ?? 999;

    for (let i = 0; i < leftovers.length; i++) {
      const userA = leftovers[i];
      if (matched.has(userA.id)) continue;
      let foundMatch: Profile | null = null;
      let bestScore = -Infinity;
      for (let j = i + 1; j < leftovers.length; j++) {
        const userB = leftovers[j];
        if (matched.has(userB.id)) continue;
        const key = [userA.id, userB.id].sort().join('_');
        if (blockedSet.has(key)) continue;
        // Days-since dominates so we spread rematches across the pool
        // as much as possible; compatibility is a tiebreaker.
        const score = daysAgoFor(key) * 100 + compatibilityScore(userA, userB);
        if (score > bestScore) {
          bestScore = score;
          foundMatch = userB;
        }
      }
      if (foundMatch) {
        matched.add(userA.id);
        matched.add(foundMatch.id);
        const icebreaker = generateIcebreaker(userA, foundMatch);
        const [user1_id, user2_id] = [userA.id, foundMatch.id].sort();
        newMatches.push({
          user1_id,
          user2_id,
          status: 'active',
          icebreaker,
          expires_at: expiresAt.toISOString(),
        });
        newHistory.push({ user1_id, user2_id });
        result.matched++;
      }
    }
  }

  // Anyone still unmatched after both passes is truly odd-man-out
  // (either alone on the campus or blocked by everyone left).
  result.oddManOut = shuffled.filter((p) => !matched.has(p.id)).map((p) => p.id);

  if (newMatches.length > 0) {
    const { error: matchInsertError } = await supabase.from('matches').insert(newMatches);
    if (matchInsertError) {
      result.errors.push(`Failed to insert matches for ${domain}: ${matchInsertError.message}`);
    } else {
      const { error: historyInsertError } = await supabase.from('match_history').insert(newHistory);
      if (historyInsertError) {
        result.errors.push(`Failed to insert history for ${domain}: ${historyInsertError.message}`);
      }
      // Note: push notifications used to be sent from here via the
      // legacy exp.host endpoint. That path is retired — the
      // matches AFTER INSERT trigger (migration 027 + 033) now
      // fires both web push (VAPID) and native push (FCM v1) for
      // every new match.
    }
  }

  return result;
}

// ---------- Top-level tick ----------

async function runMatchmakingTick(supabase: SupabaseClient): Promise<MatchmakingResults> {
  // is_admin excludes test/admin accounts (mine + Christopher's — anyone
  // in admin_allowlist) from the matching pool. See migration 034.
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_active', true)
    .eq('is_admin', false);

  if (profileError || !profiles) {
    return {
      campuses: [
        {
          domain: '*',
          mode: 'skipped',
          matched: 0,
          oddManOut: [],
          errors: [`Failed to fetch profiles: ${profileError?.message ?? 'Unknown error'}`],
        },
      ],
    };
  }

  const { data: universities, error: uniError } = await supabase
    .from('university_config')
    .select('email_domain, timezone')
    .eq('is_active', true);

  if (uniError || !universities) {
    return {
      campuses: [
        {
          domain: '*',
          mode: 'skipped',
          matched: 0,
          oddManOut: [],
          errors: [`Failed to fetch active universities: ${uniError?.message ?? 'Unknown error'}`],
        },
      ],
    };
  }

  const campuses: CampusResult[] = [];
  for (const uni of universities as UniversityConfig[]) {
    const domainProfiles = (profiles as Profile[]).filter((p) => p.email_domain === uni.email_domain);
    const result = await runMatchmakingForCampus(supabase, uni, domainProfiles, {
      allowReset: true,
      allowTopup: false,
    });
    campuses.push(result);
  }

  return { campuses };
}

// Single-campus, event-triggered top-up. Called by the on-profile-
// onboarding-complete trigger (migration 015) the instant someone
// finishes signup — never touches any other campus, never resets.
async function runTopupForDomain(supabase: SupabaseClient, domain: string): Promise<CampusResult> {
  const { data: uni, error: uniError } = await supabase
    .from('university_config')
    .select('email_domain, timezone')
    .eq('email_domain', domain)
    .eq('is_active', true)
    .maybeSingle();

  if (uniError) {
    return { domain, mode: 'skipped', matched: 0, oddManOut: [], errors: [uniError.message] };
  }
  if (!uni) {
    // Campus isn't active (or doesn't exist) — nothing to do.
    return { domain, mode: 'skipped', matched: 0, oddManOut: [], errors: [] };
  }

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_active', true)
    .eq('is_admin', false)
    .eq('email_domain', domain);

  if (profileError) {
    return { domain, mode: 'skipped', matched: 0, oddManOut: [], errors: [profileError.message] };
  }

  return runMatchmakingForCampus(supabase, uni as UniversityConfig, (profiles ?? []) as Profile[], {
    allowReset: false,
    allowTopup: true,
  });
}

// ---------- HTTP entry ----------

Deno.serve(async (req: Request) => {
  // Shared-secret auth. pg_cron sends: Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json(
      { error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env' },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Two shapes of request:
  //   {}                          → cron tick (reset-check across every active campus)
  //   { mode: 'topup', domain }   → onboarding trigger (single-campus top-up)
  let body: { mode?: string; domain?: string } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    // No/invalid body — treat as a plain cron tick.
  }

  try {
    if (body.mode === 'topup' && body.domain) {
      const result = await runTopupForDomain(supabase, body.domain);
      return Response.json({
        success: true,
        results: { campuses: [result] },
        message: 'Top-up matchmaking completed',
      });
    }

    const results = await runMatchmakingTick(supabase);
    return Response.json({
      success: true,
      results,
      message: 'Matchmaking tick completed',
    });
  } catch (err) {
    console.error('matchmaking tick error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
