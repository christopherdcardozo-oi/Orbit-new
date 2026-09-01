// Detects when a newer deploy is live, without depending on any
// custom build-time version file or a specific Vercel build command.
//
// Expo's web export names the JS bundle with a content hash —
// /_expo/static/js/web/entry-<hash>.js — so a fresh deploy always
// produces a different filename. We compare the hash baked into the
// currently-running page against a no-cache fetch of a fresh copy of
// index.html. If they differ, a newer version is live.
//
// See components/UpdateBanner.tsx for the UI that acts on this.

import { Platform } from 'react-native';

const BUNDLE_SRC_PATTERN = /\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/;

function extractBundleSrc(html: string): string | null {
  const match = html.match(BUNDLE_SRC_PATTERN);
  return match ? match[0] : null;
}

// Cached after first read — the currently-running bundle's own script
// tag never changes for the lifetime of this page load.
let currentBundleSrc: string | null | undefined;

export function getCurrentBundleSrc(): string | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  if (currentBundleSrc !== undefined) return currentBundleSrc;

  const scripts = Array.from(document.getElementsByTagName('script'));
  for (const s of scripts) {
    const src = s.getAttribute('src') || '';
    if (BUNDLE_SRC_PATTERN.test(src)) {
      currentBundleSrc = src;
      return src;
    }
  }
  // Dev server (expo start --web) doesn't produce a hashed bundle —
  // nothing to compare against, so version checking is a no-op there.
  currentBundleSrc = null;
  return null;
}

// Short, human-showable id for the currently-running build — the
// content hash out of the bundle filename, truncated. Used in the
// Settings footer so "which version am I on" is answerable without
// opening devtools.
export function getCurrentBuildId(): string | null {
  const src = getCurrentBundleSrc();
  if (!src) return null;
  const match = src.match(/entry-([a-f0-9]+)\.js/);
  return match ? match[1].slice(0, 7) : null;
}

export async function isUpdateAvailable(): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  const current = getCurrentBundleSrc();
  if (!current) return false;

  try {
    // cache: 'no-store' is the important part — a normal fetch would
    // happily hand back the same cached index.html we already have.
    const res = await fetch('/', { cache: 'no-store' });
    if (!res.ok) return false;
    const html = await res.text();
    const latest = extractBundleSrc(html);
    if (!latest) return false;
    return latest !== current;
  } catch {
    // Offline / flaky network — just don't claim an update exists.
    return false;
  }
}
