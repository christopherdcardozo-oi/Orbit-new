-- Lobby "X active yesterday · X conversations yesterday" stat (per
-- campus, computed once a day). Deliberately landing-page-free per
-- discussion — at Orbit's current scale a raw number on the
-- pre-signup page risks over-promising; post-login it's reassurance
-- for existing users wondering if anyone else is actually here.
--
-- "Active users" = distinct people who sent at least one message that
-- day — ties the number to real engagement, not just being matched.
-- "Conversations" = distinct matches that had at least one message —
-- since every match's whole lifetime is one calendar day (created at
-- midnight, expires next midnight), a match maps 1:1 to "yesterday"
-- with no cross-day ambiguity.

CREATE TABLE IF NOT EXISTS public.campus_daily_stats (
    campus_domain text NOT NULL REFERENCES public.university_config(email_domain),
    stat_date date NOT NULL,
    active_users int NOT NULL,
    conversations int NOT NULL,
    computed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (campus_domain, stat_date)
);
ALTER TABLE public.campus_daily_stats ENABLE ROW LEVEL SECURITY;

-- Recursion-safe campus lookup (see migrations 039/040 for why this
-- has to be its own SECURITY DEFINER function rather than an inline
-- subquery on profiles inside the policy below).
CREATE OR REPLACE FUNCTION public.my_campus_domain()
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $fn$
    SELECT email_domain FROM public.profiles WHERE id = auth.uid();
$fn$;
REVOKE ALL ON FUNCTION public.my_campus_domain() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_campus_domain() TO authenticated;

CREATE POLICY "Users can view their own campus's daily stats"
    ON public.campus_daily_stats FOR SELECT TO authenticated
    USING (campus_domain = public.my_campus_domain());

-- Computed once per campus per day, ~5 minutes after that campus's
-- local midnight reset (giving the reset itself time to finish) —
-- same self-gating pattern as the 8am morning brief (migration 035):
-- runs every minute, only proceeds during each campus's own narrow
-- local-time window.
CREATE OR REPLACE FUNCTION public.compute_daily_stats_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
    uni RECORD;
    local_secs_since_midnight int;
    v_stat_date date;
    v_active_users int;
    v_conversations int;
BEGIN
    FOR uni IN SELECT email_domain, timezone FROM public.university_config WHERE is_active LOOP
        local_secs_since_midnight := EXTRACT(HOUR FROM (now() AT TIME ZONE uni.timezone))::int * 3600
                                    + EXTRACT(MINUTE FROM (now() AT TIME ZONE uni.timezone))::int * 60
                                    + EXTRACT(SECOND FROM (now() AT TIME ZONE uni.timezone))::int;

        IF local_secs_since_midnight < 5 * 60 OR local_secs_since_midnight >= 5 * 60 + 60 THEN
            CONTINUE; -- not this campus's 12:05am local minute
        END IF;

        v_stat_date := ((now() AT TIME ZONE uni.timezone)::date - 1);

        IF EXISTS (
            SELECT 1 FROM public.campus_daily_stats
            WHERE campus_domain = uni.email_domain AND stat_date = v_stat_date
        ) THEN
            CONTINUE; -- already computed today
        END IF;

        SELECT count(DISTINCT msg.sender_id), count(DISTINCT msg.match_id)
          INTO v_active_users, v_conversations
          FROM public.messages msg
          JOIN public.profiles p ON p.id = msg.sender_id
         WHERE p.email_domain = uni.email_domain
           AND (msg.created_at AT TIME ZONE uni.timezone)::date = v_stat_date;

        INSERT INTO public.campus_daily_stats (campus_domain, stat_date, active_users, conversations)
        VALUES (uni.email_domain, v_stat_date, COALESCE(v_active_users, 0), COALESCE(v_conversations, 0))
        ON CONFLICT (campus_domain, stat_date) DO NOTHING;
    END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.compute_daily_stats_tick() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_daily_stats_tick() FROM anon;
REVOKE ALL ON FUNCTION public.compute_daily_stats_tick() FROM authenticated;

DO $do$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compute-daily-stats') THEN
        PERFORM cron.unschedule('compute-daily-stats');
    END IF;
    PERFORM cron.schedule('compute-daily-stats', '* * * * *', 'SELECT public.compute_daily_stats_tick();');
END
$do$;
