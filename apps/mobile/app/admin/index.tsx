// Admin hub — KPI glance + nav into the three list screens. Gated by
// useAdminScope() (bounces non-admins back to /(app)). Scoped to
// whatever campus is selected in the filter row; "All" for a god-mode
// admin genuinely means every tenant, enforced server-side by the RLS
// policies in migration 037 regardless of what this UI requests.

import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAdminScope } from '../../lib/adminScope';
import CampusFilter, { useCampusOptions } from '../../components/admin/CampusFilter';

type Kpis = {
  activeUsers: number;
  signupsToday: number;
  matchesToday: number;
  messagesToday: number;
  openReports: number;
  openFeedback: number;
};

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function AdminHub() {
  const router = useRouter();
  const scope = useAdminScope();
  const campusOptions = useCampusOptions(scope.adminCampuses);
  const [selectedCampus, setSelectedCampus] = useState<string | null>(null);
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [loadingKpis, setLoadingKpis] = useState(true);

  const loadKpis = useCallback(async () => {
    setLoadingKpis(true);
    const todayIso = startOfTodayIso();

    // profiles-based counts can filter by email_domain directly.
    let activeUsersQ = supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true);
    let signupsTodayQ = supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', todayIso);
    if (selectedCampus) {
      activeUsersQ = activeUsersQ.eq('email_domain', selectedCampus);
      signupsTodayQ = signupsTodayQ.eq('email_domain', selectedCampus);
    }

    // matches/messages/reports/feedback don't carry email_domain
    // directly — when a specific campus is selected, resolve it to a
    // set of profile ids first and filter on those. RLS still enforces
    // the real boundary either way; this is just for the requested slice.
    let profileIdsInCampus: string[] | null = null;
    if (selectedCampus) {
      const { data } = await supabase.from('profiles').select('id').eq('email_domain', selectedCampus);
      profileIdsInCampus = (data ?? []).map((p) => p.id);
    }

    let matchesTodayQ = supabase.from('matches').select('id', { count: 'exact', head: true }).gte('created_at', todayIso);
    if (profileIdsInCampus) matchesTodayQ = matchesTodayQ.in('user1_id', profileIdsInCampus);

    let messagesTodayQ = supabase.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', todayIso);
    if (profileIdsInCampus) messagesTodayQ = messagesTodayQ.in('sender_id', profileIdsInCampus);

    let openReportsQ = supabase.from('reports').select('id', { count: 'exact', head: true }).is('resolved_at', null);
    if (profileIdsInCampus) openReportsQ = openReportsQ.in('reported_user_id', profileIdsInCampus);

    let openFeedbackQ = supabase.from('feedback').select('id', { count: 'exact', head: true }).is('resolved_at', null);
    if (profileIdsInCampus) openFeedbackQ = openFeedbackQ.in('user_id', profileIdsInCampus);

    const [activeUsers, signupsToday, matchesToday, messagesToday, openReports, openFeedback] = await Promise.all([
      activeUsersQ, signupsTodayQ, matchesTodayQ, messagesTodayQ, openReportsQ, openFeedbackQ,
    ]);

    setKpis({
      activeUsers: activeUsers.count ?? 0,
      signupsToday: signupsToday.count ?? 0,
      matchesToday: matchesToday.count ?? 0,
      messagesToday: messagesToday.count ?? 0,
      openReports: openReports.count ?? 0,
      openFeedback: openFeedback.count ?? 0,
    });
    setLoadingKpis(false);
  }, [selectedCampus]);

  useEffect(() => {
    if (!scope.isAdmin) return;
    loadKpis();
  }, [scope.isAdmin, loadKpis]);

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
        {/* Explicit target, not router.back() — back() silently no-ops
            when this screen was reached by a direct URL load or a
            refresh (no in-app history to pop), which is exactly how
            admins often land here. */}
        <TouchableOpacity onPress={() => router.push('/(app)/profile')} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin</Text>
        <TouchableOpacity onPress={loadKpis} hitSlop={12}>
          <Ionicons name="refresh" size={22} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <CampusFilter options={campusOptions} selected={selectedCampus} onChange={setSelectedCampus} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loadingKpis || !kpis ? (
          <ActivityIndicator color="#9333ea" style={{ marginTop: 24 }} />
        ) : (
          <View style={styles.kpiGrid}>
            <KpiTile label="Active users" value={kpis.activeUsers} icon="people-outline" />
            <KpiTile label="Signups today" value={kpis.signupsToday} icon="person-add-outline" />
            <KpiTile label="Matches today" value={kpis.matchesToday} icon="planet-outline" />
            <KpiTile label="Messages today" value={kpis.messagesToday} icon="chatbubbles-outline" />
            <KpiTile label="Open reports" value={kpis.openReports} icon="flag-outline" alert={kpis.openReports > 0} />
            <KpiTile label="Open feedback" value={kpis.openFeedback} icon="chatbox-ellipses-outline" alert={kpis.openFeedback > 0} />
          </View>
        )}

        <View style={styles.navSection}>
          <AdminNavRow icon="search-outline" label="User lookup" onPress={() => router.push('/admin/users')} />
          <AdminNavRow icon="flag-outline" label="Reports queue" badge={kpis?.openReports} onPress={() => router.push('/admin/reports')} />
          <AdminNavRow icon="chatbox-ellipses-outline" label="Feedback inbox" badge={kpis?.openFeedback} onPress={() => router.push('/admin/feedback')} />
          <AdminNavRow icon="construct-outline" label="Tools" onPress={() => router.push('/admin/tools')} />
        </View>
      </ScrollView>
    </View>
  );
}

function KpiTile({ label, value, icon, alert }: { label: string; value: number; icon: any; alert?: boolean }) {
  return (
    <View style={[styles.kpiTile, alert && styles.kpiTileAlert]}>
      <Ionicons name={icon} size={20} color={alert ? '#f87171' : '#c084fc'} />
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function AdminNavRow({ icon, label, badge, onPress }: { icon: any; label: string; badge?: number; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.navRow} onPress={onPress}>
      <Ionicons name={icon} size={22} color="#fff" />
      <Text style={styles.navRowLabel}>{label}</Text>
      {!!badge && (
        <View style={styles.navBadge}>
          <Text style={styles.navBadgeText}>{badge}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color="#6b7280" />
    </TouchableOpacity>
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
  scrollContent: { padding: 16, paddingBottom: 60 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpiTile: {
    width: '31%', backgroundColor: '#111827', borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: '#1f2937', gap: 4,
  },
  kpiTileAlert: { borderColor: 'rgba(248, 113, 113, 0.4)', backgroundColor: 'rgba(248, 113, 113, 0.06)' },
  kpiValue: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  kpiLabel: { color: '#9ca3af', fontSize: 11 },
  navSection: { marginTop: 24, gap: 10 },
  navRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#111827', borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: '#1f2937',
  },
  navRowLabel: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1 },
  navBadge: { backgroundColor: '#ef4444', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginRight: 4 },
  navBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
