# Orbit (monorepo)

Combined workspace containing the Orbit mobile app, the Orbit web app, and the
shared Supabase schema. Assembled locally from two upstream repos:

- Mobile — https://github.com/christopherdcardozo-oi/Orbit
- Web / API — https://github.com/christopherdcardozo-oi/Orbit-Backend

Both were imported with `git subtree`, so their full commit history is
preserved in `git log`.

## Layout

```
apps/
  mobile/          Expo / React Native app (expo-router)
  web/             Next.js 16 app (also hosts the reset-matches cron)
supabase/
  migrations/      Single source of truth for the DB schema
packages/          (empty, reserved for shared code)
sources/           The original per-repo clones, kept for reference. Their
                   `origin` remotes still point at GitHub — the monorepo
                   itself has no remote.
```

## Setup

```bash
npm install              # installs both apps via workspaces
```

Each app needs its own `.env.local` with the Supabase URL / anon key
(see each app's code for the exact variable names).

## Run

```bash
npm run web              # Next.js dev server (http://localhost:3000)
npm run mobile           # Expo dev server
npm run mobile:ios       # Expo, boot iOS simulator
```

## Note on remotes

The monorepo's `.git` has **no remote**. Nothing here can push to
christopherdcardozo-oi/*. The original clones under `sources/` still have
their remotes if you ever need to sync changes back upstream by hand.
