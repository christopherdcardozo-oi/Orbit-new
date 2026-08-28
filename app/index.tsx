import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Link } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

import CosmicBackground from '../components/CosmicBackground'

export default function LandingPage() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <CosmicBackground />
      
      <View style={styles.content}>
        <Text style={styles.title}>Orbit</Text>
        <Text style={styles.subtitle}>Anonymous connections. One campus. Reset at midnight.</Text>

        <View style={styles.buttonContainer}>
          <Link href="/(auth)/signup" asChild>
            <TouchableOpacity style={StyleSheet.flatten([styles.button, styles.primaryButton])}>
              <Text style={styles.primaryButtonText}>Get Started</Text>
            </TouchableOpacity>
          </Link>
          
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity style={StyleSheet.flatten([styles.button, styles.secondaryButton])}>
              <Text style={styles.secondaryButtonText}>Sign In</Text>
            </TouchableOpacity>
          </Link>
        </View>

        <View style={styles.features}>
          <View style={styles.featureCard}>
            <Text style={styles.featureEmoji}>🎭</Text>
            <Text style={styles.featureTitle}>Completely Anonymous</Text>
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureEmoji}>🌙</Text>
            <Text style={styles.featureTitle}>The Midnight Reset</Text>
          </View>
          <View style={styles.featureCard}>
            <Text style={styles.featureEmoji}>🔒</Text>
            <Text style={styles.featureTitle}>Campus Only</Text>
          </View>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
    justifyContent: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    marginTop: 40,
  },
  title: {
    fontSize: 48,
    fontWeight: '900',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 48,
    lineHeight: 28,
  },
  buttonContainer: {
    width: '100%',
    gap: 16,
    marginBottom: 48,
  },
  button: {
    paddingVertical: 16,
    borderRadius: 9999,
    alignItems: 'center',
  },
  primaryButton: {
    backgroundColor: '#fff',
  },
  primaryButtonText: {
    color: '#030712',
    fontWeight: 'bold',
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderWidth: 1,
    borderColor: '#374151',
  },
  secondaryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  features: {
    width: '100%',
    gap: 16,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  featureEmoji: {
    fontSize: 24,
    marginRight: 16,
  },
  featureTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
})
