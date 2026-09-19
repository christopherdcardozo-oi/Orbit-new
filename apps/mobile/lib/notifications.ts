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

import { PermissionsAndroid, Platform } from 'react-native';
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

const ANDROID_CHANNEL_ID = 'default';

// Android 8+ drops any notification whose channel doesn't exist. This
// used to live inside registerForPushNotificationsAsync's try block,
// after `await import('@react-native-firebase/messaging')` — so if that
// import ever failed (and the catch swallows everything), the channel
// was never created and every push went silently missing. Hoisted out
// so channel setup doesn't depend on Firebase loading, and memoised so
// repeated registration calls don't re-create it.
let channelReady: Promise<void> | null = null;
export function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  if (!channelReady) {
    channelReady = Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'Matches and messages',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#a855f7',
    })
      .then(() => undefined)
      .catch((err) => {
        console.log('Notification channel setup failed:', err);
        // Reset so a later call can retry rather than caching the failure.
        channelReady = null;
      });
  }
  return channelReady;
}

/**
 * Request OS permission to post notifications.
 *
 * Android and iOS need completely different calls here. Firebase's
 * requestPermission() is iOS-only (its Android branch returns
 * AUTHORIZED without prompting), so Android goes through React
 * Native's own PermissionsAndroid instead — no Expo module involved.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  if (Platform.OS === 'android') {
    // POST_NOTIFICATIONS is API 33+. Below that it's an install-time
    // permission and is already granted.
    if (typeof Platform.Version === 'number' && Platform.Version < 33) return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }

  const messaging = (await import('@react-native-firebase/messaging')).default;
  const authStatus = await messaging().requestPermission();
  return (
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL
  );
}

/**
 * Current permission state, without prompting. Used by the Settings
 * screen so a user who declined has something to act on instead of
 * silently never receiving anything.
 */
export async function hasPushPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  if (Platform.OS === 'android') {
    if (typeof Platform.Version === 'number' && Platform.Version < 33) return true;
    return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }

  try {
    const messaging = (await import('@react-native-firebase/messaging')).default;
    const status = await messaging().hasPermission();
    return (
      status === messaging.AuthorizationStatus.AUTHORIZED ||
      status === messaging.AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

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

  // Before the try below: channel creation must not be gated on the
  // Firebase import succeeding.
  await ensureAndroidChannel();

  try {
    // Lazy-require so this file still imports cleanly on web builds
    // (where @react-native-firebase isn't bundled).
    const messaging = (await import('@react-native-firebase/messaging')).default;

    // Permission. These are two genuinely different code paths and the
    // old code used the iOS one for both, which is why Android never
    // showed a prompt: @react-native-firebase/messaging's
    // requestPermission() is marked `@platform ios` and its Android
    // branch is a bare `return Promise.resolve(1)` — i.e. it reports
    // AUTHORIZED without asking anyone. The check below therefore
    // always passed, a token was stored, the server sent pushes, and
    // Android dropped every one of them because POST_NOTIFICATIONS was
    // never granted. Nothing surfaced the failure.
    //
    // Android 13 (API 33) introduced POST_NOTIFICATIONS as a runtime
    // permission; below 33 it is granted at install time. Requested
    // through React Native's own PermissionsAndroid so this doesn't
    // depend on an Expo module.
    const granted = await requestPushPermission();
    if (!granted) return;

    // iOS-only, required: getToken() needs a real APNs token bound
    // first, or it fails with "No APNS token specified before
    // fetching FCM Token" — a gap in the original implementation here.
    // Suspected root cause of a real crash on iOS 26: this app runs
    // React Native 0.86 on the New Architecture, which has a known bug
    // (facebook/react-native#54859) where an NSException thrown inside
    // a void-returning TurboModule method invoked on a background
    // queue can't be caught by JS try/catch at all and hard-crashes
    // the app (SIGABRT in ObjCTurboModule::performVoidMethodInvocation)
    // — release builds only, so it never showed up in dev testing.
    // Explicitly registering first is the documented fix upstream and
    // avoids relying on getToken() to implicitly (and unreliably)
    // trigger APNs registration itself.
    if (Platform.OS === 'ios') {
      await messaging().registerDeviceForRemoteMessages();
    }

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
 * Drop this device's push registration.
 *
 * Must run BEFORE supabase.auth.signOut() — deleting the row needs the
 * session that RLS checks against.
 *
 * Without this, signing out left device_push_tokens intact and the
 * device kept receiving the previous user's match and message pushes.
 * On a shared phone that means someone else's private notifications,
 * and it persisted until a different account happened to register the
 * same token and the onConflict upsert reassigned the row.
 */
export async function unregisterPushToken(): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const messaging = (await import('@react-native-firebase/messaging')).default;
    const token = await messaging().getToken();
    if (token) {
      await supabase.from('device_push_tokens').delete().eq('token', token);
    }
    // Forces a new token next sign-in, so the old one can't be reused.
    await messaging().deleteToken();
  } catch (err) {
    // Best-effort, same as registration: never block sign-out.
    console.log('Push unregister skipped:', err);
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
