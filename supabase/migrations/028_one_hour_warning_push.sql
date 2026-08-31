-- 1-hour-before-expiry push notification (catalog item #4).

ALTER TABLE public.matches
    ADD COLUMN IF NOT EXISTS one_hr_notified_at timestamptz;

CREATE OR REPLACE FUNCTION public.notify_one_hour_left()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    r RECORD;
    alias1 text;
    alias2 text;
BEGIN
    FOR r IN
        SELECT id, user1_id, user2_id
        FROM public.matches
        WHERE status = 'active'
          AND one_hr_notified_at IS NULL
          AND expires_at BETWEEN now() + interval '59 minutes 30 seconds'
                             AND now() + interval '60 minutes 30 seconds'
    LOOP
        SELECT display_alias INTO alias1 FROM public.profiles WHERE id = r.user1_id;
        SELECT display_alias INTO alias2 FROM public.profiles WHERE id = r.user2_id;

        PERFORM public.enqueue_web_push(
            r.user1_id,
            '1 hour left with ' || COALESCE(alias2, 'your match') || ' ⏳',
            'They vanish at midnight. Come say goodbye — or say what you were going to say.',
            '/chat/' || r.id,
            'one-hr-' || r.id
        );
        PERFORM public.enqueue_web_push(
            r.user2_id,
            '1 hour left with ' || COALESCE(alias1, 'your match') || ' ⏳',
            'They vanish at midnight. Come say goodbye — or say what you were going to say.',
            '/chat/' || r.id,
            'one-hr-' || r.id
        );

        UPDATE public.matches SET one_hr_notified_at = now() WHERE id = r.id;
    END LOOP;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.notify_one_hour_left() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_one_hour_left() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_one_hour_left() FROM authenticated;

-- Schedule (drop-and-recreate for idempotency).
DO $do$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'one-hour-warning') THEN
        PERFORM cron.unschedule('one-hour-warning');
    END IF;
    PERFORM cron.schedule('one-hour-warning', '* * * * *', 'SELECT public.notify_one_hour_left();');
END
$do$;
