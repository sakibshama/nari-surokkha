/**
 * User settings for automatic emergency detection — persisted on the phone.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Sensitivity, TriggerId } from './constants';
import { DEFAULT_DETECTION_SETTINGS, DetectionSettingsData, sanitizeSettings } from './detectionSettingsCore';

export { DEFAULT_DETECTION_SETTINGS, sanitizeSettings };
export type { DetectionSettingsData };

const STORAGE_KEY = 'emergency_detection_settings_v1';

interface DetectionSettingsState extends DetectionSettingsData {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setEnabled: (v: boolean) => void;
  setBackground: (v: boolean) => void;
  setTriggerEnabled: (t: TriggerId, v: boolean) => void;
  setSensitivity: (t: TriggerId, s: Sensitivity) => void;
  setCooldownMs: (ms: number) => void;
  setOnboarded: (v: boolean) => void;
}

function pick(s: DetectionSettingsData): DetectionSettingsData {
  return {
    enabled: s.enabled,
    background: s.background,
    triggers: s.triggers,
    cooldownMs: s.cooldownMs,
    onboarded: s.onboarded,
  };
}

export const useDetectionSettings = create<DetectionSettingsState>((set, get) => {
  const save = () => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(pick(get()))).catch(() => {
      /* setting just won't survive a restart */
    });
  };
  const update = (patch: Partial<DetectionSettingsData>) => {
    set(patch);
    save();
  };
  return {
    ...DEFAULT_DETECTION_SETTINGS,
    hydrated: false,
    hydrate: async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) set(sanitizeSettings(JSON.parse(raw)));
      } catch {
        /* defaults */
      } finally {
        set({ hydrated: true });
      }
    },
    setEnabled: (enabled) => update({ enabled }),
    setBackground: (background) => update({ background }),
    setTriggerEnabled: (t, enabled) =>
      update({ triggers: { ...get().triggers, [t]: { ...get().triggers[t], enabled } } }),
    setSensitivity: (t, sensitivity) =>
      update({ triggers: { ...get().triggers, [t]: { ...get().triggers[t], sensitivity } } }),
    setCooldownMs: (cooldownMs) => update({ cooldownMs }),
    setOnboarded: (onboarded) => update({ onboarded }),
  };
});
