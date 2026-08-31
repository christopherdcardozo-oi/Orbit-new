-- Fires web pushes for the three V1-catalog notifications:
--   1. New match       — trigger on matches INSERT, one push per user
--                        in the pair
--   2. New message     — trigger on messages INSERT, push to the
--                        recipient (never the sender)
--   3. Contact reveal  — trigger on contact_reveals INSERT, but ONLY
--                        push when the other user has already shared
--                        the same handle_type (reciprocal moment).
--                        Push both users in that case.
--
-- Delivery: each trigger calls the send-web-push edge function via
-- net.http_post. Same pattern as notify_new_profile_for_matching's
-- topup call — shared secret in the Authorization header.
--
-- Copy exactly matches docs/push-notifications.md. Do not drift.

-- Small helper: post a push payload to send-web-push.
CREATE OR REPLACE FUNCTION public.enqueue_web_push(
    p_user_id uuid,
    p_title text,
    p_body text,
    p_url text,
    p_tag text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/functions/v1/send-web-push',
        headers := jsonb_build_object(
            'Authorization',
            'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
            'Content-Type',
            'application/json'
        ),
        body := jsonb_build_object(
            'user_id', p_user_id,
            'title', p_title,
            'body', p_body,
            'url', p_url,
            'tag', p_tag
        )
    );
END;
$$;

-- Only the internal triggers should ever call this.
REVOKE EXECUTE ON FUNCTION public.enqueue_web_push(uuid, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_web_push(uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_web_push(uuid, text, text, text, text) FROM authenticated;

------------------------------------------------------------------
-- 1. New match  →  push both users
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_new_match_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    alias1 text;
    alias2 text;
BEGIN
    IF NEW.status <> 'active' THEN RETURN NEW; END IF;

    SELECT display_alias INTO alias1 FROM public.profiles WHERE id = NEW.user1_id;
    SELECT display_alias INTO alias2 FROM public.profiles WHERE id = NEW.user2_id;

    PERFORM public.enqueue_web_push(
        NEW.user1_id,
        'New match on Orbit 🌠',
        'You''ve been paired with ' || COALESCE(alias2, 'someone') ||
            '. Chat before midnight — they vanish at 12:00.',
        '/chat/' || NEW.id,
        'match-' || NEW.id
    );
    PERFORM public.enqueue_web_push(
        NEW.user2_id,
        'New match on Orbit 🌠',
        'You''ve been paired with ' || COALESCE(alias1, 'someone') ||
            '. Chat before midnight — they vanish at 12:00.',
        '/chat/' || NEW.id,
        'match-' || NEW.id
    );
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_new_match_push() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_new_match_push() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_new_match_push() FROM authenticated;

DROP TRIGGER IF EXISTS on_match_insert_push ON public.matches;
CREATE TRIGGER on_match_insert_push
    AFTER INSERT ON public.matches
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_new_match_push();

------------------------------------------------------------------
-- 2. New message  →  push the recipient
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_new_message_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    match_row public.matches%ROWTYPE;
    recipient_id uuid;
    sender_alias text;
    preview text;
BEGIN
    SELECT * INTO match_row FROM public.matches WHERE id = NEW.match_id;
    IF NOT FOUND OR match_row.status <> 'active' THEN RETURN NEW; END IF;

    IF NEW.sender_id = match_row.user1_id THEN
        recipient_id := match_row.user2_id;
    ELSIF NEW.sender_id = match_row.user2_id THEN
        recipient_id := match_row.user1_id;
    ELSE
        RETURN NEW; -- sender isn't part of this match; shouldn't happen
    END IF;

    SELECT display_alias INTO sender_alias FROM public.profiles WHERE id = NEW.sender_id;
    -- Trim message preview to 60 chars + ellipsis if longer.
    preview := CASE
        WHEN char_length(NEW.content) > 60 THEN substring(NEW.content, 1, 60) || '…'
        ELSE NEW.content
    END;

    PERFORM public.enqueue_web_push(
        recipient_id,
        COALESCE(sender_alias, 'New message'),
        preview,
        '/chat/' || NEW.match_id,
        'msg-' || NEW.match_id
    );
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_new_message_push() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_new_message_push() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_new_message_push() FROM authenticated;

DROP TRIGGER IF EXISTS on_message_insert_push ON public.messages;
CREATE TRIGGER on_message_insert_push
    AFTER INSERT ON public.messages
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_new_message_push();

------------------------------------------------------------------
-- 3. Contact reveal reciprocated  →  push both users, once
------------------------------------------------------------------
-- Only fires on the SECOND insert (the reciprocal one) — check if
-- the partner already has a row for this match + this handle_type.
CREATE OR REPLACE FUNCTION public.notify_contact_reveal_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    match_row public.matches%ROWTYPE;
    partner_id uuid;
    partner_has_matching_type boolean;
    my_alias text;
    partner_alias text;
BEGIN
    SELECT * INTO match_row FROM public.matches WHERE id = NEW.match_id;
    IF NOT FOUND OR match_row.status <> 'active' THEN RETURN NEW; END IF;

    IF NEW.user_id = match_row.user1_id THEN
        partner_id := match_row.user2_id;
    ELSIF NEW.user_id = match_row.user2_id THEN
        partner_id := match_row.user1_id;
    ELSE
        RETURN NEW;
    END IF;

    -- Reciprocity check: does the partner ALREADY have a reveal of
    -- this same handle_type on this match?
    SELECT EXISTS (
        SELECT 1 FROM public.contact_reveals
        WHERE match_id = NEW.match_id
          AND user_id = partner_id
          AND handle_type = NEW.handle_type
    ) INTO partner_has_matching_type;

    IF NOT partner_has_matching_type THEN RETURN NEW; END IF;

    SELECT display_alias INTO my_alias FROM public.profiles WHERE id = NEW.user_id;
    SELECT display_alias INTO partner_alias FROM public.profiles WHERE id = partner_id;

    -- Notify the person who just triggered the reciprocity (they now
    -- see the partner's unlocked handle) and the partner (they see
    -- the caller's handle unlocked).
    PERFORM public.enqueue_web_push(
        NEW.user_id,
        'Contact unlocked ✨',
        'You and ' || COALESCE(partner_alias, 'your match') ||
            ' both shared your ' || NEW.handle_type || '. Tap to see it.',
        '/chat/' || NEW.match_id,
        'reveal-' || NEW.match_id || '-' || NEW.handle_type
    );
    PERFORM public.enqueue_web_push(
        partner_id,
        'Contact unlocked ✨',
        'You and ' || COALESCE(my_alias, 'your match') ||
            ' both shared your ' || NEW.handle_type || '. Tap to see it.',
        '/chat/' || NEW.match_id,
        'reveal-' || NEW.match_id || '-' || NEW.handle_type
    );
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_contact_reveal_push() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_contact_reveal_push() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_contact_reveal_push() FROM authenticated;

DROP TRIGGER IF EXISTS on_contact_reveal_insert_push ON public.contact_reveals;
CREATE TRIGGER on_contact_reveal_insert_push
    AFTER INSERT ON public.contact_reveals
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_contact_reveal_push();
