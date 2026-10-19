import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Linking, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { formatDistanceToNow } from 'date-fns';
import { bn as bnLocale } from 'date-fns/locale';
import {
  CheckCircle,
  Clock,
  Flag,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  ShieldAlert,
  Undo2,
  XCircle,
} from 'lucide-react-native';

import api from '../../services/api';
import { socketService } from '../../services/socket';
import {
  actionsFor,
  classifyDispatchError,
  closeDispatch,
  directionsUrl,
  formatDistance,
  isOwnSos,
  partitionDispatches,
  upsertDispatch,
  type Dispatch,
  type DispatchAction,
  type DispatchStatus,
} from '../../services/responderDispatch';
import { confirmAlert, toast } from '../../utils/notify';
import { useAuthStore } from '../../store/authStore';
import { useLocationStore } from '../../store/locationStore';
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

const STATUS_LABEL: Record<DispatchStatus, string> = {
  pending: 'Pending',
  accepted: 'On the way',
  arrived: 'On scene',
  completed: 'Completed',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  closed: 'SOS ended',
};

const STATUS_TONE: Record<DispatchStatus, 'warning' | 'success' | 'info' | 'neutral'> = {
  pending: 'warning',
  accepted: 'success',
  arrived: 'info',
  completed: 'success',
  declined: 'neutral',
  withdrawn: 'neutral',
  closed: 'neutral',
};

export default function ResponderHubScreen() {
  const { colors, shadows } = useTheme();
  const t = useT();
  const { isBangla } = useLanguage();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const activeAlertId = useLocationStore((s) => (s.isSosActive ? s.activeAlertId : null));
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [notResponder, setNotResponder] = useState(false);
  const [showPast, setShowPast] = useState(false);
  /** dispatchId → action in flight (one at a time per card: no double taps). */
  const [busy, setBusy] = useState<Record<string, DispatchAction | undefined>>({});
  const mounted = useRef(true);
  const fetchSeq = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchDispatches = useCallback(async (opts: { quiet?: boolean } = {}) => {
    const seq = ++fetchSeq.current;
    if (!opts.quiet) setLoading(true);
    try {
      const res = await api.get('/responders/dispatches');
      // Only the latest request may write: a slow earlier response must not
      // overwrite the result of an action taken since.
      if (!mounted.current || seq !== fetchSeq.current) return;
      setNotResponder(false);
      setDispatches(Array.isArray(res.data?.data) ? res.data.data : []);
    } catch (err: any) {
      if (!mounted.current || seq !== fetchSeq.current) return;
      if (err?.response?.status === 404) setNotResponder(true);
      else if (__DEV__) console.warn('[ResponderHub] fetch failed', err?.message);
    } finally {
      if (mounted.current && seq === fetchSeq.current) setLoading(false);
    }
  }, []);

  // Fresh list every time the hub is opened (also from a notification tap).
  useFocusEffect(
    useCallback(() => {
      void fetchDispatches();
    }, [fetchDispatches]),
  );

  // Live: a new dispatch arrives / the SOS behind one ends.
  useEffect(() => {
    const onReceived = (msg: any) => {
      if (isOwnSos(msg, { userId, activeAlertId })) return;
      void fetchDispatches({ quiet: true });
    };
    const onClosed = (msg: any) => {
      setDispatches((list) => closeDispatch(list, msg));
    };
    socketService.on('responder:dispatch_received', onReceived);
    socketService.on('responder:dispatch_closed', onClosed);
    return () => {
      socketService.off('responder:dispatch_received', onReceived);
      socketService.off('responder:dispatch_closed', onClosed);
    };
  }, [fetchDispatches, userId, activeAlertId]);

  const { active, past } = useMemo(
    () => partitionDispatches(dispatches, { userId, activeAlertId }),
    [dispatches, userId, activeAlertId],
  );

  const act = async (d: Dispatch, action: DispatchAction) => {
    if (busy[d.id]) return;
    if (action === 'withdraw') {
      const ok = await confirmAlert(
        t('Withdraw your help?'),
        t('The person in danger will see that you are no longer coming.'),
        t('Withdraw'),
        t('Cancel'),
      );
      if (!ok) return;
    }
    setBusy((b) => ({ ...b, [d.id]: action }));
    try {
      const res = await api.patch(`/responders/dispatches/${d.id}/response`, { action });
      const updated: Dispatch | undefined = res.data?.data;
      if (mounted.current) {
        if (updated?.id) setDispatches((list) => upsertDispatch(list, updated));
        else void fetchDispatches({ quiet: true });
      }
      if (action === 'accept') toast(t('Accepted'), t('Exact location and contact details are unlocked.'), 'success');
      else if (action === 'arrive') toast(t('Marked as arrived'), undefined, 'success');
      else if (action === 'complete') toast(t('Thank you for helping'), undefined, 'success');
    } catch (err) {
      const outcome = classifyDispatchError(err);
      switch (outcome.kind) {
        case 'ended':
          toast(t('This SOS has ended'), t('The person is no longer asking for help.'), 'info');
          if (mounted.current) setDispatches((list) => closeDispatch(list, { dispatchId: d.id }));
          break;
        case 'stale':
        case 'own':
        case 'not_responder':
          toast(t('This dispatch was updated'), t('Showing the latest status.'), 'info');
          break;
        case 'offline':
          toast(t('No connection'), t('Please try again.'), 'error');
          break;
        default:
          toast(t('Error'), outcome.message || t('Something went wrong. Please try again.'), 'error');
      }
      void fetchDispatches({ quiet: true });
    } finally {
      if (mounted.current) setBusy((b) => ({ ...b, [d.id]: undefined }));
    }
  };

  const ago = (d?: string | null) => {
    if (!d) return '';
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return '';
    return formatDistanceToNow(date, { addSuffix: true, locale: isBangla ? bnLocale : undefined });
  };

  const actionButton = (d: Dispatch, action: DispatchAction) => {
    const inFlight = busy[d.id];
    const common = {
      loading: inFlight === action,
      disabled: !!inFlight,
      onPress: () => void act(d, action),
      style: { flex: 1 },
      size: 'sm' as const,
    };
    switch (action) {
      case 'accept':
        return <Button key={action} {...common} label={t('Accept')} icon={<CheckCircle color={colors.onAccent} size={18} />} />;
      case 'reject':
        return (
          <Button key={action} {...common} label={t('Decline')} variant="subtle" icon={<XCircle color={colors.textMuted} size={18} />} />
        );
      case 'arrive':
        return <Button key={action} {...common} label={t("I've arrived")} icon={<MapPin color={colors.onAccent} size={18} />} />;
      case 'complete':
        return <Button key={action} {...common} label={t('Mark done')} variant="outline" icon={<Flag color={colors.text} size={18} />} />;
      case 'withdraw':
        return (
          <Button key={action} {...common} label={t("Can't go")} variant="ghost" icon={<Undo2 color={colors.textMuted} size={18} />} />
        );
    }
  };

  const renderDetails = (d: Dispatch) => {
    const rows: Array<[string, string | number | null | undefined]> = [
      [t('Victim'), d.alert.victimName],
      [t('Phone'), d.alert.victimPhone],
      [t('Blood group'), d.alert.bloodGroup],
    ];
    return (
      <>
        {rows.map(([k, v]) => (
          <View
            key={k}
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
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
          <Button
            size="sm"
            variant="outline"
            label={t('Directions')}
            icon={<Navigation color={colors.text} size={16} />}
            onPress={() => void Linking.openURL(directionsUrl(d.alert.latitude, d.alert.longitude)).catch(() => {})}
            style={{ flex: 1 }}
          />
          {d.alert.victimPhone ? (
            <Button
              size="sm"
              variant="outline"
              label={t('Call')}
              icon={<Phone color={colors.text} size={16} />}
              onPress={() => void Linking.openURL(`tel:${d.alert.victimPhone}`).catch(() => {})}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
      </>
    );
  };

  const renderItem = ({ item, index }: { item: Dispatch; index: number }) => {
    const actions = actionsFor(item.status);
    const distance = formatDistance(item.distanceMeters);
    const open = item.status === 'pending' || item.status === 'accepted' || item.status === 'arrived';
    return (
      <Animated.View
        entering={FadeInDown.delay(Math.min(index, 6) * 70).duration(380)}
        layout={LinearTransition.springify().damping(18)}
        style={[
          {
            backgroundColor: colors.surface,
            borderRadius: radius.lg,
            padding: spacing.md,
            marginBottom: spacing.md,
            borderWidth: 1,
            borderColor: item.status === 'pending' ? colors.warning : colors.border,
            opacity: open ? 1 : 0.75,
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
            <Badge label={t(STATUS_LABEL[item.status] ?? item.status)} tone={STATUS_TONE[item.status] ?? 'neutral'} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Clock color={colors.textMuted} size={12} />
            <Txt variant="xs" tone="muted">{ago(item.dispatchedAt)}</Txt>
          </View>
        </View>

        {item.status === 'pending' && (
          <>
            <Txt variant="h3" style={{ marginBottom: spacing.xs }}>{t('Nearby emergency')}</Txt>
            {distance ? (
              <Txt variant="sm" tone="sub">{t('About {d} away', { d: distance })}</Txt>
            ) : null}
            <Txt variant="xs" tone="muted" style={{ marginTop: 2 }}>
              {t('Exact location unlocks when you accept.')}
            </Txt>
          </>
        )}

        {(item.status === 'accepted' || item.status === 'arrived') && (
          <>
            <Txt variant="h3" style={{ marginBottom: spacing.sm }}>{t('Dispatch details')}</Txt>
            {renderDetails(item)}
          </>
        )}

        {item.status === 'completed' && (
          <Txt variant="sm" tone="muted">{t('You helped with this SOS. Thank you.')}</Txt>
        )}
        {item.status === 'closed' && (
          <Txt variant="sm" tone="muted">{t('This SOS has ended. No action is needed.')}</Txt>
        )}
        {item.status === 'declined' && (
          <Txt variant="sm" tone="muted">{t('You declined this dispatch.')}</Txt>
        )}
        {item.status === 'withdrawn' && (
          <Txt variant="sm" tone="muted">{t('You withdrew from this dispatch.')}</Txt>
        )}

        {actions.length > 0 && (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' }}>
            {actions.map((a) => actionButton(item, a))}
          </View>
        )}
      </Animated.View>
    );
  };

  const header = (
    <AppBar
      title={t('Responder Hub')}
      subtitle={t('Community dispatches near you')}
      right={
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('Refresh')}
          onPress={() => void fetchDispatches()}
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

  const data = showPast ? [...active, ...past] : active;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      data={data}
      keyExtractor={(i) => i.id}
      renderItem={renderItem}
      extraData={busy}
      ListHeaderComponent={header}
      ListFooterComponent={
        past.length > 0 ? (
          <PressableScale
            accessibilityRole="button"
            onPress={() => setShowPast((v) => !v)}
            style={{ alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md }}
          >
            <Txt variant="sm" tone="accent">
              {showPast ? t('Hide past dispatches') : t('Show past dispatches ({n})', { n: past.length })}
            </Txt>
          </PressableScale>
        ) : null
      }
      refreshControl={
        <RefreshControl
          refreshing={loading && dispatches.length > 0}
          onRefresh={() => void fetchDispatches()}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
      contentContainerStyle={{ padding: spacing.md, paddingTop: 0, paddingBottom: spacing.xxl }}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        loading && dispatches.length === 0 ? (
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
