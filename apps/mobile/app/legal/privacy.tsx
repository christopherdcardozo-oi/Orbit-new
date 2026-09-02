// Public route (top-level, outside (app)/(auth) groups) so the session-
// based redirect guard in _layout.tsx never bounces visitors away from
// it — has to be reachable from the signup screen (no session yet) and
// from within the app.
//
// Written as plain narrative, not lawyer-speak, since the audience is
// a college student, not a court. Not a substitute for a lawyer review
// before broad public launch.

import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import CosmicBackground from '../../components/CosmicBackground'

const LAST_UPDATED = 'September 1, 2026'
const CONTACT_EMAIL = 'support@orbit.orghubs.com'

export default function PrivacyScreen() {
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
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Text style={styles.meta}>Last updated: {LAST_UPDATED}</Text>

        <Text style={styles.p}>
          Orbit is an anonymous, campus-only matchmaking app that resets every day at
          midnight in your campus's local time. This page explains what data we
          collect, why, and what happens to it. Written plainly — no dark patterns,
          no reselling to advertisers.
        </Text>

        <Section title="What we collect">
          <Bullet>
            <B>Your university email address.</B> Used only to verify you belong to
            an approved campus and to send you the one-time sign-in codes. It's the
            single link between your account and a real identity — we don't ask for
            your name, phone number, address, or date of birth.
          </Bullet>
          <Bullet>
            <B>Your profile answers.</B> Major, year in school, gender identity,
            avatar choice, and a short personality quiz. Used to find compatible
            matches on your campus.
          </Bullet>
          <Bullet>
            <B>A public display alias.</B> Auto-generated for you (e.g.
            "NebulaNomad199") — no personally identifying part of you appears
            anywhere in-app to another user. This is the name your match sees.
          </Bullet>
          <Bullet>
            <B>Your messages.</B> Chats with a match are stored so both of you can
            see the conversation history for the length of that match.
          </Bullet>
          <Bullet>
            <B>Contact info you choose to share.</B> Orbit has an optional in-chat
            "Share contact" feature (Instagram, Snapchat, phone, or email) that only
            unlocks once both you and your match have each shared the same type —
            it's revealed to your match, and to no one else, and it's stored tied
            to that match so you can both see what was shared.
          </Bullet>
          <Bullet>
            <B>A push-notification token,</B> if you enable notifications, so we can
            let you know when you're matched or receive a message.
          </Bullet>
          <Bullet>
            <B>Basic technical data</B> your browser or device sends by default (IP
            address, user agent). Kept only in server logs for security and abuse
            prevention, not tied to your profile in our own database.
          </Bullet>
        </Section>

        <Section title="What we don't collect">
          <Bullet>Your real name, phone number, address, or age.</Bullet>
          <Bullet>Your contacts, camera, microphone, or precise location.</Bullet>
          <Bullet>Analytics from third-party ad networks. We don't run ads.</Bullet>
        </Section>

        <Section title="How your data is used">
          <Bullet>To sign you in via one-time code.</Bullet>
          <Bullet>
            To match you with a compatible person on your campus once per daily
            cycle.
          </Bullet>
          <Bullet>To let you and your match exchange messages during that cycle.</Bullet>
          <Bullet>
            To send you a push notification about a new match or a new message, if
            you opt in.
          </Bullet>
          <Bullet>Nothing else. We do not sell it, rent it, or share it.</Bullet>
        </Section>

        <Section title="Who can see what">
          <Bullet>
            Your <B>display alias, avatar, major, and year</B> are visible to your
            current match (only). No other regular user can see them — not other
            students, not other campuses.
          </Bullet>
          <Bullet>
            Your <B>email, personality answers, and message history</B> are never
            shown to any other student.
          </Bullet>
          <Bullet>
            <B>Orbit's administrators</B> (currently the two people who run the
            service) can access account, match, message, and report data for
            students on the campus(es) they administer — solely to investigate
            abuse reports, respond to feedback, and enforce the Terms of Service.
            This is the one exception to the above; it's a small, named team, not
            a general audience, and this access exists only to keep the app safe
            to use.
          </Bullet>
          <Bullet>
            Outside of that admin access, only you can read your own account data
            via the app; the database enforces this at the row level (Supabase
            RLS).
          </Bullet>
        </Section>

        <Section title="How long we keep it">
          <Bullet>
            <B>Matches expire</B> at midnight in your campus's local time. When a
            match expires, the connection is closed and cannot be resumed.
          </Bullet>
          <Bullet>
            <B>Old messages and shared contact info</B> from expired matches remain
            in the database only long enough for us to operate the service (abuse
            reports, backups) and are otherwise not surfaced anywhere in the app.
          </Bullet>
          <Bullet>
            <B>Your profile</B> stays as long as your account exists. Deleting your
            account (Settings → Delete Account) permanently erases your profile,
            matches, messages, and any contact info you'd shared.
          </Bullet>
        </Section>

        <Section title="Cookies & local storage">
          <Bullet>
            We use browser storage to keep you signed in and to remember small UI
            preferences (like whether you dismissed the "install as app" hint).
          </Bullet>
          <Bullet>
            No third-party trackers, no analytics beacons, no ad cookies.
          </Bullet>
        </Section>

        <Section title="Your rights">
          <Bullet>
            <B>Access and delete.</B> You can view your data in-app any time. Delete
            Account removes it. That deletion is irreversible.
          </Bullet>
          <Bullet>
            <B>Contact us</B> at {CONTACT_EMAIL} for any request we can't handle
            in-app, or to ask a question about your data.
          </Bullet>
        </Section>

        <Section title="Children">
          <Bullet>
            Orbit is intended for enrolled college students, 18 or older. Do not
            use the app if you are under 18. See our Terms of Service.
          </Bullet>
        </Section>

        <Section title="Changes to this policy">
          <Bullet>
            If we materially change how we handle your data, we'll update this
            page and post a note in-app before the change takes effect.
          </Bullet>
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
