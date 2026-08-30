import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import CosmicBackground from '../../components/CosmicBackground'

export default function ChatScreen() {
  const { id } = useLocalSearchParams()
  const router = useRouter()

  const [timeLeftStr, setTimeLeftStr] = useState('')
  const flashAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date()
      // Midnight tonight
      const midnight = new Date()
      midnight.setHours(24, 0, 0, 0)
      
      const diffMs = midnight.getTime() - now.getTime()
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
      
      if (diffHours > 0) {
        setTimeLeftStr(`${diffHours} hours`)
      } else if (diffMinutes > 0) {
        setTimeLeftStr(`${diffMinutes} minutes`)
      } else {
        setTimeLeftStr('less than a minute')
      }

      return { diffHours, diffMinutes }
    }

    const { diffHours, diffMinutes } = calculateTimeLeft()

    // Setup flashing animation based on time left
    let toValue = 0.3 // default mild pulse
    let duration = 1000

    if (diffHours === 0 && diffMinutes <= 10) {
      // 10 minutes left: very bright, fast flash
      toValue = 0.9
      duration = 500
    } else if (diffHours === 0) {
      // Less than 1 hour left: medium flash
      toValue = 0.6
      duration = 800
    }

    // Initial 5 second flash for everyone
    Animated.sequence([
      Animated.timing(flashAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(flashAnim, {
        toValue: 0.1,
        duration: 4500,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      })
    ]).start(() => {
      // After initial flash, start loop if needed
      Animated.loop(
        Animated.sequence([
          Animated.timing(flashAnim, {
            toValue: toValue,
            duration: duration,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(flashAnim, {
            toValue: 0.1,
            duration: duration,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start()
    })

    const interval = setInterval(() => {
      calculateTimeLeft()
    }, 60000)

    return () => clearInterval(interval)
  }, [])

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <CosmicBackground />
      
      {/* Animated Flash Overlay */}
      <Animated.View 
        style={[
          StyleSheet.absoluteFill, 
          { 
            backgroundColor: 'red',
            opacity: flashAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 0.25] // Max 25% opacity red flash on screen
            }),
            pointerEvents: 'none'
          }
        ]} 
      />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Anonymous Match</Text>
        <View style={{ width: 28 }} />
      </View>

      {/* Dynamic 24 Hour Warning Banner */}
      <View style={styles.warningBanner}>
        <Ionicons name="time-outline" size={20} color="#fca5a5" />
        <Text style={styles.warningText}>
          Remember: You only have {timeLeftStr} until this person is gone forever.
        </Text>
      </View>

      {/* Chat Placeholder */}
      <View style={styles.centerContent}>
        <View style={styles.avatarPlaceholder}>
          <Ionicons name="planet" size={48} color="#c084fc" />
        </View>
        <Text style={styles.title}>Match #{id}</Text>
        <Text style={styles.subtitle}>Start chatting anonymously.</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(31, 41, 55, 0.5)',
    zIndex: 10,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    margin: 16,
    padding: 12,
    borderRadius: 12,
    zIndex: 10,
  },
  warningText: {
    color: '#fca5a5',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
    lineHeight: 18,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 10,
  },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
    marginBottom: 16,
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
  },
  title: {
    fontSize: 24,
    color: '#fff',
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#9ca3af',
    marginTop: 8,
    textAlign: 'center',
  },
})
