-- Two new notification catalog items (see docs/push-notifications.md):
--
--   #5 10-minute expiry warning — reverses the original "not shipping"
--      call. The in-app pulsing countdown only helps someone actually
--      viewing the chat; a push catches people who forgot they're in a
--      match and wandered off. Same one-shot-per-match dedupe pattern
--      as the existing 1-hour warning (migration 028/033).
--
--   #6 8am morning match brief — a *second*, different push from the
--      midnight "you've been paired" one. Fires each campus's local
--      8am, only for matches where nobody has sent a message yet (no
--      point nagging people already deep in conversation). Content is
--      the match's own `icebreaker` text, already generated at match
--      time by reset-matches — zero new copy-generation logic needed.

ALTER TABLE public.matches
    ADD COLUMN IF NOT EXISTS ten_min_notified_at timestamptz;

ALTER TABLE public.matches
    ADD COLUMN IF NOT EXISTS morning_brief_sent_at timestamptz;

------------------------------------------------------------------
-- #5: 10-minute expiry warning
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_ten_min_left()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE r RECORD; alias1 text; alias2 text; title1 text; title2 text; body text;
BEGIN
    body := 'Last call — say what you need to before they vanish.';
    FOR r IN
        SELECT id, user1_id, user2_id FROM public.matches
        WHERE status = 'active' AND ten_min_notified_at IS NULL
          AND expires_at BETWEEN now() + interval '9 minutes 30 seconds' AND now() + interval '10 minutes 30 seconds'
    LOOP
        SELECT display_alias INTO alias1 FROM public.profiles WHERE id = r.user1_id;
        SELECT display_alias INTO alias2 FROM public.profiles WHERE id = r.user2_id;
        title1 := '10 minutes left with ' || COALESCE(alias2, 'your match') || ' ⏰';
        title2 := '10 minutes left with ' || COALESCE(alias1, 'your match') || ' ⏰';
        PERFORM public.enqueue_web_push(r.user1_id, title1, body, '/chat/' || r.id, 'ten-min-' || r.id);
        PERFORM public.enqueue_fcm_push(r.user1_id, title1, body, '/chat/' || r.id, 'ten-min-' || r.id);
        PERFORM public.enqueue_web_push(r.user2_id, title2, body, '/chat/' || r.id, 'ten-min-' || r.id);
        PERFORM public.enqueue_fcm_push(r.user2_id, title2, body, '/chat/' || r.id, 'ten-min-' || r.id);
        UPDATE public.matches SET ten_min_notified_at = now() WHERE id = r.id;
    END LOOP;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.notify_ten_min_left() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_ten_min_left() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_ten_min_left() FROM authenticated;

DO $do$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ten-minute-warning') THEN
        PERFORM cron.unschedule('ten-minute-warning');
    END IF;
    PERFORM cron.schedule('ten-minute-warning', '* * * * *', 'SELECT public.notify_ten_min_left();');
END
$do$;

------------------------------------------------------------------
-- #6: 8am morning match brief, per campus local time
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_morning_brief()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
    uni RECORD;
    local_secs_since_midnight int;
    r RECORD;
    alias1 text; alias2 text; title text;
BEGIN
    FOR uni IN SELECT email_domain, timezone FROM public.university_config WHERE is_active LOOP
        -- Seconds since local midnight for this campus's timezone, same
        -- technique reset-matches uses client-side for its own midnight
        -- check. Firing window = the 8:00:00-8:00:59 local minute, wide
        -- enough that a once-a-minute cron tick can't miss it, narrow
        -- enough it only fires once a day.
        local_secs_since_midnight := EXTRACT(HOUR FROM (now() AT TIME ZONE uni.timezone))::int * 3600
                                    + EXTRACT(MINUTE FROM (now() AT TIME ZONE uni.timezone))::int * 60
                                    + EXTRACT(SECOND FROM (now() AT TIME ZONE uni.timezone))::int;

        IF local_secs_since_midnight < 8 * 3600 OR local_secs_since_midnight >= 8 * 3600 + 60 THEN
            CONTINUE; -- not this campus's 8am minute
        END IF;

        FOR r IN
            SELECT m.id, m.user1_id, m.user2_id, m.icebreaker
            FROM public.matches m
            JOIN public.profiles p1 ON p1.id = m.user1_id
            WHERE m.status = 'active'
              AND m.morning_brief_sent_at IS NULL
              AND p1.email_domain = uni.email_domain
              AND NOT EXISTS (SELECT 1 FROM public.messages msg WHERE msg.match_id = m.id)
        LOOP
            SELECT display_alias INTO alias1 FROM public.profiles WHERE id = r.user1_id;
            SELECT display_alias INTO alias2 FROM public.profiles WHERE id = r.user2_id;

            title := 'Your match is waiting ☀️';
            PERFORM public.enqueue_web_push(r.user1_id, title,
                'Say hi to ' || COALESCE(alias2, 'them') || ' — ' || r.icebreaker,
                '/chat/' || r.id, 'morning-' || r.id);
            PERFORM public.enqueue_fcm_push(r.user1_id, title,
                'Say hi to ' || COALESCE(alias2, 'them') || ' — ' || r.icebreaker,
                '/chat/' || r.id, 'morning-' || r.id);
            PERFORM public.enqueue_web_push(r.user2_id, title,
                'Say hi to ' || COALESCE(alias1, 'them') || ' — ' || r.icebreaker,
                '/chat/' || r.id, 'morning-' || r.id);
            PERFORM public.enqueue_fcm_push(r.user2_id, title,
                'Say hi to ' || COALESCE(alias1, 'them') || ' — ' || r.icebreaker,
                '/chat/' || r.id, 'morning-' || r.id);

            UPDATE public.matches SET morning_brief_sent_at = now() WHERE id = r.id;
        END LOOP;
    END LOOP;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.notify_morning_brief() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_morning_brief() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_morning_brief() FROM authenticated;

DO $do$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'morning-match-brief') THEN
        PERFORM cron.unschedule('morning-match-brief');
    END IF;
    PERFORM cron.schedule('morning-match-brief', '* * * * *', 'SELECT public.notify_morning_brief();');
END
$do$;
