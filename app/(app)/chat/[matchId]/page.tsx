import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'

export default async function ChatPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: match, error } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .single()

  if (error || !match) {
    redirect('/dashboard')
  }

  const isParticipant = match.user1_id === user.id || match.user2_id === user.id
  if (!isParticipant) {
    redirect('/dashboard')
  }

  if (match.status !== 'active') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto">
        <div className="text-4xl mb-6">⏳</div>
        <h1 className="text-2xl font-bold text-white mb-4">Connection Expired</h1>
        <p className="text-gray-400 mb-8">
          This connection has expired or been closed. Connections only last until midnight.
        </p>
        <Link href="/dashboard">
          <Button variant="secondary">Return to Dashboard</Button>
        </Link>
      </div>
    )
  }

  // Fetch partner alias
  const partnerId = match.user1_id === user.id ? match.user2_id : match.user1_id
  const { data: partnerProfile } = await supabase
    .from('profiles')
    .select('display_alias')
    .eq('id', partnerId)
    .single()

  const partnerAlias = partnerProfile?.display_alias || 'Mystery Connection'

  // Fetch initial messages
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true })
    .limit(50)

  return (
    <div className="h-[calc(100vh-8rem)] bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-2xl flex flex-col">
      <div className="bg-gray-950 p-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            {partnerAlias}
          </h2>
        </div>
      </div>
      
      <ChatWindow
        matchId={matchId}
        currentUserId={user.id}
        partnerAlias={partnerAlias}
        icebreaker={match.icebreaker ?? undefined}
        initialMessages={messages || []}
        expiresAt={match.expires_at ?? new Date().toISOString()}
      />
    </div>
  )
}
