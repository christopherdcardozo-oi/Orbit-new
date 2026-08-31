# Native iOS + Android build setup

Everything you need to do once on your side to get the app onto
TestFlight and Google Play. Code side is already in place (see
docs/push-notifications.md for the delivery-path context — we use
Firebase directly, no Expo Push service).

## 0. One-time global setup

If you haven't yet:
```bash
npm install -g expo-cli
cd /Users/sunil/Developer/Orbit/apps/mobile
npm install
```

That installs `@react-native-firebase/app`, `@react-native-firebase/messaging`,
and `expo-build-properties` per the updated package.json.

## 1. Firebase — add the two Orbit apps to your existing project

Firebase console → your existing "notifications only" project.

**Add Android app:**
- Package name: `com.orghubs.orbit`
- Nickname: "Orbit Android"
- SHA-1 cert fingerprint: skip for now (only needed if you use Google
  Sign-In or Dynamic Links)
- Download `google-services.json` when prompted
- Drop it at: `/Users/sunil/Developer/Orbit/apps/mobile/google-services.json`

**Add iOS app:**
- Bundle ID: `com.orghubs.orbit`
- App nickname: "Orbit iOS"
- Skip App Store ID for now
- Download `GoogleService-Info.plist`
- Drop it at: `/Users/sunil/Developer/Orbit/apps/mobile/GoogleService-Info.plist`

**Grab the FCM service account (server credentials):**
- Firebase console → Project Settings (gear) → Service accounts
- Click "Generate new private key" → download the JSON file (keep this safe;
  it's the whole key)
- In Supabase dashboard → Project Settings → Edge Functions → Secrets:
  - Add secret `FCM_SERVICE_ACCOUNT_JSON` with the ENTIRE JSON blob as value

## 2. Apple Developer — bundle ID + APNs key

**Register bundle ID:**
- developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → +
- App IDs → App → Bundle ID: `com.orghubs.orbit`
- Description: "Orbit"
- Capabilities: check **Push Notifications**
- Save

**Create APNs auth key** (once — reused across all your apps):
- developer.apple.com → Keys → +
- Name: "Firebase APNs" (or similar)
- Enable **Apple Push Notifications service (APNs)**
- Save → download the `.p8` file (⚠️ can only download ONCE — keep safe)
- Note the Key ID and your Team ID

**Upload APNs key to Firebase** (so Firebase can relay iOS pushes for you):
- Firebase console → Project Settings → Cloud Messaging tab
- Under "Apple app configuration" (your new iOS app) → APNs Authentication Key
- Upload the `.p8` file, enter Key ID and Team ID
- Save

**Same key can be uploaded once and referenced by all iOS apps in the
Firebase project** — since you have the shared notifications project,
this may already be uploaded from Alumni. Just verify it's there.

**App Store Connect listing:**
- appstoreconnect.apple.com → My Apps → + → New App
- Platform: iOS
- Name: "Orbit"
- Primary Language: English (US)
- Bundle ID: com.orghubs.orbit (should appear in dropdown after step above)
- SKU: `orbit-ios` (or anything unique to your account)
- User Access: Full Access
- Create

## 3. Google Play Console

- play.google.com/console → Create app
- App name: Orbit
- Default language: English (US)
- App type: App
- Free
- Confirm declarations
- Create

## 4. Generate native projects

Once the two config files are in place:

```bash
cd /Users/sunil/Developer/Orbit/apps/mobile
npx expo prebuild --clean
```

This generates `ios/` and `android/` folders locally. **Never commit
these to git** — they're generated output; the source of truth is
`app.json` + the plugin config. Add to `.gitignore` if not already
present.

## 5. iOS build (Xcode + Transporter)

```bash
cd /Users/sunil/Developer/Orbit/apps/mobile/ios
pod install
open Orbit.xcworkspace
```

In Xcode:
- Select the Orbit scheme → Any iOS Device (arm64)
- Signing & Capabilities → Team: your Apple Dev team
- Verify "Push Notifications" capability is present under the target
- Product → Archive
- When archive completes → Distribute App → App Store Connect → Upload
- Or export .ipa and use Transporter for upload

TestFlight will process the build (~15-20 min), then you can add
internal testers.

## 6. Android build (Android Studio)

```bash
cd /Users/sunil/Developer/Orbit/apps/mobile
npx expo run:android --variant release
```

Or open `android/` in Android Studio, build → generate signed bundle
(.aab). Upload the .aab to Play Console → Testing → Internal testing.

## 7. Test push end-to-end

Once installed on a device with a signed build:
1. Sign in → tap profile icon → gear (Settings)
2. Notifications toggle is web-only in the UI; for native the token
   registers automatically on sign-in (see lib/notifications.ts)
3. Trigger a match manually via SQL, or wait for the midnight cron
4. Push should land in ~1s

To debug: Supabase dashboard → Edge Functions → send-fcm-push → Logs.
Failed tokens (404/UNREGISTERED) auto-delete themselves from
device_push_tokens.

## Whenever you rebuild

`npx expo prebuild --clean` regenerates the native folders from
app.json. Run this after any change to bundle ID, plugins, icons, or
splash. Then rebuild through Xcode / Android Studio.
