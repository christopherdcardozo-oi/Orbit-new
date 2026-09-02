-- Lets a global admin edit a campus's email domain from the panel.
-- university_config.email_domain is effectively the campus's primary
-- key — admin_allowlist and campus_daily_stats have real FK
-- constraints on it (NO ACTION, not deferrable), and profiles.email_domain
-- matches it by convention without a formal FK. A plain UPDATE on the PK
-- would get rejected by the FK constraints the moment child rows still
-- point at the old value, so this does the standard swap: insert a new
-- parent row, repoint every dependent row, then drop the old parent —
-- never a moment where a child row references a domain that doesn't exist.

CREATE OR REPLACE FUNCTION public.admin_rename_campus_domain(p_old_domain text, p_new_domain text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
    v_name text; v_tz text; v_active boolean;
BEGIN
    IF NOT public.is_global_admin() THEN
        RAISE EXCEPTION 'not authorized';
    END IF;
    IF p_old_domain = p_new_domain THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM public.university_config WHERE email_domain = p_new_domain) THEN
        RAISE EXCEPTION 'a campus with that domain already exists';
    END IF;

    SELECT university_name, timezone, is_active INTO v_name, v_tz, v_active
      FROM public.university_config WHERE email_domain = p_old_domain;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'campus not found';
    END IF;

    INSERT INTO public.university_config (email_domain, university_name, timezone, is_active)
    VALUES (p_new_domain, v_name, v_tz, v_active);

    UPDATE public.profiles SET email_domain = p_new_domain WHERE email_domain = p_old_domain;
    UPDATE public.admin_allowlist SET campus_email_domain = p_new_domain WHERE campus_email_domain = p_old_domain;
    UPDATE public.campus_daily_stats SET campus_domain = p_new_domain WHERE campus_domain = p_old_domain;

    DELETE FROM public.university_config WHERE email_domain = p_old_domain;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_rename_campus_domain(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_rename_campus_domain(text, text) TO authenticated;
