-- Prune avatar options to the ones we're confident render correctly
-- across all @expo/vector-icons builds. Removed the outline variants
-- (redundant) and the two names reported rendering as `?` in some
-- builds: ufo-outline and star-shooting.
--
-- Any existing user with one of the removed avatars gets randomly
-- reassigned to a valid one, so nobody's profile shows a placeholder
-- once the client is updated.
--
-- Also updates the handle_new_user trigger (last touched in migration
-- 013) to only pick from the trimmed list so brand-new signups can't
-- land on a removed avatar.

-- Fix existing rows first.
UPDATE public.profiles
SET avatar = (ARRAY['alien','rocket-launch','ufo','planet','moon-waning-crescent','earth','satellite-variant','meteor'])
    [1 + floor(random() * 8)::int]
WHERE avatar IS NULL
   OR avatar NOT IN ('alien','rocket-launch','ufo','planet','moon-waning-crescent','earth','satellite-variant','meteor');

-- Rewrite handle_new_user with the trimmed list. This mirrors
-- migration 013's function exactly except for the `avatars` array.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_email_domain   TEXT;
    allowed_campus      TEXT;
    anon_alias          TEXT;
    chosen_avatar       TEXT;
    adjectives          TEXT[] := ARRAY[
        'Cosmic', 'Stellar', 'Nebula', 'Quantum', 'Astral', 'Lunar',
        'Solar', 'Galactic', 'Orbital', 'Meteor', 'Comet', 'Pulsar',
        'Radiant', 'Distant', 'Silent', 'Wandering', 'Drifting',
        'Floating', 'Bright', 'Dark', 'Deep', 'Mystic'
    ];
    nouns               TEXT[] := ARRAY[
        'Drifter', 'Voyager', 'Wanderer', 'Nomad', 'Comet', 'Rover',
        'Pioneer', 'Explorer', 'Traveler', 'Phantom', 'Rider', 'Seeker',
        'Pulsar', 'Ranger', 'Satellite'
    ];
    avatars             TEXT[] := ARRAY[
        'alien', 'rocket-launch', 'ufo', 'planet',
        'moon-waning-crescent', 'earth', 'satellite-variant', 'meteor'
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
               || (100 + floor(random() * 900))::int::text;

    chosen_avatar := avatars[1 + floor(random() * array_length(avatars, 1))::int];

    INSERT INTO public.profiles (id, email_domain, display_alias, avatar)
    VALUES (NEW.id, user_email_domain, anon_alias, chosen_avatar);

    RETURN NEW;
END;
$$;
