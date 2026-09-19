// Sign-out that actually cleans up after itself.
//
// Both sign-out call sites used to call supabase.auth.signOut() alone,
// leaving this device's push registration in place. The device then
// kept receiving the previous user's notifications — on a shared phone
// or browser, someone else's private match and message alerts.

import { Platform } from 'react-native';
import { supabase } from './supabase';
import { unregisterPushToken } from './notifications';
import * as webPush from './webPush';

export async function signOutEverywhere(): Promise<{ error: Error | null }> {
  // Ordering matters: both cleanups delete rows that RLS scopes to the
  // current user, so they have to happen while the session still exists.
  try {
    if (Platform.OS === 'web') {
      await webPush.unsubscribe();
    } else {
      await unregisterPushToken();
    }
  } catch (err) {
    // A failed cleanup must never trap someone in a signed-in state.
    console.log('Push cleanup on sign-out failed:', err);
  }

  const { error } = await supabase.auth.signOut();
  return { error: error ?? null };
}
