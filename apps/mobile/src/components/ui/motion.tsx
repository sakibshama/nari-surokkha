/**
 * Motion primitives.
 *
 * Small, reusable animations so every screen moves the same way:
 *
 *   <FadeIn delay={80}>…</FadeIn>            entrance: fade + rise
 *   <PressableScale onPress={…}>…</PressableScale>   springy press feedback
 *   <PulseRings color={…} size={…} />        the SOS "heartbeat"
 *   <Shimmer width={…} height={…} />         loading placeholder
 *
 * Built on react-native-reanimated (already a dependency), so the animations
 * run on the UI thread and never block a tap on the SOS button.
 */

import React, { useEffect } from 'react';
import { Pressable, PressableProps, StyleProp, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  FadeInUp,
  ZoomIn,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../../theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/* ─────────────────────────────────────────────────────────── FadeIn ──── */

export function FadeIn({
  children,
  delay = 0,
  from = 'down',
  style,
}: {
  children: React.ReactNode;
  /** Milliseconds before this element starts. Use `index * 60` to stagger. */
  delay?: number;
  /** `down` rises into place, `up` drops into place, `zoom` scales in. */
  from?: 'down' | 'up' | 'zoom';
  style?: StyleProp<ViewStyle>;
}) {
  const entering =
    from === 'zoom'
      ? ZoomIn.delay(delay).duration(380)
      : (from === 'up' ? FadeInUp : FadeInDown).delay(delay).duration(420).easing(Easing.out(Easing.cubic));
  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}

/* ─────────────────────────────────────────────────── PressableScale ──── */

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far to shrink while pressed. Default 0.96. */
  scaleTo?: number;
}

/** A Pressable that springs down while held — tactile without a library. */
export function PressableScale({
  children,
  style,
  scaleTo = 0.96,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        scale.value = withSpring(scaleTo, { damping: 18, stiffness: 320 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, { damping: 14, stiffness: 260 });
        onPressOut?.(e);
      }}
      style={[style, animated, disabled ? { opacity: 0.55 } : null]}
    >
      {children}
    </AnimatedPressable>
  );
}

/* ─────────────────────────────────────────────────────── PulseRings ──── */

function Ring({ color, size, delay, duration }: { color: string; size: number; delay: number; duration: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1, false),
    );
    return () => cancelAnimation(progress);
  }, [delay, duration, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.15, 1], [0, 0.55, 0]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.78, 1.45]) }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color,
          backgroundColor: color + '14',
        },
        style,
      ]}
    />
  );
}

/** Expanding rings behind the SOS button. */
export function PulseRings({
  color,
  size,
  count = 3,
  duration = 2400,
}: {
  color: string;
  size: number;
  count?: number;
  duration?: number;
}) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: count }).map((_, i) => (
        <Ring key={i} color={color} size={size} delay={(duration / count) * i} duration={duration} />
      ))}
    </View>
  );
}

/* ─────────────────────────────────────────────────────── Breathing ──── */

/** Gently scales its child up and down — for a live status dot or icon. */
export function Breathing({
  children,
  min = 0.92,
  max = 1.06,
  duration = 1400,
  style,
}: {
  children: React.ReactNode;
  min?: number;
  max?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useSharedValue(min);
  useEffect(() => {
    s.value = withRepeat(
      withSequence(
        withTiming(max, { duration, easing: Easing.inOut(Easing.sin) }),
        withTiming(min, { duration, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(s);
  }, [duration, max, min, s]);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/* ────────────────────────────────────────────────────────── Shimmer ──── */

/** A soft pulsing block used as a loading placeholder. */
export function Shimmer({
  width,
  height,
  radius = 12,
  style,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const o = useSharedValue(0.45);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 850, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(o);
  }, [o]);
  const animated = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      style={[{ width, height, borderRadius: radius, backgroundColor: colors.surfaceAlt }, animated, style]}
    />
  );
}
