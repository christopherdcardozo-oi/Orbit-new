import { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native'
import { Link, useRouter, useLocalSearchParams } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { Picker } from '@react-native-picker/picker'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import CosmicBackground from '../../components/CosmicBackground'
import { PERSONALITY_QUESTIONS } from '../../lib/personality'
import { HOBBIES, ACTIVITIES } from '../../lib/interests'
import { useActiveUniversities } from '../../lib/universities'

const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'];
const GENDERS = ['Male', 'Female', 'Other'];

type Step = 'details' | 'code' | 'personality' | 'reveal'

export default function SignupScreen() {
  const router = useRouter()
  // ?campus=iastate.edu comes from the Invite a Friend flow —
  // pre-select the picker so friends of an ISU user land right on ISU.
  const { campus } = useLocalSearchParams<{ campus?: string }>()
  const { universities, loading: universitiesLoading } = useActiveUniversities()
  const [selectedUniversity, setSelectedUniversity] = useState('')
  const [fullEmail, setFullEmail] = useState('')

  // Default to the invited campus (if valid) or the first active campus.
  useEffect(() => {
    if (selectedUniversity || universities.length === 0) return
    const wanted = typeof campus === 'string' && universities.some(u => u.email_domain === campus)
      ? campus
      : universities[0].email_domain
    setSelectedUniversity(wanted)
  }, [universities, selectedUniversity, campus])

  // Profile details
  const [gender, setGender] = useState('Male')
  const [customGender, setCustomGender] = useState('')
  const [major, setMajor] = useState('')
  const [year, setYear] = useState('Freshman')

  // Personality answers, one per PERSONALITY_QUESTIONS entry
  const [personality, setPersonality] = useState<string[]>([])
  // Multi-select chip state — matches the old apps/web signup design.
  // Hobbies is required (at least one); activities is optional (plenty
  // of legit users aren't in any campus organizations).
  const [hobbies, setHobbies] = useState<string[]>([])
  const [activities, setActivities] = useState<string[]>([])

  // What we reveal at the end — generated server-side by the
  // handle_new_user() trigger (see supabase/migrations/011_*).
  const [revealAlias, setRevealAlias] = useState('')
  const [revealAvatar, setRevealAvatar] = useState('alien')

  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<Step>('details')
  const [code, setCode] = useState('')

  // Inline error state instead of alert()/window.alert() — see the
  // matching comment in app/(auth)/login.tsx for why.
  const [errorMessage, setErrorMessage] = useState('')
  // True only for the "you already have an account" case, so we can
  // offer a direct link to login instead of a dead end.
  const [accountExists, setAccountExists] = useState(false)

  const handleSendCode = async () => {
    setErrorMessage('')
    setAccountExists(false)

    if (!fullEmail) {
      setErrorMessage('Please enter your email.')
      return
    }
    if (!major.trim()) {
      setErrorMessage('Please enter your major.')
      return
    }
    if (gender === 'Other' && !customGender.trim()) {
      setErrorMessage('Please enter your identity.')
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
        setErrorMessage(`You must use your @${selectedUniversity} email, or an approved admin/test email.`)
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
      setAccountExists(true)
      setErrorMessage('That email already has an account.')
      return
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: emailStr,
    })

    setLoading(false)
    if (error) {
      setErrorMessage(error.message)
    } else {
      setStep('code')
    }
  }

  const handleVerifyCode = async () => {
    if (!code) return
    setErrorMessage('')
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
      setErrorMessage(authError.message)
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
    // Root layout's redirect effect is told to leave us alone while
    // segments === (auth)/signup, so we're safe to keep going here
    // instead of getting yanked into (app) now that session is set.
    setStep('personality')
  }

  const setPersonalityAnswer = (index: number, answer: string) => {
    const next = [...personality]
    next[index] = answer
    setPersonality(next)
  }

  const toggleChip = (v: string, list: string[], setList: (l: string[]) => void) => {
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
    if (errorMessage) setErrorMessage('')
  }

  const handleSavePersonality = async () => {
    setErrorMessage('')
    // All four personality answers are required — they're the strongest
    // matching signal (weighted +3 each in compatibilityScore) and every
    // icebreaker template leans on them. Letting people skip breaks the
    // matcher's most important input.
    const missing = PERSONALITY_QUESTIONS.some((_, i) => !personality[i] || !personality[i].trim())
    if (missing) {
      setErrorMessage('Please answer all four questions before continuing.')
      return
    }
    // At least one hobby — everyone has one, and it's the second-heaviest
    // matching signal (+2 per shared hobby). Activities is optional
    // since plenty of legit users aren't in any campus organizations.
    if (hobbies.length === 0) {
      setErrorMessage('Please pick at least one hobby.')
      return
    }

    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      setErrorMessage('Session expired — please start over.')
      return
    }

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ personality, hobbies, activities })
      .eq('id', user.id)

    if (updateError) {
      console.warn('Failed to save personality/interests:', updateError)
    }

    // Fetch what the trigger generated at signup — the whole point of
    // this step is to reveal it.
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_alias, avatar')
      .eq('id', user.id)
      .single()

    if (profile) {
      setRevealAlias(profile.display_alias)
      setRevealAvatar(profile.avatar || 'alien')
    }

    setLoading(false)
    setStep('reveal')
  }

  const handleEnterOrbit = () => {
    router.replace('/(app)')
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <CosmicBackground />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          {step !== 'reveal' && (
            <>
              <Text style={styles.title}>Join Orbit ✨</Text>
              <Text style={styles.subtitle}>
                {step === 'details' && 'Tell us about yourself to begin'}
                {step === 'code' && 'Enter the 8-digit code sent to your email'}
                {step === 'personality' && 'A few quick questions for better matches'}
              </Text>
            </>
          )}

          {step === 'details' && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>University</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={selectedUniversity}
                    onValueChange={(val) => { setSelectedUniversity(val); setErrorMessage(''); setAccountExists(false) }}
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
                  onChangeText={(text) => { setFullEmail(text); setErrorMessage(''); setAccountExists(false) }}
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

              {errorMessage ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                  {accountExists && (
                    <Link href="/(auth)/login" asChild>
                      <TouchableOpacity>
                        <Text style={styles.errorLink}>Log in here →</Text>
                      </TouchableOpacity>
                    </Link>
                  )}
                </View>
              ) : null}

              <TouchableOpacity style={styles.button} onPress={handleSendCode} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send Verification Code</Text>}
              </TouchableOpacity>

              {/* Consent notice — visible before the user submits their
                  email, links open the pages (they route out of signup
                  and back is available). */}
              <Text style={styles.legalNotice}>
                By continuing you agree to our{' '}
                <Link href="/legal/terms" style={styles.legalLink}>Terms of Service</Link>
                {' '}and{' '}
                <Link href="/legal/privacy" style={styles.legalLink}>Privacy Policy</Link>
                .
              </Text>
            </>
          )}

          {step === 'code' && (
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

              <TouchableOpacity style={styles.button} onPress={handleVerifyCode} disabled={loading || code.length < 6}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify Code</Text>}
              </TouchableOpacity>

              <TouchableOpacity style={styles.linkButton} onPress={() => { setStep('details'); setErrorMessage('') }}>
                <Text style={styles.linkText}>Back to details</Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'personality' && (
            <>
              {errorMessage ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}

              {PERSONALITY_QUESTIONS.map((q, i) => (
                <View key={q.key} style={styles.inputGroup}>
                  <Text style={styles.label}>{q.label}</Text>
                  <View style={styles.pickerContainer}>
                    <Picker
                      selectedValue={personality[i] || ''}
                      onValueChange={(val) => setPersonalityAnswer(i, val)}
                      style={styles.picker}
                      itemStyle={styles.pickerItem}
                    >
                      <Picker.Item label="Select answer..." value="" />
                      {q.options.map(opt => <Picker.Item key={opt} label={opt} value={opt} />)}
                    </Picker>
                  </View>
                </View>
              ))}

              {/* Hobbies (required — at least one). */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Hobbies · pick a few</Text>
                <View style={styles.chipRow}>
                  {HOBBIES.map((h) => (
                    <TouchableOpacity
                      key={h}
                      style={[styles.chip, hobbies.includes(h) && styles.chipActiveHobby]}
                      onPress={() => toggleChip(h, hobbies, setHobbies)}
                    >
                      <Text style={[styles.chipText, hobbies.includes(h) && { color: '#fff' }]}>{h}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Activities (optional — not everyone's in a campus org). */}
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Campus activities · optional</Text>
                <View style={styles.chipRow}>
                  {ACTIVITIES.map((a) => (
                    <TouchableOpacity
                      key={a}
                      style={[styles.chip, activities.includes(a) && styles.chipActiveActivity]}
                      onPress={() => toggleChip(a, activities, setActivities)}
                    >
                      <Text style={[styles.chipText, activities.includes(a) && { color: '#fff' }]}>{a}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Also render the error just above Continue — the top
                  banner is way off-screen after scrolling through the
                  personality + hobby + activity chips. */}
              {errorMessage ? (
                <View style={[styles.errorBox, { marginTop: 8 }]}>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}

              <TouchableOpacity style={styles.button} onPress={handleSavePersonality} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue</Text>}
              </TouchableOpacity>
            </>
          )}

          {step === 'reveal' && (
            <View style={styles.revealContainer}>
              <View style={styles.revealAvatarRing}>
                <MaterialCommunityIcons name={revealAvatar as any} size={72} color="#c084fc" />
              </View>
              <Text style={styles.revealEyebrow}>Your cosmic identity is</Text>
              <Text style={styles.revealAlias}>{revealAlias || '…'}</Text>
              <Text style={styles.revealSubtitle}>
                Nobody sees your real name here. This is who you'll be, every time you match.
              </Text>
              <TouchableOpacity style={styles.button} onPress={handleEnterOrbit}>
                <Text style={styles.buttonText}>Enter Orbit</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'details' && (
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
  // See the matching comment in app/(app)/profile.tsx — on web, Picker
  // renders as a plain <select>: it needs an explicit height + fontSize
  // to match TextInput's box, and borderWidth: 0 so its own default
  // border doesn't double up with pickerContainer's. Native iOS/Android
  // are left untouched.
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
    // Every other step's button sits in a plain View (default
    // alignItems: 'stretch'), so it naturally fills the width. The
    // reveal step's container centers its children instead (to center
    // the avatar/text), which would otherwise shrink this button down
    // to fit "Enter Orbit" — alignSelf: 'stretch' overrides that and
    // keeps every button full-width regardless of its parent's layout.
    alignSelf: 'stretch',
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
  },
  chipActiveHobby: {
    backgroundColor: '#9333ea',
    borderColor: '#9333ea',
  },
  chipActiveActivity: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  chipText: {
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '600',
  },
  legalNotice: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 8,
  },
  legalLink: {
    color: '#c084fc',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  revealContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  revealAvatarRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 2,
    borderColor: '#a855f7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
  },
  revealEyebrow: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  revealAlias: {
    fontSize: 32,
    fontWeight: '900',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
  },
  revealSubtitle: {
    fontSize: 15,
    color: '#d1d5db',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
})
