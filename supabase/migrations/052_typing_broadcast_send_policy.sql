-- Fixes the typing indicator never reaching the other side of a chat.
--
-- Root cause: migration 036 added a SELECT policy on realtime.messages
-- so match participants can RECEIVE broadcasts on their private
-- `match:{id}` channel — sufficient for the 'reveal' event, which is
-- broadcast by a DB trigger running as SECURITY DEFINER (bypasses RLS
-- entirely via realtime.send()). The 'typing' event added later is
-- sent directly by the client (chat/[id].tsx's sendTyping, via
-- channel.send()), which authorizes as the calling user — and with no
-- INSERT policy on realtime.messages, Supabase Realtime silently
-- rejects the send. No client-side error either; it just never
-- arrives. Same match-participants-only scope as the SELECT policy.
CREATE POLICY "match participants can send broadcasts"
    ON "realtime"."messages"
    FOR INSERT
    TO authenticated
    WITH CHECK (
        realtime.messages.extension = 'broadcast'
        AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE 'match:' || m.id::text = (SELECT realtime.topic())
              AND (auth.uid() = m.user1_id OR auth.uid() = m.user2_id)
        )
    );
