/**
 * AnimatedSplash — branded opening animation built around the app logo.
 *
 * Sequence: the logo springs in with a soft glow while radiating pulse rings
 * expand behind it → a government attribution line fades in → the whole overlay
 * fades out and hands control to the app. Core Animated API, no extra deps.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { useT } from '../i18n';

const GREEN = '#00875f';  // brand marks, fixed on purpose
const ROSE = '#f43f5e';   // brand marks, fixed on purpose
const LOGO = require('../../assets/icon.png');

export default function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  // The splash is the first frame of the app, so it has to open on the same
  // ground the app will land on — otherwise a light-mode phone flashes dark
  // for a second and then snaps white.
  const { colors } = useTheme();
  const t = useT();
  const logoScale = useRef(new Animated.Value(0.4)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const captionOpacity = useRef(new Animated.Value(0)).current;
  const captionShift = useRef(new Animated.Value(14)).current;
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 55, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 450, useNativeDriver: true }),
    ]).start();

    const pulse = (ring: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(ring, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const p1 = pulse(ring1, 250);
    const p2 = pulse(ring2, 950);
    p1.start();
    p2.start();

    Animated.sequence([
      Animated.delay(600),
      Animated.parallel([
        Animated.timing(captionOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(captionShift, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start();

    const t = setTimeout(() => {
      Animated.timing(overlayOpacity, { toValue: 0, duration: 450, useNativeDriver: true }).start(() => {
        p1.stop();
        p2.stop();
        onFinish();
      });
    }, 2500);

    return () => { clearTimeout(t); p1.stop(); p2.stop(); };
  }, []);

  const ringStyle = (ring: Animated.Value, color: string) => ({
    borderColor: color,
    opacity: ring.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0, 0.4, 0] }),
    transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }],
  });

  return (
    <Animated.View style={[styles.overlay, { backgroundColor: colors.bg, opacity: overlayOpacity }]} pointerEvents="none">
      <View style={styles.center}>
        <Animated.View style={[styles.ring, ringStyle(ring1, GREEN)]} />
        <Animated.View style={[styles.ring, ringStyle(ring2, ROSE)]} />
        <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }] }}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        </Animated.View>
      </View>

      <Animated.Text style={[styles.caption, { color: colors.text, opacity: captionOpacity, transform: [{ translateY: captionShift }] }]}>
        {t('Government of Bangladesh')}
      </Animated.Text>
      <Animated.Text style={[styles.captionSub, { color: colors.textMuted, opacity: captionOpacity }]}>
        {t('National Women Safety Service')}
      </Animated.Text>
    </Animated.View>
  );
}

const LOGO_SIZE = 168;

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  center: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  ring: {
    position: 'absolute',
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 3.4,
    borderWidth: 2,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    borderRadius: LOGO_SIZE / 3.4,
  },
  caption: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  captionSub: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 5,
  },
});
