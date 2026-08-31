// Shared between app/(auth)/login.tsx and app/(auth)/signup.tsx so both
// screens' campus picker is sourced from the same query and can't drift.
// university_config has a public SELECT policy (see
// supabase/migrations/008_rls_lockdown.sql), so this works for anon.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type University = {
  email_domain: string;
  university_name: string;
};

export function useActiveUniversities() {
  const [universities, setUniversities] = useState<University[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('university_config')
        .select('email_domain, university_name')
        .eq('is_active', true)
        .order('university_name');

      if (cancelled) return;

      if (error) {
        console.warn('Failed to fetch active universities:', error);
      }
      setUniversities(data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { universities, loading };
}
