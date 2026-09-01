-- "Schedule Match" — admin picks two people; if both are currently
-- free (no active match), pair them right now, same as before. If
-- either is already in an active match, queue the pairing instead of
-- failing outright — it gets fulfilled automatically at that campus's
-- next midnight reset, ahead of the normal matchmaking algorithm.

CREATE TABLE IF NOT EXISTS public.scheduled_matches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    user2_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    requested_by uuid REFERENCES public.profiles(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    fulfilled_at timestamptz,
    CHECK (user1_id < user2_id)
);
-- Only one pending (unfulfilled) schedule per pair at a time.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_matches_pending_pair_idx
    ON public.scheduled_matches (user1_id, user2_id) WHERE fulfilled_at IS NULL;
ALTER TABLE public.scheduled_matches ENABLE ROW LEVEL SECURITY;
-- No policies — service role (reset-matches) and SECURITY DEFINER
-- functions only, same access model as admin_users.

CREATE OR REPLACE FUNCTION public.admin_schedule_match(p_user1_id uuid, p_user2_id uuid)
RETURNS TABLE(status text, match_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
    v_domain1 text; v_domain2 text; v_timezone text;
    v_secs_since_midnight int; v_expires_at timestamptz;
    v_match_id uuid;
    v_u1 uuid; v_u2 uuid;
    v_either_busy boolean;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'not authorized';
    END IF;
    IF p_user1_id = p_user2_id THEN
        RAISE EXCEPTION 'cannot match a user with themselves';
    END IF;

    SELECT email_domain INTO v_domain1 FROM public.profiles WHERE id = p_user1_id;
    SELECT email_domain INTO v_domain2 FROM public.profiles WHERE id = p_user2_id;
    IF v_domain1 IS NULL OR v_domain2 IS NULL THEN
        RAISE EXCEPTION 'one or both users not found';
    END IF;
    IF v_domain1 <> v_domain2 THEN
        RAISE EXCEPTION 'users are on different campuses';
    END IF;
    IF NOT public.admin_can_see_campus(v_domain1) THEN
        RAISE EXCEPTION 'not authorized for this campus';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.blocked_pairs
        WHERE (blocker_id = p_user1_id AND blocked_id = p_user2_id)
           OR (blocker_id = p_user2_id AND blocked_id = p_user1_id)
    ) THEN
        RAISE EXCEPTION 'these users have blocked each other';
    END IF;

    v_u1 := LEAST(p_user1_id, p_user2_id);
    v_u2 := GREATEST(p_user1_id, p_user2_id);

    SELECT EXISTS (
        SELECT 1 FROM public.matches
        WHERE status = 'active' AND (user1_id IN (p_user1_id, p_user2_id) OR user2_id IN (p_user1_id, p_user2_id))
    ) INTO v_either_busy;

    IF NOT v_either_busy THEN
        -- Both free — pair them right now, same as the old admin_create_match.
        SELECT timezone INTO v_timezone FROM public.university_config WHERE email_domain = v_domain1;
        v_timezone := COALESCE(v_timezone, 'America/Chicago');
        v_secs_since_midnight := EXTRACT(HOUR FROM (now() AT TIME ZONE v_timezone))::int * 3600
                                + EXTRACT(MINUTE FROM (now() AT TIME ZONE v_timezone))::int * 60
                                + EXTRACT(SECOND FROM (now() AT TIME ZONE v_timezone))::int;
        v_expires_at := now() + ((86400 - v_secs_since_midnight) || ' seconds')::interval;

        INSERT INTO public.matches (user1_id, user2_id, status, icebreaker, expires_at)
        VALUES (v_u1, v_u2, 'active', '🛠️ An admin nudged the universe your way tonight — say hi!', v_expires_at)
        RETURNING id INTO v_match_id;

        INSERT INTO public.match_history (user1_id, user2_id) VALUES (v_u1, v_u2);

        RETURN QUERY SELECT 'immediate'::text, v_match_id;
    ELSE
        -- Someone's busy — queue it for the next reset instead of failing.
        INSERT INTO public.scheduled_matches (user1_id, user2_id, requested_by)
        VALUES (v_u1, v_u2, auth.uid())
        ON CONFLICT (user1_id, user2_id) WHERE fulfilled_at IS NULL DO NOTHING;

        RETURN QUERY SELECT 'scheduled'::text, NULL::uuid;
    END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_schedule_match(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_schedule_match(uuid, uuid) TO authenticated;

-- Superseded by admin_schedule_match. The only caller was today's new
-- admin/tools.tsx, updated in the same change — safe to drop outright.
DROP FUNCTION IF EXISTS public.admin_create_match(uuid, uuid);
