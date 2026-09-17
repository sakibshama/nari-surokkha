/**
 * Soft animated backdrop: two blurred colour blobs drifting slowly behind the
 * content. Pure decoration — pointer events are off and it never re-renders.
 */

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../theme';

function Blob({ color, size, top, left, drift, duration }: {
  color: string; size: number; top: number; left: number; drift: number; duration: number;
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(p);
  }, [duration, p]);
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: p.value * drift },
      { translateY: p.value * drift * 0.6 },
      { scale: 1 + p.value * 0.08 },
    ],
  }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', top, left, width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

export default function AmbientBackground() {
  const { colors, isDark } = useTheme();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Blob color={colors.accent + (isDark ? '1F' : '1A')} size={320} top={-110} left={-120} drift={30} duration={7000} />
      <Blob color={colors.danger + (isDark ? '17' : '12')} size={260} top={420} left={180} drift={-26} duration={8500} />
      <Blob color={colors.info + (isDark ? '14' : '10')} size={200} top={220} left={-90} drift={18} duration={9500} />
    </View>
  );
}
