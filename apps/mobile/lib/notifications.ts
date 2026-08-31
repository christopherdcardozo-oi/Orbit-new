// Native push registration via Firebase Cloud Messaging.
//
// Uses @react-native-firebase/messaging so we get a real FCM
// registration token on both platforms. Firebase relays iOS pushes
// through the APNs auth key uploaded in the Firebase console — no
// direct APNs code needed on either side.
//
// Web push is handled separately via lib/webPush.ts (VAPID). This
// file is a no-op on Platform.OS === 'web'.
//
// See docs/push-notifications.md for the full delivery strategy.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    // shouldShowAlert was replaced in expo-notifications v0.30 by the
    // more granular shouldShowBanner (heads-up) and shouldShowList
    // (notification center).
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Ask permission (if needed), fetch the device's FCM registration
 * token, and upsert it into device_push_tokens for the signed-in
 * user. Safe to call multiple times — Firebase will hand back the
 * same token, and the DB upsert de-dupes on the token.
 *
 * On web: no-op — web push lives in lib/webPush.ts.
 * On simulators / missing Firebase: returns silently.
 */
export async function registerForPushNotificationsAsync(): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    // Lazy-require so this file still imports cleanly on web builds
    // (where @react-native-firebase isn't bundled).
    const messaging = (await import('@react-native-firebase/messaging')).default;

    // Ensure Android has a channel to route foreground notifications
    // through. Matches the channel_id set by the server-side FCM
    // payload in send-fcm-push.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#a855f7',
      });
    }

    // iOS requires explicit permission before it'll give us an APNs
    // token (which Firebase then uses to register with FCM). Android
    // 13+ also prompts. This is idempotent.
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    if (!enabled) return;

    // The token is what the server-side FCM V1 API targets. Alumni
    // stores per-device tokens keyed by the token itself; we do the
    // same via the unique(token) constraint on device_push_tokens.
    const token = await messaging().getToken();
    if (!token) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('device_push_tokens').upsert(
      {
        user_id: user.id,
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      },
      { onConflict: 'token' },
    );

    // Firebase rotates tokens occasionally (e.g. app reinstall, cache
    // clear). Keep the row current.
    messaging().onTokenRefresh(async (newToken) => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u || !newToken) return;
      await supabase.from('device_push_tokens').upsert(
        {
          user_id: u.id,
          token: newToken,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        },
        { onConflict: 'token' },
      );
    });
  } catch (err) {
    // Push is best-effort — a misconfigured native Firebase setup
    // (missing google-services.json / GoogleService-Info.plist)
    // should never block the rest of the app from working.
    console.log('Push registration skipped:', err);
  }
}

/**
 * Kept as a stable no-op for backwards compatibility with the
 * previous savePushToken(userId, token) call site in _layout.tsx.
 * The registration now writes the row itself, so callers only need
 * to invoke registerForPushNotificationsAsync().
 */
export async function savePushToken(_userId: string, _token: string): Promise<void> {
  // no-op — registerForPushNotificationsAsync handles the upsert
}
