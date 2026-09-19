-- 058 — Somewhere for client errors to land.
--
-- The app has no crash or error reporting of any kind: no Sentry, no
-- Crashlytics, no error boundary. A render exception blanks the screen
-- and the developer never hears about it. With real users on three
-- surfaces (iOS, Android, web) that is the single biggest operational
-- blind spot in the project.
--
-- This is deliberately the cheap version: a table the client writes to,
-- readable by admins. It catches JS exceptions, unhandled rejections
-- and React render errors. It does NOT catch native crashes — the
-- iOS 26 SIGABRT documented in lib/notifications.ts is exactly the kind
-- of thing it would miss — so Sentry or Crashlytics is still worth
-- adding later. This needs no third-party account and works today.
--
-- Insert is intentionally permissive for signed-in users: an error
-- report is low-value to forge, and the alternative is losing reports
-- from the exact broken states worth knowing about.

CREATE TABLE IF NOT EXISTS public.client_errors (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    platform    text,
    app_version text,
    kind        text NOT NULL,
    message     text NOT NULL,
    stack       text,
    route       text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT client_errors_message_len CHECK (char_length(message) <= 2000),
    CONSTRAINT client_errors_stack_len   CHECK (stack IS NULL OR char_length(stack) <= 8000)
);

ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS client_errors_created_idx
    ON public.client_errors (created_at DESC);
CREATE INDEX IF NOT EXISTS client_errors_user_idx
    ON public.client_errors (user_id, created_at DESC);

-- Signed-in users may file a report, but only as themselves.
DROP POLICY IF EXISTS "Users can report their own client errors" ON public.client_errors;
CREATE POLICY "Users can report their own client errors"
    ON public.client_errors FOR INSERT
    TO authenticated
    WITH CHECK (user_id = (SELECT auth.uid()));

-- Admins read within their campus scope; a null user_id (crash before
-- sign-in) is global-admin only.
DROP POLICY IF EXISTS "Admins can read client errors in scope" ON public.client_errors;
CREATE POLICY "Admins can read client errors in scope"
    ON public.client_errors FOR SELECT
    TO authenticated
    USING (
        CASE WHEN user_id IS NULL
             THEN public.is_global_admin()
             ELSE public.admin_can_see_user(user_id)
        END
    );

GRANT INSERT (user_id, platform, app_version, kind, message, stack, route)
    ON public.client_errors TO authenticated;
GRANT SELECT ON public.client_errors TO authenticated;

-- Keep it from growing forever; these are only useful while fresh.
CREATE OR REPLACE FUNCTION public.prune_client_errors()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    DELETE FROM public.client_errors WHERE created_at < now() - interval '30 days';
$$;
REVOKE ALL ON FUNCTION public.prune_client_errors() FROM PUBLIC, anon, authenticated;
