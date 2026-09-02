-- Stops the "every message pings me even though I'm staring at the
-- chat right now" push. The client (chat/[id].tsx) now keeps
-- profiles.active_match_id in sync with whichever chat is actually
-- on-screen AND foregrounded (cleared on background/hidden, so a
-- backgrounded app still gets notified normally) — the message push
-- trigger skips the recipient when they're already looking at that
-- exact match. Realtime still delivers the message to their open
-- chat screen the normal way (postgres_changes on messages); this
-- only suppresses the redundant push notification.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active_match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL;

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
    recipient_active_match uuid;
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

    SELECT active_match_id INTO recipient_active_match FROM public.profiles WHERE id = recipient_id;
    IF recipient_active_match = NEW.match_id THEN
        RETURN NEW; -- they're already looking at this exact chat
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
    PERFORM public.enqueue_fcm_push(
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
