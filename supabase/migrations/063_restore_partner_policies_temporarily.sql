-- 063 — TEMPORARY revert of 060.
--
-- 060 dropped the whole-row partner SELECT policies. Its precondition
-- was that every shipped client had moved to get_partner_profiles()
-- (059). That wasn't true when it ran on 2026-09-23:
--
--   * Web was fine — Vercel auto-deploys from main, so the live bundle
--     already had the new client.
--   * The Play PRODUCTION track held versionCode 11, a pre-fix build
--     sitting in Google review. It still selects partner rows from
--     `profiles` directly, so it got zero rows back and rendered every
--     partner as "Mystery Connection" in the lobby and the chat header
--     — while a reviewer was potentially looking at it.
--
-- So the policies come back until the new build is actually the one in
-- production. This re-opens the over-exposure described in 060 (a
-- partner can read the whole profiles row, including gender, moderation
-- flags and active_match_id) — accepted knowingly, and briefly, because
-- a visibly broken app in store review is the worse problem.
--
-- Difference from the originals: auth.uid() is wrapped in a scalar
-- subquery. Behaviourally identical, and it clears the auth_rls_initplan
-- advisor warning these two policies were previously flagged for.
--
-- TO FINISH THE JOB: once versionCode >= 15 is live on Play and iOS
-- build >= 12 is released, re-run 060 to drop these again.

DROP POLICY IF EXISTS "Users can view their active match partner's profile" ON public.profiles;
CREATE POLICY "Users can view their active match partner's profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.status = 'active'::public.match_status
              AND (
                    (m.user1_id = (SELECT auth.uid()) AND m.user2_id = profiles.id)
                 OR (m.user2_id = (SELECT auth.uid()) AND m.user1_id = profiles.id)
              )
        )
    );

DROP POLICY IF EXISTS "Users can view recent past match partner's profile" ON public.profiles;
CREATE POLICY "Users can view recent past match partner's profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.status <> 'active'::public.match_status
              AND m.expires_at >= now() - interval '48 hours'
              AND (
                    (m.user1_id = (SELECT auth.uid()) AND m.user2_id = profiles.id)
                 OR (m.user2_id = (SELECT auth.uid()) AND m.user1_id = profiles.id)
              )
        )
    );

-- Proof: back to four SELECT policies on profiles.
SELECT count(*) AS should_be_four, string_agg(policyname, ' | ' ORDER BY policyname) AS policies
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT';
