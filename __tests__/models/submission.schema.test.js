// __tests__/models/submission.schema.test.js
//
// The sibling submission.test.js automocks src/config/db, which turns qualify()
// into a stub returning undefined -- those tests pass no matter which table the
// query names. This file keeps the real qualify() and mocks only the pool, so it
// is the one place that proves DB_SCHEMA actually reaches the SQL.
//
// Its real job is to fail when someone adds a query with a bare table name.

process.env.DB_SCHEMA = 'tbf';

jest.mock('../../src/config/db', () => {
  const actual = jest.requireActual('../../src/config/db');
  return { ...actual, getPool: jest.fn() };
});

const { getPool } = require('../../src/config/db');
const model = require('../../src/models/submission');

// Every query text the model sent during one call.
let queries = [];

function mockPool(results = []) {
  let call = 0;
  const request = () => {
    const req = {
      input: jest.fn(),
      query: jest.fn((text) => {
        queries.push(text);
        const result = results[call] !== undefined ? results[call] : { recordset: [], rowsAffected: [1] };
        call += 1;
        return Promise.resolve(result);
      }),
    };
    req.input.mockReturnValue(req);
    return req;
  };
  getPool.mockResolvedValue({ request });
}

beforeEach(() => {
  jest.clearAllMocks();
  queries = [];
});

// A bare table name in any of these positions means the query bypassed
// qualify() and would hit dbo on the new server.
const UNQUALIFIED = /\b(?:FROM|INTO|UPDATE|JOIN)\s+(?:submissions|uploads)\b/i;

const cases = [
  {
    name: 'createSubmission',
    results: [{ recordset: [{ id: 1 }] }],
    run: () => model.createSubmission({ naam_aanvrager: 'x', email_aanvrager: 'x@y.z', type_betaling: 'a', naam_terugstorting: 'x' }),
    expects: ['[tbf].[submissions]'],
  },
  {
    name: 'createUploadRecord',
    results: [{ recordset: [] }],
    run: () => model.createUploadRecord({ submission_id: 1, original_name: 'a', stored_name: 'b', mime_type: 'text/plain', size_bytes: 1 }),
    expects: ['[tbf].[uploads]'],
  },
  {
    name: 'updateSubmissionStatus',
    results: [{ rowsAffected: [1] }],
    run: () => model.updateSubmissionStatus(1, 'behandeld'),
    expects: ['[tbf].[submissions]'],
  },
  {
    name: 'getUploadsForSubmission',
    results: [{ recordset: [] }],
    run: () => model.getUploadsForSubmission(1),
    expects: ['[tbf].[uploads]'],
  },
  {
    name: 'listSubmissions',
    results: [{ recordset: [{ total: 0 }] }, { recordset: [] }],
    run: () => model.listSubmissions({}),
    expects: ['[tbf].[submissions]', '[tbf].[uploads]'],
  },
  {
    name: 'getSubmissionsForExport',
    results: [{ recordset: [] }],
    run: () => model.getSubmissionsForExport({}),
    expects: ['[tbf].[submissions]', '[tbf].[uploads]'],
  },
];

describe.each(cases)('$name', ({ results, run, expects }) => {
  it('qualifies every table it touches with the configured schema', async () => {
    mockPool(results);
    await run();

    const all = queries.join('\n');
    for (const expected of expects) {
      expect(all).toContain(expected);
    }
    expect(all).not.toMatch(UNQUALIFIED);
  });
});

describe('the guard itself', () => {
  it('flags a bare table name, so the assertions above are not vacuous', () => {
    expect('SELECT * FROM submissions').toMatch(UNQUALIFIED);
    expect('INSERT INTO uploads (a) VALUES (1)').toMatch(UNQUALIFIED);
    expect('SELECT * FROM [tbf].[submissions]').not.toMatch(UNQUALIFIED);
  });
});
