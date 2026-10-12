import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Motion-model settings. (Sound detection has its own, richer settings in
 * services/emergency/detectionSettings.ts.) Persisted so a switch the user
 * turned off stays off after a restart.
 */
const STORAGE_KEY = 'ml_settings_v1';

interface SettingsState {
  mlGyroEnabled: boolean;
  /** Opt-in to sharing anonymised sensor windows to improve the model. */
  mlDataSharingEnabled: boolean;
  setMlGyroEnabled: (enabled: boolean) => void;
  setMlDataSharingEnabled: (enabled: boolean) => void;
  hydrate: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const save = () =>
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ mlGyroEnabled: get().mlGyroEnabled, mlDataSharingEnabled: get().mlDataSharingEnabled }),
    ).catch(() => {});
  return {
    mlGyroEnabled: true,
    mlDataSharingEnabled: true,
    setMlGyroEnabled: (enabled) => {
      set({ mlGyroEnabled: enabled });
      void save();
    },
    setMlDataSharingEnabled: (enabled) => {
      set({ mlDataSharingEnabled: enabled });
      void save();
    },
    hydrate: async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const v = JSON.parse(raw);
        set({
          mlGyroEnabled: typeof v.mlGyroEnabled === 'boolean' ? v.mlGyroEnabled : true,
          mlDataSharingEnabled: typeof v.mlDataSharingEnabled === 'boolean' ? v.mlDataSharingEnabled : true,
        });
      } catch {
        /* defaults */
      }
    },
  };
});
