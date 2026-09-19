-- 060 — Drop the whole-row partner SELECT policies.
--
-- ⚠️  DO NOT RUN THIS UNTIL THE CLIENT USING get_partner_profiles() IS
--     LIVE ON EVERY SURFACE YOU CARE ABOUT.
--
-- Migration 059 added the replacement function and deliberately left
-- these policies in place, so older builds keep working. This is the
-- other half. Applying it early does not error — it quietly degrades:
-- any build that still selects from `profiles` directly gets zero rows
-- back and renders every partner as "Mystery Connection", in the lobby
-- and in the chat header. That includes whatever is in store review.
--
-- Safe to run once:
--   * the new build is released (not merely uploaded), and
--   * you're willing to let anyone on an older build see the degraded
--     state, or you've forced an update via lib/versionCheck.ts.
--
-- What it closes: 016 and 021 granted a match partner SELECT on the
-- entire profiles row, including gender / custom_gender (never shown to
-- a match), flagged, is_active, is_admin, admin_campuses, email_domain,
-- safety_ack_at, and active_match_id — which leaks, in real time,
-- whether the other person currently has your chat open.

DROP POLICY IF EXISTS "Users can view their active match partner's profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view recent past match partner's profile" ON public.profiles;

-- Proof: only the own-profile and admin SELECT policies should remain.
SELECT policyname
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT'
ORDER BY policyname;
