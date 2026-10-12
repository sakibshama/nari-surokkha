# Payments: admin-managed SSLCommerz and Stripe

Payment gateways and subscription plans are configured at runtime in **Admin Portal → Payment Gateways**. No redeploy is needed to add a gateway, rotate keys, switch from sandbox to live, or change prices.

## Set up

1. **Server.** `CONFIG_ENCRYPTION_KEY` must be set (`openssl rand -hex 32`); gateway secrets are encrypted at rest with it. `API_BASE_URL` must be the public HTTPS address of the API.
2. **Database.** `npx prisma migrate deploy`. This adds `subscriptions` and `payments` (migration `20261012000000_subscriptions_and_payments`). **Never `db push`.**
3. **Portal → Payment Gateways → + SSLCommerz / + Stripe.** Fill in the credentials, **Save**, **Test connection**, then tick **Show in app**. A gateway can't be enabled until its credentials are complete.

| Gateway | Credentials | Gateway-side setup |
|---|---|---|
| SSLCommerz | Store ID and store password (sandbox store from developer.sslcommerz.com) | Optional: IPN URL `…/api/v1/subscriptions/sslcommerz/ipn/<gatewayId>` (shown in the card; it is also sent with each payment) |
| Stripe | Publishable key, secret key (`sk_`/`rk_`), webhook signing secret (`whsec_`) | Dashboard → Webhooks → endpoint `…/api/v1/subscriptions/stripe/webhook/<gatewayId>` with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` |

Each gateway has its own **currency**. A plan is offered through a gateway only if the plan has a price in that currency. For example, SSLCommerz in BDT sells a plan at ৳50, and Stripe in USD sells the same plan at $0.50.

## How a payment is confirmed

```
app ── POST /subscriptions/initiate {planId, gatewayId} ──► payment row 'pending' ──► gateway checkout URL
user pays in the browser
gateway ── redirect / IPN / webhook ──► API re-checks with the gateway, server-to-server
       (SSLCommerz: validator API with val_id;  Stripe: signed webhook, or session retrieve)
       amount, currency and transaction id must match the payment row
       ──► subscription credited exactly once (a conditional update on status = 'pending')
browser ──► /subscriptions/result page ("return to the app")
app ── polls GET /subscriptions/payments/:transactionId ──► shows "Payment successful"
```

A gateway callback is never trusted on its own. The earlier code activated a subscription for any POST containing `status=VALID`, so anyone could get a free plan; that is fixed, and a test covers it.

**Renewing early stacks:** the new period starts when the current one ends, and unused SMS carry over.

## API

| Method | Path | Who |
|---|---|---|
| GET | `/api/v1/subscriptions/options` | app: enabled gateways + plans priced per gateway |
| POST | `/api/v1/subscriptions/initiate` | app |
| GET | `/api/v1/subscriptions/status`, `/payments/:transactionId` | app |
| GET | `/api/v1/payments/admin/config` | admin |
| POST / PUT / DELETE | `/api/v1/payments/admin/gateways[/:id]` | admin |
| POST | `/api/v1/payments/admin/gateways/:id/test` | admin |
| PUT | `/api/v1/payments/admin/plans` | admin |
| GET | `/api/v1/payments/admin/transactions` | admin |

## When the SMS quota runs out

The plan pays for SOS texts sent by the server. Without quota, or after the plan expires, the phone sends the SOS text from its own SIM, and the server sends it after all if the phone can't. See `notifications.service.ts` and `alerts.service.ts`.
