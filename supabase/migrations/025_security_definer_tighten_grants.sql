-- Close the "anon can call SECURITY DEFINER functions" surface flagged
-- by the Supabase linter. All of these functions have internal auth
-- checks so the actual exploit risk was minor, but leaving them
-- callable by anon is defense-in-depth we shouldn't skip.
--
-- Trigger functions do NOT need EXECUTE grants for the trigger to fire
-- — Postgres runs trigger functions in the context of the triggering
-- SQL, the invoking role only needs privileges on the table event
-- itself. So revoking from PUBLIC on notify_new_profile_for_matching
-- and prevent_immutable_profile_columns does not stop the triggers.
--
-- For RPC-callable functions we keep whatever access the app actually
-- uses (anon for pre-signup, authenticated for signed-in callers) and
-- revoke everything else.

------------------------------------------------------------------
-- Trigger-only functions: revoke everything
------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.notify_new_profile_for_matching() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_new_profile_for_matching() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_new_profile_for_matching() FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.prevent_immutable_profile_columns() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_immutable_profile_columns() FROM anon;
REVOKE EXECUTE ON FUNCTION public.prevent_immutable_profile_columns() FROM authenticated;

------------------------------------------------------------------
-- Pre-signup checks: anon needs to call these before the user has
-- a session (login screen precheck, signup email validation)
------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.check_email_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_email_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_email_allowed(text) TO anon, authenticated;

------------------------------------------------------------------
-- Authenticated-only: signed-in callers only, no anon
------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM anon;
-- (authenticated grant already exists from migration 023)

REVOKE EXECUTE ON FUNCTION public.get_reveals_for_match(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_reveals_for_match(uuid) FROM anon;
-- (authenticated grant already exists from migration 019)

REVOKE EXECUTE ON FUNCTION public.i_have_reveal_of_type(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.i_have_reveal_of_type(uuid, text) FROM anon;
-- authenticated grant is required because the RLS SELECT policy on
-- contact_reveals calls this function as the querying role, which is
-- 'authenticated' for signed-in PostgREST requests. (Grant already
-- exists from migration 020.)
