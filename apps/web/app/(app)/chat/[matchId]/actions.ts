'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function unmatchAction(matchId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) throw new Error('Not authenticated')

  const { data: match } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .single()

  if (!match) throw new Error('Match not found')

  const isParticipant = match.user1_id === user.id || match.user2_id === user.id
  if (!isParticipant) throw new Error('Not authorized')

  await supabase
    .from('matches')
    .update({ status: 'unmatched' as const })
    .eq('id', matchId)

  redirect('/dashboard')
}

export async function reportUserAction(matchId: string, reason: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) throw new Error('Not authenticated')

  const { data: match } = await supabase
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .single()

  if (!match) throw new Error('Match not found')

  const isParticipant = match.user1_id === user.id || match.user2_id === user.id
  if (!isParticipant) throw new Error('Not authorized')

  const reportedUserId = match.user1_id === user.id ? match.user2_id : match.user1_id

  // Insert report
  await supabase
    .from('reports')
    .insert({
      reporter_id: user.id,
      reported_user_id: reportedUserId,
      match_id: matchId,
      reason: reason,
    })

  // Update match status
  await supabase
    .from('matches')
    .update({ status: 'flagged' as const })
    .eq('id', matchId)

  redirect('/dashboard')
}
