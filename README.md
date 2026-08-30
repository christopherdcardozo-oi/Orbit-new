# Orbit

One codebase, three targets:

- **iOS** — via `eas build --platform ios` (Apple App Store submissions)
- **Android** — via `eas build --platform android` (Google Play Store submissions)
- **Web** — via `expo export -p web` (deployed to Vercel at `orbit-nine-ruddy.vercel.app`)

All three are built from the same Expo / React Native code in [apps/mobile/](apps/mobile/).

## Layout

```
apps/
  mobile/          Expo / React Native app (expo-router). The product.
packages/
  shared/          @orbit/shared — DB types, generated from live Supabase.
supabase/
  migrations/      SQL migrations, applied in order.
  functions/       Edge Functions (Deno) — reset-matches (daily cron).
  email-templates/ HTML templates for Auth emails (paste into Supabase UI).
```

## Setup

```bash
npm install
```

Then `apps/mobile/.env` must have the Supabase URL + publishable key. See
the file for the exact variable names.

## Run

```bash
npm run web              # Expo web dev server (localhost)
npm run ios              # Expo, boot iOS simulator
npm run android          # Expo, boot Android emulator
npm start                # Expo dev menu — pick your platform
```

## Deploy

- **Web:** every push to `main` auto-deploys to Vercel (`orbit-nine-ruddy.vercel.app`).
  Vercel project settings must have Root Directory = `apps/mobile` and
  Build Command = `npx expo export -p web`, Output Directory = `dist`.
- **iOS / Android:** `cd apps/mobile && npx eas build --platform ios` (or `android`).
  Requires `eas init` first if `eas.json` doesn't exist yet.

## Supabase

Everything lives inside the `genvenrtspvuuuwgfhwo` project:
- Schema + RLS policies + triggers → `supabase/migrations/`
- Daily matchmaking → `supabase/functions/reset-matches/`, scheduled at 00:30 UTC
  via `pg_cron` + `pg_net` (see `supabase/migrations/007_matchmaking_cron.sql`).
- Auth emails → templates in `supabase/email-templates/`; SMTP is Resend
  via `noreply@orbit.orghubs.com`.
