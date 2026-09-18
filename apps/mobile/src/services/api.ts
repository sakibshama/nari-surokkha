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
/**
 * Ports the API might be on in development. EXPO_PUBLIC_API_PORT pins one;
 * otherwise both common ones are tried, because a dev server moves between
 * them more often than anyone remembers to update a config file.
 */
const CONFIGURED_PORT = process.env['EXPO_PUBLIC_API_PORT'];
const DEV_API_PORTS = CONFIGURED_PORT ? [CONFIGURED_PORT] : ['3000', '3001'];
const DEV_API_PORT = DEV_API_PORTS[0];

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

/** Candidate dev servers, best guess first. Used by discoverApiUrl(). */
/**
 * Candidates to try, in order of preference, grouped so a whole group is
 * probed at once:
 *   1. the LAN address this app was served from (phone on the same Wi-Fi)
 *   2. this machine (simulator, USB/adb reverse, or a browser on the host)
 *   3. the Android emulator's alias for the host
 *   4. whatever the build was configured with (staging / production)
 */
function devCandidateGroups(): string[][] {
  const host = devHost();
  const onHostMachine = host === 'localhost' || host === '127.0.0.1' || host === '10.0.2.2';

  const groups: string[][] = [];
  if (!onHostMachine) groups.push(DEV_API_PORTS.map((port) => `http://${host}:${port}/api/v1`));
  groups.push(DEV_API_PORTS.map((port) => `http://localhost:${port}/api/v1`));
  if (Platform.OS === 'android') {
    groups.push(DEV_API_PORTS.map((port) => `http://10.0.2.2:${port}/api/v1`));
  }
  if (extra.apiUrl) groups.push([extra.apiUrl]);
  return groups;
}

/** Flat list, for error messages. */
function devCandidates(): string[] {
  return [...new Set(devCandidateGroups().flat())];
}

/**
 * Accept anything a person would reasonably type — "192.168.0.10:3000",
 * "http://192.168.0.10:3000/api", a trailing slash — and return the base URL
 * the client actually needs.
 */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim();
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/\/+$/, '');
  // Strip a path the user may have included, so we never build /api/api/v1.
  url = url.replace(/\/api(\/v\d+)?$/i, '');
  return `${url}/api/v1`;
}

/**
 * Resolution order:
 *   1. a server address the user saved in Settings  (checked at startup)
 *   2. EXPO_PUBLIC_API_URL                          — EAS build profile / .env
 *   3. expo.extra.apiUrl (app.json)                 — release builds
 *   4. the dev URL derived above                    — only when __DEV__
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

const OVERRIDE_KEY = '@api_base_url';

/**
 * The address the app is talking to RIGHT NOW.
 *
 * It is mutable on purpose. Guessing a dev machine's address from Metro works
 * for Wi-Fi but not for a USB cable, a tunnel, or a standalone build — and an
 * app that cannot be pointed at the right server is an app that cannot send an
 * SOS. `initApiTarget()` picks the first candidate that actually answers, and
 * Settings can pin one permanently.
 */
let activeBaseUrl = resolveApiUrl();

/**
 * @deprecated A snapshot taken at import time. Use `getApiBaseUrl()` — the
 * target can change at runtime (auto-detection, or a Settings override).
 */
export const API_BASE_URL = activeBaseUrl;
export const getApiBaseUrl = (): string => activeBaseUrl;
/** Where this build talks to — shown in error messages and the connection check. */
export const describeApiTarget = (): string => activeBaseUrl;
export const getWsBaseUrl = (): string =>
  process.env['EXPO_PUBLIC_WS_URL'] ?? activeBaseUrl.replace(/\/api\/v1\/?$/, '');

type TargetListener = (url: string) => void;
const targetListeners = new Set<TargetListener>();
export function onApiTargetChange(cb: TargetListener): () => void {
  targetListeners.add(cb);
  return () => targetListeners.delete(cb);
}

function setActive(url: string) {
  activeBaseUrl = url.replace(/\/+$/, '');
  api.defaults.baseURL = activeBaseUrl;
  if (__DEV__) console.log(`[api] base URL: ${activeBaseUrl}`);
  targetListeners.forEach((cb) => {
    try {
      cb(activeBaseUrl);
    } catch {
      /* a listener must never break the switch */
    }
  });
}

/** Save (or clear, with null) a server address chosen by the user. */
export async function setApiBaseUrl(url: string | null): Promise<string> {
  if (url) {
    const withPath = normalizeBaseUrl(url);
    await AsyncStorage.setItem(OVERRIDE_KEY, withPath);
    setActive(withPath);
    return withPath;
  }
  await AsyncStorage.removeItem(OVERRIDE_KEY);
  setActive(resolveApiUrl());
  return activeBaseUrl;
}

/** Does this server answer /ping? */
export async function probe(baseUrl: string, timeoutMs = 2500): Promise<boolean> {
  try {
    const res = await axios.get(`${baseUrl.replace(/\/+$/, '')}/ping`, {
      timeout: timeoutMs,
      headers: { 'ngrok-skip-browser-warning': 'true', 'Bypass-Tunnel-Reminder': 'true' },
    });
    return res.data?.message === 'pong';
  } catch {
    return false;
  }
}

/** The first URL in the list that answers, or null. Probes run concurrently. */
async function firstReachable(candidates: string[], timeoutMs = 2000): Promise<string | null> {
  const results = await Promise.all(
    candidates.map(async (c) => ((await probe(c, timeoutMs)) ? c : null)),
  );
  return results.find((r): r is string => r !== null) ?? null;
}

/**
 * Called once at startup. Uses a saved address if there is one, otherwise (in
 * development) tries each candidate until one answers, so the app works over
 * Wi-Fi, USB and the emulator without anyone editing a file.
 */
export async function initApiTarget(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(OVERRIDE_KEY);
    if (saved) {
      setActive(saved);
      return activeBaseUrl;
    }
  } catch {
    /* no saved address */
  }

  if (!__DEV__) {
    setActive(resolveApiUrl());
    return activeBaseUrl;
  }

  // Probe a whole group at once (fast), but keep the groups in preference
  // order so a phone prefers the LAN address over the host's own localhost.
  for (const group of devCandidateGroups()) {
    // eslint-disable-next-line no-await-in-loop
    const found = await firstReachable(group);
    if (found) {
      setActive(found);
      return activeBaseUrl;
    }
  }

  if (__DEV__) {
    console.warn(
      `[api] no server answered on ${devCandidates().join(', ')} — ` +
        'start the API, or set the address in Settings → Connection.',
    );
  }
  setActive(resolveApiUrl());
  return activeBaseUrl;
}

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
  baseURL: activeBaseUrl,
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
export const evidenceRawUrl = (evidenceId: string): string => `${activeBaseUrl}/evidence/${evidenceId}/raw`;

api.interceptors.request.use(async (config) => {
  config.baseURL = activeBaseUrl;
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
    const resp = await axios.post(`${activeBaseUrl}/auth/refresh`, { refreshToken });
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
        `Expected JSON from ${activeBaseUrl} but received a web page. ` +
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
        text2: activeBaseUrl,
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
