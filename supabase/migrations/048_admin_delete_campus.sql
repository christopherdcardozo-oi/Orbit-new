-- Lets a global admin remove a campus from the admin panel, guarded
-- against deleting one that still has real users on it — a campus
-- with zero profiles is safe to remove outright (no matches/messages/
-- reports/feedback/scheduled_matches can exist without a profile
-- pointing at that domain, since every one of those tables keys off
-- profile ids, not the domain directly). admin_allowlist and
-- campus_daily_stats are the only tables with a real FK on
-- university_config.email_domain (migration 046's investigation),
-- so those are the only child rows that need clearing first.

CREATE OR REPLACE FUNCTION public.admin_delete_campus(p_domain text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
    v_user_count int;
BEGIN
    IF NOT public.is_global_admin() THEN
        RAISE EXCEPTION 'not authorized';
    END IF;

    SELECT count(*) INTO v_user_count FROM public.profiles WHERE email_domain = p_domain;
    IF v_user_count > 0 THEN
        RAISE EXCEPTION 'campus still has % user(s) — cannot delete', v_user_count;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.university_config WHERE email_domain = p_domain) THEN
        RAISE EXCEPTION 'campus not found';
    END IF;

    DELETE FROM public.admin_allowlist WHERE campus_email_domain = p_domain;
    DELETE FROM public.campus_daily_stats WHERE campus_domain = p_domain;
    DELETE FROM public.university_config WHERE email_domain = p_domain;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_delete_campus(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_campus(text) TO authenticated;
