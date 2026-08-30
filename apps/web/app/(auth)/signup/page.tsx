'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const HOBBIES = ['Gaming', 'Hiking', 'Reading', 'Music', 'Cooking', 'Sports', 'Art', 'Photography', 'Travel', 'Coding', 'Movies', 'Fitness']
const ACTIVITIES = ['Greek Life', 'Student Government', 'Intramurals', 'Research', 'Volunteering', 'Club Sports', 'Band/Orchestra', 'Theater', 'Debate', 'Esports']
const YEARS = ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate']

export default function SignupPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState('')

  // Profile fields
  const [major, setMajor] = useState('')
  const [year, setYear] = useState('')
  const [hobbies, setHobbies] = useState<string[]>([])
  const [activities, setActivities] = useState<string[]>([])

  useEffect(() => {
    const checkUser = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setStep(2)
      }
    }
    checkUser()
  }, [])

  const [selectedUniversity, setSelectedUniversity] = useState('')
  const [emailPrefix, setEmailPrefix] = useState('')

  const handleSignup = async (e: React.FormEvent) => {
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
        emailRedirectTo: `${window.location.origin}/callback?next=/signup`,
      },
    })

    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
    } else {
      setStatus('success')
    }
  }

  // Profile handling logic remains the same...
  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setStatus('loading')
    setErrorMessage('')

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      setStatus('error')
      setErrorMessage('Not authenticated')
      return
    }

    const email = user.email || ''
    const domain = email.split('@')[1] || ''

    const { error } = await supabase
      .from('profiles')
      .upsert({
        id: user.id,
        email_domain: domain,
        display_alias: 'Anon' + Math.random().toString(36).substring(2, 10),
        major,
        year_in_school: year,
        hobbies,
        activities,
        updated_at: new Date().toISOString()
      })

    if (error) {
      setStatus('error')
      setErrorMessage(error.message)
    } else {
      router.push('/dashboard')
    }
  }

  const toggleSelection = (item: string, list: string[], setList: (val: string[]) => void) => {
    if (list.includes(item)) {
      setList(list.filter(i => i !== item))
    } else {
      setList([...list, item])
    }
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
            {step === 1 ? 'Select your campus to begin' : 'Complete your profile to find your matches'}
          </p>
        </div>

        {step === 1 ? (
          status === 'success' ? (
            <div className="text-center p-6 bg-purple-500/10 border border-purple-500/20 rounded-xl max-w-md mx-auto">
              <div className="text-4xl mb-4">🚀</div>
              <h3 className="text-xl font-semibold text-white mb-2">Check your inbox!</h3>
              <p className="text-gray-300">We&apos;ve sent a magic link to {emailPrefix}@{selectedUniversity}</p>
            </div>
          ) : (
            <form onSubmit={handleSignup} className="space-y-6 max-w-md mx-auto">
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
                {status === 'loading' ? 'Sending...' : 'Get Magic Link'}
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
          )
        ) : (
          <form onSubmit={handleProfileSubmit} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="major" className="block text-sm font-medium text-gray-300 mb-2">
                  Major
                </label>
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
                <label htmlFor="year" className="block text-sm font-medium text-gray-300 mb-2">
                  Year in School
                </label>
                <select
                  id="year"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-gray-950/50 border border-gray-700 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-white outline-none appearance-none"
                >
                  <option value="" disabled className="bg-gray-900">Select your year</option>
                  {YEARS.map(y => (
                    <option key={y} value={y} className="bg-gray-900">{y}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">
                Hobbies (Select all that apply)
              </label>
              <div className="flex flex-wrap gap-2">
                {HOBBIES.map(hobby => (
                  <button
                    key={hobby}
                    type="button"
                    onClick={() => toggleSelection(hobby, hobbies, setHobbies)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      hobbies.includes(hobby)
                        ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25 border border-purple-500'
                        : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    {hobby}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">
                Activities (Select all that apply)
              </label>
              <div className="flex flex-wrap gap-2">
                {ACTIVITIES.map(activity => (
                  <button
                    key={activity}
                    type="button"
                    onClick={() => toggleSelection(activity, activities, setActivities)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      activities.includes(activity)
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 border border-indigo-500'
                        : 'bg-gray-800 text-gray-300 border border-gray-700 hover:border-gray-600'
                    }`}
                  >
                    {activity}
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
              className="w-full py-4 px-6 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 active:translate-y-0 text-lg"
            >
              {status === 'loading' ? 'Saving Profile...' : 'Complete Profile'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
