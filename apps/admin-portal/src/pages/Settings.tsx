/**
 * Settings — account (profile, password, appearance) and system integrations
 * (SMS gateway, SOS message, maps), one focused section at a time.
 *
 * Every section keeps its own draft; switching sections never loses edits and
 * the nav marks sections with unsaved changes. Deep link with #section.
 */
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  User, Shield, Moon, Sun, Save, Loader2, Info, Map as MapIcon, MessageSquare, Send, Palette, Eye, EyeOff,
  Lock, Check, X, Phone, Mail, BadgeCheck, RotateCcw, Smartphone, AlertTriangle, CheckCircle2, Globe, KeyRound, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import api from '../services/api';
import { useLangStore, useT } from '../i18n';
import ConfirmDialog from '../components/ConfirmDialog';
import './Settings.css';

// ─── Types & helpers ──────────────────────────────────────────────────────────
type SmsProvider = 'mock' | 'twilio' | 'bulksmsbd';
type SectionId = 'profile' | 'security' | 'appearance' | 'sms' | 'message' | 'maps';

interface SmsConfigPublic {
  provider: SmsProvider;
  senderId: string;
  enabled: boolean;
  twilio: { accountSid: string; fromNumber: string; authTokenSet: boolean };
  bulksmsbd: { senderId: string; apiKeySet: boolean };
}

const DEFAULT_SMS: SmsConfigPublic = {
  provider: 'twilio',
  senderId: 'NariSurokkha',
  enabled: false,
  twilio: { accountSid: '', fromNumber: '', authTokenSet: false },
  bulksmsbd: { senderId: '', apiKeySet: false },
};

const SECTION_IDS: SectionId[] = ['profile', 'security', 'appearance', 'sms', 'message', 'maps'];

const apiError = (e: any, fallback: string): string => {
  const status = e?.response?.status;
  const msg = e?.response?.data?.error?.message || e?.response?.data?.message;
  if (msg) return msg;
  if (!e?.response) return `${fallback} — the API server is not reachable.`;
  if (status === 403) return `${fallback} — your account needs an admin role.`;
  if (status === 404) return `${fallback} — restart the API so it has this route.`;
  return fallback;
};

const initials = (name: string, phone: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length) return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  return phone.replace(/\D/g, '').slice(-2) || 'A';
};

const roleName = (role: any): string =>
  (typeof role === 'string' ? role : role?.name || role?.key || 'admin').replace(/_/g, ' ');

/** SMS segment count (GSM-7 vs. Unicode/UCS-2, which Bengali text needs). */
const GSM_BASIC = /^[\n\r @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà^{}\\[\]~|€]*$/;
function smsSegments(text: string) {
  if (!text) return { unicode: false, length: 0, parts: 0, perPart: 160 };
  if (GSM_BASIC.test(text)) {
    const length = [...text].reduce((n, c) => n + ('^{}\\[]~|€'.includes(c) ? 2 : 1), 0);
    return { unicode: false, length, parts: length <= 160 ? 1 : Math.ceil(length / 153), perPart: length <= 160 ? 160 : 153 };
  }
  const length = text.length; // UTF-16 code units
  return { unicode: true, length, parts: length <= 70 ? 1 : Math.ceil(length / 67), perPart: length <= 70 ? 70 : 67 };
}

function passwordChecks(pw: string) {
  return {
    length: pw.length >= 8,
    mixed: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    number: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
    long: pw.length >= 12,
  };
}

// ─── Small building blocks ────────────────────────────────────────────────────
function Panel({
  icon, tint, title, subtitle, children, footer,
}: { icon: ReactNode; tint: string; title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="st-panel" aria-label={title}>
      <header className="st-panel-head">
        <div className="st-panel-icon" style={{ background: `color-mix(in srgb, ${tint} 15%, transparent)`, color: tint }}>{icon}</div>
        <div>
          <h2 className="st-panel-title">{title}</h2>
          <p className="st-panel-sub">{subtitle}</p>
        </div>
      </header>
      <div className="st-panel-body">{children}</div>
      {footer && <footer className="st-panel-foot">{footer}</footer>}
    </section>
  );
}

function FootNote({ dirty, clean }: { dirty: boolean; clean: string }) {
  const t = useT();
  return (
    <span className={`st-foot-note${dirty ? ' dirty' : ''}`}>
      {dirty ? <><span className="st-dot warn" /> {t('Unsaved changes')}</> : <><Check size={14} /> {clean}</>}
    </span>
  );
}

function SecretInput({
  value, onChange, placeholder, id, autoComplete = 'new-password', required, minLength,
}: { value: string; onChange: (v: string) => void; placeholder?: string; id?: string; autoComplete?: string; required?: boolean; minLength?: number }) {
  const [show, setShow] = useState(false);
  return (
    <div className="st-input-wrap">
      <input
        id={id} className="field-input" type={show ? 'text' : 'password'} value={value} placeholder={placeholder}
        autoComplete={autoComplete} spellCheck={false} required={required} minLength={minLength}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="st-input-btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide' : 'Show'} title={show ? 'Hide' : 'Show'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="st-switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="st-switch-track" />
    </span>
  );
}

function Tile({
  selected, onClick, title, desc, icon, children,
}: { selected: boolean; onClick: () => void; title: string; desc?: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <button type="button" className={`st-tile${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={onClick}>
      <span className="st-tile-check"><Check size={12} strokeWidth={3} /></span>
      {children}
      <span className="st-tile-title">{icon}{title}</span>
      {desc && <span className="st-tile-desc">{desc}</span>}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Settings() {
  const t = useT();
  const { user } = useAuthStore();
  const { mode, setMode } = useThemeStore();
  const { lang, setLang } = useLangStore();

  const [section, setSection] = useState<SectionId>(() => {
    const h = window.location.hash.replace('#', '') as SectionId;
    return SECTION_IDS.includes(h) ? h : 'profile';
  });
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#', '') as SectionId;
      if (SECTION_IDS.includes(h)) setSection(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const go = (s: SectionId) => {
    setSection(s);
    window.history.replaceState(null, '', `#${s}`);
  };

  const [loading, setLoading] = useState(true);

  // Profile
  const [profile, setProfile] = useState({ fullName: '', email: '', phone: user?.phone || '' });
  const [profileOrig, setProfileOrig] = useState(profile);
  const [savingProfile, setSavingProfile] = useState(false);

  // Password
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [savingPassword, setSavingPassword] = useState(false);

  // Maps
  const [mapsKey, setMapsKey] = useState('');
  const [mapsOrig, setMapsOrig] = useState('');
  const [savingMaps, setSavingMaps] = useState(false);
  const [confirmRemoveMapsKey, setConfirmRemoveMapsKey] = useState(false);

  // SMS gateway
  const [sms, setSms] = useState<SmsConfigPublic>(DEFAULT_SMS);
  const [smsOrig, setSmsOrig] = useState<SmsConfigPublic>(DEFAULT_SMS);
  const [smsLoadError, setSmsLoadError] = useState('');
  const [twilioAuthToken, setTwilioAuthToken] = useState('');
  const [bulksmsApiKey, setBulksmsApiKey] = useState('');
  const [savingSms, setSavingSms] = useState(false);
  const [testNumber, setTestNumber] = useState('');
  const [testingSms, setTestingSms] = useState(false);

  // SOS message template
  const [smsTemplate, setSmsTemplate] = useState('');
  const [templateOrig, setTemplateOrig] = useState('');
  const [smsTemplateDefault, setSmsTemplateDefault] = useState('');
  const [smsPlaceholders, setSmsPlaceholders] = useState<string[]>([]);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const templateRef = useRef<HTMLTextAreaElement>(null);

  // ── Load ──
  useEffect(() => {
    const loadProfile = api.get('/profile').then((res) => {
      const d = res.data.data;
      const p = { fullName: d.profile?.fullName || '', email: d.email || '', phone: d.phone || user?.phone || '' };
      setProfile(p);
      setProfileOrig(p);
    }).catch(() => toast.error('Failed to load profile data'));

    const loadMaps = api.get('/config').then((res) => {
      const k = res.data?.data?.googleMapsApiKey || '';
      setMapsKey(k);
      setMapsOrig(k);
    }).catch(() => { /* key stays empty */ });

    const loadSms = api.get('/settings/sms').then((res) => {
      if (res.data?.data) { setSms(res.data.data); setSmsOrig(res.data.data); }
      setSmsLoadError('');
    }).catch((e: any) => {
      const status = e?.response?.status;
      setSmsLoadError(
        status === 404 ? 'SMS settings endpoint not found — restart the API so it has the /settings routes.'
          : status === 403 ? 'You need an admin role to manage SMS settings.'
            : 'Could not load the saved SMS settings — showing defaults.',
      );
    });

    const loadTemplate = api.get('/settings/sms-template').then((res) => {
      const d = res.data?.data;
      if (d) {
        setSmsTemplate(d.template || '');
        setTemplateOrig(d.template || '');
        setSmsTemplateDefault(d.default || '');
        setSmsPlaceholders(Array.isArray(d.placeholders) ? d.placeholders : []);
      }
    }).catch(() => { /* editor still works with defaults */ });

    Promise.allSettled([loadProfile, loadMaps, loadSms, loadTemplate]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Dirty tracking ──
  const dirty: Record<SectionId, boolean> = {
    profile: profile.fullName !== profileOrig.fullName || profile.email !== profileOrig.email,
    security: !!(passwords.currentPassword || passwords.newPassword || passwords.confirmPassword),
    appearance: false,
    sms: JSON.stringify(sms) !== JSON.stringify(smsOrig) || !!twilioAuthToken || !!bulksmsApiKey,
    message: smsTemplate !== templateOrig,
    maps: mapsKey.trim() !== mapsOrig.trim(),
  };
  const anyDirty = Object.values(dirty).some(Boolean);

  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  // ── Derived status ──
  const smsConfigured =
    smsOrig.provider === 'mock' ||
    (smsOrig.provider === 'twilio' && !!(smsOrig.twilio.accountSid && smsOrig.twilio.fromNumber && smsOrig.twilio.authTokenSet)) ||
    (smsOrig.provider === 'bulksmsbd' && !!(smsOrig.bulksmsbd.apiKeySet && smsOrig.bulksmsbd.senderId));
  const smsState: 'ok' | 'warn' | 'off' = !smsOrig.enabled ? 'off' : smsConfigured && smsOrig.provider !== 'mock' ? 'ok' : 'warn';
  const providerLabel: Record<SmsProvider, string> = { twilio: 'Twilio', bulksmsbd: 'BulkSMSBD', mock: 'Mock' };

  // ── Actions ──
  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile.fullName.trim()) return toast.error(t('Enter your full name'));
    setSavingProfile(true);
    try {
      const body: Record<string, string> = { fullName: profile.fullName.trim() };
      // Contract 12: email is persisted (validated, unique → 409).
      if (profile.email.trim() !== profileOrig.email) body.email = profile.email.trim();
      const res = await api.put('/profile', body);
      const saved = res.data?.data;
      // Show what the server actually stored, not what we sent.
      const p = {
        ...profile,
        fullName: saved?.profile?.fullName ?? saved?.fullName ?? profile.fullName.trim(),
        email: saved && 'email' in saved ? (saved.email ?? '') : profile.email.trim(),
      };
      setProfile(p);
      setProfileOrig(p);
      if (user) useAuthStore.getState().setUser({ fullName: p.fullName });
      toast.success(t('Profile updated'));
    } catch (err: any) {
      if (err?.response?.status === 409) {
        toast.error(err.response?.data?.error?.message || t('This email address is already used by another account.'));
      } else {
        toast.error(apiError(err, t('Failed to update profile')));
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const checks = passwordChecks(passwords.newPassword);
  const score = Object.values(checks).filter(Boolean).length;
  const strength = !passwords.newPassword ? null
    : score <= 2 ? { label: t('Weak'), color: 'var(--emergency)', bars: 1 }
      : score === 3 ? { label: t('Fair'), color: 'var(--amber)', bars: 2 }
        : score === 4 ? { label: t('Good'), color: 'var(--blue)', bars: 3 }
          : { label: t('Strong'), color: 'var(--green)', bars: 4 };
  const pwMatch = !!passwords.confirmPassword && passwords.newPassword === passwords.confirmPassword;

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!checks.length) return toast.error('Use at least 8 characters');
    if (passwords.newPassword !== passwords.confirmPassword) return toast.error('New passwords do not match');
    if (passwords.newPassword === passwords.currentPassword) return toast.error('Choose a password different from the current one');
    setSavingPassword(true);
    try {
      await api.post('/auth/change-password', { currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('Password changed — please sign in again.');
      setTimeout(() => {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }, 1800);
    } catch (err) {
      toast.error(apiError(err, 'Failed to change password'));
    } finally {
      setSavingPassword(false);
    }
  };

  const saveSms = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSms(true);
    try {
      const res = await api.put('/settings/sms', {
        provider: sms.provider,
        senderId: sms.senderId,
        enabled: sms.enabled,
        twilio: {
          accountSid: sms.twilio.accountSid.trim(),
          fromNumber: sms.twilio.fromNumber.trim(),
          ...(twilioAuthToken.trim() ? { authToken: twilioAuthToken.trim() } : {}),
        },
        bulksmsbd: {
          senderId: sms.bulksmsbd.senderId.trim(),
          ...(bulksmsApiKey.trim() ? { apiKey: bulksmsApiKey.trim() } : {}),
        },
      });
      setSms(res.data?.data);
      setSmsOrig(res.data?.data);
      setTwilioAuthToken('');
      setBulksmsApiKey('');
      setSmsLoadError('');
      toast.success('SMS gateway saved');
    } catch (err) {
      toast.error(apiError(err, 'Failed to save SMS settings'));
    } finally {
      setSavingSms(false);
    }
  };

  const testSms = async () => {
    if (!testNumber.trim()) return toast.error('Enter a phone number for the test SMS');
    setTestingSms(true);
    try {
      const res = await api.post('/settings/sms/test', { to: testNumber.trim() });
      if (res.data?.success) toast.success(`Test SMS sent via ${res.data.data.provider}`);
      else toast.error(`Test failed: ${res.data?.data?.error || 'unknown error'}`);
    } catch (err) {
      toast.error(apiError(err, 'Failed to send test SMS'));
    } finally {
      setTestingSms(false);
    }
  };

  const saveTemplate = async () => {
    setSavingTemplate(true);
    try {
      const res = await api.put('/settings/sms-template', { template: smsTemplate });
      const saved = res.data?.data?.template ?? smsTemplate;
      setSmsTemplate(saved);
      setTemplateOrig(saved);
      toast.success('SOS message saved');
    } catch (err) {
      toast.error(apiError(err, 'Failed to save the message'));
    } finally {
      setSavingTemplate(false);
    }
  };

  const insertPlaceholder = (ph: string) => {
    const el = templateRef.current;
    const start = el?.selectionStart ?? smsTemplate.length;
    const end = el?.selectionEnd ?? smsTemplate.length;
    const before = smsTemplate.slice(0, start);
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    const next = `${before}${pad}${ph}${smsTemplate.slice(end)}`.slice(0, 480);
    setSmsTemplate(next);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = Math.min(start + pad.length + ph.length, next.length);
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  };

  const previewSms = useMemo(
    () => (smsTemplate || smsTemplateDefault)
      .replace(/\{name\}/g, 'Rina Akter')
      .replace(/\{mapLink\}/g, 'https://maps.google.com/?q=23.7808,90.4176')
      .replace(/\{trackLink\}/g, 'https://api.mystrix-soft.com/t/Ab3xY9')
      .replace(/\{lat\}/g, '23.7808')
      .replace(/\{lng\}/g, '90.4176'),
    [smsTemplate, smsTemplateDefault],
  );
  const seg = smsSegments(previewSms);

  const saveMaps = async (value = mapsKey) => {
    setSavingMaps(true);
    try {
      await api.put('/config', { googleMapsApiKey: value.trim() });
      setMapsKey(value.trim());
      setMapsOrig(value.trim());
      toast.success(value.trim() ? 'Google Maps key saved — reload alert pages to apply.' : 'Key removed — maps use OpenStreetMap.');
    } catch (err) {
      toast.error(apiError(err, 'Failed to save the API key'));
    } finally {
      setSavingMaps(false);
    }
  };

  // ── Nav model ──
  const nav: { group: string; items: { id: SectionId; label: string; desc: string; icon: ReactNode; status?: 'ok' | 'warn' | 'off' }[] }[] = [
    {
      group: t('Account'),
      items: [
        { id: 'profile', label: t('Profile'), desc: t('Name and email'), icon: <User size={17} /> },
        { id: 'security', label: t('Security'), desc: t('Password and sign-in'), icon: <Shield size={17} /> },
        { id: 'appearance', label: t('Appearance'), desc: t('Theme and language'), icon: <Palette size={17} /> },
      ],
    },
    {
      group: t('System'),
      items: [
        { id: 'sms', label: t('SMS Gateway'), desc: smsOrig.enabled ? providerLabel[smsOrig.provider] : t('Off'), icon: <MessageSquare size={17} />, status: smsState },
        { id: 'message', label: t('SOS Message'), desc: t('Text sent to contacts'), icon: <Smartphone size={17} /> },
        { id: 'maps', label: t('Maps'), desc: mapsOrig ? 'Google Maps' : 'OpenStreetMap', icon: <MapIcon size={17} />, status: mapsOrig ? 'ok' : 'off' },
      ],
    },
  ];

  const name = profileOrig.fullName || user?.fullName || '';
  const phone = profileOrig.phone || user?.phone || '';

  // ── Sections ──
  const renderSection = () => {
    switch (section) {
      case 'profile':
        return (
          <form onSubmit={saveProfile}>
            <Panel
              icon={<User size={22} />} tint="var(--blue)" title={t('Profile Information')}
              subtitle={t('How you appear in audit logs and to other admins.')}
              footer={
                <>
                  <FootNote dirty={dirty.profile} clean={t('All changes saved')} />
                  {dirty.profile && (
                    <button type="button" className="btn btn-ghost" onClick={() => setProfile(profileOrig)} disabled={savingProfile}>
                      <RotateCcw size={15} /> {t('Discard')}
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={savingProfile || !dirty.profile}>
                    {savingProfile ? <Loader2 size={16} className="spin" /> : <Save size={16} />} {t('Save Profile')}
                  </button>
                </>
              }
            >
              <div className="st-grid-2">
                <div className="field">
                  <label className="field-label" htmlFor="st-name">{t('Full Name')}</label>
                  <input id="st-name" className="field-input" value={profile.fullName} maxLength={100} required autoComplete="name"
                    onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="st-email">{t('Email Address')}</label>
                  <input id="st-email" className="field-input" type="email" value={profile.email} placeholder="name@example.com" autoComplete="email"
                    onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="st-phone">{t('Phone Number')}</label>
                  <div className="st-input-wrap">
                    <input id="st-phone" className="field-input" value={profile.phone} disabled />
                    <button type="button" className="st-input-btn" disabled aria-hidden tabIndex={-1}><Lock size={15} /></button>
                  </div>
                  <p className="st-help"><Info size={12} /> {t('Your phone number is your sign-in ID and cannot be changed here.')}</p>
                </div>
              </div>
            </Panel>
          </form>
        );

      case 'security':
        return (
          <form onSubmit={changePassword}>
            <Panel
              icon={<Shield size={22} />} tint="var(--green)" title={t('Change Password')}
              subtitle={t('After changing it you are signed out on every device and sign in again with the new password.')}
              footer={
                <>
                  <span className="st-foot-note"><KeyRound size={14} /> {t('Use a password you do not use anywhere else.')}</span>
                  <button type="submit" className="btn btn-primary" disabled={savingPassword || !passwords.currentPassword || !checks.length || !pwMatch}>
                    {savingPassword ? <Loader2 size={16} className="spin" /> : <Shield size={16} />} {t('Change Password')}
                  </button>
                </>
              }
            >
              <div className="field" style={{ maxWidth: 420 }}>
                <label className="field-label">{t('Current Password')}</label>
                <SecretInput value={passwords.currentPassword} autoComplete="current-password" required
                  onChange={(v) => setPasswords({ ...passwords, currentPassword: v })} />
              </div>
              <div className="st-grid-2">
                <div className="field">
                  <label className="field-label">{t('New Password')}</label>
                  <SecretInput value={passwords.newPassword} required minLength={8}
                    onChange={(v) => setPasswords({ ...passwords, newPassword: v })} />
                  {strength && (
                    <>
                      <div className="st-strength" aria-hidden>
                        {[1, 2, 3, 4].map((i) => <i key={i} style={{ background: i <= strength.bars ? strength.color : undefined }} />)}
                      </div>
                      <div className="st-strength-label" style={{ color: strength.color }}>{strength.label}</div>
                    </>
                  )}
                </div>
                <div className="field">
                  <label className="field-label">{t('Confirm New Password')}</label>
                  <SecretInput value={passwords.confirmPassword} required minLength={8}
                    onChange={(v) => setPasswords({ ...passwords, confirmPassword: v })} />
                  {passwords.confirmPassword && (
                    <p className="st-help" style={{ color: pwMatch ? 'var(--green)' : 'var(--emergency)' }}>
                      {pwMatch ? <Check size={13} /> : <X size={13} />} {pwMatch ? t('Passwords match') : t('Passwords do not match')}
                    </p>
                  )}
                </div>
              </div>
              <ul className="st-checklist">
                {([
                  ['length', t('At least 8 characters')],
                  ['mixed', t('Upper and lower case')],
                  ['number', t('A number')],
                  ['symbol', t('A symbol')],
                  ['long', t('12+ characters (recommended)')],
                ] as const).map(([k, label]) => (
                  <li key={k} className={checks[k] ? 'ok' : ''}>
                    {checks[k] ? <CheckCircle2 size={14} /> : <span className="st-dot off" style={{ margin: '0 3px' }} />} {label}
                  </li>
                ))}
              </ul>
            </Panel>
          </form>
        );

      case 'appearance':
        return (
          <Panel icon={<Palette size={22} />} tint="var(--purple)" title={t('Appearance')} subtitle={t('Applied instantly and remembered on this browser.')}>
            <label className="field-label">{t('Theme')}</label>
            <div className="st-tiles">
              <Tile selected={mode === 'light'} onClick={() => setMode('light')} title={t('Light')} desc={t('Bright, for daytime offices')} icon={<Sun size={15} />}>
                <span className="st-theme-preview light"><span className="st-tp-side" /><span className="st-tp-main"><span className="st-tp-bar" /><span className="st-tp-card"><span className="st-tp-accent" style={{ display: 'block' }} /></span></span></span>
              </Tile>
              <Tile selected={mode === 'dark'} onClick={() => setMode('dark')} title={t('Dark')} desc={t('Easier on the eyes at night')} icon={<Moon size={15} />}>
                <span className="st-theme-preview dark"><span className="st-tp-side" /><span className="st-tp-main"><span className="st-tp-bar" /><span className="st-tp-card"><span className="st-tp-accent" style={{ display: 'block' }} /></span></span></span>
              </Tile>
            </div>
            <label className="field-label">{t('Language')}</label>
            <div className="st-tiles" style={{ marginBottom: 0 }}>
              <Tile selected={lang === 'en'} onClick={() => setLang('en')} title="English" desc="Portal text in English" icon={<Globe size={15} />} />
              <Tile selected={lang === 'bn'} onClick={() => setLang('bn')} title="বাংলা" desc="পোর্টালের লেখা বাংলায়" icon={<Globe size={15} />} />
            </div>
          </Panel>
        );

      case 'sms':
        return (
          <>
            <form onSubmit={saveSms}>
              <Panel
                icon={<MessageSquare size={22} />} tint="var(--green)" title={t('SMS Gateway')}
                subtitle={t('Texts trusted contacts when an SOS fires. If the server cannot send, the user’s phone sends from its own SIM.')}
                footer={
                  <>
                    <FootNote dirty={dirty.sms} clean={t('Secrets are encrypted and never shown again')} />
                    {dirty.sms && (
                      <button type="button" className="btn btn-ghost" disabled={savingSms}
                        onClick={() => { setSms(smsOrig); setTwilioAuthToken(''); setBulksmsApiKey(''); }}>
                        <RotateCcw size={15} /> {t('Discard')}
                      </button>
                    )}
                    <button type="submit" className="btn btn-primary" disabled={savingSms || !dirty.sms}>
                      {savingSms ? <Loader2 size={16} className="spin" /> : <Save size={16} />} {t('Save SMS Settings')}
                    </button>
                  </>
                }
              >
                {smsLoadError ? (
                  <div className="st-banner warn"><AlertTriangle size={16} /><span>{smsLoadError}</span></div>
                ) : smsState === 'ok' ? (
                  <div className="st-banner ok"><CheckCircle2 size={16} /><span><strong>{t('Active')}</strong> — {t('SOS texts are sent through')} {providerLabel[smsOrig.provider]}.</span></div>
                ) : smsState === 'warn' ? (
                  <div className="st-banner warn"><AlertTriangle size={16} /><span>
                    <strong>{smsOrig.provider === 'mock' ? t('Mock provider') : t('Incomplete')}</strong> — {smsOrig.provider === 'mock'
                      ? t('messages are only logged, nobody receives them. Use it for development only.')
                      : t('enter the remaining credentials below, otherwise texts fall back to the user’s phone.')}
                  </span></div>
                ) : (
                  <div className="st-banner off"><Info size={16} /><span><strong>{t('Off')}</strong> — {t('the server sends no SOS texts; contacts get app notifications and the phone’s own SMS.')}</span></div>
                )}

                <label className="st-switch-row">
                  <span className="st-switch-row-text">
                    <strong>{t('Send SMS to trusted contacts on every SOS')}</strong>
                    <span>{t('Turn off to rely on push notifications and the phone’s SIM.')}</span>
                  </span>
                  <Switch checked={sms.enabled} onChange={(v) => setSms({ ...sms, enabled: v })} label={t('Send SMS to trusted contacts on every SOS')} />
                </label>

                <label className="field-label">{t('Provider')}</label>
                <div className="st-tiles">
                  <Tile selected={sms.provider === 'bulksmsbd'} onClick={() => setSms({ ...sms, provider: 'bulksmsbd' })} title="BulkSMSBD" desc={t('Bangladeshi numbers, masking sender ID')} />
                  <Tile selected={sms.provider === 'twilio'} onClick={() => setSms({ ...sms, provider: 'twilio' })} title="Twilio" desc={t('International, also receives SMS-SOS')} />
                  <Tile selected={sms.provider === 'mock'} onClick={() => setSms({ ...sms, provider: 'mock' })} title="Mock" desc={t('Development only — logs, sends nothing')} />
                </div>

                {sms.provider === 'twilio' && (
                  <div className="st-grid-2">
                    <div className="field">
                      <label className="field-label">{t('Account SID')}</label>
                      <input className="field-input" value={sms.twilio.accountSid} placeholder="AC…" autoComplete="off" spellCheck={false} style={{ fontFamily: 'monospace' }}
                        onChange={(e) => setSms({ ...sms, twilio: { ...sms.twilio, accountSid: e.target.value } })} />
                    </div>
                    <div className="field">
                      <label className="field-label">
                        {t('Auth Token')} {sms.twilio.authTokenSet && <span className="st-saved"><BadgeCheck size={12} /> {t('saved')}</span>}
                      </label>
                      <SecretInput value={twilioAuthToken} onChange={setTwilioAuthToken}
                        placeholder={sms.twilio.authTokenSet ? t('Leave blank to keep the saved token') : t('Enter auth token')} />
                    </div>
                    <div className="field">
                      <label className="field-label">{t('From Number')}</label>
                      <input className="field-input" value={sms.twilio.fromNumber} placeholder="+1XXXXXXXXXX" autoComplete="off"
                        onChange={(e) => setSms({ ...sms, twilio: { ...sms.twilio, fromNumber: e.target.value } })} />
                    </div>
                  </div>
                )}

                {sms.provider === 'bulksmsbd' && (
                  <div className="st-grid-2">
                    <div className="field">
                      <label className="field-label">
                        {t('API Key')} {sms.bulksmsbd.apiKeySet && <span className="st-saved"><BadgeCheck size={12} /> {t('saved')}</span>}
                      </label>
                      <SecretInput value={bulksmsApiKey} onChange={setBulksmsApiKey}
                        placeholder={sms.bulksmsbd.apiKeySet ? t('Leave blank to keep the saved key') : t('Enter API key')} />
                    </div>
                    <div className="field">
                      <label className="field-label">{t('Sender ID')}</label>
                      <input className="field-input" value={sms.bulksmsbd.senderId} placeholder={t('Approved sender / masking ID')} autoComplete="off"
                        onChange={(e) => setSms({ ...sms, bulksmsbd: { ...sms.bulksmsbd, senderId: e.target.value } })} />
                    </div>
                  </div>
                )}

                {sms.provider === 'mock' && (
                  <p className="st-help" style={{ marginTop: 0 }}><Info size={12} /> {t('No credentials needed. Switch to a real provider before going live.')}</p>
                )}
              </Panel>
            </form>

            <div className="st-panel" style={{ marginTop: 16, padding: '20px 26px' }}>
              <h3 className="st-sub-title"><Send size={16} color="var(--blue)" /> {t('Send a test SMS')}</h3>
              <p className="st-sub-desc">
                {dirty.sms ? t('Save your changes first — the test uses the saved settings.') : t('Sends a short test message using the saved settings.')}
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <Phone size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input className="field-input" value={testNumber} placeholder="+8801XXXXXXXXX" inputMode="tel" style={{ paddingLeft: 36 }}
                    onChange={(e) => setTestNumber(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void testSms(); } }} />
                </div>
                <button type="button" className="btn btn-blue" disabled={testingSms || dirty.sms} onClick={testSms}>
                  {testingSms ? <Loader2 size={16} className="spin" /> : <Send size={16} />} {t('Send test')}
                </button>
              </div>
            </div>
          </>
        );

      case 'message':
        return (
          <Panel
            icon={<Smartphone size={22} />} tint="var(--emergency)" title={t('SOS Message')}
            subtitle={t('The text a user’s trusted contacts receive when an SOS fires. Placeholders are filled in at send time.')}
            footer={
              <>
                <FootNote dirty={dirty.message} clean={t('All changes saved')} />
                <button type="button" className="btn btn-ghost" disabled={savingTemplate || !smsTemplateDefault || smsTemplate === smsTemplateDefault}
                  onClick={() => setSmsTemplate(smsTemplateDefault)}>
                  <RotateCcw size={15} /> {t('Reset to default')}
                </button>
                <button type="button" className="btn btn-primary" disabled={savingTemplate || !dirty.message} onClick={saveTemplate}>
                  {savingTemplate ? <Loader2 size={16} className="spin" /> : <Save size={16} />} {t('Save Message')}
                </button>
              </>
            }
          >
            <div className="st-tpl">
              <div>
                <label className="field-label" htmlFor="st-tpl">{t('Message')}</label>
                <textarea id="st-tpl" ref={templateRef} className="field-input" value={smsTemplate} rows={6} maxLength={480}
                  placeholder={smsTemplateDefault} style={{ resize: 'vertical', lineHeight: 1.55 }}
                  onChange={(e) => setSmsTemplate(e.target.value)} />
                <div className="st-counter">
                  <span><b>{smsTemplate.length}</b>/480 {t('characters')}</span>
                  <span>
                    {t('Preview')}: <b>{seg.parts}</b> {seg.parts === 1 ? t('SMS part') : t('SMS parts')} · {seg.unicode ? t('Unicode (Bangla)') : 'GSM'} · {seg.perPart} {t('chars/part')}
                  </span>
                </div>

                {smsPlaceholders.length > 0 && (
                  <div style={{ marginTop: 18 }}>
                    <label className="field-label">{t('Insert placeholder')}</label>
                    <div className="st-chip-row">
                      {smsPlaceholders.map((ph) => (
                        <button key={ph} type="button" className="st-chip" onClick={() => insertPlaceholder(ph)} title={t('Insert at cursor')}>{ph}</button>
                      ))}
                    </div>
                    <p className="st-help"><Info size={12} /> {t('Each part is billed separately by the SMS provider. Bangla text fits 70 characters per part instead of 160.')}</p>
                  </div>
                )}
              </div>

              <div>
                <label className="field-label">{t('Live preview')}</label>
                <div className="st-phone" aria-label={t('Live preview')}>
                  <div className="st-phone-screen">
                    <div className="st-phone-top">
                      <div className="st-phone-avatar">SOS</div>
                      <div>
                        <div className="st-phone-name">NariSurokkha</div>
                        <div className="st-phone-sub">{t('Text message')}</div>
                      </div>
                    </div>
                    <div className="st-phone-body">
                      <div className="st-bubble">
                        {previewSms.split(/(https?:\/\/\S+)/g).map((part, i) =>
                          /^https?:\/\//.test(part) ? <a key={i} href={part} onClick={(e) => e.preventDefault()}>{part}</a> : <span key={i}>{part}</span>,
                        )}
                      </div>
                      <div className="st-bubble-time">{t('Now')} · {t('sample values')}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        );

      case 'maps':
        return (
          <form onSubmit={(e) => { e.preventDefault(); void saveMaps(); }}>
            <Panel
              icon={<MapIcon size={22} />} tint="var(--blue)" title={t('Maps')}
              subtitle={t('Choose the map shown on alert and incident pages.')}
              footer={
                <>
                  <FootNote dirty={dirty.maps} clean={mapsOrig ? t('Using Google Maps') : t('Using OpenStreetMap (free)')} />
                  {mapsOrig && (
                    <button type="button" className="btn btn-danger" disabled={savingMaps} onClick={() => setConfirmRemoveMapsKey(true)}>
                      <Trash2 size={15} /> {t('Remove key')}
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={savingMaps || !dirty.maps}>
                    {savingMaps ? <Loader2 size={16} className="spin" /> : <Save size={16} />} {t('Save Maps Key')}
                  </button>
                </>
              }
            >
              {mapsOrig ? (
                <div className="st-banner ok"><CheckCircle2 size={16} /><span><strong>Google Maps</strong> — {t('places, Street View and traffic-aware routing are on.')}</span></div>
              ) : (
                <div className="st-banner off"><Info size={16} /><span><strong>OpenStreetMap</strong> — {t('free and needs no key. Add a Google Maps key for places, Street View and traffic-aware routing.')}</span></div>
              )}
              <div className="field">
                <label className="field-label">{t('Google Maps API Key')}</label>
                <SecretInput value={mapsKey} onChange={setMapsKey} autoComplete="off" placeholder={t('AIza… (leave empty for OpenStreetMap)')} />
              </div>
              <div className="st-sub" style={{ marginTop: 4 }}>
                <h3 className="st-sub-title"><KeyRound size={15} /> {t('Setting up the key in Google Cloud')}</h3>
                <p className="st-sub-desc">{t('Enable these APIs, then restrict the key by HTTP referrer to the portal’s address.')}</p>
                <ul className="st-api-list">
                  <li><CheckCircle2 size={14} color="var(--green)" /> Maps JavaScript API</li>
                  <li><CheckCircle2 size={14} color="var(--green)" /> Directions API</li>
                  <li><CheckCircle2 size={14} color="var(--green)" /> Places API</li>
                </ul>
              </div>
            </Panel>
          </form>
        );
    }
  };

  return (
    <div className="animate-in">
      <ConfirmDialog
        open={confirmRemoveMapsKey}
        danger
        title={t('Remove the Google Maps key?')}
        message={t('Maps will switch to OpenStreetMap.')}
        confirmLabel={t('Remove')}
        busy={savingMaps}
        onCancel={() => setConfirmRemoveMapsKey(false)}
        onConfirm={() => { setConfirmRemoveMapsKey(false); void saveMaps(''); }}
      />
      <div className="page-header">
        <h1 className="page-title">{t('Settings')}</h1>
        <p className="page-subtitle">{t('Manage your account, appearance and the services the platform uses.')}</p>
      </div>

      {/* Hero */}
      <div className="st-hero">
        <div className="st-avatar">{loading ? '' : initials(name, phone)}</div>
        <div className="st-hero-who">
          {loading ? (
            <>
              <div className="st-skel" style={{ height: 20, width: 180, marginBottom: 8 }} />
              <div className="st-skel" style={{ height: 13, width: 240 }} />
            </>
          ) : (
            <>
              <h2 className="st-hero-name">{name || t('Administrator')}</h2>
              <div className="st-hero-meta">
                <span className="badge success" style={{ textTransform: 'capitalize' }}><BadgeCheck size={12} /> {roleName(user?.role)}</span>
                {phone && <span><Phone size={13} /> {phone}</span>}
                {profileOrig.email && <span><Mail size={13} /> {profileOrig.email}</span>}
              </div>
            </>
          )}
        </div>
        <div className="st-status-row">
          <button type="button" className="st-status" onClick={() => go('sms')}>
            <span className={`st-dot ${smsState}`} /> SMS <b>{smsState === 'ok' ? t('Active') : smsState === 'warn' ? t('Check') : t('Off')}</b>
          </button>
          <button type="button" className="st-status" onClick={() => go('maps')}>
            <span className={`st-dot ${mapsOrig ? 'ok' : 'off'}`} /> {t('Maps')} <b>{mapsOrig ? 'Google' : 'OSM'}</b>
          </button>
          <button type="button" className="st-status" onClick={() => go('appearance')}>
            {mode === 'dark' ? <Moon size={13} /> : <Sun size={13} />} <b>{lang === 'bn' ? 'বাংলা' : 'EN'}</b>
          </button>
        </div>
      </div>

      <div className="st-layout">
        <nav className="st-nav" aria-label={t('Settings sections')}>
          {nav.map((g) => (
            <div key={g.group} style={{ display: 'contents' }}>
              <div className="st-nav-group">{g.group}</div>
              {g.items.map((it) => (
                <button
                  key={it.id} type="button" className={`st-nav-item${section === it.id ? ' active' : ''}`}
                  aria-current={section === it.id ? 'page' : undefined} onClick={() => go(it.id)}
                >
                  <span className="st-nav-icon">{it.icon}</span>
                  <span className="st-nav-text">
                    <span className="st-nav-label">{it.label}</span>
                    <span className="st-nav-desc">{it.desc}</span>
                  </span>
                  {dirty[it.id] ? (
                    <span className="st-dot warn" title={t('Unsaved changes')} />
                  ) : it.status ? (
                    <span className={`st-dot ${it.status}`} />
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div key={section}>
          {loading ? (
            <div className="st-panel" style={{ padding: 26 }}>
              <div className="st-skel" style={{ height: 22, width: 220, marginBottom: 24 }} />
              <div className="st-skel" style={{ height: 44, marginBottom: 16 }} />
              <div className="st-skel" style={{ height: 44, marginBottom: 16 }} />
              <div className="st-skel" style={{ height: 44, width: '60%' }} />
            </div>
          ) : (
            renderSection()
          )}
        </div>
      </div>
    </div>
  );
}
