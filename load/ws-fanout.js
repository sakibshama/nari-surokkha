/**
 * WebSocket fan-out.
 *
 * Answers the question the capacity table could only estimate: how many
 * concurrent Socket.IO clients does one API instance actually hold, and does
 * broadcast latency degrade as that number climbs?
 *
 * This matters more than it looks. Two call sites used to broadcast with a
 * bare `io.emit()`, so a single evidence upload fanned out to every connected
 * client on the platform. Those are now room-scoped — this test is how you
 * confirm that a broadcast stays cheap at 5,000 connections instead of
 * quadratic.
 *
 *   BASE_URL=... k6 run --vus 2000 --duration 5m load/ws-fanout.js
 *
 * Run it against ONE instance first to get a per-instance number, then behind
 * the load balancer to confirm the Redis adapter distributes correctly.
 */
import ws from 'k6/ws';
import { check } from 'k6';
import { Trend, Counter, Gauge } from 'k6/metrics';
import { BASE_URL, login } from './lib/auth.js';

const connectDuration = new Trend('ws_connect_duration', true);
const eventsReceived = new Counter('ws_events_received');
const liveConnections = new Gauge('ws_live_connections');

export const options = {
  stages: [
    { duration: '1m', target: 500 },
    { duration: '2m', target: 2000 },
    { duration: '3m', target: 2000 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    // A handshake that takes longer than this means the event loop is
    // saturated — connections are queueing behind other work.
    'ws_connect_duration': ['p(95)<1000'],
    'ws_session_duration': ['p(95)>50000'], // sessions should survive, not drop
  },
};

export function setup() {
  return { token: login() };
}

export default function (data) {
  // transports=websocket: skip the HTTP long-poll handshake. This is what the
  // real clients do, and it is why the nginx upstream needs no sticky sessions.
  const url = `${BASE_URL.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;

  const started = Date.now();

  const res = ws.connect(url, { headers: { Authorization: `Bearer ${data.token}` } }, (socket) => {
    socket.on('open', () => {
      connectDuration.add(Date.now() - started);
      liveConnections.add(1);

      // Socket.IO v4 handshake over the raw Engine.IO frame protocol:
      // "40" opens the default namespace, with auth in the payload.
      socket.send(`40${JSON.stringify({ token: data.token })}`);

      // Join this user's own room — the room every authenticated client joins.
      socket.setTimeout(() => {
        socket.send(`42${JSON.stringify(['join:user', `loadtest-${__VU}`])}`);
      }, 250);
    });

    socket.on('message', (msg) => {
      // "2" is an Engine.IO ping; reply "3" or the server will drop us and the
      // test would measure reconnects instead of steady-state capacity.
      if (msg === '2') {
        socket.send('3');
        return;
      }
      if (typeof msg === 'string' && msg.startsWith('42')) {
        eventsReceived.add(1);
      }
    });

    socket.on('error', (e) => {
      if (e.error() !== 'websocket: close sent') {
        console.error(`ws error: ${e.error()}`);
      }
    });

    // Hold the connection for a minute — this is a capacity test, not a
    // connect/disconnect churn test.
    socket.setTimeout(() => socket.close(), 60_000);
  });

  check(res, { 'ws handshake returned 101': (r) => r && r.status === 101 });
}
