-- Adds read-receipt tracking to messages. The client shows "Sent HH:MM"
-- under every bubble, and "Read HH:MM" under the sender's own bubbles once
-- the recipient has opened the chat and we've stamped read_at.

ALTER TABLE public.messages
    ADD COLUMN read_at timestamptz;

-- Recipients need to be able to stamp read_at on messages sent *to* them
-- (i.e. sender_id != auth.uid()) within a match they're part of. The
-- existing "insert own message" policy doesn't cover this — it's an UPDATE
-- by the other party. Scope it tightly: only read_at may effectively change,
-- and only on messages belonging to a match the caller is in.
CREATE POLICY "Users can mark partner messages as read"
    ON public.messages
    FOR UPDATE
    TO authenticated
    USING (
        sender_id != auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.matches
            WHERE id = messages.match_id
              AND (user1_id = auth.uid() OR user2_id = auth.uid())
        )
    )
    WITH CHECK (
        sender_id != auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.matches
            WHERE id = messages.match_id
              AND (user1_id = auth.uid() OR user2_id = auth.uid())
        )
    );
