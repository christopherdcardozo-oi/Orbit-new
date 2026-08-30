'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function LoginPage() {
  const [selectedUniversity, setSelectedUniversity] = useState('')
  const [emailPrefix, setEmailPrefix] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    setErrorMessage('')

    if (!selectedUniversity) {
      setStatus('error')
      setErrorMessage('Please select your university.')
      return
    }

    const fullEmail = `${emailPrefix}@${selectedUniversity}`

    if (!fullEmail.endsWith('.edu')) {
      setStatus('error')
      setErrorMessage('Please use a valid .edu email address.')
      return
    }

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: fullEmail,
      options: {
        emailRedirectTo: `${window.location.origin}/callback`,
      },
    })

    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
    } else {
      setStatus('success')
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Cosmic background effects */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-900/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-900/20 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="w-full max-w-md bg-gray-900/50 backdrop-blur-xl p-8 rounded-2xl border border-gray-800 shadow-2xl relative z-10">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center justify-center gap-2">
            Welcome Back <span role="img" aria-label="rocket">🚀</span>
          </h1>
          <p className="text-gray-400">Select your campus and enter your netid</p>
        </div>

        {status === 'success' ? (
          <div className="text-center p-6 bg-purple-500/10 border border-purple-500/20 rounded-xl">
            <div className="text-4xl mb-4">✨</div>
            <h3 className="text-xl font-semibold text-white mb-2">Check your inbox!</h3>
            <p className="text-gray-300">We&apos;ve sent a magic link to {emailPrefix}@{selectedUniversity}</p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-6">
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
                    className="w-full px-4 py-3 bg-gray-950/50 border border-gray-700 rounded-l-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-white placeholder-gray-500 outline-none"
                  />
                  <div className="px-4 py-3 bg-gray-800 border border-l-0 border-gray-700 rounded-r-xl text-gray-400">
                    @{selectedUniversity}
                  </div>
                </div>
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
              {status === 'loading' ? 'Sending...' : 'Send Magic Link'}
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
