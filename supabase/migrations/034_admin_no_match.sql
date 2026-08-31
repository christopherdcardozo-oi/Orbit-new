-- Admin accounts (mine + Christopher's — anyone in admin_allowlist) should
-- be able to sign in and poke around the app but must never be pulled into
-- the real matching pool. Otherwise a real .edu student could get paired
-- with a test/admin account, which is neither what they signed up for nor
-- something we'd want them to discover.
--
-- Adds profiles.is_admin (default false), backfills it true for every
-- profile whose auth email is in admin_allowlist, and updates
-- handle_new_user so new admin signups get the flag automatically. The
-- matchmaker (reset-matches edge function) filters is_admin = false when
-- it builds each campus's pool, so admins simply never appear as
-- matchmaking candidates.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: any existing profile whose email is in admin_allowlist.
UPDATE public.profiles p
   SET is_admin = TRUE
  FROM auth.users u
 WHERE p.id = u.id
   AND EXISTS (
       SELECT 1 FROM public.admin_allowlist a WHERE a.email = u.email
   );

-- Signup trigger: set is_admin at creation time for allowlisted emails.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
    user_email_domain TEXT; allowed_campus TEXT; anon_alias TEXT; chosen_avatar TEXT;
    is_admin_signup BOOLEAN := FALSE;
    adjectives TEXT[] := ARRAY['Cosmic','Stellar','Nebula','Quantum','Astral','Lunar','Solar','Galactic','Orbital','Meteor','Comet','Pulsar','Radiant','Distant','Silent','Wandering','Drifting','Floating','Bright','Dark','Deep','Mystic'];
    nouns TEXT[] := ARRAY['Drifter','Voyager','Wanderer','Nomad','Comet','Rover','Pioneer','Explorer','Traveler','Phantom','Rider','Seeker','Pulsar','Ranger','Satellite'];
    avatars TEXT[] := ARRAY['alien','rocket-launch','ufo','moon-waning-crescent','earth','satellite-variant','meteor'];
BEGIN
    user_email_domain := split_part(NEW.email, '@', 2);
    SELECT campus_email_domain INTO allowed_campus FROM public.admin_allowlist WHERE email = NEW.email;
    IF allowed_campus IS NOT NULL THEN
        user_email_domain := allowed_campus;
        is_admin_signup := TRUE;
    ELSIF NOT EXISTS (SELECT 1 FROM public.university_config uc WHERE uc.is_active AND uc.email_domain = user_email_domain) THEN
        RAISE EXCEPTION 'Only active campus emails are allowed';
    END IF;
    anon_alias := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
               || nouns[1 + floor(random() * array_length(nouns, 1))::int]
               || (100 + floor(random() * 900))::int::text;
    chosen_avatar := avatars[1 + floor(random() * array_length(avatars, 1))::int];
    INSERT INTO public.profiles (id, email_domain, display_alias, avatar, is_admin)
    VALUES (NEW.id, user_email_domain, anon_alias, chosen_avatar, is_admin_signup);
    RETURN NEW;
END;
$fn$;
