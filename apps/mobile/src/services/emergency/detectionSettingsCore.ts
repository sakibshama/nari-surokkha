/** Pure (React-Native-free) part of the detection settings, so it can be unit tested. */
import { DEFAULT_COOLDOWN_MS, TRIGGERS } from './constants';
import type { TriggerConfig } from './TriggerDecider';
import type { TriggerId } from './constants';

export interface DetectionSettingsData {
  /** Master switch: listen to the microphone for emergencies. */
  enabled: boolean;
  /** Keep listening while the app is in the background (Android foreground service). */
  background: boolean;
  triggers: Record<TriggerId, TriggerConfig>;
  /** Mute automatic triggers for this long after "I'm okay". */
  cooldownMs: number;
  /** User has seen the explanation / permission walkthrough. */
  onboarded: boolean;
}

export const DEFAULT_DETECTION_SETTINGS: DetectionSettingsData = {
  enabled: true,
  background: true,
  triggers: {
    shout: { enabled: true, sensitivity: 'medium' },
    help: { enabled: true, sensitivity: 'medium' },
    cry: { enabled: true, sensitivity: 'medium' },
    bachao: { enabled: true, sensitivity: 'medium' },
  },
  cooldownMs: DEFAULT_COOLDOWN_MS,
  onboarded: false,
};

/** Merge a stored blob over the defaults, ignoring unknown or malformed fields. */
export function sanitizeSettings(raw: unknown): DetectionSettingsData {
  const d = DEFAULT_DETECTION_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<DetectionSettingsData>;
  const triggers = { ...d.triggers };
  for (const t of TRIGGERS) {
    const v = (r.triggers as Record<string, Partial<TriggerConfig>> | undefined)?.[t];
    triggers[t] = {
      enabled: typeof v?.enabled === 'boolean' ? v.enabled : d.triggers[t].enabled,
      sensitivity: v?.sensitivity === 'low' || v?.sensitivity === 'medium' || v?.sensitivity === 'high'
        ? v.sensitivity
        : d.triggers[t].sensitivity,
    };
  }
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    background: typeof r.background === 'boolean' ? r.background : d.background,
    triggers,
    cooldownMs:
      typeof r.cooldownMs === 'number' && r.cooldownMs >= 0 && r.cooldownMs <= 30 * 60_000 ? r.cooldownMs : d.cooldownMs,
    onboarded: typeof r.onboarded === 'boolean' ? r.onboarded : d.onboarded,
  };
}

