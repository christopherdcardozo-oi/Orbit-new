-- Fix a scheduling mistake in 007_matchmaking_cron.sql: the intent was
-- "run matchmaking a few seconds after expire-matches-midnight", but the
-- cron expression '30 0 * * *' is standard 5-field cron (minute hour day
-- month weekday) — minute=30, hour=0 means 00:30 (30 MINUTES past
-- midnight), not 30 seconds past. pg_cron has no sub-minute granularity,
-- so the closest achievable "right after midnight" is 1 minute past,
-- which is still ample time for expire_active_matches() (a trivial
-- single UPDATE) to finish first.

SELECT cron.unschedule('run-matchmaking');

SELECT cron.schedule(
    'run-matchmaking',
    '1 0 * * *',
    $$
    SELECT net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/reset-matches',
        headers := jsonb_build_object(
            'Authorization',
            'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
            'Content-Type',
            'application/json'
        ),
        body := '{}'::jsonb
    );
    $$
);
