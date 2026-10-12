import { FastifyRequest, FastifyReply } from 'fastify';
import { SubscriptionService, ResultStatus } from './subscription.service';
import { renderResultPage } from './result.page';

type Body = Record<string, string> | undefined;

export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  getOptions = async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ success: true, data: await this.service.getOptions() });
  };

  initiatePayment = async (req: FastifyRequest<{ Body: { planId: string; gatewayId?: string } }>, reply: FastifyReply) => {
    const result = await this.service.initiatePayment(req.user!.id, req.body.planId, req.body.gatewayId);
    return reply.send({ success: true, data: result });
  };

  getSubscriptionStatus = async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ success: true, data: await this.service.getSubscriptionStatus(req.user!.id) });
  };

  getPaymentStatus = async (req: FastifyRequest<{ Params: { transactionId: string } }>, reply: FastifyReply) => {
    return reply.send({ success: true, data: await this.service.getPaymentStatus(req.user!.id, req.params.transactionId) });
  };

  private toResult(reply: FastifyReply, r: { status: ResultStatus; transactionId?: string }) {
    return reply.redirect(this.service.resultUrl(r.status, r.transactionId), 303);
  }

  // ── SSLCommerz browser redirects (form POST) ──
  sslSuccess = async (req: FastifyRequest<{ Body: Body }>, reply: FastifyReply) =>
    this.toResult(reply, await this.service.handleSslcommerzPaid(req.body));
  sslFail = async (req: FastifyRequest<{ Body: Body }>, reply: FastifyReply) =>
    this.toResult(reply, await this.service.handleSslcommerzClosed(req.body, 'failed'));
  sslCancel = async (req: FastifyRequest<{ Body: Body }>, reply: FastifyReply) =>
    this.toResult(reply, await this.service.handleSslcommerzClosed(req.body, 'cancelled'));

  /** SSLCommerz IPN (server-to-server). Always 200 so it is not retried forever; the result is logged. */
  sslIpn = async (req: FastifyRequest<{ Body: Body }>, reply: FastifyReply) => {
    const r = await this.service.handleSslcommerzPaid(req.body);
    return reply.send({ received: true, status: r.status });
  };

  // ── Stripe ──
  stripeReturn = async (
    req: FastifyRequest<{ Params: { gatewayId: string }; Querystring: { session_id?: string } }>,
    reply: FastifyReply,
  ) => this.toResult(reply, await this.service.handleStripeReturn(req.params.gatewayId, String(req.query.session_id ?? '')));

  stripeCancel = async (req: FastifyRequest<{ Querystring: { trx?: string } }>, reply: FastifyReply) =>
    this.toResult(reply, await this.service.handleStripeCancel(String(req.query.trx ?? '')));

  stripeWebhook = async (req: FastifyRequest<{ Params: { gatewayId: string } }>, reply: FastifyReply) => {
    const ok = await this.service.handleStripeWebhook(
      req.params.gatewayId,
      req.body as Buffer,
      req.headers['stripe-signature'] as string | undefined,
    );
    if (!ok) return reply.code(400).send({ error: 'Invalid signature or gateway' });
    return reply.send({ received: true });
  };

  resultPage = async (req: FastifyRequest<{ Querystring: { status?: string; trx?: string } }>, reply: FastifyReply) => {
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
      .type('text/html; charset=utf-8')
      .send(renderResultPage(String(req.query.status ?? 'pending'), req.query.trx ? String(req.query.trx).slice(0, 100) : undefined));
  };
}
