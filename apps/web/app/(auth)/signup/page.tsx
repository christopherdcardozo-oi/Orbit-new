'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// Three-step OTP signup:
//   1. 'email'   → enter email, we send a numeric code
//   2. 'code'    → enter code, we verifyOtp in-place (no /callback)
//   3. 'profile' → fill major/year/hobbies/activities, upsert into profiles
//
// On page load, if the user already has a session (e.g. finished step 2
// then refreshed), we jump straight to step 3.

const HOBBIES = ['Gaming', 'Hiking', 'Reading', 'Music', 'Cooking', 'Sports', 'Art', 'Photography', 'Travel', 'Coding', 'Movies', 'Fitness']
const ACTIVITIES = ['Greek Life', 'Student Government', 'Intramurals', 'Research', 'Volunteering', 'Club Sports', 'Band/Orchestra', 'Theater', 'Debate', 'Esports']
const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate']

type Step = 'email' | 'code' | 'profile'

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  // Step 1: email fields
  const [selectedUniversity, setSelectedUniversity] = useState('')
  const [emailPrefix, setEmailPrefix] = useState('')
  const [rawEmail, setRawEmail] = useState('')
  const [useAllowlist, setUseAllowlist] = useState(false)

  // Step 2: code
  const [code, setCode] = useState('')

  // Step 3: profile fields
  const [major, setMajor] = useState('')
  const [year, setYear] = useState('')
  const [hobbies, setHobbies] = useState<string[]>([])
  const [activities, setActivities] = useState<string[]>([])

  const emailToSend = useAllowlist
    ? rawEmail.toLowerCase().trim()
    : `${emailPrefix}@${selectedUniversity}`.toLowerCase().trim()

  useEffect(() => {
    // If the user already finished OTP and we're just returning to the
    // profile step, jump right to it.
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setStep('profile')
    })
  }, [])

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    setErrorMessage('')

    if (!useAllowlist && !selectedUniversity) {
      setStatus('error')
      setErrorMessage('Please select your university.')
      return
    }

    const supabase = createClient()

    // Server-side check via is_email_allowed RPC: covers both .edu
    // matching and the admin_allowlist bypass.
    const { data: allowed, error: allowErr } = await supabase.rpc(
      'is_email_allowed',
      { email_to_check: emailToSend }
    )
    if (allowErr || !allowed) {
      setStatus('error')
      setErrorMessage(
        useAllowlist
          ? 'This email is not allowed. Use a .edu address or ask an admin to allowlist you.'
          : `Please use your @${selectedUniversity} email address.`
      )
      return
    }

    const { error } = await supabase.auth.signInWithOtp({ email: emailToSend })

    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
      return
    }

    setStatus('idle')
    setStep('code')
  }

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code) return
    setStatus('loading')
    setErrorMessage('')

    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({
      email: emailToSend,
      token: code,
      type: 'email',
    })

    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
      return
    }

    setStatus('idle')
    setStep('profile')
  }

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    setErrorMessage('')

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      setStatus('error')
      setErrorMessage('Session expired — please start over.')
      return
    }

    // handle_new_user() trigger already set email_domain + display_alias
    // when the auth.users row was created. We just update the profile
    // fields the trigger doesn't know about.
    const { error } = await supabase
      .from('profiles')
      .update({
        major,
        year_in_school: year,
        hobbies,
        activities,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)

    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
      return
    }

    router.push('/dashboard')
  }

  const toggleSelection = (item: string, list: string[], setList: (val: string[]) => void) => {
    setList(list.includes(item) ? list.filter((i) => i !== item) : [...list, item])
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 relative overflow-hidden py-12">
      <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-900/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-900/20 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-2xl bg-gray-900/50 backdrop-blur-xl p-8 rounded-2xl border border-gray-800 shadow-2xl relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center justify-center gap-2">
            Join Orbit <span role="img" aria-label="sparkles">✨</span>
          </h1>
          <p className="text-gray-400">
            {step === 'email' && 'Select your campus to begin'}
            {step === 'code' && `Enter the code we sent to ${emailToSend}`}
            {step === 'profile' && 'Complete your profile to find your matches'}
          </p>
        </div>

        {step === 'email' && (
          <form onSubmit={handleSendCode} className="space-y-6 max-w-md mx-auto">
            {!useAllowlist ? (
              <>
                <div>
                  <label htmlFor="university" className="block text-sm font-medium text-gray-300 mb-2">
                    Select University
                  </label>
                  <select
                    id="university"
                    value={selectedUniversity}
                    onChange={(e) => setSelectedUniversity(e.target.value)}
                    required
                    className="w-full px-4 py-3 bg-gray-950/50 border border-gray-700 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-white outline-none appearance-none"
                  >
                    <option value="" disabled className="bg-gray-900">Choose your campus...</option>
                    <option value="iastate.edu" className="bg-gray-900">Iowa State University</option>
                    <option value="uiowa.edu" className="bg-gray-900">University of Iowa</option>
                    <option value="uni.edu" className="bg-gray-900">University of Northern Iowa</option>
                  </select>
                </div>

                {selectedUniversity && (
                  <div>
                    <label htmlFor="emailPrefix" className="block text-sm font-medium text-gray-300 mb-2">
                      University Email
                    </label>
                    <div className="flex items-center">
                      <input
                        id="emailPrefix"
                        type="text"
                        value={emailPrefix}
                        onChange={(e) => setEmailPrefix(e.target.value)}
                        placeholder="netid"
                        required
                        autoComplete="username"
                        className="w-full px-4 py-3 bg-gray-950/50 border border-gray-700 rounded-l-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-white placeholder-gray-500 outline-none"
                      />
                      <div className="px-4 py-3 bg-gray-800 border border-l-0 border-gray-700 rounded-r-xl text-gray-400">
                        @{selectedUniversity}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div>
                <label htmlFor="rawEmail" className="block text-sm font-medium text-gray-300 mb-2">
                  Email address
                </label>
                <input
                  id="rawEmail"
                  type="email"
                  value={rawEmail}
                  onChange={(e) => setRawEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  className="w-full px-4 py-3 bg-gray-950/50 border border-gray-700 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-white placeholder-gray-500 outline-none"
                />
              </div>
            )}

            {status === 'error' && (
              <div className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'loading' ? 'Sending…' : 'Send Code'}
            </button>

            <button
              type="button"
              onClick={() => {
                setUseAllowlist(!useAllowlist)
                setStatus('idle')
                setErrorMessage('')
              }}
              className="w-full text-xs text-gray-500 hover:text-gray-400 transition-colors"
            >
              {useAllowlist ? 'Use university email instead' : 'Admin / test account?'}
            </button>

            <div className="mt-6 text-center">
              <p className="text-gray-400 text-sm">
                Already have an account?{' '}
                <Link href="/login" className="text-purple-400 hover:text-purple-300 font-medium transition-colors">
                  Log in here
                </Link>
              </p>
            </div>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifyCode} className="space-y-6 max-w-md mx-auto">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-300 mb-2">
                Verification Code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                maxLength={8}
                required
                className="w-full px-4 py-4 bg-gray-950/50 border border-gray-700 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-white placeholder-gray-500 outline-none text-center text-2xl tracking-[0.5em] font-mono"
              />
            </div>

            {status === 'error' && (
              <div className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'loading' || code.length < 6}
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === 'loading' ? 'Verifying…' : 'Verify & Continue'}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep('email')
                setCode('')
                setStatus('idle')
                setErrorMessage('')
              }}
              className="w-full text-sm text-purple-400 hover:text-purple-300 font-medium transition-colors"
            >
              Back to email
            </button>
          </form>
        )}

        {step === 'profile' && (
          <form onSubmit={handleProfileSubmit} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="major" className="block text-sm font-medium text-gray-300 mb-2">Major</label>
                <input
                  id="major"
                  type="text"
                  value={major}
                  onChange={(e) => setMajor(e.target.value)}
                  placeholder="e.g. Computer Science"
                  required
                  className="w-full px-4 py-3 bg-gray-950/50 border border-gray-700 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-white placeholder-gray-500 outline-none"
                />
              </div>

              <div>
                <label htmlFor="year" className="block text-sm font-medium text-gray-300 mb-2">Year in School</label>
                <select
                  id="year"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-gray-950/50 border border-gray-700 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-white outline-none appearance-none"
                >
                  <option value="" disabled className="bg-gray-900">Select your year</option>
                  {YEARS.map((y) => (
                    <option key={y} value={y} className="bg-gray-900">{y}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">Hobbies (Select all that apply)</label>
              <div className="flex flex-wrap gap-2">
                {HOBBIES.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => toggleSelection(h, hobbies, setHobbies)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      hobbies.includes(h)
                        ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25 border border-purple-500'
                        : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">Activities (Select all that apply)</label>
              <div className="flex flex-wrap gap-2">
                {ACTIVITIES.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => toggleSelection(a, activities, setActivities)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      activities.includes(a)
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 border border-indigo-500'
                        : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>

            {status === 'error' && (
              <div className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full py-4 px-6 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
            >
              {status === 'loading' ? 'Saving Profile…' : 'Complete Profile'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
