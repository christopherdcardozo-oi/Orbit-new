-- Formalize columns that were added to `profiles` via ad-hoc dashboard ALTERs
-- and were previously tracked only in apps/mobile/update_schema.sql (which is
-- now removed). Idempotent so this is a no-op on databases where the columns
-- already exist.
--
-- Note: `fcm_token` is a legacy name — the app stores an Expo push token in
-- this column, not a Firebase Cloud Messaging token. Kept as-is to avoid a
-- rename migration that would touch client code in multiple places.

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS fcm_token TEXT,
    ADD COLUMN IF NOT EXISTS gender TEXT,
    ADD COLUMN IF NOT EXISTS custom_gender TEXT,
    ADD COLUMN IF NOT EXISTS personality TEXT[] DEFAULT '{}';
