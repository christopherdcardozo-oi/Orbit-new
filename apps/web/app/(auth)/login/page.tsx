'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

// Two-step OTP login. Matches the mobile flow: enter email → we send a
// numeric code → user types it back → we verify it in-place. No magic
// link, no /callback round-trip, no deep-linking headaches.

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [selectedUniversity, setSelectedUniversity] = useState('')
  const [emailPrefix, setEmailPrefix] = useState('')
  const [rawEmail, setRawEmail] = useState('')     // used for allowlisted non-.edu logins
  const [useAllowlist, setUseAllowlist] = useState(false)
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const emailToSend = useAllowlist
    ? rawEmail.toLowerCase().trim()
    : `${emailPrefix}@${selectedUniversity}`.toLowerCase().trim()

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    setErrorMessage('')

    if (!useAllowlist && !selectedUniversity) {
      setStatus('error')
      setErrorMessage('Please select your campus.')
      return
    }

    const supabase = createClient()

    // Server-side check via is_email_allowed RPC. Handles both .edu
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

    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-900/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-900/20 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md bg-gray-900/50 backdrop-blur-xl p-8 rounded-2xl border border-gray-800 shadow-2xl relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center justify-center gap-2">
            Welcome Back <span role="img" aria-label="rocket">🚀</span>
          </h1>
          <p className="text-gray-400">
            {step === 'email'
              ? 'Select your campus and enter your netid'
              : `Enter the code we sent to ${emailToSend}`}
          </p>
        </div>

        {step === 'email' ? (
          <form onSubmit={handleSendCode} className="space-y-6">
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
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium rounded-xl transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 active:translate-y-0"
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
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-6">
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
              {status === 'loading' ? 'Verifying…' : 'Verify & Sign In'}
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

        <div className="mt-6 text-center">
          <p className="text-gray-400 text-sm">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-purple-400 hover:text-purple-300 font-medium transition-colors">
              Sign up here
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
