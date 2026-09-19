-- 056 — Server-side objectionable-content filter on messages.
--
-- App Store Review Guideline 1.2 requires four things of a UGC app
-- where strangers talk to each other:
--   a) a method for filtering objectionable content   <-- the gap
--   b) a mechanism to report offensive content        <-- have it
--   c) the ability to block abusive users             <-- have it
--   d) a published commitment to act within 24 hours  <-- have it
--      (orghubs.com/apps/orbit/terms)
--
-- (a) was the only one missing. The sole text inspection in the app was
-- detectPii() in app/chat/[id].tsx, which the code itself describes as
-- "a nudge, not a filter" — the user can always send anyway.
--
-- Deliberately MASKS rather than rejects. Rejecting would need the
-- client to surface the error, and doSend() currently just restores the
-- text with no explanation, so a rejected message would vanish silently.
-- Masking means the insert always succeeds and the filter applies to
-- builds that are already shipped, including the ones in review right
-- now. No app update required.

CREATE TABLE IF NOT EXISTS public.blocked_terms (
    term       text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- Word characters only. The term is interpolated into a regex below,
    -- so this constraint is what keeps that safe.
    CONSTRAINT blocked_terms_wordlike CHECK (term ~ '^[A-Za-z0-9]+$')
);

-- Never client-readable: publishing the blocklist just teaches people
-- what to type around.
ALTER TABLE public.blocked_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.blocked_terms FROM anon, authenticated;

-- Audit trail so a repeat offender is visible to admins even when no
-- one reports them.
CREATE TABLE IF NOT EXISTS public.moderation_events (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    match_id   uuid REFERENCES public.matches(id) ON DELETE CASCADE,
    kind       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.moderation_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_events FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS moderation_events_user_created_idx
    ON public.moderation_events (user_id, created_at DESC);

DROP POLICY IF EXISTS "Admins can view moderation events in scope" ON public.moderation_events;
CREATE POLICY "Admins can view moderation events in scope"
    ON public.moderation_events FOR SELECT
    TO authenticated
    USING (public.admin_can_see_user(user_id));
GRANT SELECT ON public.moderation_events TO authenticated;

CREATE OR REPLACE FUNCTION public.mask_blocked_terms(p_text text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    t         record;
    out_text  text := p_text;
BEGIN
    IF p_text IS NULL OR p_text = '' THEN
        RETURN p_text;
    END IF;

    FOR t IN SELECT term FROM public.blocked_terms LOOP
        -- \m and \M are Postgres word boundaries, so "ass" can't hit
        -- "assignment" or "class". Case-insensitive.
        out_text := regexp_replace(
            out_text,
            '\m' || t.term || '\M',
            repeat('*', length(t.term)),
            'gi'
        );
    END LOOP;

    RETURN out_text;
END;
$$;

CREATE OR REPLACE FUNCTION public.filter_message_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    filtered text;
BEGIN
    filtered := public.mask_blocked_terms(NEW.content);

    IF filtered IS DISTINCT FROM NEW.content THEN
        NEW.content := filtered;
        INSERT INTO public.moderation_events (user_id, match_id, kind)
        VALUES (NEW.sender_id, NEW.match_id, 'masked_term');
    END IF;

    RETURN NEW;
END;
$$;

-- BEFORE INSERT so the masked text is what gets stored, realtime-
-- broadcast and pushed. Ordering vs. the existing AFTER INSERT push
-- trigger is therefore correct without touching it.
DROP TRIGGER IF EXISTS messages_filter_content ON public.messages;
CREATE TRIGGER messages_filter_content
    BEFORE INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.filter_message_content();

-- Starter list: unambiguous profanity only. Slurs are deliberately not
-- enumerated here — load a maintained list instead, e.g.
-- github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words
-- which ships one file per language and matches this schema:
--   INSERT INTO public.blocked_terms (term)
--   SELECT lower(t) FROM unnest($1::text[]) AS t
--   WHERE t ~ '^[A-Za-z0-9]+$'
--   ON CONFLICT DO NOTHING;
INSERT INTO public.blocked_terms (term) VALUES
    ('fuck'), ('fucking'), ('fucker'), ('motherfucker'),
    ('shit'), ('bullshit'), ('cunt'), ('bitch'), ('whore'), ('slut'),
    ('dick'), ('cock'), ('pussy'), ('bastard'), ('asshole'), ('douchebag'),
    ('rape'), ('rapist'), ('molest'), ('pedo'), ('pedophile')
ON CONFLICT DO NOTHING;
