# Push notifications — strategy and catalog

Single source of truth for how Orbit delivers push and what we send.
Read this before touching any push-related code or copy so we don't
end up with overlapping/competing tech or drifting message wording.

## The rule: one delivery path per surface

Each surface Orbit runs on gets exactly one push tech. **No fallbacks, no
mixing.** If a surface can't take push (unsupported browser, permission
denied), we don't send.

| Surface | Delivery | Why not the others |
|---|---|---|
| Web (browser tab, or PWA installed to home screen) | **Web Push API + VAPID** | Direct browser standard. Works on Chrome/Edge/Firefox at all times, on iOS Safari only when installed as PWA (Apple rule, iOS 16.4+). Expo Push does not handle web. |
| Native iOS app (future build) | **Expo Push → APNs** | Expo relays APNs so we don't touch Apple's cert dance directly. |
| Native Android app (future build) | **Expo Push → FCM** | Same reason. Firebase project + `google-services.json` needed at build time. |

**We do not use FCM directly for anything.** FCM is what Expo Push
forwards to for Android native; we never call FCM's own API.

**We do not send Expo pushes to browsers.** Expo Push is native-only.

## Storage model

Two tables. Any given `profiles` row can have zero or many of each.

- `expo_push_tokens` — one row per (user, device) for native iOS/Android
  installs. Currently `profiles.fcm_token` (misnamed — actually an Expo
  token). Migrate to a proper multi-device table when we ship native.
- `web_push_subscriptions` — one row per (user, browser) for web push.
  Each row stores the full `PushSubscription` JSON (endpoint URL +
  auth/p256dh keys). Rotate/prune stale subscriptions when the push
  endpoint returns 410 Gone.

For V1 (web-only), only `web_push_subscriptions` is new. The existing
`fcm_token` column stays as-is until we ship native builds.

## Where subscriptions come from

- **Web:** user grants notification permission in-browser → service
  worker registered at `/sw.js` → `pushManager.subscribe({ userVisibleOnly:
  true, applicationServerKey: VAPID_PUBLIC })` → POST the resulting
  subscription JSON to a Supabase edge function that upserts into
  `web_push_subscriptions`.
- **Native (future):** Expo `getExpoPushTokenAsync` → POST to a
  Supabase edge function that upserts into `expo_push_tokens`.

## PWA-vs-browser detection

For web only. Standard two-line check, already implemented at
`apps/mobile/components/InstallHint.tsx`:

```ts
const isStandalone =
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (window.navigator as any).standalone === true;
```

Use `useIsStandalone()` (new hook in `lib/`) to gate messaging:
- **In a browser tab, not installed:** "Add Orbit to your Home Screen
  to get notifications" (extra emphasis on iOS Safari where it's
  literally the only way).
- **Installed as PWA:** normal "Enable notifications" toggle.
- **Native (Platform.OS !== 'web'):** normal toggle, no PWA messaging.

## Notification catalog

Every push we send is listed here with its exact text. Adding a new
notification type = update this doc first, then wire it up.

Placeholders in `{curly braces}` are substituted per-user. `{message}`
is truncated to 60 chars with an ellipsis if longer.

### 1. New match

**When:** matchmaker's `newMatches.insert` succeeds (either the midnight
cron reset or the event-driven topup). One push per user in the pair.

**Suppress:** never — this is the app's core moment.

- **Title:** `New match on Orbit 🌠`
- **Body:** `You've been paired with {alias}. Chat before midnight — they vanish at 12:00.`
- **Deep link:** `/chat/{matchId}`

### 2. New message from partner

**When:** `messages.insert` where `sender_id != recipient`. One push to
the recipient.

**Suppress:** no push for your own message on your own device. Otherwise
send unconditionally — the OS handles the "user is on this tab / has app
in foreground" case, browsers and native OSes already suppress notifications
for a focused destination by default.

- **Title:** `{alias}` (just the alias, no app branding — matches Signal
  / iMessage style so it's obviously a chat message)
- **Body:** `{message}` (truncated at 60 chars, no preview if the recipient
  has previews disabled at the OS level — the browser/OS handles this).
- **Deep link:** `/chat/{matchId}`

### 3. Contact reveal reciprocated

**When:** the second party of a match inserts a `contact_reveals` row
whose `handle_type` matches an existing row from the other party. Send
one push to each — they've both just unlocked each other's handle for
that type.

**Suppress:** none. Same reasoning as message pushes — OS handles the
"already on the tab" case.

- **Title:** `Contact unlocked ✨`
- **Body:** `You and {alias} both shared your {type}. Tap to see it.`
- **Deep link:** `/chat/{matchId}`

### Not shipping (yet)

Explicitly considered and rejected for V1:

- **10-min expiry warning** — the app already shows a live pulsing
  countdown in-chat once you cross the 10-min threshold. A push at the
  same moment risks pinging people around ~11:50pm every single night
  about matches they'd forgotten. Revisit later if we see people
  regretting matches expiring un-replied-to.
- **Read receipts** ("{alias} read your messages") — noisy, adds nothing.
- **Match expired** ("{alias} vanished into the cosmos") — the app
  navigates you home with the disintegrate animation; a push at the same
  moment is redundant.
- **Daily reset ("fresh matches happening")** — encourages spammy engagement,
  and the app cron already tops-up on signup.
- **Report acknowledgement** — handled by email reply from support, not
  push.

## Implementation stack

- **Web push send** — `web-push` npm library, called from a new Supabase
  edge function `send-web-push` (verify_jwt: false, called by
  the DB trigger or the matchmaker edge fn with a shared secret).
- **Web push key material** — VAPID keys generated via
  `npx web-push generate-vapid-keys`, stored as
  `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` in Supabase edge secrets;
  public key also read at build time by the client for subscribe().
- **Service worker** — `apps/mobile/public/sw.js` (single file, no
  bundler). Handles `push` and `notificationclick`.
- **No presence tracking** — decided against. Web browsers already
  suppress notifications for the currently-focused tab by default, and
  native OSes do similar for foregrounded apps. Sending unconditionally
  keeps the server simple and behaves correctly in the common cases.
  Revisit if we get complaints about redundant pings.
- **Native (future)** — keep the existing `sendPushNotification` helper
  in `reset-matches` that POSTs to `exp.host/--/api/v2/push/send`. Zero
  changes for iOS/Android when we ship those.

## The Expo push token / Web push subscription split

Two distinct code paths per event:
1. Fetch user's `web_push_subscriptions` rows → for each, invoke
   `send-web-push` edge function with the subscription + payload.
2. Fetch user's `expo_push_tokens` rows (or current
   `profiles.fcm_token` until migrated) → POST to `exp.host` push endpoint.

A user can have both (they use both a browser and a native app on their
phone). Both paths run for the same event. No duplicate content because
web-push and Expo push are talking to different systems delivering to
different clients.
