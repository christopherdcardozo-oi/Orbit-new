-- URGENT FIX: migration 037's admin_can_see_campus()/admin_scope()
-- queried public.profiles from inside a SECURITY DEFINER function that
-- is itself called FROM a profiles RLS policy — a direct self-reference
-- Postgres's RLS planner refuses to resolve (42P17 "infinite recursion
-- detected in policy for relation profiles"), regardless of
-- SECURITY DEFINER. Confirmed live: this broke EVERY read of the
-- profiles table, including a user fetching their own row, the moment
-- migration 037 landed.
--
-- Fix: move admin authorization data out of profiles entirely, into a
-- dedicated public.admin_users table with NO RLS policies referencing
-- itself (in fact no policies at all — it's reachable only through
-- SECURITY DEFINER functions, never granted directly to authenticated/
-- anon). profiles.is_admin / admin_campuses stay exactly as they were
-- for everything that already depended on them (handle_new_user,
-- reset-matches' matching-pool exclusion, the Settings "Admin" row) —
-- those are all either reads of your OWN row (satisfied by the
-- pre-existing "own profile" policy, untouched by any of this) or
-- service-role reads (bypass RLS entirely, always have). A trigger
-- keeps admin_users in sync automatically whenever profiles.is_admin
-- or admin_campuses changes, so there's exactly one place (profiles)
-- an admin is ever actually granted from.

CREATE TABLE IF NOT EXISTS public.admin_users (
    user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    admin_campuses text[],
    created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS enabled, zero policies, zero grants to authenticated/anon —
-- reachable only via SECURITY DEFINER functions below. That's the
-- actual recursion fix: this table's own RLS never references itself
-- (no policies at all to recurse through), unlike profiles.
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- Backfill from the current profiles.is_admin state.
INSERT INTO public.admin_users (user_id, admin_campuses)
SELECT id, admin_campuses FROM public.profiles WHERE is_admin = true
ON CONFLICT (user_id) DO UPDATE SET admin_campuses = EXCLUDED.admin_campuses;

-- Keep it in sync going forward — profiles.is_admin/admin_campuses
-- stays the single place an admin is actually granted or revoked.
CREATE OR REPLACE FUNCTION public.sync_admin_users()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
    IF NEW.is_admin THEN
        INSERT INTO public.admin_users (user_id, admin_campuses)
        VALUES (NEW.id, NEW.admin_campuses)
        ON CONFLICT (user_id) DO UPDATE SET admin_campuses = EXCLUDED.admin_campuses;
    ELSE
        DELETE FROM public.admin_users WHERE user_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS profiles_sync_admin_users ON public.profiles;
CREATE TRIGGER profiles_sync_admin_users
    AFTER INSERT OR UPDATE OF is_admin, admin_campuses ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.sync_admin_users();

-- Rewrite the two scope-check functions to read admin_users, not
-- profiles — this is the actual fix.
CREATE OR REPLACE FUNCTION public.admin_scope()
RETURNS TABLE(is_admin boolean, admin_campuses text[])
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $fn$
    SELECT
        EXISTS(SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()),
        (SELECT a.admin_campuses FROM public.admin_users a WHERE a.user_id = auth.uid());
$fn$;
REVOKE ALL ON FUNCTION public.admin_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_scope() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_can_see_campus(p_domain text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $fn$
    SELECT COALESCE(
        (SELECT (a.admin_campuses IS NULL OR p_domain = ANY(a.admin_campuses))
         FROM public.admin_users a WHERE a.user_id = auth.uid()),
        false
    );
$fn$;
REVOKE ALL ON FUNCTION public.admin_can_see_campus(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_can_see_campus(text) TO authenticated;

-- admin_search_users' authorization guard — same source of truth swap.
CREATE OR REPLACE FUNCTION public.admin_search_users(p_query text DEFAULT NULL, p_campus text DEFAULT NULL)
RETURNS TABLE(
    id uuid,
    email text,
    display_alias text,
    email_domain text,
    is_active boolean,
    is_admin boolean,
    flagged boolean,
    created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'not authorized';
    END IF;

    RETURN QUERY
    SELECT p.id, u.email::text, p.display_alias, p.email_domain, p.is_active, p.is_admin, p.flagged, p.created_at
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE public.admin_can_see_campus(p.email_domain)
      AND (p_campus IS NULL OR p.email_domain = p_campus)
      AND (
          p_query IS NULL OR p_query = ''
          OR p.display_alias ILIKE '%' || p_query || '%'
          OR u.email ILIKE '%' || p_query || '%'
      )
    ORDER BY p.created_at DESC
    LIMIT 50;
END;
$fn$;
