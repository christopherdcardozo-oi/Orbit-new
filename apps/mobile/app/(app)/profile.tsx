import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, Modal, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Picker } from '@react-native-picker/picker';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import CosmicBackground from '../../components/CosmicBackground';
import { PERSONALITY_QUESTIONS } from '../../lib/personality';

const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'];
const AVATARS = ['alien', 'alien-outline', 'rocket-launch', 'ufo', 'ufo-outline', 'planet', 'moon-waning-crescent', 'meteor', 'star-shooting', 'earth', 'satellite-variant'];

// Sourced from lib/personality.ts so signup and this screen never drift.
const QUESTIONS = PERSONALITY_QUESTIONS;

export default function ProfileTabScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [profile, setProfile] = useState<any>(null);

  // Form State
  const [avatar, setAvatar] = useState('planet');
  const [major, setMajor] = useState('');
  const [year, setYear] = useState('');
  const [personality, setPersonality] = useState<string[]>([]);

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
      setAvatar(data.avatar || 'planet');
      setMajor(data.major || '');
      setYear(data.year_in_school || '');
      setPersonality(data.personality || []);
    } catch (error) {
      console.log('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('profiles')
      .update({
        avatar,
        major,
        year_in_school: year,
        personality,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);

    setSaving(false);
    if (error) {
      Alert.alert('Error', 'Failed to update profile');
    } else {
      setIsEditing(false);
      fetchProfile();
    }
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
    router.replace('/');
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
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#a855f7" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CosmicBackground />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 60, paddingHorizontal: 16 }}>
        
        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.avatar}>
            <MaterialCommunityIcons name={avatar as any} size={80} color="#c084fc" />
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

            <TouchableOpacity style={styles.button} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save Changes</Text>}
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.cancelButton} onPress={() => setIsEditing(false)}>
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

            <TouchableOpacity style={styles.button} onPress={() => setIsEditing(true)}>
              <Text style={styles.buttonText}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Settings Modal */}
      <Modal visible={showSettings} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Settings</Text>

            <TouchableOpacity style={styles.modalButton} onPress={handleSignOut}>
              <Ionicons name="log-out-outline" size={24} color="#fff" />
              <Text style={styles.modalButtonText}>Sign Out</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.modalButton, { borderBottomWidth: 0 }]} onPress={handleDeleteAccount}>
              <Ionicons name="trash-outline" size={24} color="#ef4444" />
              <Text style={[styles.modalButtonText, { color: '#ef4444' }]}>Delete Account</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalCloseButton} onPress={() => setShowSettings(false)}>
              <Text style={styles.modalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { alignItems: 'center', marginBottom: 32, position: 'relative' },
  settingsIcon: { position: 'absolute', top: 0, right: 10, padding: 8 },
  avatar: { marginBottom: 8, shadowColor: '#a855f7', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 15, elevation: 10 },
  title: { fontSize: 28, fontWeight: '900', color: '#fff', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#9ca3af', textTransform: 'capitalize' },
  card: { backgroundColor: 'rgba(17, 24, 39, 0.6)', padding: 24, borderRadius: 24, borderWidth: 1, borderColor: '#1f2937', marginBottom: 60 },
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
  divider: { height: 1, backgroundColor: '#374151', marginVertical: 16 },
  viewSectionTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#111827', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 24, textAlign: 'center' },
  modalButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#1f2937' },
  modalButtonText: { color: '#fff', fontSize: 16, marginLeft: 16 },
  modalCloseButton: { marginTop: 24, alignItems: 'center', paddingVertical: 16, backgroundColor: '#1f2937', borderRadius: 12 },
  modalCloseText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});
