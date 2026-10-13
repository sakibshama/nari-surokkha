import { PrismaClient, Prisma } from '@prisma/client';

/** Statuses a gateway-confirmed payment may still be credited from. */
export const CREDITABLE_STATUSES = ['pending', 'cancelled', 'failed'] as const;

export interface NewPayment {
  userId: string;
  amount: number;
  currency: string;
  transactionId: string;
  planId: string;
  gatewayId: string;
  gatewayType: string;
}

export class SubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  createPayment(data: NewPayment) {
    return this.prisma.payment.create({ data: { ...data, status: 'pending' } });
  }

  getPaymentByTrxId(transactionId: string) {
    return this.prisma.payment.findUnique({ where: { transactionId } });
  }

  setGatewaySession(transactionId: string, gatewaySessionId: string | undefined) {
    return this.prisma.payment.update({ where: { transactionId }, data: { gatewaySessionId: gatewaySessionId ?? null } });
  }

  /** pending → failed/cancelled only; never downgrades a successful payment. */
  markClosed(transactionId: string, status: 'failed' | 'cancelled', reason?: string) {
    return this.prisma.payment.updateMany({
      where: { transactionId, status: 'pending' },
      data: { status, failureReason: reason?.slice(0, 250) ?? null },
    });
  }

  getSubscriptionByUserId(userId: string) {
    return this.prisma.subscription.findUnique({ where: { userId } });
  }

  getUserContact(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, email: true, profile: { select: { fullName: true } } },
    });
  }

  /**
   * The gateway CONFIRMED this payment: mark it successful AND credit the
   * subscription, atomically and exactly once. The conditional update is the
   * lock, so the browser return, the IPN and the webhook racing each other
   * credit once.
   *
   * 'cancelled' / 'failed' are claimable too: those come from unauthenticated
   * browser redirects, and a user who backed out and then paid in the same
   * session must still be credited once the gateway says the money arrived.
   *
   * `paid` is true when the row is 'success' after this call (credited now or
   * earlier) — the only condition under which the user may be told "success".
   */
  async completePayment(
    transactionId: string,
    gateway: { gatewayTrxId?: string; method?: string },
    plan: { id: string; smsQuota: number; durationDays: number },
  ): Promise<{ credited: boolean; paid: boolean }> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.payment.updateMany({
        where: { transactionId, status: { in: [...CREDITABLE_STATUSES] } },
        data: {
          status: 'success',
          failureReason: null,
          gatewayTrxId: gateway.gatewayTrxId?.slice(0, 100) ?? null,
          paymentMethod: gateway.method?.slice(0, 50) ?? null,
        },
      });
      if (claimed.count === 0) {
        const current = await tx.payment.findUnique({ where: { transactionId }, select: { status: true } });
        return { credited: false, paid: current?.status === 'success' };
      }
      const payment = await tx.payment.findUniqueOrThrow({ where: { transactionId } });
      const now = new Date();
      const existing = await tx.subscription.findUnique({ where: { userId: payment.userId } });
      const stillRunning = existing && existing.status === 'active' && existing.endDate > now;
      // Renewing early stacks: the new period starts when the current one ends,
      // and unused SMS carry over.
      const start = stillRunning ? existing.endDate : now;
      const endDate = new Date(start.getTime() + plan.durationDays * 86_400_000);
      const smsRemaining = (stillRunning ? existing.smsRemaining : 0) + plan.smsQuota;
      const sub = await tx.subscription.upsert({
        where: { userId: payment.userId },
        create: { userId: payment.userId, status: 'active', planId: plan.id, startDate: now, endDate, smsRemaining },
        update: { status: 'active', planId: plan.id, ...(stillRunning ? {} : { startDate: now }), endDate, smsRemaining },
      });
      await tx.payment.update({ where: { transactionId }, data: { subscriptionId: sub.id } });
      return { credited: true, paid: true };
    });
  }

  listPayments(limit: number, status?: string) {
    return this.prisma.payment.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { user: { select: { phone: true, profile: { select: { fullName: true } } } } },
    });
  }
}
