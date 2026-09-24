# Orbit — session handoff

Written 2026-09-24. Everything below was verified against the live
Supabase project and the repo at commit `ac684b2`, not recalled.

---

## 1. Read this first

Three things that will bite whoever picks this up:

1. **Migration 060 is applied, then reverted by 063.** The whole-row
   partner SELECT policies on `public.profiles` are currently BACK.
   That's deliberate. Re-run 060 only once every shipped build uses
   `get_partner_profiles()`. See §4.
2. **The Play production track holds versionCode 11**, a build that
   predates every fix in this session. It has dead push on Android 13+.
   Do not let it go live. See §5.
3. **Git authorship**: repo-local `user.email` is
   `tophercardozo@icloud.com`, which GitHub links to the account
   **TrynaLearnToCode**. Not `christopherdcardozo`, which does not exist
   as a GitHub account. Never let the machine's global identity
   (`mailcardozo@gmail.com`) author a commit here.

---

## 2. Where things stand

| Surface | Version | State |
|---|---|---|
| iOS | Build 12 | **Submitted for review** after a 1.2 rejection |
| Android | versionCode 15 | On Play **internal** track, not promoted |
| Android | versionCode 11 | On Play **production**, in review, should be discarded |
| Web | auto-deploy from `main` | Live and current at orbit-nine-ruddy.vercel.app |

Live data: 77 profiles, 1029 messages, 99 blocked terms, 3 admins.

Apple rejected on 2026-09-23 under **Guideline 1.2 (Safety — User
Generated Content)**. Four of their eight required precautions were
already implemented but invisible to the reviewer; four were genuinely
missing. Both were addressed — see §4.

---

## 3. Migration ledger

Everything 055 and up is from this session.

| # | What | Applied? |
|---|---|---|
| 055 | Lock privileged profile columns; stop message tampering | ✅ |
| 056 | Server-side content filter on messages | ✅ |
| 057 | Fix account-deletion FKs, index FKs, drop dead `fcm_token` | ✅ |
| 058 | `client_errors` table | ✅ |
| 059 | `get_partner_profiles()` (additive) | ✅ |
| 060 | Drop broad partner policies | ⚠️ applied, then undone by 063 |
| 061 | `messages.deleted_at` + delete-your-own-message | ✅ |
| 062 | `profiles.terms_accepted_at` | ✅ |
| 063 | **Temporary revert of 060** | ✅ — currently in force |
| 064 | Curated blocklist (99 terms) | ✅ |
| 065 | Moderation evidence retention | ✅ |

**To re-apply 060 later**, just run `060_drop_broad_partner_policies.sql`
again. Verify with:

```sql
select policyname from pg_policies
where schemaname='public' and tablename='profiles' and cmd='SELECT'
order by policyname;
```

Four policies now. After re-running 060 it should be two: own-profile
and the admin campus-scope one.

---

## 4. What changed and why

### Security (all live)

- **Privilege escalation, critical.** `authenticated` held UPDATE on
  every column of `profiles`, including `is_admin` and
  `admin_campuses`, and a trigger synced those into `admin_users`. Any
  signed-in student could PATCH their own row and become a global admin
  with read access to every message on every campus. The same path let
  a banned user clear their own `flagged`/`is_active`. Fixed in 055 by
  a trigger that pins those columns to `service_role`, while leaving
  `flagged`/`is_active` writable by an in-scope admin so the admin panel
  still works. **Verified: ban/unban still functions.**
- **Message tampering.** The read-receipt UPDATE policy intentionally
  targets the *partner's* rows, and `authenticated` had UPDATE on
  `content`. A recipient could rewrite what their partner said and then
  report them. Fixed by a column grant limited to `read_at`.
- **Reviewer had global admin.** The App Store review account
  (`AppStoreDude666`) was a global admin and could read every private
  chat. Neutralised by setting `admin_campuses = '{}'` — an empty array
  makes every scope check false, while `is_admin` stays true so the
  matchmaker keeps excluding it. **Do not set `is_admin=false` on it**:
  the "already matched" query in `reset-matches` filters on
  `user1_id IN (non-admin pool)`, and that account's demo match has an
  admin as user1, so demoting it would make the matcher treat the
  reviewer as unmatched and pair them with a real student.
- **Partner profiles** could be read in full (gender, moderation flags,
  `active_match_id`, which leaks whether they have your chat open).
  Replaced by `get_partner_profiles()`, which returns display fields
  only and checks membership internally. Currently coexisting with the
  old policies — see §1.

### Guideline 1.2 compliance

Apple's eight items, and where each now lives:

| Apple's requirement | Status |
|---|---|
| Age rating 18+ | Already set: 18+ in 173 regions. Nothing to do. |
| Users agree to terms w/ zero tolerance | **New.** Blocking gate after sign-in (`components/TermsGate.tsx`), gated on `profiles.terms_accepted_at`. Also a checkbox at signup. |
| Method for filtering objectionable content | 056 + 064. Server-side, masks on insert. |
| Mechanism to flag content | Already existed: Report and Block. |
| Mechanism to block users | Already existed. |
| Immediately remove posts | **New.** Hold your own message to delete (061). Soft delete. |
| Act within 24 hours | Published in Terms; **now also stated in-app** in three places. |
| Contact info in the app | **New.** Settings → Contact Support. |

**The terms gate is account state, not a signup form field, on purpose.**
The App Store reviewer signs in via the login screen's review-OTP bypass
and never visits signup, so a signup-only checkbox would have been
invisible to them and the rejection would have repeated.

### The content filter — how it actually behaves

- It **masks, it never blocks**. The message always sends. Matched terms
  become asterisks of the same length. Both people see the mask,
  including the sender (the trigger is BEFORE INSERT and the client
  reads the row back).
- **99 terms, built by category**: racial/ethnic slurs (42), LGBTQ+
  slurs (16), ableist (10), sexual violence (12), child exploitation
  (13), gendered abuse (6).
- **Profanity is deliberately NOT filtered.** "fuck this exam" goes
  through untouched. Nothing in 1.2 asks for profanity filtering, and
  masking it made the app look broken.
- An earlier version derived from the LDNOOBW wordlist. That was the
  wrong source — it's a porn-site keyword list, and it put `panty`,
  `vibrator`, `threesome` and `hardcore` on the blocklist. Rebuilt from
  scratch by category. **Do not reintroduce a generic "bad words" list.**
- Word boundaries mean short terms are safe: nothing fires on
  `assignment`, `class`, `pass` or `bass`.
- The blocklist is **data, not code**. Tune it with SQL, no deploy:

```sql
select term from public.blocked_terms order by term;
delete from public.blocked_terms where term = 'cunt';
```

- `moderation_events` records every mask, with the **original unmasked
  text**, which terms matched, and the message id (065). Admin-read
  only. Without this a moderator reviewing a report would see only
  asterisks and couldn't tell a racial slur from a rude word.

### Client fixes

- **Android never asked for notification permission.**
  `@react-native-firebase/messaging`'s `requestPermission()` is
  iOS-only; its Android branch is `return Promise.resolve(1)`, i.e. it
  reports AUTHORIZED without prompting. So a token was stored, the
  server sent pushes, and the OS dropped every one. Now uses React
  Native's `PermissionsAndroid` for `POST_NOTIFICATIONS`.
- **Notification taps went nowhere on native.** The server always sent a
  routable path in the FCM data payload and `public/sw.js` used it on
  web, but nothing on native did. Added `lib/pushRouting.ts` using
  Firebase's `getInitialNotification` + `onNotificationOpenedApp`. Only
  same-app `/...` paths are accepted.
- **Alert.alert is a no-op in react-native-web.** Account deletion (an
  Apple requirement), admin ban, and every error message in the web push
  settings silently did nothing on web. Added `lib/confirm.ts`.
- **Sign-out left push tokens registered**, so a shared device kept
  getting the previous user's notifications. `lib/auth.ts`.
- **Error reporting added** — there was none. `lib/errorReporting.ts` +
  `components/ErrorBoundary.tsx` → `client_errors`. Does **not** catch
  native crashes; a real crash reporter is still worth adding.
- Chat: stuck spinner on expired session; realtime channel rebuilt
  mid-load and dropped messages, now reconciles on SUBSCRIBED.
- Tab bar ignored the gesture inset under Android edge-to-edge; admin
  headers used a hardcoded `paddingTop: 56`.
- iOS privacy manifest declared zero collected data types while the app
  collects email, message content, user id and a push token.

---

## 5. Outstanding work

### Blocking Android release

1. **Account-deletion URL returns 404.** Google requires a publicly
   reachable deletion page declared in Data safety, separate from the
   in-app flow. `https://orghubs.com/apps/orbit/delete-account` and
   variants all 404. Fastest fix is a route on the Vercel app, which
   auto-deploys from `main`.
2. **Content rating** (IARC) questionnaire — Play Console → Policy →
   App content. Separate from Apple's; inherits nothing.
3. **Target audience** — set to 18+.
4. **Decide on versionCode 11.** Recommendation: discard the pending
   production release and promote 15 from internal. 11 predates every
   1.2 fix and has dead push on Android 13+.

### After the new build is released

5. **Re-run 060** to drop the partner policies again.

### Not device-verified (no physical device available in session)

6. Android notification permission prompt actually appearing.
7. Notification tap opening the right chat.
8. Tab bar layout on a gesture-nav phone.
9. Splash screen (config moved to the `expo-splash-screen` plugin).

### Known issues, deliberately not fixed

10. **`check_email_exists` allows account enumeration.** Anyone can test
    whether a campus address has an account, which undercuts an
    anonymity product. Fixing it means reworking the OTP flow in both
    login and signup; not worth doing blind while submissions are in
    review.
11. **Review-OTP endpoint** (`verify-review-otp`) is unauthenticated,
    uses a static code and has no rate limit. Blast radius is now small
    (the account has no admin scope) but it's still a backdoor.
12. **No native crash reporting.**
13. **Message retention** — "ephemeral" chats are kept forever.
14. **Repo hygiene** — no tests, no linter, no CI. `App.tsx`/`index.ts`
    are dead. `crop.py`, `crop_manual.py`, `fix_profile.js` are tracked
    and reference another machine's paths.

---

## 6. Gotchas worth knowing

- **Expo config plugins run in reverse.** A plugin listed *later* in
  `app.json` runs *earlier*. `with-android-notification-channel-merge.js`
  must be listed BEFORE `expo-notifications` to run after it. This cost
  a failed build.
- **`defaultChannel` alone breaks the Android build.** RNFirebase's
  manifest declares the same meta-data key with an empty value and the
  merger refuses; the plugin above supplies `tools:replace`.
- **`ios/` and `android/` are gitignored** and regenerated by
  `expo prebuild --clean` on every fastlane run. Never hand-edit them;
  changes go in `app.json` or a config plugin.
- **fastlane lanes**: `beta` = TestFlight / Play internal (safe).
  `release` = production candidate, stops short of submitting. Neither
  auto-submits; that stays manual by design.
- **The Supabase SQL editor keeps the whole buffer.** Running a file
  that still contains an old rollback statement will silently undo your
  work. Use a fresh tab.
- **`updated_at` on `profiles` is app-maintained, not a trigger.** Don't
  use it to infer whether a write landed.

---

## 7. Verification queries

```sql
-- Overall health
select
  (select count(*) from public.blocked_terms)   as blocked_terms,      -- 99
  (select count(*) from public.profiles)        as profiles,           -- 77
  (select count(*) from public.client_errors)   as client_errors,
  (select count(*) from public.moderation_events) as moderation_events,
  (select count(*) from pg_policies where schemaname='public'
     and tablename='profiles' and cmd='SELECT') as profile_policies;   -- 4 (2 after 060)

-- Filter behaviour: profanity through, slurs masked
select public.mask_blocked_terms('fuck this exam, my panties are in a twist'),
       public.mask_blocked_terms('you stupid retard');

-- Admin scopes: reviewer must be {} not GLOBAL
select display_alias, is_admin, admin_campuses from public.profiles where is_admin;

-- What the filter has caught (admin-only table)
select created_at, matched_terms, original_content
from public.moderation_events order by created_at desc limit 20;
```

---

## 8. Review account

- Email `review@orghubs.com`, signs in through the **login** screen.
- The bypass code lives only in the `verify-review-otp` edge function's
  environment. **Verified it is not in the public repo or the web
  bundle.**
- Buttons are **"Send Code"** then **"Verify & Login"**.
- Permanently matched with `CosmicSeeker731` via
  `matches.is_persistent = true`, expiry 2099.
- It hits the terms gate on first sign-in, by design.
