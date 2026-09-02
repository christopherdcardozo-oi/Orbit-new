-- Lobby stat: show the campus's all-time total message count instead
-- of just yesterday's — a running number that only grows looks like
-- real traction, where yesterday's raw count reads small and noisy
-- day to day. "Active yesterday" stays as-is; this only changes the
-- second half of the pill.

ALTER TABLE public.campus_daily_stats ADD COLUMN IF NOT EXISTS total_messages int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.compute_daily_stats_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
    uni RECORD;
    local_secs_since_midnight int;
    v_stat_date date;
    v_active_users int;
    v_messages int;
    v_total_messages int;
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

        SELECT count(DISTINCT msg.sender_id), count(*)
          INTO v_active_users, v_messages
          FROM public.messages msg
          JOIN public.profiles p ON p.id = msg.sender_id
         WHERE p.email_domain = uni.email_domain
           AND (msg.created_at AT TIME ZONE uni.timezone)::date = v_stat_date;

        -- All-time total, not scoped to yesterday.
        SELECT count(*) INTO v_total_messages
          FROM public.messages msg
          JOIN public.profiles p ON p.id = msg.sender_id
         WHERE p.email_domain = uni.email_domain;

        INSERT INTO public.campus_daily_stats (campus_domain, stat_date, active_users, messages, total_messages)
        VALUES (uni.email_domain, v_stat_date, COALESCE(v_active_users, 0), COALESCE(v_messages, 0), COALESCE(v_total_messages, 0))
        ON CONFLICT (campus_domain, stat_date) DO NOTHING;
    END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.compute_daily_stats_tick() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.compute_daily_stats_tick() FROM anon;
REVOKE ALL ON FUNCTION public.compute_daily_stats_tick() FROM authenticated;

-- Backfill so the already-computed rows (today's, from before this
-- migration) reflect the live total right away instead of waiting for
-- tomorrow's tick.
UPDATE public.campus_daily_stats s
   SET total_messages = (
        SELECT count(*) FROM public.messages msg
        JOIN public.profiles p ON p.id = msg.sender_id
       WHERE p.email_domain = s.campus_domain
   );
