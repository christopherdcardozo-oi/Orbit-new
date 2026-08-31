-- Contact reveals v2: multi-type + per-type reciprocity.
--
-- Before this migration each user could share exactly one handle per
-- match. Now they can share as many types as they want (Instagram AND
-- Snap AND Email …), and each type is only revealed to the OTHER user
-- when THEY have also shared THAT SPECIFIC TYPE. Types the partner has
-- shared but you haven't are visible as "hint" metadata (type + owner,
-- no value) so the UI can prompt you to share the matching type — the
-- value itself stays hidden until you reciprocate.
--
-- Enforcement is at the database level so a determined caller hitting
-- the raw API can't bypass the reciprocity check:
--   * Direct SELECT on the table returns only handles whose type the
--     caller has also shared (plus the caller's own rows).
--   * The metadata for hints (which types partner shared, no values)
--     comes from a dedicated SECURITY DEFINER function that returns a
--     controlled shape (value nulled where not reciprocated), so the
--     client can render prompts without seeing hidden values.

-- 1. Uniqueness: was one row per (match, user); now one per (match,
--    user, type) so multiple types per user are allowed but you can't
--    have two Instagrams.
ALTER TABLE public.contact_reveals
    DROP CONSTRAINT IF EXISTS contact_reveals_match_id_user_id_key;
ALTER TABLE public.contact_reveals
    ADD CONSTRAINT contact_reveals_uniq_per_type
    UNIQUE (match_id, user_id, handle_type);

-- 2. Tighten the SELECT policy from "any of my own reveals unlocks all
--    of theirs" to per-type reciprocity: only see a partner's handle
--    for a specific type if you've shared that same type yourself.
DROP POLICY IF EXISTS "Users can read reveals on their match once both sides opted in"
    ON public.contact_reveals;

CREATE POLICY "Users can read own reveals + partner reveals of shared types"
    ON public.contact_reveals FOR SELECT TO authenticated
    USING (
        -- You can always read your own rows.
        user_id = auth.uid()
        OR (
            -- You can read the partner's row only if:
            --   (a) it's a match you're in, AND
            --   (b) you've shared the same handle_type on this match.
            EXISTS (
                SELECT 1 FROM public.matches m
                WHERE m.id = contact_reveals.match_id
                  AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
            )
            AND EXISTS (
                SELECT 1 FROM public.contact_reveals mine
                WHERE mine.match_id = contact_reveals.match_id
                  AND mine.user_id = auth.uid()
                  AND mine.handle_type = contact_reveals.handle_type
            )
        )
    );

-- 3. RPC for the client: returns every reveal on the match with the
--    value nulled where the caller hasn't reciprocated that type. The
--    client uses this to render the "you've also got an Instagram to
--    unlock" hints — the SELECT above blocks reading those values
--    directly, this function is the only way to know that metadata
--    without seeing the value.
CREATE OR REPLACE FUNCTION public.get_reveals_for_match(p_match_id uuid)
RETURNS TABLE (
    user_id uuid,
    handle_type text,
    handle_value text,
    revealed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    -- Anonymous callers get nothing.
    IF v_uid IS NULL THEN
        RETURN;
    END IF;

    -- Ensure the caller is actually part of the match — nobody else
    -- should learn anything about a match they're not in.
    IF NOT EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = p_match_id
          AND (m.user1_id = v_uid OR m.user2_id = v_uid)
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT
        r.user_id,
        r.handle_type,
        CASE
            WHEN r.user_id = v_uid THEN r.handle_value
            WHEN EXISTS (
                SELECT 1 FROM public.contact_reveals mine
                WHERE mine.match_id = p_match_id
                  AND mine.user_id = v_uid
                  AND mine.handle_type = r.handle_type
            ) THEN r.handle_value
            ELSE NULL
        END AS handle_value,
        CASE
            WHEN r.user_id = v_uid THEN true
            WHEN EXISTS (
                SELECT 1 FROM public.contact_reveals mine
                WHERE mine.match_id = p_match_id
                  AND mine.user_id = v_uid
                  AND mine.handle_type = r.handle_type
            ) THEN true
            ELSE false
        END AS revealed
    FROM public.contact_reveals r
    WHERE r.match_id = p_match_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_reveals_for_match(uuid) TO authenticated;
