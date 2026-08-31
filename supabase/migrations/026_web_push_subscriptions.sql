-- Web push subscriptions — one row per (user, browser device).
-- The endpoint URL is the browser-generated PushSubscription URL; the
-- keys (p256dh + auth) come from the same subscription. All three are
-- required to actually send a push. Stored as text; the send-web-push
-- edge function reads them back and calls the web-push library.
--
-- The DB never stores VAPID keys — those live only as Edge Function
-- secrets, and only the public one is also in the client build.
--
-- See docs/push-notifications.md for the full delivery strategy.

CREATE TABLE public.web_push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    endpoint text not null,
    p256dh text not null,
    auth text not null,
    -- Optional user agent string for future debugging ("which browser
    -- is subscribed"). Not required for sending.
    user_agent text,
    created_at timestamptz not null default now(),
    -- The endpoint URL uniquely identifies a browser subscription.
    -- Re-subscribing on the same browser upserts on this key.
    unique (endpoint)
);

CREATE INDEX web_push_subscriptions_user_id_idx
    ON public.web_push_subscriptions(user_id);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can insert their own subscription rows (on subscribe).
CREATE POLICY "Users can subscribe themselves for web push"
    ON public.web_push_subscriptions
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Users can see and delete their own subscriptions (unsubscribe /
-- "list my devices" UI later). No one else can see them — they're
-- effectively device fingerprints.
CREATE POLICY "Users can see their own subscriptions"
    ON public.web_push_subscriptions
    FOR SELECT TO authenticated
    USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own subscriptions"
    ON public.web_push_subscriptions
    FOR DELETE TO authenticated
    USING (user_id = auth.uid());

-- Update policy so we can refresh a subscription (browser rotates
-- keys). Same guard.
CREATE POLICY "Users can update their own subscriptions"
    ON public.web_push_subscriptions
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
