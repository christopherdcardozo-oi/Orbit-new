// Shown under "Enter the 8-digit code sent to your email" on both the
// login and signup OTP steps. Landing in spam/junk is common for a
// brand-new sending domain with no prior reputation at a given
// school's mail servers (confirmed via Resend's dashboard + DNS check
// for orbit.orghubs.com — SPF/DKIM/DMARC are all correctly configured,
// every send shows "Delivered," so the folder placement genuinely
// happens after acceptance, on the receiving side, invisible to us).
// A quick flash on mount draws the eye without being permanently
// naggy — it settles to a dimmer steady state rather than disappearing,
// since the tip stays relevant the whole time someone's waiting on a code.
import { useEffect, useRef } from 'react'
import { Animated, StyleSheet } from 'react-native'

export default function SpamHint() {
  const opacity = useRef(new Animated.Value(0.55)).current

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.4, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.55, duration: 300, useNativeDriver: true }),
    ]).start()
  }, [opacity])

  return (
    <Animated.Text style={[styles.text, { opacity }]}>
      📬 Don't see it? Check your spam/junk folder.
    </Animated.Text>
  )
}

const styles = StyleSheet.create({
  text: {
    color: '#c084fc',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
})
