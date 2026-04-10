// __tests__/middleware/auth.test.js
const request = require('supertest');
const express = require('express');

const { requireAdminToken } = require('../../src/middleware/auth');

const app = express();
app.get('/protected', requireAdminToken, (req, res) => res.json({ ok: true }));

describe('requireAdminToken', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 401 with wrong token', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 401 with malformed header (no Bearer prefix)', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', process.env.ADMIN_TOKEN);
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct token', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${process.env.ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
