-- 059 — Stop handing a match partner your entire profile row.
--
-- Migrations 016 and 021 grant a match partner (current, and recent-past
-- within 48h) SELECT on `profiles` — the WHOLE row. RLS can't restrict
-- columns, so the partner could read every field, not just the ones the
-- UI shows: gender / custom_gender (which the app never displays to a
-- match), flagged, is_active, is_admin, admin_campuses, email_domain,
-- safety_ack_at, and active_match_id — the last of which reveals in real
-- time whether the other person currently has your chat open.
--
-- The client only ever wanted display fields:
--   app/chat/[id].tsx     display_alias, avatar, major, year_in_school,
--                         personality, hobbies, activities
--   app/(app)/index.tsx   display_alias, avatar   (active match)
--   app/(app)/index.tsx   display_alias           (rateable past matches)
--
-- So: one SECURITY DEFINER function returning exactly those, membership
-- checked inside, and the two broad policies dropped. Takes an array so
-- the rating list can resolve several partners in one call.
--
-- SEQUENCING — this migration is ADDITIVE ONLY and safe to apply now.
-- It creates the function and nothing else. The old policies stay, so
-- the builds currently in App Store / Play review (which select from
-- profiles directly) keep working.
--
-- Migration 060 drops those policies. Do NOT run it until the build
-- containing the matching client change is actually live, or every
-- partner name in the lobby and the chat header turns into
-- "Mystery Connection" for anyone on an older build — including a
-- reviewer.

CREATE OR REPLACE FUNCTION public.get_partner_profiles(p_match_ids uuid[])
RETURNS TABLE (
    match_id       uuid,
    partner_id     uuid,
    display_alias  text,
    avatar         text,
    major          text,
    year_in_school text,
    personality    text[],
    hobbies        text[],
    activities     text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT
        m.id,
        p.id,
        p.display_alias,
        p.avatar,
        p.major,
        p.year_in_school,
        p.personality,
        p.hobbies,
        p.activities
    FROM public.matches m
    JOIN public.profiles p
      ON p.id = CASE WHEN m.user1_id = (SELECT auth.uid())
                     THEN m.user2_id ELSE m.user1_id END
    WHERE m.id = ANY(p_match_ids)
      -- Membership check: without this, any match id would resolve.
      AND ((SELECT auth.uid()) IN (m.user1_id, m.user2_id))
      -- Same window the dropped policies allowed: the live match, plus
      -- recently-expired ones so the rating cards still have a name.
      AND (m.status = 'active' OR m.expires_at >= now() - interval '48 hours');
$$;

REVOKE ALL ON FUNCTION public.get_partner_profiles(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_partner_profiles(uuid[]) TO authenticated;
