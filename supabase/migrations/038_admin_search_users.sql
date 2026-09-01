-- User-lookup search for the admin panel. Needs to match on email,
-- which lives in auth.users — not directly queryable from the client
-- even for admins (no RLS-friendly view exposes it). SECURITY DEFINER
-- lets this function read auth.users, but since that bypasses RLS
-- entirely, authorization is hand-checked inside the function body
-- (not delegated to a policy) before it touches anything.

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
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin) THEN
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

REVOKE ALL ON FUNCTION public.admin_search_users(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, text) TO authenticated;
