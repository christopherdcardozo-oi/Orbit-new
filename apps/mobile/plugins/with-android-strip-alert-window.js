const { withAndroidManifest } = require('expo/config-plugins');

// Expo's prebuild template emits SYSTEM_ALERT_WINDOW into the base
// android/app/src/main/AndroidManifest.xml (line 5) for every SDK 57 app,
// regardless of whether the app actually draws overlays. Google Play flags
// this as a sensitive permission during review and demands justification —
// "core functionality that requires drawing over other apps" (screen
// recorders, floating chat heads). Orbit does none of that: it's a plain
// two-tab RN app with a chat screen and a profile screen. Stripping the
// permission avoids the review flag entirely.
//
// Traced via `manifest-merger-blame-release-report.txt` after
// `fastlane android beta` — the permission enters the merge from the
// project's own base manifest, not from any transitive AAR, so removing
// it here fully removes it from the release AAB.
const TARGET = 'android.permission.SYSTEM_ALERT_WINDOW';

module.exports = function withAndroidStripAlertWindow(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (Array.isArray(manifest['uses-permission'])) {
      manifest['uses-permission'] = manifest['uses-permission'].filter(
        (p) => p?.$?.['android:name'] !== TARGET,
      );
    }
    return config;
  });
};
