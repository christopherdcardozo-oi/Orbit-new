// send-fcm-push — invoked by DB triggers via net.http_post. Sends
// a native push to every FCM registration token stored for the
// target user, using the FCM HTTP v1 API. Firebase relays iOS
// pushes through the APNs auth key uploaded in the Firebase console.
//
// Same shared-secret auth pattern as send-web-push.
//
// Env:
//   CRON_SECRET               — shared secret from vault (auth guard)
//   FCM_SERVICE_ACCOUNT_JSON  — the entire service-account JSON blob
//                               from Firebase console → Project
//                               Settings → Service accounts → Generate
//                               new private key. Pasted as-is.
//
// Payload: { user_id, title, body, url?, tag? }

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { JWT } from 'npm:google-auth-library@9';

type Payload = { user_id: string; title: string; body: string; url?: string; tag?: string };

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

// Cache the OAuth2 access token in-process. FCM tokens are ~1h TTL;
// the JWT client refreshes when close to expiry.
let cachedClient: JWT | null = null;
let cachedProjectId: string | null = null;

function getFcmClient(): { client: JWT; projectId: string } {
  if (cachedClient && cachedProjectId) return { client: cachedClient, projectId: cachedProjectId };
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!raw) throw new Error('FCM_SERVICE_ACCOUNT_JSON not set');
  const sa = JSON.parse(raw) as { client_email: string; private_key: string; project_id: string };
  cachedClient = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });
  cachedProjectId = sa.project_id;
  return { client: cachedClient, projectId: cachedProjectId };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let payload: Payload;
  try { payload = (await req.json()) as Payload; } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!payload?.user_id || !payload?.title || !payload?.body) {
    return json({ error: 'user_id, title, body required' }, 400);
  }

  let client: JWT; let projectId: string;
  try {
    const { client: c, projectId: p } = getFcmClient();
    client = c; projectId = p;
  } catch (err) {
    console.error(err);
    return json({ error: 'FCM not configured (missing FCM_SERVICE_ACCOUNT_JSON)' }, 500);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: tokens, error: tokensError } = await supabase
    .from('device_push_tokens')
    .select('id, token, platform')
    .eq('user_id', payload.user_id);
  if (tokensError) return json({ error: tokensError.message }, 500);
  if (!tokens || tokens.length === 0) return json({ ok: true, sent: 0 });

  const { token: accessToken } = await client.getAccessToken();
  if (!accessToken) return json({ error: 'Failed to acquire FCM access token' }, 500);

  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const results = await Promise.all(
    tokens.map(async (row) => {
      const message = {
        message: {
          token: row.token,
          notification: { title: payload.title, body: payload.body },
          // data payload so the notificationclick / opened-from-notification
          // handler on the client can deep-link. FCM only allows string values.
          data: {
            url: payload.url ?? '/',
            ...(payload.tag ? { tag: payload.tag } : {}),
          },
          android: {
            priority: 'high',
            notification: {
              // Same tag semantics as the web SW — later push with same tag
              // replaces the earlier one in the tray.
              ...(payload.tag ? { tag: payload.tag } : {}),
              channel_id: 'default',
            },
          },
          apns: {
            payload: {
              aps: {
                sound: 'default',
                ...(payload.tag ? { 'thread-id': payload.tag } : {}),
              },
            },
          },
        },
      };
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        });
        if (res.ok) return { id: row.id, ok: true };
        const errText = await res.text();
        // Well-known FCM error indicating the token is dead. Delete
        // so we don't keep pinging it.
        const dead = res.status === 404 ||
          errText.includes('UNREGISTERED') ||
          errText.includes('INVALID_ARGUMENT') && errText.includes('token');
        if (dead) {
          await supabase.from('device_push_tokens').delete().eq('id', row.id);
        }
        console.warn('FCM send error', res.status, errText);
        return { id: row.id, ok: false, status: res.status };
      } catch (err) {
        console.warn('FCM send exception', err);
        return { id: row.id, ok: false };
      }
    }),
  );

  const sent = results.filter((r) => r.ok).length;
  return json({ ok: true, sent, total: tokens.length });
});
