/**
 * Full sign-out: revoke the session on the server, stop push to this device,
 * and remove everything personal kept on the phone (contacts cache, SMS
 * history, SOS state, queued locations) before clearing the tokens.
 */
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getApiBaseUrl } from './api';
import { socketService } from './socket';
import { unregisterPush } from './pushNotifications';
import { clearSmsHistory } from './smsHistory';
import { clearOfflineSos } from './offlineEscalation';
import { clear as clearOutbox } from './locationOutbox';
import { stopLocationTracking } from './backgroundTasks';
import { clearSosState } from '../store/locationStore';
import { useAuthStore } from '../store/authStore';

const CONTACTS_CACHE_KEY = '@trusted_contacts';

async function readRefreshToken(): Promise<string | null> {
  try {
    return Platform.OS === 'web' ? await AsyncStorage.getItem('refreshToken') : await SecureStore.getItemAsync('refreshToken');
  } catch {
    return null;
  }
}

/**
 * @param revoke false when the server already rejected the session (expired
 *   refresh token) — there is nothing left to revoke.
 */
export async function signOut({ revoke = true }: { revoke?: boolean } = {}): Promise<void> {
  // Needs the session, so it runs before the logout call revokes it.
  if (revoke) await unregisterPush();
  if (revoke) {
    const refreshToken = await readRefreshToken();
    if (refreshToken) {
      // Bare axios: never let the 401/refresh interceptor loop on a logout.
      await axios.post(`${getApiBaseUrl()}/auth/logout`, { refreshToken }, { timeout: 8000 }).catch(() => {});
    }
  }
  if (!revoke) await unregisterPush();
  socketService.disconnect();
  await Promise.all([stopLocationTracking('sos'), stopLocationTracking('route')]).catch(() => {});
  await Promise.all([
    AsyncStorage.removeItem(CONTACTS_CACHE_KEY).catch(() => {}),
    clearSmsHistory(),
    clearOfflineSos(),
    clearOutbox(),
    clearSosState(),
  ]);
  await useAuthStore.getState().logout();
}
