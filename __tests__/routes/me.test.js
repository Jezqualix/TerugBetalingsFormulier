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
    expect(res.body).toEqual({
      name: 'Danny De bie',
      email: 'danny.debie@dockx-group.be',
      isAdmin: false,
    });
  });

  it('returns isAdmin true when the principal carries the Admin role', async () => {
    const raw = encode([
      { typ: 'name', val: 'Danny De bie' },
      { typ: 'preferred_username', val: 'danny.debie@dockx-group.be' },
      { typ: 'roles', val: 'Admin' },
    ]);
    const res = await request(app).get('/api/me').set('x-ms-client-principal', raw);
    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
  });

  it('returns isAdmin false for a non-Admin role', async () => {
    const raw = encode([
      { typ: 'preferred_username', val: 'iemand@dockx-group.be' },
      { typ: 'roles', val: 'Reader' },
    ]);
    const res = await request(app).get('/api/me').set('x-ms-client-principal', raw);
    expect(res.body.isAdmin).toBe(false);
  });

  it('honours a custom ADMIN_ROLE', async () => {
    const prev = process.env.ADMIN_ROLE;
    process.env.ADMIN_ROLE = 'TbfBeheerder';
    try {
      const raw = encode([{ typ: 'roles', val: 'TbfBeheerder' }]);
      const res = await request(app).get('/api/me').set('x-ms-client-principal', raw);
      expect(res.body.isAdmin).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ADMIN_ROLE;
      else process.env.ADMIN_ROLE = prev;
    }
  });

  it('returns no identity without Easy Auth headers', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isAdmin: false });
  });

  it('returns no identity for a malformed principal header instead of erroring', async () => {
    const res = await request(app).get('/api/me').set('x-ms-client-principal', 'not-base64!!');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isAdmin: false });
  });
});
