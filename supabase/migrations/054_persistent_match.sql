-- Persistent matches — a small pair-scoped opt-out of the nightly reset
-- so specific pairs stay matched forever regardless of daily expiry.
--
-- Motivation: the App Store / Play reviewer demo account
-- (review@orghubs.com, created and pinned to Sunil's own account in the
-- setup-review-account edge function) needs a working match visible AT
-- ALL TIMES during review — Apple and Google both spot-check apps
-- days apart, at random hours, and the reviewer has to be able to tap
-- into an active chat with a partner to see the app's core feature.
-- Under the ordinary nightly matcher that match would expire at
-- iastate.edu's local midnight and the reviewer would land on the
-- "Scanning the Cosmos" waiting screen with no way through it — a
-- likely rejection.
--
-- Design:
-- * One boolean on matches, default false — regular matches unaffected.
-- * The single reset-matches expiry query (index.ts, the .update({
--   status: 'expired' }).eq('status', 'active') block) grows an
--   .eq('is_persistent', false) guard. That's the whole runtime change.
-- * Top-up (the "create new matches for anyone without an active one"
--   path in reset-matches) needs NO change: a persistent match stays
--   status='active' forever, so both members already look "matched" to
--   top-up and get skipped naturally.
-- * expires_at is left at whatever admin_schedule_match set (usually
--   ~1 day out) — harmless data, ignored while is_persistent=true. If
--   is_persistent is ever flipped false, the row expires on the next
--   reset like any normal match.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS is_persistent BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.matches.is_persistent IS
  'When true, reset-matches skips this row during the nightly expiry '
  'sweep. Used only for the App Store / Play reviewer demo pair; not '
  'exposed in the UI. Set exclusively by setup-review-account, and '
  'checked exclusively by reset-matches.';
