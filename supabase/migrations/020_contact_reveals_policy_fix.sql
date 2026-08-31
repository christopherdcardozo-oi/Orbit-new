-- Fix "infinite recursion detected in policy for relation contact_reveals":
-- migration 019's SELECT policy referenced contact_reveals inside its own
-- EXISTS clause (to check "have I shared this same handle_type?"), which
-- means every time Postgres checked the policy it re-triggered itself
-- against the same table. The upsert path was the first place this
-- surfaced, because PostgREST does INSERT ... RETURNING * on upsert and
-- the return trip goes through SELECT — and that's where the loop begins.
--
-- Fix: extract the self-reference into a SECURITY DEFINER function.
-- Because that function runs as its owner (bypassing RLS on the query
-- inside it), the policy stops looking at contact_reveals again while
-- evaluating itself.

CREATE OR REPLACE FUNCTION public.i_have_reveal_of_type(p_match_id uuid, p_handle_type text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.contact_reveals
        WHERE match_id = p_match_id
          AND user_id = auth.uid()
          AND handle_type = p_handle_type
    );
$$;

GRANT EXECUTE ON FUNCTION public.i_have_reveal_of_type(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "Users can read own reveals + partner reveals of shared types"
    ON public.contact_reveals;

CREATE POLICY "Users can read own reveals + partner reveals of shared types"
    ON public.contact_reveals FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        OR (
            EXISTS (
                SELECT 1 FROM public.matches m
                WHERE m.id = contact_reveals.match_id
                  AND (m.user1_id = auth.uid() OR m.user2_id = auth.uid())
            )
            AND public.i_have_reveal_of_type(contact_reveals.match_id, contact_reveals.handle_type)
        )
    );
