/**
 * Firebase Push Notification Provider
 */

import { getMessaging } from 'firebase-admin/messaging';
import { PushProvider } from './push.provider';
import { env } from '@/config/env';

export class FirebasePushProvider implements PushProvider {
  async sendPush(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      if (!env.FIREBASE_PROJECT_ID) {
        return { success: false, error: 'Firebase not configured' };
      }

      const message = {
        token,
        notification: {
          title,
          body,
        },
        data: data || {},
        android: {
          priority: 'high' as const,
          notification: {
            channelId: 'emergency-alerts',
            sound: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const messageId = await getMessaging().send(message);
      
      return { success: true, messageId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
