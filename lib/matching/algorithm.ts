import { createAdminClient } from '@/lib/supabase/admin';
import { generateIcebreaker } from './icebreaker';
import type { Profile } from '@/types/database';

export function fisherYatesShuffle<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

export async function runMatchmaking() {
  const supabase = createAdminClient();
  const results = { matched: 0, oddManOut: [] as string[], errors: [] as string[] };

  // Query all active profiles
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('is_active', true);

  if (profileError || !profiles) {
    results.errors.push(`Failed to fetch profiles: ${profileError?.message || 'Unknown error'}`);
    return results;
  }

  // Group by email_domain
  const domains = new Set(profiles.map((p: Profile) => p.email_domain));

  const allNewMatches: Array<{
    user1_id: string;
    user2_id: string;
    status: 'active';
    icebreaker: string;
    expires_at: string;
  }> = [];
  const allNewHistory: Array<{ user1_id: string; user2_id: string }> = [];

  for (const domain of domains) {
    const domainProfiles = profiles.filter((p: Profile) => p.email_domain === domain);
    
    // Pull 30-day match_history
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { data: history, error: historyError } = await supabase
      .from('match_history')
      .select('user1_id, user2_id')
      .gte('matched_at', thirtyDaysAgo.toISOString().split('T')[0]);

    if (historyError) {
      results.errors.push(`Failed to fetch history for ${domain}: ${historyError.message}`);
      continue;
    }

    const historySet = new Set<string>();
    if (history) {
      for (const h of history) {
        const key = [h.user1_id, h.user2_id].sort().join('_');
        historySet.add(key);
      }
    }

    // Cooldown Decay — query for pairs >14 days old
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    
    const { data: oldHistory } = await supabase
      .from('match_history')
      .select('user1_id, user2_id')
      .lte('matched_at', fourteenDaysAgo.toISOString().split('T')[0]);
      
    const allowedHistorySet = new Set<string>();
    if (oldHistory) {
      for (const h of oldHistory) {
        const key = [h.user1_id, h.user2_id].sort().join('_');
        allowedHistorySet.add(key);
      }
    }

    // Fisher-Yates shuffle
    const shuffled = fisherYatesShuffle(domainProfiles);
    const matched = new Set<string>();

    // Greedy pair matching
    for (let i = 0; i < shuffled.length; i++) {
      const userA = shuffled[i];
      if (matched.has(userA.id)) continue;

      let foundMatch: Profile | null = null;

      for (let j = i + 1; j < shuffled.length; j++) {
        const userB = shuffled[j];
        if (matched.has(userB.id)) continue;

        const key = [userA.id, userB.id].sort().join('_');
        
        if (!historySet.has(key) || allowedHistorySet.has(key)) {
          foundMatch = userB;
          break;
        }
      }

      if (foundMatch) {
        matched.add(userA.id);
        matched.add(foundMatch.id);
        
        // Generate icebreaker for each pair
        const icebreaker = generateIcebreaker(userA, foundMatch);
        
        const expiresAt = new Date();
        expiresAt.setHours(24, 0, 0, 0); // Next midnight
        
        const [user1_id, user2_id] = [userA.id, foundMatch.id].sort();
        
        allNewMatches.push({
          user1_id,
          user2_id,
          status: 'active',
          icebreaker,
          expires_at: expiresAt.toISOString(),
        });

        allNewHistory.push({
          user1_id,
          user2_id,
        });
        
        results.matched++;
      } else {
        results.oddManOut.push(userA.id);
      }
    }
  }

  // Batch insert into tables
  if (allNewMatches.length > 0) {
    const { error: matchInsertError } = await supabase
      .from('matches')
      .insert(allNewMatches);
      
    if (matchInsertError) {
      results.errors.push(`Failed to insert matches: ${matchInsertError.message}`);
    } else {
      const { error: historyInsertError } = await supabase
        .from('match_history')
        .insert(allNewHistory);
        
      if (historyInsertError) {
        results.errors.push(`Failed to insert history: ${historyInsertError.message}`);
      }
    }
  }

  return results;
}
