// User lookup — search by alias or email, tap a result for a detail
// sheet with report counts, current match, and light moderation
// actions (flag / ban). Search runs through admin_search_users() (see
// migration 038) since email lives in auth.users, not directly
// queryable from the client even for admins.

import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Modal, Alert, Switch, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAdminScope } from '../../lib/adminScope';
import CampusFilter, { useCampusOptions } from '../../components/admin/CampusFilter';

type SearchRow = {
  id: string;
  email: string | null;
  display_alias: string;
  email_domain: string;
  is_active: boolean;
  is_admin: boolean;
  flagged: boolean;
  created_at: string;
};

type Detail = SearchRow & {
  reportsAgainst: number;
  reportsBy: number;
  activeMatchAlias: string | null;
};

export default function AdminUsers() {
  const router = useRouter();
  const scope = useAdminScope();
  const campusOptions = useCampusOptions(scope.adminCampuses);
  const [selectedCampus, setSelectedCampus] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const runSearch = useCallback(async (q: string, campus: string | null) => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_search_users', { p_query: q, p_campus: campus });
    if (error) console.warn('admin_search_users failed:', error);
    setResults((data ?? []) as SearchRow[]);
    setLoading(false);
  }, []);

  const openDetail = async (row: SearchRow) => {
    setDetailLoading(true);
    setDetail({ ...row, reportsAgainst: 0, reportsBy: 0, activeMatchAlias: null });
    const [against, by, activeMatch] = await Promise.all([
      supabase.from('reports').select('id', { count: 'exact', head: true }).eq('reported_user_id', row.id),
      supabase.from('reports').select('id', { count: 'exact', head: true }).eq('reporter_id', row.id),
      supabase.from('matches')
        .select('user1_id, user2_id')
        .eq('status', 'active')
        .or(`user1_id.eq.${row.id},user2_id.eq.${row.id}`)
        .maybeSingle(),
    ]);
    let activeMatchAlias: string | null = null;
    if (activeMatch.data) {
      const partnerId = activeMatch.data.user1_id === row.id ? activeMatch.data.user2_id : activeMatch.data.user1_id;
      const { data: partner } = await supabase.from('profiles').select('display_alias').eq('id', partnerId).maybeSingle();
      activeMatchAlias = partner?.display_alias ?? null;
    }
    setDetail({
      ...row,
      reportsAgainst: against.count ?? 0,
      reportsBy: by.count ?? 0,
      activeMatchAlias,
    });
    setDetailLoading(false);
  };

  const toggleFlag = async (row: Detail, next: boolean) => {
    const { error } = await supabase.from('profiles').update({ flagged: next }).eq('id', row.id);
    if (error) { Alert.alert('Failed', error.message); return; }
    setDetail({ ...row, flagged: next });
    setResults((prev) => prev.map((r) => (r.id === row.id ? { ...r, flagged: next } : r)));
  };

  const confirmBan = (row: Detail) => {
    Alert.alert(
      `Ban ${row.display_alias}?`,
      'This sets their account inactive — they can no longer sign in or be matched. Reversible from here.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Ban',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from('profiles').update({ is_active: false }).eq('id', row.id);
            if (error) { Alert.alert('Failed', error.message); return; }
            setDetail({ ...row, is_active: false });
            setResults((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_active: false } : r)));
          },
        },
      ],
    );
  };

  const unban = async (row: Detail) => {
    const { error } = await supabase.from('profiles').update({ is_active: true }).eq('id', row.id);
    if (error) { Alert.alert('Failed', error.message); return; }
    setDetail({ ...row, is_active: true });
    setResults((prev) => prev.map((r) => (r.id === row.id ? { ...r, is_active: true } : r)));
  };

  // Delete — the one truly irreversible admin action, so it gets a
  // typed-confirmation modal (type the exact alias) rather than a
  // single Alert tap. admin_delete_user (migration 041) does the same
  // cascade as a user's own "Delete Account" in Settings.
  const [deleteTarget, setDeleteTarget] = useState<Detail | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const closeDeleteModal = () => { setDeleteTarget(null); setDeleteConfirmText(''); };
  const runDelete = async () => {
    if (!deleteTarget || deleteConfirmText !== deleteTarget.display_alias) return;
    setDeleteBusy(true);
    const { error } = await supabase.rpc('admin_delete_user', { p_user_id: deleteTarget.id });
    setDeleteBusy(false);
    if (error) { Alert.alert('Failed', error.message); return; }
    setResults((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    closeDeleteModal();
    setDetail(null);
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
        <Text style={styles.headerTitle}>User Lookup</Text>
        <View style={{ width: 26 }} />
      </View>

      <CampusFilter
        options={campusOptions}
        selected={selectedCampus}
        onChange={(c) => { setSelectedCampus(c); runSearch(query, c); }}
      />

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={18} color="#6b7280" />
        <TextInput
          style={styles.searchInput}
          placeholder="Alias or email…"
          placeholderTextColor="#6b7280"
          value={query}
          onChangeText={(t) => { setQuery(t); runSearch(t, selectedCampus); }}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {loading && <ActivityIndicator size="small" color="#9333ea" />}
      </View>

      <FlatList
        data={results}
        keyExtractor={(r) => r.id}
        style={styles.resultsList}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={!loading ? <Text style={styles.emptyText}>No results yet — start typing.</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.resultRow} onPress={() => openDetail(item)}>
            <View style={{ flex: 1 }}>
              <View style={styles.resultAliasRow}>
                <Text style={styles.resultAlias}>{item.display_alias}</Text>
                {item.is_admin && <Ionicons name="shield-checkmark" size={14} color="#9333ea" style={{ marginLeft: 6 }} />}
                {item.flagged && <Ionicons name="flag" size={13} color="#f59e0b" style={{ marginLeft: 6 }} />}
                {!item.is_active && <Text style={styles.bannedTag}>BANNED</Text>}
              </View>
              <Text style={styles.resultMeta}>{item.email} · {item.email_domain}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#6b7280" />
          </TouchableOpacity>
        )}
      />

      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setDetail(null)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            {detail && (
              <>
                <Text style={styles.modalTitle}>{detail.display_alias}</Text>
                <Text style={styles.modalSubtitle}>{detail.email}</Text>

                <View style={styles.detailGrid}>
                  <DetailStat label="Campus" value={detail.email_domain} />
                  <DetailStat label="Joined" value={new Date(detail.created_at).toLocaleDateString()} />
                  <DetailStat label="Reports filed against" value={String(detail.reportsAgainst)} alert={detail.reportsAgainst > 0} />
                  <DetailStat label="Reports they filed" value={String(detail.reportsBy)} />
                </View>

                <Text style={styles.currentMatchLabel}>
                  {detail.activeMatchAlias ? `Currently matched with ${detail.activeMatchAlias}` : 'No active match'}
                </Text>

                <View style={styles.actionRow}>
                  <View style={{ flex: 1, marginRight: 12 }}>
                    <Text style={styles.actionLabel}>Flagged for review</Text>
                    <Text style={styles.actionHint}>
                      Admin-only marker — shows a 🚩 in search results. Doesn't affect matching or their access.
                    </Text>
                  </View>
                  <Switch
                    value={detail.flagged}
                    onValueChange={(v) => toggleFlag(detail, v)}
                    trackColor={{ false: '#374151', true: '#f59e0b' }}
                    thumbColor="#fff"
                  />
                </View>

                <Text style={styles.actionHint}>
                  {detail.is_active
                    ? "Ban signs them out immediately and shows a suspended screen on their next visit. Doesn't delete anything — fully reversible."
                    : 'Unban restores full access on their next visit.'}
                </Text>
                {detail.is_active ? (
                  <TouchableOpacity style={styles.banButton} onPress={() => confirmBan(detail)}>
                    <Ionicons name="ban-outline" size={18} color="#fff" />
                    <Text style={styles.banButtonText}>Ban account</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.unbanButton} onPress={() => unban(detail)}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={styles.banButtonText}>Unban account</Text>
                  </TouchableOpacity>
                )}

                <Text style={[styles.actionHint, { marginTop: 20 }]}>
                  Permanently deletes their account, matches, messages, and reports. This cannot be undone.
                </Text>
                <TouchableOpacity style={styles.deleteButton} onPress={() => setDeleteTarget(detail)}>
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                  <Text style={styles.banButtonText}>Delete account</Text>
                </TouchableOpacity>

                {detailLoading && <ActivityIndicator color="#9333ea" style={{ marginTop: 8 }} />}
              </>
            )}
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setDetail(null)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete confirmation — typed-alias guard, not just a tap-through
          Alert, since this is the one truly irreversible action here. */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={closeDeleteModal}>
        <Pressable style={styles.modalOverlay} onPress={closeDeleteModal}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            {deleteTarget && (
              <>
                <Ionicons name="warning-outline" size={28} color="#f87171" style={{ alignSelf: 'center', marginBottom: 8 }} />
                <Text style={styles.modalTitle}>Delete {deleteTarget.display_alias}?</Text>
                <Text style={styles.modalSubtitle}>
                  This permanently deletes their account, matches, messages, and reports. It cannot be undone.
                </Text>
                <Text style={styles.deleteConfirmLabel}>
                  Type <Text style={{ fontWeight: '800', color: '#fff' }}>{deleteTarget.display_alias}</Text> to confirm:
                </Text>
                <TextInput
                  style={styles.deleteConfirmInput}
                  value={deleteConfirmText}
                  onChangeText={setDeleteConfirmText}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={deleteTarget.display_alias}
                  placeholderTextColor="#4b5563"
                />
                <TouchableOpacity
                  style={[
                    styles.deleteButton,
                    { marginTop: 16 },
                    (deleteConfirmText !== deleteTarget.display_alias || deleteBusy) && { opacity: 0.4 },
                  ]}
                  onPress={runDelete}
                  disabled={deleteConfirmText !== deleteTarget.display_alias || deleteBusy}
                >
                  {deleteBusy ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="trash-outline" size={18} color="#fff" />
                      <Text style={styles.banButtonText}>Permanently delete</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalCloseButton} onPress={closeDeleteModal}>
                  <Text style={styles.modalCloseText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function DetailStat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <View style={styles.detailStat}>
      <Text style={[styles.detailStatValue, alert && { color: '#f87171' }]}>{value}</Text>
      <Text style={styles.detailStatLabel}>{label}</Text>
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
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: '#111827', borderRadius: 12, borderWidth: 1, borderColor: '#374151',
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 15 },
  // Explicit flex:1 on the FlatList itself (not just contentContainerStyle)
  // is what actually bounds it to the remaining screen space on web —
  // without it the list grows to fit its content and the whole PAGE
  // scrolls instead, dragging the header/campus picker out of view.
  resultsList: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 8 },
  emptyText: { color: '#6b7280', textAlign: 'center', marginTop: 40 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#111827', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#1f2937',
  },
  resultAliasRow: { flexDirection: 'row', alignItems: 'center' },
  resultAlias: { color: '#fff', fontSize: 15, fontWeight: '600' },
  resultMeta: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  bannedTag: { color: '#f87171', fontSize: 10, fontWeight: '700', marginLeft: 8, letterSpacing: 0.5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#111827', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', textAlign: 'center' },
  modalSubtitle: { color: '#9ca3af', fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 20 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  detailStat: { width: '47%', backgroundColor: '#030712', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1f2937' },
  detailStatValue: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  detailStatLabel: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  currentMatchLabel: { color: '#c084fc', fontSize: 13, marginBottom: 20 },
  actionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#1f2937',
  },
  actionLabel: { color: '#fff', fontSize: 14 },
  actionHint: { color: '#6b7280', fontSize: 11, lineHeight: 15, marginTop: 3 },
  banButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#dc2626', borderRadius: 12, paddingVertical: 14, marginTop: 16,
  },
  unbanButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#16a34a', borderRadius: 12, paddingVertical: 14, marginTop: 16,
  },
  banButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  deleteButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#7f1d1d', borderRadius: 12, paddingVertical: 14,
    borderWidth: 1, borderColor: '#dc2626',
  },
  deleteConfirmLabel: { color: '#d1d5db', fontSize: 13, marginTop: 16, marginBottom: 8, textAlign: 'center' },
  deleteConfirmInput: {
    backgroundColor: '#030712', borderWidth: 1, borderColor: '#374151', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15, textAlign: 'center',
  },
  modalCloseButton: { marginTop: 20, alignItems: 'center', paddingVertical: 16, backgroundColor: '#1f2937', borderRadius: 12 },
  modalCloseText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
