import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Platform, TouchableOpacity, ActivityIndicator, ScrollView, Linking, Alert, Modal } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import CosmicBackground from '../../components/CosmicBackground';
import Skeleton from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';

// Matches reset at local midnight for the user's campus (see
// expire_active_matches / the reset-matches edge function, both scheduled
// off midnight in each university's configured timezone — see
// supabase/migrations/005_seed_universities.sql). Computed via Intl
// instead of a date library: ask what the wall-clock time currently reads
// in that timezone, then how many seconds remain until it rolls to 00:00:00.
function getSecondsUntilMidnight(timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? '0');
  // hour12: false still reports the 00:00:00 instant as "24", not "00" —
  // normalize so the math below (seconds elapsed since local midnight)
  // treats that instant as 0, not a bogus 24-hour offset.
  const hour = get('hour') % 24;
  const minute = get('minute');
  const second = get('second');

  const elapsed = hour * 3600 + minute * 60 + second;
  return 86400 - elapsed;
}

function formatCountdown(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const DEFAULT_TIMEZONE = 'America/Chicago';

type ActiveMatch = {
  id: string;
  icebreaker: string | null;
  partnerAlias: string;
  partnerAvatar: string;
};

export default function ChatTabScreen() {
  const router = useRouter();
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const [displayAlias, setDisplayAlias] = useState<string | null>(null);
  // Stored so the "Invite a Friend" button can pre-fill the campus in
  // the signup URL, matching the profile-screen version's behavior.
  const [campusDomain, setCampusDomain] = useState<string | null>(null);
  // Per-match safety disclaimer state (migration 032). Every new match
  // is a new stranger, so the disclaimer re-appears once per match —
  // not once per lifetime. safetyAckedMatchIds tracks acks fetched
  // from match_safety_acks so Start Chatting can skip the modal for
  // matches the user has already acknowledged.
  const [safetyAckedMatchIds, setSafetyAckedMatchIds] = useState<Set<string>>(new Set());
  const [safetyModalOpen, setSafetyModalOpen] = useState(false);
  const [safetyAcking, setSafetyAcking] = useState(false);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [secondsLeft, setSecondsLeft] = useState(() => getSecondsUntilMidnight(DEFAULT_TIMEZONE));
  const [userId, setUserId] = useState<string | null>(null);
  const [activeMatch, setActiveMatch] = useState<ActiveMatch | null>(null);
  const [loadingMatch, setLoadingMatch] = useState(true);

  // Up to 2 most-recent expired matches the user hasn't rated yet — the
  // "no active match" screen prompts them to rate each individually.
  // Cleared per-match as they tap up/down/skip; realtime match changes
  // also trigger a re-fetch so newly-expired matches show up right away.
  const [rateableMatches, setRateableMatches] = useState<Array<{ id: string; partnerAlias: string }>>([]);
  // Community-pulse stat: campus's all-time signup count (migration
  // 044 → 050's total_users), the number that visibly grows over time.
  // Yesterday's active-users/messages breakdown (047) got pulled from
  // display per request — just the growing total now. Reassurance for
  // the "is anyone actually using this" question that hits hardest on
  // a small, single-campus pool — not shown pre-login; see docs
  // discussion for why a raw number is a better fit here than on the
  // landing page at Orbit's current scale.
  const [dailyStats, setDailyStats] = useState<{ totalUsers: number } | null>(null);
  // Match IDs currently showing the "Thanks for rating…" confirmation
  // before silently unmounting. Rating is fired immediately; the card
  // just sticks around a beat so the user sees they were heard.
  const [thankingMatchIds, setThankingMatchIds] = useState<Set<string>>(new Set());

  const fetchActiveMatch = useCallback(async (uid: string) => {
    const { data: match } = await supabase
      .from('matches')
      .select('id, icebreaker, user1_id, user2_id')
      .or(`user1_id.eq.${uid},user2_id.eq.${uid}`)
      .eq('status', 'active')
      .maybeSingle();

    if (!match) {
      setActiveMatch(null);
      setLoadingMatch(false);
      return;
    }

    const partnerId = match.user1_id === uid ? match.user2_id : match.user1_id;
    const { data: partner } = await supabase
      .from('profiles')
      .select('display_alias, avatar')
      .eq('id', partnerId)
      .single();

    setActiveMatch({
      id: match.id,
      icebreaker: match.icebreaker,
      partnerAlias: partner?.display_alias ?? 'Mystery Connection',
      partnerAvatar: partner?.avatar ?? 'alien',
    });
    setLoadingMatch(false);
  }, []);

  // Look for up to 2 matches that expired in the last 48h and haven't
  // been rated by this user yet. 2 is intentional — enough to catch a
  // "you had two matches back-to-back" case, not so many that the
  // screen becomes a rating survey. Capped at 48h so we don't nag
  // about a match from a week ago.
  const fetchRateableMatches = useCallback(async (uid: string) => {
    const twoDaysAgo = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: expired } = await supabase
      .from('matches')
      .select('id, user1_id, user2_id, expires_at')
      .or(`user1_id.eq.${uid},user2_id.eq.${uid}`)
      .neq('status', 'active')
      .gte('expires_at', twoDaysAgo)
      .order('expires_at', { ascending: false })
      .limit(10);
    if (!expired || expired.length === 0) { setRateableMatches([]); return; }

    const ids = expired.map((m) => m.id);
    const { data: rated } = await supabase
      .from('match_ratings')
      .select('match_id')
      .in('match_id', ids);
    const ratedIds = new Set((rated ?? []).map((r) => r.match_id));

    const unrated = expired.filter((m) => !ratedIds.has(m.id)).slice(0, 2);
    if (unrated.length === 0) { setRateableMatches([]); return; }

    const partnerIds = unrated.map((m) => (m.user1_id === uid ? m.user2_id : m.user1_id));
    const { data: partners } = await supabase
      .from('profiles')
      .select('id, display_alias')
      .in('id', partnerIds);
    const nameById = new Map((partners ?? []).map((p) => [p.id, p.display_alias || 'Mystery Connection']));

    setRateableMatches(unrated.map((m) => ({
      id: m.id,
      partnerAlias: nameById.get(m.user1_id === uid ? m.user2_id : m.user1_id) || 'Mystery Connection',
    })));
  }, []);

  // Three real tiers now — 'neutral' ("Meh") is an actual recorded
  // rating, not a dismiss-without-rating action like the old "Skip" was.
  // Mirror of the profile-screen invite. Kept in sync with the
  // handleInviteFriend implementation in apps/mobile/app/(app)/profile.tsx —
  // if you change one, change the other. Shares web navigator.share
  // when available, falls back to clipboard on desktop web, or mailto
  // on native.
  const acceptSafetyDisclaimer = async () => {
    if (!userId || !activeMatch) return;
    setSafetyAcking(true);
    const matchId = activeMatch.id;
    const { error } = await supabase
      .from('match_safety_acks')
      .insert({ match_id: matchId, user_id: userId });
    setSafetyAcking(false);
    // Duplicate-insert (code 23505) means they already acked from
    // another device — treat as success. Other errors we just log
    // and let the user proceed; worst case they see the modal again.
    if (error && error.code !== '23505') {
      console.warn('match_safety_ack insert failed:', error);
    }
    setSafetyAckedMatchIds((prev) => new Set(prev).add(matchId));
    setSafetyModalOpen(false);
    router.push(`/chat/${matchId}`);
  };

  const handleInviteFriend = async () => {
    const base = 'https://orbit.orghubs.com';
    const url = campusDomain
      ? `${base}/signup?campus=${encodeURIComponent(campusDomain)}`
      : `${base}/signup`;
    const text = `Try Orbit — anonymous campus-only match once a day, reset at midnight. ${url}`;
    if (Platform.OS === 'web' && (navigator as any).share) {
      try { await (navigator as any).share({ title: 'Orbit', text, url }); return; } catch { /* cancelled */ }
    }
    if (Platform.OS === 'web' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        Alert.alert('Link copied', 'Share it with a friend from your campus.');
        return;
      } catch { /* fall through */ }
    }
    Linking.openURL(`mailto:?subject=Try Orbit&body=${encodeURIComponent(text)}`);
  };

  const submitRating = async (matchId: string, rating: 'up' | 'neutral' | 'down') => {
    if (!userId) return;
    // Flip the card to its "thanks" state immediately, fire the insert
    // in the background, then quietly unmount after a beat so the
    // feedback feels acknowledged instead of instantly disappearing.
    setThankingMatchIds((prev) => new Set(prev).add(matchId));
    supabase.from('match_ratings').insert({ match_id: matchId, rater_id: userId, rating }).then();
    setTimeout(() => {
      setRateableMatches((prev) => prev.filter((m) => m.id !== matchId));
      setThankingMatchIds((prev) => {
        const next = new Set(prev);
        next.delete(matchId);
        return next;
      });
    }, 1400);
  };

  // One shared renderer for the rating card so the matched view and the
  // unmatched view stay in lockstep — only place the card visuals or
  // behavior live now. extraStyle lets each callsite tweak margin only.
  const renderRatingCard = (m: { id: string; partnerAlias: string }, extraStyle?: object) => (
    <View key={m.id} style={[styles.ratingBox, extraStyle]}>
      {thankingMatchIds.has(m.id) ? (
        <Text style={styles.ratingThanks}>Thanks for rating {m.partnerAlias} ✨</Text>
      ) : (
        <>
          <Text style={styles.ratingQuestion}>
            How was your connection with {m.partnerAlias}?
          </Text>
          <View style={styles.ratingButtons}>
            <TouchableOpacity style={styles.ratingBtn} onPress={() => submitRating(m.id, 'up')}>
              <Ionicons name="thumbs-up" size={22} color="#4ade80" />
              <Text style={[styles.ratingBtnText, { color: '#4ade80' }]}>Cool</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ratingBtn} onPress={() => submitRating(m.id, 'neutral')}>
              <Text style={styles.ratingBtnEmoji}>😐</Text>
              <Text style={[styles.ratingBtnText, { color: '#e5e7eb' }]}>Meh</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ratingBtn} onPress={() => submitRating(m.id, 'down')}>
              <Ionicons name="thumbs-down" size={22} color="#f87171" />
              <Text style={[styles.ratingBtnText, { color: '#f87171' }]}>Pass</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );

  const renderDailyStats = () => {
    if (!dailyStats) return null;
    return (
      <View style={styles.dailyStatsPill}>
        <Text style={styles.dailyStatsSubtext}>
          {dailyStats.totalUsers.toLocaleString()} users and counting
        </Text>
      </View>
    );
  };

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_alias, email_domain')
        .eq('id', user.id)
        .single();

      if (profile?.display_alias) setDisplayAlias(profile.display_alias);
      if (profile?.email_domain) setCampusDomain(profile.email_domain);

      // Load the user's existing per-match safety acks so Start
      // Chatting can skip the modal for matches already acknowledged.
      const { data: acks } = await supabase
        .from('match_safety_acks')
        .select('match_id')
        .eq('user_id', user.id);
      if (acks) setSafetyAckedMatchIds(new Set(acks.map((a) => a.match_id)));

      if (profile?.email_domain) {
        const { data: uni } = await supabase
          .from('university_config')
          .select('timezone')
          .eq('email_domain', profile.email_domain)
          .single();
        if (uni?.timezone) setTimezone(uni.timezone);

        const { data: stats } = await supabase
          .from('campus_daily_stats')
          .select('total_users')
          .eq('campus_domain', profile.email_domain)
          .order('stat_date', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (stats) {
          setDailyStats({ totalUsers: stats.total_users });
        }
      }

      await fetchActiveMatch(user.id);
      await fetchRateableMatches(user.id);
    };
    fetchProfile();
  }, [fetchActiveMatch, fetchRateableMatches]);

  // Live updates: if a match appears (top-up matched you while this
  // screen is open) or your active match gets expired, reflect it
  // without needing a manual refresh. RLS scopes what postgres_changes
  // delivers, so no extra filtering needed here for "is this my match."
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`matches-for-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => {
          fetchActiveMatch(userId);
          fetchRateableMatches(userId);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchActiveMatch, fetchRateableMatches]);

  useEffect(() => {
    setSecondsLeft(getSecondsUntilMidnight(timezone));
    const interval = setInterval(() => {
      setSecondsLeft(getSecondsUntilMidnight(timezone));
    }, 1000);
    return () => clearInterval(interval);
  }, [timezone]);

  useEffect(() => {
    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 3000,
          easing: Easing.out(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 3000,
          easing: Easing.in(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    ).start();

    // Floating planet animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: 1,
          duration: 4000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 4000,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    ).start();
  }, [pulseAnim, floatAnim]);

  const scale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.4],
  });

  const opacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 0],
  });

  const translateY = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-10, 10],
  });

  if (loadingMatch) {
    // Skeleton shape matches both possible branches (matched card OR
    // "scanning the cosmos" waiting state) closely enough that neither
    // one jumps when it takes over — a circular avatar/logo placeholder,
    // an eyebrow label, a title, and a subtitle line.
    return (
      <View style={styles.container}>
        <CosmicBackground />
        <View style={styles.matchedCard}>
          <Skeleton width={112} height={112} radius={56} style={{ marginBottom: 16 }} />
          <Skeleton width={120} height={12} radius={4} style={{ marginBottom: 12 }} />
          <Skeleton width={200} height={28} radius={6} style={{ marginBottom: 20 }} />
          <Skeleton style={{ width: '100%', height: 80, borderRadius: 16 }} />
        </View>
      </View>
    );
  }

  if (activeMatch) {
    return (
      <View style={styles.container}>
        <CosmicBackground />
        {/* ScrollView so the matched card + any rateable-match cards
            below it can scroll on shorter screens — otherwise the
            ratings sit off-screen behind the tab bar and there's no
            way to reach them. */}
        <ScrollView
          style={{ flex: 1, width: '100%' }}
          contentContainerStyle={styles.matchedScrollContent}
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.matchedCard}>
          <View style={styles.matchedAvatarRing}>
            <MaterialCommunityIcons name={activeMatch.partnerAvatar as any} size={56} color="#c084fc" />
          </View>
          <Text style={styles.matchedEyebrow}>You're matched with</Text>
          <Text style={styles.matchedAlias}>{activeMatch.partnerAlias}</Text>

          {activeMatch.icebreaker && (
            <View style={styles.icebreakerBox}>
              <Text style={styles.icebreakerLabel}>ICEBREAKER</Text>
              <Text style={styles.icebreakerText}>{activeMatch.icebreaker}</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.chatButton}
            onPress={() => {
              // Per-match check: if this specific match hasn't been
              // acknowledged yet, pop the safety disclaimer. Every
              // new match re-shows it once — every match is a new
              // stranger.
              if (!safetyAckedMatchIds.has(activeMatch.id)) {
                setSafetyModalOpen(true);
                return;
              }
              router.push(`/chat/${activeMatch.id}`);
            }}
          >
            <Ionicons name="chatbubbles" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.chatButtonText}>Start Chatting</Text>
          </TouchableOpacity>

          <View style={styles.matchedCountdownBox}>
            <Text style={styles.countdownLabel}>Connection expires in</Text>
            <Text style={styles.countdown}>{formatCountdown(secondsLeft)}</Text>
          </View>

          {renderDailyStats()}
        </View>

        {/* Invite a friend — visible on the matched view too. A user
            who's enjoying their match is the best moment to nudge
            them to bring more friends onto the campus. */}
        <TouchableOpacity
          style={[styles.lobbyInviteButton, { marginHorizontal: 20 }]}
          onPress={handleInviteFriend}
        >
          <Ionicons name="share-social" size={18} color="#c084fc" />
          <Text style={styles.lobbyInviteButtonText}>Invite a Campus Bud</Text>
        </TouchableOpacity>

        {/* Also render post-match rating prompts here, so a user with a
            fresh active match still gets asked to rate yesterday's
            expired one. */}
        {rateableMatches.map((m) => renderRatingCard(m, { marginTop: 20, marginHorizontal: 20 }))}
        </ScrollView>

        {/* Safety disclaimer — shown once, on the user's very first
            Start Chatting tap. Non-dismissible via backdrop tap so
            they have to actively acknowledge. */}
        <Modal visible={safetyModalOpen} transparent animationType="fade" onRequestClose={() => { /* no dismiss via back */ }}>
          <View style={styles.safetyBackdrop}>
            <View style={styles.safetySheet}>
              <Ionicons name="shield-checkmark" size={32} color="#c084fc" style={{ alignSelf: 'center', marginBottom: 8 }} />
              <Text style={styles.safetyTitle}>Before you say hi</Text>
              <Text style={styles.safetyBody}>
                Orbit connects you with strangers on your campus, but they're
                still strangers. Chat freely — but for your safety:
              </Text>
              <View style={styles.safetyBullets}>
                <Text style={styles.safetyBullet}>• Don't share your address, class schedule, or where you'll be at a specific time.</Text>
                <Text style={styles.safetyBullet}>• Use the <Text style={{ fontWeight: '700' }}>Share Contact</Text> button when you both want to swap Instagram/Snap/phone/email — it only reveals your info once they share theirs too.</Text>
                <Text style={styles.safetyBullet}>• If something feels off, use <Text style={{ fontWeight: '700' }}>Report and Block</Text> in the chat menu. We review every report.</Text>
                <Text style={styles.safetyBullet}>• You alone decide whether to meet in person. Meet somewhere public if you do.</Text>
              </View>
              <Text style={styles.safetyLegal}>
                By continuing, you agree that Orbit is not responsible for anything shared or arranged with your match.
              </Text>
              <TouchableOpacity
                style={[styles.safetyBtn, safetyAcking && { opacity: 0.6 }]}
                onPress={acceptSafetyDisclaimer}
                disabled={safetyAcking}
              >
                {safetyAcking ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.safetyBtnText}>I understand — start chatting</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CosmicBackground />
      {/* Same reason as the matched-card branch above — wrap in
          ScrollView so up-to-2 rating cards under the text can be
          reached on shorter screens instead of sitting off-screen. */}
      <ScrollView
        style={{ flex: 1, width: '100%' }}
        contentContainerStyle={styles.unmatchedScrollContent}
        showsVerticalScrollIndicator={false}
      >
      <View style={styles.radarContainer}>
        <Animated.View style={[styles.pulseRing, { transform: [{ scale }], opacity }]} />
        <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }], opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] }) }]} />

        <Animated.View style={[styles.radarCenter, { transform: [{ translateY }] }]}>
          <LinearGradient
            colors={['#c084fc', '#4f46e5']}
            style={styles.planetGradient}
          >
            <Ionicons name="planet" size={56} color="#ffffff" style={styles.iconGlow} />
          </LinearGradient>
        </Animated.View>
      </View>

      <View style={styles.textContainer}>
        <Text style={styles.title}>Scanning the Cosmos</Text>
        {displayAlias && (
          <Text style={styles.alias}>You're floating as {displayAlias}</Text>
        )}
        <Text style={styles.subtitle}>
          The algorithm pairs users every night at midnight. Make sure your profile is ready to enter orbit.
        </Text>
        {/* Cooldown notice: last 2 hours before reset we don't top-up
            new signups, so tell them why. Wittier than "please wait". */}
        {secondsLeft < 2 * 3600 && (
          <View style={styles.cooldownBox}>
            <Ionicons name="moon" size={18} color="#c084fc" style={{ marginRight: 8 }} />
            <Text style={styles.cooldownText}>
              The cosmos is winding down — no new pairs happen in the last 2 hours before reset.
              You're officially in the queue for the midnight batch.
            </Text>
          </View>
        )}
        <View style={styles.countdownBox}>
          <Text style={styles.countdownLabel}>Next reset in</Text>
          <Text style={styles.countdown}>{formatCountdown(secondsLeft)}</Text>
        </View>

        {renderDailyStats()}

        {/* Invite a friend — front and center on the lobby since this
            is where the "small pool, no match yet" feeling hits.
            Duplicates the profile-screen button intentionally
            (utility home + high-traffic surface). */}
        <TouchableOpacity style={styles.lobbyInviteButton} onPress={handleInviteFriend}>
          <Ionicons name="share-social" size={18} color="#c084fc" />
          <Text style={styles.lobbyInviteButtonText}>Invite a Campus Bud</Text>
        </TouchableOpacity>

        {/* Post-match rating prompts — up to 2 unrated recent matches,
            each dismissed independently as you tap Cool/Meh/Pass. */}
        {rateableMatches.map((m) => renderRatingCard(m))}
      </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#030712',
  },
  radarContainer: {
    width: 240,
    height: 240,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 60,
  },
  pulseRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
    borderColor: '#c084fc',
    backgroundColor: 'rgba(192, 132, 252, 0.1)',
  },
  radarCenter: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 30,
    elevation: 15,
  },
  planetGradient: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  iconGlow: {
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
  },
  textContainer: {
    backgroundColor: 'rgba(17, 24, 39, 0.6)',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(192, 132, 252, 0.2)',
    alignItems: 'center',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
    letterSpacing: 1,
  },
  alias: {
    fontSize: 14,
    fontWeight: '600',
    color: '#c084fc',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#d1d5db',
    textAlign: 'center',
    lineHeight: 24,
  },
  countdownBox: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(192, 132, 252, 0.2)',
    width: '100%',
    alignItems: 'center',
  },
  countdownLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  countdown: {
    fontSize: 32,
    fontWeight: '900',
    color: '#c084fc',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  matchedCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.6)',
    padding: 28,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(192, 132, 252, 0.3)',
    alignItems: 'center',
    width: '100%',
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 30,
  },
  matchedAvatarRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 2,
    borderColor: '#a855f7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  matchedEyebrow: {
    fontSize: 13,
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  matchedAlias: {
    // Sized to match the chat mini-profile modal (20). Previously 28
    // and read as shouting on the small lobby card.
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 20,
  },
  icebreakerBox: {
    backgroundColor: 'rgba(3, 7, 18, 0.5)',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    marginBottom: 20,
  },
  icebreakerLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9ca3af',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  icebreakerText: {
    fontSize: 15,
    color: '#e5e7eb',
    lineHeight: 22,
    fontStyle: 'italic',
  },
  chatButton: {
    flexDirection: 'row',
    backgroundColor: '#9333ea',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  chatButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  matchedCountdownBox: {
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(192, 132, 252, 0.2)',
    width: '100%',
    alignItems: 'center',
  },
  // Scroll containers add generous bottom padding so the last card
  // never sits behind the tab bar. justifyContent keeps the primary
  // content vertically centered on tall screens where nothing scrolls.
  matchedScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    paddingBottom: 120,
  },
  unmatchedScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 40,
    paddingBottom: 120,
  },
  cooldownBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(168, 85, 247, 0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.25)',
  },
  cooldownText: {
    flex: 1,
    color: '#e5e7eb',
    fontSize: 13,
    lineHeight: 18,
  },
  ratingBox: {
    marginTop: 24,
    padding: 16,
    backgroundColor: 'rgba(17, 24, 39, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    borderRadius: 16,
    // alignSelf:'stretch' is more predictable than width:'100%' inside a
    // parent with alignItems:'center' — some RN-web versions center the
    // width:'100%' child based on its content instead of stretching.
    alignSelf: 'stretch',
  },
  // Invite button on the lobby screen. Same visual language as the
  // profile-screen version (styles.inviteButton in profile.tsx) — we
  // keep both because the profile is the utility home and the lobby is
  // where the "small pool, wish I had more friends here" feeling hits.
  lobbyInviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(168, 85, 247, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    borderRadius: 16,
    paddingVertical: 14,
    marginTop: 20,
    alignSelf: 'stretch',
  },
  lobbyInviteButtonText: { color: '#c084fc', fontSize: 15, fontWeight: '700' },
  ratingQuestion: {
    color: '#e5e7eb',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  ratingButtons: { flexDirection: 'row', gap: 8 },
  ratingBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  ratingBtnText: { fontSize: 14, fontWeight: '600' },
  ratingBtnEmoji: { fontSize: 20, lineHeight: 22 },

  // Safety disclaimer modal
  safetyBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  safetySheet: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
  },
  safetyTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
  },
  safetyBody: {
    color: '#d1d5db',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  safetyBullets: { marginBottom: 12 },
  safetyBullet: {
    color: '#e5e7eb',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 8,
  },
  safetyLegal: {
    color: '#9ca3af',
    fontSize: 11,
    fontStyle: 'italic',
    lineHeight: 16,
    marginBottom: 16,
  },
  safetyBtn: {
    backgroundColor: '#9333ea',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  safetyBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  ratingThanks: {
    color: '#c084fc',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 8,
  },
  dailyStatsPill: {
    marginTop: 14,
    alignSelf: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(168, 85, 247, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.2)',
  },
  dailyStatsText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  dailyStatsSubtext: {
    color: '#c084fc',
    fontSize: 13,
    fontWeight: '800',
    marginTop: 2,
  },
});
