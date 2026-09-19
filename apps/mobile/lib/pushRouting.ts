// Deep-linking for notification taps, on native.
//
// The server has always sent a routable path in the FCM `data` payload
// (see enqueue_fcm_push: '/chat/<match_id>' for matches, messages and
// expiry warnings, '/' for broadcasts), and the web service worker in
// public/sw.js already consumes it. Nothing on native did. A tap on
// "You've been matched" just cold-opened the app on whatever screen
// happened to be last, which made push close to pointless on the one
// surface where it matters most.
//
// Firebase exposes the two cases separately and both are needed:
//   getInitialNotification()  — app was fully quit, tap launched it
//   onNotificationOpenedApp() — app was backgrounded, tap resumed it
//
// Uses @react-native-firebase directly; no Expo module involved.

import { Platform } from 'react-native';

/**
 * Pull a safe in-app path out of a remote message.
 *
 * Deliberately strict: only same-app absolute paths are accepted. A
 * push payload is attacker-influenceable in principle, and this is the
 * one place a notification gets to choose a destination, so anything
 * that isn't a plain '/...' route is dropped rather than navigated to.
 */
export function routeFromMessage(message: unknown): string | null {
  const data = (message as { data?: Record<string, unknown> } | null)?.data;
  const url = data?.url;
  if (typeof url !== 'string') return null;
  if (!url.startsWith('/')) return null;
  // '//host' is protocol-relative, not an in-app path.
  if (url.startsWith('//')) return null;
  return url;
}

/**
 * Wire up notification taps.
 *
 * `onRoute` is called with a path to navigate to. The caller decides
 * when it's safe to actually navigate — at cold start the router and
 * the auth session usually aren't ready yet, so the root layout holds
 * the path until it is.
 *
 * Returns an unsubscribe function.
 */
export async function attachPushRouting(
  onRoute: (path: string) => void,
): Promise<() => void> {
  if (Platform.OS === 'web') return () => {};

  try {
    const messaging = (await import('@react-native-firebase/messaging')).default;

    // Quit -> launched by tap.
    const initial = await messaging().getInitialNotification();
    const initialRoute = routeFromMessage(initial);
    if (initialRoute) onRoute(initialRoute);

    // Backgrounded -> resumed by tap.
    return messaging().onNotificationOpenedApp((message) => {
      const route = routeFromMessage(message);
      if (route) onRoute(route);
    });
  } catch (err) {
    // Same posture as registration: push is best-effort and a broken
    // native Firebase setup must never take the app down with it.
    console.log('Push routing unavailable:', err);
    return () => {};
  }
}
