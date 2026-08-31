-- Migration 016 lets you SELECT a partner's profile only while the match
-- is 'active'. That means once a match expires the partner name flips to
-- 'Mystery Connection' anywhere the app fetches it — including the
-- post-match rating banner on the home screen, which asks "how was your
-- connection with X?" and needs the real X.
--
-- Widen visibility to include partners of matches that expired in the
-- last 48h (same window the rating banner uses). Doesn't leak
-- historical partners forever, just enough to make the rating UI show
-- the right name.

CREATE POLICY "Users can view recent past match partner's profile"
    ON public.profiles FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.matches
            WHERE status <> 'active'
              AND expires_at >= now() - interval '48 hours'
              AND ((user1_id = auth.uid() AND user2_id = profiles.id)
                OR (user2_id = auth.uid() AND user1_id = profiles.id))
        )
    );
