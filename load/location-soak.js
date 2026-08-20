/**
 * Live-location soak.
 *
 * Models many alerts streaming position for a sustained period — the highest
 * frequency write path in the system. Each ping used to cost three database
 * round trips; they are now buffered in Redis and flushed in batches, so what
 * this test really measures is whether that buffer keeps up and whether the
 * flusher drains it.
 *
 * Run it for at least 10 minutes. A short run will pass even if the buffer
 * grows without bound; the failure mode here is gradual.
 *
 *   BASE_URL=... k6 run --duration 15m load/location-soak.js
 *
 * While it runs, watch queue_depth and the Redis memory graph. Steady is
 * healthy; a monotonic climb means the flusher is behind.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, login, authHeaders, randomDhakaPoint, drift } from './lib/auth.js';

const pingLatency = new Trend('location_ping_latency', true);

export const options = {
  scenarios: {
    tracking: {
      executor: 'constant-vus',
      vus: Number(__ENV.ACTIVE_ALERTS || 300),
      duration: __ENV.DURATION || '10m',
    },
  },
  thresholds: {
    // A location ping should be trivially cheap now that it is a Redis write.
    'location_ping_latency': ['p(95)<100', 'p(99)<250'],
    'http_req_failed': ['rate<0.01'],
  },
};

export function setup() {
  return { token: login() };
}

export default function (data) {
  // Each VU owns one alert for its whole lifetime, which is what a real
  // tracked emergency looks like.
  if (!__ITER) {
    const start = randomDhakaPoint();
    const created = http.post(
      `${BASE_URL}/api/v1/alerts/sos`,
      JSON.stringify({ ...start, accuracy: 10 }),
      { ...authHeaders(data.token), tags: { name: 'POST /alerts/sos (setup)' } },
    );
    check(created, { 'alert created': (r) => r.status === 200 || r.status === 201 });
    globalThis.__alertId = created.json('data.id');
    globalThis.__point = start;
  }

  const alertId = globalThis.__alertId;
  if (!alertId) {
    sleep(10);
    return;
  }

  globalThis.__point = drift(globalThis.__point);

  const res = http.post(
    `${BASE_URL}/api/v1/alerts/${alertId}/location`,
    JSON.stringify({ ...globalThis.__point, accuracy: 8 }),
    { ...authHeaders(data.token), tags: { name: 'POST /alerts/:id/location' } },
  );

  pingLatency.add(res.timings.duration);
  check(res, { 'ping accepted': (r) => r.status === 200 || r.status === 204 });

  // Matches the mobile app's native cadence (10s / 10m).
  sleep(10);
}
