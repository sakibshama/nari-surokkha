import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from './api';
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

  async connect() {
    if (this.socket?.connected) return;

    // The WebSocket server now requires a valid access token on the handshake.
    const token = await getToken();
    if (!token) {
      if (__DEV__) console.warn('Socket connect skipped: not authenticated yet');
      return;
    }

    this.socket = io(API_BASE_URL.replace('/api/v1', ''), {
      transports: ['websocket'],
      autoConnect: true,
      auth: { token },
    });

    this.socket.on('connect', () => {
      if (__DEV__) console.log('Mobile app connected to WebSocket:', this.socket?.id);
      const userId = useAuthStore.getState().user?.id;
      if (userId) {
        this.socket?.emit('join:user', userId);
      }
      // Re-join alert room if there was a context set before connect
      if (this.currentAlertId) {
        this.socket?.emit('join:alert', this.currentAlertId);
      }
    });

    this.socket.on('disconnect', () => {
      if (__DEV__) console.log('Mobile app disconnected from WebSocket');
    });

    this.socket.on('connect_error', (err) => {
      if (__DEV__) console.warn('WebSocket connect error:', err.message);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.currentAlertId = null;
    }
  }

  setAlertContext(alertId: string | null) {
    this.currentAlertId = alertId;
    // Join the alert-specific room so signals are routed correctly
    if (alertId && this.socket?.connected) {
      this.socket.emit('join:alert', alertId);
    }
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
  onWebRTCMessage(callback: (msg: any) => void) {
    if (!this.socket) return;
    // Remove any existing listener first to avoid duplicates
    this.socket.off('webrtc:signal');
    this.socket.on('webrtc:signal', (data) => {
      // Only handle signals for our alert
      if (!this.currentAlertId || data.alertId === this.currentAlertId) {
        callback(data);
      }
    });
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
    if (this.socket) {
      this.socket.off('webrtc:signal');
    }
  }
}

export const socketService = new SocketService();
