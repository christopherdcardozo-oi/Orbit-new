import { useEffect, useState } from 'react'
import { Slot, useRouter, useSegments, ThemeProvider, DarkTheme } from 'expo-router'
import { supabase } from '../lib/supabase'
import { Session } from '@supabase/supabase-js'
import { View, ActivityIndicator, Platform, StyleSheet } from 'react-native'
import { registerForPushNotificationsAsync, savePushToken } from '../lib/notifications'

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

    if (session && !inAppGroup && !onSignupScreen) {
      router.replace('/(app)')
    } else if (!session && inAppGroup) {
      router.replace('/')
    }
  }, [session, initialized, segments])

  const isWeb = Platform.OS === 'web'

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
  },
  appContainer: {
    flex: 1,
    width: '100%',
    backgroundColor: '#030712',
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
