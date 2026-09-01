-- Event-driven contact-reveal refresh via Supabase Realtime "Broadcast
-- from Database", replacing the raw-table postgres_changes subscription
-- the chat screen used to rely on.
--
-- Root cause of the reported bug (confirmed by live reproduction): the
-- client's `postgres_changes` subscription on the contact_reveals table
-- can silently go stale — WebSocket idles out, phone locks, brief
-- network blip — with no visible error and no redelivery of the missed
-- change. Whoever shared FIRST and is just sitting there waiting is the
-- one most likely to be idle long enough to hit this; whoever reciprocates
-- second has a freshly-active connection (they just tapped Share) so they
-- see it fine. Matches exactly what was reported: one side worked, the
-- other needed to leave and re-enter the chat to see the reveal.
--
-- Fix: reuse the SAME reciprocity check the push-notification trigger
-- (migration 018/033) already does — "does the partner already have a
-- row of this handle_type?" — and when true, ALSO broadcast a small
-- 'reveal' event on a per-match private channel. No polling: this only
-- fires the instant a real reciprocal share happens, exactly once, and
-- does nothing on every other insert (first share, non-matching types).
--
-- Client side (apps/mobile/app/chat/[id].tsx) subscribes to a private
-- `match:{id}` channel and refetches reveals when this event arrives —
-- see that file's contact-reveals effect. The existing focus/visibility
-- refetch stays in place as a backstop for the rare case where the
-- socket is truly dead at the moment of the broadcast too (no delivery
-- mechanism over a dead socket can avoid that — the backstop is what
-- self-heals it the next time the app is looked at).

-- RLS: match participants (and only match participants) may subscribe
-- to their own match's reveal broadcasts. realtime.messages is the
-- table Supabase Realtime checks against for private-channel
-- authorization; this policy is evaluated per Realtime's docs pattern
-- for "Allow a user to join (and read) a Broadcast topic."
DROP POLICY IF EXISTS "match participants can receive reveal broadcasts" ON "realtime"."messages";
CREATE POLICY "match participants can receive reveal broadcasts"
    ON "realtime"."messages"
    FOR SELECT
    TO authenticated
    USING (
        realtime.messages.extension = 'broadcast'
        AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE 'match:' || m.id::text = (SELECT realtime.topic())
              AND (auth.uid() = m.user1_id OR auth.uid() = m.user2_id)
        )
    );

-- Extend the existing reciprocity-check trigger to also broadcast.
CREATE OR REPLACE FUNCTION public.notify_contact_reveal_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE match_row public.matches%ROWTYPE; partner_id uuid; partner_has_matching_type boolean; my_alias text; partner_alias text;
        body_to_me text; body_to_partner text; title text; tag text;
BEGIN
    SELECT * INTO match_row FROM public.matches WHERE id = NEW.match_id;
    IF NOT FOUND OR match_row.status <> 'active' THEN RETURN NEW; END IF;
    IF NEW.user_id = match_row.user1_id THEN partner_id := match_row.user2_id;
    ELSIF NEW.user_id = match_row.user2_id THEN partner_id := match_row.user1_id;
    ELSE RETURN NEW; END IF;
    SELECT EXISTS (SELECT 1 FROM public.contact_reveals WHERE match_id = NEW.match_id AND user_id = partner_id AND handle_type = NEW.handle_type) INTO partner_has_matching_type;
    IF NOT partner_has_matching_type THEN RETURN NEW; END IF;

    -- Event-driven screen refresh — fires ONLY here, i.e. only once
    -- reciprocity is actually confirmed. Both participants' open chat
    -- screens (if any) pick this up via their `match:{id}` subscription.
    PERFORM realtime.send(
        jsonb_build_object('handle_type', NEW.handle_type, 'match_id', NEW.match_id),
        'reveal',
        'match:' || NEW.match_id,
        true
    );

    SELECT display_alias INTO my_alias FROM public.profiles WHERE id = NEW.user_id;
    SELECT display_alias INTO partner_alias FROM public.profiles WHERE id = partner_id;
    title := 'Contact unlocked ✨';
    body_to_me := 'You and ' || COALESCE(partner_alias, 'your match') || ' both shared your ' || NEW.handle_type || '. Tap to see it.';
    body_to_partner := 'You and ' || COALESCE(my_alias, 'your match') || ' both shared your ' || NEW.handle_type || '. Tap to see it.';
    tag := 'reveal-' || NEW.match_id || '-' || NEW.handle_type;
    PERFORM public.enqueue_web_push(NEW.user_id, title, body_to_me, '/chat/' || NEW.match_id, tag);
    PERFORM public.enqueue_fcm_push(NEW.user_id, title, body_to_me, '/chat/' || NEW.match_id, tag);
    PERFORM public.enqueue_web_push(partner_id, title, body_to_partner, '/chat/' || NEW.match_id, tag);
    PERFORM public.enqueue_fcm_push(partner_id, title, body_to_partner, '/chat/' || NEW.match_id, tag);
    RETURN NEW;
END;
$fn$;
