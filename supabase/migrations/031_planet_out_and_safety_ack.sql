-- Two changes bundled:
--   A. `planet` was the icon reported still rendering as `?` for one
--      user even after migration 029's cleanup — `planet` might not
--      be in every bundled version of MaterialCommunityIcons. Prune
--      it from AVATARS and reassign any existing user (already done
--      via a one-off UPDATE, this block is idempotent).
--   B. profiles.safety_ack_at — timestamp of when a user
--      acknowledged the "don't share sensitive info" disclaimer we
--      show on their very first Start Chatting tap. NULL until
--      acknowledged.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS safety_ack_at timestamptz;

-- Idempotent reassign (in case a new signup lands on planet before
-- the trigger below is updated).
UPDATE public.profiles
SET avatar = (ARRAY['alien','rocket-launch','ufo','moon-waning-crescent','earth','satellite-variant','meteor'])
    [1 + floor(random() * 7)::int]
WHERE avatar = 'planet' OR avatar IS NULL
   OR avatar NOT IN ('alien','rocket-launch','ufo','moon-waning-crescent','earth','satellite-variant','meteor');

-- Rewrite handle_new_user without 'planet' in the avatars array.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
    user_email_domain TEXT; allowed_campus TEXT; anon_alias TEXT; chosen_avatar TEXT;
    adjectives TEXT[] := ARRAY['Cosmic','Stellar','Nebula','Quantum','Astral','Lunar','Solar','Galactic','Orbital','Meteor','Comet','Pulsar','Radiant','Distant','Silent','Wandering','Drifting','Floating','Bright','Dark','Deep','Mystic'];
    nouns TEXT[] := ARRAY['Drifter','Voyager','Wanderer','Nomad','Comet','Rover','Pioneer','Explorer','Traveler','Phantom','Rider','Seeker','Pulsar','Ranger','Satellite'];
    avatars TEXT[] := ARRAY['alien','rocket-launch','ufo','moon-waning-crescent','earth','satellite-variant','meteor'];
BEGIN
    user_email_domain := split_part(NEW.email, '@', 2);
    SELECT campus_email_domain INTO allowed_campus FROM public.admin_allowlist WHERE email = NEW.email;
    IF allowed_campus IS NOT NULL THEN user_email_domain := allowed_campus;
    ELSIF NOT EXISTS (SELECT 1 FROM public.university_config uc WHERE uc.is_active AND uc.email_domain = user_email_domain) THEN
        RAISE EXCEPTION 'Only active campus emails are allowed';
    END IF;
    anon_alias := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
               || nouns[1 + floor(random() * array_length(nouns, 1))::int]
               || (100 + floor(random() * 900))::int::text;
    chosen_avatar := avatars[1 + floor(random() * array_length(avatars, 1))::int];
    INSERT INTO public.profiles (id, email_domain, display_alias, avatar) VALUES (NEW.id, user_email_domain, anon_alias, chosen_avatar);
    RETURN NEW;
END;
$fn$;
