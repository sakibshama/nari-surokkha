/**
 * Subscription — plans and payment methods come from the server, where an
 * admin manages them in the portal (SSLCommerz for bKash / Nagad / cards in
 * BDT, Stripe for international cards). Nothing here is hard-coded.
 *
 * Paying opens the gateway's page in the browser. When the user comes back
 * (app returns to the foreground, or the result page's "Open the app" deep
 * link), the payment is polled until the server has verified it with the
 * gateway.
 */
import { useRoute, type RouteProp } from '@react-navigation/native';
import type { MainStackParamList } from '../../navigation/MainStack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { AlertCircle, CheckCircle2, CreditCard, Globe, MessageSquare, RefreshCw, Smartphone, Wallet } from 'lucide-react-native';
import { AppBar, Badge, Button, Card, EmptyState, Screen, SectionLabel, Txt } from '../../components/ui';
import { useTheme } from '../../theme';
import { radius, spacing } from '../../theme/tokens';
import { useLanguage, useT } from '../../i18n';
import api from '../../services/api';
import { showAlert, toast } from '../../utils/notify';

interface GatewayOption {
  gatewayId: string;
  type: 'sslcommerz' | 'stripe';
  displayName: string;
  description: string;
  mode: 'sandbox' | 'live';
  currency: string;
}
interface PlanOption {
  id: string;
  name: string;
  nameBn: string;
  smsQuota: number;
  durationDays: number;
  prices: Record<string, { amount: number; currency: string }>;
}
interface Subscription {
  status: 'active' | 'expired' | 'inactive' | 'cancelled' | string;
  planId: string;
  planName?: string;
  planNameBn?: string;
  endDate?: string;
  smsRemaining?: number;
}

const POLL_MS = 3000;
const POLL_LIMIT_MS = 90_000;

function money(amount: number, currency: string, num: (n: number | string) => string) {
  const symbol: Record<string, string> = { BDT: '৳', USD: '$', EUR: '€', GBP: '£', INR: '₹' };
  const s = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${symbol[currency] ?? `${currency} `}${num(s)}`;
}

export default function SubscriptionScreen() {
  const route = useRoute<RouteProp<MainStackParamList, 'Subscription'>>();
  const { colors } = useTheme();
  const t = useT();
  const { num, isBangla } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sub, setSub] = useState<Subscription | null>(null);
  const [gateways, setGateways] = useState<GatewayOption[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planId, setPlanId] = useState<string>('');
  const [gatewayId, setGatewayId] = useState<string>('');
  const [paying, setPaying] = useState(false);
  const [checking, setChecking] = useState<string | null>(null); // transaction being confirmed
  const pendingTrx = useRef<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, o] = await Promise.all([api.get('/subscriptions/status'), api.get('/subscriptions/options')]);
      setSub(s.data?.data ?? null);
      const g: GatewayOption[] = o.data?.data?.gateways ?? [];
      const p: PlanOption[] = o.data?.data?.plans ?? [];
      setGateways(g);
      setPlans(p);
      setPlanId((cur) => (p.some((x) => x.id === cur) ? cur : p[0]?.id ?? ''));
      setGatewayId((cur) => (g.some((x) => x.gatewayId === cur) ? cur : g[0]?.gatewayId ?? ''));
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || t('Could not load plans.'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── confirming a payment after the browser ──
  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const poll = useCallback(
    (trx: string, startedAt = Date.now()) => {
      stopPolling();
      setChecking(trx);
      const tick = async () => {
        try {
          const res = await api.get(`/subscriptions/payments/${encodeURIComponent(trx)}`);
          const status = res.data?.data?.status;
          if (status === 'success') {
            pendingTrx.current = null;
            setChecking(null);
            toast(t('Payment successful'), t('Your subscription is active.'), 'success');
            void load();
            return;
          }
          if (status === 'failed' || status === 'cancelled') {
            pendingTrx.current = null;
            setChecking(null);
            showAlert(status === 'failed' ? t('Payment failed') : t('Payment cancelled'), t('No money was taken for this attempt. You can try again.'));
            return;
          }
        } catch {
          /* network blip: keep polling */
        }
        if (Date.now() - startedAt > POLL_LIMIT_MS) {
          setChecking(null);
          showAlert(
            t('Still confirming'),
            t('The payment has not been confirmed yet. If you paid, it will appear here within a few minutes — tap refresh at the top.'),
          );
          return;
        }
        pollTimer.current = setTimeout(tick, POLL_MS);
      };
      void tick();
    },
    [load, t],
  );

  useEffect(() => {
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && pendingTrx.current) poll(pendingTrx.current);
    });
    const linkSub = Linking.addEventListener('url', ({ url }) => {
      const m = /[?&]trx=([^&]+)/.exec(url);
      const trx = m ? decodeURIComponent(m[1]) : pendingTrx.current;
      if (url.startsWith('narisurokkha://subscription') && trx) poll(trx);
    });
    return () => {
      appSub.remove();
      linkSub.remove();
      stopPolling();
    };
  }, [poll]);

  // Opened from the payment deep link (also on a cold start): confirm it.
  const trxParam = route.params?.trx;
  useEffect(() => {
    if (trxParam) poll(trxParam);
  }, [trxParam, poll]);

  const pay = async () => {
    if (!planId || !gatewayId) return;
    setPaying(true);
    try {
      const res = await api.post('/subscriptions/initiate', { planId, gatewayId });
      const { url, transactionId } = res.data?.data ?? {};
      if (!url) throw new Error(t('The payment page could not be opened.'));
      pendingTrx.current = transactionId ?? null;
      await Linking.openURL(url);
    } catch (e: any) {
      showAlert(t('Payment not started'), e?.response?.data?.error?.message || e?.response?.data?.message || e?.message || t('Please try again.'));
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <Screen scroll={false}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </Screen>
    );
  }

  const isActive = sub?.status === 'active';
  const plan = plans.find((p) => p.id === planId);
  const price = plan?.prices[gatewayId];
  const gw = gateways.find((g) => g.gatewayId === gatewayId);
  const planLabel = (p: { name?: string; nameBn?: string; planName?: string; planNameBn?: string }) =>
    (isBangla ? p.nameBn || p.planNameBn : '') || p.name || p.planName || '';

  return (
    <Screen>
      <AppBar
        title={t('Subscription')}
        subtitle={t('SMS alerts to your trusted contacts')}
        right={
          <Pressable onPress={() => { setLoading(true); void load(); }} accessibilityRole="button" accessibilityLabel={t('Refresh')} hitSlop={8}>
            <RefreshCw size={20} color={colors.textSub} />
          </Pressable>
        }
      />

      {/* ── Current plan ── */}
      <Card delay={20}>
        <View style={styles.row}>
          <View style={[styles.icon, { backgroundColor: isActive ? colors.successSoft : colors.warningSoft }]}>
            {isActive ? <CheckCircle2 color={colors.successText} size={26} /> : <AlertCircle color={colors.warningText} size={26} />}
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="sm" tone="muted">{t('Current Plan')}</Txt>
            <Txt variant="bodyStrong">{sub ? planLabel(sub) || sub.planId : t('No plan')}</Txt>
            <Txt variant="sm" tone={isActive ? 'success' : 'warning'}>
              {isActive ? t('Active') : sub?.status === 'expired' ? t('Expired') : t('Inactive')}
            </Txt>
          </View>
        </View>
        {sub && (
          <View style={[styles.details, { backgroundColor: colors.surfaceAlt }]}>
            <View style={styles.detailRow}>
              <Txt variant="sm" tone="sub">{t('SMS remaining')}</Txt>
              <Txt variant="smStrong">{num(isActive ? sub.smsRemaining ?? 0 : 0)}</Txt>
            </View>
            {sub.endDate && (
              <View style={styles.detailRow}>
                <Txt variant="sm" tone="sub">{isActive ? t('Renews / ends on') : t('Ended on')}</Txt>
                <Txt variant="smStrong">{num(new Date(sub.endDate).toLocaleDateString())}</Txt>
              </View>
            )}
          </View>
        )}
      </Card>

      {checking && (
        <Card tone="info" delay={0} style={{ marginTop: spacing.md }}>
          <View style={styles.row}>
            <ActivityIndicator color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Txt variant="bodyStrong">{t('Confirming your payment…')}</Txt>
              <Txt variant="xs" tone="muted">{t('Ref: {trx}', { trx: checking })}</Txt>
            </View>
          </View>
        </Card>
      )}

      {error ? (
        <EmptyState icon={<AlertCircle size={28} color={colors.textMuted} />} title={t('Could not load plans.')} message={error}
          action={<Button label={t('Try again')} variant="subtle" full={false} onPress={() => { setLoading(true); void load(); }} />} />
      ) : gateways.length === 0 || plans.length === 0 ? (
        <EmptyState
          icon={<Wallet size={28} color={colors.textMuted} />}
          title={t('Payments are not available yet')}
          message={t('Online payment has not been set up. Your SOS still works: when you have no SMS plan, the SOS text is sent from your own SIM.')}
        />
      ) : (
        <>
          {/* ── Plans ── */}
          <SectionLabel>{t('Choose a plan')}</SectionLabel>
          {plans.map((p, i) => {
            const selected = p.id === planId;
            const pp = p.prices[gatewayId];
            return (
              <Pressable key={p.id} onPress={() => setPlanId(p.id)} accessibilityRole="radio" accessibilityState={{ selected }}>
                <Card delay={60 + i * 30} style={[{ marginBottom: spacing.sm }, selected && { borderColor: colors.accent, borderWidth: 2 }]}>
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong">{planLabel(p)}</Txt>
                      <View style={[styles.row, { gap: spacing.xs, marginTop: 4 }]}>
                        <MessageSquare size={14} color={colors.textMuted} />
                        <Txt variant="xs" tone="muted">
                          {t('{sms} SMS alerts · {days} days', { sms: p.smsQuota, days: p.durationDays })}
                        </Txt>
                      </View>
                    </View>
                    <Txt variant="h3" style={{ color: selected ? colors.accent : colors.text }}>
                      {pp ? money(pp.amount, pp.currency, num) : '—'}
                    </Txt>
                  </View>
                  {!pp && <Txt variant="xs" tone="warning">{t('Not available with the selected payment method')}</Txt>}
                </Card>
              </Pressable>
            );
          })}

          {/* ── Payment method ── */}
          <SectionLabel>{t('Pay with')}</SectionLabel>
          {gateways.map((g) => {
            const selected = g.gatewayId === gatewayId;
            const Icon = g.type === 'stripe' ? Globe : Smartphone;
            return (
              <Pressable key={g.gatewayId} onPress={() => setGatewayId(g.gatewayId)} accessibilityRole="radio" accessibilityState={{ selected }}>
                <Card style={[{ marginBottom: spacing.sm }, selected && { borderColor: colors.accent, borderWidth: 2 }]}>
                  <View style={styles.row}>
                    <View style={[styles.icon, { width: 44, height: 44, backgroundColor: colors.accentSoft }]}>
                      <Icon size={22} color={colors.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt variant="bodyStrong">{g.displayName}</Txt>
                      {!!g.description && <Txt variant="xs" tone="muted">{g.description}</Txt>}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Badge label={g.currency} tone="neutral" />
                      {g.mode === 'sandbox' && <Badge label={t('Test mode')} tone="warning" />}
                    </View>
                  </View>
                </Card>
              </Pressable>
            );
          })}

          <Button
            label={
              price
                ? `${isActive ? t('Renew') : t('Pay')} ${money(price.amount, price.currency, num)}`
                : t('Choose another payment method')
            }
            onPress={pay}
            loading={paying}
            disabled={!price || !!checking}
            icon={<CreditCard size={18} color={colors.onAccent} />}
            style={{ marginTop: spacing.md }}
          />
          {gw?.mode === 'sandbox' && (
            <Txt variant="xs" tone="warning" center style={{ marginTop: spacing.xs }}>
              {t('Test mode: no real money is charged.')}
            </Txt>
          )}
          {isActive && (
            <Txt variant="xs" tone="muted" center style={{ marginTop: spacing.xs }}>
              {t('Renewing early adds the new period after the current one, and unused SMS carry over.')}
            </Txt>
          )}
        </>
      )}

      <View style={[styles.note, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}>
        <Txt variant="xs" tone="muted">
          {t('Your plan pays for SOS texts sent by our server. When the SMS quota is used up or the plan ends, your SOS still goes out: the text is sent from your own SIM (normal carrier charges), and app notifications keep working.')}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  details: { marginTop: spacing.md, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  note: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
});
