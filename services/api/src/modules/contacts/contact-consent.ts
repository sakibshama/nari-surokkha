/**
 * Trusted-contact consent (B4).
 *
 * A contact is "verified" only when the person behind the number agrees to be
 * an emergency contact. The owner asks for it (POST /contacts/:id/verification);
 * the contact gets an SMS link to a public page (/c/:token) and taps "I agree".
 *
 * The token is 32 random bytes; only its SHA-256 is stored (Redis, 7 days),
 * together with the phone it was sent to, so changing the contact's number
 * invalidates an outstanding link.
 */

import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '@/config/env';
import { AppError, ConflictError, NotFoundError, TooManyRequestsError } from '@/utils/errors';
import { sendTransactionalSms } from '@/modules/notifications/providers/sms/transactional';

export const CONSENT_TTL_SECONDS = 7 * 24 * 3600;
/** One SMS per contact per minute — the owner cannot SMS-bomb a number. */
const RESEND_COOLDOWN_SECONDS = 60;

interface ConsentRecord {
  contactId: string;
  userId: string;
  phone: string;
  ownerFirstName: string;
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const consentKey = (token: string) => `contact-consent:${hashToken(token)}`;
const cooldownKey = (contactId: string) => `contact-consent:cooldown:${contactId}`;

export function firstName(fullName?: string | null): string {
  return fullName?.trim().split(/\s+/)[0] || 'A Nari Surokkha user';
}

export function consentUrl(token: string): string {
  return `${env.API_BASE_URL.replace(/\/$/, '')}/c/${token}`;
}

export class ContactConsentService {
  constructor(private readonly fastify: FastifyInstance) {}

  async send(userId: string, contactId: string): Promise<{ sent: true }> {
    const contact = await this.fastify.prisma.trustedContact.findFirst({
      where: { id: contactId, userId },
      include: { user: { select: { profile: { select: { fullName: true } } } } },
    });
    if (!contact) throw new NotFoundError('Contact');
    if (contact.isVerified) throw new ConflictError('This contact has already agreed.');

    const fresh = await this.fastify.redis.set(cooldownKey(contactId), '1', 'EX', RESEND_COOLDOWN_SECONDS, 'NX');
    if (fresh !== 'OK') throw new TooManyRequestsError('A request was just sent. Please wait a minute.');

    const token = crypto.randomBytes(32).toString('base64url');
    const owner = firstName(contact.user.profile?.fullName);
    const record: ConsentRecord = { contactId, userId, phone: contact.phone, ownerFirstName: owner };
    await this.fastify.redis.set(consentKey(token), JSON.stringify(record), 'EX', CONSENT_TTL_SECONDS);

    const result = await sendTransactionalSms(
      this.fastify,
      contact.phone,
      `${owner} wants you as an emergency contact on Nari Surokkha. ` +
        `Confirm / নিশ্চিত করুন: ${consentUrl(token)}`,
    );
    if (!result.success) {
      await this.fastify.redis.del(consentKey(token), cooldownKey(contactId));
      this.fastify.log.error({ contactId, error: result.error }, 'Contact consent SMS failed');
      throw new AppError('Could not send the SMS. Please try again.', 503, 'SMS_001');
    }
    return { sent: true };
  }

  /** The request behind a link, without consuming it (GET must be safe: link previews). */
  async lookup(token: string): Promise<ConsentRecord | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const raw = await this.fastify.redis.get(consentKey(token));
    return raw ? (JSON.parse(raw) as ConsentRecord) : null;
  }

  /** Mark the contact verified. Returns the record, or null if the link is dead. */
  async accept(token: string): Promise<ConsentRecord | null> {
    const record = await this.lookup(token);
    if (!record) return null;
    const { count } = await this.fastify.prisma.trustedContact.updateMany({
      // Same owner AND same number the link was sent to.
      where: { id: record.contactId, userId: record.userId, phone: record.phone },
      data: { isVerified: true },
    });
    await this.fastify.redis.del(consentKey(token));
    return count > 0 ? record : null;
  }
}
