import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { initializeApp, getApps } from 'firebase-admin/app';
import { env } from '@/config/env';

async function firebasePlugin(fastify: FastifyInstance): Promise<void> {
  // Only initialize if we have a project ID (allows running without real creds during dev)
  if (!env.FIREBASE_PROJECT_ID) {
    fastify.log.warn('Firebase configuration missing (FIREBASE_PROJECT_ID). Firebase Admin SDK will not be initialized.');
    return;
  }

  try {
    if (getApps().length === 0) {
      initializeApp({
        projectId: env.FIREBASE_PROJECT_ID,
        // In production, you would typically use application default credentials
        // or a service account key path here.
      });
    }

    fastify.log.info('✅ Firebase Admin SDK initialized');
  } catch (error) {
    fastify.log.error(error, '❌ Failed to initialize Firebase Admin SDK');
  }
}

export default fp(firebasePlugin, {
  name: 'firebase',
  fastify: '5.x',
});
