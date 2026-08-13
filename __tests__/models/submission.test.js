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

// The schema guard in submission.schema.test.js covers the SQL text: this function
// reuses the same statement builders as createSubmission/createUploadRecord, so what
// is left to prove here is the all-or-nothing behaviour.
describe('createSubmissionWithUploads', () => {
  function mockTransaction({ failOnQueryNumber } = {}) {
    const transaction = {
      begin: jest.fn().mockResolvedValue(),
      commit: jest.fn().mockResolvedValue(),
      rollback: jest.fn().mockResolvedValue(),
    };
    let call = 0;
    Object.assign(sql, {
      NVarChar: jest.fn((n) => `NVarChar(${n})`),
      Int: 'Int', Bit: 'Bit', Date: 'Date', MAX: 'MAX',
      Transaction: jest.fn(() => transaction),
      Request: jest.fn(() => {
        const req = {
          input: jest.fn(),
          query: jest.fn(() => {
            call += 1;
            if (call === failOnQueryNumber) return Promise.reject(new Error('String or binary data would be truncated'));
            return Promise.resolve({ recordset: [{ id: 7 }] });
          }),
        };
        req.input.mockReturnValue(req);
        return req;
      }),
    });
    getPool.mockResolvedValue({});
    return transaction;
  }

  const submission = {
    naam_aanvrager: 'Test User',
    email_aanvrager: 'test@example.com',
    type_betaling: 'brandstof',
    naam_terugstorting: 'Recipient',
  };
  const upload = { original_name: 'bon.png', stored_name: 'uuid.png', mime_type: 'image/png', size_bytes: 70 };

  it('commits the submission together with its uploads', async () => {
    const transaction = mockTransaction();
    const { createSubmissionWithUploads } = require('../../src/models/submission');

    const id = await createSubmissionWithUploads(submission, [upload, upload]);

    expect(id).toBe(7);
    expect(transaction.begin).toHaveBeenCalledTimes(1);
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(sql.Request).toHaveBeenCalledTimes(3); // 1 submission + 2 uploads
  });

  it('rolls back the submission when an upload row fails', async () => {
    const transaction = mockTransaction({ failOnQueryNumber: 2 });
    const { createSubmissionWithUploads } = require('../../src/models/submission');

    await expect(createSubmissionWithUploads(submission, [upload])).rejects.toThrow(/truncated/);
    expect(transaction.commit).not.toHaveBeenCalled();
    expect(transaction.rollback).toHaveBeenCalledTimes(1);
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
