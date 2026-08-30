-- Second-pass security fixes surfaced by Supabase's advisor after migration
-- 008 unblocked the RLS-critical items. None of these are apocalyptic on
-- their own, but each one is worth closing.
--
-- Includes formal definitions for `check_email_exists` and `delete_my_account`
-- which were previously live in the DB but had no migration file (schema
-- drift). Idempotent — CREATE OR REPLACE just re-writes the current
-- definitions with the tightened attributes.

-- Skipped: moving pg_net out of public. It doesn't support ALTER EXTENSION
-- SET SCHEMA; the only way to move it is DROP + CREATE, which would drop
-- the background worker and any queued net.http_post calls. Not worth the
-- risk for one WARN advisory. Accept pg_net lives in public.

-- 1. Revoke direct client execution of internal-only SECURITY DEFINER
--    functions. Triggers, cron, and the service role are unaffected; anyone
--    calling /rest/v1/rpc/<name> as anon or authenticated now gets 403.
REVOKE EXECUTE ON FUNCTION public.expire_active_matches()
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.purge_old_match_history()
    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()
    FROM PUBLIC, anon, authenticated;

-- 3. Pin search_path on every SECURITY DEFINER function so a malicious
--    schema-creator can't hijack unqualified table references. We also
--    fully qualify the table names inside each body — belt and suspenders.
--    (Migration 003 originally defined these; this REPLACE preserves the
--     signatures but adds the search_path guard and schema prefixes.)

CREATE OR REPLACE FUNCTION public.expire_active_matches()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.matches
    SET status = 'expired'
    WHERE status = 'active';
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_old_match_history()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM public.match_history
    WHERE matched_at < CURRENT_DATE - INTERVAL '30 days';
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_email_domain TEXT;
    anon_alias        TEXT;
BEGIN
    user_email_domain := split_part(NEW.email, '@', 2);

    IF user_email_domain NOT LIKE '%.edu' THEN
        RAISE EXCEPTION 'Only .edu emails are allowed';
    END IF;

    anon_alias := 'Anon' || substr(md5(random()::text), 1, 8);

    INSERT INTO public.profiles (id, email_domain, display_alias)
    VALUES (NEW.id, user_email_domain, anon_alias);

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_edu_email_before_signup(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_email TEXT;
BEGIN
    user_email := event->>'email';

    IF user_email IS NULL OR user_email NOT LIKE '%.edu' THEN
        RAISE EXCEPTION 'Only .edu emails are allowed for sign up';
    END IF;

    RETURN event;
END;
$$;

-- 4. Formalize the two ad-hoc functions that existed in the DB but not in
--    migrations. Same behavior, plus search_path guard and revoke of
--    execute for roles that shouldn't call them.

CREATE OR REPLACE FUNCTION public.check_email_exists(email_to_check text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- NOTE: This is an enumeration surface. An attacker can call
    --   /rest/v1/rpc/check_email_exists?email=<probe>
    -- to learn which .edu addresses have accounts. Kept accessible to anon
    -- for signup UX; consider rate-limiting or removing later.
    RETURN EXISTS (
        SELECT 1 FROM auth.users WHERE email = email_to_check
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;

-- delete_my_account uses auth.uid() — must be authenticated-only. Anon
-- would just delete zero rows (uid is NULL), but shouldn't be exposed.
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
