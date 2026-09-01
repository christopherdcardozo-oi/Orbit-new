// Feedback inbox — replaces the old email-only delivery (send-feedback
// now just writes to public.feedback, see migration 037 + the edge
// function rewrite). Filter by category, open/resolved toggle, same
// campus scoping as the other admin screens.

import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAdminScope } from '../../lib/adminScope';
import CampusFilter, { useCampusOptions } from '../../components/admin/CampusFilter';

const CATEGORY_LABELS: Record<string, string> = {
  'bug': 'Bug',
  'feature-request': 'Feature request',
  'ui-ux': 'UI / UX',
  'matching-quality': 'Matching quality',
  'safety-abuse-report': 'Safety / abuse',
  'account-help': 'Account help',
  'other': 'Other',
};
const CATEGORIES = Object.keys(CATEGORY_LABELS);

type FeedbackRow = {
  id: string;
  category: string;
  message: string;
  created_at: string;
  resolved_at: string | null;
  user: { display_alias: string; email_domain: string } | null;
};

export default function AdminFeedback() {
  const router = useRouter();
  const scope = useAdminScope();
  const campusOptions = useCampusOptions(scope.adminCampuses);
  const [selectedCampus, setSelectedCampus] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('feedback')
      .select(`
        id, category, message, created_at, resolved_at,
        user:profiles!feedback_user_id_fkey(display_alias, email_domain)
      `)
      .order('created_at', { ascending: false });
    if (!showResolved) q = q.is('resolved_at', null);
    if (categoryFilter) q = q.eq('category', categoryFilter);
    const { data, error } = await q;
    if (error) console.warn('feedback load failed:', error);
    let list = (data ?? []) as unknown as FeedbackRow[];
    if (selectedCampus) {
      list = list.filter((r) => r.user?.email_domain === selectedCampus);
    }
    setRows(list);
    setLoading(false);
  }, [showResolved, categoryFilter, selectedCampus]);

  useEffect(() => {
    if (!scope.isAdmin) return;
    load();
  }, [scope.isAdmin, load]);

  const toggleResolved = async (row: FeedbackRow) => {
    setBusyId(row.id);
    const { data: userData } = await supabase.auth.getUser();
    const nextResolvedAt = row.resolved_at ? null : new Date().toISOString();
    const { error } = await supabase
      .from('feedback')
      .update({ resolved_at: nextResolvedAt, resolved_by: nextResolvedAt ? userData.user?.id : null })
      .eq('id', row.id);
    setBusyId(null);
    if (error) { console.warn('resolve failed:', error); return; }
    if (!showResolved && nextResolvedAt) {
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } else {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, resolved_at: nextResolvedAt } : r)));
    }
  };

  if (scope.loading || !scope.isAdmin) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator color="#9333ea" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push('/admin')} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Feedback</Text>
        <TouchableOpacity onPress={() => setShowResolved((v) => !v)}>
          <Text style={styles.toggleText}>{showResolved ? 'Hide resolved' : 'Show resolved'}</Text>
        </TouchableOpacity>
      </View>

      <CampusFilter options={campusOptions} selected={selectedCampus} onChange={setSelectedCampus} />

      <View style={styles.categoryWrap}>
        <Text style={styles.categoryLabel}>Reason</Text>
        <View style={styles.categoryPickerContainer}>
          <Picker
            selectedValue={categoryFilter ?? '__all__'}
            onValueChange={(val) => setCategoryFilter(val === '__all__' ? null : String(val))}
            style={styles.categoryPicker}
            itemStyle={styles.categoryPickerItem}
          >
            <Picker.Item label="All" value="__all__" />
            {CATEGORIES.map((c) => (
              <Picker.Item key={c} label={CATEGORY_LABELS[c]} value={c} />
            ))}
          </Picker>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#9333ea" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          style={styles.resultsList}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.emptyText}>No {showResolved ? '' : 'open '}feedback.</Text>}
          renderItem={({ item }) => (
            <View style={[styles.card, item.resolved_at && styles.cardResolved]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.user?.display_alias ?? 'Unknown'}</Text>
                <Text style={styles.cardTime}>{new Date(item.created_at).toLocaleString()}</Text>
              </View>
              <View style={styles.reasonPill}>
                <Text style={styles.reasonPillText}>{CATEGORY_LABELS[item.category] ?? item.category}</Text>
              </View>
              <Text style={styles.detailsText}>{item.message}</Text>
              <TouchableOpacity
                style={[styles.resolveButton, item.resolved_at && styles.reopenButton]}
                onPress={() => toggleResolved(item)}
                disabled={busyId === item.id}
              >
                {busyId === item.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.resolveButtonText}>
                    {item.resolved_at ? 'Reopen' : 'Mark resolved'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  toggleText: { color: '#c084fc', fontSize: 13, fontWeight: '600' },
  categoryWrap: { paddingHorizontal: 16, marginBottom: 12 },
  categoryLabel: { color: '#6b7280', fontSize: 11, marginBottom: 4, fontWeight: '600' },
  categoryPickerContainer: {
    backgroundColor: '#111827', borderRadius: 10, borderWidth: 1, borderColor: '#374151',
    overflow: 'hidden',
  },
  categoryPicker: {
    backgroundColor: 'transparent',
    color: '#fff',
    ...(Platform.OS === 'web'
      ? { height: 40, paddingHorizontal: 12, fontSize: 14, borderWidth: 0 }
      : {}),
  },
  categoryPickerItem: { color: '#fff', backgroundColor: '#111827', fontSize: 14 },
  resultsList: { flex: 1 },
  listContent: { padding: 16, gap: 10, paddingBottom: 40 },
  emptyText: { color: '#6b7280', textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: '#111827', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1f2937' },
  cardResolved: { opacity: 0.55 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  cardTime: { color: '#6b7280', fontSize: 11 },
  reasonPill: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(59, 130, 246, 0.12)', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8,
  },
  reasonPillText: { color: '#60a5fa', fontSize: 12, fontWeight: '600' },
  detailsText: { color: '#d1d5db', fontSize: 13, lineHeight: 18, marginBottom: 10 },
  resolveButton: { backgroundColor: '#9333ea', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  reopenButton: { backgroundColor: '#374151' },
  resolveButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
