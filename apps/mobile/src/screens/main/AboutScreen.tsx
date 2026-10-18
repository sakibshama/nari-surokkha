/** About Nari Surokkha: what the app is, who built it, and the build version. */

import React from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { Briefcase, Building2, Code2, Mail, ShieldCheck, User } from 'lucide-react-native';
import { AppBar, Card, ListRow, RowDivider, Screen, SectionLabel, Txt } from '../../components/ui';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { radius, spacing } from '../../theme/tokens';

const DEVELOPER = {
  name: 'Sakibur Rahman Saikat',
  role: 'Software & Machine Learning Engineer',
  title: 'Founder & CEO',
  company: 'Mystrix IT',
  email: 'mystrixit@gmail.com',
};

export default function AboutScreen() {
  const { colors } = useTheme();
  const t = useT();
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <Screen>
      <AppBar title={t('About')} subtitle={t('Nari Surokkha — women’s safety')} />

      <Card style={styles.hero}>
        <Image source={require('../../../assets/icon.png')} style={styles.logo} accessibilityIgnoresInvertColors />
        <Txt variant="h2" style={styles.center}>
          {t('Nari Surokkha')}
        </Txt>
        <Txt tone="muted" style={styles.center}>
          {t('A one-tap SOS, live location for your trusted contacts, offline SMS and on-device emergency detection — built to get help to you fast.')}
        </Txt>
        <View style={[styles.versionPill, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <ShieldCheck size={14} color={colors.accent} />
          <Txt variant="xs" tone="muted">
            {t('Version {v}', { v: version })}
          </Txt>
        </View>
      </Card>

      <SectionLabel>{t('Developer')}</SectionLabel>
      <Card padded={false}>
        <ListRow
          icon={<User size={18} color={colors.accent} />}
          title={DEVELOPER.name}
          subtitle={t('Developed by')}
        />
        <RowDivider />
        <ListRow
          icon={<Building2 size={18} color={colors.accent} />}
          title={`${DEVELOPER.title}, ${DEVELOPER.company}`}
          subtitle={t('Founder & CEO')}
        />
        <RowDivider />
        <ListRow
          icon={<Code2 size={18} color={colors.accent} />}
          title={t(DEVELOPER.role)}
          subtitle={t('Role')}
        />
        <RowDivider />
        <ListRow
          icon={<Mail size={18} color={colors.accent} />}
          title={DEVELOPER.email}
          subtitle={t('Contact')}
          onPress={() => void Linking.openURL(`mailto:${DEVELOPER.email}`).catch(() => undefined)}
        />
      </Card>

      <View style={styles.footer}>
        <Briefcase size={14} color={colors.textMuted} />
        <Txt variant="xs" tone="muted">
          {t('© {year} {company}. All rights reserved.', { year: new Date().getFullYear(), company: DEVELOPER.company })}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  logo: { width: 84, height: 84, borderRadius: radius.lg },
  center: { textAlign: 'center' },
  versionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: spacing.xs,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
});
