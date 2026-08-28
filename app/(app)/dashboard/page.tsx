import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return null

  // Fetch active match for this user
  const { data: match } = await supabase
    .from('matches')
    .select('*')
    .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
    .eq('status', 'active')
    .single()

  // Fetch partner profile if matched
  if (match) {
    const partnerId = match.user1_id === user.id ? match.user2_id : match.user1_id
    const { data: partnerProfile } = await supabase
      .from('profiles')
      .select('display_alias')
      .eq('id', partnerId)
      .single()

    const partnerAlias = partnerProfile?.display_alias || 'Mystery Connection'

    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Card className="w-full max-w-md bg-gray-900 border-gray-800 text-center shadow-xl shadow-purple-900/10">
          <CardHeader>
            <CardTitle className="text-2xl font-bold text-white mb-2">You&apos;re Matched!</CardTitle>
            <CardDescription className="text-gray-400">
              Your partner for tonight is <span className="font-bold text-purple-400">{partnerAlias}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-gray-800/50 p-6 rounded-xl border border-gray-700">
              <p className="text-sm text-gray-400 mb-2 uppercase tracking-wider font-semibold">Icebreaker</p>
              <p className="text-lg text-gray-200 italic">&quot;{match.icebreaker || 'What is your favorite memory from this campus?'}&quot;</p>
            </div>
            <div className="inline-flex items-center space-x-2 bg-gray-950 px-4 py-2 rounded-full border border-gray-800">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500"></span>
              </span>
              <span className="text-sm font-medium text-gray-300">Connection expires at midnight</span>
            </div>
          </CardContent>
          <CardFooter className="pb-8">
            <Link href={`/chat/${match.id}`} className="block w-full">
              <Button className="w-full bg-gradient-to-r from-purple-500 to-cyan-500 hover:from-purple-600 hover:to-cyan-600 text-white border-0 py-6 text-lg rounded-xl shadow-lg hover:shadow-purple-500/25 transition-all">
                Start Chatting
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    )
  }

  // Waiting State (default when no active match)
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-md bg-gray-900 border-gray-800 text-center relative overflow-hidden group">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-purple-900/20 via-transparent to-transparent opacity-50 group-hover:opacity-100 transition-opacity duration-1000"></div>
        <CardHeader className="pt-10 pb-2 relative z-10">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="w-16 h-16 bg-gray-800 rounded-full border border-gray-700 flex items-center justify-center animate-[pulse_3s_ease-in-out_infinite]">
                <div className="w-8 h-8 bg-purple-500/50 rounded-full blur-md absolute"></div>
                <span className="text-2xl relative z-10">✨</span>
              </div>
            </div>
          </div>
          <CardTitle className="text-2xl font-bold text-white mb-2">The cosmos are aligning...</CardTitle>
        </CardHeader>
        <CardContent className="pb-10 relative z-10">
          <p className="text-gray-400 mb-6">
            Matches are generated at midnight! Check back after the reset.
          </p>
          <div className="bg-gray-950 p-4 rounded-lg border border-gray-800 inline-block">
            <p className="text-sm text-gray-500 mb-1">Time until reset</p>
            <p className="text-xl font-mono text-cyan-400 font-bold">Midnight</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
