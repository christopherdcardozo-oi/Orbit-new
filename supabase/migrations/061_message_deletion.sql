-- 061 — Let a user remove their own message.
--
-- App Store rejection, guideline 1.2 (2026-09-23). Apple's checklist
-- asks for "a mechanism for users to immediately remove posts from the
-- feed". Orbit has no feed — it's a 1:1 ephemeral chat — so the
-- equivalent is letting the author take their own message back. Nothing
-- in the app could delete anything before this.
--
-- Soft delete, not a row delete, for two reasons:
--   * Apple also requires acting on reports within 24 hours. If a user
--     can hard-delete the abusive message the moment they're reported,
--     the evidence goes with it. Admins keep reading the original
--     content through the existing campus-scope SELECT policy.
--   * The partner's client learns about it through the UPDATE realtime
--     event it already subscribes to. A DELETE would need new plumbing.
--
-- Column grants alone aren't enough here. Migration 055 narrowed the
-- UPDATE grant to read_at, and the existing "mark partner messages as
-- read" policy deliberately allows updating the OTHER person's rows.
-- Adding deleted_at to that grant would therefore let either party
-- delete either party's messages, so the trigger below pins deletion to
-- the author.

ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- The author may update their own row (for deleted_at; the column grant
-- is what stops this from reaching `content`).
DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
CREATE POLICY "Users can delete their own messages"
    ON public.messages FOR UPDATE
    TO authenticated
    USING (
        sender_id = (SELECT auth.uid())
        AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = messages.match_id
              AND (SELECT auth.uid()) IN (m.user1_id, m.user2_id)
        )
    )
    WITH CHECK (sender_id = (SELECT auth.uid()));

GRANT UPDATE (read_at, deleted_at) ON public.messages TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_message_update_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Only the author may set or clear deleted_at. Without this, the
    -- read-receipt policy (which intentionally targets the partner's
    -- rows) plus the deleted_at grant would let someone delete their
    -- partner's messages.
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       AND OLD.sender_id <> (SELECT auth.uid()) THEN
        RAISE EXCEPTION 'you can only delete your own messages';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_enforce_update ON public.messages;
CREATE TRIGGER messages_enforce_update
    BEFORE UPDATE ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.enforce_message_update_rules();

-- Proof: deleted_at exists, and authenticated can write exactly
-- read_at + deleted_at and nothing else.
SELECT
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema='public' AND table_name='messages'
        AND column_name='deleted_at') AS deleted_at_col,
    (SELECT string_agg(column_name, ', ' ORDER BY column_name)
       FROM information_schema.column_privileges
      WHERE table_schema='public' AND table_name='messages'
        AND grantee='authenticated' AND privilege_type='UPDATE') AS updatable_columns;
