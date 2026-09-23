-- 065 — Keep the original text for moderators.
--
-- 056's trigger does `NEW.content := filtered`, which destroys the
-- original. It isn't stored anywhere, and moderation_events records
-- only who and when — not what was said, or even which term matched.
--
-- That breaks the exact loop Apple asks for. Someone sends a slur,
-- their partner reports them, the admin opens the report and sees
-- "******". There's no way to tell a racial slur from a rude word, and
-- therefore no basis for "removing the content and ejecting the user
-- who provided it" within 24 hours.
--
-- So the unmasked text goes to moderation_events, which is admin-read
-- only (058-era policy: admin_can_see_user, and no SELECT for the user
-- who wrote it). The chat still shows the mask; the evidence survives
-- where only moderators can reach it.
--
-- (An earlier draft of this migration also added a severity column to
-- tier the blocklist. Dropped: ordinary profanity is now simply absent
-- from the table — see 064 — which is simpler and has the same effect.)

ALTER TABLE public.moderation_events
    ADD COLUMN IF NOT EXISTS original_content text;
ALTER TABLE public.moderation_events
    ADD COLUMN IF NOT EXISTS matched_terms text[];
ALTER TABLE public.moderation_events
    ADD COLUMN IF NOT EXISTS message_id uuid;

COMMENT ON COLUMN public.moderation_events.original_content IS
    'Unmasked message text, retained for moderator review only. The chat '
    'stores the masked version. Readable exclusively through the admin '
    'campus-scope policy on this table.';

-- Which terms a message actually hit, so a moderator sees the trigger
-- without having to scan the raw text themselves.
CREATE OR REPLACE FUNCTION public.matched_blocked_terms(p_text text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT coalesce(array_agg(t.term ORDER BY t.term), '{}')
    FROM public.blocked_terms t
    WHERE p_text ~* ('\m' || t.term || '\M');
$$;
REVOKE ALL ON FUNCTION public.matched_blocked_terms(text) FROM PUBLIC, anon, authenticated;

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
        -- Insert BEFORE overwriting, so the original survives.
        INSERT INTO public.moderation_events
            (user_id, match_id, kind, original_content, matched_terms, message_id)
        VALUES (
            NEW.sender_id,
            NEW.match_id,
            'masked_term',
            NEW.content,
            public.matched_blocked_terms(NEW.content),
            NEW.id
        );
        NEW.content := filtered;
    END IF;

    RETURN NEW;
END;
$$;

SELECT
    (SELECT count(*) FROM public.blocked_terms) AS blocked_terms,
    (SELECT count(*) FROM public.blocked_terms
      WHERE term IN ('fuck','shit','horny','ass','dick','bitch')) AS profanity_should_be_zero;
