const { withAndroidManifest } = require('expo/config-plugins');

// Names the default FCM notification channel, and settles the manifest
// merge conflict that comes with doing so.
//
// Background: @react-native-firebase/messaging's library manifest
// declares
//   <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id"
//              android:value=""/>
// An empty channel id is invalid, so FCM logs a warning and dumps every
// notification into the "Miscellaneous" fallback channel instead of the
// 'default' channel the app creates and the server targets
// (send-fcm-push sets channel_id: 'default').
//
// Setting expo-notifications' `defaultChannel` option writes the correct
// value, but Expo doesn't emit tools:replace for that node the way it
// does for the sibling default_notification_color, so the merger refuses:
//
//   Attribute meta-data#...default_notification_channel_id@value
//   value=(default) ... is also present at
//   [:react-native-firebase_messaging] value=().
//   Suggestion: add 'tools:replace="android:value"' to override.
//
// ...and :app:processReleaseMainManifest fails.
//
// This plugin adds that attribute to the node expo-notifications
// writes.
//
// ORDERING, the non-obvious part: it must be listed BEFORE
// expo-notifications in app.json's plugins array. Expo composes
// same-platform mods by wrapping, so a plugin listed LATER runs
// EARLIER. Listing this one after expo-notifications (the intuitive
// choice) made it run first, before the node existed; it then threw,
// and with the node authored here instead, expo-notifications' own mod
// ran afterwards and dropped it again. Verified by prebuild output:
// with this ordering the generated manifest carries both
// android:value="default" and tools:replace="android:value".
//
// It still creates the node when absent, so the build fails loudly
// rather than silently shipping the fallback channel if the option is
// ever removed from app.json.
const NAME = 'com.google.firebase.messaging.default_notification_channel_id';
const CHANNEL_ID = 'default';

module.exports = function withAndroidNotificationChannelMerge(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application) {
      throw new Error(
        '[with-android-notification-channel-merge] no <application> in the manifest — the prebuild template changed.',
      );
    }

    application['meta-data'] = application['meta-data'] || [];

    const existing = application['meta-data'].find(
      (m) => m?.$?.['android:name'] === NAME,
    );

    if (existing) {
      existing.$['android:value'] = CHANNEL_ID;
      existing.$['tools:replace'] = 'android:value';
    } else {
      application['meta-data'].push({
        $: {
          'android:name': NAME,
          'android:value': CHANNEL_ID,
          'tools:replace': 'android:value',
        },
      });
    }

    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    return config;
  });
};
