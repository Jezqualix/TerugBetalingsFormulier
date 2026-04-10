// __tests__/routes/admin.test.js
jest.mock('../../src/config/db');
jest.mock('../../src/models/submission');
jest.mock('../../src/services/exportService');

const request = require('supertest');
const app = require('../../src/server');
const { listSubmissions, getSubmissionsForExport } = require('../../src/models/submission');
const { streamCsv, streamXlsx } = require('../../src/services/exportService');

const AUTH = `Bearer ${process.env.ADMIN_TOKEN}`;

describe('GET /api/submissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    listSubmissions.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/submissions');
    expect(res.status).toBe(401);
  });

  it('returns 200 with valid token', async () => {
    const res = await request(app)
      .get('/api/submissions')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('passes query params to listSubmissions', async () => {
    await request(app)
      .get('/api/submissions?from=2026-01-01&to=2026-12-31&status=nieuw&page=2')
      .set('Authorization', AUTH);

    expect(listSubmissions).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-01-01', to: '2026-12-31', status: 'nieuw', page: 2 })
    );
  });
});

describe('GET /api/export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSubmissionsForExport.mockResolvedValue([]);
    streamCsv.mockImplementation((rows, res) => res.end());
    streamXlsx.mockImplementation((rows, res) => { res.end(); return Promise.resolve(); });
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/export');
    expect(res.status).toBe(401);
  });

  it('calls streamCsv for csv format', async () => {
    await request(app)
      .get('/api/export?format=csv')
      .set('Authorization', AUTH);
    expect(streamCsv).toHaveBeenCalled();
  });

  it('calls streamXlsx for xlsx format', async () => {
    await request(app)
      .get('/api/export?format=xlsx')
      .set('Authorization', AUTH);
    expect(streamXlsx).toHaveBeenCalled();
  });
});
