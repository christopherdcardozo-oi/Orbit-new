// Campus filter dropdown, shared by every admin list screen (hub,
// users, reports, feedback). Options are university_config rows
// (is_active = true only — dead/retired campuses shouldn't clutter an
// admin filter) narrowed to whatever the current admin's admin_campuses
// scope allows. Defaults to "All".

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
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
      <View style={styles.pickerContainer}>
        <Picker
          selectedValue={selected ?? '__all__'}
          onValueChange={(val) => onChange(val === '__all__' ? null : String(val))}
          style={styles.picker}
          itemStyle={styles.pickerItem}
        >
          <Picker.Item label="All" value="__all__" />
          {options.map((o) => (
            <Picker.Item key={o.email_domain} label={o.university_name} value={o.email_domain} />
          ))}
        </Picker>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, marginBottom: 12 },
  label: { color: '#6b7280', fontSize: 11, marginBottom: 4, fontWeight: '600' },
  pickerContainer: {
    backgroundColor: '#111827', borderRadius: 10, borderWidth: 1, borderColor: '#374151',
    overflow: 'hidden',
  },
  // Same web-vs-native split used elsewhere in the app (see the
  // matching comment in app/(auth)/login.tsx and app/(app)/profile.tsx)
  // — RN Web's Picker renders as a plain <select> and needs explicit
  // sizing; native iOS/Android render their own wheel/dialog and
  // should be left alone.
  picker: {
    backgroundColor: 'transparent',
    color: '#fff',
    ...(Platform.OS === 'web'
      ? { height: 40, paddingHorizontal: 12, fontSize: 14, borderWidth: 0 }
      : {}),
  },
  pickerItem: {
    color: '#fff',
    backgroundColor: '#111827',
    fontSize: 14,
  },
});
