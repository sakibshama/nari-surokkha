/**
 * WebRTC ICE servers for GET /config/ice-servers (B5).
 *
 * The static TURN password used to be handed to every logged-in user, which
 * made the relay an open proxy for anyone who ever had an account. Now:
 *   - Twilio NTS when configured (unchanged), cached until 5 minutes before
 *     its tokens expire instead of minting one per request;
 *   - otherwise, with TURN_SECRET, short-lived coturn REST credentials
 *     (`use-auth-secret`): username "<expiry>:<userId>",
 *     credential = base64(HMAC-SHA1(TURN_SECRET, username));
 *   - otherwise STUN only.
 */

import crypto from 'crypto';
import type { FastifyBaseLogger } from 'fastify';
import { env } from '@/config/env';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export const TURN_CREDENTIAL_TTL_SECONDS = 3600;
const TWILIO_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function turnRestCredentials(
  secret: string,
  userId: string,
  nowMs = Date.now(),
  ttlSeconds = TURN_CREDENTIAL_TTL_SECONDS,
): { username: string; credential: string } {
  const username = `${Math.floor(nowMs / 1000) + ttlSeconds}:${userId}`;
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

let twilioCache: { servers: IceServer[]; refreshAt: number } | null = null;

/** For tests. */
export function resetIceServerCache(): void {
  twilioCache = null;
}

async function twilioIceServers(log: FastifyBaseLogger): Promise<IceServer[] | null> {
  if (twilioCache && Date.now() < twilioCache.refreshAt) return twilioCache.servers;
  try {
    const sid = env.TWILIO_ACCOUNT_SID!;
    const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}` },
    });
    const data = (await res.json()) as { ice_servers?: IceServer[]; ttl?: string | number };
    if (!res.ok || !data.ice_servers) throw new Error(`Twilio responded ${res.status}`);
    const ttlMs = (Number(data.ttl) || 86_400) * 1000;
    twilioCache = { servers: data.ice_servers, refreshAt: Date.now() + Math.max(0, ttlMs - TWILIO_REFRESH_MARGIN_MS) };
    return data.ice_servers;
  } catch (err) {
    log.error({ err }, 'Twilio TURN token fetch failed');
    return null;
  }
}

export async function buildIceServers(userId: string, log: FastifyBaseLogger): Promise<IceServer[]> {
  const stun: IceServer = { urls: env.STUN_URL };

  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    const servers = await twilioIceServers(log);
    if (servers) return servers;
  }

  if (env.TURN_HOST && env.TURN_SECRET) {
    return [
      stun,
      {
        urls: [
          `turn:${env.TURN_HOST}:${env.TURN_PORT}?transport=udp`,
          `turn:${env.TURN_HOST}:${env.TURN_PORT}?transport=tcp`,
        ],
        ...turnRestCredentials(env.TURN_SECRET, userId),
      },
    ];
  }

  return [stun];
}
