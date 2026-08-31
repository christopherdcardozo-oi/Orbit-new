-- Two launch-blocker fixes bundled together.
--
-- 1. Delete Account was broken for any user who had ever been matched.
--    `delete_my_account()` was just DELETE FROM auth.users, which
--    cascades to profiles fine but not to matches / match_history /
--    reports — none of those had ON DELETE CASCADE on their user-id
--    foreign keys. First matched user to tap Delete hit a FK violation
--    and the deletion silently failed. This directly contradicts the
--    "Delete Account removes it, deletion is irreversible" promise in
--    the Privacy Policy.
--
-- 2. The profiles UPDATE policy only checked `id = auth.uid()` —
--    nothing at row-level or column-level stopped a signed-in user
--    from PATCHing their own `email_domain` to another active campus
--    and getting matched with people there, bypassing the whole
--    "verify a real .edu email at your school" flow. Same shape of
--    exposure for display_alias (which is auto-generated as a stable
--    identity people trust in-chat).

------------------------------------------------------------------
-- Delete Account: cascade explicitly, in dependency order
------------------------------------------------------------------
-- Anything FK'd to matches with ON DELETE CASCADE (messages,
-- contact_reveals, match_ratings) gets swept when we delete matches.
-- Anything FK'd to profiles with ON DELETE CASCADE (blocked_pairs) gets
-- swept when auth.users -> profiles cascades. Everything else has to
-- be explicit here, in the right order (reports first because it
-- references matches without cascade; then match_history and matches).

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- reports references matches AND profiles, both without cascade —
    -- clean up first so the FK on matches doesn't block their deletion.
    DELETE FROM public.reports
    WHERE reporter_id = v_uid
       OR reported_user_id = v_uid
       OR match_id IN (
           SELECT id FROM public.matches
           WHERE user1_id = v_uid OR user2_id = v_uid
       );

    DELETE FROM public.match_history
    WHERE user1_id = v_uid OR user2_id = v_uid;

    -- matches has ON DELETE CASCADE for messages, contact_reveals,
    -- match_ratings via match_id — those three go with it.
    DELETE FROM public.matches
    WHERE user1_id = v_uid OR user2_id = v_uid;

    -- Finally the account itself. FK profiles.id -> auth.users(id) has
    -- ON DELETE CASCADE, so profiles goes with it. blocked_pairs FKs
    -- to profiles with CASCADE, so those go too.
    DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

-- Keep the same signed-in-only grant as before.
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

------------------------------------------------------------------
-- Lock down email_domain and display_alias from client updates
------------------------------------------------------------------
-- PostgREST doesn't cleanly expose column-level GRANTs through its
-- update path, and even if it did we'd want a hard database-level
-- guarantee. A BEFORE UPDATE trigger that raises on any change to
-- these two columns does both.

CREATE OR REPLACE FUNCTION public.prevent_immutable_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Service role (backend, migrations) can change anything.
    IF (SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF NEW.email_domain IS DISTINCT FROM OLD.email_domain THEN
        RAISE EXCEPTION 'email_domain cannot be changed after signup';
    END IF;

    IF NEW.display_alias IS DISTINCT FROM OLD.display_alias THEN
        RAISE EXCEPTION 'display_alias cannot be changed';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_immutable_columns ON public.profiles;
CREATE TRIGGER profiles_prevent_immutable_columns
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_immutable_profile_columns();
