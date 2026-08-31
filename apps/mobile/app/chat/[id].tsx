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
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import CosmicBackground from '../../components/CosmicBackground'
import Skeleton from '../../components/Skeleton'
import { supabase } from '../../lib/supabase'

type Message = {
  id: string
  match_id: string
  sender_id: string
  content: string
  created_at: string
  read_at: string | null
}

type ContactReveal = {
  user_id: string
  handle_type: 'instagram' | 'snapchat' | 'phone' | 'email' | 'other'
  handle_value: string
}

const REPORT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'harassment', label: 'Harassment or threats' },
  { value: 'sexual-content', label: 'Sexual or explicit content' },
  { value: 'spam', label: 'Spam or advertising' },
  { value: 'impersonation', label: 'Impersonation / fake identity' },
  { value: 'safety', label: 'Safety concern / self-harm' },
  { value: 'other', label: 'Other' },
]

const HANDLE_TYPES: { value: ContactReveal['handle_type']; label: string; placeholder: string }[] = [
  { value: 'instagram', label: 'Instagram', placeholder: '@yourhandle' },
  { value: 'snapchat', label: 'Snapchat', placeholder: '@yoursnap' },
  { value: 'phone', label: 'Phone', placeholder: '+1 555 555 5555' },
  { value: 'email', label: 'Email', placeholder: 'you@example.com' },
  { value: 'other', label: 'Other', placeholder: 'How to reach you' },
]

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

  const [timeLeftStr, setTimeLeftStr] = useState('')
  const [expired, setExpired] = useState(false)
  // Static red urgency tint behind the chat — was an Animated.loop pulse
  // before; kept the same "gets more intense as time runs out" signal but
  // as a plain, non-animated opacity. The comet in CosmicBackground is the
  // only motion on this screen now.
  const [flashOpacity, setFlashOpacity] = useState(0)
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

  // Contact reveal — mine + partner's.
  const [myReveal, setMyReveal] = useState<ContactReveal | null>(null)
  const [partnerReveal, setPartnerReveal] = useState<ContactReveal | null>(null)
  const [revealModalOpen, setRevealModalOpen] = useState(false)
  const [revealType, setRevealType] = useState<ContactReveal['handle_type']>('instagram')
  const [revealValue, setRevealValue] = useState('')
  const [revealBusy, setRevealBusy] = useState(false)

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
        .select('display_alias, avatar')
        .eq('id', partnerId)
        .single()

      setMatch({
        id: matchRow.id,
        status: matchRow.status,
        icebreaker: matchRow.icebreaker,
        expires_at: matchRow.expires_at,
        partnerId,
        partnerAlias: partner?.display_alias ?? 'Mystery Connection',
        partnerAvatar: partner?.avatar ?? 'planet',
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

  useEffect(() => {
    if (!match?.expires_at) return

    const calculateTimeLeft = () => {
      const now = Date.now()
      const expiresAt = new Date(match.expires_at as string).getTime()
      const diffMs = expiresAt - now

      if (diffMs <= 0) {
        setExpired(true)
        setTimeLeftStr('expired')
        return { diffHours: 0, diffMinutes: 0 }
      }

      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

      if (diffHours > 0) {
        setTimeLeftStr(`${diffHours} hour${diffHours === 1 ? '' : 's'}`)
      } else if (diffMinutes > 0) {
        setTimeLeftStr(`${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`)
      } else {
        setTimeLeftStr('less than a minute')
      }

      return { diffHours, diffMinutes }
    }

    const { diffHours, diffMinutes } = calculateTimeLeft()

    // Same three urgency tiers the old pulse used for its peak brightness —
    // just held as a fixed value instead of animating toward it.
    if (diffHours === 0 && diffMinutes <= 10) {
      setFlashOpacity(0.35)
    } else if (diffHours === 0) {
      setFlashOpacity(0.22)
    } else {
      setFlashOpacity(0.1)
    }

    const interval = setInterval(calculateTimeLeft, 30000)
    return () => clearInterval(interval)
  }, [match?.expires_at])

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

  // ---------- Contact reveal: fetch existing rows on load, and keep
  // in sync via realtime so the partner's reveal appears the moment
  // they submit theirs. RLS enforces that you only see the partner's
  // row once you've also submitted your own — this fetch just returns
  // an empty array before then, no error.
  useEffect(() => {
    if (!id || !userId) return
    const load = async () => {
      const { data } = await supabase
        .from('contact_reveals')
        .select('user_id, handle_type, handle_value')
        .eq('match_id', id)
      if (data) {
        for (const r of data as ContactReveal[]) {
          if (r.user_id === userId) setMyReveal(r)
          else setPartnerReveal(r)
        }
      }
    }
    load()

    const channel = supabase
      .channel(`reveals-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contact_reveals', filter: `match_id=eq.${id}` },
        () => { load() }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id, userId])

  const submitReveal = async () => {
    if (!id || !userId) return
    const value = revealValue.trim()
    if (!value) return
    setRevealBusy(true)
    // Upsert on (match_id, user_id) so re-submitting overwrites your
    // previous choice cleanly.
    const { error } = await supabase
      .from('contact_reveals')
      .upsert(
        { match_id: id, user_id: userId, handle_type: revealType, handle_value: value },
        { onConflict: 'match_id,user_id' }
      )
    setRevealBusy(false)
    if (!error) {
      setMyReveal({ user_id: userId, handle_type: revealType, handle_value: value })
      setRevealModalOpen(false)
    }
  }

  const submitReport = async () => {
    if (!id || !userId || !match) return
    setReportBusy(true)
    setReportStatus(null)
    // reason = category (short slug); details = free text (optional).
    const { error } = await supabase.from('reports').insert({
      match_id: id,
      reporter_id: userId,
      reported_user_id: match.partnerId,
      reason: reportCategory,
      details: reportDetails.trim() || null,
    })
    setReportBusy(false)
    if (error) {
      const msg = error.code === '23505'
        ? "You've already reported this person for this match."
        : error.message
      setReportStatus({ kind: 'err', text: msg })
      return
    }
    setReportStatus({ kind: 'ok', text: 'Thanks — the report has been sent to our team.' })
    setReportDetails('')
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

  const handleSend = useCallback(async () => {
    const content = inputText.trim()
    if (!content || !userId || !id || sending || !isActive) return

    setSending(true)
    setInputText('')

    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({ match_id: id, sender_id: userId, content })
      .select('id, match_id, sender_id, content, created_at, read_at')
      .single()

    if (error) {
      console.warn('Failed to send message:', error)
      setInputText(content) // give it back so they don't lose what they typed
    } else if (inserted) {
      // Append directly rather than waiting for the realtime echo — snappier,
      // and the realtime handler's seenMessageIds guard skips the duplicate
      // when its own echo of this insert arrives a moment later.
      seenMessageIds.current.add(inserted.id)
      setMessages((prev) => [...prev, inserted])
    }

    setSending(false)
  }, [inputText, userId, id, sending, isActive])

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

      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: 'red', opacity: flashOpacity, pointerEvents: 'none' },
        ]}
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <MaterialCommunityIcons name={match.partnerAvatar as any} size={20} color="#c084fc" />
          <Text style={styles.headerTitle} numberOfLines={1}>{match.partnerAlias}</Text>
        </View>
        <TouchableOpacity style={styles.backButton} onPress={() => setMenuOpen(true)}>
          <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Expiry warning */}
      <View style={styles.warningBanner}>
        <Ionicons name="time-outline" size={20} color="#fca5a5" />
        <Text style={styles.warningText}>
          {isActive
            ? `Remember: You only have ${timeLeftStr} until this person is gone forever.`
            : 'This connection has expired. They vanished into the cosmos.'}
        </Text>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
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

        {/* Contact-reveal banner — three states:
              (1) neither has opted in → "Share your contact?" prompt
              (2) I opted in, waiting for partner → holding message
              (3) both opted in → show the partner's handle */}
        {isActive && (
          <View style={styles.revealBanner}>
            {myReveal && partnerReveal ? (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#86efac" />
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.revealBannerLabel}>
                    {match.partnerAlias}'s {partnerReveal.handle_type}:
                  </Text>
                  <Text style={styles.revealBannerValue} selectable>
                    {partnerReveal.handle_value}
                  </Text>
                </View>
              </>
            ) : myReveal ? (
              <>
                <Ionicons name="time-outline" size={18} color="#c084fc" />
                <Text style={styles.revealBannerText}>
                  Shared. Waiting for {match.partnerAlias} to share theirs.
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="share-social-outline" size={18} color="#c084fc" />
                <Text style={styles.revealBannerText}>
                  Want to keep chatting past midnight?
                </Text>
                <TouchableOpacity
                  style={styles.revealBannerBtn}
                  onPress={() => { setRevealValue(''); setRevealType('instagram'); setRevealModalOpen(true) }}
                >
                  <Text style={styles.revealBannerBtnText}>Share contact</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Composer */}
        <View style={styles.composer}>
          <TextInput
            style={[styles.composerInput, !isActive && styles.composerInputDisabled]}
            placeholder={isActive ? 'Type a message…' : 'This connection has expired'}
            placeholderTextColor="#6b7280"
            value={inputText}
            onChangeText={setInputText}
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
              <Text style={[styles.menuItemText, { color: '#fca5a5' }]}>Report {match.partnerAlias}</Text>
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
        <View style={styles.menuBackdrop}>
          <View style={[styles.menuSheet, { padding: 20 }]}>
            <Text style={styles.sheetTitle}>Report {match.partnerAlias}</Text>
            <Text style={styles.sheetSubtitle}>We'll review this — thank you for keeping Orbit safe.</Text>
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
                {reportBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetPrimaryText}>Send Report</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Block confirmation */}
      <Modal visible={blockConfirmOpen} transparent animationType="fade" onRequestClose={() => setBlockConfirmOpen(false)}>
        <View style={styles.menuBackdrop}>
          <View style={[styles.menuSheet, { padding: 20 }]}>
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
          </View>
        </View>
      </Modal>

      {/* Contact-reveal modal */}
      <Modal visible={revealModalOpen} transparent animationType="slide" onRequestClose={() => setRevealModalOpen(false)}>
        <View style={styles.menuBackdrop}>
          <View style={[styles.menuSheet, { padding: 20 }]}>
            <Text style={styles.sheetTitle}>Share your contact</Text>
            <Text style={styles.sheetSubtitle}>
              Only shown to {match.partnerAlias} once they share theirs too. You can update or take back the share any time.
            </Text>
            <View style={styles.handleTypeRow}>
              {HANDLE_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.handleTypeChip, revealType === t.value && styles.handleTypeChipActive]}
                  onPress={() => setRevealType(t.value)}
                >
                  <Text style={[styles.handleTypeText, revealType === t.value && { color: '#fff' }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.reportInput}
              placeholder={HANDLE_TYPES.find(t => t.value === revealType)?.placeholder}
              placeholderTextColor="#6b7280"
              value={revealValue}
              onChangeText={setRevealValue}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={revealType === 'phone' ? 'phone-pad' : revealType === 'email' ? 'email-address' : 'default'}
              maxLength={200}
            />
            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.sheetCancelBtn} onPress={() => setRevealModalOpen(false)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetPrimaryBtn, (revealBusy || !revealValue.trim()) && { opacity: 0.5 }]}
                onPress={submitReveal}
                disabled={revealBusy || !revealValue.trim()}
              >
                {revealBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetPrimaryText}>Share</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  revealBannerBtn: {
    backgroundColor: '#9333ea',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  revealBannerBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

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
