-- Adds four features in one migration:
--   1. reports          — reuses the existing table (from an earlier migration
--                         that we didn't create in this session), just extends
--                         it with a `details` field and tightens RLS
--   2. blocked_pairs    — "never match me with this alias again" list
--   3. match_ratings    — post-match thumbs up/down feedback loop
--   4. contact_reveals  — two-sided opt-in exchange of a chosen handle
--
-- Everything RLS-scoped so users can only touch rows tied to matches
-- they were actually part of.

------------------------------------------------------------------
-- 1. Reports — extend existing table
------------------------------------------------------------------
-- Existing schema (from a prior migration):
--   id, reporter_id, reported_user_id, match_id, reason, created_at
-- We treat `reason` as the category slug (bug/harassment/etc) and add
-- `details` for free-text context.

ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS details text;

-- Prevent double-reporting the same person on the same match.
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_unique_per_pair_per_match;
ALTER TABLE public.reports
    ADD CONSTRAINT reports_unique_per_pair_per_match
    UNIQUE (match_id, reporter_id, reported_user_id);

CREATE INDEX IF NOT EXISTS reports_reported_user_id_idx ON public.reports(reported_user_id);
CREATE INDEX IF NOT EXISTS reports_created_at_idx ON public.reports(created_at desc);

-- Replace the loose "reporter_id = auth.uid()" insert policy with one
-- that also verifies the reporter and reported are actually in the same
-- match — otherwise anyone could report anyone on any match.
DROP POLICY IF EXISTS "Users can create reports" ON public.reports;
CREATE POLICY "Users can file a report on their own match"
    ON public.reports FOR INSERT TO authenticated
    WITH CHECK (
        reporter_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = reports.match_id
              AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
              AND (m.user1_id = reports.reported_user_id OR m.user2_id = reports.reported_user_id)
        )
    );

DROP POLICY IF EXISTS "Users can read their own reports" ON public.reports;
CREATE POLICY "Users can read their own reports"
    ON public.reports FOR SELECT TO authenticated
    USING (reporter_id = auth.uid());

------------------------------------------------------------------
-- 2. Blocked pairs
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.blocked_pairs (
    id uuid primary key default gen_random_uuid(),
    blocker_id uuid not null references public.profiles(id) on delete cascade,
    blocked_id uuid not null references public.profiles(id) on delete cascade,
    reason text,
    created_at timestamptz not null default now(),
    unique (blocker_id, blocked_id),
    check (blocker_id != blocked_id)
);
CREATE INDEX IF NOT EXISTS blocked_pairs_blocked_id_idx ON public.blocked_pairs(blocked_id);
ALTER TABLE public.blocked_pairs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can block anyone from their own row" ON public.blocked_pairs;
CREATE POLICY "Users can block anyone from their own row"
    ON public.blocked_pairs FOR INSERT TO authenticated
    WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS "Users can see their own blocks" ON public.blocked_pairs;
CREATE POLICY "Users can see their own blocks"
    ON public.blocked_pairs FOR SELECT TO authenticated
    USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "Users can unblock (delete) their own blocks" ON public.blocked_pairs;
CREATE POLICY "Users can unblock (delete) their own blocks"
    ON public.blocked_pairs FOR DELETE TO authenticated
    USING (blocker_id = auth.uid());

------------------------------------------------------------------
-- 3. Match ratings
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_ratings (
    id uuid primary key default gen_random_uuid(),
    match_id uuid not null references public.matches(id) on delete cascade,
    rater_id uuid not null references public.profiles(id) on delete cascade,
    rating text not null check (rating in ('up', 'down')),
    comment text,
    created_at timestamptz not null default now(),
    unique (match_id, rater_id)
);
CREATE INDEX IF NOT EXISTS match_ratings_match_id_idx ON public.match_ratings(match_id);
ALTER TABLE public.match_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can rate a match they were part of" ON public.match_ratings;
CREATE POLICY "Users can rate a match they were part of"
    ON public.match_ratings FOR INSERT TO authenticated
    WITH CHECK (
        rater_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_ratings.match_id
              AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can see their own ratings" ON public.match_ratings;
CREATE POLICY "Users can see their own ratings"
    ON public.match_ratings FOR SELECT TO authenticated
    USING (rater_id = auth.uid());

------------------------------------------------------------------
-- 4. Contact reveals
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_reveals (
    id uuid primary key default gen_random_uuid(),
    match_id uuid not null references public.matches(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    handle_type text not null check (handle_type in ('instagram','snapchat','phone','email','other')),
    handle_value text not null,
    created_at timestamptz not null default now(),
    unique (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS contact_reveals_match_id_idx ON public.contact_reveals(match_id);
ALTER TABLE public.contact_reveals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can share their own handle on their match" ON public.contact_reveals;
CREATE POLICY "Users can share their own handle on their match"
    ON public.contact_reveals FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = contact_reveals.match_id
              AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can edit their own reveal" ON public.contact_reveals;
CREATE POLICY "Users can edit their own reveal"
    ON public.contact_reveals FOR UPDATE TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can retract their own reveal" ON public.contact_reveals;
CREATE POLICY "Users can retract their own reveal"
    ON public.contact_reveals FOR DELETE TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can read reveals on their match once both sides opted in" ON public.contact_reveals;
CREATE POLICY "Users can read reveals on their match once both sides opted in"
    ON public.contact_reveals FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = contact_reveals.match_id
              AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
        )
        AND EXISTS (
            SELECT 1 FROM public.contact_reveals mine
            WHERE mine.match_id = contact_reveals.match_id
              AND mine.user_id = auth.uid()
        )
    );
