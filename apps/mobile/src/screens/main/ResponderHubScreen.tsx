import React, { useEffect, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { showAlert } from '../../utils/notify';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { formatDistanceToNow } from 'date-fns';
import { bn as bnLocale } from 'date-fns/locale';
import { CheckCircle, Clock, RefreshCw, ShieldAlert, XCircle } from 'lucide-react-native';

import api from '../../services/api';
import { useTheme } from '../../theme';
import { useLanguage, useT } from '../../i18n';
import { radius, spacing, type } from '../../theme/tokens';
import {
  AppBar,
  Badge,
  Breathing,
  Button,
  Card,
  EmptyState,
  PressableScale,
  Shimmer,
  Txt,
} from '../../components/ui';

export default function ResponderHubScreen() {
  const { colors, shadows } = useTheme();
  const t = useT();
  const { isBangla } = useLanguage();
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notResponder, setNotResponder] = useState(false);

  const fetchDispatches = async () => {
    setLoading(true);
    try {
      setDispatches((await api.get('/responders/dispatches')).data.data);
    } catch (err: any) {
      if (err.response?.status === 404) setNotResponder(true);
      else if (__DEV__) console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDispatches();
  }, []);

  const respond = async (id: string, action: 'accept' | 'reject') => {
    try {
      await api.patch(`/responders/dispatches/${id}/response`, { action });
      fetchDispatches();
      if (action === 'accept') showAlert(t('Accepted'), t('Details unlocked below.'));
    } catch (e: any) {
      showAlert(t('Error'), e.response?.data?.error?.message || t('Failed.'));
    }
  };

  const ago = (d: string) =>
    formatDistanceToNow(new Date(d), { addSuffix: true, locale: isBangla ? bnLocale : undefined });

  const statusTone = (s: string) => (s === 'pending' ? 'warning' : s === 'accepted' ? 'success' : 'neutral');
  const statusLabel = (s: string) =>
    s === 'pending' ? t('Pending') : s === 'accepted' ? t('Accepted') : t('Rejected');

  const renderItem = ({ item, index }: { item: any; index: number }) => (
    <Animated.View
      entering={FadeInDown.delay(index * 70).duration(380)}
      layout={LinearTransition.springify().damping(18)}
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          padding: spacing.md,
          marginBottom: spacing.md,
          borderWidth: 1,
          borderColor: item.status === 'pending' ? colors.warning : colors.border,
        },
        shadows.soft,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          {item.status === 'pending' && (
            <Breathing>
              <ShieldAlert color={colors.warningText} size={20} />
            </Breathing>
          )}
          {item.status === 'accepted' && <CheckCircle color={colors.successText} size={20} />}
          {item.status === 'rejected' && <XCircle color={colors.textMuted} size={20} />}
          <Badge label={statusLabel(item.status)} tone={statusTone(item.status)} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Clock color={colors.textMuted} size={12} />
          <Txt variant="xs" tone="muted">{ago(item.dispatchedAt)}</Txt>
        </View>
      </View>

      {item.status === 'pending' && (
        <>
          <Txt variant="h3" style={{ marginBottom: spacing.xs }}>{t('Nearby emergency')}</Txt>
          <Txt variant="sm" tone="sub">
            {t('Victim')}: <Text style={{ color: colors.text, fontWeight: '700' }}>{item.alert.victimName}</Text>
          </Txt>
          <Txt variant="xs" tone="muted" style={{ marginTop: 2 }}>
            {t('Exact location unlocks when you accept.')}
          </Txt>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <Button
              label={t('Accept')}
              onPress={() => respond(item.id, 'accept')}
              icon={<CheckCircle color={colors.onAccent} size={18} />}
              style={{ flex: 1 }}
            />
            <Button
              label={t('Reject')}
              variant="subtle"
              onPress={() => respond(item.id, 'reject')}
              icon={<XCircle color={colors.textMuted} size={18} />}
              style={{ flex: 1 }}
            />
          </View>
        </>
      )}

      {item.status === 'accepted' && (
        <>
          <Txt variant="h3" style={{ marginBottom: spacing.sm }}>{t('Dispatch details')}</Txt>
          {[
            [t('Victim'), item.alert.victimName],
            [t('Phone'), item.alert.victimPhone],
            [t('Blood group'), item.alert.bloodGroup],
            [t('Latitude'), item.alert.latitude],
            [t('Longitude'), item.alert.longitude],
          ].map(([k, v]) => (
            <View
              key={String(k)}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: spacing.sm,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={[type.sm, { color: colors.textMuted }]}>{k}</Text>
              <Text style={[type.smStrong, { color: colors.text }]}>{v || '—'}</Text>
            </View>
          ))}
        </>
      )}

      {item.status === 'rejected' && (
        <Txt variant="sm" tone="muted" style={{ fontStyle: 'italic' }}>{t('This dispatch was rejected.')}</Txt>
      )}
    </Animated.View>
  );

  const header = (
    <AppBar
      title={t('Responder Hub')}
      subtitle={t('Community dispatches near you')}
      right={
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('Refresh')}
          onPress={fetchDispatches}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RefreshCw color={colors.textSub} size={18} />
        </PressableScale>
      }
    />
  );

  if (notResponder) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.md }}>
        {header}
        <Card tone="warning" delay={60}>
          <EmptyState
            icon={<ShieldAlert color={colors.warningText} size={30} />}
            title={t('Not yet a responder')}
            message={t("Go to your Profile and apply to become a verified community responder. Once approved, you'll receive nearby emergency alerts.")}
          />
        </Card>
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      data={dispatches}
      keyExtractor={(i) => i.id}
      renderItem={renderItem}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchDispatches} tintColor={colors.accent} colors={[colors.accent]} />}
      contentContainerStyle={{ padding: spacing.md, paddingTop: 0, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        loading ? (
          <View style={{ gap: spacing.md }}>
            <Shimmer width="100%" height={130} radius={radius.lg} />
            <Shimmer width="100%" height={130} radius={radius.lg} />
          </View>
        ) : (
          <EmptyState
            icon={<ShieldAlert color={colors.textMuted} size={30} />}
            title={t('No dispatches')}
            message={t("You'll be notified when a nearby emergency needs your help.")}
          />
        )
      }
    />
  );
}
