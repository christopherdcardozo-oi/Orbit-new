ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Profiles: users can SELECT and UPDATE their own profile (auth.uid() = id)
CREATE POLICY "Users can view their own profile" ON profiles
    FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = id);

CREATE POLICY "Users can update their own profile" ON profiles
    FOR UPDATE TO authenticated
    USING ((SELECT auth.uid()) = id);

-- Matches: users can SELECT matches where they are user1_id or user2_id
CREATE POLICY "Users can view their own matches" ON matches
    FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = user1_id OR (SELECT auth.uid()) = user2_id);

-- Messages SELECT: users can read messages where they're part of the match AND match status is 'active'
CREATE POLICY "Users can read messages of active matches" ON messages
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM matches
            WHERE matches.id = messages.match_id
            AND (matches.user1_id = (SELECT auth.uid()) OR matches.user2_id = (SELECT auth.uid()))
            AND matches.status = 'active'
        )
    );

-- Messages INSERT: users can insert where sender_id = auth.uid() AND they're part of the match AND match is active
CREATE POLICY "Users can send messages to active matches" ON messages
    FOR INSERT TO authenticated
    WITH CHECK (
        sender_id = (SELECT auth.uid()) AND
        EXISTS (
            SELECT 1 FROM matches
            WHERE matches.id = messages.match_id
            AND (matches.user1_id = (SELECT auth.uid()) OR matches.user2_id = (SELECT auth.uid()))
            AND matches.status = 'active'
        )
    );

-- Reports INSERT: users can create reports where reporter_id = auth.uid()
CREATE POLICY "Users can create reports" ON reports
    FOR INSERT TO authenticated
    WITH CHECK (reporter_id = (SELECT auth.uid()));
