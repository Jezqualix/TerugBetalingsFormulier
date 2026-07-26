// Verifies the model layer serves in-memory demo data (no DB) when DEV_MODE=true.
// config/db is mocked to throw on getPool so any accidental DB access fails loudly.

jest.mock('../../src/config/db', () => ({
  getPool: () => { throw new Error('getPool must not be called in DEV_MODE'); },
  sql: {},
}));

const model = require('../../src/models/submission');

describe('DEV_MODE model (in-memory, no DB)', () => {
  const prevDevMode = process.env.DEV_MODE;
  const prevNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.DEV_MODE = 'true';
    delete process.env.NODE_ENV; // not 'production'
  });
  afterAll(() => {
    process.env.DEV_MODE = prevDevMode;
    process.env.NODE_ENV = prevNodeEnv;
  });

  test('listSubmissions returns seeded rows with upload_count, no DB call', async () => {
    const result = await model.listSubmissions({ page: 1, pageSize: 20 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.rows.length).toBe(result.total);
    expect(result.rows[0]).toHaveProperty('upload_count');
    // seed spans all five payment types
    const types = new Set(result.rows.map((r) => r.type_betaling));
    expect(types).toEqual(new Set(['onkostennota', 'dringend', 'brandstof', 'boete', 'andere']));
  });

  test('listSubmissions applies status filter', async () => {
    const { rows } = await model.listSubmissions({ status: 'verwerkt' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'verwerkt')).toBe(true);
  });

  test('getUploadsForSubmission returns seeded uploads', async () => {
    const uploads = await model.getUploadsForSubmission(3);
    expect(uploads.length).toBe(2);
    expect(uploads[0]).toHaveProperty('original_name');
  });

  test('updateSubmissionStatus mutates the store and reports found/not-found', async () => {
    expect(await model.updateSubmissionStatus(1, 'verwerkt')).toBe(true);
    const { rows } = await model.listSubmissions({});
    expect(rows.find((r) => r.id === 1).status).toBe('verwerkt');
    expect(await model.updateSubmissionStatus(9999, 'verwerkt')).toBe(false);
  });

  test('createSubmission appends a new row visible in the list', async () => {
    const before = (await model.listSubmissions({})).total;
    const id = await model.createSubmission({
      naam_aanvrager: 'Test Persoon',
      email_aanvrager: 'test@example.be',
      type_betaling: 'andere',
      naam_terugstorting: 'Test Persoon',
      gedetailleerde_omschrijving: 'demo',
    });
    expect(id).toBeGreaterThan(0);
    const after = await model.listSubmissions({});
    expect(after.total).toBe(before + 1);
    expect(after.rows.find((r) => r.id === id)).toBeTruthy();
  });

  test('getSubmissionsForExport returns rows with upload_count', async () => {
    const rows = await model.getSubmissionsForExport({});
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('upload_count');
  });
});
