/**
 * Small reusable confirmation dialog — replaces window.confirm(), which is
 * unstyled, untranslatable and blocks the page (and the live SOS feed).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useT } from '../i18n';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
  /** Show an optional free-text note field; its value is passed to onConfirm. */
  withNote?: boolean;
  notePlaceholder?: string;
  busy?: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel, danger, withNote, notePlaceholder, busy, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const t = useT();
  const [note, setNote] = useState('');

  useEffect(() => { if (open) setNote(''); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog" aria-modal="true" aria-label={title}
      onClick={() => { if (!busy) onCancel(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', padding: 16 }}
    >
      <div className="card animate-in" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '20px 22px 8px' }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: danger ? 'rgba(225,29,58,0.12)' : 'rgba(37,99,235,0.12)' }}>
            <AlertTriangle size={18} color={danger ? '#e11d3a' : '#2563eb'} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: '2px 0 6px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
            {message && <div style={{ fontSize: 13.5, color: 'var(--text-sub)', lineHeight: 1.55 }}>{message}</div>}
          </div>
          <button type="button" aria-label={t('Close')} onClick={onCancel} disabled={busy}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 2 }}>
            <X size={18} />
          </button>
        </div>
        {withNote && (
          <div className="field" style={{ padding: '8px 22px 0', margin: 0 }}>
            <label className="field-label" htmlFor="confirm-note">{t('Note (optional)')}</label>
            <textarea id="confirm-note" className="field-input" rows={3} maxLength={500} value={note}
              placeholder={notePlaceholder} onChange={(e) => setNote(e.target.value)} style={{ resize: 'vertical' }} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '18px 22px 20px' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>{cancelLabel ?? t('Cancel')}</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={() => onConfirm(note.trim())}>
            {busy && <Loader2 size={14} className="spin" />} {confirmLabel ?? t('Confirm')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
