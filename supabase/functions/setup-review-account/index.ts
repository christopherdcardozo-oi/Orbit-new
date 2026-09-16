// setup-review-account — one-shot, idempotent bootstrap for the App
// Store / Play reviewer demo pair.
//
// What this does (each step no-ops cleanly if it's already done, so
// the whole thing can be re-run whenever without side effects):
//
//   1. Creates review@orghubs.com in auth.users via admin.createUser,
//      pre-confirmed so the reviewer sign-in never hits the OTP flow.
//
//   2. Adds review@orghubs.com to admin_allowlist mapped to
//      iastate.edu — that's the allowlist that is_email_allowed checks
//      for non-.edu addresses on the login screen. Without this, the
//      client bounces the email as "must use your @iastate.edu email
//      or an approved admin/test email."
//
//   3. Creates or upserts the profile row for the review account:
//      alias 'AppStoreDude666', is_admin=true (keeps it out of the
//      nightly matcher — migration 034), fully-populated personality
//      answers/hobbies/major/year so the reviewer lands on a
//      finished-onboarding experience, not the signup wizard.
//
//   4. Ensures a persistent match exists between review@orghubs.com
//      and mailcardozo@gmail.com (Sunil): finds an existing active
//      match between the pair or calls admin_schedule_match to create
//      one, then flips is_persistent=true. The persistent flag is the
//      whole point — migration 054 + the guard added to reset-matches
//      protect this exact row from nightly expiry, so the reviewer
//      always sees an active match to demonstrate the chat feature.
//
// Auth: verify_jwt is OFF and the caller must supply
// x-setup-token: SETUP_REVIEW_ACCOUNT_TOKEN. Not a real security
// boundary — this function only ever runs to bootstrap the demo pair
// — but the shared secret keeps random people from re-triggering
// account creation via the public function URL. Token lives only in
// project secrets, never in the repo.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const REVIEW_EMAIL = 'review@orghubs.com';
const REVIEW_ALIAS = 'AppStoreDude666';
const REVIEW_CAMPUS = 'iastate.edu';
const SUNIL_EMAIL = 'mailcardozo@gmail.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-setup-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expected = Deno.env.get('SETUP_REVIEW_ACCOUNT_TOKEN');
  if (!expected) return json({ error: 'SETUP_REVIEW_ACCOUNT_TOKEN not configured' }, 500);
  if (req.headers.get('x-setup-token') !== expected) return json({ error: 'Forbidden' }, 403);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const trace: Record<string, unknown> = {};

  // --- 1. Create or reuse the review auth user ------------------------
  let reviewUserId: string;
  {
    // Supabase auth admin doesn't have a "get user by email" convenience,
    // so we listUsers and filter. At Orbit's scale (~100 users) this is
    // cheap; a smarter search would be premature.
    const { data: existing, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) return json({ error: `listUsers: ${listErr.message}` }, 500);
    const found = existing.users.find((u) => u.email?.toLowerCase() === REVIEW_EMAIL);
    if (found) {
      reviewUserId = found.id;
      trace.review_user = 'reused';
    } else {
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: REVIEW_EMAIL,
        email_confirm: true,
      });
      if (createErr || !created.user) return json({ error: `createUser: ${createErr?.message ?? 'unknown'}` }, 500);
      reviewUserId = created.user.id;
      trace.review_user = 'created';
    }
  }
  trace.review_user_id = reviewUserId;

  // --- 2. Add to admin_allowlist -------------------------------------
  {
    const { error: allowErr } = await supabase
      .from('admin_allowlist')
      .upsert(
        { email: REVIEW_EMAIL, campus_email_domain: REVIEW_CAMPUS, note: 'App Store / Play reviewer demo account' },
        { onConflict: 'email' },
      );
    if (allowErr) return json({ error: `admin_allowlist upsert: ${allowErr.message}` }, 500);
    trace.admin_allowlist = 'ok';
  }

  // --- 3. Upsert the profile row -------------------------------------
  {
    // Personality shape follows lib/personality.ts — 4 questions, first
    // valid answer of each so the profile reads as complete. Hobbies and
    // major are stubs; the reviewer doesn't judge us on Christopher's
    // major taxonomy.
    const { error: profileErr } = await supabase
      .from('profiles')
      .upsert(
        {
          id: reviewUserId,
          email_domain: REVIEW_CAMPUS,
          display_alias: REVIEW_ALIAS,
          avatar: 'earth',
          gender: 'Other',
          major: 'Computer Science',
          year: 'Senior',
          personality_answers: [
            'A mix of both (Ambivert)',
            'Logic and facts',
            'Spontaneous and flexible',
            'Realistic (It is what it is)',
          ],
          hobbies: ['Gaming'],
          activities: [],
          is_admin: true,
          is_active: true,
        },
        { onConflict: 'id' },
      );
    if (profileErr) return json({ error: `profiles upsert: ${profileErr.message}` }, 500);
    trace.profile = 'ok';
  }

  // --- 4. Find Sunil's user id ---------------------------------------
  let sunilUserId: string;
  {
    const { data: listAll, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (listErr) return json({ error: `listUsers (sunil): ${listErr.message}` }, 500);
    const found = listAll.users.find((u) => u.email?.toLowerCase() === SUNIL_EMAIL);
    if (!found) return json({ error: `Sunil user ${SUNIL_EMAIL} not found — sign up first` }, 500);
    sunilUserId = found.id;
    trace.sunil_user_id = sunilUserId;
  }

  // --- 5. Ensure a persistent match exists ---------------------------
  {
    // Look for any existing match (any status) between this exact pair.
    // Order doesn't matter — a match row can have user1/user2 in either
    // slot, so we check both permutations.
    const { data: existing, error: existingErr } = await supabase
      .from('matches')
      .select('id, status, is_persistent')
      .or(
        `and(user1_id.eq.${reviewUserId},user2_id.eq.${sunilUserId}),` +
        `and(user1_id.eq.${sunilUserId},user2_id.eq.${reviewUserId})`,
      );
    if (existingErr) return json({ error: `match lookup: ${existingErr.message}` }, 500);

    // Prefer the active row if one exists; otherwise take any, we'll
    // reactivate it below.
    const active = existing?.find((m) => m.status === 'active');
    const anyExisting = active ?? existing?.[0];

    let matchId: string;
    if (anyExisting) {
      // Flip the existing row to active + persistent no matter what
      // state it was in.
      const { error: updateErr } = await supabase
        .from('matches')
        .update({
          status: 'active',
          is_persistent: true,
          expires_at: '2099-12-31T00:00:00Z',
        })
        .eq('id', anyExisting.id);
      if (updateErr) return json({ error: `match update: ${updateErr.message}` }, 500);
      matchId = anyExisting.id;
      trace.match = 'reactivated_and_pinned';
    } else {
      // No existing row — create one via admin_schedule_match, which
      // handles ordering + icebreaker text + expires_at + campus
      // consistency for us. We then upgrade its expiry and persistence.
      const { error: scheduleErr } = await supabase.rpc('admin_schedule_match', {
        p_user1_id: reviewUserId,
        p_user2_id: sunilUserId,
      });
      if (scheduleErr) return json({ error: `admin_schedule_match: ${scheduleErr.message}` }, 500);

      // Read back the just-created active match.
      const { data: created, error: readErr } = await supabase
        .from('matches')
        .select('id')
        .eq('status', 'active')
        .or(
          `and(user1_id.eq.${reviewUserId},user2_id.eq.${sunilUserId}),` +
          `and(user1_id.eq.${sunilUserId},user2_id.eq.${reviewUserId})`,
        )
        .limit(1)
        .maybeSingle();
      if (readErr || !created) return json({ error: `match reread: ${readErr?.message ?? 'not found'}` }, 500);

      const { error: pinErr } = await supabase
        .from('matches')
        .update({ is_persistent: true, expires_at: '2099-12-31T00:00:00Z' })
        .eq('id', created.id);
      if (pinErr) return json({ error: `pin match: ${pinErr.message}` }, 500);

      matchId = created.id;
      trace.match = 'created_and_pinned';
    }
    trace.match_id = matchId;
  }

  return json({ ok: true, ...trace }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
