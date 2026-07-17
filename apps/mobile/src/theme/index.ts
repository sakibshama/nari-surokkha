// Centralized design system for Nari Surokkha mobile app
import { Platform } from 'react-native';

export const colors = {
  // Backgrounds
  bg: '#0a0f1e',           // Deepest dark navy
  bgCard: '#111827',       // Card background
  bgCardAlt: '#1a2235',    // Slightly lighter card
  bgInput: '#0d1526',      // Input background

  // Borders & Separators
  border: 'rgba(255,255,255,0.08)',
  borderAccent: 'rgba(239,68,68,0.4)',

  // Primary Brand
  primary: '#ef4444',
  primaryLight: '#f87171',
  primaryDark: '#b91c1c',
  primaryGradient: ['#f43f5e', '#dc2626'] as const,

  // Accent Colors
  blue: '#3b82f6',
  purple: '#8b5cf6',
  green: '#10b981',
  amber: '#f59e0b',
  cyan: '#06b6d4',
  pink: '#ec4899',

  // Text
  text: '#f1f5f9',
  textSub: '#94a3b8',
  textMuted: '#64748b',

  // States
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#3b82f6',

  // Glassmorphism (using pure rgba - no BlurView needed)
  glass: 'rgba(255,255,255,0.05)',
  glassBorder: 'rgba(255,255,255,0.10)',
  glassDark: 'rgba(0,0,0,0.3)',

  // Aliases used by some screens
  red: '#ef4444',
  surface: '#111827',
};

export const gradients = {
  primary: ['#f43f5e', '#dc2626'] as const,
  blue: ['#2563eb', '#1d4ed8'] as const,
  green: ['#059669', '#10b981'] as const,
  dark: ['#1e293b', '#0f172a'] as const,
  darkRed: ['#1a0000', '#7f1d1d', '#dc2626'] as const,
  card: ['#1a2235', '#111827'] as const,
  amber: ['#d97706', '#f59e0b'] as const,
};

export const shadows = {
  primary: Platform.select({
    ios: { shadowColor: '#ef4444', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 16 },
    android: { elevation: 16 },
    web: { boxShadow: '0 8px 32px rgba(239,68,68,0.45)' },
  }) || {},
  blue: Platform.select({
    ios: { shadowColor: '#3b82f6', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 14 },
    android: { elevation: 12 },
    web: { boxShadow: '0 6px 24px rgba(59,130,246,0.4)' },
  }) || {},
  card: Platform.select({
    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12 },
    android: { elevation: 8 },
    web: { boxShadow: '0 4px 24px rgba(0,0,0,0.35)' },
  }) || {},
  none: {},
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  full: 9999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  '2xl': 64,
};

export const font = {
  hero: { fontSize: 36, fontWeight: 'bold' as const, color: colors.text, letterSpacing: -0.5 },
  h1:   { fontSize: 28, fontWeight: 'bold' as const, color: colors.text },
  h2:   { fontSize: 22, fontWeight: '700' as const, color: colors.text },
  h3:   { fontSize: 18, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 16, fontWeight: '400' as const, color: colors.text },
  sm:   { fontSize: 14, fontWeight: '400' as const, color: colors.textSub },
  xs:   { fontSize: 12, fontWeight: '400' as const, color: colors.textMuted },
  label:{ fontSize: 13, fontWeight: '600' as const, color: colors.textSub, letterSpacing: 0.5 },
  // Font-family aliases used as `fontFamily: font.medium` etc. (default system faces)
  regular: 'System',
  medium: 'System',
  semiBold: 'System',
  bold: 'System',
};

// Backward-compat aliases (used by older screens)
export const typography = {
  h1: font.h1,
  h2: font.h2,
  h3: font.h3,
  body: font.body,
  caption: font.sm,
};
