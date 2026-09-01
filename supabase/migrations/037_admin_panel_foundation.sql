-- Foundation for the in-app admin panel (/admin route).
--
-- Multi-tenant admin model, decided in conversation:
--   - profiles.is_admin (migration 034) stays exactly as-is: excludes
--     the account from matching, globally.
--   - New profiles.admin_campuses text[] scopes what an admin CAN SEE
--     in the panel: NULL = every campus ("god mode" — Sunil/Christopher
--     today), a real array = only those campus domains. Lets us add a
--     campus-scoped student moderator later with zero schema changes —
--     just set their admin_campuses to a one-element array.
--   - is_admin=false with admin_campuses set means nothing; the column
--     only matters once is_admin is true.
--
-- Also:
--   - reports.resolved_at / resolved_by — lightweight triage state.
--   - New public.feedback table — the Feedback modal has only ever
--     emailed via Resend (send-feedback edge function), nothing was
--     persisted. Added here so the admin feedback inbox has something
--     to read; send-feedback is updated separately to insert here too.
--   - profiles.flagged — a soft "keep an eye on this account" marker,
--     independent of is_active (still matches normally) or is_admin.

------------------------------------------------------------------
-- profiles: admin scope + moderation flag
------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS admin_campuses text[];

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS flagged boolean NOT NULL DEFAULT false;

------------------------------------------------------------------
-- reports: triage state
------------------------------------------------------------------
ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.profiles(id);

------------------------------------------------------------------
-- feedback table (new)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- ON DELETE SET NULL, not CASCADE — keep the feedback text/category
    -- around for admin history even if the account is later deleted.
    user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    category text NOT NULL CHECK (category IN (
        'bug', 'feature-request', 'ui-ux', 'matching-quality',
        'safety-abuse-report', 'account-help', 'other'
    )),
    message text NOT NULL,
    resolved_at timestamptz,
    resolved_by uuid REFERENCES public.profiles(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON public.feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_user_id_idx ON public.feedback(user_id);
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- No general SELECT/INSERT policy for regular users — this table is
-- written exclusively by the send-feedback edge function using the
-- service-role key (bypasses RLS entirely), and read exclusively by
-- admins (policy below). A user has no reason to query their own past
-- feedback inside the app.

------------------------------------------------------------------
-- Admin-scope helper functions
------------------------------------------------------------------
-- SECURITY DEFINER so it can read profiles.is_admin/admin_campuses for
-- the CALLING user without that read itself needing a profiles RLS
-- policy that references admin state — avoids the same self-recursion
-- class of bug fixed in migration 020 for contact_reveals.

CREATE OR REPLACE FUNCTION public.admin_scope()
RETURNS TABLE(is_admin boolean, admin_campuses text[])
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $fn$
    SELECT p.is_admin, p.admin_campuses
    FROM public.profiles p
    WHERE p.id = auth.uid();
$fn$;
REVOKE ALL ON FUNCTION public.admin_scope() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_scope() TO authenticated;

-- True if the calling user is an admin who can see the given campus
-- (NULL admin_campuses = every campus). Used directly inside RLS
-- policies below.
CREATE OR REPLACE FUNCTION public.admin_can_see_campus(p_domain text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $fn$
    SELECT COALESCE(
        (SELECT p.is_admin AND (p.admin_campuses IS NULL OR p_domain = ANY(p.admin_campuses))
         FROM public.profiles p WHERE p.id = auth.uid()),
        false
    );
$fn$;
REVOKE ALL ON FUNCTION public.admin_can_see_campus(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_can_see_campus(text) TO authenticated;

------------------------------------------------------------------
-- RLS: admin read access
------------------------------------------------------------------

-- profiles: admins can read any profile within their campus scope.
DROP POLICY IF EXISTS "Admins can view profiles in their campus scope" ON public.profiles;
CREATE POLICY "Admins can view profiles in their campus scope"
    ON public.profiles FOR SELECT TO authenticated
    USING (public.admin_can_see_campus(email_domain));

-- profiles: admins can update flagged / is_active within scope. The
-- existing prevent_immutable_profile_columns trigger (migration 023)
-- still blocks email_domain/display_alias changes regardless of who's
-- writing, so this can't be used to move someone's campus.
DROP POLICY IF EXISTS "Admins can moderate profiles in their campus scope" ON public.profiles;
CREATE POLICY "Admins can moderate profiles in their campus scope"
    ON public.profiles FOR UPDATE TO authenticated
    USING (public.admin_can_see_campus(email_domain))
    WITH CHECK (public.admin_can_see_campus(email_domain));

-- matches: admins can read matches within their campus scope (both
-- users on a match always share a campus — the matchmaker never pairs
-- across campuses — so checking user1's domain is sufficient).
DROP POLICY IF EXISTS "Admins can view matches in their campus scope" ON public.matches;
CREATE POLICY "Admins can view matches in their campus scope"
    ON public.matches FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = matches.user1_id
              AND public.admin_can_see_campus(p.email_domain)
        )
    );

-- messages: admins can read messages within their campus scope, via
-- the parent match's participants.
DROP POLICY IF EXISTS "Admins can view messages in their campus scope" ON public.messages;
CREATE POLICY "Admins can view messages in their campus scope"
    ON public.messages FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            JOIN public.profiles p ON p.id = m.user1_id
            WHERE m.id = messages.match_id
              AND public.admin_can_see_campus(p.email_domain)
        )
    );

-- reports: admins can read + resolve reports within scope (via the
-- reported user's campus).
DROP POLICY IF EXISTS "Admins can view reports in their campus scope" ON public.reports;
CREATE POLICY "Admins can view reports in their campus scope"
    ON public.reports FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = reports.reported_user_id
              AND public.admin_can_see_campus(p.email_domain)
        )
    );

DROP POLICY IF EXISTS "Admins can resolve reports in their campus scope" ON public.reports;
CREATE POLICY "Admins can resolve reports in their campus scope"
    ON public.reports FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = reports.reported_user_id
              AND public.admin_can_see_campus(p.email_domain)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = reports.reported_user_id
              AND public.admin_can_see_campus(p.email_domain)
        )
    );

-- feedback: admins can read + resolve feedback within scope.
DROP POLICY IF EXISTS "Admins can view feedback in their campus scope" ON public.feedback;
CREATE POLICY "Admins can view feedback in their campus scope"
    ON public.feedback FOR SELECT TO authenticated
    USING (
        user_id IS NULL
        OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = feedback.user_id
              AND public.admin_can_see_campus(p.email_domain)
        )
    );

DROP POLICY IF EXISTS "Admins can resolve feedback in their campus scope" ON public.feedback;
CREATE POLICY "Admins can resolve feedback in their campus scope"
    ON public.feedback FOR UPDATE TO authenticated
    USING (
        user_id IS NULL
        OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = feedback.user_id
              AND public.admin_can_see_campus(p.email_domain)
        )
    )
    WITH CHECK (
        user_id IS NULL
        OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = feedback.user_id
              AND public.admin_can_see_campus(p.email_domain)
        )
    );

------------------------------------------------------------------
-- Sunil + Christopher: explicit god-mode (admin_campuses left NULL,
-- which the helper functions above already treat as "every campus" —
-- this UPDATE is just making that the recorded, intentional state
-- rather than an incidental default).
------------------------------------------------------------------
UPDATE public.profiles SET admin_campuses = NULL WHERE is_admin = true;
