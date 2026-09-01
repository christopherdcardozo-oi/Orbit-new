-- Admin panel items 10 (delete user), 13 (manual match), 14 (broadcast
-- announcement) — the three "real action" / optional items from the
-- original build plan. All three are SECURITY DEFINER RPCs that
-- hand-check admin_users authorization internally (same pattern as
-- admin_search_users in migration 038) rather than relying on RLS,
-- since these are all writes with real blast radius.

------------------------------------------------------------------
-- 10. Delete user — same cascade as delete_my_account() (migration
-- 023), parameterized by target instead of auth.uid(). Scoped to the
-- calling admin's campus access.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
    v_domain text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'not authorized';
    END IF;

    SELECT email_domain INTO v_domain FROM public.profiles WHERE id = p_user_id;
    IF v_domain IS NULL THEN
        RAISE EXCEPTION 'user not found';
    END IF;
    IF NOT public.admin_can_see_campus(v_domain) THEN
        RAISE EXCEPTION 'not authorized for this campus';
    END IF;

    -- Same order as delete_my_account: reports first (references
    -- matches + profiles without cascade), then match_history, then
    -- matches (cascades to messages/contact_reveals/match_ratings),
    -- then the auth.users row itself (cascades to profiles, which
    -- cascades to blocked_pairs).
    DELETE FROM public.reports
    WHERE reporter_id = p_user_id
       OR reported_user_id = p_user_id
       OR match_id IN (
           SELECT id FROM public.matches
           WHERE user1_id = p_user_id OR user2_id = p_user_id
       );

    DELETE FROM public.match_history
    WHERE user1_id = p_user_id OR user2_id = p_user_id;

    DELETE FROM public.matches
    WHERE user1_id = p_user_id OR user2_id = p_user_id;

    DELETE FROM auth.users WHERE id = p_user_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;

------------------------------------------------------------------
-- 13. Manual match — force an active match between two specific
-- users. Guards: both admin-visible, same campus, neither already in
-- an active match, not a blocked pair. Uses a distinct icebreaker so
-- it's obviously admin-created if anyone ever looks at match_history.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_match(p_user1_id uuid, p_user2_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
    v_domain1 text; v_domain2 text; v_timezone text;
    v_secs_since_midnight int; v_expires_at timestamptz;
    v_match_id uuid;
    v_u1 uuid; v_u2 uuid;
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
        SELECT 1 FROM public.matches
        WHERE status = 'active' AND (user1_id IN (p_user1_id, p_user2_id) OR user2_id IN (p_user1_id, p_user2_id))
    ) THEN
        RAISE EXCEPTION 'one or both users already have an active match';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.blocked_pairs
        WHERE (blocker_id = p_user1_id AND blocked_id = p_user2_id)
           OR (blocker_id = p_user2_id AND blocked_id = p_user1_id)
    ) THEN
        RAISE EXCEPTION 'these users have blocked each other';
    END IF;

    SELECT timezone INTO v_timezone FROM public.university_config WHERE email_domain = v_domain1;
    v_timezone := COALESCE(v_timezone, 'America/Chicago');
    v_secs_since_midnight := EXTRACT(HOUR FROM (now() AT TIME ZONE v_timezone))::int * 3600
                            + EXTRACT(MINUTE FROM (now() AT TIME ZONE v_timezone))::int * 60
                            + EXTRACT(SECOND FROM (now() AT TIME ZONE v_timezone))::int;
    v_expires_at := now() + ((86400 - v_secs_since_midnight) || ' seconds')::interval;

    v_u1 := LEAST(p_user1_id, p_user2_id);
    v_u2 := GREATEST(p_user1_id, p_user2_id);

    INSERT INTO public.matches (user1_id, user2_id, status, icebreaker, expires_at)
    VALUES (v_u1, v_u2, 'active', '🛠️ An admin nudged the universe your way tonight — say hi!', v_expires_at)
    RETURNING id INTO v_match_id;

    INSERT INTO public.match_history (user1_id, user2_id) VALUES (v_u1, v_u2);

    RETURN v_match_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_create_match(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_match(uuid, uuid) TO authenticated;

------------------------------------------------------------------
-- 14. Broadcast announcement — one push to every active user in
-- scope (a specific campus, or every campus the admin can see if
-- p_campus is NULL). Reuses the same enqueue_web_push/enqueue_fcm_push
-- helpers every other notification uses (migrations 026/033). Returns
-- the recipient count so the client can show "sent to N people."
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_broadcast_push(p_campus text, p_title text, p_body text)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
    r RECORD;
    v_count int := 0;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
        RAISE EXCEPTION 'not authorized';
    END IF;
    IF p_campus IS NOT NULL AND NOT public.admin_can_see_campus(p_campus) THEN
        RAISE EXCEPTION 'not authorized for this campus';
    END IF;
    IF trim(p_title) = '' OR trim(p_body) = '' THEN
        RAISE EXCEPTION 'title and body are required';
    END IF;

    FOR r IN
        SELECT p.id FROM public.profiles p
        WHERE p.is_active = true
          AND p.is_admin = false
          AND (p_campus IS NULL OR p.email_domain = p_campus)
          AND public.admin_can_see_campus(p.email_domain)
    LOOP
        PERFORM public.enqueue_web_push(r.id, p_title, p_body, '/', 'broadcast-' || extract(epoch from now())::text);
        PERFORM public.enqueue_fcm_push(r.id, p_title, p_body, '/', 'broadcast-' || extract(epoch from now())::text);
        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$fn$;
REVOKE ALL ON FUNCTION public.admin_broadcast_push(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_broadcast_push(text, text, text) TO authenticated;
