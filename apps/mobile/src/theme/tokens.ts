/**
 * Design tokens for Nari Surokkha.
 *
 * The organising idea is "calm app, loud emergency".
 *
 * The old palette painted almost every surface in emergency red. That reads as
 * urgent for about a day, and after that it reads as nothing at all — when
 * everything is red, red stops being a signal. It is also the wrong register
 * for the everyday half of this app: checking your trusted contacts or reading
 * a safety map should not feel like an alarm, least of all to someone who is
 * already anxious.
 *
 * So the palette is split:
 *
 *   - `accent` (a calm green-teal) carries all ordinary interaction — links,
 *     focus rings, primary buttons that are not the SOS.
 *   - `danger` is reserved for the emergency itself: the SOS button, an active
 *     alert, the countdown, destructive confirmation. Nothing else may use it.
 *
 * That reservation is the whole design. It is what makes the SOS button the
 * loudest thing on any screen it appears on.
 *
 * Everything here is plain data. `ThemeProvider` picks one palette at runtime;
 * screens read it through `useTheme()` and never import a palette directly.
 */

import { Platform } from 'react-native';

/** What the user chose. `system` follows the OS. */
export type ThemeMode = 'system' | 'light' | 'dark';
/** What actually gets rendered once `system` is resolved. */
export type ColorScheme = 'light' | 'dark';

export interface Palette {
  scheme: ColorScheme;

  /** App background, behind everything. */
  bg: string;
  /** Cards, sheets, headers — one step above `bg`. */
  surface: string;
  /** A nested or secondary surface: an inset row, a chip, a well. */
  surfaceAlt: string;
  /** Text input fill. */
  inputBg: string;
  /** Translucent overlay for scrims and glass. */
  scrim: string;

  border: string;
  /** For dividers that need to be seen rather than felt. */
  borderStrong: string;

  /** Primary body text. */
  text: string;
  /** Secondary text: supporting copy, list subtitles. */
  textSub: string;
  /** Tertiary text: captions, placeholders, disabled. */
  textMuted: string;
  /** Text/icons on a neutral fill. */
  onFill: string;
  /**
   * Foreground on an `accent` fill. White fails contrast on the lifted dark
   * accent (2.6:1), so dark mode puts a deep ink on the mint instead.
   */
  onAccent: string;
  /** Foreground on a `danger` fill. */
  onDanger: string;

  /** Ordinary interaction. Never an emergency. */
  accent: string;
  accentPressed: string;
  /** Tinted background for accent chips and soft buttons. */
  accentSoft: string;
  /** Accent text sitting on `accentSoft` or on `bg`. */
  accentText: string;

  /** EMERGENCY ONLY — SOS, active alert, destructive confirm. */
  danger: string;
  dangerPressed: string;
  dangerSoft: string;
  /** Red text/icon legible against `bg` (lifted in dark). */
  dangerText: string;

  warning: string;
  warningSoft: string;
  warningText: string;

  success: string;
  successSoft: string;
  successText: string;

  info: string;
  infoSoft: string;
  infoText: string;

  /** Bangladesh green, for the government identity strip only. */
  govGreen: string;
  govGreenSoft: string;
}

/**
 * Light.
 *
 * The neutral is very slightly green-biased rather than pure grey, so it sits
 * under the accent as though it were chosen for it.
 */
export const lightPalette: Palette = {
  scheme: 'light',

  bg: '#FBFCFB',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F6F4',
  inputBg: '#F4F7F5',
  scrim: 'rgba(15,26,23,0.45)',

  border: '#E1E9E5',
  borderStrong: '#CBD8D2',

  text: '#0F1A17',
  textSub: '#46574F',
  textMuted: '#5F726A',
  onFill: '#FFFFFF',
  onAccent: '#FFFFFF',
  onDanger: '#FFFFFF',

  accent: '#0E7C66',
  accentPressed: '#0A6252',
  accentSoft: '#E3F2ED',
  accentText: '#0A5E4D',

  danger: '#D51F35',
  dangerPressed: '#B4192C',
  dangerSoft: '#FDE7EA',
  dangerText: '#C41F31',

  warning: '#C77B12',
  warningSoft: '#FBF0DC',
  warningText: '#8A5A0B',

  success: '#14795C',
  successSoft: '#DFF1EA',
  successText: '#0E5C46',

  info: '#1D6FA8',
  infoSoft: '#E2EFF7',
  infoText: '#155580',

  govGreen: '#006A4E',
  govGreenSoft: '#E4F0EC',
};

/**
 * Dark.
 *
 * Not an inversion. Surfaces step *up* in lightness rather than relying on
 * shadow, because shadow barely reads on a dark ground; the accent and the
 * status hues are lifted and slightly desaturated so they stay legible without
 * glowing.
 */
export const darkPalette: Palette = {
  scheme: 'dark',

  bg: '#0B100E',
  // Lifted from #131A17: at 1.09:1 against the ground a card was invisible
  // without its border doing all the work. Dark mode gets its depth from
  // surfaces stepping up, not from shadow.
  surface: '#18211D',
  surfaceAlt: '#1F2A25',
  inputBg: '#1A231F',
  scrim: 'rgba(0,0,0,0.62)',

  border: '#2A3831',
  borderStrong: '#3A4C44',

  text: '#E6EDE9',
  textSub: '#A8B8B1',
  textMuted: '#8B9C95',
  onFill: '#FFFFFF',
  onAccent: '#04231C',
  onDanger: '#FFFFFF',

  accent: '#3FB394',
  accentPressed: '#329A7F',
  accentSoft: '#10241D',
  accentText: '#5CC9AC',

  // The SOS fill stays a true red in both themes so the button is the same
  // object to the same person at 2am; only red *text* is lifted.
  danger: '#D62F41',
  dangerPressed: '#B92535',
  dangerSoft: '#2B1418',
  dangerText: '#FF7A87',

  warning: '#D99A3C',
  warningSoft: '#2A2213',
  warningText: '#E9B15C',

  success: '#35A783',
  successSoft: '#0F241D',
  successText: '#57C3A2',

  info: '#4A9BD4',
  infoSoft: '#0F1E29',
  infoText: '#6FB4E3',

  govGreen: '#2E8B6F',
  govGreenSoft: '#102520',
};

/** 4pt scale. Every gap, pad and margin in the app comes from here. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  '2xl': 64,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  full: 9999,
} as const;

/**
 * Type scale. Sizes and weights only — colour is applied at the call site from
 * the active palette, because the same size is used on several surfaces.
 */
export const type = {
  hero: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.6, lineHeight: 40 },
  h1: { fontSize: 26, fontWeight: '700' as const, letterSpacing: -0.3, lineHeight: 32 },
  h2: { fontSize: 21, fontWeight: '700' as const, letterSpacing: -0.2, lineHeight: 27 },
  h3: { fontSize: 17, fontWeight: '600' as const, lineHeight: 23 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 23 },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const, lineHeight: 23 },
  sm: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  smStrong: { fontSize: 14, fontWeight: '600' as const, lineHeight: 20 },
  xs: { fontSize: 12, fontWeight: '400' as const, lineHeight: 17 },
  /** Uppercase section labels and field labels. */
  label: { fontSize: 11.5, fontWeight: '700' as const, letterSpacing: 0.9, lineHeight: 16 },
  /** Digits that line up — countdowns, durations. */
  mono: {
    fontSize: 16,
    fontWeight: '600' as const,
    fontVariant: ['tabular-nums'] as const,
  },
} as const;

type ShadowStyle = Record<string, unknown>;

/**
 * Elevation.
 *
 * Dark mode gets markedly weaker shadows — on a near-black ground a strong
 * shadow just smears. Depth there comes from `surface` sitting above `bg`.
 */
export function makeShadows(scheme: ColorScheme) {
  const softOpacity = scheme === 'light' ? 0.08 : 0.34;
  const cardOpacity = scheme === 'light' ? 0.1 : 0.42;

  const shadow = (
    color: string,
    opacity: number,
    radiusPx: number,
    offsetY: number,
    elevation: number,
  ): ShadowStyle =>
    Platform.select<ShadowStyle>({
      ios: {
        shadowColor: color,
        shadowOffset: { width: 0, height: offsetY },
        shadowOpacity: opacity,
        shadowRadius: radiusPx,
      },
      android: { elevation },
      web: {
        boxShadow: `0 ${offsetY}px ${radiusPx * 2}px rgba(0,0,0,${opacity})`,
      },
      default: {},
    }) ?? {};

  return {
    none: {} as ShadowStyle,
    /** Resting cards and list rows. */
    soft: shadow('#000', softOpacity, 10, 3, 3),
    /** Raised cards, sheets, headers. */
    card: shadow('#000', cardOpacity, 18, 8, 8),
    /** The SOS button, and only the SOS button. */
    danger: shadow(scheme === 'light' ? '#D51F35' : '#000', scheme === 'light' ? 0.32 : 0.5, 22, 10, 14),
    /** Primary non-emergency actions. */
    accent: shadow(scheme === 'light' ? '#0E7C66' : '#000', scheme === 'light' ? 0.24 : 0.45, 16, 6, 10),
  };
}

export type Shadows = ReturnType<typeof makeShadows>;

/**
 * Gradients derived from a palette. Used sparingly — the SOS button, the
 * auth hero, and the active-alert backdrop. Everywhere else is flat.
 */
export function makeGradients(p: Palette) {
  const dark = p.scheme === 'dark';
  return {
    /** SOS button fill. */
    danger: (dark ? ['#E04053', '#BC2637'] : ['#E03248', '#BE1B2E']) as readonly [string, string],
    /** Active-alert screen backdrop. */
    dangerBackdrop: (dark
      ? ['#1A0B0E', '#2B1014', '#3D141A']
      : ['#FFF5F6', '#FDE7EA', '#FBD5DA']) as readonly [string, string, string],
    /** Primary non-emergency action. */
    accent: (dark ? ['#4CC4A5', '#37A187'] : ['#129076', '#0A6252']) as readonly [string, string],
    /** Auth screens and the splash. */
    hero: (dark
      ? ['#0B100E', '#101B17', '#0D1A22']
      : ['#FFFFFF', '#F3F8F6', '#EAF3F5']) as readonly [string, string, string],
    /** Caution states that are not an emergency — a degraded GPS fix, say. */
    warning: (dark ? ['#E0A94F', '#B8802A'] : ['#D98B1F', '#A8650C']) as readonly [string, string],
    /** Neutral card wash, for headers that need a little lift. */
    surface: (dark ? ['#1A231F', '#131A17'] : ['#FFFFFF', '#F4F8F6']) as readonly [string, string],
  };
}

export type Gradients = ReturnType<typeof makeGradients>;

export const palettes: Record<ColorScheme, Palette> = {
  light: lightPalette,
  dark: darkPalette,
};
