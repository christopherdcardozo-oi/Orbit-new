-- Device push tokens for native iOS + Android builds. Multi-device
-- per user (phone + tablet + laptop all valid). Server sends via
-- FCM V1 API — Firebase relays iOS via the APNs auth key uploaded
-- in the Firebase console.
--
-- Existing profiles.fcm_token column stays (unused going forward,
-- was misused as an Expo push token) — safe to drop later.
--
-- Also introduces enqueue_fcm_push helper, and wires it in beside
-- enqueue_web_push in the four existing push triggers so both
-- browsers AND native devices get every notification.

CREATE TABLE IF NOT EXISTS public.device_push_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    token text not null,
    platform text not null check (platform in ('ios', 'android')),
    created_at timestamptz not null default now(),
    -- One row per (device, token) globally — a token uniquely
    -- identifies an install. Re-registration upserts on the token.
    unique (token)
);

CREATE INDEX IF NOT EXISTS device_push_tokens_user_id_idx
    ON public.device_push_tokens(user_id);

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can register their own device token"
    ON public.device_push_tokens FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can see their own device tokens"
    ON public.device_push_tokens FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Users can update their own device tokens"
    ON public.device_push_tokens FOR UPDATE TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own device tokens"
    ON public.device_push_tokens FOR DELETE TO authenticated
    USING (user_id = auth.uid());

------------------------------------------------------------------
-- enqueue_fcm_push: mirror of enqueue_web_push, posts to a new
-- send-fcm-push edge function which fans out to every FCM token
-- for the user via FCM V1 API.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_fcm_push(
    p_user_id uuid, p_title text, p_body text, p_url text, p_tag text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/functions/v1/send-fcm-push',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
            'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
            'user_id', p_user_id, 'title', p_title, 'body', p_body,
            'url', p_url, 'tag', p_tag
        )
    );
END;
$fn$;
REVOKE EXECUTE ON FUNCTION public.enqueue_fcm_push(uuid, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_fcm_push(uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_fcm_push(uuid, text, text, text, text) FROM authenticated;

------------------------------------------------------------------
-- Update the four existing push-firing functions to also call FCM
-- alongside web push. Web browsers get web-push (VAPID); native
-- devices get FCM V1. Both call sites run for every event.
------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_new_match_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE alias1 text; alias2 text; title1 text; title2 text; body1 text; body2 text;
BEGIN
    IF NEW.status <> 'active' THEN RETURN NEW; END IF;
    SELECT display_alias INTO alias1 FROM public.profiles WHERE id = NEW.user1_id;
    SELECT display_alias INTO alias2 FROM public.profiles WHERE id = NEW.user2_id;
    title1 := 'New match on Orbit 🌠';
    body1 := 'You''ve been paired with ' || COALESCE(alias2, 'someone') || '. Chat before midnight — they vanish at 12:00.';
    title2 := 'New match on Orbit 🌠';
    body2 := 'You''ve been paired with ' || COALESCE(alias1, 'someone') || '. Chat before midnight — they vanish at 12:00.';
    PERFORM public.enqueue_web_push(NEW.user1_id, title1, body1, '/chat/' || NEW.id, 'match-' || NEW.id);
    PERFORM public.enqueue_fcm_push(NEW.user1_id, title1, body1, '/chat/' || NEW.id, 'match-' || NEW.id);
    PERFORM public.enqueue_web_push(NEW.user2_id, title2, body2, '/chat/' || NEW.id, 'match-' || NEW.id);
    PERFORM public.enqueue_fcm_push(NEW.user2_id, title2, body2, '/chat/' || NEW.id, 'match-' || NEW.id);
    RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.notify_new_message_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE match_row public.matches%ROWTYPE; recipient_id uuid; sender_alias text; preview text;
BEGIN
    SELECT * INTO match_row FROM public.matches WHERE id = NEW.match_id;
    IF NOT FOUND OR match_row.status <> 'active' THEN RETURN NEW; END IF;
    IF NEW.sender_id = match_row.user1_id THEN recipient_id := match_row.user2_id;
    ELSIF NEW.sender_id = match_row.user2_id THEN recipient_id := match_row.user1_id;
    ELSE RETURN NEW; END IF;
    SELECT display_alias INTO sender_alias FROM public.profiles WHERE id = NEW.sender_id;
    preview := CASE WHEN char_length(NEW.content) > 60 THEN substring(NEW.content, 1, 60) || '…' ELSE NEW.content END;
    PERFORM public.enqueue_web_push(recipient_id, COALESCE(sender_alias, 'New message'), preview, '/chat/' || NEW.match_id, 'msg-' || NEW.match_id);
    PERFORM public.enqueue_fcm_push(recipient_id, COALESCE(sender_alias, 'New message'), preview, '/chat/' || NEW.match_id, 'msg-' || NEW.match_id);
    RETURN NEW;
END;
$fn$;

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

CREATE OR REPLACE FUNCTION public.notify_one_hour_left()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE r RECORD; alias1 text; alias2 text; title1 text; title2 text; body text;
BEGIN
    body := 'They vanish at midnight. Come say goodbye — or say what you were going to say.';
    FOR r IN
        SELECT id, user1_id, user2_id FROM public.matches
        WHERE status = 'active' AND one_hr_notified_at IS NULL
          AND expires_at BETWEEN now() + interval '59 minutes 30 seconds' AND now() + interval '60 minutes 30 seconds'
    LOOP
        SELECT display_alias INTO alias1 FROM public.profiles WHERE id = r.user1_id;
        SELECT display_alias INTO alias2 FROM public.profiles WHERE id = r.user2_id;
        title1 := '1 hour left with ' || COALESCE(alias2, 'your match') || ' ⏳';
        title2 := '1 hour left with ' || COALESCE(alias1, 'your match') || ' ⏳';
        PERFORM public.enqueue_web_push(r.user1_id, title1, body, '/chat/' || r.id, 'one-hr-' || r.id);
        PERFORM public.enqueue_fcm_push(r.user1_id, title1, body, '/chat/' || r.id, 'one-hr-' || r.id);
        PERFORM public.enqueue_web_push(r.user2_id, title2, body, '/chat/' || r.id, 'one-hr-' || r.id);
        PERFORM public.enqueue_fcm_push(r.user2_id, title2, body, '/chat/' || r.id, 'one-hr-' || r.id);
        UPDATE public.matches SET one_hr_notified_at = now() WHERE id = r.id;
    END LOOP;
END;
$fn$;
