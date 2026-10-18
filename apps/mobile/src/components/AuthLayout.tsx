/**
 * Shared frame for Login and Register: animated backdrop, language and theme
 * toggles in the corner, government strip, brand mark, and the form card.
 */

import React from 'react';
import { Image, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AmbientBackground from './AmbientBackground';
import GovStrip from './GovStrip';
import LanguageToggle from './LanguageToggle';
import ThemeToggle from './ThemeToggle';
import FlagRoundel from './FlagRoundel';
import { Breathing, Card, FadeIn, KeyboardAwareScrollView, Txt } from './ui';
import { useTheme } from '../theme';
import { useT } from '../i18n';
import { radius, spacing } from '../theme/tokens';

export default function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { gradients, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const t = useT();

  return (
    <LinearGradient colors={gradients.hero} style={{ flex: 1 }}>
      <AmbientBackground />
      {/* Keeps the focused field above the keyboard (also under Android edge-to-edge). */}
      <KeyboardAwareScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: spacing.lg,
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        <FadeIn from="up" style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginBottom: spacing.md }}>
          <LanguageToggle />
          <ThemeToggle />
        </FadeIn>

        <FadeIn delay={60}>
          <GovStrip style={{ marginBottom: spacing.xl }} />
        </FadeIn>

        <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
          <FadeIn from="zoom" delay={120}>
            <Breathing min={0.97} max={1.03} duration={2200}>
              <Image
                source={require('../../assets/icon.png')}
                style={[{ width: 96, height: 96, borderRadius: radius.xl }, shadows.card]}
                resizeMode="contain"
              />
            </Breathing>
          </FadeIn>
          <FadeIn delay={200} style={{ alignItems: 'center', marginTop: spacing.md }}>
            <Txt variant="h1" center>নারী সুরক্ষা</Txt>
            <Txt variant="sm" tone="muted" center style={{ marginTop: 2 }}>
              {t('Help is one press away')}
            </Txt>
          </FadeIn>
        </View>

        <Card elevation="raised" delay={280} style={{ padding: spacing.lg }}>
          <Txt variant="h2">{title}</Txt>
          <Txt variant="sm" tone="muted" style={{ marginTop: 4, marginBottom: spacing.lg }}>
            {subtitle}
          </Txt>
          {children}
        </Card>

        {footer ? <FadeIn delay={360}>{footer}</FadeIn> : null}

        <FadeIn
          delay={420}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.xl }}
        >
          <FlagRoundel size={14} />
          <Txt variant="xs" tone="muted">{t('National Women Safety Service · Govt. of Bangladesh')}</Txt>
        </FadeIn>
      </KeyboardAwareScrollView>
    </LinearGradient>
  );
}
