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
