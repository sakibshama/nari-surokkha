import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CheckCircle2, Send, XCircle, Trash2, MessageSquare, Users, Clock, Wifi, WifiOff } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme, useTheme, useThemedStyles } from '../../theme';
import { radius, spacing, type } from '../../theme/tokens';
import type { Palette } from '../../theme/tokens';
import { getSmsHistory, clearSmsHistory, SmsHistoryEntry } from '../../services/smsHistory';

const metaFor = (colors: Palette): Record<string, { label: string; color: string; bg: string; Icon: any }> => ({
  auto:   { label: 'Sent automatically', color: colors.successText, bg: colors.successSoft, Icon: CheckCircle2 },
  manual: { label: 'Opened in Messages',  color: colors.infoText, bg: colors.infoSoft, Icon: Send },
  sent:   { label: 'Dispatched by server', color: colors.successText, bg: colors.successSoft, Icon: CheckCircle2 },
  failed: { label: 'Failed',              color: colors.dangerText, bg: colors.dangerSoft, Icon: XCircle },
});

const channelFor = (colors: Palette): Record<string, { label: string; color: string; bg: string; Icon: any }> => ({
  'online-server': { label: 'ONLINE · Server', color: colors.infoText, bg: colors.infoSoft, Icon: Wifi },
  'offline-sim':   { label: 'OFFLINE · SIM',   color: colors.warningText, bg: colors.warningSoft,  Icon: WifiOff },
});

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleString();
}

export default function SmsHistoryScreen() {
  const styles = useThemedStyles(makeStyles);
  const { colors, gradients, shadows } = useTheme();
  void gradients; void shadows;
  const [items, setItems] = useState<SmsHistoryEntry[]>([]);

  const load = useCallback(() => { getSmsHistory().then(setItems); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const confirmClear = () => {
    Alert.alert('Clear History', 'Remove all SMS history from this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => { await clearSmsHistory(); load(); } },
    ]);
  };

  return (
    <LinearGradient colors={gradients.hero} style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>SOS SMS History</Text>
            <Text style={styles.subtitle}>Offline emergency texts sent from this phone</Text>
          </View>
          {items.length > 0 && (
            <TouchableOpacity onPress={confirmClear} style={styles.clearBtn}>
              <Trash2 color={colors.danger} size={18} />
            </TouchableOpacity>
          )}
        </View>

        {items.length === 0 ? (
          <View style={styles.empty}>
            <MessageSquare color={colors.textMuted} size={44} />
            <Text style={styles.emptyTitle}>No SMS sent yet</Text>
            <Text style={styles.emptyText}>
              When you trigger an SOS while offline, the emergency SMS and its delivery status will appear here.
            </Text>
          </View>
        ) : (
          items.map((it) => {
            const META = metaFor(colors);
            const CHANNEL = channelFor(colors);
            const m = META[it.status] || META.failed;
            const ch = CHANNEL[it.channel] || CHANNEL['offline-sim'];
            return (
              <View key={it.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={[styles.badge, { backgroundColor: ch.bg }]}>
                    <ch.Icon color={ch.color} size={12} />
                    <Text style={[styles.badgeText, { color: ch.color }]}>{ch.label}</Text>
                  </View>
                  <View style={styles.time}>
                    <Clock color={colors.textMuted} size={12} />
                    <Text style={styles.timeText}>{timeAgo(it.at)}</Text>
                  </View>
                </View>

                <View style={[styles.badge, { backgroundColor: m.bg, alignSelf: 'flex-start', marginBottom: 10 }]}>
                  <m.Icon color={m.color} size={13} />
                  <Text style={[styles.badgeText, { color: m.color }]}>{m.label}</Text>
                </View>

                <View style={styles.row}>
                  <Users color={colors.textSub} size={13} />
                  <Text style={styles.recipients} numberOfLines={1}>
                    {it.recipients.length} recipient{it.recipients.length === 1 ? '' : 's'}: {it.recipients.join(', ')}
                  </Text>
                </View>

                <Text style={styles.message}>{it.message}</Text>

                {it.reason ? <Text style={styles.reason}>Reason: {it.reason}</Text> : null}
              </View>
            );
          })
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const makeStyles = ({ colors, shadows, gradients }: Theme) => {
  const font = {
    hero: { ...type.hero, color: colors.text },
    h1: { ...type.h1, color: colors.text },
    h2: { ...type.h2, color: colors.text },
    h3: { ...type.h3, color: colors.text },
    body: { ...type.body, color: colors.text },
    sm: { ...type.sm, color: colors.textSub },
    xs: { ...type.xs, color: colors.textMuted },
    label: { ...type.label, color: colors.textSub },
    regular: 'System' as const, medium: 'System' as const,
    semiBold: 'System' as const, bold: 'System' as const,
  };
  void gradients;
  return StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: spacing.lg, paddingTop: Platform.OS === 'ios' ? 60 : 48, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  title: { ...font.h1, color: colors.text },
  subtitle: { ...font.sm, color: colors.textMuted, marginTop: 2 },
  clearBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(244,63,94,0.10)', borderWidth: 1, borderColor: 'rgba(244,63,94,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: spacing.lg, gap: 10 },
  emptyTitle: { ...font.h3, color: colors.text, marginTop: 8 },
  emptyText: { ...font.sm, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border,
    padding: spacing.md, marginBottom: spacing.md,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  time: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timeText: { color: colors.textMuted, fontSize: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  recipients: { ...font.xs, color: colors.textSub, flex: 1 },
  message: { ...font.sm, color: colors.text, lineHeight: 20, backgroundColor: colors.surfaceAlt, padding: 10, borderRadius: radius.md },
  reason: { ...font.xs, color: colors.dangerText, marginTop: 8 },
});
};
