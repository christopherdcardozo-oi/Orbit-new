export type MatchStatus = 'active' | 'expired' | 'unmatched' | 'flagged';

export type Profile = {
  id: string;
  email_domain: string;
  display_alias: string;
  major: string | null;
  hobbies: string[] | null;
  activities: string[] | null;
  year_in_school: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type Match = {
  id: string;
  user1_id: string;
  user2_id: string;
  status: MatchStatus | null;
  icebreaker: string | null;
  created_at: string | null;
  expires_at: string | null;
};

export type MatchHistory = {
  id: string;
  user1_id: string;
  user2_id: string;
  matched_at: string | null;
};

export type Message = {
  id: string;
  match_id: string;
  sender_id: string;
  content: string;
  created_at: string | null;
};

export type Report = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  match_id: string | null;
  reason: string;
  created_at: string | null;
};

export type UniversityConfig = {
  email_domain: string;
  university_name: string;
  timezone: string | null;
  created_at: string | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          email_domain: string;
          display_alias: string;
          major?: string | null;
          hobbies?: string[] | null;
          activities?: string[] | null;
          year_in_school?: string | null;
          is_active?: boolean | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          email_domain?: string;
          display_alias?: string;
          major?: string | null;
          hobbies?: string[] | null;
          activities?: string[] | null;
          year_in_school?: string | null;
          is_active?: boolean | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      matches: {
        Row: Match;
        Insert: {
          id?: string;
          user1_id: string;
          user2_id: string;
          status?: MatchStatus | null;
          icebreaker?: string | null;
          created_at?: string | null;
          expires_at?: string | null;
        };
        Update: {
          id?: string;
          user1_id?: string;
          user2_id?: string;
          status?: MatchStatus | null;
          icebreaker?: string | null;
          created_at?: string | null;
          expires_at?: string | null;
        };
        Relationships: [];
      };
      match_history: {
        Row: MatchHistory;
        Insert: {
          id?: string;
          user1_id: string;
          user2_id: string;
          matched_at?: string | null;
        };
        Update: {
          id?: string;
          user1_id?: string;
          user2_id?: string;
          matched_at?: string | null;
        };
        Relationships: [];
      };
      messages: {
        Row: Message;
        Insert: {
          id?: string;
          match_id: string;
          sender_id: string;
          content: string;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          match_id?: string;
          sender_id?: string;
          content?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
      reports: {
        Row: Report;
        Insert: {
          id?: string;
          reporter_id: string;
          reported_user_id: string;
          match_id?: string | null;
          reason: string;
          created_at?: string | null;
        };
        Update: {
          id?: string;
          reporter_id?: string;
          reported_user_id?: string;
          match_id?: string | null;
          reason?: string;
          created_at?: string | null;
        };
        Relationships: [];
      };
      university_config: {
        Row: UniversityConfig;
        Insert: {
          email_domain: string;
          university_name: string;
          timezone?: string | null;
          created_at?: string | null;
        };
        Update: {
          email_domain?: string;
          university_name?: string;
          timezone?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      expire_active_matches: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      purge_old_match_history: {
        Args: Record<string, never>;
        Returns: undefined;
      };
    };
    Enums: {
      match_status: MatchStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
