// __tests__/routes/health.test.js
jest.mock('../../src/config/db');

const request = require('supertest');
const app = require('../../src/server');

describe('GET /health', () => {
  it('returns 200 with status ok and no auth required', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
