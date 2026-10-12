/** Home-screen pill: is automatic emergency detection listening right now? */

import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Ear, EarOff, ChevronRight } from 'lucide-react-native';
import { PressableScale, Txt } from './ui';
import { useTheme } from '../theme';
import { useT } from '../i18n';
import { radius, spacing } from '../theme/tokens';
import { useDetectorStatus } from '../services/emergency/hooks';
import { useDetectionSettings } from '../services/emergency/detectionSettings';
import { microphoneStream } from '../services/emergency/MicrophoneStream';

export default function DetectionStatusChip({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const t = useT();
  const status = useDetectorStatus();
  const enabled = useDetectionSettings((s) => s.enabled);

  let label: string;
  let tone: string;
  let on = false;
  if (Platform.OS === 'web') {
    label = t('Emergency detection works in the phone app');
    tone = colors.textMuted;
  } else if (!microphoneStream.isSupported()) {
    label = t('Detection needs the full app build (not Expo Go)');
    tone = colors.warning;
  } else if (!enabled) {
    label = t('Emergency detection is off');
    tone = colors.textMuted;
  } else if (status.state === 'listening') {
    label = t('Listening for shout, cry, "Help", "Bachao"');
    tone = colors.success;
    on = true;
  } else if (status.state === 'starting') {
    label = t('Starting emergency detection…');
    tone = colors.warning;
  } else if (status.state === 'paused') {
    label = status.reason === 'sos_active' ? t('Detection paused during SOS') : t('Detection paused in background');
    tone = colors.warning;
  } else if (status.state === 'error') {
    label = t('Detection unavailable — tap for details');
    tone = colors.danger;
  } else {
    label = t('Detection needs microphone permission');
    tone = colors.warning;
  }

  const Icon = on ? Ear : EarOff;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.chip, { backgroundColor: colors.surface, borderColor: tone + '55' }]}
    >
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Icon color={tone} size={16} />
      <Txt variant="sm" style={{ flex: 1, color: colors.text }} numberOfLines={1}>
        {label}
      </Txt>
      <ChevronRight color={colors.textMuted} size={16} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
