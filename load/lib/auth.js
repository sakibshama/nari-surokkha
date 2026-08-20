import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

/**
 * Log in once and return an access token.
 *
 * Called from setup() rather than per-VU: argon2id is deliberately expensive
 * (65MB, 3 iterations by default), so thousands of concurrent logins would
 * measure the password hasher rather than the endpoint under test.
 */
export function login(phone = __ENV.TEST_PHONE, password = __ENV.TEST_PASSWORD) {
  const res = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ phone, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
  );

  check(res, { 'login succeeded': (r) => r.status === 200 });

  const token = res.json('data.tokens.accessToken');
  if (!token) {
    throw new Error(
      `Login failed (status ${res.status}). Set TEST_PHONE and TEST_PASSWORD for the target environment.`,
    );
  }
  return token;
}

export function authHeaders(token) {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
}

/** A random point within roughly 5 km of central Dhaka. */
export function randomDhakaPoint() {
  return {
    latitude: 23.8103 + (Math.random() - 0.5) * 0.09,
    longitude: 90.4125 + (Math.random() - 0.5) * 0.09,
  };
}

/** Nudge a point by up to ~15 m, to simulate someone walking. */
export function drift(point) {
  return {
    latitude: point.latitude + (Math.random() - 0.5) * 0.0003,
    longitude: point.longitude + (Math.random() - 0.5) * 0.0003,
  };
}
