import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import type { JwtAccessPayload } from '@/types/index';

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
  }
}

/** Identity attached to every authenticated socket. */
interface SocketUser {
  id: string;
  role: string;
  phone: string;
  stationId?: string;
}

// Augment the Socket type so `socket.data.user` is typed.
interface AuthedSocket extends Socket {
  data: { user: SocketUser };
}

function isPrivileged(role: string): boolean {
  // Police / admin / dispatch may observe alerts across users.
  return role === 'police' || role === 'admin' || role === 'dispatch';
}

async function websocketPlugin(fastify: FastifyInstance): Promise<void> {
  const io = new SocketIOServer(fastify.server, {
    cors: {
      origin: env.WS_CORS_ORIGINS,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // ─── Handshake authentication ──────────────────────────────
  // Every connection MUST present a valid access token. Emergency location
  // and WebRTC signalling data flow over this socket, so anonymous access is
  // never allowed.
  io.use((socket, next) => {
    try {
      const raw =
        (socket.handshake.auth as { token?: string } | undefined)?.token ??
        (typeof socket.handshake.headers.authorization === 'string'
          ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
          : undefined);

      if (!raw) {
        return next(new Error('Unauthorized: missing token'));
      }

      const payload = jwt.verify(raw, env.JWT_SECRET) as JwtAccessPayload;
      if (payload.type !== 'access') {
        return next(new Error('Unauthorized: invalid token type'));
      }

      (socket as AuthedSocket).data.user = {
        id: payload.sub,
        role: payload.role,
        phone: payload.phone,
        stationId: payload.stationId,
      };
      return next();
    } catch {
      return next(new Error('Unauthorized: invalid or expired token'));
    }
  });

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthedSocket;
    const user = socket.data.user;
    fastify.log.info(`WebSocket client connected: ${socket.id} (user=${user.id}, role=${user.role})`);

    // ─── Room joins (authorized) ─────────────────────────────
    // Citizens may only join rooms scoped to their own identity/alerts.
    // Police/admin may join station and alert rooms for coordination.
    socket.on('join:station', (stationId: string) => {
      if (!isPrivileged(user.role)) {
        socket.emit('error', { message: 'Forbidden: cannot join station room' });
        return;
      }
      // Station officers may only join their own station.
      if (user.role === 'police' && user.stationId && user.stationId !== stationId) {
        socket.emit('error', { message: 'Forbidden: not your station' });
        return;
      }
      void socket.join(`station:${stationId}`);
      fastify.log.info(`Socket ${socket.id} joined room station:${stationId}`);
    });

    socket.on('join:user', (userId: string) => {
      // A user may only join their own user room; privileged roles may observe.
      if (userId !== user.id && !isPrivileged(user.role)) {
        socket.emit('error', { message: 'Forbidden: cannot join another user room' });
        return;
      }
      void socket.join(`user:${userId}`);
      fastify.log.info(`Socket ${socket.id} joined room user:${userId}`);
    });

    socket.on('join:alert', async (alertId: string) => {
      // Owner of the alert or a privileged responder may join the alert room.
      const authorized = isPrivileged(user.role) || (await ownsAlert(fastify, alertId, user.id));
      if (!authorized) {
        socket.emit('error', { message: 'Forbidden: cannot join this alert room' });
        return;
      }
      void socket.join(`alert:${alertId}`);
      fastify.log.info(`Socket ${socket.id} joined room alert:${alertId}`);
    });

    socket.on('alert:location_update_from_client', async (data: { alertId: string; latitude: number; longitude: number }) => {
      // Only the alert owner (or a privileged role) may push location updates,
      // and updates are scoped to that alert's room — never broadcast globally.
      const authorized = isPrivileged(user.role) || (await ownsAlert(fastify, data.alertId, user.id));
      if (!authorized) {
        socket.emit('error', { message: 'Forbidden: cannot update this alert' });
        return;
      }
      io.to(`alert:${data.alertId}`).emit('alert:location_update', {
        alertId: data.alertId,
        latitude: data.latitude,
        longitude: data.longitude,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('webrtc:signal', (data: { alertId?: string; signal?: unknown; [key: string]: unknown }) => {
      const { alertId } = data;
      if (!alertId || !socket.rooms.has(`alert:${alertId}`)) {
        socket.emit('error', { message: 'Forbidden: not a participant of this alert' });
        return;
      }
      socket.to(`alert:${alertId}`).emit('webrtc:signal', data);
    });

    socket.on('webrtc:mode_changed', (data: { alertId?: string; mode?: string; [key: string]: unknown }) => {
      const { alertId } = data;
      if (!alertId || !socket.rooms.has(`alert:${alertId}`)) {
        socket.emit('error', { message: 'Forbidden: not a participant of this alert' });
        return;
      }
      socket.to(`alert:${alertId}`).emit('webrtc:mode_changed', data);
    });

    socket.on('disconnect', () => {
      fastify.log.info(`WebSocket client disconnected: ${socket.id}`);
    });
  });

  fastify.decorate('io', io);

  fastify.addHook('onClose', (app, done) => {
    app.io.close(() => {
      app.log.info('Socket.IO server closed');
      done();
    });
  });

  fastify.log.info('✅ WebSocket plugin initialized (authenticated)');
}

/** Returns true if the given alert belongs to the given user. */
async function ownsAlert(fastify: FastifyInstance, alertId: string, userId: string): Promise<boolean> {
  if (!alertId) return false;
  try {
    const alert = await fastify.prisma.emergencyAlert.findUnique({
      where: { id: alertId },
      select: { userId: true },
    });
    return !!alert && alert.userId === userId;
  } catch (err) {
    fastify.log.error(err, 'ownsAlert lookup failed');
    return false;
  }
}

export default fp(websocketPlugin, {
  name: 'websocket',
  fastify: '5.x',
  // prisma must be available for alert-ownership checks on room joins
  dependencies: ['database'],
});
