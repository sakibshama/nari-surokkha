import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { env } from '@/config/env';

async function firebasePlugin(fastify: FastifyInstance): Promise<void> {
  // Only initialize if we have a project ID (allows running without real creds during dev)
  if (!env.FIREBASE_PROJECT_ID) {
    fastify.log.warn('Firebase configuration missing (FIREBASE_PROJECT_ID). Firebase Admin SDK will not be initialized.');
    return;
  }

  try {
    if (getApps().length === 0) {
      if (env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
        // Service-account credentials from env. Private keys stored in env
        // files carry literal "\n" sequences — restore real newlines.
        initializeApp({
          credential: cert({
            projectId: env.FIREBASE_PROJECT_ID,
            clientEmail: env.FIREBASE_CLIENT_EMAIL,
            privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          }),
        });
      } else {
        // Fallback: Application Default Credentials (GCP environments).
        initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
        fastify.log.warn(
          'Firebase initialized WITHOUT explicit credentials — FCM sends will fail unless ADC is available. Set FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.',
        );
      }
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
