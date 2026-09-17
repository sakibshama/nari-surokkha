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

/**
 * Dev = the LOCAL node server on the developer's machine.
 *
 * The old fallback hard-coded `10.0.2.2` (the Android EMULATOR's alias for the
 * host) and `localhost` everywhere else, so the app could never reach the API
 * from a real phone — it just showed "Connection Error".
 *
 * Expo already knows the right address: Metro is being served from the dev
 * machine, and its host is handed to the app as `hostUri`. Reusing it means a
 * phone on the same Wi-Fi hits e.g. http://192.168.0.12:3001 with no config,
 * while the emulator and simulator keep working.
 */
const DEV_API_PORT = process.env['EXPO_PUBLIC_API_PORT'] ?? '3001';

function devHost(): string {
  // Web: the page's own host — works for localhost and for a LAN address.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
    return window.location.hostname;
  }

  const c = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    expoGoConfig?: { debuggerHost?: string };
    manifest2?: { extra?: { expoGo?: { debuggerHost?: string } } };
    manifest?: { debuggerHost?: string; hostUri?: string };
  };
  const hostUri =
    c.expoConfig?.hostUri ??
    c.expoGoConfig?.debuggerHost ??
    c.manifest2?.extra?.expoGo?.debuggerHost ??
    c.manifest?.hostUri ??
    c.manifest?.debuggerHost;

  const host = hostUri?.split('://').pop()?.split('/')[0]?.split(':')[0];

  if (host && host !== 'localhost' && host !== '127.0.0.1') return host;

  // Metro is on localhost → we are the emulator/simulator on the same machine.
  return Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
}

const DEV_API_URL = `http://${devHost()}:${DEV_API_PORT}/api/v1`;

/**
 * Resolution order:
 *   1. EXPO_PUBLIC_API_URL          — set per EAS build profile / .env
 *   2. expo.extra.apiUrl (app.json) — the committed default, release builds
 *   3. the dev URL derived above    — only when __DEV__
 */
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

if (__DEV__) {
  // One line in the Metro log that answers "what is it actually calling?".
  console.log(`[api] base URL: ${API_BASE_URL}`);
}
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
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
    // Dev tunnels (ngrok / localtunnel) answer the FIRST request with an HTML
    // interstitial and HTTP 200. Without these headers the app receives that
    // page instead of JSON, and every call silently returns a body with no
    // data in it — which looked like "the server did not return an alert id".
    'ngrok-skip-browser-warning': 'true',
    'Bypass-Tunnel-Reminder': 'true',
  },
});

/** Where this build talks to — shown in error messages and the connection check. */
export const describeApiTarget = (): string => API_BASE_URL;

/** True when a 2xx body is clearly not our JSON API (tunnel page, proxy error). */
export function looksLikeNonApiResponse(data: unknown): boolean {
  if (typeof data !== 'string') return false;
  return /^\s*<(!doctype|html)/i.test(data);
}

/** A short, safe preview of an unexpected response body, for error messages. */
export function previewBody(data: unknown): string {
  try {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return (text ?? '').slice(0, 160);
  } catch {
    return String(data).slice(0, 160);
  }
}

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
  (response) => {
    // A 200 that is not our JSON is worse than an error: callers read fields
    // off it and get `undefined`. Turn it into a real failure with a message
    // that names the URL actually being called.
    if (looksLikeNonApiResponse(response.data)) {
      const err = new Error(
        `Expected JSON from ${API_BASE_URL} but received a web page. ` +
          'Check the API URL (EXPO_PUBLIC_API_URL / expo.extra.apiUrl) or your tunnel.',
      );
      (err as any).nonApiResponse = true;
      return Promise.reject(err);
    }
    return response;
  },
  async (error) => {
    // Network/offline error — never log the user out (offline SOS depends on
    // staying logged in). Just surface a toast.
    if (error.message === 'Network Error' || error.code === 'ECONNABORTED' || !error.response) {
      const Toast = require('react-native-toast-message').default;
      Toast.show({
        type: 'error',
        text1: 'Cannot reach the server',
        // Name the address that failed: "connection error" with no URL is
        // impossible to act on, and this is usually a wrong host or a
        // firewall on the dev machine.
        text2: API_BASE_URL,
        position: 'top',
        visibilityTime: 5000,
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
