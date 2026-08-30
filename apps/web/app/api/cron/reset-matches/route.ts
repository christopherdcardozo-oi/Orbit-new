import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runMatchmaking } from '@/lib/matching/algorithm'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  
  // Verify cron secret
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const supabaseAdmin = createAdminClient()

    // 1. Expire active matches
    const { error: expireError } = await supabaseAdmin.rpc('expire_active_matches')
    
    if (expireError) {
      console.error('Error expiring matches:', expireError)
      return NextResponse.json({ error: 'Failed to expire matches' }, { status: 500 })
    }

    // 2. Generate new matches
    const results = await runMatchmaking()

    return NextResponse.json({ 
      success: true, 
      results,
      message: 'Daily match reset completed successfully'
    })
  } catch (error) {
    console.error('Cron job error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
