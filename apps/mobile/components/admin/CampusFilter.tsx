// Campus filter dropdown, shared by every admin list screen (hub,
// users, reports, feedback). Options are university_config rows
// (is_active = true only — dead/retired campuses shouldn't clutter an
// admin filter) narrowed to whatever the current admin's admin_campuses
// scope allows. Defaults to "All".

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Dropdown from '../Dropdown';
import { supabase } from '../../lib/supabase';

export type CampusOption = { email_domain: string; university_name: string };

export function useCampusOptions(adminCampuses: string[] | null): CampusOption[] {
  const [options, setOptions] = useState<CampusOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('university_config')
        .select('email_domain, university_name')
        .eq('is_active', true)
        .order('university_name');
      if (cancelled) return;
      const all = data ?? [];
      const scoped = adminCampuses === null
        ? all
        : all.filter((u) => adminCampuses.includes(u.email_domain));
      setOptions(scoped);
    })();
    return () => { cancelled = true };
  }, [adminCampuses]);
  return options;
}

export default function CampusFilter({
  options,
  selected,
  onChange,
}: {
  options: CampusOption[];
  selected: string | null; // null = "All"
  onChange: (domain: string | null) => void;
}) {
  // A scoped admin with exactly one campus has nothing to filter —
  // skip rendering the row entirely rather than show a permanently
  // stuck-on-one-value dropdown.
  if (options.length <= 1) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Campus</Text>
      <Dropdown
        value={selected ?? '__all__'}
        onValueChange={(val) => onChange(val === '__all__' ? null : val)}
        items={[
          { label: 'All', value: '__all__' },
          ...options.map((o) => ({ label: o.university_name, value: o.email_domain })),
        ]}
        title="Campus"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, marginBottom: 12 },
  label: { color: '#6b7280', fontSize: 11, marginBottom: 4, fontWeight: '600' },
});
