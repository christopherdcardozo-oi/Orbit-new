import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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

export default function ChatTabScreen() {
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const [displayAlias, setDisplayAlias] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [secondsLeft, setSecondsLeft] = useState(() => getSecondsUntilMidnight(DEFAULT_TIMEZONE));

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

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
    };
    fetchProfile();
  }, []);

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
});
