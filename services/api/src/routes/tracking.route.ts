/**
 * Public SOS live-tracking page.
 *
 * Trusted contacts receive a short link (…/t/:token) by SMS. The token is an
 * opaque id stored in Redis that maps to the alert — no account or app needed.
 *
 *   GET /t/:token        → a self-contained HTML map page (Leaflet / OpenStreetMap)
 *   GET /t/:token/live   → JSON with the victim's current location + status
 *
 * These are intentionally PUBLIC (the unguessable, 24h-expiring token is the
 * credential). They live at the root (no /api/v1 prefix) so the SMS link stays
 * short.
 */

import { FastifyInstance } from 'fastify';
import { getLastPosition } from '@/modules/alerts/alert-location.buffer';

interface TrackingRef {
  alertId: string;
  contactId?: string;
}

const INACTIVE_STATUSES = ['resolved', 'false_alarm', 'cancelled', 'canceled', 'closed'];

async function resolveToken(fastify: FastifyInstance, token: string): Promise<TrackingRef | null> {
  try {
    const raw = await fastify.redis.get(`track:${token}`);
    if (!raw) return null;
    return JSON.parse(raw) as TrackingRef;
  } catch {
    return null;
  }
}

function page(token: string): string {
  // Self-contained: Leaflet from CDN, polls /t/:token/live every 5s.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Nari Surokkha — Live SOS Location</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  :root { --green:#006a4e; --red:#f42a41; }
  * { box-sizing: border-box; }
  html,body { margin:0; height:100%; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#0b1120; color:#e5e7eb; }
  #bar { padding:12px 16px; display:flex; align-items:center; gap:10px; background:#0e1626; border-bottom:1px solid rgba(255,255,255,.08); }
  #dot { width:12px; height:12px; border-radius:50%; background:var(--red); box-shadow:0 0 0 0 rgba(244,42,65,.6); animation:pulse 1.6s infinite; }
  #dot.safe { background:#10b981; animation:none; }
  @keyframes pulse { 0%{box-shadow:0 0 0 0 rgba(244,42,65,.6);} 70%{box-shadow:0 0 0 12px rgba(244,42,65,0);} 100%{box-shadow:0 0 0 0 rgba(244,42,65,0);} }
  #title { font-weight:700; font-size:15px; }
  #sub { font-size:12px; color:#94a3b8; }
  #map { position:absolute; top:57px; bottom:0; left:0; right:0; }
  #msg { position:absolute; top:57px; left:0; right:0; padding:14px 16px; background:#1e293b; font-size:13px; text-align:center; display:none; z-index:500; }
  .cap { display:flex; flex-direction:column; }
</style>
</head>
<body>
  <div id="bar">
    <span id="dot"></span>
    <div class="cap">
      <span id="title">Live SOS Location</span>
      <span id="sub">Connecting…</span>
    </div>
  </div>
  <div id="msg"></div>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    function escapeHTML(str) {
      return String(str).replace(/[&<>'"]/g, function(tag) {
        var charsToReplace = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
        return charsToReplace[tag] || tag;
      });
    }
    var TOKEN = ${JSON.stringify(token).replace(/</g, '\\u003c')};
    var map = L.map('map', { zoomControl: true }).setView([23.8103, 90.4125], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);
    var marker = null, first = true;
    function setStatus(active, name, when) {
      document.getElementById('dot').className = active ? '' : 'safe';
      document.getElementById('title').textContent = active ? ('🚨 ' + name + ' needs help') : (name + ' — marked safe');
      document.getElementById('sub').textContent = active ? ('Live location · updated ' + when) : ('Alert closed · last update ' + when);
    }
    function showMsg(t) { var m=document.getElementById('msg'); m.textContent=t; m.style.display='block'; }
    async function poll() {
      try {
        var r = await fetch('/t/' + TOKEN + '/live', { cache:'no-store' });
        if (r.status === 404) { showMsg('This tracking link has expired or is invalid.'); return; }
        var d = await r.json();
        if (typeof d.latitude !== 'number' || typeof d.longitude !== 'number') return;
        var ll = [d.latitude, d.longitude];
        var when = d.updatedAt ? new Date(d.updatedAt).toLocaleTimeString() : 'now';
        setStatus(!!d.active, d.name || 'Someone', when);
        if (!marker) { marker = L.marker(ll).addTo(map); } else { marker.setLatLng(ll); }
        marker.bindPopup(escapeHTML(d.name || 'SOS') + '<br>' + d.latitude.toFixed(5) + ', ' + d.longitude.toFixed(5));
        if (first) { map.setView(ll, 16); first = false; }
      } catch (e) { /* keep last known position */ }
    }
    poll();
    setInterval(poll, 5000);
  </script>
</body>
</html>`;
}

export async function trackingRoutes(fastify: FastifyInstance): Promise<void> {
  // Live JSON — the page polls this.
  fastify.get('/t/:token/live', async (req, reply) => {
    const { token } = req.params as { token: string };
    const ref = await resolveToken(fastify, token);
    if (!ref) return reply.code(404).send({ active: false, error: 'Link expired or invalid' });

    const [alert, live] = await Promise.all([
      fastify.prisma.emergencyAlert.findUnique({
        where: { id: ref.alertId },
        include: { user: { include: { profile: true } } },
      }),
      // Live position from Redis. Location pings are now batched into Postgres
      // every 15s, so the denormalised column can lag; Redis holds the current
      // position and is written on every ping. Reading it here keeps the family
      // watching this page as up-to-date as they were before — in fact more so,
      // since it no longer waits on a database write.
      getLastPosition(fastify, ref.alertId),
    ]);
    if (!alert) return reply.code(404).send({ active: false, error: 'Alert not found' });

    const active = !INACTIVE_STATUSES.includes(alert.status);
    return reply
      .header('Cache-Control', 'no-store')
      .send({
        active,
        status: alert.status,
        name: alert.user?.profile?.fullName || 'Someone',
        latitude: live ? live.latitude : Number(alert.latitude),
        longitude: live ? live.longitude : Number(alert.longitude),
        updatedAt: live ? live.timestamp : alert.updatedAt,
      });
  });

  // HTML tracking page.
  fastify.get('/t/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    return reply.type('text/html; charset=utf-8').send(page(token));
  });
}
