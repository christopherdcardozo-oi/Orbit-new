-- Replaces the once-daily, UTC-blind matchmaking schedule with a
-- 15-minute tick. The reset-matches edge function now decides per-campus
-- (using each university's own timezone) whether to do a full daily
-- reset, a mid-day top-up match, or nothing this tick — see the header
-- comment in supabase/functions/reset-matches/index.ts for the full
-- explanation.
--
-- This retires two jobs that are now not just redundant but actively
-- wrong:
--   - expire-matches-midnight (004_pg_cron.sql): blindly expired EVERY
--     active match at 00:00 UTC, which for America/Chicago campuses is
--     ~5-6 hours before their real local midnight — matches were losing
--     several hours of chat time every night. Expiry is now handled
--     per-campus, at the right local time, inside the edge function.
--   - run-matchmaking (007/012): fired once a day at what was meant to
--     be "just after midnight" but had the same UTC-vs-local problem,
--     and only ever matched people once a day regardless of when they
--     signed up.
--
-- purge-match-history (weekly cleanup) is untouched — timing precision
-- doesn't matter for that job.

SELECT cron.unschedule('expire-matches-midnight');
SELECT cron.unschedule('run-matchmaking');

SELECT cron.schedule(
    'matchmaking-tick',
    '*/15 * * * *',
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
