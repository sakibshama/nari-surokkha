import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * App settings that are not part of sound detection (which has its own,
 * richer settings in services/emergency/detectionSettings.ts). Persisted so a
 * switch the user turned off stays off after a restart.
 */
const STORAGE_KEY = 'ml_settings_v1';

type Persisted = {
  mlGyroEnabled: boolean;
  /** Opt-in to sharing anonymised sensor windows to improve the model. */
  mlDataSharingEnabled: boolean;
  /** Push notifications (device token registered with the server). */
  pushEnabled: boolean;
  /** Track location in the background during an SOS / safe route. Off → only while the app is open. */
  backgroundLocationEnabled: boolean;
};

const DEFAULTS: Persisted = {
  mlGyroEnabled: true,
  mlDataSharingEnabled: true,
  pushEnabled: true,
  backgroundLocationEnabled: true,
};

interface SettingsState extends Persisted {
  hydrated: boolean;
  setMlGyroEnabled: (enabled: boolean) => void;
  setMlDataSharingEnabled: (enabled: boolean) => void;
  setPushEnabled: (enabled: boolean) => void;
  setBackgroundLocationEnabled: (enabled: boolean) => void;
  hydrate: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const update = (patch: Partial<Persisted>) => {
    set(patch);
    const s = get();
    const data: Persisted = {
      mlGyroEnabled: s.mlGyroEnabled,
      mlDataSharingEnabled: s.mlDataSharingEnabled,
      pushEnabled: s.pushEnabled,
      backgroundLocationEnabled: s.backgroundLocationEnabled,
    };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() => {});
  };
  return {
    ...DEFAULTS,
    hydrated: false,
    setMlGyroEnabled: (enabled) => update({ mlGyroEnabled: enabled }),
    setMlDataSharingEnabled: (enabled) => update({ mlDataSharingEnabled: enabled }),
    setPushEnabled: (enabled) => update({ pushEnabled: enabled }),
    setBackgroundLocationEnabled: (enabled) => update({ backgroundLocationEnabled: enabled }),
    hydrate: async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const v = JSON.parse(raw) as Partial<Persisted>;
        const pick = (k: keyof Persisted) => (typeof v[k] === 'boolean' ? (v[k] as boolean) : DEFAULTS[k]);
        set({
          mlGyroEnabled: pick('mlGyroEnabled'),
          mlDataSharingEnabled: pick('mlDataSharingEnabled'),
          pushEnabled: pick('pushEnabled'),
          backgroundLocationEnabled: pick('backgroundLocationEnabled'),
        });
      } catch {
        /* defaults */
      } finally {
        set({ hydrated: true });
      }
    },
  };
});
