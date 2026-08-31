// A dismissible "install this as an app" banner — web only. Renders
// nothing on native iOS/Android builds (this file still gets bundled
// there by Metro, so every browser-global access below is guarded by
// Platform.OS checks, not just the final render).
//
// Two different browsers, two different mechanisms, because there's no
// unified web API for this:
//   - Chrome/Edge/Android: support the `beforeinstallprompt` event. We
//     capture it, stash it, and show a button that calls its own
//     .prompt() — the browser's real native install flow.
//   - iOS Safari: has NO install-prompt API at all, at any version.
//     The only way to install a PWA there is the user manually tapping
//     Share → "Add to Home Screen" — so for iOS we can only show
//     instructions, never trigger it ourselves.
//
// Dismissal is remembered in localStorage so it doesn't nag on every visit.

import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const DISMISSED_KEY = 'orbit-install-hint-dismissed';

type Variant = 'android' | 'ios' | null;

export default function InstallHint() {
  const [variant, setVariant] = useState<Variant>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    try {
      if (localStorage.getItem(DISMISSED_KEY) === '1') {
        setDismissed(true);
        return;
      }
    } catch {
      // localStorage can throw in some privacy modes — just don't persist dismissal.
    }

    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return; // already installed/running as an app

    const ua = window.navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);

    if (isIOS && isSafari) {
      setVariant('ios');
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setVariant('android');
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // ignore
    }
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    handleDismiss();
  };

  if (Platform.OS !== 'web' || dismissed || !variant) return null;

  return (
    <View style={styles.banner}>
      <Ionicons name="download-outline" size={18} color="#c084fc" style={styles.icon} />
      <Text style={styles.text}>
        {variant === 'android'
          ? 'Install Orbit for the full-screen app experience.'
          : 'Add Orbit to your Home Screen to get notifications — tap Share, then "Add to Home Screen".'}
      </Text>
      {variant === 'android' && (
        <TouchableOpacity onPress={handleInstallClick} style={styles.installButton}>
          <Text style={styles.installButtonText}>Install</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity onPress={handleDismiss} style={styles.dismissButton} hitSlop={8}>
        <Ionicons name="close" size={16} color="#9ca3af" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(168, 85, 247, 0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(168, 85, 247, 0.3)',
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
  installButton: {
    backgroundColor: '#9333ea',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    flexShrink: 0,
  },
  installButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  dismissButton: {
    padding: 4,
    flexShrink: 0,
  },
})
