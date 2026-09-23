-- 062 — Record that a user actually agreed to the terms.
--
-- Follow-up to the 1.2 rejection. Migration 061's commit added an
-- agreement checkbox to SIGNUP, which misses the one person who has to
-- see it: the App Store reviewer signs in through app/(auth)/login.tsx
-- (via the review-OTP bypass at REVIEW_EMAIL) and never visits signup.
-- Login had no terms agreement of any kind, so the reviewer would have
-- hit the exact same rejection a second time.
--
-- Same gap for the 77 existing users, who all predate the checkbox.
--
-- So acceptance becomes account state rather than a signup-form detail:
-- null means "has not agreed", and the client blocks the app behind an
-- acceptance gate until it is set. That also gives a defensible record
-- of who agreed and when, which a passive "by continuing" line never
-- did.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

COMMENT ON COLUMN public.profiles.terms_accepted_at IS
    'When the user affirmatively accepted the Terms of Service, including '
    'the zero-tolerance policy for objectionable content and abusive users '
    '(App Store guideline 1.2). NULL means not yet accepted — the client '
    'gates the app behind an acceptance screen.';

-- No new policy or grant needed: the existing "Users can update their
-- own profile" policy covers it, and 055's trigger only pins the
-- privileged columns (is_admin, admin_campuses, flagged, is_active),
-- which this is not.

SELECT count(*) AS should_be_one
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name = 'terms_accepted_at';
