-- Schedule the daily matchmaking edge function via pg_cron + pg_net.
--
-- Runs at 00:00:30 UTC — 30 seconds after the pg_cron `expire-matches-midnight`
-- job in 004_pg_cron.sql, giving that job time to flip active matches to
-- expired. The edge function itself also calls expire_active_matches() so the
-- ordering is safety, not correctness: the second call is a no-op.
--
-- Prerequisites (one-time, done manually — this migration assumes them):
--   1. The `pg_net` extension is enabled on the project (Database → Extensions).
--   2. Two Vault secrets exist:
--        supabase_url       — https://<project_ref>.functions.supabase.co
--        cron_secret        — same value as the CRON_SECRET env var on the
--                             `reset-matches` edge function
--      We read them via vault.decrypted_secrets so we never inline them here.
--   3. The `reset-matches` edge function is deployed (with verify_jwt=false).

CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
    'run-matchmaking',
    '30 0 * * *',
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
