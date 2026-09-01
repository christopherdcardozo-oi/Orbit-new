// "A new version is ready" banner — web only. Polls for a newer
// deployed bundle (see lib/versionCheck.ts) and offers a one-tap
// refresh once one shows up.
//
// Reloading is safe: the Supabase session lives in localStorage
// (persistSession: true, see lib/supabase.ts), which survives a
// reload untouched — nobody gets signed out by tapping Refresh.
//
// Checks on mount, every 10 minutes while the app stays open, and
// whenever the tab/PWA regains focus — that last one matters most,
// since an installed iOS PWA can sit backgrounded for days between
// opens, exactly when it's most likely to be running a stale bundle.

import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isUpdateAvailable } from '../lib/versionCheck';

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export default function UpdateBanner() {
  const [available, setAvailable] = useState(false);
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (Platform.OS !== 'web' || checking.current) return;
    checking.current = true;
    try {
      const result = await isUpdateAvailable();
      if (result) setAvailable(true);
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [check]);

  if (Platform.OS !== 'web' || !available) return null;

  return (
    <View style={styles.banner}>
      <Ionicons name="sparkles-outline" size={18} color="#4ade80" style={styles.icon} />
      <Text style={styles.text}>A new version of Orbit is ready.</Text>
      <TouchableOpacity onPress={() => window.location.reload()} style={styles.button}>
        <Text style={styles.buttonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(74, 222, 128, 0.14)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(74, 222, 128, 0.35)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  icon: {
    flexShrink: 0,
  },
  text: {
    flex: 1,
    color: '#e5e7eb',
    fontSize: 12,
    lineHeight: 16,
  },
  button: {
    backgroundColor: '#16a34a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    flexShrink: 0,
  },
  buttonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
})
