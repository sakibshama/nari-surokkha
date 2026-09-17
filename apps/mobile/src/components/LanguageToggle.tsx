/**
 * English ⇄ বাংলা toggle.
 *
 * A compact pill with a sliding thumb. Used in headers, on the auth screens
 * and in Settings, so the language can be changed before signing in.
 */

import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useTheme } from '../theme';
import { useLanguage, useT, type Language } from '../i18n';

const OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'bn', label: 'বাং' },
];

export default function LanguageToggle({
  style,
  size = 'sm',
}: {
  style?: StyleProp<ViewStyle>;
  /** `sm` for headers, `md` for Settings. */
  size?: 'sm' | 'md';
}) {
  const { colors } = useTheme();
  const { lang, setLang } = useLanguage();
  const t = useT();
  const [segmentWidth, setSegmentWidth] = useState(0);
  const x = useSharedValue(0);

  const height = size === 'sm' ? 40 : 46;
  const pad = 4;

  useEffect(() => {
    x.value = withSpring(lang === 'en' ? 0 : segmentWidth, { damping: 18, stiffness: 220 });
  }, [lang, segmentWidth, x]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  const onLayout = (e: LayoutChangeEvent) => {
    setSegmentWidth((e.nativeEvent.layout.width - pad * 2) / OPTIONS.length);
  };

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('Language')}
      onLayout={onLayout}
      style={[
        {
          flexDirection: 'row',
          height,
          minWidth: size === 'sm' ? 92 : 150,
          padding: pad,
          borderRadius: height / 2,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      {segmentWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: pad,
              left: pad,
              width: segmentWidth,
              height: height - pad * 2 - 2,
              borderRadius: height / 2,
              backgroundColor: colors.accent,
            },
            thumb,
          ]}
        />
      )}
      {OPTIONS.map((o) => {
        const active = o.value === lang;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={o.value === 'en' ? 'English' : 'বাংলা'}
            onPress={() => setLang(o.value)}
            hitSlop={4}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text
              style={{
                fontSize: size === 'sm' ? 13 : 15,
                fontWeight: '700',
                color: active ? colors.onAccent : colors.textSub,
              }}
            >
              {size === 'md' ? (o.value === 'en' ? 'English' : 'বাংলা') : o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
