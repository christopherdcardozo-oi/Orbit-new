-- Data-integrity guardrail. The matchmaker's `alreadyMatchedIds` set
-- prevents the same pair from getting two active matches in the same
-- tick, but there's nothing at the DB level catching a bad manual
-- insert, a bug in a future edge function, or a race between two
-- overlapping ticks.
--
-- Partial unique index: at most one row in `matches` can have
-- status='active' for any given normalized pair (LEAST/GREATEST so
-- (A,B) and (B,A) collide the same way). Expired/other-status matches
-- between the same pair are unaffected — we want plenty of those.

CREATE UNIQUE INDEX IF NOT EXISTS matches_no_duplicate_active_pair
    ON public.matches (LEAST(user1_id, user2_id), GREATEST(user1_id, user2_id))
    WHERE status = 'active';
