/** Tiny bilingual page the browser lands on after paying. The app polls the real status. */
const TEXT = {
  success: ['Payment successful', 'পেমেন্ট সফল হয়েছে', '#16a34a'],
  pending: ['Payment is being confirmed', 'পেমেন্ট নিশ্চিত করা হচ্ছে', '#d97706'],
  failed: ['Payment failed', 'পেমেন্ট ব্যর্থ হয়েছে', '#dc2626'],
  cancelled: ['Payment cancelled', 'পেমেন্ট বাতিল হয়েছে', '#64748b'],
  test: ['Gateway test', 'গেটওয়ে পরীক্ষা', '#64748b'],
} as const;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderResultPage(status: string, trx?: string): string {
  const [en, bn, color] = TEXT[(status as keyof typeof TEXT)] ?? TEXT.pending;
  const deepLink = `narisurokkha://subscription${trx ? `?trx=${encodeURIComponent(trx)}` : ''}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nari Surokkha</title><style>
body{margin:0;font-family:system-ui,-apple-system,"Noto Sans Bengali",sans-serif;background:#0f172a;color:#f8fafc;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{max-width:420px;margin:16px;padding:32px 24px;border-radius:20px;background:#111c33;text-align:center;border:1px solid #23314f}
.dot{width:64px;height:64px;border-radius:50%;margin:0 auto 16px;background:${color}}
h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:0 0 16px;font-weight:500;color:#cbd5e1}
p{color:#94a3b8;font-size:14px;line-height:1.5}a.btn{display:inline-block;margin-top:12px;padding:12px 20px;border-radius:12px;background:#e11d48;color:#fff;text-decoration:none;font-weight:600}
code{color:#cbd5e1}</style></head><body><div class="card"><div class="dot"></div>
<h1>${esc(en)}</h1><h2>${esc(bn)}</h2>
<p>You can close this page and return to the Nari Surokkha app.<br>এই পেজটি বন্ধ করে নারী সুরক্ষা অ্যাপে ফিরে যান।</p>
${trx ? `<p>Ref: <code>${esc(trx)}</code></p>` : ''}
<a class="btn" href="${esc(deepLink)}">Open the app · অ্যাপ খুলুন</a></div></body></html>`;
}
