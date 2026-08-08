// __tests__/routes/me.test.js
jest.mock('../../src/config/db');

const request = require('supertest');
const app = require('../../src/server');

const encode = (claims) => Buffer.from(JSON.stringify({ auth_typ: 'aad', claims })).toString('base64');

describe('GET /api/me', () => {
  it('returns the Easy Auth identity', async () => {
    const raw = encode([
      { typ: 'name', val: 'Danny De bie' },
      { typ: 'preferred_username', val: 'danny.debie@dockx-group.be' },
    ]);
    const res = await request(app).get('/api/me').set('x-ms-client-principal', raw);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Danny De bie', email: 'danny.debie@dockx-group.be' });
  });

  it('returns {} without Easy Auth headers', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('returns {} for a malformed principal header instead of erroring', async () => {
    const res = await request(app).get('/api/me').set('x-ms-client-principal', 'not-base64!!');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});
