import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Modal, Platform, Linking, Switch, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Picker } from '@react-native-picker/picker';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import CosmicBackground from '../../components/CosmicBackground';
import Skeleton from '../../components/Skeleton';
import { PERSONALITY_QUESTIONS } from '../../lib/personality';
import { HOBBIES, ACTIVITIES } from '../../lib/interests';
import * as webPush from '../../lib/webPush';
import { useIsStandalone } from '../../lib/useIsStandalone';
import { getCurrentBuildId, isUpdateAvailable } from '../../lib/versionCheck';

const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'];

// Must stay in sync with the CATEGORIES set in
// supabase/functions/send-feedback/index.ts — the edge function rejects
// any value not in that set.
const FEEDBACK_CATEGORIES: { value: string; label: string }[] = [
  { value: 'bug', label: 'Bug — something is broken' },
  { value: 'feature-request', label: 'Feature request' },
  { value: 'ui-ux', label: 'UI / UX feedback' },
  { value: 'matching-quality', label: 'Matching quality' },
  { value: 'safety-abuse-report', label: 'Safety / abuse report' },
  { value: 'account-help', label: 'Account help' },
  { value: 'other', label: 'Other' },
];
// Trimmed to icons known-good across current @expo/vector-icons builds.
// Removed the outline variants and the two suspect names that rendered
// as `?` in some builds (ufo-outline, star-shooting). Any DB rows
// still holding removed avatars are reset to a random one from this
// list by migration 029.
const AVATARS = ['alien', 'rocket-launch', 'ufo', 'moon-waning-crescent', 'earth', 'satellite-variant', 'meteor'];

// Sourced from lib/personality.ts so signup and this screen never drift.
const QUESTIONS = PERSONALITY_QUESTIONS;

export default function ProfileTabScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [profile, setProfile] = useState<any>(null);

  // Feedback modal state — kept next to showSettings since it's the same
  // family of secondary flows.
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<string>('bug');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<null | { kind: 'ok' | 'err'; text: string }>(null);

  // Form State
  const [avatar, setAvatar] = useState('alien');
  const [major, setMajor] = useState('');
  const [year, setYear] = useState('');
  const [personality, setPersonality] = useState<string[]>([]);
  const [hobbies, setHobbies] = useState<string[]>([]);
  const [activities, setActivities] = useState<string[]>([]);
  // Inline error for the Edit Profile save — Alert.alert is unreliable
  // on web (some RN-web versions no-op it), and even on native it's
  // an interstitial modal that pulls focus away from the field they
  // need to fix.
  const [editError, setEditError] = useState<string>('');

  // Web push subscription state — controls the Notifications toggle in
  // Settings. Reads current browser permission on open and updates
  // after subscribe/unsubscribe. Not relevant on native (future).
  const isStandalone = useIsStandalone();
  const [pushPermission, setPushPermission] = useState<webPush.WebPushPermission>('unsupported');
  // Separate from pushPermission — see hasActiveSubscription()'s comment
  // in lib/webPush.ts for why the toggle needs this instead.
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    if (!showSettings) return;
    setPushPermission(webPush.getPermission());
    webPush.hasActiveSubscription().then(setPushSubscribed);
  }, [showSettings]);
  const handleEnablePush = async () => {
    setPushBusy(true);
    const result = await webPush.subscribe();
    setPushBusy(false);
    setPushPermission(webPush.getPermission());
    setPushSubscribed(result.ok);
    if (!result.ok) {
      const reason = result.reason;
      if (reason === 'denied') {
        Alert.alert(
          'Notifications blocked',
          Platform.OS === 'web'
            ? 'You blocked notifications for this site. Enable them in your browser site settings, then try again.'
            : 'Notifications are blocked in your device settings.',
        );
      } else if (reason === 'unsupported') {
        Alert.alert('Not supported', 'This browser does not support notifications.');
      } else if (reason === 'no-vapid-key') {
        Alert.alert('Not configured', 'Notification keys are missing on this build.');
      } else {
        Alert.alert('Something went wrong', 'Please try again.');
      }
    }
  };
  const handleDisablePush = async () => {
    setPushBusy(true);
    await webPush.unsubscribe();
    setPushBusy(false);
    setPushPermission(webPush.getPermission());
    setPushSubscribed(false);
  };

  // Version footer at the bottom of Settings — shows which build is
  // currently running and when that was last verified against the
  // live deploy, plus a manual "Check now" / "Refresh" action for
  // anyone who doesn't want to wait for UpdateBanner's own 10-minute
  // poll (components/UpdateBanner.tsx handles the unprompted version
  // of this same check).
  const [buildId] = useState<string | null>(() => getCurrentBuildId());
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const runUpdateCheck = async () => {
    if (Platform.OS !== 'web') return;
    setCheckingUpdate(true);
    const available = await isUpdateAvailable();
    setUpdateAvailable(available);
    setLastCheckedAt(new Date());
    setCheckingUpdate(false);
  };
  useEffect(() => {
    if (showSettings) runUpdateCheck();
  }, [showSettings]);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      setProfile(data);
      setAvatar(data.avatar || 'alien');
      setMajor(data.major || '');
      setYear(data.year_in_school || '');
      setPersonality(data.personality || []);
      setHobbies(data.hobbies || []);
      setActivities(data.activities || []);
    } catch (error) {
      console.log('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleChip = (v: string, list: string[], setList: (l: string[]) => void) => {
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
    if (editError) setEditError('');
  };

  const handleSave = async () => {
    setEditError('');
    // Same requirements as signup: all 4 personality answers, at
    // least 1 hobby, and major + year filled in. Enforce here too so
    // people can't strip the matcher's main signals by editing.
    if (!major.trim()) {
      setEditError('Please enter your major.');
      return;
    }
    if (!year.trim()) {
      setEditError('Please pick your year in school.');
      return;
    }
    const missingPersonality = PERSONALITY_QUESTIONS.some((_, i) => !personality[i] || !personality[i].trim());
    if (missingPersonality) {
      setEditError('Please answer all four personality questions.');
      return;
    }
    if (hobbies.length === 0) {
      setEditError('Please pick at least one hobby.');
      return;
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const { error } = await supabase
      .from('profiles')
      .update({
        avatar,
        major,
        year_in_school: year,
        personality,
        hobbies,
        activities,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    setSaving(false);
    if (error) {
      setEditError('Failed to save. Please try again.');
    } else {
      setIsEditing(false);
      fetchProfile();
    }
  };

  const TIP_URL = 'https://donate.stripe.com/00w5kwe1b2vp6TTbQa0oM01';
  const handleTipDev = () => {
    Linking.openURL(TIP_URL);
  };

  const handleInviteFriend = async () => {
    // Pre-fills the signup URL with the user's campus so their friends
    // land on the right university picker pre-selected. If the campus
    // isn't loaded yet, plain link still works.
    const base = 'https://orbit.orghubs.com';
    const campus = profile?.email_domain;
    const url = campus ? `${base}/signup?campus=${encodeURIComponent(campus)}` : `${base}/signup`;
    const text = `Try Orbit — anonymous campus-only match once a day, reset at midnight. ${url}`;
    if (Platform.OS === 'web' && (navigator as any).share) {
      try { await (navigator as any).share({ title: 'Orbit', text, url }); return; } catch { /* user cancelled */ }
    }
    // Fallback: copy to clipboard (web) or open a share sheet via
    // Linking on native (mailto: works cross-platform without extra deps).
    if (Platform.OS === 'web' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        Alert.alert('Link copied', 'Share it with a friend from your campus.');
        return;
      } catch { /* fallthrough */ }
    }
    Linking.openURL(`mailto:?subject=Try Orbit&body=${encodeURIComponent(text)}`);
  };

  const openFeedback = () => {
    // Reset any leftover state from a previous open so nothing carries
    // over (a stale "sent" banner, a half-typed message from a canceled
    // report, etc.).
    setFeedbackCategory('bug');
    setFeedbackMessage('');
    setFeedbackStatus(null);
    setShowFeedback(true);
  };

  const submitFeedback = async () => {
    const trimmed = feedbackMessage.trim();
    if (!trimmed) {
      setFeedbackStatus({ kind: 'err', text: 'Please write a message before sending.' });
      return;
    }
    setFeedbackSending(true);
    setFeedbackStatus(null);
    // functions.invoke handles the JWT + URL + CORS for us — the edge
    // function uses the same JWT to look up the caller's profile, so
    // we don't need to send any identity from the client.
    const { data, error } = await supabase.functions.invoke('send-feedback', {
      body: { category: feedbackCategory, message: trimmed },
    });
    setFeedbackSending(false);
    if (error || (data && (data as any).error)) {
      const msg = (data && (data as any).error) || error?.message || 'Failed to send.';
      setFeedbackStatus({ kind: 'err', text: msg });
      return;
    }
    setFeedbackMessage('');
    setFeedbackStatus({ kind: 'ok', text: 'Thanks! Your feedback was sent.' });
  };

  const handleSignOut = async () => {
    // Close the Settings sheet immediately, synchronously, regardless of
    // what signOut() below does — this was the actual bug: signOut()
    // was succeeding, but showSettings never got reset to false, so the
    // modal (and the profile screen loading behind it, now re-fetching
    // for a user that's already gone) stayed on screen even after the
    // root layout had already navigated away underneath it.
    setShowSettings(false);
    const { error } = await supabase.auth.signOut();
    if (error) {
      // Alert.alert is a silent no-op on web in some RN-web versions —
      // don't rely on it as the only signal. Logging keeps this
      // debuggable; the root layout's redirect only fires once session
      // is actually null, so a real signOut failure just leaves you on
      // the (now-closed-modal) app screen rather than looking broken.
      console.warn('Sign out failed:', error.message);
      return;
    }
    if (Platform.OS === 'web') {
      // router.replace('/') here races the root layout's own
      // session-driven redirect effect: if that effect re-runs (segments
      // just changed) before its `session` closure has caught up to the
      // signOut that just happened, it still sees the old logged-in
      // session and immediately routes straight back to /(app), undoing
      // this navigation — landing back on this screen looking unchanged.
      // A hard reload sidesteps the race entirely: the app boots fresh,
      // calls getSession(), gets null, and never has stale state to race.
      window.location.href = '/';
    } else {
      router.replace('/');
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account", 
      "Are you absolutely sure? This will permanently erase your cosmic existence.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
            const { error } = await supabase.rpc('delete_my_account');
            if (error) {
              Alert.alert("Error", error.message);
            } else {
              await supabase.auth.signOut();
            }
        }}
      ]
    );
  };

  const setPersonalityAnswer = (index: number, answer: string) => {
    const newAnswers = [...personality];
    newAnswers[index] = answer;
    setPersonality(newAnswers);
  };

  if (loading) {
    // Skeleton mirrors the header (avatar + alias + subtitle) and the
    // first info card (Major/Year rows + personality label + a few
    // answer rows) so the layout doesn't jump when the profile arrives.
    return (
      <View style={styles.container}>
        <CosmicBackground />
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 60, paddingHorizontal: 16 }}>
          <View style={styles.header}>
            <Skeleton width={100} height={100} radius={50} style={{ marginBottom: 12 }} />
            <Skeleton width={160} height={22} radius={6} style={{ marginBottom: 8 }} />
            <Skeleton width={100} height={14} radius={4} />
          </View>
          <View style={styles.card}>
            <Skeleton style={{ width: '100%', height: 20, borderRadius: 6, marginBottom: 16 }} />
            <Skeleton style={{ width: '100%', height: 20, borderRadius: 6, marginBottom: 24 }} />
            <Skeleton width={120} height={16} radius={4} style={{ marginBottom: 16 }} />
            <Skeleton style={{ width: '100%', height: 40, borderRadius: 6, marginBottom: 12 }} />
            <Skeleton style={{ width: '100%', height: 40, borderRadius: 6, marginBottom: 12 }} />
            <Skeleton style={{ width: '100%', height: 40, borderRadius: 6 }} />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CosmicBackground />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 60, paddingHorizontal: 16 }}>
        
        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.avatarRing}>
            <MaterialCommunityIcons name={avatar as any} size={56} color="#c084fc" />
          </View>
          <Text style={styles.title}>{profile?.display_alias || 'Astronaut'}</Text>
          <Text style={styles.subtitle}>{profile?.gender || 'Unknown Identity'}</Text>

          <TouchableOpacity style={styles.settingsIcon} onPress={() => setShowSettings(true)}>
            <Ionicons name="settings-sharp" size={24} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        {isEditing ? (
          <View style={styles.card}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Choose Avatar</Text>
              <View style={styles.avatarGrid}>
                {AVATARS.map(av => (
                  <TouchableOpacity 
                    key={av} 
                    style={[styles.avatarOption, avatar === av && styles.avatarOptionSelected]}
                    onPress={() => setAvatar(av)}
                  >
                    <MaterialCommunityIcons name={av as any} size={32} color={avatar === av ? '#fff' : '#6b7280'} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Major</Text>
              <TextInput
                style={styles.textInput}
                value={major}
                onChangeText={setMajor}
                placeholder="e.g. Computer Science"
                placeholderTextColor="#6b7280"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Year in School</Text>
              <View style={styles.pickerContainer}>
                <Picker selectedValue={year} onValueChange={setYear} style={styles.picker} itemStyle={styles.pickerItem}>
                  <Picker.Item label="Select your year..." value="" />
                  {YEARS.map(y => <Picker.Item key={y} label={y} value={y} />)}
                </Picker>
              </View>
            </View>

            <Text style={[styles.label, { marginTop: 12, marginBottom: 12, fontSize: 18, color: '#fff' }]}>Personality Profile</Text>
            
            {QUESTIONS.map((q, i) => (
              <View key={q.key} style={styles.inputGroup}>
                <Text style={styles.label}>{q.label}</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={personality[i] || ''}
                    onValueChange={(val) => setPersonalityAnswer(i, val)}
                    style={styles.picker}
                    itemStyle={styles.pickerItem}
                  >
                    <Picker.Item label="Select answer..." value="" />
                    {q.options.map(opt => <Picker.Item key={opt} label={opt} value={opt} />)}
                  </Picker>
                </View>
              </View>
            ))}

            <Text style={[styles.label, { marginTop: 12, marginBottom: 12, fontSize: 18, color: '#fff' }]}>Interests</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Hobbies · pick a few</Text>
              <View style={styles.chipRow}>
                {HOBBIES.map((h) => (
                  <TouchableOpacity
                    key={h}
                    style={[styles.chip, hobbies.includes(h) && styles.chipActiveHobby]}
                    onPress={() => toggleChip(h, hobbies, setHobbies)}
                  >
                    <Text style={[styles.chipText, hobbies.includes(h) && { color: '#fff' }]}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Campus activities · optional</Text>
              <View style={styles.chipRow}>
                {ACTIVITIES.map((a) => (
                  <TouchableOpacity
                    key={a}
                    style={[styles.chip, activities.includes(a) && styles.chipActiveActivity]}
                    onPress={() => toggleChip(a, activities, setActivities)}
                  >
                    <Text style={[styles.chipText, activities.includes(a) && { color: '#fff' }]}>{a}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {editError ? (
              <View style={styles.editErrorBox}>
                <Text style={styles.editErrorText}>{editError}</Text>
              </View>
            ) : null}

            <TouchableOpacity style={styles.button} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Changes</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={() => { setEditError(''); setIsEditing(false); }}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.viewRow}>
              <Text style={styles.viewLabel}>Major</Text>
              <Text style={styles.viewValue}>{profile?.major || 'Not set'}</Text>
            </View>
            <View style={styles.viewRow}>
              <Text style={styles.viewLabel}>Year</Text>
              <Text style={styles.viewValue}>{profile?.year_in_school || 'Not set'}</Text>
            </View>
            
            <View style={styles.divider} />
            <Text style={styles.viewSectionTitle}>Personality</Text>
            
            {QUESTIONS.map((q, i) => (
              <View key={q.key} style={styles.viewRowVertical}>
                <Text style={styles.viewLabel}>{q.label}</Text>
                <Text style={styles.viewValueHigh}>{profile?.personality?.[i] || 'Not answered'}</Text>
              </View>
            ))}

            <View style={styles.divider} />
            <Text style={styles.viewSectionTitle}>Hobbies</Text>
            <View style={styles.chipRow}>
              {(profile?.hobbies?.length ?? 0) === 0 ? (
                <Text style={styles.viewValueMuted}>Not set — tap Edit Profile to add some.</Text>
              ) : (
                profile.hobbies.map((h: string) => (
                  <View key={h} style={[styles.chip, styles.chipActiveHobby, { paddingVertical: 6 }]}>
                    <Text style={[styles.chipText, { color: '#fff' }]}>{h}</Text>
                  </View>
                ))
              )}
            </View>

            <View style={styles.divider} />
            <Text style={styles.viewSectionTitle}>Campus activities</Text>
            <View style={styles.chipRow}>
              {(profile?.activities?.length ?? 0) === 0 ? (
                <Text style={styles.viewValueMuted}>None yet.</Text>
              ) : (
                profile.activities.map((a: string) => (
                  <View key={a} style={[styles.chip, styles.chipActiveActivity, { paddingVertical: 6 }]}>
                    <Text style={[styles.chipText, { color: '#fff' }]}>{a}</Text>
                  </View>
                ))
              )}
            </View>

            <TouchableOpacity style={[styles.button, { marginTop: 20 }]} onPress={() => { setEditError(''); setIsEditing(true); }}>
              <Text style={styles.buttonText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.inviteButton} onPress={handleInviteFriend}>
          <Ionicons name="share-social" size={18} color="#c084fc" />
          <Text style={styles.inviteButtonText}>Invite a Campus Bud</Text>
        </TouchableOpacity>
        {/* "Tip the Dev" moved into the Settings modal — sat next to
            the invite button here before but competed with it for
            attention on the primary screen. */}
      </ScrollView>

      {/* Settings Modal */}
      <Modal visible={showSettings} animationType="slide" transparent={true} onRequestClose={() => setShowSettings(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowSettings(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Settings</Text>

            <TouchableOpacity style={styles.modalButton} onPress={handleSignOut}>
              <Ionicons name="log-out-outline" size={24} color="#fff" />
              <Text style={styles.modalButtonText}>Sign Out</Text>
            </TouchableOpacity>

            {profile?.is_admin && (
              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => { setShowSettings(false); router.push('/admin'); }}
              >
                <Ionicons name="shield-checkmark-outline" size={24} color="#9333ea" />
                <Text style={[styles.modalButtonText, { color: '#c084fc' }]}>Admin</Text>
              </TouchableOpacity>
            )}

            {/* Notifications toggle. Only meaningful on web; native
                builds will get a separate push flow via Expo Push.
                A real Switch instead of an Enable/Disable text link —
                the text link read as just another row label at a
                glance, easy to skim past; a toggle in the "off"
                position reads as unfinished setup immediately. */}
            {Platform.OS === 'web' && (
              <View style={styles.notifBlock}>
                {/* Same icon + Text pattern as every other row above/below
                    (Sign Out, Send Feedback, etc.) — direct siblings, both
                    using modalButtonText, so the baseline matches exactly.
                    A flex spacer pushes the switch to the same right edge
                    the old text link used to sit at. Any hint text is a
                    separate line below the row, not nested inside it, so
                    it can't affect this row's own vertical alignment. */}
                <View style={styles.notifMainRow}>
                  <Ionicons name="notifications-outline" size={24} color="#fff" />
                  <Text style={styles.modalButtonText}>Notifications</Text>
                  <View style={{ flex: 1 }} />
                  {pushBusy ? (
                    <ActivityIndicator color="#c084fc" />
                  ) : pushPermission === 'unsupported' ? (
                    <Switch value={false} disabled trackColor={{ false: '#374151', true: '#9333ea' }} />
                  ) : pushPermission === 'denied' ? (
                    <Switch value={false} disabled trackColor={{ false: '#374151', true: '#9333ea' }} />
                  ) : (
                    <Switch
                      value={pushSubscribed}
                      onValueChange={(next) => (next ? handleEnablePush() : handleDisablePush())}
                      trackColor={{ false: '#374151', true: '#9333ea' }}
                      thumbColor="#fff"
                    />
                  )}
                </View>
                {!isStandalone && pushPermission !== 'granted' && pushPermission !== 'unsupported' && (
                  <Text style={styles.notifHint}>
                    Add Orbit to your Home Screen first — that's required to get notifications.
                  </Text>
                )}
                {pushPermission === 'denied' && (
                  <Text style={styles.notifHint}>
                    {isStandalone
                      ? 'Blocked — open your phone\'s Settings app → Notifications → Orbit, and turn Allow Notifications on.'
                      : 'Blocked — tap the site info/lock icon next to the address bar, then allow notifications for this site.'}
                  </Text>
                )}
                {pushPermission === 'unsupported' && (
                  <Text style={styles.notifHint}>
                    This browser doesn't support notifications.
                  </Text>
                )}
              </View>
            )}

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => { setShowSettings(false); openFeedback(); }}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={24} color="#fff" />
              <Text style={styles.modalButtonText}>Send Feedback</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => { setShowSettings(false); handleTipDev(); }}
            >
              <Ionicons name="heart-outline" size={24} color="#f472b6" />
              <Text style={[styles.modalButtonText, { color: '#f472b6' }]}>Tip the Dev</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => { setShowSettings(false); router.push('/legal/privacy'); }}
            >
              <Ionicons name="shield-checkmark-outline" size={24} color="#fff" />
              <Text style={styles.modalButtonText}>Privacy Policy</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => { setShowSettings(false); router.push('/legal/terms'); }}
            >
              <Ionicons name="document-text-outline" size={24} color="#fff" />
              <Text style={styles.modalButtonText}>Terms of Service</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.modalButton, { borderBottomWidth: 0 }]} onPress={handleDeleteAccount}>
              <Ionicons name="trash-outline" size={24} color="#ef4444" />
              <Text style={[styles.modalButtonText, { color: '#ef4444' }]}>Delete Account</Text>
            </TouchableOpacity>

            {Platform.OS === 'web' && (
              <View style={styles.versionFooter}>
                <Text style={styles.versionFooterText}>
                  {buildId ? `Build ${buildId}` : 'Local build'}
                  {lastCheckedAt
                    ? ` · checked ${lastCheckedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                    : ''}
                </Text>
                <TouchableOpacity onPress={updateAvailable ? () => window.location.reload() : runUpdateCheck} disabled={checkingUpdate}>
                  {checkingUpdate ? (
                    <ActivityIndicator size="small" color="#c084fc" />
                  ) : (
                    <Text style={[styles.versionFooterLink, updateAvailable && styles.versionFooterLinkUrgent]}>
                      {updateAvailable ? 'Refresh to update' : 'Check for updates'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowSettings(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Feedback Modal */}
      <Modal visible={showFeedback} animationType="slide" transparent={true} onRequestClose={() => setShowFeedback(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowFeedback(false)}>
          <Pressable style={[styles.modalContent, { paddingBottom: 24 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Send Feedback</Text>

            <Text style={[styles.label, { marginTop: 8 }]}>What is this about?</Text>
            <View style={styles.pickerContainer}>
              <Picker
                selectedValue={feedbackCategory}
                onValueChange={setFeedbackCategory}
                style={styles.picker}
                itemStyle={styles.pickerItem}
              >
                {FEEDBACK_CATEGORIES.map(c => (
                  <Picker.Item key={c.value} label={c.label} value={c.value} />
                ))}
              </Picker>
            </View>

            <Text style={[styles.label, { marginTop: 16 }]}>Your message</Text>
            <TextInput
              style={styles.feedbackInput}
              placeholder="Tell us what happened, what you'd like to see, or what we can do better…"
              placeholderTextColor="#6b7280"
              value={feedbackMessage}
              onChangeText={setFeedbackMessage}
              multiline
              maxLength={5000}
              editable={!feedbackSending}
            />
            <Text style={styles.charCount}>{feedbackMessage.length}/5000</Text>

            {feedbackStatus && (
              <View
                style={[
                  styles.feedbackBanner,
                  feedbackStatus.kind === 'ok' ? styles.feedbackOk : styles.feedbackErr,
                ]}
              >
                <Text
                  style={[
                    styles.feedbackBannerText,
                    { color: feedbackStatus.kind === 'ok' ? '#86efac' : '#fca5a5' },
                  ]}
                >
                  {feedbackStatus.text}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, (feedbackSending || !feedbackMessage.trim()) && { opacity: 0.5 }]}
              onPress={submitFeedback}
              disabled={feedbackSending || !feedbackMessage.trim()}
            >
              {feedbackSending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Send Feedback</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowFeedback(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', marginBottom: 32, position: 'relative' },
  settingsIcon: { position: 'absolute', top: 0, right: 10, padding: 8 },
  // Circle ring wrapper matching the lobby's matched-card avatar
  // (styles.matchedAvatarRing in index.tsx) so the visual identity
  // is consistent across every screen the alias/avatar appears on.
  avatarRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 2,
    borderColor: '#a855f7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 15,
    elevation: 10,
  },
  // Title (alias) sized to match the chat mini-profile modal (20).
  title: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#9ca3af', textTransform: 'capitalize' },
  card: { backgroundColor: 'rgba(17, 24, 39, 0.6)', padding: 24, borderRadius: 24, borderWidth: 1, borderColor: '#1f2937', marginBottom: 24 },
  tipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(244, 114, 182, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(244, 114, 182, 0.3)',
    borderRadius: 16,
    paddingVertical: 14,
    marginBottom: 60,
  },
  tipButtonText: { color: '#f472b6', fontSize: 15, fontWeight: '700' },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    borderRadius: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  inviteButtonText: { color: '#c084fc', fontSize: 15, fontWeight: '700' },
  inputGroup: { marginBottom: 20 },
  label: { color: '#d1d5db', marginBottom: 8, fontSize: 14, fontWeight: '600' },
  textInput: { backgroundColor: 'rgba(3, 7, 18, 0.5)', borderWidth: 1, borderColor: '#374151', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, color: '#fff', fontSize: 16 },
  pickerContainer: { backgroundColor: 'rgba(3, 7, 18, 0.5)', borderRadius: 12, borderWidth: 1, borderColor: '#374151', overflow: 'hidden' },
  // On web, Picker renders as a plain <select>, which:
  //  - picks up the browser's own (smaller) default font-size instead of
  //    inheriting anything from textInput, so we set fontSize explicitly
  //    to match;
  //  - ships its own default border/outline, which — layered under
  //    pickerContainer's border — reads as a doubled/off "weird" edge;
  //    borderWidth: 0 here makes pickerContainer's border the only one
  //    that's visible, same as textInput;
  //  - doesn't inherit paddingVertical the way TextInput does, so we set
  //    an explicit height instead to get the same ~48px box.
  // None of this applies natively — iOS renders Picker as a wheel, so we
  // only touch these on web.
  picker: {
    color: '#fff',
    backgroundColor: 'transparent',
    ...(Platform.OS === 'web'
      ? { height: 48, paddingHorizontal: 16, fontSize: 16, borderWidth: 0 }
      : {}),
  },
  pickerItem: { color: '#fff', backgroundColor: '#030712', fontSize: 16 },
  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  avatarOption: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#1f2937', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  avatarOptionSelected: { borderColor: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.2)' },
  button: { backgroundColor: '#9333ea', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  cancelButton: { marginTop: 16, alignItems: 'center' },
  cancelText: { color: '#9ca3af', fontSize: 16 },
  viewRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' },
  viewRowVertical: { marginBottom: 16 },
  viewLabel: { color: '#9ca3af', fontSize: 14 },
  viewValue: { color: '#fff', fontSize: 16, fontWeight: '500' },
  viewValueHigh: { color: '#d8b4fe', fontSize: 16, fontWeight: '600', marginTop: 4 },
  viewValueMuted: { color: '#6b7280', fontSize: 13, fontStyle: 'italic' },
  editErrorBox: {
    marginTop: 8,
    marginBottom: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  editErrorText: {
    color: '#fca5a5',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
    backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151',
  },
  chipActiveHobby: { backgroundColor: '#9333ea', borderColor: '#9333ea' },
  chipActiveActivity: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  chipText: { color: '#e5e7eb', fontSize: 13, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#374151', marginVertical: 16 },
  viewSectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#111827', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 24, textAlign: 'center' },
  modalButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  modalButtonText: { color: '#fff', fontSize: 16, marginLeft: 16 },
  modalCloseButton: { marginTop: 24, alignItems: 'center', paddingVertical: 16, backgroundColor: '#1f2937', borderRadius: 12 },
  modalCloseText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  // Same paddingVertical/border as modalButton, but as a plain container
  // (not flexDirection: row) since it now stacks the icon+label+switch
  // row on top of an optional hint line below — modalButton itself stays
  // row-only for the simple icon+Text rows elsewhere in this list.
  notifBlock: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  // Icon then Text as direct siblings, identically to every other row
  // (Sign Out, Send Feedback, ...) — that's what makes the baseline
  // actually match instead of approximating it with wrapper views.
  notifMainRow: { flexDirection: 'row', alignItems: 'center' },
  notifHint: { color: '#9ca3af', fontSize: 11, marginTop: 6, marginLeft: 40, lineHeight: 14 },
  versionFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#1f2937',
  },
  versionFooterText: { color: '#4b5563', fontSize: 11 },
  versionFooterLink: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  versionFooterLinkUrgent: { color: '#4ade80' },
  feedbackInput: {
    backgroundColor: 'rgba(3, 7, 18, 0.5)',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    // 16 keeps iOS Safari from auto-zooming on focus.
    fontSize: 16,
    minHeight: 120,
    maxHeight: 200,
    textAlignVertical: 'top',
  },
  charCount: { color: '#6b7280', fontSize: 12, textAlign: 'right', marginTop: 4 },
  feedbackBanner: {
    marginTop: 14,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  feedbackOk: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  feedbackErr: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  feedbackBannerText: { fontSize: 13, fontWeight: '600' },
});
