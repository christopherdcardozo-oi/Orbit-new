// Detects whether the app is running as an installed PWA (added to
// home screen or "installed as app" via Chrome's install prompt) vs a
// regular browser tab. Web-only concern — always returns false on
// native builds.
//
// Two signals used together, matching InstallHint.tsx:
//   - CSS media query `display-mode: standalone` — Chrome/Edge/Android
//     when installed, and on some iOS versions.
//   - Legacy `window.navigator.standalone` — the older iOS Safari
//     signal for "added to Home Screen".
//
// Both are read at module load; standalone status doesn't change
// mid-session so we don't listen for updates.

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

function detect(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if ((window.navigator as any).standalone === true) return true;
  } catch {
    // Very old browsers / SSR — safe to say "not standalone".
  }
  return false;
}

export function useIsStandalone(): boolean {
  const [standalone, setStandalone] = useState<boolean>(() => detect());
  useEffect(() => {
    // Re-run once on client mount in case detect() ran during SSR.
    setStandalone(detect());
  }, []);
  return standalone;
}
