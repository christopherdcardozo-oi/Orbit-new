// A gently-pulsing dark bar you compose into skeleton layouts —
// dropped in wherever real content is about to appear. Same visual
// language everywhere: dim slate grey, subtle 0.6→0.9 opacity pulse,
// rounded corners inherited from whatever the caller sets.
//
// Web/iOS/Android identical — Animated.Value opacity is one of the
// primitives that "just works" on all three via React Native Web.
//
// Usage:
//   <Skeleton width={120} height={16} radius={4} />
//   <Skeleton style={{ width: '60%', height: 20, borderRadius: 6 }} />

import React, { useEffect, useRef } from 'react'
import { Animated, StyleProp, ViewStyle, Easing } from 'react-native'

type Props = {
  width?: number | `${number}%`
  height?: number
  radius?: number
  style?: StyleProp<ViewStyle>
}

export default function Skeleton({ width, height, radius, style }: Props) {
  const pulse = useRef(new Animated.Value(0.6)).current

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.9,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.6,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])

  return (
    <Animated.View
      style={[
        {
          backgroundColor: '#1f2937',
          opacity: pulse,
          width,
          height,
          borderRadius: radius,
        },
        style,
      ]}
    />
  )
}
