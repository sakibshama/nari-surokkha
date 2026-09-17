/** Government identity strip, shared by the auth screens and Home. */

import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

import FlagRoundel from './FlagRoundel';
import { Txt } from './ui';
import { useTheme } from '../theme';
import { useT } from '../i18n';
import { radius, spacing } from '../theme/tokens';

export default function GovStrip({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const t = useT();
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm + 2,
          paddingVertical: spacing.sm,
          paddingHorizontal: spacing.md,
          backgroundColor: colors.govGreenSoft,
          borderRadius: radius.full,
          borderWidth: 1,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <FlagRoundel size={20} />
      <View style={{ flex: 1 }}>
        <Txt variant="smStrong" numberOfLines={1}>গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</Txt>
        <Txt variant="xs" tone="muted" numberOfLines={1} style={{ letterSpacing: 0.4 }}>
          {t('National Women Safety Service')}
        </Txt>
      </View>
    </View>
  );
}
