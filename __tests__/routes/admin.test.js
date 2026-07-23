// __tests__/routes/admin.test.js
jest.mock('../../src/config/db');
jest.mock('../../src/models/submission');
jest.mock('../../src/services/exportService');

const request = require('supertest');
const app = require('../../src/server');
const { listSubmissions, getSubmissionsForExport, updateSubmissionStatus, getUploadsForSubmission } = require('../../src/models/submission');
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

describe('PATCH /api/submissions/:id/status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateSubmissionStatus.mockResolvedValue(true);
  });

  it('returns 401 without token', async () => {
    const res = await request(app)
      .patch('/api/submissions/1/status')
      .send({ status: 'verwerkt' });
    expect(res.status).toBe(401);
  });

  it('updates status and returns 200', async () => {
    const res = await request(app)
      .patch('/api/submissions/1/status')
      .set('Authorization', AUTH)
      .send({ status: 'verwerkt' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(updateSubmissionStatus).toHaveBeenCalledWith(1, 'verwerkt');
  });

  it('returns 422 for invalid status value', async () => {
    const res = await request(app)
      .patch('/api/submissions/1/status')
      .set('Authorization', AUTH)
      .send({ status: 'bogus' });

    expect(res.status).toBe(422);
    expect(updateSubmissionStatus).not.toHaveBeenCalled();
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await request(app)
      .patch('/api/submissions/abc/status')
      .set('Authorization', AUTH)
      .send({ status: 'verwerkt' });

    expect(res.status).toBe(400);
    expect(updateSubmissionStatus).not.toHaveBeenCalled();
  });

  it('returns 404 when submission does not exist', async () => {
    updateSubmissionStatus.mockResolvedValue(false);
    const res = await request(app)
      .patch('/api/submissions/999/status')
      .set('Authorization', AUTH)
      .send({ status: 'verwerkt' });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/submissions/:id/uploads', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUploadsForSubmission.mockResolvedValue([
      { id: 1, original_name: 'bon.pdf', stored_name: 'uuid1.pdf', mime_type: 'application/pdf', size_bytes: 1024 },
    ]);
  });

  it('returns 401 without token', async () => {
    const res = await request(app).get('/api/submissions/1/uploads');
    expect(res.status).toBe(401);
  });

  it('returns uploads for a submission', async () => {
    const res = await request(app)
      .get('/api/submissions/1/uploads')
      .set('Authorization', AUTH);

    expect(res.status).toBe(200);
    expect(res.body.uploads).toHaveLength(1);
    expect(res.body.uploads[0].original_name).toBe('bon.pdf');
    expect(getUploadsForSubmission).toHaveBeenCalledWith(1);
  });

  it('returns 400 for non-numeric id', async () => {
    const res = await request(app)
      .get('/api/submissions/abc/uploads')
      .set('Authorization', AUTH);

    expect(res.status).toBe(400);
    expect(getUploadsForSubmission).not.toHaveBeenCalled();
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
