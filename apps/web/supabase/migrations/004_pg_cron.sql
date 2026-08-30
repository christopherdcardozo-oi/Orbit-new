CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Expire matches at midnight UTC daily
SELECT cron.schedule('expire-matches-midnight', '0 0 * * *', $$SELECT expire_active_matches()$$);

-- Purge old match history weekly (Sunday 1am)
SELECT cron.schedule('purge-match-history', '0 1 * * 0', $$SELECT purge_old_match_history()$$);
