/**
 * The theme control.
 *
 * Three states rather than a switch, because "follow my phone" is a real
 * preference and not the same as choosing light. A plain Dark Mode switch has
 * to pick a side on first launch, and it will pick wrong for whoever set their
 * phone the other way.
 *
 * (The screen previously showed a Dark Mode switch wired to local component
 * state. It moved, and changed nothing.)
 */

import React from 'react';
import { View } from 'react-native';
import { Monitor, Moon, Sun } from 'lucide-react-native';

import { useTheme } from '../theme';
import type { ThemeMode } from '../theme/tokens';
import { SegmentedControl, Txt, type Segment } from './ui';
import { useT } from '../i18n';
import { spacing } from '../theme/tokens';

export default function ThemeModeControl({ showCaption = true }: { showCaption?: boolean }) {
  const { mode, setMode, scheme } = useTheme();
  const t = useT();
  const segments: Segment<ThemeMode>[] = [
    { value: 'system', label: t('System'), icon: (c) => <Monitor size={15} color={c} /> },
    { value: 'light', label: t('Light'), icon: (c) => <Sun size={15} color={c} /> },
    { value: 'dark', label: t('Dark'), icon: (c) => <Moon size={15} color={c} /> },
  ];

  return (
    <View style={{ gap: spacing.sm }}>
      <SegmentedControl segments={segments} value={mode} onChange={setMode} />
      {showCaption ? (
        <Txt variant="xs" tone="muted">
          {mode === 'system'
            ? t('Following your phone — currently {scheme}.', { scheme: t(scheme === 'dark' ? 'Dark' : 'Light') })
            : t(mode === 'dark' ? 'Always dark on this device.' : 'Always light on this device.')}
        </Txt>
      ) : null}
    </View>
  );
}
