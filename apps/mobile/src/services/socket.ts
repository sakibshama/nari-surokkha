import { io, Socket } from 'socket.io-client';
import { getWsBaseUrl, refreshSession } from './api';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { useAuthStore } from '../store/authStore';

// Read the stored access token the same way the HTTP client does.
const getToken = async (): Promise<string | null> => {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem('accessToken');
  }
  return SecureStore.getItemAsync('accessToken');
};

class SocketService {
  public socket: Socket | null = null;
  private currentAlertId: string | null = null;
  // Stored so the webrtc:signal listener can be (re)attached the moment the
  // socket exists — connect() is async, so callers often register the handler
  // before the socket object has been created.
  private webrtcCallback: ((msg: any) => void) | null = null;
  // Generic listeners that must survive the async connect + reconnects (e.g.
  // responder dispatch events). Registering socket.on() directly at mount is
  // unreliable because connect() is async and this.socket is often still null.
  private persistentHandlers: Array<{ event: string; cb: (...args: any[]) => void }> = [];

  /** Register an event handler that persists across (re)connects. */
  on(event: string, cb: (...args: any[]) => void) {
    if (!this.persistentHandlers.some((h) => h.event === event && h.cb === cb)) {
      this.persistentHandlers.push({ event, cb });
    }
    this.socket?.on(event, cb);
  }

  /** Remove a persistent handler. */
  off(event: string, cb: (...args: any[]) => void) {
    this.persistentHandlers = this.persistentHandlers.filter((h) => !(h.event === event && h.cb === cb));
    this.socket?.off(event, cb);
  }

  private reattachPersistent() {
    if (!this.socket) return;
    for (const h of this.persistentHandlers) {
      this.socket.off(h.event, h.cb);
      this.socket.on(h.event, h.cb);
    }
  }

  private connected = false;
  private connectionListeners = new Set<(connected: boolean) => void>();
  private reauthing = false;

  isConnected(): boolean {
    return this.connected;
  }

  /** Observe the realtime link (the SOS screen shows it). Returns an unsubscribe. */
  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.connectionListeners.add(cb);
    cb(this.connected);
    return () => {
      this.connectionListeners.delete(cb);
    };
  }

  private setConnected(v: boolean) {
    if (this.connected === v) return;
    this.connected = v;
    this.connectionListeners.forEach((cb) => cb(v));
  }

  async connect() {
    // One app-wide socket. socket.io reconnects it by itself; never replace it.
    if (this.socket) {
      if (!this.socket.connected) this.socket.connect();
      return;
    }

    // The WebSocket server requires a valid access token on the handshake.
    if (!(await getToken())) {
      if (__DEV__) console.warn('Socket connect skipped: not authenticated yet');
      return;
    }

    this.socket = io(getWsBaseUrl(), {
      transports: ['websocket'],
      autoConnect: true,
      // A function, so every (re)connect presents the CURRENT token rather
      // than the one from login (access tokens live 15 minutes).
      auth: (cb) => {
        void getToken().then((token) => cb({ token }));
      },
    });

    // Attach any handlers registered before the socket existed (WebRTC + the
    // generic persistent listeners like responder dispatch events).
    this.attachWebRTCListener();
    this.reattachPersistent();

    this.socket.on('connect', () => {
      if (__DEV__) console.log('Mobile app connected to WebSocket:', this.socket?.id);
      this.setConnected(true);
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        this.socket?.emit('join:user', userId);
      }
      // Re-join the alert room after every reconnect.
      if (this.currentAlertId) {
        this.socket?.emit('join:alert', this.currentAlertId);
      }
    });

    this.socket.on('disconnect', () => {
      if (__DEV__) console.log('Mobile app disconnected from WebSocket');
      this.setConnected(false);
    });

    this.socket.on('connect_error', (err) => {
      if (__DEV__) console.warn('WebSocket connect error:', err.message);
      this.setConnected(false);
      // A rejected handshake is not retried by socket.io: refresh the token,
      // then reconnect (the auth callback reads the new one).
      if (/unauthori[sz]ed|token/i.test(err.message) && !this.reauthing) {
        this.reauthing = true;
        void refreshSession()
          .then((token) => {
            if (token && this.socket && !this.socket.connected) this.socket.connect();
          })
          .finally(() => {
            setTimeout(() => {
              this.reauthing = false;
            }, 10_000);
          });
      }
    });
  }

  /** Close the app-wide socket. Only on logout. */
  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.currentAlertId = null;
    this.setConnected(false);
  }

  setAlertContext(alertId: string | null) {
    const previous = this.currentAlertId;
    if (previous && previous !== alertId) this.socket?.emit('leave:alert', previous);
    this.currentAlertId = alertId;
    // Join the alert-specific room so signals are routed correctly
    if (alertId && this.socket?.connected) {
      this.socket.emit('join:alert', alertId);
    }
  }

  /** Stop listening to one alert's room, keeping the socket itself open. */
  leaveAlert(alertId: string) {
    if (this.currentAlertId === alertId) this.setAlertContext(null);
  }

  sendLocationUpdate(latitude: number, longitude: number, accuracy?: number) {
    if (!this.socket || !this.socket.connected || !this.currentAlertId) {
      return false; // Unable to send via socket
    }

    // Currently the backend expects `POST /:id/location`, so we just have 
    // the backend route handle WebSocket broadcast for MVP, 
    // but we can also emit directly to socket if we add a handler on the backend.
    // For now, since the API doesn't have an `alert:location_update` incoming listener,
    // we'll stick to HTTP POST for updating the backend, which *then* broadcasts to web.
    // Wait, the plan was to "stream location updates directly to the backend instead of polling HTTP".
    // Let's implement the `alert_location_update` receiver on the backend in a minute,
    // OR we just use the existing HTTP endpoint which emits the socket event. 
    // The HTTP endpoint is fine for now, but WebSockets are lower latency.
    // Let's emit it anyway for future-proofing, but we will rely on HTTP for the MVP unless updated.

    this.socket.emit('alert:location_update_from_client', {
      alertId: this.currentAlertId,
      latitude,
      longitude,
      accuracy,
    });

    return true;
  }

  // WebRTC Signaling

  /** (Re)attach the webrtc:signal listener if we have both a socket and a cb. */
  private attachWebRTCListener() {
    if (!this.socket || !this.webrtcCallback) return;
    // Remove any existing listener first to avoid duplicates
    this.socket.off('webrtc:signal');
    this.socket.on('webrtc:signal', (data) => {
      // Only handle signals for our alert
      if (!this.currentAlertId || data.alertId === this.currentAlertId) {
        this.webrtcCallback?.(data);
      }
    });
  }

  onWebRTCMessage(callback: (msg: any) => void) {
    // Store the handler and attach now if the socket already exists; otherwise
    // connect() will attach it as soon as the (async) socket is created.
    this.webrtcCallback = callback;
    this.attachWebRTCListener();
  }

  sendWebRTCSignal(signal: any) {
    if (this.socket && this.socket.connected && this.currentAlertId) {
      this.socket.emit('webrtc:signal', { alertId: this.currentAlertId, signal });
      if (__DEV__) console.log('[WebRTC] Sent signal type:', signal?.type);
    } else {
      if (__DEV__) console.warn('[WebRTC] Cannot send signal — socket not connected or no alertId', {
        connected: this.socket?.connected,
        alertId: this.currentAlertId
      });
    }
  }

  offWebRTCMessage() {
    this.webrtcCallback = null;
    if (this.socket) {
      this.socket.off('webrtc:signal');
    }
  }
}

export const socketService = new SocketService();
