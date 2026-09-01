// send-feedback — invoked by the Feedback modal on the profile screen.
// Persists the user's message to public.feedback for the admin panel
// to read. Previously this also emailed support@orghubs.com via Resend;
// that's retired now that the admin panel (migration 037) has a proper
// feedback inbox — one less moving part, one less place for delivery
// to silently fail.
//
// Auth: verify_jwt at the platform level guarantees a valid caller JWT
// before this ever runs; inside we still use that JWT to build an anon
// client so the profile lookup (for context, not required) runs
// through RLS (you can only fetch your own row).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CATEGORIES = new Set(['bug','feature-request','ui-ux','matching-quality','safety-abuse-report','account-help','other']);
const MAX_MESSAGE_LENGTH = 5000;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return json({ error: 'Not authenticated' }, 401);

  let body: { category?: string; message?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const category = String(body.category || '').trim();
  const message = String(body.message || '').trim();
  if (!CATEGORIES.has(category)) return json({ error: 'Invalid category' }, 400);
  if (!message) return json({ error: 'Message is required' }, 400);
  if (message.length > MAX_MESSAGE_LENGTH) return json({ error: `Message must be under ${MAX_MESSAGE_LENGTH} characters` }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return json({ error: 'Not authenticated' }, 401);
  const user = userData.user;

  // Service-role client for the actual insert — the feedback table has
  // no user-facing INSERT policy (see migration 037), only this
  // function and the admin panel touch it.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY not set for this edge function');
    return json({ error: 'Feedback storage not configured on the server.' }, 500);
  }
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error: insertError } = await adminClient
    .from('feedback')
    .insert({ user_id: user.id, category, message });

  if (insertError) {
    console.error('Failed to persist feedback row:', insertError);
    return json({ error: 'Failed to save feedback' }, 502);
  }

  return json({ ok: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
