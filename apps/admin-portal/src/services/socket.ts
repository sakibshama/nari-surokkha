import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

const HOST = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
const API_URL = import.meta.env.VITE_API_URL?.replace('localhost', HOST) || `http://${HOST}:3001/api/v1`;
// Strip /api/v1 for the websocket connection
const WS_URL = API_URL.replace(/\/api\/v1\/?$/, '');

class SocketService {
  public socket: Socket | null = null;

  connect() {
    if (this.socket) return;

    // The WebSocket server now requires a valid access token on the handshake.
    const token = useAuthStore.getState().accessToken;
    if (!token) {
      if (import.meta.env.DEV) console.warn('Socket connect skipped: not authenticated yet');
      return;
    }

    this.socket = io(WS_URL, {
      transports: ['websocket'],
      autoConnect: true,
      auth: { token },
    });

    this.socket.on('connect', () => {
      if (import.meta.env.DEV) console.log('Admin portal connected to WebSocket:', this.socket?.id);
      // Admins listen to dispatch/global events for MVP
      this.socket?.emit('join:station', 'dispatch');
    });

    this.socket.on('disconnect', () => {
      if (import.meta.env.DEV) console.log('Admin portal disconnected from WebSocket');
    });

    this.socket.on('connect_error', (err) => {
      if (import.meta.env.DEV) console.warn('WebSocket connect error:', err.message);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const socketService = new SocketService();
