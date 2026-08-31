// send-web-push — invoked by Postgres triggers (via net.http_post)
// with a per-notification payload. Fans out to every web_push_subscription
// for the target user, using the web-push library over VAPID.
//
// Auth: verify_jwt is disabled at deploy time; instead we check a
// shared secret in the Authorization header, same pattern as
// reset-matches. Only the DB triggers should ever call this.
//
// Payload shape (JSON body):
//   {
//     user_id: uuid,            // the recipient
//     title: string,
//     body: string,
//     url?: string,             // deep link, default '/'
//     tag?: string,             // for de-dup / replacement on the client
//   }
//
// See docs/push-notifications.md for the catalog of what gets sent
// when and why.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

type Payload = {
  user_id: string;
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:support@orghubs.com';
  if (!vapidPublic || !vapidPrivate) {
    return json({ error: 'Web push not configured (missing VAPID keys)' }, 500);
  }
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!payload?.user_id || !payload?.title || !payload?.body) {
    return json({ error: 'user_id, title, body required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Pull every subscription for this user. Empty list = user hasn't
  // enabled web push on any browser; just return success with 0 sent.
  const { data: subs, error: subsError } = await supabase
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', payload.user_id);

  if (subsError) return json({ error: subsError.message }, 500);
  if (!subs || subs.length === 0) return json({ ok: true, sent: 0 });

  const pushBody = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? '/',
    tag: payload.tag,
  });

  const results = await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          pushBody,
        );
        return { id: s.id, ok: true };
      } catch (err: unknown) {
        // 404/410 = subscription is gone (browser reset, uninstalled).
        // Delete the row so we don't keep hitting it.
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await supabase.from('web_push_subscriptions').delete().eq('id', s.id);
        } else {
          console.warn('web-push send error', status, err);
        }
        return { id: s.id, ok: false, status };
      }
    }),
  );

  const sent = results.filter((r) => r.ok).length;
  return json({ ok: true, sent, total: subs.length });
});
