import { useState, useEffect, useMemo, useCallback } from 'react';
import { Shield, ShieldOff, Search, Ban } from 'lucide-react';
import api, { apiErrorMessage } from '../services/api';
import toast from 'react-hot-toast';
import { useT, fmt } from '../i18n';
import ConfirmDialog from '../components/ConfirmDialog';

type ResponderStatus = 'pending' | 'verified' | 'rejected' | 'suspended';

interface Responder {
  id: string;
  nationalId: string;
  organizationName: string;
  /** Contract 11: the real status, not just verified/not-verified. */
  status?: ResponderStatus;
  isVerified: boolean;
  createdAt: string;
  user: {
    phone: string;
    profile?: {
      fullName: string;
    };
  };
}

const STATUS_BADGE: Record<ResponderStatus, { label: string; className: string }> = {
  pending:   { label: 'Pending',   className: 'badge warning' },
  verified:  { label: 'Verified',  className: 'badge success' },
  rejected:  { label: 'Rejected',  className: 'badge danger' },
  suspended: { label: 'Suspended', className: 'badge muted' },
};

const FILTERS: ('all' | ResponderStatus)[] = ['all', 'pending', 'verified', 'rejected', 'suspended'];

const statusOf = (r: Responder): ResponderStatus => r.status ?? (r.isVerified ? 'verified' : 'pending');

export default function Responders() {
  const t = useT();
  const [responders, setResponders] = useState<Responder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | ResponderStatus>('all');
  const [suspendTarget, setSuspendTarget] = useState<Responder | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchResponders = useCallback(async () => {
    try {
      const res = await api.get('/admin/responders', { params: search ? { search } : {} });
      setResponders(res.data.data || []);
    } catch (error) {
      toast.error(apiErrorMessage(error, t('Failed to load responders')));
    } finally {
      setLoading(false);
    }
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = setTimeout(fetchResponders, 250);
    return () => clearTimeout(h);
  }, [fetchResponders]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: responders.length, pending: 0, verified: 0, rejected: 0, suspended: 0 };
    responders.forEach(r => { c[statusOf(r)]++; });
    return c;
  }, [responders]);

  const visible = useMemo(
    () => responders.filter(r => filter === 'all' || statusOf(r) === filter),
    [responders, filter],
  );

  const handleUpdateStatus = async (id: string, isVerified: boolean) => {
    try {
      await api.patch(`/admin/responders/${id}/verify`, { isVerified });
      toast.success(isVerified ? t('Responder verified') : t('Responder rejected'));
      fetchResponders();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('Failed to update status')));
    }
  };

  const confirmSuspend = async () => {
    if (!suspendTarget) return;
    setBusy(true);
    try {
      // The API keeps suspend semantics for DELETE (contract 11): the account
      // and history stay, the responder just stops receiving dispatches.
      await api.delete(`/admin/responders/${suspendTarget.id}`);
      toast.success(t('Responder suspended'));
      setSuspendTarget(null);
      fetchResponders();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('Failed to suspend responder')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="animate-in">
      <div className="page-header">
        <div className="page-header-row">
          <div>
            <h1 className="page-title">{t('Responders Management')}</h1>
            <p className="page-subtitle">{t('Verify and manage community responders.')}</p>
          </div>
        </div>
      </div>

      <div className="data-table-wrapper">
        <div className="data-table-header">
          <div className="data-table-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={18} color="var(--blue)" />
            {t('Community Responders')} ({visible.length})
          </div>
          <div className="data-table-search">
            <Search size={16} />
            <input
              type="text"
              placeholder={t('Search by organization, name or phone…')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="filter-tabs" style={{ padding: '12px 20px 4px' }} role="tablist">
          {FILTERS.map(f => (
            <button key={f} type="button" role="tab" aria-selected={filter === f}
              className={`filter-tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? t('All') : t(STATUS_BADGE[f].label)} ({counts[f] ?? 0})
            </button>
          ))}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="portal-table">
            <thead>
              <tr>
                <th>{t('Responder Info')}</th>
                <th>{t('National ID')}</th>
                <th>{t('Organization')}</th>
                <th>{t('Status')}</th>
                <th style={{ textAlign: 'right' }}>{t('Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '40px' }}>{t('Loading responders…')}</td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="empty-state">
                      <Shield size={48} />
                      <p>{t('No responders found matching your criteria.')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                visible.map((responder) => {
                  const status = statusOf(responder);
                  const badge = STATUS_BADGE[status];
                  return (
                    <tr key={responder.id}>
                      <td>
                        <div className="cell-primary">{responder.user.profile?.fullName || t('Unknown')}</div>
                        <div className="cell-sub">{responder.user.phone}</div>
                      </td>
                      <td><span className="cell-mono">{responder.nationalId || 'N/A'}</span></td>
                      <td>{responder.organizationName || t('Individual')}</td>
                      <td><span className={badge.className}>{t(badge.label)}</span></td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          {status === 'verified' ? (
                            <button className="btn btn-ghost btn-sm" onClick={() => handleUpdateStatus(responder.id, false)} title={t('Revoke verification')}>
                              <ShieldOff size={14} color="var(--amber)" /> {t('Revoke')}
                            </button>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => handleUpdateStatus(responder.id, true)}
                              title={status === 'suspended' ? t('Verify (reinstate)') : t('Verify')}>
                              <Shield size={14} color="var(--green)" /> {status === 'suspended' ? t('Reinstate') : t('Verify')}
                            </button>
                          )}
                          {status !== 'suspended' && (
                            <button className="btn btn-danger btn-sm" onClick={() => setSuspendTarget(responder)} title={t('Suspend responder')}>
                              <Ban size={14} /> {t('Suspend')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!suspendTarget}
        danger
        title={fmt(t('Suspend {name}?'), { name: suspendTarget?.user.profile?.fullName || suspendTarget?.user.phone || '' })}
        message={t('A suspended responder stops receiving SOS dispatches. Their account and history are kept, and you can reinstate them later with Verify.')}
        confirmLabel={t('Suspend')}
        busy={busy}
        onCancel={() => setSuspendTarget(null)}
        onConfirm={() => { void confirmSuspend(); }}
      />
    </div>
  );
}
