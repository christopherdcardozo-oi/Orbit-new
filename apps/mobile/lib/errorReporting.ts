// Client error reporting.
//
// The app previously had none: no Sentry, no Crashlytics, no error
// boundary. A render exception blanked the screen and nobody found out.
// This catches JS exceptions, unhandled promise rejections and React
// render errors, and writes them to public.client_errors (058).
//
// It does NOT catch native crashes. The iOS 26 SIGABRT documented in
// lib/notifications.ts is exactly what it would miss, so a native crash
// reporter is still worth adding — this is the version that works
// today without a third-party account.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

type ErrorKind = 'render' | 'uncaught' | 'unhandled_rejection' | 'manual';

// Never let reporting take down the thing it's reporting on, and never
// let one broken render spam thousands of rows.
const MAX_PER_SESSION = 25;
let reported = 0;
const seen = new Set<string>();

function appVersion(): string | null {
  try {
    return (Constants.expoConfig?.version as string | undefined) ?? null;
  } catch {
    return null;
  }
}

function currentRoute(): string | null {
  if (Platform.OS !== 'web') return null;
  try {
    return window.location?.pathname ?? null;
  } catch {
    return null;
  }
}

/**
 * Record an error. Always resolves — a reporting failure must never
 * surface to the user or reject into the handler that called it.
 */
export async function reportError(
  error: unknown,
  kind: ErrorKind = 'manual',
  context?: string,
): Promise<void> {
  try {
    if (reported >= MAX_PER_SESSION) return;

    const err = error instanceof Error ? error : new Error(String(error));
    const message = [context, err.message].filter(Boolean).join(' — ').slice(0, 2000);
    const stack = err.stack ? err.stack.slice(0, 8000) : null;

    // De-dupe within a session: a render loop would otherwise write the
    // same row until it hits the cap.
    const fingerprint = `${kind}:${message}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    reported += 1;

    // Logged regardless, so it's visible in dev even if the insert fails.
    console.error(`[${kind}]`, message, stack ?? '');

    const { data: { user } } = await supabase.auth.getUser();

    await supabase.from('client_errors').insert({
      // RLS requires this to equal auth.uid(); a signed-out crash can't
      // be attributed and is dropped rather than failing the insert.
      user_id: user?.id ?? null,
      platform: Platform.OS,
      app_version: appVersion(),
      kind,
      message,
      stack,
      route: currentRoute(),
    });
  } catch {
    // Swallow. Reporting is best-effort by definition.
  }
}

let installed = false;

/**
 * Install global handlers. Safe to call more than once.
 */
export function installErrorReporting(): void {
  if (installed) return;
  installed = true;

  // React Native's global handler. Present on native; absent on web.
  const globalAny = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler: () => (e: unknown, isFatal?: boolean) => void;
      setGlobalHandler: (h: (e: unknown, isFatal?: boolean) => void) => void;
    };
  };

  if (globalAny.ErrorUtils?.setGlobalHandler) {
    const previous = globalAny.ErrorUtils.getGlobalHandler();
    globalAny.ErrorUtils.setGlobalHandler((e, isFatal) => {
      void reportError(e, 'uncaught', isFatal ? 'fatal' : undefined);
      // Chain to RN's own handler so the red box / crash behaviour is
      // unchanged.
      previous?.(e, isFatal);
    });
  }

  if (Platform.OS === 'web') {
    try {
      window.addEventListener('error', (event) => {
        void reportError(event.error ?? event.message, 'uncaught');
      });
      window.addEventListener('unhandledrejection', (event) => {
        void reportError(event.reason, 'unhandled_rejection');
      });
    } catch {
      // ignore
    }
  }
}
