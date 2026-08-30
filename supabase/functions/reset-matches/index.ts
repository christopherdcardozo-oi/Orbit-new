// Daily matchmaking cron for Orbit — Supabase Edge Function port of the
// previous Next.js /api/cron/reset-matches route (apps/web/…) so the whole
// backend loop now lives inside Supabase and nothing is on Vercel.
//
// Schedule: called once a day at 00:00 UTC by pg_cron (see
// supabase/migrations/007_matchmaking_cron.sql).
//
// Auth: verify_jwt is disabled at deploy time; instead we check a shared
// secret in the Authorization header. Same pattern the Next.js version
// used — the cron secret is set as a function env var and included in the
// pg_cron call.

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
  year_in_school: string | null;
  is_active: boolean;
  fcm_token: string | null; // actually holds an Expo push token, see notes
};

type MatchmakingResults = {
  matched: number;
  oddManOut: string[];
  errors: string[];
};

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

// Port of apps/web/lib/matching/icebreaker.ts — kept byte-for-byte
// equivalent so day-to-day icebreaker text doesn't change with the switch.
function generateIcebreaker(a: Profile, b: Profile): string {
  const hobbiesA = a.hobbies ?? [];
  const hobbiesB = b.hobbies ?? [];
  const sharedHobbies = hobbiesA.filter((h) => hobbiesB.includes(h));

  const activitiesA = a.activities ?? [];
  const activitiesB = b.activities ?? [];
  const sharedActivities = activitiesA.filter((x) => activitiesB.includes(x));

  const sameMajor = a.major && b.major && a.major === b.major;
  const majorA = a.major ?? 'your major';
  const majorB = b.major ?? 'their major';

  if (sharedHobbies.length > 0) {
    const hobby = sharedHobbies[0];
    return pickRandom([
      `🎯 Plot twist — you both love ${hobby}! What got you into it?`,
      `✨ Hidden connection: ${hobby} fans unite! What's your hot take on it?`,
      `🔥 You both listed ${hobby}. If you could do it anywhere in the world, where?`,
    ]);
  }

  if (sharedActivities.length > 0) {
    const activity = sharedActivities[0];
    return pickRandom([
      `🏛️ Campus connection: you're both involved in ${activity}. What's the best part?`,
      `🎪 Small world — ${activity} brought you both here. What's your favorite memory from it?`,
    ]);
  }

  if (sameMajor && a.major) {
    const major = a.major;
    return pickRandom([
      `📚 You're both studying ${major}! What class has been your favorite so far?`,
      `🧠 Fellow ${major} majors! What made you choose this path?`,
    ]);
  }

  if (a.major && b.major) {
    return pickRandom([
      `🌈 One of you studies ${majorA}, the other ${majorB}. What's something from your field that would blow the other's mind?`,
      `🔬 ${majorA} meets ${majorB} — what invention would you create together?`,
    ]);
  }

  return pickRandom([
    "🌌 Two strangers in the cosmos — what's the most surprising thing about you?",
    '🎲 The universe paired you tonight! What\'s something you\'ve never told anyone?',
    '🚀 Fresh connection! If you could have dinner with anyone, living or dead, who?',
    "💫 Mystery match! What's the last thing that genuinely made you laugh?",
  ]);
}

// Fire-and-log-only Expo push. Failures never abort the batch.
async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: expoPushToken, sound: 'default', title, body, data }),
    });
  } catch (err) {
    console.error('push notification failed:', err);
  }
}

// ---------- Core matchmaking (port of apps/web/lib/matching/algorithm.ts) ----------

async function runMatchmaking(supabase: SupabaseClient): Promise<MatchmakingResults> {
  const results: MatchmakingResults = { matched: 0, oddManOut: [], errors: [] };

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_active', true);

  if (profileError || !profiles) {
    results.errors.push(`Failed to fetch profiles: ${profileError?.message ?? 'Unknown error'}`);
    return results;
  }

  const domains = new Set((profiles as Profile[]).map((p) => p.email_domain));

  const allNewMatches: Array<{
    user1_id: string;
    user2_id: string;
    status: 'active';
    icebreaker: string;
    expires_at: string;
  }> = [];
  const allNewHistory: Array<{ user1_id: string; user2_id: string }> = [];
  const notificationsToSend: Array<{ token: string; title: string; body: string }> = [];

  for (const domain of domains) {
    const domainProfiles = (profiles as Profile[]).filter((p) => p.email_domain === domain);

    // No-repeat window: 30 days.
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: history, error: historyError } = await supabase
      .from('match_history')
      .select('user1_id, user2_id')
      .gte('matched_at', thirtyDaysAgo.toISOString().split('T')[0]);

    if (historyError) {
      results.errors.push(`Failed to fetch history for ${domain}: ${historyError.message}`);
      continue;
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

    const shuffled = fisherYatesShuffle(domainProfiles);
    const matched = new Set<string>();

    for (let i = 0; i < shuffled.length; i++) {
      const userA = shuffled[i];
      if (matched.has(userA.id)) continue;

      let foundMatch: Profile | null = null;
      for (let j = i + 1; j < shuffled.length; j++) {
        const userB = shuffled[j];
        if (matched.has(userB.id)) continue;

        const key = [userA.id, userB.id].sort().join('_');
        if (!historySet.has(key) || allowedHistorySet.has(key)) {
          foundMatch = userB;
          break;
        }
      }

      if (foundMatch) {
        matched.add(userA.id);
        matched.add(foundMatch.id);

        const icebreaker = generateIcebreaker(userA, foundMatch);
        const expiresAt = new Date();
        expiresAt.setHours(24, 0, 0, 0);

        const [user1_id, user2_id] = [userA.id, foundMatch.id].sort();

        allNewMatches.push({
          user1_id,
          user2_id,
          status: 'active',
          icebreaker,
          expires_at: expiresAt.toISOString(),
        });
        allNewHistory.push({ user1_id, user2_id });

        if (userA.fcm_token) {
          notificationsToSend.push({
            token: userA.fcm_token,
            title: 'New Cosmic Match! 🚀',
            body: "You've been paired with someone new. You have 24 hours to chat!",
          });
        }
        if (foundMatch.fcm_token) {
          notificationsToSend.push({
            token: foundMatch.fcm_token,
            title: 'New Cosmic Match! 🚀',
            body: "You've been paired with someone new. You have 24 hours to chat!",
          });
        }

        results.matched++;
      } else {
        results.oddManOut.push(userA.id);
      }
    }
  }

  if (allNewMatches.length > 0) {
    const { error: matchInsertError } = await supabase.from('matches').insert(allNewMatches);
    if (matchInsertError) {
      results.errors.push(`Failed to insert matches: ${matchInsertError.message}`);
    } else {
      const { error: historyInsertError } = await supabase
        .from('match_history')
        .insert(allNewHistory);
      if (historyInsertError) {
        results.errors.push(`Failed to insert history: ${historyInsertError.message}`);
      } else {
        for (const n of notificationsToSend) {
          await sendPushNotification(n.token, n.title, n.body);
        }
      }
    }
  }

  return results;
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

  try {
    // 1. Expire yesterday's active matches. Idempotent — pg_cron's
    //    expire-matches-midnight job may already have run this SQL a few
    //    seconds earlier and set every active row to expired; running it
    //    again matches zero rows and is a no-op.
    const { error: expireError } = await supabase.rpc('expire_active_matches');
    if (expireError) {
      console.error('expire_active_matches error:', expireError);
      return Response.json({ error: 'Failed to expire matches' }, { status: 500 });
    }

    // 2. Generate today's matches.
    const results = await runMatchmaking(supabase);

    return Response.json({
      success: true,
      results,
      message: 'Daily match reset completed successfully',
    });
  } catch (err) {
    console.error('cron job error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
