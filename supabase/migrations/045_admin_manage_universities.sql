-- Lets admins add new campuses and toggle is_active from the admin
-- panel instead of SQL. Scoped to GLOBAL admins only (admin_campuses
-- IS NULL) — adding/removing an entire campus is a platform-level
-- decision, not something a single-campus moderator should be able to
-- do even once that role exists.

CREATE OR REPLACE FUNCTION public.is_global_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM public.admin_users WHERE user_id = auth.uid() AND admin_campuses IS NULL
    );
$fn$;
REVOKE ALL ON FUNCTION public.is_global_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_global_admin() TO authenticated;

CREATE POLICY "Global admins can add campuses"
    ON public.university_config FOR INSERT TO authenticated
    WITH CHECK (public.is_global_admin());

CREATE POLICY "Global admins can edit campuses"
    ON public.university_config FOR UPDATE TO authenticated
    USING (public.is_global_admin())
    WITH CHECK (public.is_global_admin());
