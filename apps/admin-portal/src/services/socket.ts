import { io, Socket } from 'socket.io-client';
import { create } from 'zustand';
import { useAuthStore } from '../store/authStore';
import api, { API_BASE_URL, refreshAccessToken, forceLogout } from './api';

const HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
// Prefer an explicit VITE_WS_URL; otherwise strip /api/v1 from the API URL.
const WS_URL: string =
  import.meta.env.VITE_WS_URL?.replace('localhost', HOST) || API_BASE_URL.replace(/\/api\/v1\/?$/, '');

// ── Connection status (for the Layout / Dashboard indicator) ────────────────
export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export const useSocketStatus = create<{ status: SocketStatus }>(() => ({ status: 'idle' }));
const setStatus = (status: SocketStatus) => {
  if (useSocketStatus.getState().status !== status) useSocketStatus.setState({ status });
};

type Handler = (...args: any[]) => void;

const isAuthError = (err: Error & { data?: unknown }) => /unauthori[sz]ed|jwt|token/i.test(err?.message ?? '');

/**
 * One app-wide socket.
 *
 * - `auth` is a function, so every (re)connect sends the CURRENT in-memory
 *   access token — the login-time token expires after 15 minutes.
 * - On an auth `connect_error` the access token is refreshed (sharing the
 *   single-flight refresh with axios) and the socket reconnects.
 * - Listeners are registered through `on/off` and kept in a registry, so they
 *   survive a disconnect/re-create and can be attached before `connect()`.
 *   `off` ALWAYS needs the handler: removing every listener of an event would
 *   also remove other components' listeners (the Layout siren bug).
 * - Rooms joined with `joinAlert` are re-joined after every reconnect.
 */
class SocketService {
  public socket: Socket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private alertRooms = new Set<string>();
  private authRetries = 0;

  connect() {
    if (this.socket) {
      if (!this.socket.connected && !this.socket.active) this.socket.connect();
      return;
    }

    // The WebSocket server requires a valid access token on the handshake.
    if (!useAuthStore.getState().accessToken) {
      if (import.meta.env.DEV) console.warn('Socket connect skipped: not authenticated yet');
      return;
    }

    setStatus('connecting');
    const socket = io(WS_URL, {
      transports: ['websocket'],
      autoConnect: true,
      auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
    });
    this.socket = socket;

    for (const [event, fns] of this.handlers) fns.forEach((fn) => socket.on(event, fn));

    socket.on('connect', () => {
      this.authRetries = 0;
      setStatus('connected');
      if (import.meta.env.DEV) console.log('Admin portal connected to WebSocket:', socket.id);
      socket.emit('join:admin');
      this.alertRooms.forEach((id) => socket.emit('join:alert', id));
    });

    socket.on('disconnect', (reason) => {
      if (import.meta.env.DEV) console.log('Admin portal disconnected from WebSocket:', reason);
      if (this.socket !== socket) return;
      if (reason === 'io server disconnect') {
        // The server dropped us (e.g. token revoked). socket.io will not retry
        // on its own in this case — refresh and reconnect.
        void this.reauthenticate(socket);
      } else {
        setStatus(socket.active ? 'reconnecting' : 'idle');
      }
    });

    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));

    socket.on('connect_error', (err) => {
      if (import.meta.env.DEV) console.warn('WebSocket connect error:', err.message);
      if (this.socket !== socket) return;
      if (isAuthError(err)) {
        // A middleware rejection is NOT retried by socket.io automatically.
        void this.reauthenticate(socket);
      } else {
        setStatus(socket.active ? 'reconnecting' : 'error');
      }
    });
  }

  private async reauthenticate(socket: Socket) {
    if (this.authRetries >= 3) {
      setStatus('error');
      return;
    }
    this.authRetries++;
    setStatus('reconnecting');
    try {
      await refreshAccessToken();
    } catch {
      // The refresh cookie is gone or revoked — the session is over.
      this.disconnect();
      forceLogout();
      return;
    }
    if (this.socket === socket && !socket.connected) socket.connect();
  }

  on(event: string, fn: Handler) {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    this.socket?.on(event, fn);
  }

  off(event: string, fn: Handler) {
    this.handlers.get(event)?.delete(fn);
    this.socket?.off(event, fn);
  }

  emit(event: string, ...args: unknown[]) {
    this.socket?.emit(event, ...args);
  }

  /** Join an alert room now (if connected) and after every reconnect. */
  joinAlert(alertId: string) {
    this.alertRooms.add(alertId);
    if (this.socket?.connected) this.socket.emit('join:alert', alertId);
  }

  /** Stop re-joining an alert room on reconnect. */
  leaveAlert(alertId: string) {
    this.alertRooms.delete(alertId);
  }

  disconnect() {
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      s.disconnect();
    }
    this.alertRooms.clear();
    this.authRetries = 0;
    setStatus('idle');
  }
}

export const socketService = new SocketService();

/** Sign out: revoke the refresh token server-side, then clear local state. */
export async function signOut() {
  try {
    await api.post('/auth/logout', {});
  } catch {
    /* best effort — the local session is cleared regardless */
  }
  socketService.disconnect();
  useAuthStore.getState().logout();
}
