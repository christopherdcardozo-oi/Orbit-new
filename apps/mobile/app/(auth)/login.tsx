import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native'
import { Link } from 'expo-router'
import { supabase } from '../../lib/supabase'
import * as Linking from 'expo-linking'
import { Picker } from '@react-native-picker/picker'

import CosmicBackground from '../../components/CosmicBackground'

export default function LoginScreen() {
  const [selectedUniversity, setSelectedUniversity] = useState('iastate.edu')
  const [fullEmail, setFullEmail] = useState('')
  const [loading, setLoading] = useState(false)
  
  // OTP State
  const [otpPhase, setOtpPhase] = useState(false)
  const [code, setCode] = useState('')

  const handleSendCode = async () => {
    if (!fullEmail) {
      alert('Error: Please enter your email.')
      return
    }

    const emailStr = fullEmail.toLowerCase().trim()

    setLoading(true)

    // Emails matching the picked campus are always fine; anything else
    // has to be explicitly allowlisted server-side (admin_allowlist).
    if (!emailStr.endsWith(`@${selectedUniversity}`)) {
      const { data: allowed, error: allowError } = await supabase.rpc(
        'is_email_allowed',
        { email_to_check: emailStr }
      )
      if (allowError || !allowed) {
        setLoading(false)
        alert(`Invalid Email: You must use your @${selectedUniversity} email`)
        return
      }
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: emailStr,
    })
    setLoading(false)
    if (error) {
      alert(`Error: ${error.message}`)
    } else {
      setOtpPhase(true)
    }
  }

  const handleVerifyCode = async () => {
    if (!code) return
    setLoading(true)
    const emailStr = fullEmail.toLowerCase().trim()
    const { error } = await supabase.auth.verifyOtp({
      email: emailStr,
      token: code,
      type: 'email'
    })
    setLoading(false)
    if (error) {
      alert(`Error: ${error.message}`)
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
        <Text style={styles.title}>Welcome Back 🚀</Text>
        <Text style={styles.subtitle}>
          {otpPhase ? 'Enter the 8-digit code sent to your email' : 'Select your campus and enter your email'}
        </Text>

        {!otpPhase ? (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Select University</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={selectedUniversity}
                  onValueChange={(itemValue) => setSelectedUniversity(itemValue)}
                  style={styles.picker}
                  itemStyle={styles.pickerItem}
                >
                  <Picker.Item label="Iowa State University" value="iastate.edu" />
                </Picker>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>University Email</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. cy@iastate.edu"
                placeholderTextColor="#6b7280"
                value={fullEmail}
                onChangeText={setFullEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
            </View>

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
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={8}
              />
            </View>

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

            <TouchableOpacity style={styles.linkButton} onPress={() => setOtpPhase(false)}>
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
  pickerContainer: {
    backgroundColor: 'rgba(3, 7, 18, 0.5)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    overflow: 'hidden',
  },
  picker: {
    color: '#fff',
  },
  pickerItem: {
    color: '#fff',
    backgroundColor: '#030712',
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
