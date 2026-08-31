-- Fires the reset-matches edge function's top-up path the instant a user
-- finishes onboarding, so mid-day signups don't have to wait for any
-- polling interval. Tied to `personality` transitioning from empty to
-- populated — the last step of the signup wizard (app/(auth)/signup.tsx's
-- handleSavePersonality) — rather than raw profile creation, so nobody
-- gets matched on a still-blank profile (no major/hobbies/personality)
-- before they've finished telling us anything about themselves.
--
-- pg_net's http_post is async/queued — this does not block or slow down
-- the UPDATE that triggers it.

CREATE OR REPLACE FUNCTION public.notify_new_profile_for_matching()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.is_active THEN
        PERFORM net.http_post(
            url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
                   || '/reset-matches',
            headers := jsonb_build_object(
                'Authorization',
                'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
                'Content-Type',
                'application/json'
            ),
            body := jsonb_build_object('mode', 'topup', 'domain', NEW.email_domain)
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_onboarding_complete
    AFTER UPDATE OF personality ON public.profiles
    FOR EACH ROW
    WHEN (
        (OLD.personality IS NULL OR array_length(OLD.personality, 1) IS NULL)
        AND NEW.personality IS NOT NULL AND array_length(NEW.personality, 1) > 0
    )
    EXECUTE FUNCTION public.notify_new_profile_for_matching();
