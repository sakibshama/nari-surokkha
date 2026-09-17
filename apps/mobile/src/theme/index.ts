/**
 * Theme entry point.
 *
 * New code should use the runtime theme:
 *
 *   import { useTheme, useThemedStyles, Theme } from '../../theme';
 *
 * The static `colors` / `font` / `gradients` / `shadows` exports below are the
 * pre-theming API. They are kept so that any screen not yet migrated still
 * compiles and renders — but they are frozen to the dark palette and cannot
 * respond to the toggle. Treat a remaining import of them as a to-do.
 */

export * from './tokens';
export {
  ThemeProvider,
  useTheme,
  useThemedStyles,
  useColors,
  type Theme,
} from './ThemeProvider';

import {
  darkPalette,
  makeGradients,
  makeShadows,
  radius as radiusScale,
  spacing as spacingScale,
  type as typeScale,
} from './tokens';

export const spacing = spacingScale;
export const radius = radiusScale;

const legacyShadows = makeShadows('dark');
const legacyGradients = makeGradients(darkPalette);

/**
 * @deprecated Frozen to the dark palette — will not follow the theme toggle.
 * Use `const { colors } = useTheme()` instead.
 */
export const colors = {
  bg: darkPalette.bg,
  bgCard: darkPalette.surface,
  bgCardAlt: darkPalette.surfaceAlt,
  bgInput: darkPalette.inputBg,

  border: darkPalette.border,
  borderAccent: darkPalette.accent,

  primary: darkPalette.danger,
  primaryLight: darkPalette.dangerText,
  primaryDark: darkPalette.dangerPressed,
  primaryGradient: legacyGradients.danger,

  blue: darkPalette.info,
  purple: '#8b5cf6',
  green: darkPalette.success,
  amber: darkPalette.warning,
  cyan: '#06b6d4',
  pink: '#ec4899',

  text: darkPalette.text,
  textSub: darkPalette.textSub,
  textMuted: darkPalette.textMuted,

  success: darkPalette.success,
  warning: darkPalette.warning,
  danger: darkPalette.danger,
  info: darkPalette.info,

  glass: 'rgba(255,255,255,0.05)',
  glassBorder: darkPalette.border,
  glassDark: 'rgba(0,0,0,0.3)',

  red: darkPalette.danger,
  surface: darkPalette.surface,
};

/** @deprecated Use `const { gradients } = useTheme()`. */
export const gradients = {
  primary: legacyGradients.danger,
  blue: ['#2563eb', '#1d4ed8'] as const,
  green: legacyGradients.accent,
  dark: ['#1e293b', '#0f172a'] as const,
  darkRed: legacyGradients.dangerBackdrop,
  card: legacyGradients.surface,
  amber: ['#d97706', '#f59e0b'] as const,
};

/** @deprecated Use `const { shadows } = useTheme()`. */
export const shadows = {
  primary: legacyShadows.danger,
  blue: legacyShadows.accent,
  card: legacyShadows.card,
  none: legacyShadows.none,
};

/** @deprecated Use `type` from tokens plus a colour from `useTheme()`. */
export const font = {
  hero: { ...typeScale.hero, color: darkPalette.text },
  h1: { ...typeScale.h1, color: darkPalette.text },
  h2: { ...typeScale.h2, color: darkPalette.text },
  h3: { ...typeScale.h3, color: darkPalette.text },
  body: { ...typeScale.body, color: darkPalette.text },
  sm: { ...typeScale.sm, color: darkPalette.textSub },
  xs: { ...typeScale.xs, color: darkPalette.textMuted },
  label: { ...typeScale.label, color: darkPalette.textSub },
  regular: 'System',
  medium: 'System',
  semiBold: 'System',
  bold: 'System',
};

/** @deprecated */
export const typography = {
  h1: font.h1,
  h2: font.h2,
  h3: font.h3,
  body: font.body,
  caption: font.sm,
};
