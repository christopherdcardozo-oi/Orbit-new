import { useEffect, useState } from 'react'
import { Slot, useRouter, useSegments, ThemeProvider, DarkTheme } from 'expo-router'
import { supabase } from '../lib/supabase'
import { Session } from '@supabase/supabase-js'
import { View, ActivityIndicator, Platform, StyleSheet } from 'react-native'
import { registerForPushNotificationsAsync, savePushToken } from '../lib/notifications'
import InstallHint from '../components/InstallHint'

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null)
  const [initialized, setInitialized] = useState(false)
  const segments = useSegments()
  const router = useRouter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setInitialized(true)
      if (session?.user) {
        setupPushNotifications(session.user.id)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user) {
        setupPushNotifications(session.user.id)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const setupPushNotifications = async (userId: string) => {
    try {
      const token = await registerForPushNotificationsAsync()
      if (token) {
        await savePushToken(userId, token)
      }
    } catch (e) {
      console.log('Error setting up push notifications', e)
    }
  }

  useEffect(() => {
    if (!initialized) return

    const inAppGroup = segments[0] === '(app)'
    // Signup gets a session as soon as the OTP verifies, but still has its
    // own personality-questions + reveal-your-name steps to show before
    // the user should land in the app. Without this check, this redirect
    // would yank them into (app) the instant verifyOtp resolves, mid-wizard.
    // signup.tsx calls router.replace('/(app)') itself once that's done.
    const onSignupScreen = (segments as string[])[0] === '(auth)' && (segments as string[])[1] === 'signup'
    // app/chat/[id].tsx is a top-level route (sibling of (app)/(auth),
    // not inside the (app) group), so segments[0] for it is 'chat', not
    // '(app)' — without this exemption every visit (a Start Chatting tap,
    // a direct link, a refresh) got force-redirected straight back to
    // '/(app)' before the chat screen ever rendered. Confirmed live: this
    // made chat completely unreachable regardless of what was on the
    // screen itself.
    const onChatScreen = (segments as string[])[0] === 'chat'

    if (session && !inAppGroup && !onSignupScreen && !onChatScreen) {
      router.replace('/(app)')
    } else if (!session && inAppGroup) {
      router.replace('/')
    }
  }, [session, initialized, segments])

  const isWeb = Platform.OS === 'web'

  // iOS Safari has ignored the user-scalable=no / maximum-scale=1 viewport
  // meta tags since iOS 10 (an accessibility decision) — the only way to
  // actually block pinch-zoom there is intercepting the gesture events
  // directly. Pinch-zooming this app doesn't just look bad, it desyncs
  // touch coordinates from the visual viewport, so taps land on the wrong
  // element (this is what broke the chat back-button and sign-out).
  useEffect(() => {
    if (!isWeb) return

    const preventGesture = (e: Event) => e.preventDefault()
    // Safari-only gesture events, fired for pinch/rotate.
    document.addEventListener('gesturestart', preventGesture)
    document.addEventListener('gesturechange', preventGesture)
    document.addEventListener('gestureend', preventGesture)

    // Also blocks the two-finger pinch on non-Safari engines, and
    // double-tap-to-zoom everywhere.
    let lastTouchEnd = 0
    const preventMultiTouch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault()
    }
    const preventDoubleTapZoom = (e: TouchEvent) => {
      const now = Date.now()
      if (now - lastTouchEnd <= 300) e.preventDefault()
      lastTouchEnd = now
    }
    document.addEventListener('touchmove', preventMultiTouch, { passive: false })
    document.addEventListener('touchend', preventDoubleTapZoom, { passive: false })

    return () => {
      document.removeEventListener('gesturestart', preventGesture)
      document.removeEventListener('gesturechange', preventGesture)
      document.removeEventListener('gestureend', preventGesture)
      document.removeEventListener('touchmove', preventMultiTouch)
      document.removeEventListener('touchend', preventDoubleTapZoom)
    }
  }, [isWeb])

  if (!initialized) {
    return (
      <View style={[styles.rootContainer, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#a855f7" />
      </View>
    )
  }

  // Define a custom dark theme that uses transparent background so the cosmic background shines through
  const CustomDarkTheme = {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: 'transparent',
    },
  };

  return (
    <ThemeProvider value={CustomDarkTheme}>
      <View style={styles.rootContainer}>
        <View style={[styles.appContainer, isWeb && styles.webContainer]}>
          <InstallHint />
          <Slot />
        </View>
      </View>
    </ThemeProvider>
  )
}

const styles = StyleSheet.create({
  rootContainer: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    // Root-level safety net: CosmicBackground's ambient glow blobs
    // (intentionally width:150%, positioned off-edge) were one confirmed
    // source of real horizontal overflow that made iOS Safari auto-zoom
    // the whole page out and never zoom back in — fixed at the source,
    // but clipping here too means any other screen's stray absolutely-
    // positioned/oversized element can't do the same thing undetected.
    overflow: 'hidden',
  },
  appContainer: {
    flex: 1,
    width: '100%',
    backgroundColor: '#030712',
    overflow: 'hidden',
  },
  webContainer: {
    maxWidth: 440,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#1f2937',
    shadowColor: '#a855f7',
    shadowOpacity: 0.2,
    shadowRadius: 60,
  }
})
