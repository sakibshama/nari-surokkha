/**
 * One-tap light/dark toggle for headers.
 *
 * The sun and moon cross-fade and rotate into each other, so the switch feels
 * physical. The full three-way control (System / Light / Dark) stays in
 * Settings; this is the shortcut.
 */

import React, { useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Moon, Sun } from 'lucide-react-native';

import { useTheme } from '../theme';
import { useT } from '../i18n';
import { PressableScale } from './ui/motion';

export default function ThemeToggle({ size = 40, style }: { size?: number; style?: StyleProp<ViewStyle> }) {
  const { colors, isDark, toggle } = useTheme();
  const t = useT();
  const progress = useSharedValue(isDark ? 1 : 0);

  useEffect(() => {
    progress.value = withSpring(isDark ? 1 : 0, { damping: 15, stiffness: 140 });
  }, [isDark, progress]);

  const sunStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    opacity: interpolate(progress.value, [0, 0.5], [1, 0], 'clamp'),
    transform: [
      { rotate: `${interpolate(progress.value, [0, 1], [0, 90])}deg` },
      { scale: interpolate(progress.value, [0, 1], [1, 0.4]) },
    ],
  }));
  const moonStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    opacity: interpolate(progress.value, [0.5, 1], [0, 1], 'clamp'),
    transform: [
      { rotate: `${interpolate(progress.value, [0, 1], [-90, 0])}deg` },
      { scale: interpolate(progress.value, [0, 1], [0.4, 1]) },
    ],
  }));

  return (
    <PressableScale
      accessibilityRole="switch"
      accessibilityState={{ checked: isDark }}
      accessibilityLabel={isDark ? t('Switch to light mode') : t('Switch to dark mode')}
      onPress={toggle}
      hitSlop={6}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <Animated.View style={sunStyle}>
        <Sun size={size * 0.47} color={colors.warning} />
      </Animated.View>
      <Animated.View style={moonStyle}>
        <Moon size={size * 0.45} color={colors.accentText} />
      </Animated.View>
    </PressableScale>
  );
}
