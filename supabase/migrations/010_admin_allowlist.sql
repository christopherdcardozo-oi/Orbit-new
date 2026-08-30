-- Replace the "any @gmail.com can sign up" client-side hack with a
-- server-side allowlist.
--
-- Adds:
--   - admin_allowlist table (email → campus, gated by RLS to service-only)
--   - handle_new_user() checks the allowlist first, then falls back to
--     the .edu rule; assigns allowlisted users to the specified campus
--   - validate_edu_email_before_signup() (the auth hook) does the same
--     check so signup is rejected upstream if the email is neither .edu
--     nor allowlisted
--   - is_email_allowed(text) RPC so the client can pre-validate before
--     calling supabase.auth.signInWithOtp

CREATE TABLE public.admin_allowlist (
    email                TEXT PRIMARY KEY,
    campus_email_domain  TEXT NOT NULL REFERENCES public.university_config(email_domain),
    note                 TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- RLS on with NO policies. Only service_role (used by the SECURITY DEFINER
-- functions below) can read/write. Prevents enumeration via the anon key.
ALTER TABLE public.admin_allowlist ENABLE ROW LEVEL SECURITY;

-- Replace handle_new_user() so allowlisted emails are permitted AND get
-- pinned to the campus specified in the allowlist row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_email_domain TEXT;
    anon_alias        TEXT;
    allowed_campus    TEXT;
BEGIN
    user_email_domain := split_part(NEW.email, '@', 2);

    -- Allowlist first: if this specific email is on the list, use the
    -- campus it's pinned to (overrides the parsed domain, which for a
    -- gmail would be "gmail.com" — not a valid campus).
    SELECT campus_email_domain INTO allowed_campus
    FROM public.admin_allowlist
    WHERE email = NEW.email;

    IF allowed_campus IS NOT NULL THEN
        user_email_domain := allowed_campus;
    ELSIF user_email_domain NOT LIKE '%.edu' THEN
        RAISE EXCEPTION 'Only .edu emails are allowed';
    END IF;

    anon_alias := 'Anon' || substr(md5(random()::text), 1, 8);

    INSERT INTO public.profiles (id, email_domain, display_alias)
    VALUES (NEW.id, user_email_domain, anon_alias);

    RETURN NEW;
END;
$$;

-- Replace the auth hook to check the allowlist as well.
CREATE OR REPLACE FUNCTION public.validate_edu_email_before_signup(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_email TEXT;
    is_allowed BOOLEAN;
BEGIN
    user_email := event->>'email';

    IF user_email IS NULL THEN
        RAISE EXCEPTION 'Email is required';
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.admin_allowlist WHERE email = user_email
    ) INTO is_allowed;

    IF NOT is_allowed AND user_email NOT LIKE '%.edu' THEN
        RAISE EXCEPTION 'Only .edu emails are allowed for sign up';
    END IF;

    RETURN event;
END;
$$;

-- Client-safe helper so the mobile app can give a clean "not allowed"
-- error before it hits Supabase Auth (which produces less friendly
-- error messages). Anon + authenticated need to be able to call this.
CREATE OR REPLACE FUNCTION public.is_email_allowed(email_to_check text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN (
        email_to_check LIKE '%.edu'
        OR EXISTS(
            SELECT 1 FROM public.admin_allowlist WHERE email = email_to_check
        )
    );
END;
$$;

-- Seed the two known bypass emails, both pinned to Iowa State as the
-- primary campus. Idempotent so re-runs are safe.
INSERT INTO public.admin_allowlist (email, campus_email_domain, note)
VALUES
    ('mailcardozo@gmail.com',          'iastate.edu', 'Primary owner (Sunil)'),
    ('christopherdcardozo@gmail.com',  'iastate.edu', 'Creator (Christopher)')
ON CONFLICT (email) DO NOTHING;
