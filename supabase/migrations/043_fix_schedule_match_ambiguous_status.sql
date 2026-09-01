-- Fix "column reference status is ambiguous" — admin_schedule_match's
-- RETURNS TABLE(status text, match_id uuid) declares an OUT parameter
-- named `status`, which PL/pgSQL treats as an in-scope variable for the
-- whole function body. The busy-check query's bare `WHERE status =
-- 'active'` couldn't tell that from public.matches.status. Fixed by
-- aliasing the table and qualifying the reference.

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
        SELECT 1 FROM public.matches m
        WHERE m.status = 'active' AND (m.user1_id IN (p_user1_id, p_user2_id) OR m.user2_id IN (p_user1_id, p_user2_id))
    ) INTO v_either_busy;

    IF NOT v_either_busy THEN
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
        INSERT INTO public.scheduled_matches (user1_id, user2_id, requested_by)
        VALUES (v_u1, v_u2, auth.uid())
        ON CONFLICT (user1_id, user2_id) WHERE fulfilled_at IS NULL DO NOTHING;

        RETURN QUERY SELECT 'scheduled'::text, NULL::uuid;
    END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_schedule_match(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_schedule_match(uuid, uuid) TO authenticated;
