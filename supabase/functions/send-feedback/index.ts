// send-feedback — invoked by the Feedback modal on the profile screen.
// Sends the user's message to support@orghubs.com via Resend, tagged with
// enough identity (auth user id, email, display alias, university) that
// we can follow up.
//
// Auth: called with the caller's Supabase JWT in the Authorization
// header. We use it to look up their profile row rather than trusting
// anything the client sends about who they are — the JWT is the sole
// source of truth for identity, the request body is only content.
//
// Env:
//   RESEND_API_KEY        — Resend API key (already used by Supabase Auth
//                           for OTP mail; same key works)
//   SUPPORT_FROM_EMAIL    — optional, defaults to noreply@orbit.orghubs.com
//   SUPPORT_TO_EMAIL      — optional, defaults to support@orghubs.com

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CATEGORIES = new Set([
  'bug',
  'feature-request',
  'ui-ux',
  'matching-quality',
  'safety-abuse-report',
  'account-help',
  'other',
])

const MAX_MESSAGE_LENGTH = 5000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'Not authenticated' }, 401)
  }

  let body: { category?: string; message?: string } = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const category = String(body.category || '').trim()
  const message = String(body.message || '').trim()

  if (!CATEGORIES.has(category)) {
    return json({ error: 'Invalid category' }, 400)
  }
  if (!message) {
    return json({ error: 'Message is required' }, 400)
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return json({ error: `Message must be under ${MAX_MESSAGE_LENGTH} characters` }, 400)
  }

  // Verify the caller via their JWT — reject if it's invalid. Using the
  // anon key + user's Authorization header, exactly the way an
  // authenticated client call would, so RLS on the profile lookup below
  // also enforces "you can only fetch your own row".
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData?.user) {
    return json({ error: 'Not authenticated' }, 401)
  }
  const user = userData.user

  // Look up their display alias / university for the email body — best
  // effort, fine if it fails (edge case: brand-new signup mid-onboarding).
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_alias, email_domain, gender, major, year_in_school')
    .eq('id', user.id)
    .maybeSingle()

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    console.error('RESEND_API_KEY not set')
    return json({ error: 'Feedback delivery not configured' }, 500)
  }

  const from = Deno.env.get('SUPPORT_FROM_EMAIL') || 'Orbit Feedback <noreply@orbit.orghubs.com>'
  const to = Deno.env.get('SUPPORT_TO_EMAIL') || 'support@orghubs.com'

  const subject = `[Orbit Feedback / ${category}] ${(profile?.display_alias) || user.email || 'anonymous'}`

  const plaintext = [
    `Category: ${category}`,
    '',
    'Message:',
    message,
    '',
    '---',
    'From:',
    `  User ID:       ${user.id}`,
    `  Email:         ${user.email || '(none)'}`,
    `  Display alias: ${profile?.display_alias || '(no profile row)'}`,
    `  Campus:        ${profile?.email_domain || '(unknown)'}`,
    `  Major:         ${profile?.major || '(not set)'}`,
    `  Year:          ${profile?.year_in_school || '(not set)'}`,
    `  Gender:        ${profile?.gender || '(not set)'}`,
    `  Created at:    ${user.created_at}`,
  ].join('\n')

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #7c3aed;">Orbit Feedback: ${escapeHtml(category)}</h2>
      <div style="background: #f5f3ff; border-left: 4px solid #7c3aed; padding: 16px; border-radius: 6px; margin: 16px 0;">
        <div style="white-space: pre-wrap; color: #1f2937; font-size: 15px; line-height: 1.5;">${escapeHtml(message)}</div>
      </div>
      <h3 style="color: #374151; margin-top: 24px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">From</h3>
      <table style="border-collapse: collapse; font-size: 13px; color: #374151;">
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">User ID</td><td><code>${escapeHtml(user.id)}</code></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Email</td><td><a href="mailto:${escapeHtml(user.email || '')}">${escapeHtml(user.email || '(none)')}</a></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Display alias</td><td>${escapeHtml(profile?.display_alias || '(no profile row)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Campus</td><td>${escapeHtml(profile?.email_domain || '(unknown)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Major</td><td>${escapeHtml(profile?.major || '(not set)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Year</td><td>${escapeHtml(profile?.year_in_school || '(not set)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Gender</td><td>${escapeHtml(profile?.gender || '(not set)')}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b7280;">Created at</td><td>${escapeHtml(user.created_at || '')}</td></tr>
      </table>
    </div>
  `

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      // Set the user's email as reply_to so support can just hit Reply.
      reply_to: user.email ? [user.email] : undefined,
      subject,
      text: plaintext,
      html,
    }),
  })

  if (!resendRes.ok) {
    const errText = await resendRes.text()
    console.error('Resend send failed:', resendRes.status, errText)
    return json({ error: 'Failed to deliver feedback' }, 502)
  }

  return json({ ok: true })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
