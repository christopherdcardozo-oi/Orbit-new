-- Per-match acknowledgement of the safety disclaimer. Replaces the
-- once-per-lifetime profiles.safety_ack_at check with a per-match
-- lookup — every new match is a new stranger, and the disclaimer's
-- guidance (Share Contact for handles, Report and Block for concerns,
-- don't share schedule/address, Orbit isn't responsible for off-
-- platform interactions) is worth reinforcing on each new pairing.
--
-- profiles.safety_ack_at stays in the schema for now (unused, harmless);
-- can be dropped in a later cleanup migration.

CREATE TABLE IF NOT EXISTS public.match_safety_acks (
    id uuid primary key default gen_random_uuid(),
    match_id uuid not null references public.matches(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    ack_at timestamptz not null default now(),
    unique (match_id, user_id)
);

CREATE INDEX IF NOT EXISTS match_safety_acks_user_match_idx
    ON public.match_safety_acks(user_id, match_id);

ALTER TABLE public.match_safety_acks ENABLE ROW LEVEL SECURITY;

-- Insert own ack row on a match you're part of.
CREATE POLICY "Users can ack the disclaimer for their own match"
    ON public.match_safety_acks
    FOR INSERT TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.matches m
            WHERE m.id = match_safety_acks.match_id
              AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
        )
    );

-- Read own ack rows (so the client can check "have I acked this match?").
CREATE POLICY "Users can see their own acks"
    ON public.match_safety_acks
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());
