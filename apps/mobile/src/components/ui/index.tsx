/**
 * Themed UI primitives.
 *
 * Every screen previously styled its own cards, buttons and inputs from
 * scratch, which is why no two of them agreed on a corner radius or a label
 * size. These are the shared pieces; a screen should reach for one of these
 * before writing a new `StyleSheet` entry.
 *
 * All of them read the palette at render time, so they follow the theme
 * toggle without any work at the call site.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';

import { Theme, useTheme, useThemedStyles } from '../../theme';
import { radius, spacing, type as typeScale } from '../../theme/tokens';
import { useLanguageStore } from '../../i18n';
import { FadeIn, PressableScale } from './motion';
import { KeyboardAwareScrollView, useKeyboardAwareInput } from './keyboard';

export * from './motion';
export * from './keyboard';

/** Bangla glyphs sit taller than Latin ones; give them a little more room. */
function useScriptLineHeight(style: TextStyle): TextStyle {
  const isBangla = useLanguageStore((st) => st.lang === 'bn');
  if (!isBangla || !style.lineHeight) return style;
  return { ...style, lineHeight: Math.round(style.lineHeight * 1.18) };
}

/* ────────────────────────────────────────────────────────────── Screen ── */

interface ScreenProps {
  children: React.ReactNode;
  /** Wrap the content in a ScrollView. Default true. */
  scroll?: boolean;
  /** Pad the content horizontally. Default true. */
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Respect the bottom safe area. Off for screens with their own footer. */
  edgeToEdge?: boolean;
}

/** App background + safe area. The one place `colors.bg` should be applied. */
export function Screen({
  children,
  scroll = true,
  padded = true,
  style,
  contentStyle,
  edgeToEdge = false,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const inner: StyleProp<ViewStyle> = [
    padded && { paddingHorizontal: spacing.md },
    { paddingBottom: edgeToEdge ? 0 : insets.bottom + spacing.lg },
    contentStyle,
  ];

  if (!scroll) {
    return (
      <View style={[{ flex: 1, backgroundColor: colors.bg }, style]}>
        <View style={[{ flex: 1 }, inner]}>{children}</View>
      </View>
    );
  }

  // Keyboard-aware: the focused input is scrolled above the software keyboard
  // (see ./keyboard — adjustResize does nothing under Android edge-to-edge).
  return (
    <KeyboardAwareScrollView
      containerStyle={{ backgroundColor: colors.bg }}
      style={[{ flex: 1, backgroundColor: colors.bg }, style]}
      contentContainerStyle={[{ flexGrow: 1 }, inner]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

/* ────────────────────────────────────────────────────────────── Text ──── */

type TextTone = 'default' | 'sub' | 'muted' | 'accent' | 'danger' | 'success' | 'warning';
type TextVariant = keyof typeof typeScale;

interface TxtProps {
  children: React.ReactNode;
  variant?: TextVariant;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  center?: boolean;
}

/** Text that takes its size from the scale and its colour from the palette. */
export function Txt({
  children,
  variant = 'body',
  tone = 'default',
  style,
  numberOfLines,
  center,
}: TxtProps) {
  const { colors } = useTheme();
  const scaled = useScriptLineHeight(typeScale[variant] as TextStyle);
  const toneColor: Record<TextTone, string> = {
    default: colors.text,
    sub: colors.textSub,
    muted: colors.textMuted,
    accent: colors.accentText,
    danger: colors.dangerText,
    success: colors.successText,
    warning: colors.warningText,
  };
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        scaled,
        { color: toneColor[tone] },
        center && { textAlign: 'center' },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Uppercase section heading that separates groups of rows. */
export function SectionLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return (
    <View style={[{ marginTop: spacing.lg, marginBottom: spacing.sm }, style]}>
      <Text
        style={[
          typeScale.label as TextStyle,
          { color: colors.textMuted, textTransform: 'uppercase' },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

/* ────────────────────────────────────────────────────────────── Card ──── */

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** `flat` sits on the background; `raised` lifts off it. */
  elevation?: 'flat' | 'soft' | 'raised';
  padded?: boolean;
  /** Tint the card for a status: a soft background and matching border. */
  tone?: 'neutral' | 'accent' | 'danger' | 'warning' | 'success' | 'info';
  /** Animate the card in after this many ms. Omit for no entrance. */
  delay?: number;
}

export function Card({
  children,
  style,
  elevation = 'soft',
  padded = true,
  tone = 'neutral',
  delay,
}: CardProps) {
  const { colors, shadows } = useTheme();

  const toneStyles: Record<NonNullable<CardProps['tone']>, ViewStyle> = {
    neutral: { backgroundColor: colors.surface, borderColor: colors.border },
    accent: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    danger: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
    warning: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
    success: { backgroundColor: colors.successSoft, borderColor: colors.success },
    info: { backgroundColor: colors.infoSoft, borderColor: colors.info },
  };

  const card = (
    <View
      style={[
        {
          borderRadius: radius.xl - 6,
          borderWidth: 1,
          padding: padded ? spacing.md : 0,
          overflow: 'hidden',
        },
        toneStyles[tone],
        elevation === 'soft' && shadows.soft,
        elevation === 'raised' && shadows.card,
        style,
      ]}
    >
      {children}
    </View>
  );

  return delay === undefined ? card : <FadeIn delay={delay}>{card}</FadeIn>;
}

/* ──────────────────────────────────────────────────────────── Button ──── */

export type ButtonVariant = 'primary' | 'danger' | 'subtle' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** Rendered before the label. Pass a lucide icon element. */
  icon?: React.ReactNode;
  /** Rendered after the label. */
  iconRight?: React.ReactNode;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Override the label/spinner colour. For a destructive `subtle` button. */
  labelColor?: string;
}

const SIZE: Record<ButtonSize, { padV: number; padH: number; text: TextStyle; gap: number }> = {
  sm: { padV: 9, padH: spacing.md, text: typeScale.smStrong as TextStyle, gap: 6 },
  md: { padV: 13, padH: spacing.lg, text: typeScale.bodyStrong as TextStyle, gap: 8 },
  lg: { padV: 17, padH: spacing.lg, text: { ...typeScale.h3, fontWeight: '700' } as TextStyle, gap: 10 },
};

/**
 * `danger` is for the emergency path only — the SOS itself and destructive
 * confirmation. Ordinary primary actions are `primary`.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconRight,
  full = true,
  style,
  labelColor,
  ...rest
}: ButtonProps) {
  const { colors, shadows, gradients } = useTheme();
  const dims = SIZE[size];
  const isDisabled = disabled || loading;

  const base: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: dims.gap,
    paddingVertical: dims.padV,
    paddingHorizontal: dims.padH,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'transparent',
    alignSelf: full ? 'stretch' : 'flex-start',
    minHeight: 44, // touch target floor
  };

  const fills: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: colors.accent },
    danger: { backgroundColor: colors.danger },
    subtle: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
    outline: { backgroundColor: 'transparent', borderColor: colors.borderStrong },
    ghost: { backgroundColor: 'transparent' },
  };

  const defaultLabelColors: Record<ButtonVariant, string> = {
    primary: colors.onAccent,
    danger: colors.onDanger,
    subtle: colors.text,
    outline: colors.text,
    ghost: colors.accentText,
  };
  const labelColors = labelColor
    ? ({ ...defaultLabelColors, [variant]: labelColor } as Record<ButtonVariant, string>)
    : defaultLabelColors;

  const elevation =
    variant === 'danger' ? shadows.danger : variant === 'primary' ? shadows.accent : undefined;

  const content = (
    <>
      {loading ? (
        <ActivityIndicator color={labelColors[variant]} size="small" />
      ) : (
        <>
          {icon}
          <Text style={[dims.text, { color: labelColors[variant] }]}>{label}</Text>
          {iconRight}
        </>
      )}
    </>
  );

  // Gradient fills read as more considered on the two loudest buttons; the
  // quieter variants stay flat so they recede.
  const useGradient = variant === 'primary' || variant === 'danger';

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      scaleTo={0.97}
      style={[
        { borderRadius: radius.lg, alignSelf: full ? 'stretch' : 'flex-start' },
        !isDisabled && elevation,
        style,
      ]}
      {...rest}
    >
      {useGradient ? (
        <LinearGradient
          colors={variant === 'danger' ? gradients.danger : gradients.accent}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[base, { backgroundColor: undefined }]}
        >
          {content}
        </LinearGradient>
      ) : (
        <View style={[base, fills[variant]]}>{content}</View>
      )}
    </PressableScale>
  );
}

/* ───────────────────────────────────────────────────────────── Field ──── */

interface FieldProps extends TextInputProps {
  label?: string;
  icon?: (color: string) => React.ReactNode;
  /** Shown below the field in danger tone. */
  error?: string;
  /** Shown below the field in muted tone when there is no error. */
  hint?: string;
  containerStyle?: StyleProp<ViewStyle>;
  /** Rendered at the right edge — a reveal-password toggle, for instance. */
  trailing?: React.ReactNode;
}

/** Labelled text input with a visible focus state. */
export function Field({
  label,
  icon,
  error,
  hint,
  containerStyle,
  trailing,
  ...inputProps
}: FieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const keyboardAware = useKeyboardAwareInput();

  const borderColor = error ? colors.danger : focused ? colors.accent : colors.border;
  const iconColor = error ? colors.dangerText : focused ? colors.accent : colors.textMuted;

  return (
    <View style={[{ marginBottom: spacing.md }, containerStyle]}>
      {label ? (
        <Text
          style={[
            typeScale.label as TextStyle,
            {
              color: focused ? colors.accentText : colors.textMuted,
              textTransform: 'uppercase',
              marginBottom: spacing.sm,
            },
          ]}
        >
          {label}
        </Text>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          backgroundColor: colors.inputBg,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor,
          paddingHorizontal: spacing.md,
          minHeight: 52,
        }}
      >
        {icon ? icon(iconColor) : null}
        <TextInput
          placeholderTextColor={colors.textMuted}
          {...inputProps}
          onFocus={(e) => {
            setFocused(true);
            keyboardAware.onFocus();
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            keyboardAware.onBlur();
            inputProps.onBlur?.(e);
          }}
          onContentSizeChange={
            inputProps.multiline
              ? (e) => {
                  keyboardAware.onContentSizeChange();
                  inputProps.onContentSizeChange?.(e);
                }
              : inputProps.onContentSizeChange
          }
          style={[
            {
              flex: 1,
              color: colors.text,
              fontSize: 16,
              paddingVertical: Platform.OS === 'ios' ? 14 : 10,
            },
            inputProps.style,
          ]}
        />
        {trailing}
      </View>

      {error ? (
        <Text style={[typeScale.xs as TextStyle, { color: colors.dangerText, marginTop: 6 }]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[typeScale.xs as TextStyle, { color: colors.textMuted, marginTop: 6 }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/* ───────────────────────────────────────────────────────────── Badge ──── */

type BadgeTone = 'neutral' | 'accent' | 'danger' | 'warning' | 'success' | 'info';

export function Badge({
  label,
  tone = 'neutral',
  icon,
  style,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const map: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: colors.surfaceAlt, fg: colors.textSub },
    accent: { bg: colors.accentSoft, fg: colors.accentText },
    danger: { bg: colors.dangerSoft, fg: colors.dangerText },
    warning: { bg: colors.warningSoft, fg: colors.warningText },
    success: { bg: colors.successSoft, fg: colors.successText },
    info: { bg: colors.infoSoft, fg: colors.infoText },
  };
  const c = map[tone];
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 5,
          alignSelf: 'flex-start',
          backgroundColor: c.bg,
          paddingHorizontal: 9,
          paddingVertical: 4,
          borderRadius: radius.full,
        },
        style,
      ]}
    >
      {icon}
      <Text style={[typeScale.xs as TextStyle, { color: c.fg, fontWeight: '700' }]}>{label}</Text>
    </View>
  );
}

/* ─────────────────────────────────────────────────────────── ListRow ──── */

interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  /** Show a chevron. Implied when `onPress` is set and `right` is not. */
  chevron?: boolean;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ListRow({
  title,
  subtitle,
  icon,
  right,
  onPress,
  chevron,
  destructive,
  style,
}: ListRowProps) {
  const { colors } = useTheme();
  const showChevron = chevron ?? (!!onPress && !right);

  const body = (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: 14,
          paddingHorizontal: spacing.md,
          minHeight: 60,
        },
        style,
      ]}
    >
      {icon ? (
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: destructive ? colors.dangerSoft : colors.surfaceAlt,
          }}
        >
          {icon}
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        <Text
          style={[
            typeScale.bodyStrong as TextStyle,
            { color: destructive ? colors.dangerText : colors.text },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={[typeScale.sm as TextStyle, { color: colors.textMuted, marginTop: 2 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {right}
      {showChevron ? <ChevronRight size={18} color={colors.textMuted} /> : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <PressableScale accessibilityRole="button" onPress={onPress} scaleTo={0.98}>
      {body}
    </PressableScale>
  );
}

/** Hairline between rows inside a Card. */
export function RowDivider() {
  const { colors } = useTheme();
  return (
    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: spacing.md }} />
  );
}

/* ─────────────────────────────────────────────── SegmentedControl ─────── */

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: (color: string) => React.ReactNode;
}

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  style,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, shadows } = useTheme();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        {
          flexDirection: 'row',
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 4,
          gap: 4,
        },
        style,
      ]}
    >
      {segments.map((seg) => {
        const active = seg.value === value;
        const fg = active ? colors.onAccent : colors.textSub;
        return (
          <Pressable
            key={seg.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(seg.value)}
            style={({ pressed }) => [
              {
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 10,
                borderRadius: radius.sm,
                backgroundColor: active ? colors.accent : 'transparent',
                minHeight: 42,
              },
              active && shadows.soft,
              pressed && { opacity: 0.85 },
            ]}
          >
            {seg.icon ? seg.icon(fg) : null}
            <Text style={[typeScale.smStrong as TextStyle, { color: fg }]}>{seg.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ──────────────────────────────────────────────────────────── AppBar ──── */

export function AppBar({
  title,
  subtitle,
  left,
  right,
  style,
}: {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <FadeIn
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.md,
        },
        style,
      ]}
    >
      {left}
      <View style={{ flex: 1 }}>
        <Text style={[typeScale.h2 as TextStyle, { color: colors.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[typeScale.sm as TextStyle, { color: colors.textMuted, marginTop: 2 }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </FadeIn>
  );
}

/* ───────────────────────────────────────────────────────── EmptyState ─── */

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <FadeIn from="zoom" style={{ alignItems: 'center', paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg, gap: spacing.sm }}>
      {icon ? (
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surfaceAlt,
            marginBottom: spacing.sm,
          }}
        >
          {icon}
        </View>
      ) : null}
      <Text style={[typeScale.h3 as TextStyle, { color: colors.text, textAlign: 'center' }]}>{title}</Text>
      {message ? (
        <Text style={[typeScale.sm as TextStyle, { color: colors.textMuted, textAlign: 'center', maxWidth: 300 }]}>
          {message}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: spacing.md }}>{action}</View> : null}
    </FadeIn>
  );
}

export type { Theme };
export { useTheme, useThemedStyles };
