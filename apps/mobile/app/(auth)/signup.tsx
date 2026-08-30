import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import { Link, useRouter } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { Picker } from '@react-native-picker/picker'
import CosmicBackground from '../../components/CosmicBackground'

const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'];
const GENDERS = ['Male', 'Female', 'Other'];

export default function SignupScreen() {
  const router = useRouter()
  const [selectedUniversity, setSelectedUniversity] = useState('iastate.edu')
  const [fullEmail, setFullEmail] = useState('')
  
  // Profile details
  const [gender, setGender] = useState('Male')
  const [customGender, setCustomGender] = useState('')
  const [major, setMajor] = useState('')
  const [year, setYear] = useState('Freshman')

  const [loading, setLoading] = useState(false)
  
  // Steps: 1 = Details, 2 = Code Verification
  const [step, setStep] = useState(1)
  const [code, setCode] = useState('')

  const handleSendCode = async () => {
    if (!fullEmail) {
      alert('Error: Please enter your email.')
      return
    }
    if (!major.trim()) {
      alert('Error: Please enter your major.')
      return
    }
    if (gender === 'Other' && !customGender.trim()) {
      alert('Error: Please enter your identity.')
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

    // Check if email already exists
    const { data: exists, error: rpcError } = await supabase.rpc('check_email_exists', { email_to_check: emailStr })
    
    if (rpcError) {
      console.warn("RPC Error:", rpcError)
    }

    if (exists) {
      setLoading(false)
      alert('Account Exists: That email has already been used. Please log in instead.')
      return
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: emailStr,
    })
    
    setLoading(false)
    if (error) {
      alert(error.message)
    } else {
      setStep(2)
    }
  }

  const handleVerifyCode = async () => {
    if (!code) return
    setLoading(true)
    const emailStr = fullEmail.toLowerCase().trim()
    
    // Verify OTP
    const { data: authData, error: authError } = await supabase.auth.verifyOtp({
      email: emailStr,
      token: code,
      type: 'email'
    })

    if (authError) {
      setLoading(false)
      alert(`Error: ${authError.message}`)
      return
    }

    // Now that user is created and trigger ran, update their profile with details!
    if (authData?.user) {
      const { error: updateError } = await supabase.from('profiles').update({
        gender,
        custom_gender: gender === 'Other' ? customGender : null,
        major,
        year_in_school: year,
      }).eq('id', authData.user.id);
      
      if (updateError) {
        console.warn("Failed to update profile details:", updateError);
      }
    }
    
    setLoading(false)
    // App Layout will automatically redirect to dashboard
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <CosmicBackground />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.title}>Join Orbit ✨</Text>
          <Text style={styles.subtitle}>
            {step === 1 ? 'Tell us about yourself to begin' : 'Enter the 8-digit code sent to your email'}
          </Text>

          {step === 1 ? (
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

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Identity</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={gender}
                    onValueChange={setGender}
                    style={styles.picker}
                    itemStyle={styles.pickerItem}
                  >
                    {GENDERS.map(g => <Picker.Item key={g} label={g} value={g} />)}
                  </Picker>
                </View>
              </View>

              {gender === 'Other' && (
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Please Specify</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Type your identity"
                    placeholderTextColor="#6b7280"
                    value={customGender}
                    onChangeText={setCustomGender}
                  />
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Major</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. Computer Science"
                  placeholderTextColor="#6b7280"
                  value={major}
                  onChangeText={setMajor}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Year in School</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={year}
                    onValueChange={setYear}
                    style={styles.picker}
                    itemStyle={styles.pickerItem}
                  >
                    {YEARS.map(y => <Picker.Item key={y} label={y} value={y} />)}
                  </Picker>
                </View>
              </View>

              <TouchableOpacity style={styles.button} onPress={handleSendCode} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send Verification Code</Text>}
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

              <TouchableOpacity style={styles.button} onPress={handleVerifyCode} disabled={loading || code.length < 6}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify Code</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={styles.linkButton} onPress={() => setStep(1)}>
                <Text style={styles.linkText}>Back to details</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 1 && (
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity style={styles.linkButton}>
                <Text style={styles.linkText}>Already have an account? Log in here</Text>
              </TouchableOpacity>
            </Link>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 16,
    paddingVertical: 60,
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
    marginBottom: 16,
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
    backgroundColor: 'transparent',
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
