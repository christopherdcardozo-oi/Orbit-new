-- Replace the plain "Anon" + random-hex display alias with a cosmic
-- adjective+noun+number combo, and randomly assign one of the avatar
-- icons instead of defaulting everyone to 'planet'.
--
-- Avatar list here MUST stay in sync with the AVATARS array in
-- apps/mobile/app/(app)/profile.tsx (MaterialCommunityIcons names).
--
-- Alias collisions are cosmetically possible (15 adjectives x 15 nouns x
-- 900 numbers = ~202,500 combinations, no uniqueness constraint on
-- display_alias) but harmless — matches are keyed by profile id, not by
-- alias text.

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
    ELSIF user_email_domain NOT LIKE '%.edu' THEN
        RAISE EXCEPTION 'Only .edu emails are allowed';
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
