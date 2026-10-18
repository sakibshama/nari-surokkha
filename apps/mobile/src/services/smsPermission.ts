/**
 * The emergency-SMS permission (SEND_SMS): checking it, asking for it, and
 * guiding the user through Android settings when Android will not show a
 * dialog at all. See smsPermissionCore.ts for the why.
 */

import { AppState, Linking, Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { tStatic } from '../i18n';
import { type InstallInfo, type SmsPermissionState, smsPermissionState } from './smsPermissionCore';

const LAST_RESULT_KEY = '@sms_permission_last_result';

interface NativeSmsInfo extends InstallInfo {
  granted: boolean;
  telephony: boolean;
}

interface NativeModule {
  getSmsPermissionInfo?: () => Promise<NativeSmsInfo>;
}

let native: NativeModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-direct-sms') as { default?: NativeModule } & NativeModule;
  native = mod?.default ?? mod ?? null;
} catch {
  native = null;
}

async function nativeInfo(): Promise<NativeSmsInfo | null> {
  try {
    return (await native?.getSmsPermissionInfo?.()) ?? null;
  } catch {
    return null;
  }
}

async function isGranted(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS).catch(() => false);
}

/** Remember what Android answered last time (to tell "denied" from "never ask again"). */
export async function recordSmsRequestResult(result: string | undefined): Promise<void> {
  if (result) await AsyncStorage.setItem(LAST_RESULT_KEY, result).catch(() => undefined);
}

export async function getSmsPermissionState(): Promise<SmsPermissionState> {
  if (Platform.OS !== 'android') return 'unsupported';
  const [granted, last, info] = await Promise.all([
    isGranted(),
    AsyncStorage.getItem(LAST_RESULT_KEY).catch(() => null),
    nativeInfo(),
  ]);
  return smsPermissionState(granted, last, info, info?.telephony ?? true);
}

interface SmsPermissionStore {
  state: SmsPermissionState | null;
  guideVisible: boolean;
  refresh: () => Promise<SmsPermissionState>;
  showGuide: () => void;
  hideGuide: () => void;
}

export const useSmsPermission = create<SmsPermissionStore>((set) => ({
  state: null,
  guideVisible: false,
  refresh: async () => {
    const state = await getSmsPermissionState();
    set((s) => ({ state, guideVisible: state === 'granted' ? false : s.guideVisible }));
    return state;
  },
  showGuide: () => set({ guideVisible: true }),
  hideGuide: () => set({ guideVisible: false }),
}));

/**
 * Ask Android for SEND_SMS when it can still show its dialog.
 * `interactive`: if Android will not show a dialog (restricted / blocked),
 * open the step-by-step guide instead. Never opens anything during an SOS
 * (pass interactive=false there).
 */
export async function ensureSmsPermission(interactive: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const store = useSmsPermission.getState();
  let state = await store.refresh();
  if (state === 'granted') return true;
  if (state === 'unsupported') return false;

  if (state === 'askable' && AppState.currentState === 'active') {
    try {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.SEND_SMS, {
        title: tStatic('Send Emergency SMS Automatically'),
        message: tStatic(
          'Nari Surokkha needs SMS permission so it can text your trusted contacts automatically during an emergency when you have no internet. Standard SMS charges from your mobile operator may apply.',
        ),
        buttonPositive: tStatic('Allow'),
        buttonNegative: tStatic('Not now'),
      });
      await recordSmsRequestResult(result);
    } catch {
      /* fall through to the re-check */
    }
    state = await store.refresh();
    if (state === 'granted') return true;
  }

  if (interactive && (state === 'restricted' || state === 'blocked')) store.showGuide();
  return false;
}

/** The app's own info page in Android settings (where ⋮ → "Allow restricted settings" lives). */
export function openAppSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

// Coming back from Settings: re-check, so the guide closes by itself once
// the permission is on.
AppState.addEventListener('change', (s) => {
  if (s === 'active' && Platform.OS === 'android' && useSmsPermission.getState().state !== null) {
    void useSmsPermission.getState().refresh();
  }
});
