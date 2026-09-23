import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { signOutEverywhere } from '../lib/auth';

/**
 * Blocking terms acceptance.
 *
 * App Store guideline 1.2 requires users to agree to terms that state
 * there's no tolerance for objectionable content or abusive users. The
 * signup form has a checkbox, but that isn't enough on its own: the
 * reviewer signs in through the login screen and never sees signup, and
 * every pre-existing account predates the checkbox.
 *
 * So this gates the whole app on profiles.terms_accepted_at being set.
 * Shown once per account, not per device.
 */
export default function TermsGate({ userId, onAccepted }: { userId: string; onAccepted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const accept = async () => {
    setBusy(true);
    setError('');
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ terms_accepted_at: new Date().toISOString() })
      .eq('id', userId);
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    onAccepted();
  };

  const decline = async () => {
    setBusy(true);
    await signOutEverywhere();
    setBusy(false);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Ionicons name="shield-checkmark" size={40} color="#c084fc" style={{ alignSelf: 'center', marginBottom: 12 }} />
        <Text style={styles.title}>Our community rules</Text>
        <Text style={styles.body}>
          Orbit connects you with strangers on your campus. To keep that safe, everyone
          agrees to the same rules before using the app.
        </Text>

        <View style={styles.rules}>
          <Text style={styles.rule}>
            • <Text style={styles.strong}>Zero tolerance</Text> for objectionable content and abusive
            users. Harassment, hate speech, threats and sexual content involving minors get
            accounts removed.
          </Text>
          <Text style={styles.rule}>
            • Reports are <Text style={styles.strong}>reviewed and acted on within 24 hours</Text>.
            We remove the content and eject the user who posted it.
          </Text>
          <Text style={styles.rule}>
            • You can <Text style={styles.strong}>report and block</Text> anyone from the chat menu,
            and delete any message you sent by holding it.
          </Text>
          <Text style={styles.rule}>
            • You must be <Text style={styles.strong}>18 or older</Text> and a student at an
            approved campus.
          </Text>
          <Text style={styles.rule}>
            • Questions or something to report? <Text style={styles.strong}>Contact Support</Text> in
            Settings, or email support@orghubs.com.
          </Text>
        </View>

        <Text style={styles.links}>
          Full{' '}
          <Text style={styles.link} onPress={() => Linking.openURL('https://orghubs.com/apps/orbit/terms')}>Terms of Service</Text>
          {' '}and{' '}
          <Text style={styles.link} onPress={() => Linking.openURL('https://orghubs.com/apps/orbit/privacy')}>Privacy Policy</Text>.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.accept, busy && { opacity: 0.6 }]}
          onPress={accept}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Agree and continue"
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>I agree — continue</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={decline} disabled={busy} accessibilityRole="button">
          <Text style={styles.decline}>I don't agree — sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
  scroll: { padding: 24, paddingTop: 72, paddingBottom: 48 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  body: { color: '#9ca3af', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  rules: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 18,
    gap: 12,
    marginBottom: 16,
  },
  rule: { color: '#d1d5db', fontSize: 14, lineHeight: 21 },
  strong: { color: '#fff', fontWeight: '700' },
  links: { color: '#6b7280', fontSize: 13, textAlign: 'center', marginBottom: 20 },
  link: { color: '#c084fc', textDecorationLine: 'underline' },
  error: { color: '#fca5a5', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  accept: {
    backgroundColor: '#7c3aed',
    paddingVertical: 16,
    borderRadius: 999,
    alignItems: 'center',
    marginBottom: 14,
  },
  acceptText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  decline: { color: '#6b7280', fontSize: 14, textAlign: 'center', paddingVertical: 8 },
});
