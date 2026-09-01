// Reports queue — open by default, toggle to include resolved. Each
// row shows both aliases, reason/details, and a resolve/reopen action.
// RLS (migration 037) already scopes what comes back to the admin's
// campus access; the campus filter here just narrows the request.

import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAdminScope } from '../../lib/adminScope';
import CampusFilter, { useCampusOptions } from '../../components/admin/CampusFilter';

type ReportRow = {
  id: string;
  reason: string;
  details: string | null;
  created_at: string;
  resolved_at: string | null;
  match_id: string | null;
  reporter: { display_alias: string; email_domain: string } | null;
  reported: { display_alias: string } | null;
};

export default function AdminReports() {
  const router = useRouter();
  const scope = useAdminScope();
  const campusOptions = useCampusOptions(scope.adminCampuses);
  const [selectedCampus, setSelectedCampus] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('reports')
      .select(`
        id, reason, details, created_at, resolved_at, match_id,
        reporter:profiles!reports_reporter_id_fkey(display_alias, email_domain),
        reported:profiles!reports_reported_user_id_fkey(display_alias)
      `)
      .order('created_at', { ascending: false });
    if (!showResolved) q = q.is('resolved_at', null);
    const { data, error } = await q;
    if (error) console.warn('reports load failed:', error);
    let list = (data ?? []) as unknown as ReportRow[];
    if (selectedCampus) {
      list = list.filter((r) => r.reporter?.email_domain === selectedCampus);
    }
    setRows(list);
    setLoading(false);
  }, [showResolved, selectedCampus]);

  useEffect(() => {
    if (!scope.isAdmin) return;
    load();
  }, [scope.isAdmin, load]);

  const toggleResolved = async (row: ReportRow) => {
    setBusyId(row.id);
    const { data: userData } = await supabase.auth.getUser();
    const nextResolvedAt = row.resolved_at ? null : new Date().toISOString();
    const { error } = await supabase
      .from('reports')
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
        <Text style={styles.headerTitle}>Reports</Text>
        <TouchableOpacity onPress={() => setShowResolved((v) => !v)}>
          <Text style={styles.toggleText}>{showResolved ? 'Hide resolved' : 'Show resolved'}</Text>
        </TouchableOpacity>
      </View>

      <CampusFilter options={campusOptions} selected={selectedCampus} onChange={setSelectedCampus} />

      {loading ? (
        <ActivityIndicator color="#9333ea" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          style={styles.resultsList}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.emptyText}>No {showResolved ? '' : 'open '}reports.</Text>}
          renderItem={({ item }) => (
            <View style={[styles.card, item.resolved_at && styles.cardResolved]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  {item.reporter?.display_alias ?? 'Unknown'} → {item.reported?.display_alias ?? 'Unknown'}
                </Text>
                <Text style={styles.cardTime}>{new Date(item.created_at).toLocaleString()}</Text>
              </View>
              <View style={styles.reasonPill}>
                <Text style={styles.reasonPillText}>{item.reason}</Text>
              </View>
              {!!item.details && <Text style={styles.detailsText}>{item.details}</Text>}
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
  resultsList: { flex: 1 },
  listContent: { padding: 16, gap: 10, paddingBottom: 40 },
  emptyText: { color: '#6b7280', textAlign: 'center', marginTop: 40 },
  card: { backgroundColor: '#111827', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#1f2937' },
  cardResolved: { opacity: 0.55 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  cardTime: { color: '#6b7280', fontSize: 11 },
  reasonPill: {
    alignSelf: 'flex-start', backgroundColor: 'rgba(239, 68, 68, 0.12)', borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 4, marginBottom: 8,
  },
  reasonPillText: { color: '#f87171', fontSize: 12, fontWeight: '600' },
  detailsText: { color: '#d1d5db', fontSize: 13, lineHeight: 18, marginBottom: 10 },
  resolveButton: { backgroundColor: '#9333ea', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  reopenButton: { backgroundColor: '#374151' },
  resolveButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
