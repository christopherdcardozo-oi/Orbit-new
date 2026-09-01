import { useEffect, useState } from 'react'
import { Slot, useRouter, useSegments, ThemeProvider, DarkTheme } from 'expo-router'
import { supabase } from '../lib/supabase'
import { Session } from '@supabase/supabase-js'
import { View, ActivityIndicator, Platform, StyleSheet } from 'react-native'
import { registerForPushNotificationsAsync } from '../lib/notifications'
import * as webPush from '../lib/webPush'
import { useIsStandalone } from '../lib/useIsStandalone'
import InstallHint from '../components/InstallHint'
import UpdateBanner from '../components/UpdateBanner'

// Bumping the counts (see docs/push-notifications.md#2026-09-01) — most of
// the 41 signed-up users had 0 web_push_subscriptions rows. Root cause:
// the ONLY way to subscribe was manually opening Settings and flipping a
// toggle, which nobody does unprompted. This key gates a single
// auto-prompt per browser so we ask once, right after signing in, instead
// of relying on someone finding the toggle themselves.
const AUTO_PUSH_PROMPT_KEY = 'orbit-auto-push-prompted'

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null)
  const [initialized, setInitialized] = useState(false)
  // null = not checked yet (or no session). false = confirmed banned
  // (profiles.is_active = false — see app/admin/users.tsx "Ban
  // account"). Previously banning only excluded someone from the
  // matchmaker's pool; they could still fully sign in and use the app.
  // This flag + the redirect below is what actually closes that gap.
  const [isActive, setIsActive] = useState<boolean | null>(null)
  const segments = useSegments()
  const router = useRouter()
  const isStandalone = useIsStandalone()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setInitialized(true)
      if (session?.user) {
        setupPushNotifications(session.user.id)
        checkActive(session.user.id)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user) {
        setupPushNotifications(session.user.id)
        checkActive(session.user.id)
      } else {
        setIsActive(null)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const setupPushNotifications = async (_userId: string) => {
    // Registration handles the DB upsert internally now (previously
    // this passed the token back through savePushToken). Firebase
    // messaging replaces the old Expo push token flow.
    try {
      await registerForPushNotificationsAsync()
    } catch (e) {
      console.log('Error setting up push notifications', e)
    }
  }

  const checkActive = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      // Fail open — a network hiccup shouldn't lock someone out of an
      // otherwise-fine account. The redirect below only fires on an
      // explicit `false`, never on "couldn't tell."
      console.log('Error checking account status', error)
      return
    }
    setIsActive(data?.is_active ?? true)
  }

  // Web push: auto-prompt once per browser, right after we know
  // there's a signed-in session AND the app is running as an
  // installed PWA. Previously the ONLY way to subscribe was manually
  // finding the toggle in Profile > Settings — nobody did, so 39 of
  // the first 41 signed-up users had zero web_push_subscriptions
  // rows despite web being our only shipped surface. iOS only shows
  // the permission prompt for an installed PWA (a bare Safari tab
  // can't even ask), so gating on isStandalone avoids a prompt that
  // would just silently fail there anyway. AUTO_PUSH_PROMPT_KEY caps
  // it to once per browser — if they say no, we don't nag on every
  // reload; the manual toggle in Settings is still there for anyone
  // who changes their mind later.
  useEffect(() => {
    if (Platform.OS !== 'web') return
    if (!session?.user) return
    if (!isStandalone) return

    try {
      if (localStorage.getItem(AUTO_PUSH_PROMPT_KEY) === '1') return
    } catch {
      // Privacy mode etc — just don't persist, fall through and ask anyway.
    }

    if (webPush.getPermission() !== 'default') return

    webPush.subscribe().finally(() => {
      try {
        localStorage.setItem(AUTO_PUSH_PROMPT_KEY, '1')
      } catch {
        // ignore
      }
    })
  }, [session, isStandalone])

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
    // Privacy Policy and Terms of Service live under /legal — they need
    // to stay reachable from every entry point (signed-out signup footer,
    // in-app Settings sheet, direct URL from anywhere), so the
    // session-based redirect below must skip them the same way it skips
    // the chat and signup routes.
    const onLegalScreen = (segments as string[])[0] === 'legal'
    // app/admin/* — same top-level-route situation as chat and legal
    // above. The admin screens do their own is_admin gate on mount
    // (see app/admin/_layout.tsx); this exemption just lets them
    // render at all instead of bouncing straight back to '/(app)'.
    const onAdminScreen = (segments as string[])[0] === 'admin'
    const onSuspendedScreen = (segments as string[])[0] === 'suspended'

    // Banned account: hard-redirect to /suspended regardless of what
    // route they were headed to, same as the no-session case below.
    // Checked before every other branch so a stale isActive===false
    // from a previous check can't be raced by one of the exemptions.
    if (session && isActive === false && !onSuspendedScreen) {
      router.replace('/suspended')
      return
    }

    if (session && !inAppGroup && !onSignupScreen && !onChatScreen && !onLegalScreen && !onAdminScreen && !onSuspendedScreen) {
      router.replace('/(app)')
    } else if (!session && inAppGroup) {
      router.replace('/')
    }
  }, [session, initialized, segments, isActive])

  const isWeb = Platform.OS === 'web'

  // A previous fix here globally intercepted gesturestart/touchmove/
  // touchend on `document` to block pinch-zoom, on the theory that zoom
  // was desyncing taps. It wasn't needed — the actual bugs were real
  // horizontal overflow (CosmicBackground's off-edge glow blobs, see
  // components/CosmicBackground.tsx) and a sub-16px composer font
  // triggering iOS's forced zoom-on-focus, both fixed at the source.
  // Removed because blocking touchend/touchmove globally (not scoped
  // away from inputs) broke double-tap-to-select and other normal
  // text-field interactions everywhere in the app, including the login
  // email field.

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
          <UpdateBanner />
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
