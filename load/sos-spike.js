/**
 * SOS spike.
 *
 * Models what this system exists for: an incident happens and many people
 * press the button within the same minute. This is the scenario that used to
 * be worst-case, because the whole responder fan-out ran inline on the request
 * — around fifteen sequential round trips before the phone got a reply.
 *
 * The thresholds mirror infra/monitoring/alerts.yml, so a failure here is the
 * same condition that would page someone in production.
 *
 *   BASE_URL=https://api.staging.example.com k6 run load/sos-spike.js
 *
 * WARNING: creates real alerts. Staging only, with SMS_PROVIDER=mock.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { BASE_URL, login, authHeaders, randomDhakaPoint } from './lib/auth.js';

const sosLatency = new Trend('sos_trigger_latency', true);
const sosFailures = new Rate('sos_failures');

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // warm up
    { duration: '30s', target: 500 }, // the spike
    { duration: '2m', target: 500 },  // hold — does it degrade over time?
    { duration: '30s', target: 0 },   // recover
  ],
  thresholds: {
    // The SLO. If this fails, the panic button is slow under load.
    'sos_trigger_latency': ['p(95)<500', 'p(99)<1000'],
    'sos_failures': ['rate<0.01'],
    'http_req_failed': ['rate<0.01'],
  },
};

export function setup() {
  return { token: login() };
}

export default function (data) {
  const point = randomDhakaPoint();

  const res = http.post(
    `${BASE_URL}/api/v1/alerts/sos`,
    JSON.stringify({ ...point, accuracy: 10 }),
    { ...authHeaders(data.token), tags: { name: 'POST /alerts/sos' } },
  );

  sosLatency.add(res.timings.duration);
  sosFailures.add(res.status !== 200 && res.status !== 201);

  check(res, {
    'sos accepted': (r) => r.status === 200 || r.status === 201,
    'returns an alert id': (r) => !!r.json('data.id'),
    // The whole point of moving the fan-out to a queue: the caller should not
    // be waiting on responder dispatch.
    'responded in under 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
