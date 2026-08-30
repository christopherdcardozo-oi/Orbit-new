CREATE TYPE match_status AS ENUM ('active', 'expired', 'unmatched', 'flagged');

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email_domain TEXT NOT NULL,
    display_alias TEXT NOT NULL,
    major TEXT,
    hobbies TEXT[] DEFAULT '{}',
    activities TEXT[] DEFAULT '{}',
    year_in_school TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX profiles_email_domain_active_idx ON profiles(email_domain) WHERE is_active = true;

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id UUID NOT NULL REFERENCES profiles(id),
    user2_id UUID NOT NULL REFERENCES profiles(id),
    status match_status DEFAULT 'active',
    icebreaker TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    CONSTRAINT different_users CHECK (user1_id != user2_id)
);
CREATE INDEX matches_status_active_idx ON matches(status) WHERE status = 'active';
CREATE INDEX matches_user1_user2_idx ON matches(user1_id, user2_id);

CREATE TABLE match_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user1_id UUID NOT NULL REFERENCES profiles(id),
    user2_id UUID NOT NULL REFERENCES profiles(id),
    matched_at DATE DEFAULT CURRENT_DATE,
    CONSTRAINT ordered_pair CHECK (user1_id < user2_id)
);
CREATE INDEX match_history_user1_user2_matched_idx ON match_history(user1_id, user2_id, matched_at);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES profiles(id),
    content TEXT NOT NULL CHECK (char_length(content) <= 2000),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX messages_match_created_idx ON messages(match_id, created_at);

CREATE TABLE reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES profiles(id),
    reported_user_id UUID NOT NULL REFERENCES profiles(id),
    match_id UUID REFERENCES matches(id),
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE university_config (
    email_domain TEXT PRIMARY KEY,
    university_name TEXT NOT NULL,
    timezone TEXT DEFAULT 'America/Chicago',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Realtime for messages table
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
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
-- expire_active_matches()
CREATE OR REPLACE FUNCTION expire_active_matches()
RETURNS void AS $$
BEGIN
    UPDATE matches
    SET status = 'expired'
    WHERE status = 'active';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- handle_new_user()
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    user_email_domain TEXT;
    anon_alias TEXT;
BEGIN
    user_email_domain := split_part(NEW.email, '@', 2);
    
    IF user_email_domain NOT LIKE '%.edu' THEN
        RAISE EXCEPTION 'Only .edu emails are allowed';
    END IF;

    anon_alias := 'Anon' || substr(md5(random()::text), 1, 8);

    INSERT INTO public.profiles (id, email_domain, display_alias)
    VALUES (NEW.id, user_email_domain, anon_alias);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- purge_old_match_history()
CREATE OR REPLACE FUNCTION purge_old_match_history()
RETURNS void AS $$
BEGIN
    DELETE FROM match_history
    WHERE matched_at < CURRENT_DATE - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- validate_edu_email_before_signup(event JSONB)
CREATE OR REPLACE FUNCTION validate_edu_email_before_signup(event jsonb)
RETURNS jsonb AS $$
DECLARE
    user_email TEXT;
BEGIN
    user_email := event->>'email';
    
    IF user_email IS NULL OR user_email NOT LIKE '%.edu' THEN
        RAISE EXCEPTION 'Only .edu emails are allowed for sign up';
    END IF;

    RETURN event;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION validate_edu_email_before_signup(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_edu_email_before_signup(jsonb) FROM anon;
REVOKE ALL ON FUNCTION validate_edu_email_before_signup(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION validate_edu_email_before_signup(jsonb) TO supabase_auth_admin;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Expire matches at midnight UTC daily
SELECT cron.schedule('expire-matches-midnight', '0 0 * * *', $$SELECT expire_active_matches()$$);

-- Purge old match history weekly (Sunday 1am)
SELECT cron.schedule('purge-match-history', '0 1 * * 0', $$SELECT purge_old_match_history()$$);
-- Seed universities table with initial universities
INSERT INTO public.university_config (email_domain, university_name, timezone)
VALUES 
  ('iastate.edu', 'Iowa State University', 'America/Chicago'),
  ('uiowa.edu', 'University of Iowa', 'America/Chicago'),
  ('uni.edu', 'University of Northern Iowa', 'America/Chicago')
ON CONFLICT (email_domain) DO NOTHING;
