// Web push client — subscription flow only. Actual send happens from
// the send-web-push edge function; this file gets the browser
// subscribed and stores the resulting PushSubscription in the
// web_push_subscriptions table so the server can target it later.
//
// Runtime is web-only. Every entry point returns early with a status
// on native (Platform.OS !== 'web') so callers don't need to check
// platform themselves.
//
// Flow:
//   1. isSupported() — quick capability probe, doesn't touch state
//   2. getPermission() — reads the current browser permission
//   3. subscribe() — the whole thing: register SW → request permission
//      (if 'default') → pushManager.subscribe → upsert into Supabase.
//   4. unsubscribe() — remove local + server-side rows.
//
// See docs/push-notifications.md for the strategy this fits into.

import { Platform } from 'react-native';
import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY as string | undefined;

export type WebPushPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function isSupported(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getPermission(): WebPushPermission {
  if (!isSupported()) return 'unsupported';
  return (Notification.permission as WebPushPermission) ?? 'default';
}

// VAPID keys are base64url-encoded; pushManager.subscribe needs Uint8Array.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function registerSW(): Promise<ServiceWorkerRegistration> {
  // Serve sw.js from site root so its scope covers the whole app.
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return reg;
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'no-vapid-key' | 'no-session' | 'server-error'; error?: unknown };

export async function subscribe(): Promise<SubscribeResult> {
  if (!isSupported()) return { ok: false, reason: 'unsupported' };
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'no-vapid-key' };

  // Get current user first — we need a user_id to write the row, and
  // there's no point subscribing an anonymous session anyway.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: 'no-session' };

  // Permission may already be granted (returning user); if 'default',
  // this triggers the native browser prompt. If 'denied' we bail —
  // the user has to reset it themselves in browser site settings.
  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  const reg = await registerSW();

  // If we already have a subscription with matching keys, reuse it;
  // otherwise create a new one. Chrome quietly deduplicates on the
  // (endpoint) unique constraint anyway.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { ok: false, reason: 'server-error' };
  }

  const { error } = await supabase
    .from('web_push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent,
      },
      { onConflict: 'endpoint' },
    );

  if (error) {
    console.warn('web_push_subscriptions upsert failed:', error);
    return { ok: false, reason: 'server-error', error };
  }
  return { ok: true };
}

export async function unsubscribe(): Promise<void> {
  if (!isSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await supabase.from('web_push_subscriptions').delete().eq('endpoint', endpoint);
    }
  } catch (e) {
    console.warn('web-push unsubscribe failed:', e);
  }
}
