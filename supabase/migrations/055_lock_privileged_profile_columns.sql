-- 055 — Lock the privileged columns on profiles, and stop message tampering.
--
-- Two live holes this closes:
--
-- 1. `authenticated` held an UPDATE grant on EVERY column of profiles.
--    The only guard was the trigger below, which checked just
--    email_domain and display_alias. Since 034/037 hung authorization
--    off is_admin + admin_campuses, and 039 added a trigger copying
--    those into admin_users, any signed-in user could PATCH their own
--    profile row and become a global admin. The same path let a
--    moderated user clear their own `flagged` / `is_active`, undoing
--    every ban issued from the admin panel.
--
-- 2. The messages UPDATE policy (017) was written so a recipient could
--    stamp read_at. Nothing restricted WHICH column changed, and
--    `authenticated` had UPDATE on `content`, so a user could rewrite
--    what their partner said and then report them — admins reading the
--    thread would see fabricated evidence.
--
-- Design notes:
-- * is_admin / admin_campuses are never set through the API. Only
--   service_role (setup-review-account, the allowlist sync) touches
--   them, so they are hard-blocked for everyone else.
-- * flagged / is_active ARE set through the API, by admins, via direct
--   .update() calls in app/admin/users.tsx. So they stay writable, but
--   only by an admin scoped to that user's campus, and never on your
--   own row. That keeps ban/unban working and kills self-unban.
-- * messages uses column grants rather than a trigger: PostgREST
--   honours them, and the client only ever writes read_at
--   (app/chat/[id].tsx:400,474).

CREATE OR REPLACE FUNCTION public.prevent_immutable_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
    -- service_role (edge functions, cron) bypasses every check, as before.
    IF (SELECT current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF NEW.email_domain IS DISTINCT FROM OLD.email_domain THEN
        RAISE EXCEPTION 'email_domain cannot be changed after signup';
    END IF;

    IF NEW.display_alias IS DISTINCT FROM OLD.display_alias THEN
        RAISE EXCEPTION 'display_alias cannot be changed';
    END IF;

    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
        RAISE EXCEPTION 'is_admin cannot be changed through the API';
    END IF;

    IF NEW.admin_campuses IS DISTINCT FROM OLD.admin_campuses THEN
        RAISE EXCEPTION 'admin_campuses cannot be changed through the API';
    END IF;

    IF NEW.flagged IS DISTINCT FROM OLD.flagged
       OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        IF OLD.id = auth.uid() THEN
            RAISE EXCEPTION 'moderation flags cannot be changed on your own profile';
        END IF;
        IF NOT public.admin_can_see_campus(OLD.email_domain) THEN
            RAISE EXCEPTION 'not authorized to moderate this user';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

-- Recipients may stamp read_at and nothing else.
REVOKE UPDATE ON public.messages FROM authenticated;
GRANT  UPDATE (read_at) ON public.messages TO authenticated;
