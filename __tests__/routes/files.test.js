// __tests__/routes/files.test.js
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const app = require('../../src/server');

const AUTH = `Bearer ${process.env.ADMIN_TOKEN}`;
const TEST_DIR = process.env.UPLOAD_DIR || './uploads-test';

beforeAll(() => {
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEST_DIR, 'test-file.pdf'), '%PDF-1.4 test content');
});

afterAll(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('GET /api/uploads/:filename', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/uploads/test-file.pdf');
    expect(res.status).toBe(401);
  });

  it('returns 404 for non-existent file', async () => {
    const res = await request(app)
      .get('/api/uploads/nonexistent.pdf')
      .set('Authorization', AUTH);
    expect(res.status).toBe(404);
  });

  it('returns the file with valid token', async () => {
    const res = await request(app)
      .get('/api/uploads/test-file.pdf')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
  });

  it('blocks path traversal attempts', async () => {
    const res = await request(app)
      .get('/api/uploads/..%2F..%2Fetc%2Fpasswd')
      .set('Authorization', AUTH);
    expect(res.status).toBe(400);
  });
});
