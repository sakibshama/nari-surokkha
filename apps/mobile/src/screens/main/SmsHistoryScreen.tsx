import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { showAlert } from '../../utils/notify';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { CheckCircle2, Clock, MessageSquare, Send, Trash2, Users, Wifi, WifiOff, XCircle } from 'lucide-react-native';
import { formatDistanceToNow } from 'date-fns';
import { bn as bnLocale } from 'date-fns/locale';

import { useTheme } from '../../theme';
import { useLanguage, useT } from '../../i18n';
import { radius, spacing, type } from '../../theme/tokens';
import { AppBar, Badge, EmptyState, PressableScale, Screen, Txt } from '../../components/ui';
import { clearSmsHistory, getSmsHistory, SmsHistoryEntry } from '../../services/smsHistory';

const STATUS: Record<string, { label: string; tone: 'success' | 'info' | 'danger'; Icon: any }> = {
  auto: { label: 'Sent automatically', tone: 'success', Icon: CheckCircle2 },
  manual: { label: 'Opened in Messages', tone: 'info', Icon: Send },
  sent: { label: 'Dispatched by server', tone: 'success', Icon: CheckCircle2 },
  failed: { label: 'Failed', tone: 'danger', Icon: XCircle },
};

const CHANNEL: Record<string, { label: string; tone: 'info' | 'warning'; Icon: any }> = {
  'online-server': { label: 'Online · server', tone: 'info', Icon: Wifi },
  'offline-sim': { label: 'Offline · SIM', tone: 'warning', Icon: WifiOff },
};

export default function SmsHistoryScreen() {
  const { colors, shadows } = useTheme();
  const t = useT();
  const { isBangla, num } = useLanguage();
  const [items, setItems] = useState<SmsHistoryEntry[]>([]);

  const load = useCallback(() => {
    getSmsHistory().then(setItems);
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const confirmClear = () => {
    showAlert(t('Clear history'), t('Remove all SMS history from this device?'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Clear'),
        style: 'destructive',
        onPress: async () => {
          await clearSmsHistory();
          load();
        },
      },
    ]);
  };

  const ago = (ts: number) =>
    formatDistanceToNow(new Date(ts), { addSuffix: true, locale: isBangla ? bnLocale : undefined });

  return (
    <Screen>
      <AppBar
        title={t('SOS SMS History')}
        subtitle={t('Every emergency text and how it was delivered')}
        right={
          items.length > 0 ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t('Clear history')}
              onPress={confirmClear}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.dangerSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Trash2 color={colors.dangerText} size={18} />
            </PressableScale>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<MessageSquare color={colors.textMuted} size={30} />}
          title={t('No SMS sent yet')}
          message={t('When you trigger an SOS, the emergency SMS and its delivery status will appear here.')}
        />
      ) : (
        items.map((it, index) => {
          const m = STATUS[it.status] || STATUS.failed;
          const ch = CHANNEL[it.channel] || CHANNEL['offline-sim'];
          return (
            <Animated.View
              key={it.id}
              entering={FadeInDown.delay(Math.min(index, 8) * 60).duration(350)}
              layout={LinearTransition}
              style={[
                {
                  backgroundColor: colors.surface,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: colors.border,
                  padding: spacing.md,
                  marginBottom: spacing.md,
                  gap: spacing.sm,
                },
                shadows.soft,
              ]}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Badge label={t(ch.label)} tone={ch.tone} icon={<ch.Icon size={12} color={colors[`${ch.tone}Text`]} />} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Clock color={colors.textMuted} size={12} />
                  <Txt variant="xs" tone="muted">{ago(it.at)}</Txt>
                </View>
              </View>

              <Badge label={t(m.label)} tone={m.tone} icon={<m.Icon size={13} color={colors[`${m.tone}Text`]} />} />

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Users color={colors.textSub} size={13} />
                <Text style={[type.xs, { color: colors.textSub, flex: 1 }]} numberOfLines={1}>
                  {t(it.recipients.length === 1 ? '{n} recipient' : '{n} recipients', { n: it.recipients.length })}
                  {it.recipients.length ? `: ${it.recipients.join(', ')}` : ''}
                </Text>
              </View>

              <Text
                style={[
                  type.sm,
                  { color: colors.text, backgroundColor: colors.surfaceAlt, padding: 10, borderRadius: radius.md },
                ]}
              >
                {it.message}
              </Text>

              {it.reason ? (
                <Txt variant="xs" tone="danger">
                  {t('Reason')}: {it.reason}
                </Txt>
              ) : null}
            </Animated.View>
          );
        })
      )}
      {items.length > 0 && (
        <Txt variant="xs" tone="muted" center>
          {t('{n} entries stored on this device only', { n: items.length })}
          {' · '}
          {num(50)} {t('max')}
        </Txt>
      )}
    </Screen>
  );
}
