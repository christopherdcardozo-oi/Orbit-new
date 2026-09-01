-- Second fix for the same recursion bug (039 was necessary but not
-- sufficient). Root cause, found by directly testing RLS in SQL with
-- policies dropped one at a time: it's CROSS-TABLE recursion, not
-- profiles self-reference.
--
-- The matches/messages/reports/feedback admin policies each embedded a
-- raw, un-wrapped `EXISTS (SELECT 1 FROM public.profiles p WHERE ...)`
-- directly in their USING clause. That SELECT FROM profiles is a normal
-- query — NOT inside a SECURITY DEFINER function — so it's fully
-- subject to profiles' own RLS, including "Users can view recent past
-- match partner's profile" (migration 021), whose own USING clause
-- queries `matches`. That query on matches is itself subject to
-- matches' RLS, including the admin policy that queries profiles
-- again: profiles → matches → profiles → matches → ... infinite.
--
-- Fix, matching the ALREADY-WORKING i_have_reveal_of_type pattern
-- (migration 020) exactly: the ENTIRE profiles-touching lookup has to
-- live INSIDE a SECURITY DEFINER function body, not partially inlined
-- into the policy expression. A SECURITY DEFINER function's internal
-- queries run as the function owner (postgres, a superuser) and skip
-- RLS entirely — but only for queries that are actually inside the
-- function; a query merely CALLING such a function from within a
-- larger inline SELECT doesn't inherit that bypass for the inline part.

CREATE OR REPLACE FUNCTION public.admin_can_see_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $fn$
    SELECT public.admin_can_see_campus(
        (SELECT email_domain FROM public.profiles WHERE id = p_user_id)
    );
$fn$;
REVOKE ALL ON FUNCTION public.admin_can_see_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_can_see_user(uuid) TO authenticated;

-- profiles: these two were fine (no subquery into profiles — they
-- reference the CURRENT row's own email_domain column directly, not a
-- nested SELECT), but got dropped during isolation testing — restore.
DROP POLICY IF EXISTS "Admins can view profiles in their campus scope" ON public.profiles;
CREATE POLICY "Admins can view profiles in their campus scope"
    ON public.profiles FOR SELECT TO authenticated
    USING (public.admin_can_see_campus(email_domain));

DROP POLICY IF EXISTS "Admins can moderate profiles in their campus scope" ON public.profiles;
CREATE POLICY "Admins can moderate profiles in their campus scope"
    ON public.profiles FOR UPDATE TO authenticated
    USING (public.admin_can_see_campus(email_domain))
    WITH CHECK (public.admin_can_see_campus(email_domain));

-- matches / messages / reports / feedback: swap the inline
-- EXISTS-subquery-into-profiles for the wrapped, recursion-safe function.
DROP POLICY IF EXISTS "Admins can view matches in their campus scope" ON public.matches;
CREATE POLICY "Admins can view matches in their campus scope"
    ON public.matches FOR SELECT TO authenticated
    USING (public.admin_can_see_user(matches.user1_id));

DROP POLICY IF EXISTS "Admins can view messages in their campus scope" ON public.messages;
CREATE POLICY "Admins can view messages in their campus scope"
    ON public.messages FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = messages.match_id
              AND public.admin_can_see_user(m.user1_id)
        )
    );

DROP POLICY IF EXISTS "Admins can view reports in their campus scope" ON public.reports;
CREATE POLICY "Admins can view reports in their campus scope"
    ON public.reports FOR SELECT TO authenticated
    USING (public.admin_can_see_user(reports.reported_user_id));

DROP POLICY IF EXISTS "Admins can resolve reports in their campus scope" ON public.reports;
CREATE POLICY "Admins can resolve reports in their campus scope"
    ON public.reports FOR UPDATE TO authenticated
    USING (public.admin_can_see_user(reports.reported_user_id))
    WITH CHECK (public.admin_can_see_user(reports.reported_user_id));

DROP POLICY IF EXISTS "Admins can view feedback in their campus scope" ON public.feedback;
CREATE POLICY "Admins can view feedback in their campus scope"
    ON public.feedback FOR SELECT TO authenticated
    USING (feedback.user_id IS NULL OR public.admin_can_see_user(feedback.user_id));

DROP POLICY IF EXISTS "Admins can resolve feedback in their campus scope" ON public.feedback;
CREATE POLICY "Admins can resolve feedback in their campus scope"
    ON public.feedback FOR UPDATE TO authenticated
    USING (feedback.user_id IS NULL OR public.admin_can_see_user(feedback.user_id))
    WITH CHECK (feedback.user_id IS NULL OR public.admin_can_see_user(feedback.user_id));
