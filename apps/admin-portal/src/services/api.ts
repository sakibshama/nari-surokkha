import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL?.replace('localhost', HOST) || `http://${HOST}:3001/api/v1`;

const tunnelHeaders = (url: string): Record<string, string> =>
  url.includes('loca.lt') ? { 'Bypass-Tunnel-Reminder': 'true' } : {};

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // always send cookies (for httpOnly refreshToken)
});

// Interceptor to attach the in-memory access token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (config.baseURL?.includes('loca.lt')) {
    config.headers['Bypass-Tunnel-Reminder'] = 'true';
  }
  return config;
});

// ── Token refresh (single-flight) ────────────────────────────────────────────
// The API rotates refresh tokens and treats reuse of an old one as theft, so
// two concurrent refreshes (several 401s at once, the socket reconnecting while
// a request retries, React StrictMode double effects…) must share ONE request.
let refreshInFlight: Promise<string> | null = null;

/**
 * Exchange the httpOnly refresh cookie for a new access token.
 * Resolves with the token (also stored in memory); rejects if the session is
 * gone. Callers decide what to do on failure.
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true, headers: tunnelHeaders(API_BASE_URL) })
      .then((res) => {
        const body = res.data?.data ?? res.data;
        const token: string | undefined = body?.accessToken;
        if (!token) throw new Error('Refresh response did not include an access token');
        const store = useAuthStore.getState();
        store.setAccessToken(token);
        // Contract: refresh returns { accessToken, user } — keep permissions current.
        if (body?.user) store.setUser(body.user);
        return token;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/** Clear the local session and go to the login page (once). */
export function forceLogout() {
  useAuthStore.getState().logout();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

// ── Response interceptor: auto-refresh on 401 ────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const url: string = originalRequest?.url ?? '';

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !url.includes('/auth/refresh') &&
      !url.includes('/auth/login')
    ) {
      originalRequest._retry = true;
      try {
        const token = await refreshAccessToken();
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers['Authorization'] = `Bearer ${token}`;
        return api(originalRequest);
      } catch (err) {
        forceLogout();
        return Promise.reject(err);
      }
    }

    return Promise.reject(error);
  },
);

/** Best human-readable message from an API error. */
export function apiErrorMessage(e: any, fallback: string): string {
  return e?.response?.data?.error?.message || e?.response?.data?.message || fallback;
}

export default api;
