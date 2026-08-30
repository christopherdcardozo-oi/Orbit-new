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
