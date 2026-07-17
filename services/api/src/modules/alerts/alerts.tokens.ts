/**
 * Alerts Token Utility — JWT generation for tracking links
 */

import jwt from 'jsonwebtoken';
import { env } from '@/config/env';

export interface TrackingTokenPayload {
  alertId: string;
  trustedContactId?: string;
  type: 'tracking';
}

export function generateTrackingToken(alertId: string, trustedContactId?: string): string {
  const payload: TrackingTokenPayload = {
    alertId,
    trustedContactId,
    type: 'tracking',
  };

  // The tracking token will be valid for 24 hours, sufficient for an SOS alert window
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '24h' });
}

export function verifyTrackingToken(token: string): TrackingTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as TrackingTokenPayload;
  
  if (decoded.type !== 'tracking') {
    throw new Error('Invalid token type');
  }

  return decoded;
}
