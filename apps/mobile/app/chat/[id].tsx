import { useEffect, useRef, useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  Pressable,
  Animated,
  Easing,
  AppState,
  Linking,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { Picker } from '@react-native-picker/picker'
import CosmicBackground from '../../components/CosmicBackground'
import Skeleton from '../../components/Skeleton'
import { supabase } from '../../lib/supabase'
import { PERSONALITY_QUESTIONS } from '../../lib/personality'

type Message = {
  id: string
  match_id: string
  sender_id: string
  content: string
  created_at: string
  read_at: string | null
}

type HandleType = 'instagram' | 'snapchat' | 'phone' | 'email' | 'other'

// One row returned by the get_reveals_for_match RPC. handle_value is
// null for rows the caller hasn't reciprocated the type on — the DB
// nulls it out via the SECURITY DEFINER function, we don't just hide
// it in the UI. `revealed` mirrors that but is easier to switch on.
type ContactReveal = {
  user_id: string
  handle_type: HandleType
  handle_value: string | null
  revealed: boolean
}

const REPORT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'harassment', label: 'Harassment or threats' },
  { value: 'sexual-content', label: 'Sexual or explicit content' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'impersonation', label: 'Impersonation / fake identity' },
  { value: 'safety', label: 'Safety concern / self-harm' },
  { value: 'other', label: 'Other' },
]

// Format validators are best-effort — they catch obvious garbage
// (a phone number under "email", random punctuation, etc.) but they
// can't confirm the account actually exists or belongs to the person
// sharing it. That's honor system beyond format; verifying account
// ownership would need per-platform OAuth (Instagram Basic Display,
// Snap Kit, etc.) which is a bigger project.
const HANDLE_TYPES: {
  value: HandleType
  label: string
  emoji: string
  placeholder: string
  validate: (raw: string) => string | null // returns error text or null
}[] = [
  {
    value: 'instagram',
    label: 'Instagram',
    emoji: '📸',
    placeholder: '@yourhandle',
    validate: (raw) => /^@?[a-zA-Z0-9._]{1,30}$/.test(raw.trim())
      ? null
      : 'Instagram handles are up to 30 letters/numbers/underscore/period, optionally starting with @.',
  },
  {
    value: 'snapchat',
    label: 'Snapchat',
    emoji: '👻',
    placeholder: '@yoursnap',
    validate: (raw) => /^@?[a-zA-Z][a-zA-Z0-9._-]{2,14}$/.test(raw.trim())
      ? null
      : 'Snapchat usernames are 3–15 characters, start with a letter.',
  },
  {
    value: 'phone',
    label: 'Phone',
    emoji: '📱',
    placeholder: '+1 555 555 5555',
    validate: (raw) => /^\+?[0-9 \-().]{7,20}$/.test(raw.trim())
      ? null
      : 'Enter 7–20 digits, optionally with +, spaces, dashes, or parentheses.',
  },
  {
    value: 'email',
    label: 'Email',
    emoji: '📧',
    placeholder: 'you@example.com',
    validate: (raw) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())
      ? null
      : "That doesn't look like an email.",
  },
  {
    value: 'other',
    label: 'Other',
    emoji: '🔗',
    placeholder: 'How to reach you',
    validate: (raw) => raw.trim().length >= 2 ? null : 'Add at least a couple of characters.',
  },
]

const handleMeta = (t: HandleType) => HANDLE_TYPES.find((x) => x.value === t) || HANDLE_TYPES[HANDLE_TYPES.length - 1]

// Convert a revealed handle into a URL the OS knows how to route.
// Instagram/Snapchat use their public web URL (universal-link-aware:
// the installed app claims those hostnames on iOS/Android and opens
// itself, otherwise the browser opens the profile — either way the
// user lands at the right place). tel:/mailto: are the OS standards
// for phone / email. "other" is user free-text so it stays plain.
// Returns null for types with no natural link, so callers can fall
// back to rendering plain text.
function handleLinkFor(t: HandleType, raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  const stripAt = (s: string) => s.replace(/^@+/, '')
  switch (t) {
    case 'instagram':
      return `https://instagram.com/${encodeURIComponent(stripAt(value))}`
    case 'snapchat':
      return `https://snapchat.com/add/${encodeURIComponent(stripAt(value))}`
    case 'phone':
      return `tel:${value.replace(/[^\d+]/g, '')}`
    case 'email':
      return `mailto:${value}`
    case 'other':
      return null
  }
}

async function openHandle(t: HandleType, raw: string) {
  const url = handleLinkFor(t, raw)
  if (!url) return
  try {
    await Linking.openURL(url)
  } catch (e) {
    console.warn('openHandle failed:', e)
  }
}

// Conservative regex heuristics that flag common PII patterns in a
// message before sending. Deliberately narrow to keep false positives
// low — worse to nag on innocent messages than to miss the occasional
// creative-format handle. If any of these hits, we warn and point
// them at the Share Contact button; user can still send anyway.
type PiiHit = { kind: 'phone' | 'email' | 'social' | 'address'; match: string }
function detectPii(text: string): PiiHit[] {
  const hits: PiiHit[] = []
  // Phone: 10+ digits, allowing +, spaces, dashes, parens between them.
  // Requires at least 10 digits total to avoid catching prices or short
  // numeric snippets.
  const phoneMatch = text.match(/(?:\+?\d[\s\-().]{0,2}){10,}/)
  if (phoneMatch) {
    const digits = phoneMatch[0].replace(/\D/g, '')
    if (digits.length >= 10) hits.push({ kind: 'phone', match: phoneMatch[0].trim() })
  }
  // Email — very high signal, minimal false-positive risk.
  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/)
  if (emailMatch) hits.push({ kind: 'email', match: emailMatch[0] })
  // Social handle mentions: @handle or explicit platform keyword +
  // possible handle. Skip if the message is just an emoji reaction
  // that happens to start with @ etc.
  const socialMatch = text.match(/(?:^|\s)@[a-zA-Z0-9._]{3,30}\b/) ||
                      text.match(/\b(instagram|insta|snapchat|snap|whatsapp|telegram|discord|tiktok)\b\s*[:\-@]?\s*[a-zA-Z0-9._]{2,}/i)
  if (socialMatch) hits.push({ kind: 'social', match: socialMatch[0].trim() })
  // Address pattern: number + word(s) + street type. Case-insensitive
  // so "4912 mortesan drive" (no capitalization) still gets flagged.
  // Requires at least one word between the number and the street
  // type to avoid catching things like "$4912 Drive" (still an edge
  // case but tighter than "any digits + drive").
  const addressMatch = text.match(/\b\d{1,5}\s+[a-z]+(?:\s+[a-z]+)?\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|circle|cir)\b/i)
  if (addressMatch) hits.push({ kind: 'address', match: addressMatch[0] })
  return hits
}
const PII_LABELS: Record<PiiHit['kind'], string> = {
  phone: 'a phone number',
  email: 'an email',
  social: 'a social handle',
  address: 'an address',
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

type MatchInfo = {
  id: string
  status: string
  icebreaker: string | null
  expires_at: string | null
  partnerId: string
  partnerAlias: string
  partnerAvatar: string
  partnerMajor: string | null
  partnerYear: string | null
  partnerPersonality: string[] | null
  partnerHobbies: string[] | null
  partnerActivities: string[] | null
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const listRef = useRef<FlatList>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [match, setMatch] = useState<MatchInfo | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)

  // Typing indicator — pure ephemeral broadcast on the same private
  // `match:{id}` channel already used for reveal notifications
  // (migration 036's RLS policy on realtime.messages authorizes ANY
  // broadcast event on that channel for match participants, not just
  // 'reveal', so this needed zero new migrations). No DB writes: a
  // 'typing' event just means "someone is typing right now," expires
  // itself client-side if a follow-up 'stopped' event never arrives
  // (dropped connection, tab closed mid-type, etc).
  const [partnerTyping, setPartnerTyping] = useState(false)
  const revealChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const typingSentAtRef = useRef(0)
  const partnerTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [timeLeftStr, setTimeLeftStr] = useState('')
  const [expired, setExpired] = useState(false)
  // secondsLeft is always tracked so the warning banner can decide
  // whether it's in the "≤ 1 hour left" persistent-visible state.
  // Interval frequency ramps: 30s outside the final 10 min, 1s inside
  // (so the m:ss countdown updates every second).
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  // (Old red-tint state removed — chat now uses the standard
  // CosmicBackground so it matches the lobby and profile screens; the
  // warning banner + 10-min pulsing countdown carry all the urgency
  // signal now.)
  // Disintegrate-and-leave animation state, driven by the match status
  // realtime subscription flipping to 'expired' (or the countdown
  // hitting 0 locally, whichever comes first).
  const disintegrateAnim = useRef(new Animated.Value(0)).current // 0 → 1 fades bubbles out + up
  const blackoutAnim = useRef(new Animated.Value(0)).current // 0 → 1 fades to black overlay
  const [disintegrating, setDisintegrating] = useState(false)
  // Banner pulse in the last 10 min — subtle scale + opacity.
  const bannerPulse = useRef(new Animated.Value(1)).current
  const seenMessageIds = useRef(new Set<string>())

  // Menu (three-dot) + Report modal + Block confirmation.
  const [menuOpen, setMenuOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportCategory, setReportCategory] = useState(REPORT_CATEGORIES[0].value)
  const [reportDetails, setReportDetails] = useState('')
  const [reportBusy, setReportBusy] = useState(false)
  const [reportStatus, setReportStatus] = useState<null | { kind: 'ok' | 'err'; text: string }>(null)

  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false)
  const [blockBusy, setBlockBusy] = useState(false)

  // Mini profile modal — tap partner name/avatar in the header to see
  // their personality answers + major/year. Nothing new is fetched
  // when opened; all this data is already loaded with the match.
  const [profileModalOpen, setProfileModalOpen] = useState(false)

  // PII warning: shown when the pending outgoing message looks like
  // it contains contact info shared outside the Share Contact flow.
  // The user can still send anyway — this is a nudge, not a filter.
  const [piiWarning, setPiiWarning] = useState<{ hits: PiiHit[]; message: string } | null>(null)

  // Contact reveals — arrays now, since users can share multiple types
  // (Instagram + Snap + email) and each type is independently
  // reciprocated with the partner.
  const [myReveals, setMyReveals] = useState<ContactReveal[]>([])
  const [partnerReveals, setPartnerReveals] = useState<ContactReveal[]>([])
  const [revealModalOpen, setRevealModalOpen] = useState(false)
  const [revealType, setRevealType] = useState<HandleType>('instagram')
  const [revealValue, setRevealValue] = useState('')
  const [revealBusy, setRevealBusy] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)

  // ---------- Initial load ----------

  useEffect(() => {
    if (!id) return

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const { data: matchRow, error: matchError } = await supabase
        .from('matches')
        .select('id, status, icebreaker, expires_at, user1_id, user2_id')
        .eq('id', id)
        .single()

      // RLS returns nothing (not an error) if this isn't your match.
      if (matchError || !matchRow) {
        setNotFound(true)
        setLoading(false)
        return
      }

      const partnerId = matchRow.user1_id === user.id ? matchRow.user2_id : matchRow.user1_id
      const { data: partner } = await supabase
        .from('profiles')
        .select('display_alias, avatar, major, year_in_school, personality, hobbies, activities')
        .eq('id', partnerId)
        .single()

      setMatch({
        id: matchRow.id,
        status: matchRow.status,
        icebreaker: matchRow.icebreaker,
        expires_at: matchRow.expires_at,
        partnerId,
        partnerAlias: partner?.display_alias ?? 'Mystery Connection',
        partnerAvatar: partner?.avatar ?? 'alien',
        partnerMajor: partner?.major ?? null,
        partnerYear: partner?.year_in_school ?? null,
        partnerPersonality: partner?.personality ?? null,
        partnerHobbies: partner?.hobbies ?? null,
        partnerActivities: partner?.activities ?? null,
      })

      const { data: existingMessages } = await supabase
        .from('messages')
        .select('id, match_id, sender_id, content, created_at, read_at')
        .eq('match_id', id)
        .order('created_at', { ascending: true })

      if (existingMessages) {
        for (const m of existingMessages) seenMessageIds.current.add(m.id)
        setMessages(existingMessages)
      }

      setLoading(false)

      // Opening the thread is the read receipt: stamp read_at on anything
      // the partner sent that we haven't already marked read.
      const unreadFromPartner = (existingMessages ?? []).filter(
        (m) => m.sender_id !== user.id && !m.read_at
      )
      if (unreadFromPartner.length > 0) {
        await supabase
          .from('messages')
          .update({ read_at: new Date().toISOString() })
          .in('id', unreadFromPartner.map((m) => m.id))
      }
    }

    load()
  }, [id])

  // ---------- Realtime: new messages ----------

  useEffect(() => {
    if (!id) return

    const channel = supabase
      .channel(`messages-for-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `match_id=eq.${id}` },
        (payload) => {
          const newMsg = payload.new as Message
          if (seenMessageIds.current.has(newMsg.id)) return
          seenMessageIds.current.add(newMsg.id)
          setMessages((prev) => [...prev, newMsg])

          // We're already looking at this chat, so the moment a partner's
          // message lands it's effectively read — stamp it immediately
          // instead of waiting for the next screen-open.
          if (newMsg.sender_id !== userId) {
            supabase
              .from('messages')
              .update({ read_at: new Date().toISOString() })
              .eq('id', newMsg.id)
              .then()
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `match_id=eq.${id}` },
        (payload) => {
          const updated = payload.new as Message
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, read_at: updated.read_at } : m))
          )
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [id, userId])

  // ---------- Realtime: match expiring while chatting ----------

  useEffect(() => {
    if (!id) return

    const channel = supabase
      .channel(`match-status-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${id}` },
        (payload) => {
          const updated = payload.new as { status: string }
          setMatch((prev) => (prev ? { ...prev, status: updated.status } : prev))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [id])

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }))
    }
  }, [messages.length])

  // ---------- Countdown + expiry ----------
  //
  // Two rates. Down to the last 10 min we tick every 30 seconds and
  // show a coarse label ("3 hours", "42 minutes") in the warning
  // banner. Once inside the last 10 min we switch to a 1-second tick
  // and render a live m:ss countdown ("9:47"), and turn on the banner
  // pulse for extra urgency. Refs are recomputed on every tick so the
  // interval frequency actually changes when we cross the threshold.

  useEffect(() => {
    if (!match?.expires_at) return
    let interval: ReturnType<typeof setInterval> | null = null
    let inFinalWindow = false

    const tick = () => {
      const now = Date.now()
      const expiresAt = new Date(match.expires_at as string).getTime()
      const diffMs = expiresAt - now

      if (diffMs <= 0) {
        setExpired(true)
        setSecondsLeft(0)
        setTimeLeftStr('expired')
        return
      }

      const totalSeconds = Math.floor(diffMs / 1000)
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

      // Track live seconds always so the banner can decide whether
      // we're inside the "≤ 1 hour" window (persistent visible) or the
      // "≤ 10 min" window (m:ss + pulsing).
      setSecondsLeft(totalSeconds)
      const nowInFinal = diffHours === 0 && diffMinutes < 10

      if (diffHours > 0) {
        setTimeLeftStr(`${diffHours} hour${diffHours === 1 ? '' : 's'}`)
      } else if (diffMinutes > 0) {
        setTimeLeftStr(`${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`)
      } else {
        setTimeLeftStr('less than a minute')
      }

      // If crossing into the final window, swap the interval to 1s.
      if (nowInFinal !== inFinalWindow) {
        inFinalWindow = nowInFinal
        if (interval) clearInterval(interval)
        interval = setInterval(tick, nowInFinal ? 1000 : 30000)
      }
    }

    tick()
    interval = setInterval(tick, 30000)
    return () => { if (interval) clearInterval(interval) }
  }, [match?.expires_at])

  // Banner pulse — only runs during the last 10 min. Subtle scale +
  // opacity loop, 800ms each direction.
  useEffect(() => {
    if (secondsLeft === null || secondsLeft <= 0) {
      bannerPulse.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bannerPulse, {
          toValue: 1.06,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(bannerPulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [secondsLeft, bannerPulse])

  // ---------- Disintegrate-and-leave sequence ----------
  //
  // Fires when either:
  //   (a) realtime UPDATE on matches flips status to 'expired' (the
  //       cron did it at midnight for this campus), OR
  //   (b) our own local countdown hit 0 first (in which case the
  //       realtime event will arrive shortly and we don't need it).
  //
  // Sequence: bubbles fade + drift up, then a black overlay fades in
  // with "They vanished into the cosmos." then we navigate home. The
  // home screen's realtime subscription will show the new match
  // automatically the instant the matchmaker creates one.
  const runDisintegrate = useCallback(() => {
    if (disintegrating) return
    setDisintegrating(true)
    Animated.sequence([
      Animated.timing(disintegrateAnim, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(blackoutAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.delay(1200), // let them read "They vanished into the cosmos."
    ]).start(() => {
      router.replace('/(app)')
    })
  }, [disintegrating, disintegrateAnim, blackoutAnim, router])

  // Trigger when status flips to expired (either via realtime or the
  // local countdown reaching 0 and setting expired locally).
  useEffect(() => {
    if (expired || match?.status === 'expired') {
      runDisintegrate()
    }
  }, [expired, match?.status, runDisintegrate])

  // router.back() silently no-ops when there's no history to go back to —
  // e.g. this chat was opened via a fresh refresh/deep link rather than a
  // Start Chatting tap. Fall back to the match list so the button always
  // does something.
  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/(app)')
    }
  }, [router])

  const isActive = match?.status === 'active' && !expired

  // ---------- Contact reveals: fetch via RPC (returns metadata for
  // both users' shares, with partner's handle_value nulled where the
  // caller hasn't reciprocated that specific type — enforced in the
  // SECURITY DEFINER function, not just here). Keep in sync via
  // realtime on the raw table so a new share on either side triggers
  // a re-fetch.
  useEffect(() => {
    if (!id || !userId) return
    const load = async () => {
      const { data, error } = await supabase
        .rpc('get_reveals_for_match', { p_match_id: id })
      if (error) { console.warn('get_reveals_for_match failed:', error); return }
      const rows = (data ?? []) as ContactReveal[]
      setMyReveals(rows.filter((r) => r.user_id === userId))
      setPartnerReveals(rows.filter((r) => r.user_id !== userId))
    }
    load()

    // Event-driven reveal refresh. The DB trigger (migration 036)
    // broadcasts a `reveal` event on this per-match private channel
    // EXCLUSIVELY when reciprocity is confirmed server-side — first
    // shares and non-matching handle types generate zero broadcasts.
    // Replaces an earlier postgres_changes subscription on the raw
    // contact_reveals table, which fired on every insert but also
    // silently dropped events whenever the WebSocket went stale
    // (phone locks, idle backgrounding, brief network blip) — the
    // exact "I shared, partner reciprocated, but my screen only
    // updates if I leave and come back" bug that got reported.
    const channel = supabase
      .channel(`match:${id}`, { config: { private: true } })
      .on('broadcast', { event: 'reveal' }, () => { load() })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        // Ignore our own broadcast (shouldn't normally arrive — this
        // client isn't in the recipient set for its own send — but
        // cheap enough to guard explicitly rather than rely on that).
        if (payload?.userId === userId) return
        setPartnerTyping(!!payload?.typing)
        if (partnerTypingTimeoutRef.current) clearTimeout(partnerTypingTimeoutRef.current)
        if (payload?.typing) {
          // Self-clears if the partner's own 'stopped typing' event
          // never arrives (they closed the tab mid-keystroke, lost
          // connection, etc) — 4s of silence reads as "done typing"
          // same as iMessage/Signal's own timeout-based indicators.
          partnerTypingTimeoutRef.current = setTimeout(() => setPartnerTyping(false), 4000)
        }
      })
      .subscribe()
    revealChannelRef.current = channel

    // Safety-net backstop for the rare case where the WebSocket is
    // truly dead at the moment the broadcast fires (nothing can
    // deliver over a dead socket). Refetching on tab/app refocus
    // silently self-heals it — matches the "leave and come back"
    // workaround without requiring the user to actually navigate.
    const refetchOnResume = () => { load() }
    if (Platform.OS === 'web') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') refetchOnResume()
      }
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('focus', onVisible)
      return () => {
        supabase.removeChannel(channel)
        revealChannelRef.current = null
        if (partnerTypingTimeoutRef.current) clearTimeout(partnerTypingTimeoutRef.current)
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('focus', onVisible)
      }
    } else {
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') refetchOnResume()
      })
      return () => {
        supabase.removeChannel(channel)
        revealChannelRef.current = null
        if (partnerTypingTimeoutRef.current) clearTimeout(partnerTypingTimeoutRef.current)
        sub.remove()
      }
    }
  }, [id, userId])

  const submitReveal = async () => {
    if (!id || !userId) return
    const trimmed = revealValue.trim()
    if (!trimmed) return
    // Format check first — no round trip if the input is obviously
    // wrong for the chosen type.
    const validationError = handleMeta(revealType).validate(trimmed)
    if (validationError) { setRevealError(validationError); return }

    setRevealBusy(true)
    setRevealError(null)
    // Upsert on (match, user, type) so re-submitting the SAME type
    // overwrites your previous value cleanly (a normal "I typed the
    // wrong handle, fixing it" flow), while different types remain as
    // separate rows.
    const { error } = await supabase
      .from('contact_reveals')
      .upsert(
        { match_id: id, user_id: userId, handle_type: revealType, handle_value: trimmed },
        { onConflict: 'match_id,user_id,handle_type' }
      )
    setRevealBusy(false)
    if (error) {
      console.warn('contact_reveals upsert failed:', error)
      setRevealError(error.message || 'Something went wrong sharing your contact.')
      return
    }
    // Optimistically update myReveals so the banner and the "You're
    // sharing" list reflect this insert immediately, instead of waiting
    // for the realtime event to arrive. Realtime still re-fetches
    // asynchronously in case the row shape differs (unlikely, but the
    // real DB is the source of truth on a proper re-sync).
    const inserted: ContactReveal = {
      user_id: userId,
      handle_type: revealType,
      handle_value: trimmed,
      revealed: true, // my own row: I can always see it
    }
    setMyReveals((prev) => {
      const others = prev.filter((r) => r.handle_type !== revealType)
      return [...others, inserted]
    })

    // Reset form for adding another type.
    setRevealValue('')
    setRevealError(null)
    // Auto-advance to the next unused type as a small nudge to add more.
    const usedTypes = new Set([...myReveals.map((r) => r.handle_type), revealType])
    const nextUnused = HANDLE_TYPES.find((t) => !usedTypes.has(t.value))
    if (nextUnused) setRevealType(nextUnused.value)
  }

  // Delete one of my shares (RLS allows only my own). Optimistically
  // removes it locally too so the UI updates immediately, not just
  // after the realtime event arrives.
  const retractReveal = async (handle_type: HandleType) => {
    if (!id || !userId) return
    setMyReveals((prev) => prev.filter((r) => r.handle_type !== handle_type))
    const { error } = await supabase
      .from('contact_reveals')
      .delete()
      .eq('match_id', id)
      .eq('user_id', userId)
      .eq('handle_type', handle_type)
    if (error) {
      // Roll back the optimistic removal if the delete somehow fails.
      console.warn('contact_reveals delete failed:', error)
    }
  }

  const submitReport = async () => {
    if (!id || !userId || !match) return
    setReportBusy(true)
    setReportStatus(null)
    // reason = category (short slug); details = free text (optional).
    // Reports and Blocks are combined per the doc — reporting almost
    // always implies you don't want to interact with this person again,
    // and making it two taps was silently losing "I reported but still
    // got matched with them again" complaints.
    const { error } = await supabase.from('reports').insert({
      match_id: id,
      reporter_id: userId,
      reported_user_id: match.partnerId,
      reason: reportCategory,
      details: reportDetails.trim() || null,
    })
    if (error) {
      setReportBusy(false)
      const msg = error.code === '23505'
        ? "You've already reported this person for this match."
        : error.message
      setReportStatus({ kind: 'err', text: msg })
      return
    }
    // Fire-and-forget the block. Even if it fails, the report succeeded
    // and the user is on their way out — the matchmaker still has the
    // report row visible to admins for later manual action.
    await supabase.from('blocked_pairs').insert({
      blocker_id: userId,
      blocked_id: match.partnerId,
    })
    setReportBusy(false)
    setReportStatus({ kind: 'ok', text: 'Sent. You won’t match again.' })
    setReportDetails('')
    // Brief pause so they can read the confirmation, then leave.
    setTimeout(() => {
      setReportOpen(false)
      handleBack()
    }, 1200)
  }

  const confirmBlock = async () => {
    if (!userId || !match) return
    setBlockBusy(true)
    await supabase.from('blocked_pairs').insert({
      blocker_id: userId,
      blocked_id: match.partnerId,
    })
    setBlockBusy(false)
    setBlockConfirmOpen(false)
    setMenuOpen(false)
    // Blocking mid-match: leave the current chat gracefully. The
    // matchmaker won't pair us again after this.
    handleBack()
  }

  // Broadcasts this client's typing state to the partner over the same
  // private channel the reveal notifications use. Throttled to at most
  // once every 2s while actively typing (no point re-announcing "yep,
  // still typing" on every keystroke) but 'stopped' always sends
  // immediately — that's the one that matters for the indicator
  // disappearing promptly instead of lingering the full 4s timeout.
  const sendTyping = useCallback((typing: boolean) => {
    if (!userId || !revealChannelRef.current) return
    const now = Date.now()
    if (typing && now - typingSentAtRef.current < 2000) return
    typingSentAtRef.current = now
    revealChannelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { typing, userId },
    })
  }, [userId])

  // Actual insert-and-append. Called by handleSend when the message
  // looks clean, or by the PII warning's "Send anyway" path.
  const doSend = useCallback(async (content: string) => {
    if (!content || !userId || !id || !isActive) return
    sendTyping(false)
    setSending(true)
    setInputText('')
    setPiiWarning(null)
    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({ match_id: id, sender_id: userId, content })
      .select('id, match_id, sender_id, content, created_at, read_at')
      .single()
    if (error) {
      console.warn('Failed to send message:', error)
      setInputText(content) // give it back so they don't lose what they typed
    } else if (inserted) {
      seenMessageIds.current.add(inserted.id)
      setMessages((prev) => [...prev, inserted])
    }
    setSending(false)
  }, [userId, id, isActive, sendTyping])

  const handleSend = useCallback(() => {
    const content = inputText.trim()
    if (!content || sending || !isActive) return
    const hits = detectPii(content)
    if (hits.length > 0) {
      setPiiWarning({ hits, message: content })
      return
    }
    doSend(content)
  }, [inputText, sending, isActive, doSend])

  // ---------- Render ----------

  if (loading) {
    // Skeleton mirrors the real layout shape so nothing jumps when the
    // data arrives — header, warning banner, two message-bubble
    // placeholders (one left / one right), and the disabled composer.
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <CosmicBackground />
        <View style={styles.header}>
          <View style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#374151" />
          </View>
          <Skeleton width={140} height={20} radius={6} />
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.warningBanner}>
          <Skeleton style={{ width: '90%', height: 16, borderRadius: 6 }} />
        </View>
        <View style={{ padding: 16, flex: 1 }}>
          <View style={[styles.bubbleRow, styles.bubbleRowTheirs]}>
            <Skeleton width={180} height={40} radius={18} />
          </View>
          <View style={[styles.bubbleRow, styles.bubbleRowMine]}>
            <Skeleton width={140} height={40} radius={18} />
          </View>
          <View style={[styles.bubbleRow, styles.bubbleRowTheirs]}>
            <Skeleton width={220} height={40} radius={18} />
          </View>
        </View>
        <View style={styles.composer}>
          <View style={[styles.composerInput, { opacity: 0.5 }]} />
          <View style={[styles.sendButton, { opacity: 0.4 }]} />
        </View>
      </SafeAreaView>
    )
  }

  if (notFound || !match) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <CosmicBackground />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Not found</Text>
          <View style={{ width: 28 }} />
        </View>
        <View style={styles.centerContent}>
          <Text style={styles.subtitle}>This match doesn't exist, or isn't yours.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <CosmicBackground />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerCenter}
          onPress={() => setProfileModalOpen(true)}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name={match.partnerAvatar as any} size={20} color="#c084fc" />
          <View>
            <Text style={styles.headerTitle} numberOfLines={1}>{match.partnerAlias}</Text>
            {partnerTyping && <Text style={styles.headerTypingText}>typing…</Text>}
          </View>
          <Ionicons name="chevron-down" size={14} color="#9ca3af" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.backButton} onPress={() => setMenuOpen(true)}>
          <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Expiry warning. Behavior:
            - Shown while there are no messages yet (helps set expectations)
            - Auto-hides once any message has been sent (either party)
            - Reappears persistently once secondsLeft ≤ 3600 (one hour)
            - Inside the last 10 min: pulses + switches to a live m:ss
              countdown (bannerPulse drives the scale ramp)
            - Once expired: swaps to the "vanished" message and stays. */}
      {(() => {
        if (!isActive) {
          return (
            <View style={styles.warningBanner}>
              <Ionicons name="time-outline" size={20} color="#fca5a5" />
              <Text style={styles.warningText}>This connection has expired. They vanished into the cosmos.</Text>
            </View>
          )
        }
        const withinHour = secondsLeft !== null && secondsLeft <= 3600
        const withinTenMin = secondsLeft !== null && secondsLeft > 0 && secondsLeft <= 600
        const hasMessages = messages.length > 0
        // Show if: no messages yet OR we're inside the last hour.
        if (hasMessages && !withinHour) return null
        return (
          <Animated.View
            style={[
              styles.warningBanner,
              withinTenMin && {
                transform: [{ scale: bannerPulse }],
                borderColor: 'rgba(239, 68, 68, 0.7)',
                backgroundColor: 'rgba(239, 68, 68, 0.18)',
              },
            ]}
          >
            <Ionicons name="time-outline" size={20} color="#fca5a5" />
            <Text style={styles.warningText}>
              {withinTenMin
                ? `${Math.floor(secondsLeft! / 60)}:${String(secondsLeft! % 60).padStart(2, '0')} until gone forever.`
                : `Remember: You only have ${timeLeftStr} until this person is gone forever.`}
            </Text>
          </Animated.View>
        )
      })()}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Messages column disintegrates first: bubbles fade + drift
            upward as one block. Header, warning banner, and composer
            stay put and get covered by the blackout overlay below. */}
        <Animated.View
          style={{
            flex: 1,
            opacity: disintegrateAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [
              { translateY: disintegrateAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -40] }) },
            ],
          }}
        >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.avatarPlaceholder}>
                <MaterialCommunityIcons name={match.partnerAvatar as any} size={48} color="#c084fc" />
              </View>
              <Text style={styles.title}>You matched with {match.partnerAlias}</Text>
              {match.icebreaker && (
                <View style={styles.icebreakerBox}>
                  <Text style={styles.icebreakerText}>"{match.icebreaker}"</Text>
                </View>
              )}
              <Text style={styles.subtitle}>Say hi — start the conversation.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isMine = item.sender_id === userId
            return (
              <View style={[styles.bubbleRow, isMine ? styles.bubbleRowMine : styles.bubbleRowTheirs]}>
                <View style={{ maxWidth: '78%' }}>
                  <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={styles.bubbleText}>{item.content}</Text>
                  </View>
                  <Text style={[styles.timestamp, isMine ? styles.timestampMine : styles.timestampTheirs]}>
                    Sent {formatTime(item.created_at)}
                    {isMine && item.read_at ? ` · Read ${formatTime(item.read_at)}` : ''}
                  </Text>
                </View>
              </View>
            )
          }}
        />
        </Animated.View>

        {/* Contact-reveal banner. Compact summary — full manage UI lives
            in the modal. Three cases:
              (a) Nothing shared on either side → prompt to start
              (b) I've shared, partner hasn't shared anything → waiting
              (c) At least one match (both shared same type) → show what
                  we can see + hint at any of theirs we haven't
                  reciprocated yet. */}
        {isActive && (() => {
          const revealedFromPartner = partnerReveals.filter((r) => r.revealed && r.handle_value)
          const partnerTypesIHavent = partnerReveals
            .filter((r) => !r.revealed)
            .map((r) => r.handle_type)
          const openManage = () => {
            setRevealValue('')
            const usedTypes = new Set(myReveals.map((r) => r.handle_type))
            const nextUnused = HANDLE_TYPES.find((t) => !usedTypes.has(t.value))
            setRevealType(nextUnused?.value ?? 'instagram')
            setRevealError(null)
            setRevealModalOpen(true)
          }

          // (a)
          if (myReveals.length === 0 && partnerReveals.length === 0) {
            return (
              <View style={styles.revealBanner}>
                <Ionicons name="share-social-outline" size={18} color="#c084fc" />
                <Text style={styles.revealBannerText}>Want to keep chatting past midnight?</Text>
                <TouchableOpacity style={styles.revealBannerBtn} onPress={openManage}>
                  <Text style={styles.revealBannerBtnText}>Share contact</Text>
                </TouchableOpacity>
              </View>
            )
          }

          // Little "Edit" pill on the right that reopens the modal —
          // more obvious than the plain-text "Manage" link that was
          // easy to miss.
          const editPill = (
            <View style={styles.revealEditPill}>
              <Ionicons name="create-outline" size={12} color="#c084fc" />
              <Text style={styles.revealEditPillText}>Edit</Text>
            </View>
          )

          // Short summary of MY shares — used in states (b) and (c) so
          // people can see what they entered without having to reopen
          // the modal.
          const mineSummary = myReveals.length > 0 && (
            <Text style={styles.revealBannerMine} numberOfLines={2}>
              You shared: {myReveals.map((r) => `${handleMeta(r.handle_type).emoji} ${handleMeta(r.handle_type).label}`).join(' · ')}
            </Text>
          )

          // (b) I've shared, partner hasn't shared anything at all yet.
          if (myReveals.length > 0 && partnerReveals.length === 0) {
            return (
              <TouchableOpacity style={styles.revealBanner} onPress={openManage} activeOpacity={0.7}>
                <Ionicons name="time-outline" size={18} color="#c084fc" />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.revealBannerText}>
                    Waiting for {match.partnerAlias} to share the same type.
                  </Text>
                  {mineSummary}
                </View>
                {editPill}
              </TouchableOpacity>
            )
          }

          // (c) At least one side has partial visibility.
          return (
            <TouchableOpacity style={styles.revealBanner} onPress={openManage} activeOpacity={0.7}>
              <Ionicons name="checkmark-circle" size={18} color="#86efac" />
              <View style={{ flex: 1, marginLeft: 8 }}>
                {revealedFromPartner.length > 0 ? (
                  revealedFromPartner.map((r) => {
                    const link = handleLinkFor(r.handle_type, r.handle_value ?? '')
                    return (
                      <Text key={r.handle_type} style={styles.revealBannerValueLine} selectable>
                        <Text style={styles.revealBannerLabel}>
                          {handleMeta(r.handle_type).emoji} {handleMeta(r.handle_type).label}: {' '}
                        </Text>
                        {link ? (
                          // Nested Text with onPress is the RN-safe way
                          // to tap through an outer TouchableOpacity — a
                          // nested Pressable/TouchableOpacity would fight
                          // the parent for the gesture. The onPress here
                          // wins because RN dispatches text taps before
                          // walking back up to the enclosing touchable.
                          <Text
                            style={styles.revealBannerValueLink}
                            onPress={() => openHandle(r.handle_type, r.handle_value ?? '')}
                            suppressHighlighting={false}
                          >
                            {r.handle_value}
                          </Text>
                        ) : (
                          r.handle_value
                        )}
                      </Text>
                    )
                  })
                ) : (
                  <Text style={styles.revealBannerText}>
                    Add a matching type to unlock theirs.
                  </Text>
                )}
                {mineSummary}
                {partnerTypesIHavent.length > 0 && (
                  <Text style={styles.revealBannerHint}>
                    {match.partnerAlias} also shared{' '}
                    {partnerTypesIHavent.map((t) => handleMeta(t).label).join(', ')}
                    {' — share yours to unlock.'}
                  </Text>
                )}
              </View>
              {editPill}
            </TouchableOpacity>
          )
        })()}

        {/* Composer */}
        <View style={styles.composer}>
          <TextInput
            style={[styles.composerInput, !isActive && styles.composerInputDisabled]}
            placeholder={isActive ? 'Type a message…' : 'This connection has expired'}
            placeholderTextColor="#6b7280"
            value={inputText}
            onChangeText={(t) => {
              setInputText(t)
              sendTyping(t.trim().length > 0)
            }}
            editable={isActive}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[styles.sendButton, (!isActive || !inputText.trim()) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!isActive || !inputText.trim() || sending}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Three-dot menu */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuSheet}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); setReportOpen(true); setReportStatus(null) }}
            >
              <Ionicons name="flag-outline" size={20} color="#fca5a5" />
              <Text style={[styles.menuItemText, { color: '#fca5a5' }]}>Report and Block {match.partnerAlias}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setMenuOpen(false); setBlockConfirmOpen(true) }}
            >
              <Ionicons name="ban-outline" size={20} color="#fca5a5" />
              <Text style={[styles.menuItemText, { color: '#fca5a5' }]}>Block — never match again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, { justifyContent: 'center' }]} onPress={() => setMenuOpen(false)}>
              <Text style={[styles.menuItemText, { color: '#9ca3af' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Report modal */}
      <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setReportOpen(false)}>
          <Pressable style={[styles.menuSheet, { padding: 20 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Report and Block {match.partnerAlias}</Text>
            <Text style={styles.sheetSubtitle}>
              We'll review this and you two will never match again. Thanks for keeping Orbit safe.
            </Text>
            {REPORT_CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c.value}
                style={[styles.optionRow, reportCategory === c.value && styles.optionRowActive]}
                onPress={() => setReportCategory(c.value)}
              >
                <Ionicons
                  name={reportCategory === c.value ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={reportCategory === c.value ? '#c084fc' : '#6b7280'}
                />
                <Text style={styles.optionRowText}>{c.label}</Text>
              </TouchableOpacity>
            ))}
            <TextInput
              style={styles.reportInput}
              placeholder="Any details? (optional)"
              placeholderTextColor="#6b7280"
              value={reportDetails}
              onChangeText={setReportDetails}
              multiline
              maxLength={1000}
            />
            {reportStatus && (
              <Text style={{
                color: reportStatus.kind === 'ok' ? '#86efac' : '#fca5a5',
                fontSize: 13, marginTop: 8, textAlign: 'center',
              }}>{reportStatus.text}</Text>
            )}
            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.sheetCancelBtn} onPress={() => setReportOpen(false)}>
                <Text style={styles.sheetCancelText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetPrimaryBtn, reportBusy && { opacity: 0.5 }]}
                onPress={submitReport}
                disabled={reportBusy || reportStatus?.kind === 'ok'}
              >
                {reportBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetPrimaryText}>Report and Block</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Block confirmation */}
      <Modal visible={blockConfirmOpen} transparent animationType="fade" onRequestClose={() => setBlockConfirmOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setBlockConfirmOpen(false)}>
          <Pressable style={[styles.menuSheet, { padding: 20 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Block {match.partnerAlias}?</Text>
            <Text style={styles.sheetSubtitle}>
              You'll leave this chat, and Orbit will never match the two of you again.
            </Text>
            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.sheetCancelBtn} onPress={() => setBlockConfirmOpen(false)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetPrimaryBtn, { backgroundColor: '#dc2626' }, blockBusy && { opacity: 0.5 }]}
                onPress={confirmBlock}
                disabled={blockBusy}
              >
                {blockBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetPrimaryText}>Block</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Contact-reveal modal — manages your list of shared handles.
          Multiple types allowed (Instagram + Snap + Email…). Each type
          you share can be individually retracted with the × next to
          it. Reciprocity is per-type: your Instagram unlocks theirs
          only if they've also shared Instagram. */}
      <Modal visible={revealModalOpen} transparent animationType="slide" onRequestClose={() => setRevealModalOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setRevealModalOpen(false)}>
          <Pressable style={[styles.menuSheet, { padding: 20 }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle}>Share your contact</Text>
            <Text style={styles.sheetSubtitle}>
              Share as many types as you like. Each is only revealed to {match.partnerAlias} once they share that same type too.
            </Text>

            {/* My existing shares — each with a × to take back. */}
            {myReveals.length > 0 && (
              <>
                <Text style={styles.sheetHelp}>You're sharing:</Text>
                {myReveals.map((r) => (
                  <View key={r.handle_type} style={styles.mineRow}>
                    <Text style={styles.mineRowEmoji}>{handleMeta(r.handle_type).emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mineRowLabel}>{handleMeta(r.handle_type).label}</Text>
                      <Text style={styles.mineRowValue} numberOfLines={1}>{r.handle_value}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.mineRowX}
                      onPress={() => retractReveal(r.handle_type)}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={22} color="#6b7280" />
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}

            {/* Add-another form — only shown when there's at least one
                type left to add. */}
            {(() => {
              const usedTypes = new Set(myReveals.map((r) => r.handle_type))
              const availableTypes = HANDLE_TYPES.filter((t) => !usedTypes.has(t.value))
              const currentIsUsed = usedTypes.has(revealType)
              // If the currently-selected type is already shared, snap
              // the picker to the first available type so the form
              // isn't in a broken state.
              if (currentIsUsed && availableTypes.length > 0) {
                setTimeout(() => setRevealType(availableTypes[0].value), 0)
              }
              if (availableTypes.length === 0) {
                return (
                  <Text style={styles.sheetHelp}>You've shared every handle type. Take one back to change it.</Text>
                )
              }
              return (
                <>
                  <Text style={[styles.sheetHelp, { marginTop: 12 }]}>Add another:</Text>
                  <View style={styles.pickerBox}>
                    <Picker
                      selectedValue={currentIsUsed ? availableTypes[0].value : revealType}
                      onValueChange={(v) => {
                        setRevealType(v as HandleType)
                        setRevealValue('')
                        setRevealError(null)
                      }}
                      style={styles.picker}
                      itemStyle={{ color: '#fff' }}
                    >
                      {availableTypes.map((t) => (
                        <Picker.Item key={t.value} label={`${t.emoji}  ${t.label}`} value={t.value} />
                      ))}
                    </Picker>
                  </View>
                  <TextInput
                    style={styles.reportInput}
                    placeholder={handleMeta(revealType).placeholder}
                    placeholderTextColor="#6b7280"
                    value={revealValue}
                    onChangeText={(t) => { setRevealValue(t); if (revealError) setRevealError(null) }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType={revealType === 'phone' ? 'phone-pad' : revealType === 'email' ? 'email-address' : 'default'}
                    maxLength={200}
                  />
                  {revealError && (
                    <Text style={{ color: '#fca5a5', fontSize: 13, marginTop: 8, textAlign: 'center' }}>
                      {revealError}
                    </Text>
                  )}
                  <TouchableOpacity
                    style={[styles.sheetPrimaryBtn, { marginTop: 12 }, (revealBusy || !revealValue.trim()) && { opacity: 0.5 }]}
                    onPress={submitReveal}
                    disabled={revealBusy || !revealValue.trim()}
                  >
                    {revealBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetPrimaryText}>Add</Text>}
                  </TouchableOpacity>
                </>
              )
            })()}

            <TouchableOpacity style={[styles.sheetCancelBtn, { marginTop: 16 }]} onPress={() => setRevealModalOpen(false)}>
              <Text style={styles.sheetCancelText}>Done</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Mini profile — reveals partner's personality answers + basics.
          Everything here is already loaded with the match, so opening
          is free. No RLS gap: the partner-profile visibility policy
          (migration 016) is what let the initial fetch succeed. */}
      <Modal visible={profileModalOpen} transparent animationType="slide" onRequestClose={() => setProfileModalOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setProfileModalOpen(false)}>
          <Pressable style={[styles.menuSheet, { padding: 20, maxHeight: '85%' }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.profileHeaderRow}>
              <View style={styles.profileAvatarRing}>
                <MaterialCommunityIcons name={match.partnerAvatar as any} size={44} color="#c084fc" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileAlias}>{match.partnerAlias}</Text>
                <Text style={styles.profileSubline}>
                  {[match.partnerMajor, match.partnerYear].filter(Boolean).join(' · ') || 'No profile details'}
                </Text>
              </View>
            </View>

            <FlatList
              data={PERSONALITY_QUESTIONS}
              keyExtractor={(q) => q.key}
              style={{ marginTop: 16, maxHeight: 340 }}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <Text style={styles.profileSectionLabel}>Personality</Text>
              }
              renderItem={({ item, index }) => {
                const answer = match.partnerPersonality?.[index]
                return (
                  <View style={styles.profileQARow}>
                    <Text style={styles.profileQ}>{item.label}</Text>
                    <Text style={[styles.profileA, !answer && { color: '#6b7280', fontStyle: 'italic' }]}>
                      {answer || 'No answer'}
                    </Text>
                  </View>
                )
              }}
              ListFooterComponent={
                (match.partnerHobbies?.length || match.partnerActivities?.length) ? (
                  <View style={{ marginTop: 4 }}>
                    {match.partnerHobbies?.length ? (
                      <>
                        <Text style={[styles.profileSectionLabel, { marginTop: 12 }]}>Hobbies</Text>
                        <Text style={styles.profileTagList}>{match.partnerHobbies.join(' · ')}</Text>
                      </>
                    ) : null}
                    {match.partnerActivities?.length ? (
                      <>
                        <Text style={[styles.profileSectionLabel, { marginTop: 12 }]}>Activities</Text>
                        <Text style={styles.profileTagList}>{match.partnerActivities.join(' · ')}</Text>
                      </>
                    ) : null}
                  </View>
                ) : null
              }
            />

            <TouchableOpacity style={[styles.sheetCancelBtn, { marginTop: 16 }]} onPress={() => setProfileModalOpen(false)}>
              <Text style={styles.sheetCancelText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* PII send-warning. Nudge only — the user can send anyway. */}
      <Modal
        visible={piiWarning !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPiiWarning(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setPiiWarning(null)}>
          <Pressable style={[styles.menuSheet, { padding: 20 }]} onPress={(e) => e.stopPropagation()}>
            <Ionicons name="warning-outline" size={28} color="#fbbf24" style={{ alignSelf: 'center', marginBottom: 8 }} />
            <Text style={styles.sheetTitle}>Heads up</Text>
            <Text style={styles.sheetSubtitle}>
              It looks like your message includes{' '}
              {piiWarning?.hits.map((h, i) => (
                <Text key={i}>
                  {i > 0 ? ' and ' : ''}
                  <Text style={{ color: '#fbbf24', fontWeight: '700' }}>{PII_LABELS[h.kind]}</Text>
                </Text>
              ))}
              .{'\n\n'}
              For your safety, tap <Text style={{ fontWeight: '700' }}>Share Contact</Text> at the top of the chat — it only reveals what you share once your match shares the same type too.
            </Text>
            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.sheetCancelBtn} onPress={() => setPiiWarning(null)}>
                <Text style={styles.sheetCancelText}>Let me edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetPrimaryBtn, { backgroundColor: '#f59e0b' }]}
                onPress={() => piiWarning && doSend(piiWarning.message)}
              >
                <Text style={styles.sheetPrimaryText}>Send anyway</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Disintegrate blackout overlay — sits over everything, fades
          in after the messages have drifted away. Absorbs any tap so
          the user can't accidentally trigger anything mid-transition. */}
      {disintegrating && (
        <Animated.View
          pointerEvents="auto"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: '#000',
              opacity: blackoutAnim,
              justifyContent: 'center',
              alignItems: 'center',
              zIndex: 999,
            },
          ]}
        >
          <Animated.Text
            style={{
              color: '#c084fc',
              fontSize: 20,
              fontWeight: '600',
              textAlign: 'center',
              paddingHorizontal: 32,
              opacity: blackoutAnim,
            }}
          >
            They vanished into the cosmos.
          </Animated.Text>
        </Animated.View>
      )}
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
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerTypingText: {
    color: '#c084fc',
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 1,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    marginHorizontal: 16,
    marginTop: 16,
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
  messageList: {
    padding: 16,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
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
    fontSize: 22,
    color: '#fff',
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  icebreakerBox: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(192, 132, 252, 0.3)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  icebreakerText: {
    color: '#e5e7eb',
    fontSize: 14,
    lineHeight: 20,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  subtitle: {
    color: '#9ca3af',
    textAlign: 'center',
  },
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  bubbleRowTheirs: {
    justifyContent: 'flex-start',
  },
  bubble: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  bubbleMine: {
    backgroundColor: '#7c3aed',
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: 'rgba(31, 41, 55, 0.9)',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#374151',
  },
  bubbleText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
  },
  timestamp: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 3,
  },
  timestampMine: {
    textAlign: 'right',
    marginRight: 4,
  },
  timestampTheirs: {
    textAlign: 'left',
    marginLeft: 4,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(31, 41, 55, 0.5)',
    backgroundColor: 'rgba(3, 7, 18, 0.8)',
    zIndex: 10,
  },
  composerInput: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: '#fff',
    // iOS Safari force-zooms in on any input with fontSize under 16 —
    // that's what was causing the overflow/blank-margin state on this
    // specific screen: the forced zoom collided with the meta tag's
    // zoom lock (maximum-scale=1) and left the layout stuck. 16 is the
    // floor that keeps Safari from ever triggering that zoom at all.
    fontSize: 16,
    maxHeight: 100,
    marginRight: 8,
  },
  composerInputDisabled: {
    opacity: 0.5,
  },
  sendButton: {
    backgroundColor: '#9333ea',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },

  // Reveal banner (above composer)
  revealBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(168, 85, 247, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.25)',
    gap: 6,
  },
  revealBannerText: { flex: 1, color: '#e5e7eb', fontSize: 13 },
  revealBannerLabel: { color: '#9ca3af', fontSize: 12 },
  revealBannerValue: { color: '#fff', fontSize: 15, fontWeight: '600' },
  revealBannerValueLine: { color: '#fff', fontSize: 14, lineHeight: 20 },
  revealBannerValueLink: { color: '#c084fc', textDecorationLine: 'underline', fontWeight: '600' },
  revealBannerHint: { color: '#c084fc', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  revealBannerLink: { color: '#c084fc', fontSize: 12, fontWeight: '700', marginLeft: 8 },
  revealBannerMine: { color: '#9ca3af', fontSize: 12, marginTop: 3 },
  revealEditPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.4)',
  },
  revealEditPillText: { color: '#c084fc', fontSize: 11, fontWeight: '700' },

  // Mini profile modal
  profileHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  profileAvatarRing: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(168, 85, 247, 0.4)',
  },
  profileAlias: { color: '#fff', fontSize: 20, fontWeight: '700' },
  profileSubline: { color: '#9ca3af', fontSize: 13, marginTop: 4 },
  profileSectionLabel: {
    color: '#c084fc',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  profileQARow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  profileQ: { color: '#9ca3af', fontSize: 12, marginBottom: 3 },
  profileA: { color: '#e5e7eb', fontSize: 15, fontWeight: '500' },
  profileTagList: { color: '#e5e7eb', fontSize: 14, lineHeight: 20 },
  revealBannerBtn: {
    backgroundColor: '#9333ea',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  revealBannerBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // "Your current shares" rows inside the reveal modal
  mineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  mineRowEmoji: { fontSize: 20 },
  mineRowLabel: { color: '#9ca3af', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
  mineRowValue: { color: '#fff', fontSize: 15, fontWeight: '500' },
  mineRowX: { padding: 4 },

  pickerBox: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    marginBottom: 10,
    overflow: 'hidden',
  },
  picker: Platform.OS === 'web'
    ? ({ color: '#fff', height: 48, paddingHorizontal: 16, fontSize: 16, borderWidth: 0, backgroundColor: 'transparent' } as any)
    : ({ color: '#fff' } as any),

  // Menu / report / block / reveal sheets
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  menuSheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 8,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  menuItemText: { color: '#fff', fontSize: 16, fontWeight: '500' },

  sheetTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  sheetSubtitle: { color: '#9ca3af', fontSize: 13, textAlign: 'center', marginBottom: 16, lineHeight: 18 },
  sheetHelp: { color: '#6b7280', fontSize: 12, marginBottom: 8 },

  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  optionRowActive: { backgroundColor: 'rgba(168, 85, 247, 0.08)' },
  optionRowText: { color: '#e5e7eb', fontSize: 14 },

  reportInput: {
    marginTop: 12,
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    fontSize: 16,
    minHeight: 80,
    maxHeight: 160,
    textAlignVertical: 'top',
  },

  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  sheetCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#1f2937',
    alignItems: 'center',
  },
  sheetCancelText: { color: '#e5e7eb', fontWeight: '600' },
  sheetPrimaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#9333ea',
    alignItems: 'center',
  },
  sheetPrimaryText: { color: '#fff', fontWeight: '700' },

  handleTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  handleTypeChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#374151',
  },
  handleTypeChipActive: { backgroundColor: '#9333ea', borderColor: '#9333ea' },
  handleTypeText: { color: '#9ca3af', fontSize: 13, fontWeight: '600' },
})
