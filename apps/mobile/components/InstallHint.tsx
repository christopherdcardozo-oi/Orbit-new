// Persistent "get notifications working" banner — web only. Renders
// nothing on native iOS/Android builds (this file still gets bundled
// there by Metro, so every browser-global access below is guarded by
// Platform.OS checks, not just the final render).
//
// Two problems this solves, gated in order:
//   1. On iOS Safari, push notifications ONLY work for an installed
//      PWA — a bare browser tab can never get them, no matter what
//      permission is granted (Apple platform rule). So until the app
//      is installed, we show install instructions and say plainly
//      that it's the only way to get notified.
//   2. Once installed (or on a platform where install isn't required,
//      e.g. desktop Chrome/Firefox, Android Chrome), push still needs
//      the browser's own permission grant. app/_layout.tsx auto-fires
//      that prompt once per browser, but if the user dismissed it (or
//      it never fired — e.g. permission was already 'denied' from a
//      much earlier visit) this banner is the fallback nudge with a
//      manual "Enable" button.
//
// Deliberately NOT dismissible while either problem is unresolved —
// previously this had a localStorage dismiss that let people close it
// forever after one look, which is a big part of why 39 of 41 users
// had zero push subscriptions. It disappears on its own the moment
// both conditions are satisfied (installed + notifications granted),
// so it's not a permanent nag — just a persistent one until it's
// actually done.
//
// Mounted once in app/_layout.tsx above <Slot />, so it's already
// visible above every screen — auth, lobby, chat, profile, all of it.

import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as webPush from '../lib/webPush';
import { useIsStandalone } from '../lib/useIsStandalone';

type Variant =
  | 'ios-install'      // iOS Safari, not installed — the only real blocker
  | 'android-install'  // Android/desktop Chrome install prompt available
  | 'enable-push'      // installed (or install not required) but not subscribed
  | null;

export default function InstallHint() {
  const isStandalone = useIsStandalone();
  const [variant, setVariant] = useState<Variant>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [pushPermission, setPushPermission] = useState<webPush.WebPushPermission>('unsupported');
  const [busy, setBusy] = useState(false);

  const refreshPushPermission = useCallback(() => {
    if (Platform.OS !== 'web') return;
    setPushPermission(webPush.getPermission());
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    refreshPushPermission();
    // Permission can change out-of-band (user flips it in browser site
    // settings in another tab, or via the OS prompt) — re-check whenever
    // this tab regains focus so the banner doesn't linger stale.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshPushPermission();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refreshPushPermission]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const ua = window.navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Stash iOS/Safari detection for the decision effect below via a
    // data attribute-free closure — simplest is just recomputing there.
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') { setVariant(null); return; }
    if (!webPush.isSupported()) { setVariant(null); return; }

    const ua = window.navigator.userAgent || '';
    const isIOS = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream;
    const isSafari = /^((?!chrome|android).)*safari/i.test(ua);

    if (isIOS && isSafari && !isStandalone) {
      // The one real hard blocker: no install, no notifications, full stop.
      setVariant('ios-install');
      return;
    }

    if (pushPermission === 'granted') {
      setVariant(null);
      return;
    }

    if (!isStandalone && deferredPrompt) {
      // Android/desktop Chrome — installing isn't strictly required for
      // push there, but we still surface the richer app experience when
      // the browser offers it and notifications aren't on yet anyway.
      setVariant('android-install');
      return;
    }

    // Installed already, or install isn't required on this browser —
    // remaining blocker is just the notification permission itself.
    setVariant('enable-push');
  }, [isStandalone, pushPermission, deferredPrompt]);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  const handleEnablePush = async () => {
    setBusy(true);
    const result = await webPush.subscribe();
    setBusy(false);
    refreshPushPermission();
    // Silent on failure here by design — this is a low-pressure banner,
    // not a modal. Profile > Settings has the full error messaging
    // (blocked / unsupported / not-configured) for anyone who wants it.
    void result;
  };

  if (Platform.OS !== 'web' || !variant) return null;

  return (
    <View style={styles.banner}>
      <Ionicons
        name={variant === 'enable-push' ? 'notifications-outline' : 'download-outline'}
        size={18}
        color="#c084fc"
        style={styles.icon}
      />
      <Text style={styles.text}>
        {variant === 'ios-install' &&
          'Add Orbit to your Home Screen — that\'s the only way to get notifications on iPhone. Tap Share, then "Add to Home Screen", then turn notifications on.'}
        {variant === 'android-install' &&
          'Install Orbit for the full app experience, then turn on notifications so you never miss a match.'}
        {variant === 'enable-push' &&
          (pushPermission === 'denied'
            ? 'Notifications are blocked for Orbit. Enable them in your browser/site settings so you don\'t miss a match.'
            : 'Turn on notifications — it\'s the only way to know the second you get a new match.')}
      </Text>
      {variant === 'android-install' && (
        <TouchableOpacity onPress={handleInstallClick} style={styles.actionButton}>
          <Text style={styles.actionButtonText}>Install</Text>
        </TouchableOpacity>
      )}
      {variant === 'enable-push' && pushPermission !== 'denied' && (
        <TouchableOpacity onPress={handleEnablePush} style={styles.actionButton} disabled={busy}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.actionButtonText}>Enable</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(168, 85, 247, 0.14)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(168, 85, 247, 0.35)',
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
  actionButton: {
    backgroundColor: '#9333ea',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    flexShrink: 0,
    minWidth: 56,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
})
