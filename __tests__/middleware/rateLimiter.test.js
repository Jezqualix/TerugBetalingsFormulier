// __tests__/middleware/rateLimiter.test.js
const express = require('express');
const request = require('supertest');

const { submitLimiter, submissionKey, MAX_SUBMISSIONS } = require('../../src/middleware/rateLimiter');

// The counts below come from MAX_SUBMISSIONS, so changing the limit needs no test edit.
const post = (app, headers) => {
  const req = request(app).post('/');
  Object.entries(headers).forEach(([name, value]) => req.set(name, value));
  return req;
};
const postTimes = async (app, headers, times) => {
  const statuses = [];
  for (let i = 0; i < times; i += 1) statuses.push((await post(app, headers)).status);
  return statuses;
};

const UPN_A = 'danny.debie@dockx-group.be';
const UPN_B = 'iemand.anders@dockx-group.be';

// submitLimiter is a module-level singleton with an in-memory store, so counters
// survive from one test to the next. Clear the keys each test touches.
const RESET_KEYS = [UPN_A, UPN_B, '203.0.113.1', '203.0.113.2'];
beforeEach(() => RESET_KEYS.forEach((key) => submitLimiter.resetKey(key)));

// Minimal stand-in for POST /api/submissions: the limiter, then a handler whose
// status code the test controls — the real route answers 201, 422 or 500 there.
function appReturning(status) {
  const app = express();
  app.set('trust proxy', 1);
  app.post('/', submitLimiter, (req, res) => res.status(status).json({}));
  return app;
}

describe('submissionKey', () => {
  it('uses the Easy Auth UPN when present', () => {
    expect(submissionKey({ headers: { 'x-ms-client-principal-name': UPN_A }, ip: '10.0.0.1' })).toBe(UPN_A);
  });

  it('falls back to the IP without Easy Auth', () => {
    expect(submissionKey({ headers: {}, ip: '10.0.0.1' })).toBe('10.0.0.1');
  });

  it('lowercases the UPN so casing does not split the counter', () => {
    expect(submissionKey({ headers: { 'x-ms-client-principal-name': 'Danny.DeBie@Dockx-Group.be' } })).toBe(UPN_A);
  });
});

describe('submitLimiter', () => {
  it(`allows ${MAX_SUBMISSIONS} submissions per key and rejects the next one`, async () => {
    const app = appReturning(201);
    const accepted = await postTimes(app, { 'x-ms-client-principal-name': UPN_A }, MAX_SUBMISSIONS);
    expect(accepted.every((status) => status === 201)).toBe(true);

    const blocked = await post(app, { 'x-ms-client-principal-name': UPN_A });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'Too many submissions. Please try again later.' });
  });

  it('counts per user, so a shared NAT address does not block a colleague', async () => {
    const app = appReturning(201);
    const nat = '81.246.69.24';
    await postTimes(app, { 'x-ms-client-principal-name': UPN_A, 'x-forwarded-for': nat }, MAX_SUBMISSIONS);

    const other = await post(app, { 'x-ms-client-principal-name': UPN_B, 'x-forwarded-for': nat });
    expect(other.status).toBe(201);
  });

  it('does not let rejected submissions burn the quota', async () => {
    const rejecting = appReturning(422);
    const statuses = await postTimes(rejecting, { 'x-ms-client-principal-name': UPN_A }, MAX_SUBMISSIONS + 2);
    expect(statuses.every((status) => status === 422)).toBe(true);
  });

  it('keys on the IP when Easy Auth is absent', async () => {
    const app = appReturning(201);
    await postTimes(app, { 'x-forwarded-for': '203.0.113.1' }, MAX_SUBMISSIONS);

    expect((await post(app, { 'x-forwarded-for': '203.0.113.1' })).status).toBe(429);
    expect((await post(app, { 'x-forwarded-for': '203.0.113.2' })).status).toBe(201);
  });
});
