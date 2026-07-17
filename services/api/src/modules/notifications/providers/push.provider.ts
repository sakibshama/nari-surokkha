/**
 * Push Notification Provider
 */

export interface PushProvider {
  sendPush(token: string, _title: string, _body: string, _data?: Record<string, string>): Promise<{ success: boolean; messageId?: string; error?: string }>;
}

export class MockPushProvider implements PushProvider {
  async sendPush(token: string, _title: string, _body: string, _data?: Record<string, string>): Promise<{ success: boolean; messageId?: string; error?: string }> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // Simulate occasional random failure (10% chance)
    if (Math.random() < 0.1) {
      return { success: false, error: 'Simulated FCM timeout' };
    }

    console.log({ token: token.substring(0, 10) + '...' }, 'Mock PUSH sent successfully');
    
    return { 
      success: true, 
      messageId: `mock-fcm-${Date.now()}-${Math.floor(Math.random() * 1000)}` 
    };
  }
}
