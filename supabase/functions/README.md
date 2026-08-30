# Supabase Edge Functions

Backend jobs for Orbit that run inside Supabase (Deno) so nothing else has
to exist to run the daily loop.

## Functions

### `reset-matches`

Once-a-day matchmaking job. Called at 00:00:30 UTC by pg_cron (see
`supabase/migrations/007_matchmaking_cron.sql`). Direct port of the old
`apps/web/app/api/cron/reset-matches/route.ts` — same algorithm, same
icebreakers, same Expo push payloads.

**Auth**: verify_jwt is OFF; the function checks a shared `CRON_SECRET` in
the `Authorization: Bearer …` header. Same pattern the old Next.js cron used.

## First-time deploy (one-time, ~10 minutes)

Prerequisites:
- Supabase CLI installed (`brew install supabase/tap/supabase`)
- Logged in and linked to the project:
  ```bash
  supabase login
  supabase link --project-ref genvenrtspvuuuwgfhwo
  ```

Run these once, from the repo root:

```bash
# 1. Generate a strong random secret. Copy the output — you'll paste it twice.
openssl rand -base64 32

# 2. Set the secret on the edge function.
supabase secrets set CRON_SECRET=<paste-the-value>

# 3. Deploy the function. verify_jwt is disabled because we use CRON_SECRET.
supabase functions deploy reset-matches --no-verify-jwt

# 4. Smoke test — should return {"success":true,...}.
curl -X POST \
  -H "Authorization: Bearer <paste-the-value>" \
  -H "Content-Type: application/json" \
  https://genvenrtspvuuuwgfhwo.functions.supabase.co/reset-matches

# 5. In the Supabase dashboard: Database → Extensions → enable `pg_net`.

# 6. Store the same values in Postgres Vault so pg_cron can read them without
#    inlining secrets in SQL. Dashboard: Database → Vault → New Secret.
#      name: supabase_url    value: https://genvenrtspvuuuwgfhwo.functions.supabase.co
#      name: cron_secret     value: <paste-the-value>

# 7. Apply the new migrations. This adds the missing profile columns
#    (idempotent) and schedules the cron.
supabase db push
```

That's it. From here on, the daily job runs on 00:00:30 UTC, entirely inside
Supabase.

## Verify it worked

```bash
# See the schedule.
supabase db execute --sql "SELECT jobid, schedule, jobname, active FROM cron.job;"

# Watch runs after midnight.
supabase db execute --sql "SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;"

# Function logs live in the dashboard: Edge Functions → reset-matches → Logs.
```

## Rollback

If something goes wrong, un-scheduling is one call:

```bash
supabase db execute --sql "SELECT cron.unschedule('run-matchmaking');"
```

The Vercel cron in the (soon-to-be-removed) Next.js app is still active until
you delete it, so daily matches will keep happening from there.
