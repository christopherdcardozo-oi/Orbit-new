// Shown when app/_layout.tsx detects the signed-in user's
// profiles.is_active is false (banned via the admin panel — see
// app/admin/users.tsx). Previously "Ban account" only excluded someone
// from the matchmaker's pool; they could still fully sign in, chat, and
// use the app. This screen + the _layout.tsx check are what actually
// close that gap.

import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import CosmicBackground from '../components/CosmicBackground';

export default function Suspended() {
  const router = useRouter();

  const handleSignOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.warn('Sign out failed:', error.message);
      return;
    }
    // Same hard-reload pattern as app/(app)/profile.tsx's handleSignOut
    // — sidesteps a race where _layout.tsx's redirect effect re-runs on
    // stale session state and routes straight back here.
    if (Platform.OS === 'web') {
      window.location.href = '/';
    } else {
      router.replace('/');
    }
  };

  return (
    <View style={styles.container}>
      <CosmicBackground />
      <View style={styles.card}>
        <Ionicons name="lock-closed-outline" size={40} color="#f87171" />
        <Text style={styles.title}>Account suspended</Text>
        <Text style={styles.body}>
          Your Orbit account has been suspended. If you think this is a mistake,
          email us and we'll take a look.
        </Text>
        <TouchableOpacity
          style={styles.emailButton}
          onPress={() => Linking.openURL('mailto:support@orghubs.com?subject=Account%20suspended')}
        >
          <Ionicons name="mail-outline" size={18} color="#fff" />
          <Text style={styles.emailButtonText}>Email support@orghubs.com</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712', justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: 'rgba(17, 24, 39, 0.9)', borderRadius: 24, padding: 28,
    borderWidth: 1, borderColor: '#1f2937', alignItems: 'center', gap: 12,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  body: { color: '#9ca3af', fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 8 },
  emailButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#9333ea', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20,
    width: '100%',
  },
  emailButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  signOutButton: { marginTop: 8, paddingVertical: 10 },
  signOutText: { color: '#6b7280', fontSize: 14, fontWeight: '600' },
});
