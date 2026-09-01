// Shared admin-scope state for every screen under app/admin/*.
//
// Multi-tenant model (see supabase/migrations/037_admin_panel_foundation.sql):
//   - profiles.is_admin: excludes from matching, globally.
//   - profiles.admin_campuses: NULL = every campus ("god mode" —
//     Sunil/Christopher today), a real array = scoped to those campus
//     domains. All the RLS policies already enforce this server-side;
//     this hook is just for the UI to know what to show/filter by.
//
// Every admin screen calls useAdminScope() once. It's cheap (a single
// RPC) and each screen mounting independently is simpler than threading
// a context provider through expo-router's file-based layouts, at this
// screen count (4).

import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { supabase } from './supabase';

export type AdminScope = {
  loading: boolean;
  isAdmin: boolean;
  // null = god mode (every campus). A real array = scoped list.
  adminCampuses: string[] | null;
};

const UNCHECKED: AdminScope = { loading: true, isAdmin: false, adminCampuses: null };

// Redirects non-admins back to the app. Returns the scope so the
// screen can render its campus filter / gate its own content while
// the check is still in flight.
export function useAdminScope(): AdminScope {
  const router = useRouter();
  const [scope, setScope] = useState<AdminScope>(UNCHECKED);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc('admin_scope');
      if (cancelled) return;
      // rpc() on a function returning TABLE(...) hands back an array —
      // one row for the calling user, or empty if profiles has no row
      // for them (shouldn't happen for a signed-in user, but be safe).
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row?.is_admin) {
        setScope({ loading: false, isAdmin: false, adminCampuses: null });
        router.replace('/(app)');
        return;
      }
      setScope({ loading: false, isAdmin: true, adminCampuses: row.admin_campuses ?? null });
    })();
    return () => { cancelled = true };
  }, []);

  return scope;
}
