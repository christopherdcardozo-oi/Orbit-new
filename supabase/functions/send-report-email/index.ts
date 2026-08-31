// send-report-email — invoked by the Postgres AFTER INSERT trigger on
// public.reports (see migration 030). Emails support@orghubs.com with
// the report details + identity of both reporter and reported user,
// with Reply-To set to the reporter's email so hitting Reply asks
// them for clarification.
//
// Auth: shared secret in Authorization header (same pattern as
// reset-matches and send-web-push), so only the trigger can call it.
//
// Payload: { report_id: uuid }. We look everything else up server-side
// so the trigger doesn't have to marshal it — cleaner + we can enrich
// with profile columns without touching the trigger later.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization') ?? '';
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) return json({ error: 'Feedback delivery not configured' }, 500);

  let body: { report_id?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  if (!body.report_id) return json({ error: 'report_id required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRole, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch the report + both profiles in one round trip each. Reports
  // FKs to profiles by id, and profiles.id is auth.users.id, which we
  // need for the reporter's email.
  const { data: report, error: reportErr } = await supabase
    .from('reports')
    .select('id, reporter_id, reported_user_id, match_id, reason, details, created_at')
    .eq('id', body.report_id)
    .single();
  if (reportErr || !report) return json({ error: 'Report not found' }, 404);

  const { data: reporter } = await supabase
    .from('profiles')
    .select('display_alias, email_domain, major, year_in_school')
    .eq('id', report.reporter_id)
    .maybeSingle();
  const { data: reported } = await supabase
    .from('profiles')
    .select('display_alias, email_domain, major, year_in_school, gender')
    .eq('id', report.reported_user_id)
    .maybeSingle();

  // Reporter's auth email — for Reply-To. Reported user's email is
  // deliberately NOT included here to keep the reporter/support loop
  // clean and avoid support accidentally emailing the reported party.
  const { data: reporterUser } = await supabase.auth.admin.getUserById(report.reporter_id);
  const reporterEmail = reporterUser?.user?.email ?? null;

  const from = Deno.env.get('SUPPORT_FROM_EMAIL') || 'Orbit Reports <noreply@orbit.orghubs.com>';
  const to = Deno.env.get('SUPPORT_TO_EMAIL') || 'support@orghubs.com';

  const subject = `[Orbit Report / ${report.reason}] ${reported?.display_alias ?? report.reported_user_id}`;

  const plaintext = [
    `Category: ${report.reason}`,
    '',
    'Details:',
    report.details || '(none provided)',
    '',
    '---',
    'Reported user:',
    `  User ID:       ${report.reported_user_id}`,
    `  Display alias: ${reported?.display_alias || '(no profile row)'}`,
    `  Campus:        ${reported?.email_domain || '(unknown)'}`,
    `  Major:         ${reported?.major || '(not set)'}`,
    `  Year:          ${reported?.year_in_school || '(not set)'}`,
    `  Gender:        ${reported?.gender || '(not set)'}`,
    '',
    'Reporter:',
    `  User ID:       ${report.reporter_id}`,
    `  Email:         ${reporterEmail || '(unknown)'}`,
    `  Display alias: ${reporter?.display_alias || '(no profile row)'}`,
    `  Campus:        ${reporter?.email_domain || '(unknown)'}`,
    `  Major:         ${reporter?.major || '(not set)'}`,
    `  Year:          ${reporter?.year_in_school || '(not set)'}`,
    '',
    `Match ID:        ${report.match_id}`,
    `Reported at:     ${report.created_at}`,
  ].join('\n');

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #dc2626;">🚩 Orbit Report: ${escapeHtml(report.reason)}</h2>
      <div style="background: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; border-radius: 6px; margin: 16px 0;">
        <div style="white-space: pre-wrap; color: #1f2937; font-size: 15px; line-height: 1.5;">${escapeHtml(report.details || '(no details provided)')}</div>
      </div>

      <h3 style="color: #374151; margin-top: 24px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Reported user</h3>
      <table style="border-collapse: collapse; font-size: 13px; color: #374151;">
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">User ID</td><td><code>${escapeHtml(report.reported_user_id)}</code></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Display alias</td><td>${escapeHtml(reported?.display_alias || '(no profile row)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Campus</td><td>${escapeHtml(reported?.email_domain || '(unknown)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Major</td><td>${escapeHtml(reported?.major || '(not set)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Year</td><td>${escapeHtml(reported?.year_in_school || '(not set)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Gender</td><td>${escapeHtml(reported?.gender || '(not set)')}</td></tr>
      </table>

      <h3 style="color: #374151; margin-top: 24px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Reporter</h3>
      <table style="border-collapse: collapse; font-size: 13px; color: #374151;">
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">User ID</td><td><code>${escapeHtml(report.reporter_id)}</code></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Email</td><td><a href="mailto:${escapeHtml(reporterEmail || '')}">${escapeHtml(reporterEmail || '(unknown)')}</a></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Display alias</td><td>${escapeHtml(reporter?.display_alias || '(no profile row)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Campus</td><td>${escapeHtml(reporter?.email_domain || '(unknown)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Major</td><td>${escapeHtml(reporter?.major || '(not set)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Year</td><td>${escapeHtml(reporter?.year_in_school || '(not set)')}</td></tr>
      </table>

      <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
        Match ID: <code>${escapeHtml(report.match_id)}</code><br>
        Reported at: ${escapeHtml(report.created_at)}
      </p>
    </div>
  `;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      reply_to: reporterEmail ? [reporterEmail] : undefined,
      subject,
      text: plaintext,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error('Resend send failed:', resendRes.status, errText);
    return json({ error: 'Failed to deliver report email' }, 502);
  }
  return json({ ok: true });
});
