/**
 * Public trusted-contact consent page (B4). Linked from the SMS sent by
 * POST /api/v1/contacts/:id/verification. Root-level (no /api/v1) so the SMS
 * link stays short. The unguessable token is the credential.
 *
 *   GET  /c/:token         → bilingual page with an "I agree" button
 *   POST /c/:token/accept  → marks the contact verified
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { ContactConsentService } from '@/modules/contacts/contact-consent';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function render(reply: FastifyReply, status: number, body: string): FastifyReply {
  return reply
    .code(status)
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Robots-Tag', 'noindex')
    .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'")
    .send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nari Surokkha</title>
<style>
  body { margin:0; font-family: system-ui, -apple-system, "Noto Sans Bengali", sans-serif; background:#f6f7f9; color:#1f2937; }
  main { max-width:440px; margin:40px auto; padding:24px; background:#fff; border-radius:12px; box-shadow:0 1px 4px rgba(0,0,0,.08); }
  h1 { font-size:20px; margin:0 0 12px; color:#006a4e; }
  p { line-height:1.5; margin:0 0 12px; }
  .bn { color:#4b5563; }
  button { width:100%; padding:14px; font-size:16px; border:0; border-radius:8px; background:#006a4e; color:#fff; cursor:pointer; }
</style>
</head>
<body><main>${body}</main></body>
</html>`);
}

const DEAD_LINK = `<h1>Link expired</h1>
<p>This link is invalid or has expired. Ask the person to send a new request from the app.</p>
<p class="bn" lang="bn">লিংকটি সঠিক নয় বা মেয়াদ শেষ হয়েছে। অ্যাপ থেকে নতুন অনুরোধ পাঠাতে বলুন।</p>`;

export function contactConsentRoutes(
  fastify: FastifyInstance,
  _opts: unknown,
  done: (err?: Error) => void,
): void {
  const consent = new ContactConsentService(fastify);
  const limit = { config: { rateLimit: { max: 30, timeWindow: 60_000 } } };

  fastify.get<{ Params: { token: string } }>('/c/:token', limit, async (request, reply) => {
    const record = await consent.lookup(request.params.token);
    if (!record) return render(reply, 404, DEAD_LINK);
    const name = escapeHtml(record.ownerFirstName);
    return render(reply, 200, `<h1>Emergency contact request</h1>
<p><strong>${name}</strong> added you as an emergency contact on Nari Surokkha. If ${name} triggers an SOS, you will get an SMS with their live location.</p>
<p class="bn" lang="bn"><strong>${name}</strong> আপনাকে নারী সুরক্ষা অ্যাপে জরুরি যোগাযোগ হিসেবে যুক্ত করেছেন। ${name} SOS পাঠালে আপনি তার লাইভ অবস্থানসহ একটি SMS পাবেন।</p>
<form method="post" action="/c/${escapeHtml(request.params.token)}/accept">
<button type="submit">I agree to be an emergency contact for ${name}<br><span lang="bn">আমি ${name}-এর জরুরি যোগাযোগ হতে সম্মত</span></button>
</form>`);
  });

  fastify.post<{ Params: { token: string } }>('/c/:token/accept', limit, async (request, reply) => {
    const record = await consent.accept(request.params.token);
    if (!record) return render(reply, 404, DEAD_LINK);
    const name = escapeHtml(record.ownerFirstName);
    return render(reply, 200, `<h1>Thank you</h1>
<p>You are now an emergency contact for ${name}.</p>
<p class="bn" lang="bn">আপনি এখন ${name}-এর জরুরি যোগাযোগ।</p>`);
  });

  done();
}
