// __tests__/models/submission.test.js
jest.mock('../../src/config/db');

const { getPool, sql } = require('../../src/config/db');

// Build a chainable mock for mssql request
function makeMockRequest(queryResult) {
  const req = {
    input: jest.fn(),
    query: jest.fn().mockResolvedValue(queryResult),
  };
  req.input.mockReturnValue(req);
  return req;
}

describe('createSubmission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // sql types used in the model
    Object.assign(sql, {
      NVarChar: jest.fn((n) => `NVarChar(${n})`),
      Int: 'Int',
      DateTime2: 'DateTime2',
      MAX: 'MAX',
    });
  });

  it('inserts a submission and returns the new id', async () => {
    const mockReq = makeMockRequest({ recordset: [{ id: 42 }] });
    getPool.mockResolvedValue({ request: () => mockReq });

    const { createSubmission } = require('../../src/models/submission');
    const id = await createSubmission({
      naam_aanvrager: 'Test User',
      email_aanvrager: 'test@example.com',
      type_betaling: 'dringend',
      naam_terugstorting: 'Recipient',
      taal: 'nl',
    });

    expect(id).toBe(42);
    expect(mockReq.query).toHaveBeenCalledTimes(1);
  });
});

describe('createUploadRecord', () => {
  it('inserts an upload record without throwing', async () => {
    const mockReq = makeMockRequest({ recordset: [] });
    getPool.mockResolvedValue({ request: () => mockReq });

    const { createUploadRecord } = require('../../src/models/submission');
    await expect(
      createUploadRecord({
        submission_id: 1,
        original_name: 'file.pdf',
        stored_name: 'uuid.pdf',
        mime_type: 'application/pdf',
        size_bytes: 1024,
      })
    ).resolves.not.toThrow();
  });
});

describe('updateSubmissionStatus', () => {
  it('returns true when a row was updated', async () => {
    const mockReq = makeMockRequest({ rowsAffected: [1] });
    getPool.mockResolvedValue({ request: () => mockReq });

    const { updateSubmissionStatus } = require('../../src/models/submission');
    const updated = await updateSubmissionStatus(1, 'verwerkt');

    expect(updated).toBe(true);
    expect(mockReq.query).toHaveBeenCalledTimes(1);
  });

  it('returns false when no row matched', async () => {
    const mockReq = makeMockRequest({ rowsAffected: [0] });
    getPool.mockResolvedValue({ request: () => mockReq });

    const { updateSubmissionStatus } = require('../../src/models/submission');
    const updated = await updateSubmissionStatus(999, 'verwerkt');

    expect(updated).toBe(false);
  });
});

describe('getUploadsForSubmission', () => {
  it('returns upload rows for a submission', async () => {
    const mockReq = makeMockRequest({
      recordset: [
        { id: 1, original_name: 'bon.pdf', stored_name: 'uuid1.pdf', mime_type: 'application/pdf', size_bytes: 1024 },
        { id: 2, original_name: 'foto.jpg', stored_name: 'uuid2.jpg', mime_type: 'image/jpeg', size_bytes: 2048 },
      ],
    });
    getPool.mockResolvedValue({ request: () => mockReq });

    const { getUploadsForSubmission } = require('../../src/models/submission');
    const uploads = await getUploadsForSubmission(1);

    expect(uploads).toHaveLength(2);
    expect(uploads[0].original_name).toBe('bon.pdf');
    expect(uploads[0].stored_name).toBe('uuid1.pdf');
  });
});

describe('listSubmissions', () => {
  it('returns rows and total', async () => {
    const countReq = makeMockRequest({ recordset: [{ total: 2 }] });
    const dataReq = makeMockRequest({
      recordset: [
        { id: 1, naam_aanvrager: 'Alice', upload_count: 0 },
        { id: 2, naam_aanvrager: 'Bob', upload_count: 1 },
      ],
    });
    let callCount = 0;
    getPool.mockResolvedValue({
      request: () => (callCount++ === 0 ? countReq : dataReq),
    });

    const { listSubmissions } = require('../../src/models/submission');
    const result = await listSubmissions({ page: 1, pageSize: 20 });

    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(2);
  });
});
