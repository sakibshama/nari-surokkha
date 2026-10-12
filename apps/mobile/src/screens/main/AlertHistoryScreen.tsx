/** History of soft alerts raised on this phone (automatic and manual). */

import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { format } from 'date-fns';
import { History, Trash2 } from 'lucide-react-native';
import { AppBar, Badge, Button, Card, EmptyState, Screen, SegmentedControl, Txt } from '../../components/ui';
import { useTheme } from '../../theme';
import { useLanguage, useT } from '../../i18n';
import { spacing } from '../../theme/tokens';
import { AlertHistoryEntry, AlertOutcome, useAlertHistory } from '../../services/emergency/alertHistory';
import { triggerLabel } from '../../services/emergency/runtime';
import { showAlert } from '../../utils/notify';

type Filter = 'all' | 'sent' | 'cancelled' | 'other';

const OUTCOME: Record<AlertOutcome, { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info' }> = {
  pending: { label: 'Counting down', tone: 'warning' },
  cancelled: { label: "Cancelled — I'm okay", tone: 'success' },
  confirmed: { label: 'SOS sent (by you)', tone: 'danger' },
  auto_confirmed: { label: 'SOS sent (no answer)', tone: 'danger' },
  sent_offline: { label: 'SMS sent offline', tone: 'danger' },
  failed: { label: 'Failed', tone: 'warning' },
  suppressed: { label: 'Ignored (duplicate)', tone: 'neutral' },
};

function matches(e: AlertHistoryEntry, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'sent') return e.outcome === 'confirmed' || e.outcome === 'auto_confirmed' || e.outcome === 'sent_offline';
  if (f === 'cancelled') return e.outcome === 'cancelled';
  return e.outcome === 'failed' || e.outcome === 'suppressed' || e.outcome === 'pending';
}

export default function AlertHistoryScreen() {
  const { colors } = useTheme();
  const t = useT();
  const { num } = useLanguage();
  const entries = useAlertHistory((s) => s.entries);
  const clear = useAlertHistory((s) => s.clear);
  const [filter, setFilter] = useState<Filter>('all');
  const shown = useMemo(() => entries.filter((e) => matches(e, filter)), [entries, filter]);

  const confirmClear = () =>
    showAlert(t('Clear history?'), t('This removes the list from this phone only. Alerts already sent are kept on the server.'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Clear'), style: 'destructive', onPress: clear },
    ]);

  return (
    <Screen>
      <AppBar
        title={t('Alert history')}
        subtitle={t('{n} entries on this phone', { n: entries.length })}
        right={
          entries.length ? (
            <Button label={t('Clear')} size="sm" variant="ghost" full={false} onPress={confirmClear} icon={<Trash2 size={15} color={colors.text} />} />
          ) : undefined
        }
      />
      <SegmentedControl<Filter>
        segments={[
          { value: 'all', label: t('All') },
          { value: 'sent', label: t('Sent') },
          { value: 'cancelled', label: t('Cancelled') },
          { value: 'other', label: t('Other') },
        ]}
        value={filter}
        onChange={setFilter}
        style={{ marginBottom: spacing.md }}
      />
      {shown.length === 0 ? (
        <EmptyState
          icon={<History size={28} color={colors.textMuted} />}
          title={t('No alerts yet')}
          message={t('Automatic and silent alerts will be listed here.')}
        />
      ) : (
        shown.map((e, i) => {
          const o = OUTCOME[e.outcome];
          const secs = e.endedAt ? Math.max(0, Math.round((e.endedAt - e.startedAt) / 1000)) : null;
          return (
            <Card key={e.id} delay={Math.min(i, 10) * 30} style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
                <Txt variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                  {triggerLabel(e.source)}
                  {typeof e.confidence === 'number' ? `  ·  ${num(Math.round(e.confidence * 100))}%` : ''}
                </Txt>
                <Badge label={t(o.label)} tone={o.tone} />
              </View>
              <Txt variant="xs" tone="muted" style={{ marginTop: spacing.xs }}>
                {num(format(new Date(e.startedAt), 'dd MMM yyyy, HH:mm:ss'))}
                {secs !== null && e.outcome !== 'suppressed' ? `  ·  ${t('{n}s', { n: secs })}` : ''}
                {e.background ? `  ·  ${t('in background')}` : ''}
              </Txt>
              {(e.duplicates ?? 0) > 0 && (
                <Txt variant="xs" tone="muted">{t('{n} more detections during this alert were ignored', { n: e.duplicates ?? 0 })}</Txt>
              )}
              {e.outcome === 'suppressed' && (e.count ?? 1) > 1 && (
                <Txt variant="xs" tone="muted">{t('{n} detections merged', { n: e.count ?? 1 })}</Txt>
              )}
              {e.detail ? <Txt variant="xs" tone="sub">{t(e.detail)}</Txt> : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}
