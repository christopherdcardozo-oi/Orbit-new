// Admin tools — schedule match (13) and broadcast announcement (14),
// the two remaining optional items from the original build plan.
// Both call SECURITY DEFINER RPCs (migrations 041/042) that hand-check
// admin_users authorization + campus scope internally.

import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Pressable, Modal, ScrollView, Switch, Platform } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAdminScope } from '../../lib/adminScope';
import CampusFilter, { useCampusOptions } from '../../components/admin/CampusFilter';

type SearchRow = { id: string; display_alias: string; email: string | null; email_domain: string };

// Curated instead of free text — every campus so far is a US school,
// and a typo'd/invalid IANA string here would silently break the
// midnight-reset math everywhere it's used (reset-matches, the 8am
// morning brief, 1hr/10min warnings, daily stats — all keyed off
// `AT TIME ZONE university_config.timezone`).
const US_TIMEZONES = [
  { label: 'Eastern (America/New_York)', value: 'America/New_York' },
  { label: 'Central (America/Chicago)', value: 'America/Chicago' },
  { label: 'Mountain (America/Denver)', value: 'America/Denver' },
  { label: 'Mountain — Arizona, no DST (America/Phoenix)', value: 'America/Phoenix' },
  { label: 'Pacific (America/Los_Angeles)', value: 'America/Los_Angeles' },
  { label: 'Alaska (America/Anchorage)', value: 'America/Anchorage' },
  { label: 'Hawaii (Pacific/Honolulu)', value: 'Pacific/Honolulu' },
];

// Small inline search-and-pick used twice below for the manual-match
// user pickers. Not the full admin/users.tsx experience — just enough
// to find someone by alias/email and lock in their id.
function UserPicker({ label, picked, onPick }: { label: string; picked: SearchRow | null; onPick: (u: SearchRow | null) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    const { data } = await supabase.rpc('admin_search_users', { p_query: q, p_campus: null });
    setResults(((data ?? []) as SearchRow[]).slice(0, 6));
    setLoading(false);
  }, []);

  if (picked) {
    return (
      <View style={styles.pickerWrap}>
        <Text style={styles.pickerLabel}>{label}</Text>
        <View style={styles.pickedRow}>
          <Text style={styles.pickedText}>{picked.display_alias}</Text>
          <TouchableOpacity onPress={() => onPick(null)} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.pickerWrap}>
      <Text style={styles.pickerLabel}>{label}</Text>
      <TextInput
        style={styles.pickerInput}
        placeholder="Alias or email…"
        placeholderTextColor="#6b7280"
        value={query}
        onChangeText={(t) => { setQuery(t); search(t); }}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {loading && <ActivityIndicator size="small" color="#9333ea" style={{ marginTop: 8 }} />}
      {results.map((r) => (
        <TouchableOpacity key={r.id} style={styles.pickerResultRow} onPress={() => { onPick(r); setResults([]); setQuery(''); }}>
          <Text style={styles.pickerResultAlias}>{r.display_alias}</Text>
          <Text style={styles.pickerResultMeta}>{r.email}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

type University = { email_domain: string; university_name: string; timezone: string | null; is_active: boolean };

// Collapsible wrapper for each tools section — title + hint always
// visible, tap to expand/collapse the body. Defaults closed so the
// screen reads as a menu of what's available instead of three full
// forms stacked on top of each other.
function CollapsibleSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setOpen((v) => !v)} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {!open && <Text style={styles.sectionHint} numberOfLines={1}>{hint}</Text>}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color="#9ca3af" />
      </TouchableOpacity>
      {open && (
        <>
          <Text style={styles.sectionHint}>{hint}</Text>
          {children}
        </>
      )}
    </View>
  );
}

export default function AdminTools() {
  const router = useRouter();
  const scope = useAdminScope();
  const campusOptions = useCampusOptions(scope.adminCampuses);

  // ---------- Campuses (migration 045) — global admins only (adding
  // or retiring an entire campus is a platform-level decision, not
  // something a single-campus moderator should be able to do even
  // once that role exists; RLS enforces this server-side too, this
  // client check just avoids showing controls that would 403). ----------
  const isGlobalAdmin = scope.isAdmin && scope.adminCampuses === null;
  const [universities, setUniversities] = useState<University[]>([]);
  const [universitiesLoading, setUniversitiesLoading] = useState(true);
  const [newDomain, setNewDomain] = useState('');
  const [newName, setNewName] = useState('');
  const [newTimezone, setNewTimezone] = useState('America/Chicago');
  const [addCampusBusy, setAddCampusBusy] = useState(false);
  const [addCampusError, setAddCampusError] = useState<string | null>(null);
  const [campusToggleBusy, setCampusToggleBusy] = useState<string | null>(null);
  // Dropdown-driven instead of a stacked list — scales to more than a
  // handful of campuses. '__add__' is the sentinel for "show the add
  // form"; a real email_domain shows that campus's detail panel.
  const ADD_CAMPUS_SENTINEL = '__add__';
  const [selectedCampusDomain, setSelectedCampusDomain] = useState<string>('');
  const selectedUniversity = universities.find((u) => u.email_domain === selectedCampusDomain) ?? null;

  // Detail panel opens read-only (name/domain/timezone as plain text +
  // the Active toggle, which stays a one-tap action even in display
  // mode). Editing name/domain/timezone requires an explicit "Edit"
  // tap — domain especially is not something to change by accident,
  // since it's effectively this row's primary key (see migration 046).
  const [campusEditing, setCampusEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDomain, setEditDomain] = useState('');
  const [editTimezone, setEditTimezone] = useState('');
  const [campusSaveBusy, setCampusSaveBusy] = useState(false);
  const [campusSaveError, setCampusSaveError] = useState<string | null>(null);

  useEffect(() => {
    setCampusEditing(false);
    setCampusSaveError(null);
    setEditName(selectedUniversity?.university_name ?? '');
    setEditDomain(selectedUniversity?.email_domain ?? '');
    setEditTimezone(selectedUniversity?.timezone ?? US_TIMEZONES[0].value);
  }, [selectedCampusDomain]);

  const saveCampusEdits = async () => {
    if (!selectedUniversity) return;
    const name = editName.trim();
    const domain = editDomain.trim().toLowerCase();
    const tz = editTimezone.trim();
    if (!name || !domain) return;
    setCampusSaveBusy(true);
    setCampusSaveError(null);

    let currentKey = selectedUniversity.email_domain;
    if (domain !== selectedUniversity.email_domain) {
      const { error: renameError } = await supabase.rpc('admin_rename_campus_domain', {
        p_old_domain: selectedUniversity.email_domain,
        p_new_domain: domain,
      });
      if (renameError) {
        setCampusSaveBusy(false);
        setCampusSaveError(renameError.message);
        return;
      }
      currentKey = domain;
    }

    if (name !== selectedUniversity.university_name || tz !== selectedUniversity.timezone) {
      const { error: updateError } = await supabase
        .from('university_config')
        .update({ university_name: name, timezone: tz })
        .eq('email_domain', currentKey);
      if (updateError) {
        setCampusSaveBusy(false);
        setCampusSaveError(updateError.message);
        return;
      }
    }

    setCampusSaveBusy(false);
    setCampusEditing(false);
    await loadUniversities();
    setSelectedCampusDomain(currentKey);
  };

  // Delete is guarded server-side too (admin_delete_campus raises if any
  // profile still points at the domain) — the typed-domain confirmation
  // here is just the same irreversible-action pattern as user deletion,
  // not the actual safety check.
  const [campusDeleteOpen, setCampusDeleteOpen] = useState(false);
  const [campusDeleteConfirmText, setCampusDeleteConfirmText] = useState('');
  const [campusDeleteBusy, setCampusDeleteBusy] = useState(false);
  const [campusDeleteError, setCampusDeleteError] = useState<string | null>(null);
  const closeCampusDelete = () => { setCampusDeleteOpen(false); setCampusDeleteConfirmText(''); setCampusDeleteError(null); };

  const runDeleteCampus = async () => {
    if (!selectedUniversity || campusDeleteConfirmText !== selectedUniversity.email_domain) return;
    setCampusDeleteBusy(true);
    setCampusDeleteError(null);
    const { error } = await supabase.rpc('admin_delete_campus', { p_domain: selectedUniversity.email_domain });
    setCampusDeleteBusy(false);
    if (error) { setCampusDeleteError(error.message); return; }
    closeCampusDelete();
    setSelectedCampusDomain('');
    await loadUniversities();
  };

  const loadUniversities = useCallback(async () => {
    setUniversitiesLoading(true);
    const { data } = await supabase
      .from('university_config')
      .select('email_domain, university_name, timezone, is_active')
      .order('university_name');
    setUniversities((data ?? []) as University[]);
    setUniversitiesLoading(false);
  }, []);

  useEffect(() => {
    if (isGlobalAdmin) loadUniversities();
  }, [isGlobalAdmin, loadUniversities]);

  const addCampus = async (): Promise<boolean> => {
    const domain = newDomain.trim().toLowerCase();
    const name = newName.trim();
    const tz = newTimezone.trim() || 'America/Chicago';
    if (!domain || !name) return false;
    setAddCampusBusy(true);
    setAddCampusError(null);
    const { error } = await supabase
      .from('university_config')
      .insert({ email_domain: domain, university_name: name, timezone: tz, is_active: true });
    setAddCampusBusy(false);
    if (error) { setAddCampusError(error.message); return false; }
    setNewDomain(''); setNewName(''); setNewTimezone('America/Chicago');
    await loadUniversities();
    return true;
  };

  const toggleCampusActive = async (domain: string, next: boolean) => {
    setCampusToggleBusy(domain);
    const { error } = await supabase
      .from('university_config')
      .update({ is_active: next })
      .eq('email_domain', domain);
    setCampusToggleBusy(null);
    if (error) { setAddCampusError(error.message); return; }
    setUniversities((prev) => prev.map((u) => (u.email_domain === domain ? { ...u, is_active: next } : u)));
  };

  // ---------- Manual match ----------
  const [user1, setUser1] = useState<SearchRow | null>(null);
  const [user2, setUser2] = useState<SearchRow | null>(null);
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchConfirmOpen, setMatchConfirmOpen] = useState(false);
  const [matchResultMsg, setMatchResultMsg] = useState<string | null>(null);

  // admin_schedule_match (migration 042): if both people are free right
  // now, pairs them immediately, same as before. If either already has
  // an active match, it queues the pairing instead of failing — applied
  // automatically at that campus's next midnight reset, ahead of the
  // normal matchmaking algorithm (see reset-matches' scheduled-matches
  // fulfillment step).
  const sameUserPicked = !!user1 && !!user2 && user1.id === user2.id;

  const runScheduleMatch = async () => {
    if (!user1 || !user2 || sameUserPicked) return;
    setMatchBusy(true);
    const { data, error } = await supabase.rpc('admin_schedule_match', {
      p_user1_id: user1.id, p_user2_id: user2.id,
    });
    setMatchBusy(false);
    setMatchConfirmOpen(false);
    if (error) { setMatchResultMsg(`Failed: ${error.message}`); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.status === 'immediate') {
      setMatchResultMsg(`✓ ${user1.display_alias} ↔ ${user2.display_alias} matched right now.`);
    } else {
      setMatchResultMsg(`✓ Scheduled — one of them is currently matched, so ${user1.display_alias} ↔ ${user2.display_alias} will pair automatically at the next reset.`);
    }
    setUser1(null); setUser2(null);
  };

  // ---------- Broadcast ----------
  const [broadcastCampus, setBroadcastCampus] = useState<string | null>(null);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [lastSentCount, setLastSentCount] = useState<number | null>(null);

  const [broadcastError, setBroadcastError] = useState<string | null>(null);
  const closeConfirm = () => { setConfirmOpen(false); setConfirmText(''); };

  const sendBroadcast = async () => {
    if (confirmText !== 'SEND') return;
    setBroadcastBusy(true);
    setBroadcastError(null);
    const { data, error } = await supabase.rpc('admin_broadcast_push', {
      p_campus: broadcastCampus,
      p_title: broadcastTitle.trim(),
      p_body: broadcastBody.trim(),
    });
    setBroadcastBusy(false);
    if (error) { setBroadcastError(error.message); return; }
    setLastSentCount(typeof data === 'number' ? data : null);
    closeConfirm();
    setBroadcastTitle('');
    setBroadcastBody('');
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
        <Text style={styles.headerTitle}>Tools</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
        {/* ---------- Campuses (global admins only) ---------- */}
        {isGlobalAdmin && (
          <CollapsibleSection
            title="Campuses"
            hint="Add new campuses and turn signups on/off. Only active campuses accept new signups, appear in filters, and get matched nightly."
          >
            {universitiesLoading ? (
              <ActivityIndicator color="#9333ea" style={{ marginVertical: 8 }} />
            ) : (
              <>
                <Text style={styles.pickerLabel}>Select a campus, or add a new one</Text>
                <View style={styles.campusPickerContainer}>
                  <Picker
                    selectedValue={selectedCampusDomain}
                    onValueChange={(val) => setSelectedCampusDomain(String(val))}
                    style={styles.campusPicker}
                    itemStyle={styles.campusPickerItem}
                  >
                    <Picker.Item label="— Select —" value="" />
                    <Picker.Item label="＋ Add new campus" value={ADD_CAMPUS_SENTINEL} />
                    {universities.map((u) => (
                      <Picker.Item
                        key={u.email_domain}
                        label={`${u.is_active ? '🟢' : '⚪'} ${u.university_name}`}
                        value={u.email_domain}
                      />
                    ))}
                  </Picker>
                </View>

                {/* ---- Detail panel for an existing campus ---- */}
                {selectedUniversity && !campusEditing && (
                  <View style={styles.campusEditPanel}>
                    <View style={styles.campusRow}>
                      <View style={{ flex: 1, marginRight: 12 }}>
                        <Text style={styles.campusName}>{selectedUniversity.university_name}</Text>
                        <Text style={styles.campusMeta}>{selectedUniversity.email_domain}</Text>
                        <Text style={styles.campusMeta}>
                          {US_TIMEZONES.find((t) => t.value === selectedUniversity.timezone)?.label ?? selectedUniversity.timezone ?? '—'}
                        </Text>
                      </View>
                      {campusToggleBusy === selectedUniversity.email_domain ? (
                        <ActivityIndicator size="small" color="#9333ea" />
                      ) : (
                        <Switch
                          value={selectedUniversity.is_active}
                          onValueChange={(v) => toggleCampusActive(selectedUniversity.email_domain, v)}
                          trackColor={{ false: '#374151', true: '#16a34a' }}
                          thumbColor="#fff"
                        />
                      )}
                    </View>
                    <TouchableOpacity
                      style={[styles.primaryButton, { marginTop: 12 }]}
                      onPress={() => setCampusEditing(true)}
                    >
                      <Ionicons name="pencil-outline" size={16} color="#fff" />
                      <Text style={styles.primaryButtonText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.dangerButton}
                      onPress={() => setCampusDeleteOpen(true)}
                    >
                      <Ionicons name="trash-outline" size={16} color="#fff" />
                      <Text style={styles.primaryButtonText}>Delete Campus</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* ---- Edit form for an existing campus ---- */}
                {selectedUniversity && campusEditing && (
                  <View style={styles.campusEditPanel}>
                    <Text style={styles.pickerLabel}>Campus name</Text>
                    <TextInput
                      style={styles.pickerInput}
                      value={editName}
                      onChangeText={setEditName}
                      placeholder="e.g. University of Iowa"
                      placeholderTextColor="#6b7280"
                    />
                    <Text style={[styles.pickerLabel, { marginTop: 12 }]}>Email domain</Text>
                    <TextInput
                      style={styles.pickerInput}
                      value={editDomain}
                      onChangeText={setEditDomain}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="e.g. uiowa.edu"
                      placeholderTextColor="#6b7280"
                    />
                    <Text style={[styles.pickerLabel, { marginTop: 12 }]}>Timezone</Text>
                    <View style={styles.campusPickerContainer}>
                      <Picker
                        selectedValue={editTimezone}
                        onValueChange={(val) => setEditTimezone(String(val))}
                        style={styles.campusPicker}
                        itemStyle={styles.campusPickerItem}
                      >
                        {US_TIMEZONES.map((t) => (
                          <Picker.Item key={t.value} label={t.label} value={t.value} />
                        ))}
                      </Picker>
                    </View>
                    {campusSaveError && <Text style={styles.errorText}>{campusSaveError}</Text>}
                    <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
                      <TouchableOpacity
                        style={[styles.secondaryButton, { flex: 1 }]}
                        onPress={() => {
                          setCampusEditing(false);
                          setCampusSaveError(null);
                          setEditName(selectedUniversity.university_name);
                          setEditDomain(selectedUniversity.email_domain);
                          setEditTimezone(selectedUniversity.timezone ?? US_TIMEZONES[0].value);
                        }}
                        disabled={campusSaveBusy}
                      >
                        <Text style={styles.secondaryButtonText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.primaryButton,
                          { flex: 1 },
                          (campusSaveBusy || !editName.trim() || !editDomain.trim()) && { opacity: 0.4 },
                        ]}
                        onPress={saveCampusEdits}
                        disabled={campusSaveBusy || !editName.trim() || !editDomain.trim()}
                      >
                        {campusSaveBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Save</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* ---- Add-new-campus form ---- */}
                {selectedCampusDomain === ADD_CAMPUS_SENTINEL && (
                  <View style={styles.campusEditPanel}>
                    <Text style={styles.pickerLabel}>Campus name</Text>
                    <TextInput
                      style={styles.pickerInput}
                      placeholder="e.g. University of Iowa"
                      placeholderTextColor="#6b7280"
                      value={newName}
                      onChangeText={setNewName}
                    />
                    <Text style={[styles.pickerLabel, { marginTop: 12 }]}>Email domain</Text>
                    <TextInput
                      style={styles.pickerInput}
                      placeholder="e.g. uiowa.edu"
                      placeholderTextColor="#6b7280"
                      value={newDomain}
                      onChangeText={setNewDomain}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <Text style={[styles.pickerLabel, { marginTop: 12 }]}>Timezone</Text>
                    <View style={styles.campusPickerContainer}>
                      <Picker
                        selectedValue={newTimezone}
                        onValueChange={(val) => setNewTimezone(String(val))}
                        style={styles.campusPicker}
                        itemStyle={styles.campusPickerItem}
                      >
                        {US_TIMEZONES.map((t) => (
                          <Picker.Item key={t.value} label={t.label} value={t.value} />
                        ))}
                      </Picker>
                    </View>
                    {addCampusError && <Text style={styles.errorText}>{addCampusError}</Text>}
                    <TouchableOpacity
                      style={[styles.primaryButton, (!newDomain.trim() || !newName.trim() || addCampusBusy) && { opacity: 0.4 }]}
                      onPress={async () => {
                        const domain = newDomain.trim().toLowerCase();
                        const ok = await addCampus();
                        if (ok) setSelectedCampusDomain(domain);
                      }}
                      disabled={!newDomain.trim() || !newName.trim() || addCampusBusy}
                    >
                      {addCampusBusy ? <ActivityIndicator color="#fff" /> : (
                        <>
                          <Ionicons name="add-circle-outline" size={18} color="#fff" />
                          <Text style={styles.primaryButtonText}>Add Campus</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </CollapsibleSection>
        )}

        {/* ---------- Schedule match ---------- */}
        <CollapsibleSection
          title="Schedule Match"
          hint="Pairs two people on the same campus. If both are free right now, it's immediate. If either is already matched, it's queued and pairs them automatically at the next reset."
        >
          <UserPicker label="Person 1" picked={user1} onPick={setUser1} />
          <UserPicker label="Person 2" picked={user2} onPick={setUser2} />
          {sameUserPicked && (
            <Text style={[styles.sectionHint, { color: '#f87171', marginTop: -6, marginBottom: 8 }]}>
              Person 1 and Person 2 can't be the same person.
            </Text>
          )}
          <TouchableOpacity
            style={[styles.primaryButton, (!user1 || !user2 || sameUserPicked || matchBusy) && { opacity: 0.4 }]}
            onPress={() => setMatchConfirmOpen(true)}
            disabled={!user1 || !user2 || sameUserPicked || matchBusy}
          >
            <Ionicons name="planet-outline" size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>Schedule Match</Text>
          </TouchableOpacity>
          {matchResultMsg && <Text style={styles.successText}>{matchResultMsg}</Text>}
        </CollapsibleSection>

        {/* ---------- Broadcast ---------- */}
        <CollapsibleSection
          title="Broadcast announcement"
          hint="Sends one push notification to every active user in scope, right now. Pick a campus below, or leave on All."
        >
          <CampusFilter options={campusOptions} selected={broadcastCampus} onChange={setBroadcastCampus} />

          <Text style={styles.pickerLabel}>Title</Text>
          <TextInput
            style={styles.pickerInput}
            placeholder="e.g. Orbit is back up!"
            placeholderTextColor="#6b7280"
            value={broadcastTitle}
            onChangeText={setBroadcastTitle}
            maxLength={80}
          />
          <Text style={[styles.pickerLabel, { marginTop: 12 }]}>Message</Text>
          <TextInput
            style={[styles.pickerInput, { height: 80, textAlignVertical: 'top' }]}
            placeholder="What do you want everyone to know?"
            placeholderTextColor="#6b7280"
            value={broadcastBody}
            onChangeText={setBroadcastBody}
            multiline
            maxLength={300}
          />

          <TouchableOpacity
            style={[styles.dangerButton, (!broadcastTitle.trim() || !broadcastBody.trim()) && { opacity: 0.4 }]}
            onPress={() => setConfirmOpen(true)}
            disabled={!broadcastTitle.trim() || !broadcastBody.trim()}
          >
            <Ionicons name="megaphone-outline" size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>Send Broadcast</Text>
          </TouchableOpacity>

          {lastSentCount !== null && (
            <Text style={styles.successText}>✓ Sent to {lastSentCount} {lastSentCount === 1 ? 'person' : 'people'}.</Text>
          )}
        </CollapsibleSection>
      </ScrollView>

      {/* Schedule-match confirmation — lightweight (reversible: find
          and expire the match later if it was a mistake), unlike
          broadcast below which gets a typed guard. */}
      <Modal visible={matchConfirmOpen} transparent animationType="fade" onRequestClose={() => setMatchConfirmOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setMatchConfirmOpen(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Ionicons name="planet-outline" size={28} color="#c084fc" style={{ alignSelf: 'center', marginBottom: 8 }} />
            <Text style={styles.modalTitle}>Schedule this match?</Text>
            <Text style={styles.modalSubtitle}>
              {user1?.display_alias} ↔ {user2?.display_alias}. Immediate if both are free, otherwise queued for the next reset.
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { marginTop: 16 }, matchBusy && { opacity: 0.4 }]}
              onPress={runScheduleMatch}
              disabled={matchBusy}
            >
              {matchBusy ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="planet-outline" size={18} color="#fff" />
                  <Text style={styles.primaryButtonText}>Confirm</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setMatchConfirmOpen(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Typed-confirmation guard — this is the highest blast-radius
          action in the whole panel (every active user in scope gets a
          push, right now, no undo), so a single tap isn't enough. */}
      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={closeConfirm}>
        <Pressable style={styles.modalOverlay} onPress={closeConfirm}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Ionicons name="megaphone-outline" size={28} color="#f59e0b" style={{ alignSelf: 'center', marginBottom: 8 }} />
            <Text style={styles.modalTitle}>Send this to everyone?</Text>
            <Text style={styles.modalSubtitle}>
              {broadcastCampus ?? 'All campuses'} · "{broadcastTitle}" — this fires immediately, no undo.
            </Text>
            <Text style={styles.deleteConfirmLabel}>
              Type <Text style={{ fontWeight: '800', color: '#fff' }}>SEND</Text> to confirm:
            </Text>
            <TextInput
              style={styles.deleteConfirmInput}
              value={confirmText}
              onChangeText={setConfirmText}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="SEND"
              placeholderTextColor="#4b5563"
            />
            {broadcastError && <Text style={styles.errorText}>{broadcastError}</Text>}
            <TouchableOpacity
              style={[styles.dangerButton, { marginTop: 16 }, (confirmText !== 'SEND' || broadcastBusy) && { opacity: 0.4 }]}
              onPress={sendBroadcast}
              disabled={confirmText !== 'SEND' || broadcastBusy}
            >
              {broadcastBusy ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Ionicons name="megaphone-outline" size={18} color="#fff" />
                  <Text style={styles.primaryButtonText}>Send now</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCloseButton} onPress={closeConfirm}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete campus — typed-domain guard, same pattern as user
          deletion. The real safety check (zero users on the campus)
          lives server-side in admin_delete_campus; this just prevents
          a stray tap. */}
      <Modal visible={campusDeleteOpen} transparent animationType="fade" onRequestClose={closeCampusDelete}>
        <Pressable style={styles.modalOverlay} onPress={closeCampusDelete}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            {selectedUniversity && (
              <>
                <Ionicons name="warning-outline" size={28} color="#f87171" style={{ alignSelf: 'center', marginBottom: 8 }} />
                <Text style={styles.modalTitle}>Delete {selectedUniversity.university_name}?</Text>
                <Text style={styles.modalSubtitle}>
                  Only works if no one has ever signed up on this campus. This cannot be undone.
                </Text>
                <Text style={styles.deleteConfirmLabel}>
                  Type <Text style={{ fontWeight: '800', color: '#fff' }}>{selectedUniversity.email_domain}</Text> to confirm:
                </Text>
                <TextInput
                  style={styles.deleteConfirmInput}
                  value={campusDeleteConfirmText}
                  onChangeText={setCampusDeleteConfirmText}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={selectedUniversity.email_domain}
                  placeholderTextColor="#4b5563"
                />
                {campusDeleteError && <Text style={styles.errorText}>{campusDeleteError}</Text>}
                <TouchableOpacity
                  style={[
                    styles.dangerButton,
                    { marginTop: 16 },
                    (campusDeleteConfirmText !== selectedUniversity.email_domain || campusDeleteBusy) && { opacity: 0.4 },
                  ]}
                  onPress={runDeleteCampus}
                  disabled={campusDeleteConfirmText !== selectedUniversity.email_domain || campusDeleteBusy}
                >
                  {campusDeleteBusy ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="trash-outline" size={18} color="#fff" />
                      <Text style={styles.primaryButtonText}>Permanently delete</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalCloseButton} onPress={closeCampusDelete}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  centered: { justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12,
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  scrollContent: { padding: 16, gap: 24 },
  section: {
    backgroundColor: '#111827', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#1f2937', gap: 4,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  sectionHint: { color: '#6b7280', fontSize: 12, lineHeight: 17, marginBottom: 12 },
  pickerWrap: { marginBottom: 12 },
  pickerLabel: { color: '#9ca3af', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  // fontSize >= 16 — anything smaller triggers iOS Safari's forced
  // zoom-on-focus (same bug class already fixed in the chat composer,
  // report box, and profile text fields).
  pickerInput: {
    backgroundColor: '#030712', borderWidth: 1, borderColor: '#374151', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 16,
  },
  pickedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(147, 51, 234, 0.12)', borderWidth: 1, borderColor: '#9333ea',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
  },
  campusRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#030712', borderRadius: 10, borderWidth: 1, borderColor: '#1f2937',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  campusName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  campusMeta: { color: '#6b7280', fontSize: 11, marginTop: 2 },
  // Same web-vs-native split as components/admin/CampusFilter.tsx —
  // RN Web's Picker renders as a plain <select> and needs explicit
  // sizing or it collapses to a tiny native-default box; native
  // iOS/Android render their own wheel/dialog and should be left alone.
  campusPickerContainer: {
    backgroundColor: '#030712', borderRadius: 10, borderWidth: 1, borderColor: '#374151',
    overflow: 'hidden',
  },
  campusPicker: {
    backgroundColor: 'transparent',
    color: '#fff',
    width: '100%',
    ...(Platform.OS === 'web'
      ? { height: 44, paddingHorizontal: 12, fontSize: 15, borderWidth: 0 }
      : {}),
  },
  campusPickerItem: { color: '#fff', backgroundColor: '#030712', fontSize: 15 },
  campusEditPanel: {
    marginTop: 12, padding: 12, borderRadius: 12,
    backgroundColor: 'rgba(147, 51, 234, 0.06)', borderWidth: 1, borderColor: 'rgba(147, 51, 234, 0.25)',
  },
  pickedText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  pickerResultRow: {
    backgroundColor: '#030712', borderRadius: 8, padding: 10, marginTop: 6,
    borderWidth: 1, borderColor: '#1f2937',
  },
  pickerResultAlias: { color: '#fff', fontSize: 13, fontWeight: '600' },
  pickerResultMeta: { color: '#6b7280', fontSize: 11, marginTop: 1 },
  primaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#9333ea', borderRadius: 12, paddingVertical: 14, marginTop: 4,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  secondaryButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'transparent', borderRadius: 12, paddingVertical: 14, marginTop: 4,
    borderWidth: 1, borderColor: '#374151',
  },
  secondaryButtonText: { color: '#d1d5db', fontWeight: '600', fontSize: 15 },
  dangerButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#c2410c', borderRadius: 12, paddingVertical: 14, marginTop: 14,
  },
  successText: { color: '#86efac', fontSize: 13, marginTop: 10, textAlign: 'center' },
  errorText: { color: '#f87171', fontSize: 13, marginTop: 10, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: '#111827', borderRadius: 20, padding: 24, borderWidth: 1, borderColor: '#1f2937' },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  modalSubtitle: { color: '#9ca3af', fontSize: 13, textAlign: 'center', marginTop: 6 },
  deleteConfirmLabel: { color: '#d1d5db', fontSize: 13, marginTop: 16, marginBottom: 8, textAlign: 'center' },
  // fontSize >= 16 — see the matching comment on pickerInput above.
  deleteConfirmInput: {
    backgroundColor: '#030712', borderWidth: 1, borderColor: '#374151', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 16, textAlign: 'center',
  },
  modalCloseButton: { marginTop: 12, alignItems: 'center', paddingVertical: 14, backgroundColor: '#1f2937', borderRadius: 12 },
  modalCloseText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});
