-- Adds a real third rating tier. The UI previously had "Good" (up),
-- "Meh" (down — mislabeled as negative), and "Skip" (no row written at
-- all). Now it's Cool / Meh / Pass, where Meh is an actual recorded
-- neutral rating, not a dismiss action.

ALTER TABLE public.match_ratings DROP CONSTRAINT match_ratings_rating_check;
ALTER TABLE public.match_ratings
    ADD CONSTRAINT match_ratings_rating_check
    CHECK (rating = ANY (ARRAY['up'::text, 'neutral'::text, 'down'::text]));
