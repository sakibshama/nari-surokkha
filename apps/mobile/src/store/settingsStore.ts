import { create } from 'zustand';

interface SettingsState {
  mlVoiceEnabled: boolean;
  mlGyroEnabled: boolean;
  /** Opt-in to sharing anonymised sensor windows to improve the model. */
  mlDataSharingEnabled: boolean;
  setMlVoiceEnabled: (enabled: boolean) => void;
  setMlGyroEnabled: (enabled: boolean) => void;
  setMlDataSharingEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  mlVoiceEnabled: true,
  mlGyroEnabled: true,
  mlDataSharingEnabled: true,
  setMlVoiceEnabled: (enabled) => set({ mlVoiceEnabled: enabled }),
  setMlGyroEnabled: (enabled) => set({ mlGyroEnabled: enabled }),
  setMlDataSharingEnabled: (enabled) => set({ mlDataSharingEnabled: enabled }),
}));
