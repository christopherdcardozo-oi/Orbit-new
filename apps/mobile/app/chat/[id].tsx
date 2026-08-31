import { useEffect, useRef, useState, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import CosmicBackground from '../../components/CosmicBackground'
import { supabase } from '../../lib/supabase'

type Message = {
  id: string
  match_id: string
  sender_id: string
  content: string
  created_at: string
  read_at: string | null
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
  const flashAnim = useRef(new Animated.Value(0)).current
  const seenMessageIds = useRef(new Set<string>())

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

    let toValue = 0.3
    let duration = 1000
    if (diffHours === 0 && diffMinutes <= 10) {
      toValue = 0.9
      duration = 500
    } else if (diffHours === 0) {
      toValue = 0.6
      duration = 800
    }

    Animated.sequence([
      Animated.timing(flashAnim, {
        toValue: 1,
        duration: 500,
        easing: Easing.out(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(flashAnim, {
        toValue: 0.1,
        duration: 4500,
        easing: Easing.in(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(flashAnim, {
            toValue,
            duration,
            easing: Easing.out(Easing.ease),
            useNativeDriver: Platform.OS !== 'web',
          }),
          Animated.timing(flashAnim, {
            toValue: 0.1,
            duration,
            easing: Easing.in(Easing.ease),
            useNativeDriver: Platform.OS !== 'web',
          }),
        ])
      ).start()
    })

    const interval = setInterval(calculateTimeLeft, 30000)
    return () => clearInterval(interval)
  }, [match?.expires_at])

  const isActive = match?.status === 'active' && !expired

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
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <CosmicBackground />
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#a855f7" />
        </View>
      </SafeAreaView>
    )
  }

  if (notFound || !match) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <CosmicBackground />
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
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

      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: 'red',
            opacity: flashAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.25] }),
            pointerEvents: 'none',
          },
        ]}
      />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <MaterialCommunityIcons name={match.partnerAvatar as any} size={20} color="#c084fc" />
          <Text style={styles.headerTitle} numberOfLines={1}>{match.partnerAlias}</Text>
        </View>
        <View style={{ width: 28 }} />
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
    fontSize: 15,
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
})
