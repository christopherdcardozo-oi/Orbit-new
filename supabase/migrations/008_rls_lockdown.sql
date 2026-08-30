-- Lock down the two tables the Supabase security advisor flagged for having
-- Row Level Security disabled. With RLS off, anyone holding the anon key
-- (which ships with every browser client) could read or write these tables.

-- match_history is server-only. The reset-matches edge function uses the
-- service role, which bypasses RLS. No client code should ever read it, and
-- accepting client writes would let someone poison the 30-day
-- repair-avoidance set with fake pairs (blocking legitimate matches).
-- Enabling RLS with NO policies makes it invisible to anon + authenticated.
ALTER TABLE public.match_history ENABLE ROW LEVEL SECURITY;

-- university_config is a directory of allowed campuses populated by the
-- seed in 005. Not sensitive; safe to expose read-only in case future
-- features query it from the client. Writes stay locked to service role.
ALTER TABLE public.university_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read universities"
    ON public.university_config
    FOR SELECT
    TO anon, authenticated
    USING (true);
