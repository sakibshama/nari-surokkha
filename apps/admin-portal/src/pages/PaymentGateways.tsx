/**
 * Payment Gateways — add, configure, test and switch SSLCommerz / Stripe
 * accounts and edit the subscription plans the mobile app sells. Everything is
 * stored server-side (secrets encrypted) and takes effect immediately.
 */
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  CreditCard, Plus, Save, Loader2, Trash2, PlugZap, Copy, Info, ChevronDown, ChevronUp, Receipt, RefreshCw, Package, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useT, fmt } from '../i18n';
import ConfirmDialog from '../components/ConfirmDialog';

type GatewayType = 'sslcommerz' | 'stripe';
type Mode = 'sandbox' | 'live';

interface Gateway {
  id: string;
  type: GatewayType;
  displayName: string;
  description: string;
  enabled: boolean;
  mode: Mode;
  currency: string;
  sortOrder: number;
  sslcommerz?: { storeId: string; storePasswordSet: boolean };
  stripe?: { publishableKey: string; secretKeySet: boolean; webhookSecretSet: boolean };
  callbackUrls: Record<string, string>;
  updatedAt: string;
}

interface Plan {
  id: string;
  name: string;
  nameBn: string;
  smsQuota: number;
  durationDays: number;
  prices: Record<string, number | undefined>;
  active: boolean;
}

interface Txn {
  transactionId: string;
  status: string;
  amount: number;
  currency: string;
  planId: string | null;
  gatewayId: string | null;
  gatewayType: string | null;
  gatewayTrxId: string | null;
  paymentMethod: string | null;
  failureReason: string | null;
  createdAt: string;
  user: { phone?: string; name?: string };
}

const TYPE_LABEL: Record<GatewayType, string> = { sslcommerz: 'SSLCommerz', stripe: 'Stripe' };
const TYPE_HINT: Record<GatewayType, string> = {
  sslcommerz: 'bKash, Nagad, Rocket, cards and net banking in Bangladesh. Get a sandbox store at developer.sslcommerz.com.',
  stripe: 'International Visa / Mastercard / Amex via Stripe Checkout. Use a test (sk_test_) key in sandbox mode.',
};
const STATUS_BADGE: Record<string, string> = { success: 'success', pending: 'warning', failed: 'danger', cancelled: 'muted' };

const errMsg = (e: any, fallback: string) => {
  const status = e?.response?.status;
  const server = e?.response?.data?.error?.message || e?.response?.data?.message;
  if (server && status !== 404) return server;
  if (!e?.response) return `${fallback}: the API server is not reachable.`;
  if (status === 404) return `${fallback}: the API does not have the payment routes yet — restart (or rebuild) the API server.`;
  if (status === 401 || status === 403) return `${fallback}: your account needs the admin or superadmin role.`;
  return server || fallback;
};

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(() => toast.success('Copied'), () => toast.error('Copy failed'));
}

// ─── One gateway ──────────────────────────────────────────────────────────────
function GatewayCard({
  g, currencies, onSaved, onDeleted, initiallyOpen = false,
}: { g: Gateway; currencies: string[]; onSaved: (g: Gateway) => void; onDeleted: (id: string) => void; initiallyOpen?: boolean }) {
  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [open, setOpen] = useState(initiallyOpen || (!g.enabled && !(g.sslcommerz?.storePasswordSet || g.stripe?.secretKeySet)));
  const [form, setForm] = useState({
    displayName: g.displayName,
    description: g.description,
    mode: g.mode,
    currency: g.currency,
    sortOrder: g.sortOrder,
    storeId: g.sslcommerz?.storeId ?? '',
    storePassword: '',
    publishableKey: g.stripe?.publishableKey ?? '',
    secretKey: '',
    webhookSecret: '',
  });
  const [busy, setBusy] = useState<'' | 'save' | 'test' | 'toggle' | 'delete'>('');
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const payload = (extra: Record<string, unknown> = {}) => ({
    displayName: form.displayName,
    description: form.description,
    mode: form.mode,
    currency: form.currency,
    sortOrder: Number(form.sortOrder) || 0,
    ...(g.type === 'sslcommerz'
      ? { sslcommerz: { storeId: form.storeId, storePassword: form.storePassword } }
      : { stripe: { publishableKey: form.publishableKey, secretKey: form.secretKey, webhookSecret: form.webhookSecret } }),
    ...extra,
  });

  const save = async (extra: Record<string, unknown> = {}, kind: 'save' | 'toggle' = 'save') => {
    setBusy(kind);
    try {
      const res = await api.put(`/payments/admin/gateways/${g.id}`, payload(extra));
      onSaved(res.data.data);
      set({ storePassword: '', secretKey: '', webhookSecret: '' });
      toast.success(kind === 'toggle' ? (res.data.data.enabled ? 'Gateway enabled' : 'Gateway disabled') : 'Gateway saved');
    } catch (e) {
      toast.error(errMsg(e, 'Could not save the gateway'));
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const res = await api.post(`/payments/admin/gateways/${g.id}/test`);
      const d = res.data?.data;
      (d?.ok ? toast.success : toast.error)(d?.message || 'Test finished');
    } catch (e) {
      toast.error(errMsg(e, 'Test failed'));
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    setConfirmDelete(false);
    setBusy('delete');
    try {
      await api.delete(`/payments/admin/gateways/${g.id}`);
      onDeleted(g.id);
      toast.success('Gateway deleted');
    } catch (e) {
      toast.error(errMsg(e, 'Could not delete'));
      setBusy('');
    }
  };

  const secretSet = g.type === 'stripe' ? g.stripe?.secretKeySet : g.sslcommerz?.storePasswordSet;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: open ? '1px solid var(--border)' : 'none' }}>
        <div className="stat-card-icon" style={{ marginBottom: 0, background: g.type === 'stripe' ? 'rgba(99,91,255,0.14)' : 'var(--green-dim)', color: g.type === 'stripe' ? '#635bff' : 'var(--green)' }}>
          <CreditCard size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ color: 'var(--text)', fontSize: 16 }}>{g.displayName}</strong>
            <span className="badge info">{TYPE_LABEL[g.type]}</span>
            <span className={`badge ${g.mode === 'live' ? 'danger' : 'warning'}`}>{g.mode === 'live' ? t('Live') : t('Sandbox')}</span>
            <span className="badge muted">{g.currency}</span>
            <span className={`badge ${g.enabled ? 'success' : 'muted'}`}>{g.enabled ? t('Enabled') : t('Disabled')}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{g.description || TYPE_HINT[g.type]}</div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-sub)' }}>
          <input type="checkbox" checked={g.enabled} disabled={!!busy} onChange={(e) => save({ enabled: e.target.checked }, 'toggle')} />
          {t('Show in app')}
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>

      {open && (
        <form
          style={{ padding: 20 }}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px', display: 'flex', gap: 6 }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {TYPE_HINT[g.type]}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div className="field">
              <label className="field-label">{t('Name shown in the app')}</label>
              <input className="field-input" value={form.displayName} maxLength={60} onChange={(e) => set({ displayName: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">{t('Subtitle shown in the app')}</label>
              <input className="field-input" value={form.description} maxLength={120} onChange={(e) => set({ description: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">{t('Mode')}</label>
              <select className="field-input" value={form.mode} onChange={(e) => set({ mode: e.target.value as Mode })}>
                <option value="sandbox">{t('Sandbox (test payments)')}</option>
                <option value="live">{t('Live (real money)')}</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">{t('Currency')}</label>
              <select className="field-input" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
                {currencies.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field-label">{t('Order in the app')}</label>
              <input className="field-input" type="number" min={0} max={100} value={form.sortOrder} onChange={(e) => set({ sortOrder: Number(e.target.value) })} />
            </div>
          </div>

          {g.type === 'sslcommerz' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div className="field">
                <label className="field-label">{t('Store ID')}</label>
                <input className="field-input" value={form.storeId} autoComplete="off" spellCheck={false} style={{ fontFamily: 'monospace' }} onChange={(e) => set({ storeId: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">
                  {t('Store password')} {g.sslcommerz?.storePasswordSet && <span style={{ color: 'var(--green)' }}>· {t('saved')}</span>}
                </label>
                <input
                  className="field-input" type="password" autoComplete="new-password" style={{ fontFamily: 'monospace' }}
                  placeholder={g.sslcommerz?.storePasswordSet ? '•••••••• (leave blank to keep)' : 'Enter store password'}
                  value={form.storePassword} onChange={(e) => set({ storePassword: e.target.value })}
                />
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div className="field">
                <label className="field-label">{t('Publishable key')}</label>
                <input className="field-input" value={form.publishableKey} placeholder="pk_test_…" autoComplete="off" spellCheck={false} style={{ fontFamily: 'monospace' }} onChange={(e) => set({ publishableKey: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">
                  {t('Secret key')} {g.stripe?.secretKeySet && <span style={{ color: 'var(--green)' }}>· {t('saved')}</span>}
                </label>
                <input
                  className="field-input" type="password" autoComplete="new-password" style={{ fontFamily: 'monospace' }}
                  placeholder={g.stripe?.secretKeySet ? '•••••••• (leave blank to keep)' : 'sk_test_… or rk_test_…'}
                  value={form.secretKey} onChange={(e) => set({ secretKey: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="field-label">
                  {t('Webhook signing secret')} {g.stripe?.webhookSecretSet && <span style={{ color: 'var(--green)' }}>· {t('saved')}</span>}
                </label>
                <input
                  className="field-input" type="password" autoComplete="new-password" style={{ fontFamily: 'monospace' }}
                  placeholder={g.stripe?.webhookSecretSet ? '•••••••• (leave blank to keep)' : 'whsec_…'}
                  value={form.webhookSecret} onChange={(e) => set({ webhookSecret: e.target.value })}
                />
              </div>
            </div>
          )}

          <div style={{ margin: '4px 0 16px', padding: '10px 12px', borderRadius: 8, background: 'var(--bg-card-alt)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-sub)', marginBottom: 6 }}>
              {g.type === 'stripe'
                ? t('In the Stripe dashboard → Developers → Webhooks, add this endpoint with events checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed and checkout.session.expired, then paste its signing secret above:')
                : t('Optional: set this as the IPN URL in your SSLCommerz merchant panel (the app also sends it with every payment):')}
            </div>
            {Object.entries(g.callbackUrls).map(([k, url]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ fontSize: 12, wordBreak: 'break-all', flex: 1, color: 'var(--text)' }}>{url}</code>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(url)} title="Copy">
                  <Copy size={14} />
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" disabled={!!busy}>
              {busy === 'save' ? <Loader2 size={16} className="spin" /> : <Save size={16} />} {t('Save')}
            </button>
            <button type="button" className="btn btn-ghost" disabled={!!busy || !secretSet} onClick={test} title={secretSet ? '' : 'Save the credentials first'}>
              {busy === 'test' ? <Loader2 size={16} className="spin" /> : <PlugZap size={16} />} {t('Test connection')}
            </button>
            <div style={{ flex: 1 }} />
            <button type="button" className="btn btn-danger" disabled={!!busy} onClick={() => setConfirmDelete(true)}>
              {busy === 'delete' ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />} {t('Delete')}
            </button>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={confirmDelete}
        danger
        title={fmt(t('Delete “{name}”?'), { name: g.displayName })}
        message={t('The app will stop offering it immediately. Past payments are kept.')}
        confirmLabel={t('Delete')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => { void remove(); }}
      />
    </div>
  );
}

// ─── Plans ────────────────────────────────────────────────────────────────────
function PlansEditor({ initial, currencies, onSaved }: { initial: Plan[]; currencies: string[]; onSaved: (p: Plan[]) => void }) {
  const t = useT();
  const [plans, setPlans] = useState<Plan[]>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setPlans(initial), [initial]);

  const patch = (i: number, p: Partial<Plan>) => setPlans((all) => all.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const setPrice = (i: number, c: string, v: string) =>
    setPlans((all) => all.map((x, j) => (j === i ? { ...x, prices: { ...x.prices, [c]: v === '' ? undefined : Number(v) } } : x)));

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put('/payments/admin/plans', { plans });
      onSaved(res.data.data);
      toast.success('Plans saved');
    } catch (e) {
      toast.error(errMsg(e, 'Could not save plans'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="data-table-wrapper">
      <div className="data-table-header">
        <div className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Package size={18} color="var(--purple)" /> {t('Subscription plans')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button" className="btn btn-ghost btn-sm"
            onClick={() => setPlans((p) => [...p, { id: `plan_${p.length + 1}`, name: '', nameBn: '', smsQuota: 12, durationDays: 30, prices: {}, active: true }])}
          >
            <Plus size={14} /> {t('Add plan')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {t('Save plans')}
          </button>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="portal-table">
          <thead>
            <tr>
              <th>{t('ID')}</th>
              <th>{t('Name')}</th>
              <th>{t('Name (Bangla)')}</th>
              <th>{t('SMS / period')}</th>
              <th>{t('Days')}</th>
              {currencies.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th>{t('Active')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {plans.map((p, i) => (
              <tr key={i}>
                <td><input className="field-input" style={{ minWidth: 110, fontFamily: 'monospace' }} value={p.id} onChange={(e) => patch(i, { id: e.target.value })} /></td>
                <td><input className="field-input" style={{ minWidth: 140 }} value={p.name} onChange={(e) => patch(i, { name: e.target.value })} /></td>
                <td><input className="field-input" style={{ minWidth: 140 }} value={p.nameBn} onChange={(e) => patch(i, { nameBn: e.target.value })} /></td>
                <td><input className="field-input" style={{ width: 80 }} type="number" min={0} value={p.smsQuota} onChange={(e) => patch(i, { smsQuota: Number(e.target.value) })} /></td>
                <td><input className="field-input" style={{ width: 80 }} type="number" min={1} value={p.durationDays} onChange={(e) => patch(i, { durationDays: Number(e.target.value) })} /></td>
                {currencies.map((c) => (
                  <td key={c}>
                    <input
                      className="field-input" style={{ width: 90 }} type="number" min={0} step="0.01" placeholder="—"
                      value={p.prices[c] ?? ''} onChange={(e) => setPrice(i, c, e.target.value)}
                    />
                  </td>
                ))}
                <td><input type="checkbox" checked={p.active} onChange={(e) => patch(i, { active: e.target.checked })} /></td>
                <td>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={plans.length <= 1} onClick={() => setPlans((all) => all.filter((_, j) => j !== i))}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 20px 16px', margin: 0 }}>
        {t('A gateway offers a plan only if the plan has a price in that gateway\'s currency. Leave a price empty to hide the plan from that gateway.')}
      </p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
// ─── Add gateway dialog ───────────────────────────────────────────────────────
const ADD_DEFAULTS: Record<GatewayType, { displayName: string; description: string; currency: string }> = {
  sslcommerz: { displayName: 'bKash / Nagad / Card', description: 'Pay in BDT with SSLCommerz', currency: 'BDT' },
  stripe: { displayName: 'International card', description: 'Visa, Mastercard, Amex via Stripe', currency: 'USD' },
};

function AddGatewayDialog({
  type, currencies, encryptionOk, onClose, onAdded,
}: { type: GatewayType; currencies: string[]; encryptionOk: boolean; onClose: () => void; onAdded: (g: Gateway) => void }) {
  const t = useT();
  const d = ADD_DEFAULTS[type];
  const [form, setForm] = useState({
    displayName: d.displayName, description: d.description, mode: 'sandbox' as Mode,
    currency: currencies.includes(d.currency) ? d.currency : currencies[0] ?? d.currency,
    storeId: '', storePassword: '', publishableKey: '', secretKey: '', webhookSecret: '', enable: false,
  });
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const hasSecret = type === 'sslcommerz' ? !!form.storePassword : !!(form.secretKey || form.webhookSecret);
  const complete = type === 'sslcommerz'
    ? !!(form.storeId.trim() && form.storePassword)
    : !!(form.secretKey.trim() && form.webhookSecret.trim());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.displayName.trim()) return toast.error('Enter the name shown in the app');
    if (form.secretKey && !/^(sk|rk)_/.test(form.secretKey.trim())) return toast.error('The Stripe secret key starts with sk_ or rk_');
    if (form.webhookSecret && !form.webhookSecret.trim().startsWith('whsec_')) return toast.error('The webhook signing secret starts with whsec_');
    if (form.publishableKey && !form.publishableKey.trim().startsWith('pk_')) return toast.error('The publishable key starts with pk_');
    if (hasSecret && !encryptionOk) return toast.error('Set CONFIG_ENCRYPTION_KEY on the server first, or add the gateway without the secret now and fill it in later.');
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        type,
        displayName: form.displayName.trim(),
        description: form.description.trim(),
        mode: form.mode,
        currency: form.currency,
        enabled: form.enable && complete,
        ...(type === 'sslcommerz'
          ? { sslcommerz: { storeId: form.storeId.trim(), storePassword: form.storePassword } }
          : { stripe: { publishableKey: form.publishableKey.trim(), secretKey: form.secretKey.trim(), webhookSecret: form.webhookSecret.trim() } }),
      };
      const res = await api.post('/payments/admin/gateways', body);
      onAdded(res.data.data);
      toast.success(
        res.data.data.enabled
          ? `${TYPE_LABEL[type]} added and shown in the app.`
          : complete
            ? `${TYPE_LABEL[type]} added. Test the connection, then tick "Show in app".`
            : `${TYPE_LABEL[type]} added. Enter the remaining credentials in its card to enable it.`,
      );
      onClose();
    } catch (err) {
      toast.error(errMsg(err, `Could not add ${TYPE_LABEL[type]}`));
    } finally {
      setBusy(false);
    }
  };

  const mono = { fontFamily: 'monospace' } as const;
  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Add ${TYPE_LABEL[type]}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', padding: 16 }}
    >
      <form onSubmit={submit} className="card animate-in" style={{ width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto', padding: 0, border: '1px solid var(--border)' }}>
        <div style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)' }}>
          <div className="stat-card-icon" style={{ marginBottom: 0, background: type === 'stripe' ? 'rgba(99,91,255,0.14)' : 'var(--green-dim)', color: type === 'stripe' ? '#635bff' : 'var(--green)' }}>
            <CreditCard size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <strong style={{ color: 'var(--text)', fontSize: 17 }}>{t('Add')} {TYPE_LABEL[type]}</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{TYPE_HINT[type]}</div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy} aria-label="Close"><X size={16} /></button>
        </div>

        <div style={{ padding: 22 }}>
          {!encryptionOk && (
            <p style={{ fontSize: 12, color: 'var(--text-sub)', margin: '0 0 14px', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(245,158,11,0.4)' }}>
              {t('CONFIG_ENCRYPTION_KEY is not set on the server.')} {t('You can add the gateway now and enter its secret later.')}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div className="field">
              <label className="field-label">{t('Name shown in the app')}</label>
              <input className="field-input" value={form.displayName} maxLength={60} required autoFocus onChange={(e) => set({ displayName: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">{t('Subtitle shown in the app')}</label>
              <input className="field-input" value={form.description} maxLength={120} onChange={(e) => set({ description: e.target.value })} />
            </div>
            <div className="field">
              <label className="field-label">{t('Mode')}</label>
              <select className="field-input" value={form.mode} onChange={(e) => set({ mode: e.target.value as Mode })}>
                <option value="sandbox">{t('Sandbox (test payments)')}</option>
                <option value="live">{t('Live (real money)')}</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">{t('Currency')}</label>
              <select className="field-input" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
                {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {type === 'sslcommerz' ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div className="field">
                <label className="field-label">{t('Store ID')}</label>
                <input className="field-input" value={form.storeId} maxLength={100} autoComplete="off" spellCheck={false} style={mono} placeholder="yourstore0abc1" onChange={(e) => set({ storeId: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">{t('Store password')}</label>
                <input className="field-input" type="password" maxLength={200} autoComplete="new-password" style={mono} placeholder="yourstore0abc1@ssl" value={form.storePassword} onChange={(e) => set({ storePassword: e.target.value })} />
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div className="field">
                <label className="field-label">{t('Publishable key')}</label>
                <input className="field-input" value={form.publishableKey} maxLength={255} placeholder="pk_test_…" autoComplete="off" spellCheck={false} style={mono} onChange={(e) => set({ publishableKey: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">{t('Secret key')}</label>
                <input className="field-input" type="password" maxLength={255} autoComplete="new-password" style={mono} placeholder="sk_test_… or rk_test_…" value={form.secretKey} onChange={(e) => set({ secretKey: e.target.value })} />
              </div>
              <div className="field">
                <label className="field-label">{t('Webhook signing secret')}</label>
                <input className="field-input" type="password" maxLength={255} autoComplete="new-password" style={mono} placeholder="whsec_… (can be added later)" value={form.webhookSecret} onChange={(e) => set({ webhookSecret: e.target.value })} />
              </div>
            </div>
          )}

          {type === 'stripe' && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', display: 'flex', gap: 6 }}>
              <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              {t('The webhook URL to register in Stripe is shown in the gateway card after you add it.')}
            </p>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: complete ? 'var(--text-sub)' : 'var(--text-muted)', cursor: complete ? 'pointer' : 'not-allowed' }}>
            <input type="checkbox" checked={form.enable && complete} disabled={!complete} onChange={(e) => set({ enable: e.target.checked })} />
            {t('Show in app right away')}
            {!complete && <span style={{ fontSize: 12 }}>({t('needs all credentials')})</span>}
          </label>
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{t('Cancel')}</button>
          <button type="submit" className={`btn ${type === 'stripe' ? 'btn-blue' : 'btn-primary'}`} disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} {t('Add')} {TYPE_LABEL[type]}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function PaymentGateways() {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [currencies, setCurrencies] = useState<string[]>(['BDT', 'USD']);
  const [encryptionOk, setEncryptionOk] = useState(true);
  const [adding, setAdding] = useState<GatewayType | ''>('');
  const [newestId, setNewestId] = useState('');
  const [txns, setTxns] = useState<Txn[]>([]);
  const [txnFilter, setTxnFilter] = useState('');
  const [txnLoading, setTxnLoading] = useState(false);

  const load = async () => {
    try {
      const res = await api.get('/payments/admin/config');
      const d = res.data.data;
      setGateways(d.gateways);
      setPlans(d.plans);
      setCurrencies(d.currencies);
      setEncryptionOk(d.encryptionConfigured);
    } catch (e) {
      toast.error(errMsg(e, 'Could not load payment settings'));
    } finally {
      setLoading(false);
    }
  };

  const loadTxns = async (status = txnFilter) => {
    setTxnLoading(true);
    try {
      const res = await api.get('/payments/admin/transactions', { params: { limit: 50, ...(status ? { status } : {}) } });
      setTxns(res.data.data);
    } catch {
      /* table shows empty */
    } finally {
      setTxnLoading(false);
    }
  };

  useEffect(() => {
    void load();
    void loadTxns('');
  }, []);

  // Currencies worth showing as price columns: the ones gateways use, plus BDT/USD.
  const priceCurrencies = useMemo(
    () => currencies.filter((c) => c === 'BDT' || c === 'USD' || gateways.some((g) => g.currency === c) || plans.some((p) => p.prices[c])),
    [currencies, gateways, plans],
  );
  const live = gateways.filter((g) => g.enabled);

  return (
    <div className="animate-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">{t('Payment Gateways')}</h1>
            <p className="page-subtitle">
              {t('Add SSLCommerz and Stripe accounts, switch them between sandbox and live, and edit the plans the app sells. Changes apply immediately.')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={loading} onClick={() => setAdding('sslcommerz')}>
              <Plus size={16} /> {t('Add')} SSLCommerz
            </button>
            <button type="button" className="btn btn-blue" disabled={loading} onClick={() => setAdding('stripe')}>
              <Plus size={16} /> {t('Add')} Stripe
            </button>
          </div>
        </div>
      </div>

      {!encryptionOk && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(245,158,11,0.4)' }}>
          <strong style={{ color: 'var(--text)' }}>{t('CONFIG_ENCRYPTION_KEY is not set on the server.')}</strong>
          <p style={{ fontSize: 13, color: 'var(--text-sub)', margin: '6px 0 0' }}>
            {t('Gateway secrets are encrypted at rest and cannot be saved without it. Set a 32-byte key (openssl rand -hex 32) and restart the API.')} {t('You can add the gateway now and enter its secret later.')}
          </p>
        </div>
      )}

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="stat-card"><div className="stat-card-label">{t('Gateways')}</div><div className="stat-card-value">{gateways.length}</div></div>
        <div className="stat-card"><div className="stat-card-label">{t('Shown in app')}</div><div className="stat-card-value">{live.length}</div></div>
        <div className="stat-card"><div className="stat-card-label">{t('Live mode')}</div><div className="stat-card-value">{live.filter((g) => g.mode === 'live').length}</div></div>
        <div className="stat-card"><div className="stat-card-label">{t('Active plans')}</div><div className="stat-card-value">{plans.filter((p) => p.active).length}</div></div>
      </div>

      {loading ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}><Loader2 className="spin" /></div>
      ) : gateways.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <CreditCard size={48} />
            <p>{t('No payment gateway yet. Add SSLCommerz for bKash / Nagad / cards in BDT, or Stripe for international cards.')}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 12 }}>
              <button type="button" className="btn btn-primary" onClick={() => setAdding('sslcommerz')}><Plus size={16} /> {t('Add')} SSLCommerz</button>
              <button type="button" className="btn btn-blue" onClick={() => setAdding('stripe')}><Plus size={16} /> {t('Add')} Stripe</button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16, marginBottom: 24 }}>
          {gateways.map((g) => (
            <GatewayCard
              key={g.id}
              g={g}
              initiallyOpen={g.id === newestId}
              currencies={currencies}
              onSaved={(n) => setGateways((all) => all.map((x) => (x.id === n.id ? n : x)))}
              onDeleted={(id) => setGateways((all) => all.filter((x) => x.id !== id))}
            />
          ))}
        </div>
      )}

      {!loading && (
        <div style={{ marginBottom: 24 }}>
          <PlansEditor initial={plans} currencies={priceCurrencies} onSaved={setPlans} />
        </div>
      )}

      <div className="data-table-wrapper">
        <div className="data-table-header">
          <div className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Receipt size={18} color="var(--purple)" /> {t('Recent payments')} ({txns.length})
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select className="field-input" style={{ width: 150 }} value={txnFilter} onChange={(e) => { setTxnFilter(e.target.value); void loadTxns(e.target.value); }}>
              <option value="">{t('All statuses')}</option>
              <option value="success">{t('Successful')}</option>
              <option value="pending">{t('Pending')}</option>
              <option value="failed">{t('Failed')}</option>
              <option value="cancelled">{t('Cancelled')}</option>
            </select>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadTxns()} disabled={txnLoading}>
              {txnLoading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>{t('Time')}</th>
                <th>{t('User')}</th>
                <th>{t('Plan')}</th>
                <th>{t('Amount')}</th>
                <th>{t('Gateway')}</th>
                <th>{t('Status')}</th>
                <th>{t('Reference')}</th>
              </tr>
            </thead>
            <tbody>
              {txns.length === 0 ? (
                <tr><td colSpan={7}><div className="empty-state"><Receipt size={40} /><p>{t('No payments yet.')}</p></div></td></tr>
              ) : (
                txns.map((x) => (
                  <tr key={x.transactionId}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(x.createdAt).toLocaleString()}</td>
                    <td>{x.user?.name || '—'}<div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{x.user?.phone}</div></td>
                    <td className="cell-mono">{x.planId}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{x.amount.toFixed(2)} {x.currency}</td>
                    <td>
                      {x.gatewayType ? TYPE_LABEL[x.gatewayType as GatewayType] ?? x.gatewayType : '—'}
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{x.paymentMethod}</div>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[x.status] ?? 'muted'}`}>{x.status}</span>
                      {x.failureReason && <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 220 }}>{x.failureReason}</div>}
                    </td>
                    <td className="cell-mono" style={{ fontSize: 12 }}>{x.transactionId}<div style={{ color: 'var(--text-muted)' }}>{x.gatewayTrxId}</div></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <AddGatewayDialog
          type={adding}
          currencies={currencies}
          encryptionOk={encryptionOk}
          onClose={() => setAdding('')}
          onAdded={(g) => { setGateways((all) => [...all, g]); setNewestId(g.id); }}
        />
      )}
    </div>
  );
}
