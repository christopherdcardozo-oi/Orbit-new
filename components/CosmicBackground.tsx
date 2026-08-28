import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Dimensions, Easing } from 'react-native';

const { width, height } = Dimensions.get('window');
const STAR_COUNT = 75;

export default function CosmicBackground() {
  const [stars] = useState(() => {
    return Array.from({ length: STAR_COUNT }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + 1,
      opacity: Math.random() * 0.7 + 0.3,
    }));
  });

  const cometY = useRef(new Animated.Value(-200)).current;
  const cometX = useRef(new Animated.Value(width + 200)).current;
  const cometOpacity = useRef(new Animated.Value(0)).current;
  const [cometVisible, setCometVisible] = useState(false);
  const [cometAngle, setCometAngle] = useState('210deg');

  useEffect(() => {
    const triggerComet = () => {
      // Pick a random edge to start from
      const side = Math.floor(Math.random() * 3);
      let startX = 0, startY = 0, endX = 0, endY = 0;

      if (side === 0) {
        // Top right to bottom left
        startX = width + 100;
        startY = Math.random() * (height * 0.5);
        endX = -200;
        endY = startY + height * 0.5 + Math.random() * 300;
      } else if (side === 1) {
        // Top left to bottom right
        startX = -100;
        startY = Math.random() * (height * 0.5);
        endX = width + 200;
        endY = startY + height * 0.5 + Math.random() * 300;
      } else {
        // Left to right across the middle
        startX = -100;
        startY = height * 0.3 + Math.random() * (height * 0.4);
        endX = width + 200;
        endY = startY + (Math.random() > 0.5 ? 200 : -200);
      }

      // Calculate angle in degrees
      // Note: the comet is drawn horizontally (tail on left, head on right).
      // So atan2 gives the angle to point the head towards (endX, endY).
      const dy = endY - startY;
      const dx = endX - startX;
      let angle = Math.atan2(dy, dx) * (180 / Math.PI);
      
      // Since the tail is on the left, an angle of 0 means flying right.
      setCometAngle(`${angle}deg`);
      
      cometX.setValue(startX);
      cometY.setValue(startY);
      cometOpacity.setValue(1);
      setCometVisible(true);

      Animated.parallel([
        Animated.timing(cometX, {
          toValue: endX,
          duration: 1800 + Math.random() * 1000,
          easing: Easing.bezier(0.25, 0.1, 0.25, 1),
          useNativeDriver: true,
        }),
        Animated.timing(cometY, {
          toValue: endY,
          duration: 1800 + Math.random() * 1000,
          easing: Easing.bezier(0.25, 0.1, 0.25, 1),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(cometOpacity, {
            toValue: 1,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.delay(1200),
          Animated.timing(cometOpacity, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => {
        setCometVisible(false);
        setTimeout(triggerComet, Math.random() * 8000 + 3000);
      });
    };

    const timeout = setTimeout(triggerComet, 2000);
    return () => clearTimeout(timeout);
  }, [cometX, cometY, cometOpacity]);

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <View style={[styles.gradientBubble, styles.purpleBubble]} />
      <View style={[styles.gradientBubble, styles.indigoBubble]} />

      {stars.map((star, i) => (
        <View
          key={i}
          style={[
            styles.star,
            {
              left: star.x,
              top: star.y,
              width: star.size,
              height: star.size,
              borderRadius: star.size / 2,
              opacity: star.opacity,
            },
          ]}
        />
      ))}

      {cometVisible && (
        <Animated.View
          style={[
            styles.cometContainer,
            {
              transform: [{ translateX: cometX }, { translateY: cometY }, { rotate: cometAngle }],
              opacity: cometOpacity,
            },
          ]}
        >
          {/* Tail first (left side), Head second (right side) so it points in the direction of travel */}
          <View style={styles.cometTail} />
          <View style={styles.cometHead} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  gradientBubble: {
    position: 'absolute',
    width: '150%',
    height: '100%',
    borderRadius: 9999,
    opacity: 0.15,
  },
  purpleBubble: {
    top: '-30%',
    left: '-20%',
    backgroundColor: '#a855f7',
  },
  indigoBubble: {
    bottom: '-30%',
    right: '-20%',
    backgroundColor: '#4f46e5',
  },
  star: {
    position: 'absolute',
    backgroundColor: '#ffffff',
  },
  cometContainer: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#ffffff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
  },
  cometHead: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#ffffff',
  },
  cometTail: {
    width: 45,
    height: 1,
    backgroundColor: '#ffffff',
    opacity: 0.8,
  },
});
