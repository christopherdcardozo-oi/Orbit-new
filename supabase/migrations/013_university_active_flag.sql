-- Adds an is_active flag to university_config so new campuses can be
-- added to the table without immediately going live, and replaces every
-- place that validated emails with a generic `LIKE '%.edu'` regex with a
-- real check against this table. Previously ANY .edu domain (even one
-- never configured as a campus) could sign up — looser than the app's
-- own "Campus Only" positioning. Now only active, configured campuses
-- (or admin_allowlist entries) are eligible.

ALTER TABLE public.university_config
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Only Iowa State is live for now; uiowa.edu / uni.edu stay seeded but
-- inactive until turned on.
UPDATE public.university_config
SET is_active = (email_domain = 'iastate.edu');

-- ---------- is_email_allowed(email) ----------
-- Client-safe pre-check (anon-callable). Now checks real active-campus
-- membership instead of a blanket .edu pattern.
CREATE OR REPLACE FUNCTION public.is_email_allowed(email_to_check text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN (
        EXISTS (
            SELECT 1 FROM public.university_config uc
            WHERE uc.is_active
              AND uc.email_domain = split_part(email_to_check, '@', 2)
        )
        OR EXISTS (
            SELECT 1 FROM public.admin_allowlist WHERE email = email_to_check
        )
    );
END;
$$;

-- ---------- validate_edu_email_before_signup(event) ----------
-- The actual auth hook Supabase calls before creating a user. Delegates
-- to is_email_allowed so both checks can never drift apart.
CREATE OR REPLACE FUNCTION public.validate_edu_email_before_signup(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_email TEXT;
    allowed    BOOLEAN;
BEGIN
    user_email := event->>'email';

    IF user_email IS NULL THEN
        RAISE EXCEPTION 'Email is required';
    END IF;

    SELECT public.is_email_allowed(user_email) INTO allowed;

    IF NOT allowed THEN
        RAISE EXCEPTION 'This email is not eligible to sign up. Use an active campus email, or contact an admin to be allowlisted.';
    END IF;

    RETURN event;
END;
$$;

-- ---------- handle_new_user() ----------
-- Same alias/avatar generation as 011; only the eligibility check
-- (previously `NOT LIKE '%.edu'`) is replaced with real active-campus
-- membership.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_email_domain TEXT;
    allowed_campus     TEXT;
    anon_alias         TEXT;
    chosen_avatar      TEXT;
    adjectives         TEXT[] := ARRAY[
        'Cosmic', 'Stellar', 'Lunar', 'Solar', 'Nebula', 'Astro', 'Orbital',
        'Galactic', 'Celestial', 'Quantum', 'Meteoric', 'Radiant',
        'Interstellar', 'Nova', 'Distant'
    ];
    nouns               TEXT[] := ARRAY[
        'Drifter', 'Voyager', 'Wanderer', 'Nomad', 'Comet', 'Rover',
        'Pioneer', 'Explorer', 'Traveler', 'Phantom', 'Rider', 'Seeker',
        'Pulsar', 'Ranger', 'Satellite'
    ];
    avatars             TEXT[] := ARRAY[
        'alien', 'alien-outline', 'rocket-launch', 'ufo', 'ufo-outline',
        'planet', 'moon-waning-crescent', 'meteor', 'star-shooting',
        'earth', 'satellite-variant'
    ];
BEGIN
    user_email_domain := split_part(NEW.email, '@', 2);

    SELECT campus_email_domain INTO allowed_campus
    FROM public.admin_allowlist
    WHERE email = NEW.email;

    IF allowed_campus IS NOT NULL THEN
        user_email_domain := allowed_campus;
    ELSIF NOT EXISTS (
        SELECT 1 FROM public.university_config uc
        WHERE uc.is_active AND uc.email_domain = user_email_domain
    ) THEN
        RAISE EXCEPTION 'Only active campus emails are allowed';
    END IF;

    anon_alias := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
               || nouns[1 + floor(random() * array_length(nouns, 1))::int]
               || (100 + floor(random() * 900))::int::text; -- 3-digit suffix, 100-999

    chosen_avatar := avatars[1 + floor(random() * array_length(avatars, 1))::int];

    INSERT INTO public.profiles (id, email_domain, display_alias, avatar)
    VALUES (NEW.id, user_email_domain, anon_alias, chosen_avatar);

    RETURN NEW;
END;
$$;
