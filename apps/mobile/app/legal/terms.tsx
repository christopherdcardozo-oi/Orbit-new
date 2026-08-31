// Public route (top-level, outside (app)/(auth) groups). See privacy.tsx
// for why. Same shared components/styles.

import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import CosmicBackground from '../../components/CosmicBackground'

const LAST_UPDATED = 'August 30, 2026'
const CONTACT_EMAIL = 'support@orbit.orghubs.com'

export default function TermsScreen() {
  const router = useRouter()
  const handleBack = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <CosmicBackground />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Text style={styles.meta}>Last updated: {LAST_UPDATED}</Text>

        <Text style={styles.p}>
          By creating an account or using Orbit, you agree to these Terms. Read
          them — they're short and they matter.
        </Text>

        <Section title="Who can use Orbit">
          <Bullet>
            You must be <B>18 or older</B>.
          </Bullet>
          <Bullet>
            You must be a <B>currently enrolled student</B> of one of the approved
            campuses shown at signup, and you must sign up with your real
            university email at that campus.
          </Bullet>
          <Bullet>
            One account per person. No sharing accounts, no impersonating another
            person, no automated sign-ups.
          </Bullet>
        </Section>

        <Section title="How it works">
          <Bullet>
            Once per daily cycle, Orbit matches you with one anonymous person on
            your campus. The match expires at midnight in your campus's local
            time. When it expires, the connection is closed and cannot be
            resumed.
          </Bullet>
          <Bullet>
            You appear to your match under an auto-generated alias only. If you
            choose to reveal your real name or contact info in chat, that's your
            own choice and your own risk — Orbit itself will never do it for you.
          </Bullet>
        </Section>

        <Section title="Conduct — the rules">
          <Text style={styles.p}>By using Orbit, you agree not to:</Text>
          <Bullet>
            Harass, threaten, stalk, dox, or intimidate any other user.
          </Bullet>
          <Bullet>
            Send sexual content involving minors, non-consensual sexual content, or
            content depicting real violence.
          </Bullet>
          <Bullet>
            Send another user's private information (their name, address, phone,
            photos, socials) without their permission.
          </Bullet>
          <Bullet>
            Send unsolicited advertising, promotions, phishing, malware, or
            scams.
          </Bullet>
          <Bullet>
            Attempt to circumvent the daily match limit, the campus verification,
            the account allowlist, or the rate limits.
          </Bullet>
          <Bullet>
            Attempt to identify, contact, or follow another user off-platform
            against their wishes.
          </Bullet>
          <Bullet>
            Reverse-engineer, scrape, or otherwise abuse the app or its API.
          </Bullet>
        </Section>

        <Section title="Reporting and enforcement">
          <Bullet>
            Report abuse to {CONTACT_EMAIL}. Include the alias of the person and,
            if you can, when the message was sent — we can look up the underlying
            account from that.
          </Bullet>
          <Bullet>
            We can suspend or permanently ban any account that breaks these
            rules, at our discretion and without notice, especially for anything
            listed in "Conduct" above.
          </Bullet>
        </Section>

        <Section title="Your account and content">
          <Bullet>
            You keep ownership of the messages you send. You grant Orbit the
            limited right to store and deliver them to your match, and to review
            them if a report is filed.
          </Bullet>
          <Bullet>
            You can delete your account any time in Settings. That deletion is
            permanent — profile, matches, and messages are removed and cannot be
            restored.
          </Bullet>
        </Section>

        <Section title="No guarantees">
          <Bullet>
            Orbit is provided "as is." We don't guarantee matches, uptime, or
            compatibility. It's a small app, not a professional service.
          </Bullet>
          <Bullet>
            We are not responsible for anything another user says, does, or
            claims about themselves. Meet in-person and off-platform contact at
            your own risk.
          </Bullet>
          <Bullet>
            To the maximum extent allowed by law, Orbit and its operators are not
            liable for any indirect, incidental, or consequential damages arising
            from your use of the app.
          </Bullet>
        </Section>

        <Section title="Changes to these Terms">
          <Bullet>
            We may update these Terms. If we make a material change, we'll post a
            note in-app. Continuing to use Orbit after that change means you
            accept it.
          </Bullet>
        </Section>

        <Section title="Contact">
          <Bullet>Questions, reports, or requests: {CONTACT_EMAIL}.</Bullet>
        </Section>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.h2}>{title}</Text>
      {children}
    </View>
  )
}
function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  )
}
function B({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontWeight: '700', color: '#fff' }}>{children}</Text>
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030712' },
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
  backButton: { padding: 4 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  content: { paddingHorizontal: 20, paddingVertical: 24, paddingBottom: Platform.OS === 'web' ? 60 : 40 },
  meta: { color: '#6b7280', fontSize: 12, marginBottom: 20 },
  p: { color: '#d1d5db', fontSize: 15, lineHeight: 22, marginBottom: 8 },
  section: { marginTop: 24 },
  h2: { color: '#c084fc', fontSize: 16, fontWeight: '700', marginBottom: 10, letterSpacing: 0.3 },
  bulletRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  bulletDot: { color: '#c084fc', fontSize: 15, lineHeight: 22, width: 12 },
  bulletText: { flex: 1, color: '#d1d5db', fontSize: 15, lineHeight: 22 },
})
