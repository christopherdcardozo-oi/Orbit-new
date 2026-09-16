// verify-review-otp — invoked ONLY from the login screen when the
// entered email matches the reserved review demo address. Its whole
// job is to convert a hardcoded email+code pair into a real Supabase
// session, without going anywhere near the ordinary OTP delivery flow.
//
// Why this exists (see login.tsx handleSendCode/handleVerifyCode for
// the client half): App Store and Play reviewers cannot receive OTP
// emails at a domain we control quickly enough, at any hour, to keep
// review moving. Every other closed-audience OTP-only app hits this;
// the accepted mitigation (per Apple's review notes documentation) is
// to hand review team a stable email+code pair. This function is that
// server side: strictly scoped to ONE email, ONE code — anything else
// returns 401 and doesn't touch the auth system at all.
//
// Blast radius if the email + code combination leaks: attacker signs
// in ONCE as the review demo account. That account is is_admin=true
// so it's excluded from the nightly matcher (migration 034) and never
// paired with real students; the only thing it can see is a
// persistent match with Sunil (which itself has no PII beyond an
// alias — Orbit's whole design is anonymous). Rotate the code by
// editing REVIEW_OTP below and redeploying, no state migration
// needed.
//
// Auth model: NO caller JWT needed (the whole point is that the
// reviewer has no session yet) — verify_jwt must be OFF for this
// function. The function itself is the gate: strict-equality checks
// on both the email and the code; no fuzz, no rate-limit-aware
// timing side channels. Uses the service role key server-side only,
// via SUPABASE_SERVICE_ROLE_KEY.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const REVIEW_EMAIL = 'review@orghubs.com';

// Read from Supabase project secret, not hardcoded — keeps the code in
// git free of anything the review team ends up seeing, and lets us
// rotate the code by updating the secret in the dashboard without a
// redeploy. Miss-set the env var and the function fails closed (returns
// 500 on the first request instead of silently accepting any code).
const REVIEW_OTP = Deno.env.get('REVIEW_OTP') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let body: { email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const email = (body.email ?? '').toLowerCase().trim();
  const code = (body.code ?? '').trim();

  // Both checks must pass — nothing about the flow gives partial
  // information to a caller guessing one side.
  // Fail closed if the env secret is missing entirely — otherwise an
  // empty string on both sides of the check would technically accept
  // an empty code, which is worse than a hard 500.
  if (!REVIEW_OTP) {
    console.error('[verify-review-otp] REVIEW_OTP secret is not set — refusing to authenticate');
    return json({ error: 'Sign-in unavailable' }, 500);
  }

  if (email !== REVIEW_EMAIL || code !== REVIEW_OTP) {
    console.log(`[verify-review-otp] rejected: email match=${email === REVIEW_EMAIL}, code match=${code === REVIEW_OTP}`);
    return json({ error: 'Invalid code' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // generateLink returns a magiclink token (properties.hashed_token)
  // that the client immediately consumes via supabase.auth.verifyOtp
  // ({ token_hash, type: 'magiclink' }) — that call gives them a real
  // session cookie identical to a normal OTP verify. We never actually
  // send the email (no `redirectTo`, no follow-up email fetch); the
  // token exists purely as a session-mint mechanism.
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: REVIEW_EMAIL,
  });

  if (error) {
    console.error(`[verify-review-otp] generateLink failed: ${error.message}`);
    return json({ error: 'Sign-in failed' }, 500);
  }

  const token_hash = data.properties?.hashed_token;
  if (!token_hash) {
    console.error('[verify-review-otp] generateLink succeeded but returned no hashed_token');
    return json({ error: 'Sign-in failed' }, 500);
  }

  console.log('[verify-review-otp] issued session for review demo account');
  return json({ token_hash }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
