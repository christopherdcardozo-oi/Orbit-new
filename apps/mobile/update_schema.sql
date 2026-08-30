-- Add fcm_token for Push Notifications
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS fcm_token TEXT;
