import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ─── API URL Configuration ───────────────────────────────────────────────────
// Resolution order:
//   1. EXPO_PUBLIC_API_URL          — set per EAS build profile / .env
//   2. expo.extra.apiUrl (app.json) — the committed default per environment
//   3. the dev fallback below       — only when __DEV__
//
// The production URL used to be a bare constant in this file, which meant a
// staging build and a production build were the same binary pointed at the
// same server: there was no way to test a release candidate against staging
// without editing source and rebuilding. Configure it in eas.json instead:
//
//   "build": { "staging": { "env": { "EXPO_PUBLIC_API_URL": "https://api.staging.../api/v1" } } }

import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; wsUrl?: string };

// Dev = LOCAL node server. iOS simulator + Expo web reach it on localhost;
// Android emulator uses the 10.0.2.2 alias for the host machine.
const DEV_API_URL = Platform.OS === 'android'
  ? 'http://10.0.2.2:3001/api/v1'      // Android emulator → host machine
  : 'http://localhost:3001/api/v1';    // iOS simulator / Expo web

function resolveApiUrl(): string {
  const fromEnv = process.env['EXPO_PUBLIC_API_URL'];
  if (fromEnv) return fromEnv;
  if (extra.apiUrl && !__DEV__) return extra.apiUrl;
  if (__DEV__) return DEV_API_URL;
  // A release build with no configured URL is a build error, not something to
  // paper over with a default that might point at the wrong environment.
  throw new Error(
    'No API URL configured. Set EXPO_PUBLIC_API_URL or expo.extra.apiUrl before building.',
  );
}

export const API_BASE_URL = resolveApiUrl();
export const WS_BASE_URL =
  process.env['EXPO_PUBLIC_WS_URL'] ?? extra.wsUrl ?? API_BASE_URL.replace(/\/api\/v1$/, '');

// ─── WebRTC ICE servers ──────────────────────────────────────────────────────
// STUN discovers the public address; TURN relays media when peer-to-peer fails
// (common on cellular CGNAT / cross-network). The authoritative list — including
// the TURN credential — comes from the server via fetchIceServers(); this is
// only a STUN-only FALLBACK used if that request fails (works same-network).
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
];

/**
 * Fetch the ICE server list (STUN + TURN with the real credential) from the
 * API. Centralizing it server-side means the TURN password can never drift out
 * of sync the way a hardcoded client value does. Falls back to STUN-only.
 */
export async function fetchIceServers(): Promise<any[]> {
  try {
    const res = await api.get('/config/ice-servers');
    const list = res.data?.data?.iceServers;
    if (Array.isArray(list) && list.length) return list;
  } catch {
    /* fall through to STUN-only */
  }
  return ICE_SERVERS;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

const getItem = async (key: string) => {
  if (Platform.OS === 'web') {
    return await AsyncStorage.getItem(key);
  } else {
    return await SecureStore.getItemAsync(key);
  }
};

/** Current access token — for attaching auth headers to <Image> requests etc. */
export const getAccessToken = (): Promise<string | null> => getItem('accessToken');

/** Absolute URL to stream an evidence file's raw bytes (needs the auth header). */
export const evidenceRawUrl = (evidenceId: string): string => `${API_BASE_URL}/evidence/${evidenceId}/raw`;

api.interceptors.request.use(async (config) => {
  const token = await getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.baseURL?.includes('loca.lt')) {
    config.headers['Bypass-Tunnel-Reminder'] = 'true';
  }
  return config;
});

const setItem = async (key: string, value: string) => {
  if (Platform.OS === 'web') return AsyncStorage.setItem(key, value);
  return SecureStore.setItemAsync(key, value);
};

// Serialize concurrent refreshes so a burst of 401s triggers only one refresh.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await getItem('refreshToken');
  if (!refreshToken) return null;
  try {
    // Bare axios (not `api`) so this request skips the interceptor.
    const resp = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
    const tokens = resp.data?.data ?? resp.data;
    const newAccess = tokens?.accessToken;
    const newRefresh = tokens?.refreshToken;
    if (newAccess) {
      await setItem('accessToken', newAccess);
      if (newRefresh) await setItem('refreshToken', newRefresh);
      return newAccess;
    }
    return null;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Network/offline error — never log the user out (offline SOS depends on
    // staying logged in). Just surface a toast.
    if (error.message === 'Network Error' || error.code === 'ECONNABORTED' || !error.response) {
      const Toast = require('react-native-toast-message').default;
      Toast.show({
        type: 'error',
        text1: 'Connection Error',
        text2: 'Could not connect to backend server',
        position: 'top',
      });
      return Promise.reject(error);
    }

    const original = error.config || {};

    // Access token expired → try to silently refresh once, then retry.
    // Never retry the refresh call itself.
    if (
      error.response.status === 401 &&
      !original._retry &&
      !String(original.url || '').includes('/auth/refresh') &&
      !String(original.url || '').includes('/auth/login')
    ) {
      original._retry = true;
      if (!refreshPromise) refreshPromise = refreshAccessToken();
      const newToken = await refreshPromise;
      refreshPromise = null;

      if (newToken) {
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original); // retry the original request
      }

      // Refresh failed (refresh token expired/revoked) → genuine logout.
      const { useAuthStore } = require('../store/authStore');
      await useAuthStore.getState().logout();
    }

    return Promise.reject(error);
  }
);

export default api;
