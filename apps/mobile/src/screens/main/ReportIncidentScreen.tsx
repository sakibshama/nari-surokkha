import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { showAlert } from '../../utils/notify';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Eye, FileText, Lightbulb, Lock, Send, UserX, Wallet } from 'lucide-react-native';

import { MainStackParamList } from '../../navigation/MainStack';
import api from '../../services/api';
import { useTheme } from '../../theme';
import { useT } from '../../i18n';
import { radius, spacing, type } from '../../theme/tokens';
import { AppBar, Badge, Button, Card, FadeIn, PressableScale, Screen, SectionLabel, Txt } from '../../components/ui';

type Props = NativeStackScreenProps<MainStackParamList, 'ReportIncident'>;

type Tone = 'danger' | 'warning' | 'neutral';

const TYPES: { label: string; value: string; icon: React.ComponentType<{ color: string; size: number }>; tone: Tone }[] = [
  { label: 'Harassment', value: 'harassment', icon: UserX, tone: 'danger' },
  { label: 'Robbery / Theft', value: 'robbery', icon: Wallet, tone: 'danger' },
  { label: 'Suspicious activity', value: 'suspicious_activity', icon: Eye, tone: 'warning' },
  { label: 'Poor lighting', value: 'poor_lighting', icon: Lightbulb, tone: 'warning' },
  { label: 'Other', value: 'other', icon: FileText, tone: 'neutral' },
];

export default function ReportIncidentScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const t = useT();
  const [selected, setSelected] = useState(TYPES[0].value);
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [descFocused, setDescFocused] = useState(false);

  const tone = (x: Tone) =>
    x === 'danger'
      ? { fg: colors.dangerText, bg: colors.dangerSoft, border: colors.danger }
      : x === 'warning'
        ? { fg: colors.warningText, bg: colors.warningSoft, border: colors.warning }
        : { fg: colors.textSub, bg: colors.surfaceAlt, border: colors.borderStrong };

  const activeType = TYPES.find((x) => x.value === selected)!;
  const activeTone = tone(activeType.tone);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert(t('Permission denied'), t('Location required.'));
        setLoading(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await api.post('/incidents', {
        type: selected,
        description: desc,
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      });
      showAlert(t('Report submitted'), t('Your anonymous report has been sent for verification.'), [
        { text: t('OK'), onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      showAlert(t('Failed'), e.response?.data?.message || t('Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <Screen>
        <AppBar title={t('Report Incident')} subtitle={t('Help make your area safer for everyone.')} />

        <FadeIn style={{ alignItems: 'center', marginVertical: spacing.md }}>
          <Animated.View
            key={selected}
            entering={ZoomIn.springify().damping(14)}
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              borderWidth: 1.5,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: activeTone.bg,
              borderColor: activeTone.border,
            }}
          >
            <activeType.icon color={activeTone.fg} size={38} />
          </Animated.View>
          <Badge
            label={t('100% anonymous')}
            tone="success"
            icon={<Lock color={colors.successText} size={12} />}
            style={{ marginTop: spacing.md, alignSelf: 'center' }}
          />
        </FadeIn>

        <SectionLabel>{t('Incident type')}</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {TYPES.map((x, i) => {
            const active = selected === x.value;
            const tn = tone(x.tone);
            return (
              <FadeIn key={x.value} delay={60 + i * 45} style={{ flexGrow: 1, minWidth: '45%' }}>
                <PressableScale
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => setSelected(x.value)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing.sm,
                    borderWidth: 1.5,
                    borderRadius: radius.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm + 4,
                    backgroundColor: active ? tn.bg : colors.surface,
                    borderColor: active ? tn.border : colors.border,
                  }}
                >
                  <x.icon color={active ? tn.fg : colors.textMuted} size={18} />
                  <Text style={[type.sm, { flex: 1, color: active ? tn.fg : colors.textSub, fontWeight: active ? '700' : '500' }]}>
                    {t(x.label)}
                  </Text>
                </PressableScale>
              </FadeIn>
            );
          })}
        </View>

        <SectionLabel>{t('Details (optional)')}</SectionLabel>
        <FadeIn delay={300}>
          <TextInput
            style={{
              ...type.body,
              color: colors.text,
              minHeight: 120,
              backgroundColor: colors.inputBg,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: descFocused ? colors.accent : colors.border,
              padding: spacing.md,
            }}
            placeholder={t('Any additional details about the incident...')}
            placeholderTextColor={colors.textMuted}
            multiline
            value={desc}
            onChangeText={setDesc}
            textAlignVertical="top"
            onFocus={() => setDescFocused(true)}
            onBlur={() => setDescFocused(false)}
          />
        </FadeIn>

        <Card tone="success" delay={360} style={{ marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' }}>
          <Lock color={colors.successText} size={16} />
          <Txt variant="sm" tone="sub" style={{ flex: 1 }}>
            {t('Your identity is never shared. Reports are reviewed by moderators before affecting the Safety Score.')}
          </Txt>
        </Card>

        <FadeIn delay={420} style={{ marginTop: spacing.lg }}>
          <Button
            label={t('Submit anonymously')}
            size="lg"
            onPress={handleSubmit}
            loading={loading}
            icon={<Send color={colors.onAccent} size={19} />}
          />
        </FadeIn>
      </Screen>
    </KeyboardAvoidingView>
  );
}
