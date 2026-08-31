-- profiles SELECT was locked to `auth.uid() = id` — you could only ever
-- read your own profile row. That silently broke "see your match's
-- alias/avatar" on the client (RLS just returns zero rows for the
-- partner's profile), needed for both the match-reveal card and the
-- chat screen. The web app never hit this because its dashboard used a
-- server component with the service role, which bypasses RLS entirely;
-- the mobile client runs everything under the authenticated role, fully
-- subject to it.
--
-- Additive to the existing "own profile" policy — RLS OR's multiple
-- permissive policies together for the same command, so this only ever
-- WIDENS visibility to exactly your current active match partner,
-- nothing else.

CREATE POLICY "Users can view their active match partner's profile"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.matches
            WHERE status = 'active'
              AND ((user1_id = auth.uid() AND user2_id = profiles.id)
                OR (user2_id = auth.uid() AND user1_id = profiles.id))
        )
    );
