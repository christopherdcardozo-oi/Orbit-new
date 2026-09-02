-- Bug fix: migration 047 renamed campus_daily_stats.conversations to
-- messages and updated compute_daily_stats_tick to compute a raw
-- message count going forward, but never recomputed the row(s) that
-- already existed under the old "distinct matches with >=1 message"
-- semantics — so today's stored value was still the old conversations
-- number (13), not the raw message count for that day (277).
-- Recompute every existing row the same way the tick function does:
-- raw count(*) of messages sent by that campus's users, bucketed by
-- the campus's local calendar day.

UPDATE public.campus_daily_stats s
   SET messages = (
        SELECT count(*)
          FROM public.messages msg
          JOIN public.profiles p ON p.id = msg.sender_id
          JOIN public.university_config u ON u.email_domain = s.campus_domain
         WHERE p.email_domain = s.campus_domain
           AND (msg.created_at AT TIME ZONE u.timezone)::date = s.stat_date
   );
