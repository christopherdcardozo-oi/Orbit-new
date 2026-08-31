import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Platform, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import CosmicBackground from '../../components/CosmicBackground';
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
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [secondsLeft, setSecondsLeft] = useState(() => getSecondsUntilMidnight(DEFAULT_TIMEZONE));
  const [userId, setUserId] = useState<string | null>(null);
  const [activeMatch, setActiveMatch] = useState<ActiveMatch | null>(null);
  const [loadingMatch, setLoadingMatch] = useState(true);

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
      partnerAvatar: partner?.avatar ?? 'planet',
    });
    setLoadingMatch(false);
  }, []);

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

      if (profile?.email_domain) {
        const { data: uni } = await supabase
          .from('university_config')
          .select('timezone')
          .eq('email_domain', profile.email_domain)
          .single();
        if (uni?.timezone) setTimezone(uni.timezone);
      }

      await fetchActiveMatch(user.id);
    };
    fetchProfile();
  }, [fetchActiveMatch]);

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
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchActiveMatch]);

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
    return (
      <View style={styles.container}>
        <CosmicBackground />
        <ActivityIndicator size="large" color="#a855f7" />
      </View>
    );
  }

  if (activeMatch) {
    return (
      <View style={styles.container}>
        <CosmicBackground />
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
            onPress={() => router.push(`/chat/${activeMatch.id}`)}
          >
            <Ionicons name="chatbubbles" size={20} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.chatButtonText}>Start Chatting</Text>
          </TouchableOpacity>

          <View style={styles.matchedCountdownBox}>
            <Text style={styles.countdownLabel}>Connection expires in</Text>
            <Text style={styles.countdown}>{formatCountdown(secondsLeft)}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CosmicBackground />
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
        <View style={styles.countdownBox}>
          <Text style={styles.countdownLabel}>Next reset in</Text>
          <Text style={styles.countdown}>{formatCountdown(secondsLeft)}</Text>
        </View>
      </View>
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
    fontSize: 28,
    fontWeight: '900',
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
});
