import { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Image } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { Picker } from '@react-native-picker/picker'
import { supabase } from '../../lib/supabase'
import { useActiveUniversities } from '../../lib/universities'

import CosmicBackground from '../../components/CosmicBackground'

export default function LoginScreen() {
  const router = useRouter()
  const { universities, loading: universitiesLoading } = useActiveUniversities()
  const [selectedUniversity, setSelectedUniversity] = useState('')
  const [fullEmail, setFullEmail] = useState('')
  const [loading, setLoading] = useState(false)

  // Default to the first active campus once the list loads. If a second
  // campus goes active later, the Picker below lets people actually choose.
  useEffect(() => {
    if (!selectedUniversity && universities.length > 0) {
      setSelectedUniversity(universities[0].email_domain)
    }
  }, [universities, selectedUniversity])

  // Inline error state instead of alert()/window.alert(): alert() is
  // browser-native on web (easy to miss, blocked by some automation/
  // embedded contexts) and not guaranteed to behave the same on native
  // iOS/Android. A styled banner is visible everywhere, consistently.
  const [errorMessage, setErrorMessage] = useState('')
  // True only when the email is well-formed/allowed but has no account
  // yet — lets us offer a direct link to signup instead of a dead end.
  const [noAccountFound, setNoAccountFound] = useState(false)

  // OTP State
  const [otpPhase, setOtpPhase] = useState(false)
  const [code, setCode] = useState('')

  const handleSendCode = async () => {
    setErrorMessage('')
    setNoAccountFound(false)

    if (!fullEmail) {
      setErrorMessage('Please enter your email.')
      return
    }

    const emailStr = fullEmail.toLowerCase().trim()

    setLoading(true)

    // Emails matching the picked campus are always fine; anything else
    // has to be explicitly allowlisted server-side (admin_allowlist) or
    // match some OTHER active campus (is_email_allowed checks the full
    // active list, not just whichever one is selected in the picker).
    if (!emailStr.endsWith(`@${selectedUniversity}`)) {
      const { data: allowed, error: allowError } = await supabase.rpc(
        'is_email_allowed',
        { email_to_check: emailStr }
      )
      if (allowError || !allowed) {
        setLoading(false)
        setErrorMessage(`You must use your @${selectedUniversity} email, or an approved admin/test email.`)
        return
      }
    }

    // signInWithOtp will happily create a brand-new account for an
    // unrecognized (but allowed) email — this app's onboarding (profile
    // details, personality questions, the reveal screen) only happens in
    // signup.tsx, so silently creating an account here would land someone
    // in the app with a completely empty profile. Check first and, if
    // there's no account yet, send them to sign up instead of sending a
    // code at all.
    const { data: exists, error: existsError } = await supabase.rpc(
      'check_email_exists',
      { email_to_check: emailStr }
    )
    if (existsError) {
      console.warn('check_email_exists RPC error:', existsError)
    }
    if (!exists) {
      setLoading(false)
      setNoAccountFound(true)
      setErrorMessage("We don't have an account for that email yet.")
      return
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: emailStr,
    })
    setLoading(false)
    if (error) {
      setErrorMessage(error.message)
    } else {
      setOtpPhase(true)
    }
  }

  const handleVerifyCode = async () => {
    if (!code) return
    setErrorMessage('')
    setLoading(true)
    const emailStr = fullEmail.toLowerCase().trim()
    const { error } = await supabase.auth.verifyOtp({
      email: emailStr,
      token: code,
      type: 'email'
    })
    setLoading(false)
    if (error) {
      setErrorMessage(error.message)
    }
    // If successful, app/_layout.tsx will auto-redirect to dashboard
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <CosmicBackground />
      <View style={styles.card}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="Orbit"
        />
        <Text style={styles.title}>Welcome Back 🚀</Text>
        <Text style={styles.subtitle}>
          {otpPhase ? 'Enter the 8-digit code sent to your email' : 'Select your campus and enter your email'}
        </Text>

        {!otpPhase ? (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>University</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={selectedUniversity}
                  onValueChange={(val) => { setSelectedUniversity(val); setErrorMessage(''); setNoAccountFound(false) }}
                  style={styles.picker}
                  itemStyle={styles.pickerItem}
                  enabled={!universitiesLoading && universities.length > 0}
                >
                  {universitiesLoading ? (
                    <Picker.Item label="Loading campuses…" value="" />
                  ) : universities.length === 0 ? (
                    <Picker.Item label="No campuses available" value="" />
                  ) : (
                    universities.map((u) => (
                      <Picker.Item key={u.email_domain} label={u.university_name} value={u.email_domain} />
                    ))
                  )}
                </Picker>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>University Email</Text>
              <TextInput
                style={styles.textInput}
                placeholder={selectedUniversity ? `e.g. netid@${selectedUniversity}` : 'e.g. netid@youruniversity.edu'}
                placeholderTextColor="#6b7280"
                value={fullEmail}
                onChangeText={(text) => { setFullEmail(text); setErrorMessage(''); setNoAccountFound(false) }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <Text style={styles.helpText}>
                {selectedUniversity
                  ? `Use your @${selectedUniversity} email, or an approved admin/test email.`
                  : 'Select your campus above.'}
              </Text>
            </View>

            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
                {noAccountFound && (
                  <TouchableOpacity onPress={() => router.push('/(auth)/signup')}>
                    <Text style={styles.errorLink}>Sign up here →</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.button}
              onPress={handleSendCode}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Send Code</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Verification Code</Text>
              <TextInput
                style={styles.codeInput}
                placeholder="00000000"
                placeholderTextColor="#6b7280"
                value={code}
                onChangeText={(text) => { setCode(text); setErrorMessage('') }}
                keyboardType="number-pad"
                maxLength={8}
              />
            </View>

            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.button}
              onPress={handleVerifyCode}
              disabled={loading || code.length < 6}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Verify & Login</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.linkButton} onPress={() => { setOtpPhase(false); setErrorMessage('') }}>
              <Text style={styles.linkText}>Back to Email</Text>
            </TouchableOpacity>
          </>
        )}

        {!otpPhase && (
          <Link href="/(auth)/signup" asChild>
            <TouchableOpacity style={styles.linkButton}>
              <Text style={styles.linkText}>Don't have an account? Sign up here</Text>
            </TouchableOpacity>
          </Link>
        )}

      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  logo: {
    width: 120,
    height: 120,
    alignSelf: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 32,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    color: '#d1d5db',
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  helpText: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 6,
  },
  pickerContainer: {
    backgroundColor: 'rgba(3, 7, 18, 0.5)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    overflow: 'hidden',
  },
  // On web, Picker renders as a plain <select>: it needs an explicit
  // height + fontSize to match TextInput's box, and borderWidth: 0 so
  // its own default border doesn't double up with pickerContainer's.
  // Native iOS/Android are left untouched (see the matching comment in
  // app/(app)/profile.tsx for the full explanation).
  picker: {
    backgroundColor: 'transparent',
    color: '#fff',
    ...(Platform.OS === 'web'
      ? { height: 48, paddingHorizontal: 16, fontSize: 16, borderWidth: 0 }
      : {}),
  },
  pickerItem: {
    color: '#fff',
    backgroundColor: '#030712',
    fontSize: 16,
  },
  textInput: {
    backgroundColor: 'rgba(3, 7, 18, 0.5)',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
    letterSpacing: 0,
  },
  codeInput: {
    backgroundColor: 'rgba(3, 7, 18, 0.5)',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    color: '#fff',
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 8,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 14,
    lineHeight: 20,
  },
  errorLink: {
    color: '#fca5a5',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
    textDecorationLine: 'underline',
  },
  button: {
    backgroundColor: '#9333ea',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  linkButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  linkText: {
    color: '#c084fc',
    fontSize: 14,
    fontWeight: '500',
  },
})
