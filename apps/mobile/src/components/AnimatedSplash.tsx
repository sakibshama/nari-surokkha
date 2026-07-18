/**
 * AnimatedSplash — branded opening animation.
 *
 * Sequence: flag roundel springs in with radiating pulse rings →
 * নারী সুরক্ষা title + tagline rise in → whole overlay fades out.
 * Built on the core Animated API (no extra deps; works on native + web).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, font } from '../theme';

const GREEN = '#006a4e';
const GREEN_LIGHT = '#00875f';
const RED = '#f42a41';

export default function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const emblemScale = useRef(new Animated.Value(0.3)).current;
  const emblemOpacity = useRef(new Animated.Value(0)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleShift = useRef(new Animated.Value(16)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Emblem entrance
    Animated.parallel([
      Animated.spring(emblemScale, { toValue: 1, friction: 5, tension: 60, useNativeDriver: true }),
      Animated.timing(emblemOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();

    // Radiating pulse rings (staggered loop)
    const pulse = (ring: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(ring, { toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const p1 = pulse(ring1, 200);
    const p2 = pulse(ring2, 800);
    p1.start();
    p2.start();

    // Title + tagline
    Animated.sequence([
      Animated.delay(450),
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
        Animated.timing(titleShift, { toValue: 0, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.timing(taglineOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();

    // Fade the whole overlay out, then hand over to the app
    const t = setTimeout(() => {
      Animated.timing(overlayOpacity, { toValue: 0, duration: 450, useNativeDriver: true }).start(() => {
        p1.stop();
        p2.stop();
        onFinish();
      });
    }, 2300);

    return () => { clearTimeout(t); p1.stop(); p2.stop(); };
  }, []);

  const ringStyle = (ring: Animated.Value) => ({
    opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.45, 0] }),
    transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
  });

  return (
    <Animated.View style={[styles.overlay, { opacity: overlayOpacity }]} pointerEvents="none">
      <View style={styles.center}>
        {/* Pulse rings */}
        <Animated.View style={[styles.ring, { borderColor: GREEN_LIGHT }, ringStyle(ring1)]} />
        <Animated.View style={[styles.ring, { borderColor: RED }, ringStyle(ring2)]} />

        {/* Flag roundel emblem */}
        <Animated.View style={[styles.emblem, { opacity: emblemOpacity, transform: [{ scale: emblemScale }] }]}>
          <View style={styles.redDisc} />
        </Animated.View>
      </View>

      <Animated.Text style={[styles.title, { opacity: titleOpacity, transform: [{ translateY: titleShift }] }]}>
        নারী সুরক্ষা
      </Animated.Text>
      <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
        Nari Surokkha — Your Safety Companion
      </Animated.Text>
      <Animated.Text style={[styles.gov, { opacity: taglineOpacity }]}>
        জাতীয় নারী নিরাপত্তা সেবা
      </Animated.Text>
    </Animated.View>
  );
}

const EMBLEM = 108;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  center: {
    width: EMBLEM,
    height: EMBLEM,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  ring: {
    position: 'absolute',
    width: EMBLEM,
    height: EMBLEM,
    borderRadius: EMBLEM / 3.6,
    borderWidth: 2,
  },
  emblem: {
    width: EMBLEM,
    height: EMBLEM,
    borderRadius: EMBLEM / 3.6,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GREEN_LIGHT,
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  redDisc: {
    width: EMBLEM * 0.46,
    height: EMBLEM * 0.46,
    borderRadius: EMBLEM * 0.23,
    backgroundColor: RED,
    // Slightly left of center, like the national flag
    marginRight: EMBLEM * 0.08,
  },
  title: {
    color: '#ffffff',
    fontSize: 40,
    fontFamily: font.bold,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tagline: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    fontFamily: font.medium,
    marginTop: 10,
  },
  gov: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    fontFamily: font.medium,
    marginTop: 6,
  },
});
