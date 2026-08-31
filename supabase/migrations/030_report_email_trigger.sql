-- Email support whenever a row is inserted into public.reports.
-- Mirrors the enqueue_web_push pattern from migration 027: a small
-- SECURITY DEFINER helper posts to the send-report-email edge function
-- via net.http_post, using the shared cron_secret from vault.

CREATE OR REPLACE FUNCTION public.notify_report_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    PERFORM net.http_post(
        url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url')
               || '/functions/v1/send-report-email',
        headers := jsonb_build_object(
            'Authorization',
            'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'),
            'Content-Type',
            'application/json'
        ),
        body := jsonb_build_object('report_id', NEW.id)
    );
    RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.notify_report_email() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_report_email() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_report_email() FROM authenticated;

DROP TRIGGER IF EXISTS on_report_insert_email ON public.reports;
CREATE TRIGGER on_report_insert_email
    AFTER INSERT ON public.reports
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_report_email();
