// __tests__/middleware/auth.test.js
const request = require('supertest');
const express = require('express');

const { requireAdmin } = require('../../src/middleware/auth');

const app = express();
app.get('/protected', requireAdmin, (req, res) => res.json({ ok: true }));

// Build an Easy-Auth-style X-MS-CLIENT-PRINCIPAL header from role claims.
function principal(roles, typ = 'roles') {
  const json = JSON.stringify({ auth_typ: 'aad', claims: roles.map((r) => ({ typ, val: r })) });
  return Buffer.from(json, 'utf8').toString('base64');
}

describe('requireAdmin', () => {
  it('returns 401 with no auth at all', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 401 with wrong token and no principal', async () => {
    const res = await request(app).get('/protected').set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 with malformed header (no Bearer prefix)', async () => {
    const res = await request(app).get('/protected').set('Authorization', process.env.ADMIN_TOKEN);
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct token (break-glass)', async () => {
    const res = await request(app).get('/protected').set('Authorization', `Bearer ${process.env.ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 200 when principal has the Admin role', async () => {
    const res = await request(app).get('/protected').set('x-ms-client-principal', principal(['Admin']));
    expect(res.status).toBe(200);
  });

  it('returns 200 when Admin role uses the full schema-URI typ', async () => {
    const res = await request(app)
      .get('/protected')
      .set('x-ms-client-principal', principal(['Admin'], 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role'));
    expect(res.status).toBe(200);
  });

  it('returns 403 when principal is present but lacks the Admin role', async () => {
    const res = await request(app).get('/protected').set('x-ms-client-principal', principal(['SomeOtherRole']));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('returns 403 on malformed principal header with no token', async () => {
    const res = await request(app).get('/protected').set('x-ms-client-principal', 'not-base64-json!!');
    expect(res.status).toBe(403);
  });
});
