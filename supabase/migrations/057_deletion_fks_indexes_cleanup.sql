-- 057 — Unblock account deletion, index the foreign keys, drop a dead column.
--
-- 1. ACCOUNT DELETION IS BROKEN for a subset of users.
--
--    reports.resolved_by, feedback.resolved_by and
--    scheduled_matches.requested_by all reference profiles(id) with NO
--    ACTION (verified: pg_constraint.confdeltype = 'a'). Neither
--    delete_my_account (023) nor admin_delete_user (041) clears them,
--    so DELETE FROM auth.users raises a foreign-key violation for any
--    admin who has ever resolved a report, resolved a feedback item, or
--    scheduled a match.
--
--    That makes Apple guideline 5.1.1(v) — an in-app path that really
--    deletes the account — fail for exactly those users. SET NULL is
--    right here: who resolved a report stops mattering once that person
--    is gone, but the report itself must survive for moderation
--    history. All three columns are already nullable.
--
-- 2. Unindexed foreign keys, straight off the Supabase performance
--    advisor. matches is the one that actually bites: every RLS check is
--    `user1_id = uid OR user2_id = uid`, and matches_user1_user2_idx is
--    a composite whose leading column is user1_id, so the user2 side
--    falls back to a scan on every message read.
--
-- 3. profiles.fcm_token is dead. Migration 033 moved device tokens to
--    device_push_tokens and its own header says the column is "unused
--    going forward, was misused as an Expo push token — safe to drop
--    later". Confirmed: 0 of 77 rows hold a value, and nothing in the
--    client reads it. It also sat inside the full profile row that
--    match partners can SELECT, so dropping it shrinks that exposure.

-- ---------------------------------------------------------------- 1
ALTER TABLE public.reports
    DROP CONSTRAINT IF EXISTS reports_resolved_by_fkey,
    ADD  CONSTRAINT reports_resolved_by_fkey
         FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.feedback
    DROP CONSTRAINT IF EXISTS feedback_resolved_by_fkey,
    ADD  CONSTRAINT feedback_resolved_by_fkey
         FOREIGN KEY (resolved_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.scheduled_matches
    DROP CONSTRAINT IF EXISTS scheduled_matches_requested_by_fkey,
    ADD  CONSTRAINT scheduled_matches_requested_by_fkey
         FOREIGN KEY (requested_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- 2
CREATE INDEX IF NOT EXISTS matches_user2_id_idx
    ON public.matches (user2_id);
CREATE INDEX IF NOT EXISTS messages_sender_created_idx
    ON public.messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_reporter_id_idx
    ON public.reports (reporter_id);
CREATE INDEX IF NOT EXISTS reports_resolved_by_idx
    ON public.reports (resolved_by);
CREATE INDEX IF NOT EXISTS feedback_resolved_by_idx
    ON public.feedback (resolved_by);
CREATE INDEX IF NOT EXISTS contact_reveals_user_id_idx
    ON public.contact_reveals (user_id);
CREATE INDEX IF NOT EXISTS match_ratings_rater_id_idx
    ON public.match_ratings (rater_id);
CREATE INDEX IF NOT EXISTS profiles_active_match_id_idx
    ON public.profiles (active_match_id);
CREATE INDEX IF NOT EXISTS scheduled_matches_user2_id_idx
    ON public.scheduled_matches (user2_id);
CREATE INDEX IF NOT EXISTS scheduled_matches_requested_by_idx
    ON public.scheduled_matches (requested_by);
CREATE INDEX IF NOT EXISTS match_history_user2_id_idx
    ON public.match_history (user2_id);

-- ---------------------------------------------------------------- 3
ALTER TABLE public.profiles DROP COLUMN IF EXISTS fcm_token;

-- Proof: no remaining NO ACTION foreign key into profiles from the
-- three moderator columns, and the dead column is gone.
SELECT
    (SELECT count(*) FROM pg_constraint
       WHERE contype = 'f' AND confrelid = 'public.profiles'::regclass
         AND confdeltype = 'a'
         AND conname IN ('reports_resolved_by_fkey',
                         'feedback_resolved_by_fkey',
                         'scheduled_matches_requested_by_fkey')
    ) AS should_be_zero,
    (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='profiles'
         AND column_name='fcm_token'
    ) AS fcm_token_should_be_zero;
