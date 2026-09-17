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
import { spacing } from '../theme/tokens';

const SEGMENTS: Segment<ThemeMode>[] = [
  { value: 'system', label: 'System', icon: (c) => <Monitor size={15} color={c} /> },
  { value: 'light', label: 'Light', icon: (c) => <Sun size={15} color={c} /> },
  { value: 'dark', label: 'Dark', icon: (c) => <Moon size={15} color={c} /> },
];

export default function ThemeModeControl({ showCaption = true }: { showCaption?: boolean }) {
  const { mode, setMode, scheme } = useTheme();

  return (
    <View style={{ gap: spacing.sm }}>
      <SegmentedControl segments={SEGMENTS} value={mode} onChange={setMode} />
      {showCaption ? (
        <Txt variant="xs" tone="muted">
          {mode === 'system'
            ? `Following your phone — currently ${scheme}.`
            : `Always ${mode} on this device, whatever your phone is set to.`}
        </Txt>
      ) : null}
    </View>
  );
}
