import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { env } from '@/config/env';
import type { JwtAccessPayload } from '@/types/index';
import { wsConnections } from '@/plugins/metrics';
import { ADMIN_ROOM } from '@/utils/alert-rooms';
import { canAccessAlert } from '@/utils/alert-access';
import { isTokenVersionValid } from '@/utils/token-version';

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
}

// Augment the Socket type so `socket.data.user` is typed.
interface AuthedSocket extends Socket {
  data: { user: SocketUser };
}

function isPrivileged(role: string): boolean {
  // Only admins may observe alerts across users.
  return role === 'admin' || role === 'superadmin';
}

async function websocketPlugin(fastify: FastifyInstance): Promise<void> {
  const io = new SocketIOServer(fastify.server, {
    cors: {
      origin: env.WS_CORS_ORIGINS,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // ─── Horizontal scaling: Redis adapter ─────────────────────
  // Broadcasts (alert rooms, WebRTC signalling, location updates) are relayed
  // through Redis pub/sub, so multiple API instances behind a load balancer all
  // deliver to the right sockets. Uses dedicated duplicated clients (the sub
  // client blocks on SUBSCRIBE, so it must not be the shared app client).
  try {
    const pubClient = fastify.redis.duplicate();
    const subClient = fastify.redis.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    fastify.addHook('onClose', async () => {
      await Promise.allSettled([pubClient.quit(), subClient.quit()]);
    });
    fastify.log.info('✅ Socket.IO Redis adapter enabled (multi-instance ready)');
  } catch (err) {
    // Non-fatal: fall back to the in-memory adapter (single-instance only).
    fastify.log.warn({ err }, 'Socket.IO Redis adapter unavailable — using in-memory adapter');
  }

  // ─── Handshake authentication ──────────────────────────────
  // Every connection MUST present a valid access token. Emergency location
  // and WebRTC signalling data flow over this socket, so anonymous access is
  // never allowed.
  const authenticateSocket = async (socket: Socket): Promise<Error | undefined> => {
    try {
      const raw =
        (socket.handshake.auth as { token?: string } | undefined)?.token ??
        (typeof socket.handshake.headers.authorization === 'string'
          ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
          : undefined);
      if (!raw) return new Error('Unauthorized: missing token');

      const payload = jwt.verify(raw, env.JWT_SECRET) as JwtAccessPayload;
      if (payload.type !== 'access') return new Error('Unauthorized: invalid token type');

      // Revoked sessions (password change, role change, deactivation) must not
      // keep receiving live emergency data over an already-issued token.
      if (!(await isTokenVersionValid(fastify, payload.sub, payload.ver))) {
        return new Error('Unauthorized: token revoked');
      }

      (socket as AuthedSocket).data.user = {
        id: payload.sub,
        role: payload.role,
        phone: payload.phone,
      };
      return undefined;
    } catch {
      return new Error('Unauthorized: invalid or expired token');
    }
  };

  io.use((socket, next) => {
    void authenticateSocket(socket).then((err) => next(err));
  });

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthedSocket;
    const user = socket.data.user;
    fastify.log.info(`WebSocket client connected: ${socket.id} (user=${user.id}, role=${user.role})`);
    wsConnections.inc({ role: user.role });

    // ─── Room joins (authorized) ─────────────────────────────
    // Citizens may only join rooms scoped to their own identity/alerts.
    // Admins may join the global admin room for the live dashboard.
    socket.on('join:admin', () => {
      if (!isPrivileged(user.role)) {
        socket.emit('error', { message: 'Forbidden: cannot join admin room' });
        return;
      }
      void socket.join(ADMIN_ROOM);
      fastify.log.info(`Socket ${socket.id} joined room ${ADMIN_ROOM}`);
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
      // The owner, an admin, or a responder who ACCEPTED a dispatch for it.
      const authorized = await mayJoinAlert(fastify, alertId, user);
      if (!authorized) {
        socket.emit('error', { message: 'Forbidden: cannot join this alert room' });
        return;
      }
      void socket.join(`alert:${alertId}`);
      fastify.log.info(`Socket ${socket.id} joined room alert:${alertId}`);
    });

    socket.on('leave:alert', (alertId: string) => {
      if (typeof alertId !== 'string') return;
      void socket.leave(`alert:${alertId}`);
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
      wsConnections.dec({ role: user.role });
    });
  });

  fastify.decorate('io', io);

  fastify.addHook('onClose', (app, done) => {
    void app.io.close(() => {
      app.log.info('Socket.IO server closed');
      done();
    });
  });

  fastify.log.info('✅ WebSocket plugin initialized (authenticated)');
}

async function mayJoinAlert(fastify: FastifyInstance, alertId: string, user: SocketUser): Promise<boolean> {
  if (typeof alertId !== 'string' || !alertId) return false;
  try {
    return await canAccessAlert(fastify.prisma, alertId, user);
  } catch (err) {
    fastify.log.error(err, 'join:alert authorisation lookup failed');
    return false;
  }
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
  // prisma must be available for alert-ownership checks on room joins;
  // redis powers the multi-instance Socket.IO adapter.
  dependencies: ['database', 'redis'],
});
