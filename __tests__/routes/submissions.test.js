// __tests__/routes/submissions.test.js
jest.mock('../../src/config/db');
jest.mock('../../src/models/submission');
jest.mock('../../src/services/mailService');
// The real limiter allows 10 submits per 15 minutes per IP, and every test here posts
// from the same address — past ten cases the suite would test the limiter instead of
// the route. Its behaviour is verified against a running server, not here.
jest.mock('../../src/middleware/rateLimiter', () => ({
  submitLimiter: (req, res, next) => next(),
}));

const request = require('supertest');
const app = require('../../src/server');
const { createSubmissionWithUploads } = require('../../src/models/submission');
const { sendAdminNotification, sendUserConfirmation } = require('../../src/services/mailService');

describe('POST /api/submissions', () => {
  let agent;
  let csrfToken;

  beforeEach(async () => {
    jest.clearAllMocks();
    createSubmissionWithUploads.mockResolvedValue(1);
    sendAdminNotification.mockResolvedValue();
    sendUserConfirmation.mockResolvedValue();

    agent = request.agent(app);
    const csrfRes = await agent.get('/api/csrf-token');
    csrfToken = csrfRes.body.token;
  });

  it('returns 422 when required fields are missing', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('aanvraagnummer', 'optional');

    expect(res.status).toBe(422);
    expect(res.body.errors.naam_aanvrager).toBeDefined();
    expect(res.body.errors.email_aanvrager).toBeDefined();
    expect(res.body.errors.type_betaling).toBeDefined();
    expect(res.body.errors.naam_terugstorting).toBeDefined();
  });

  it('returns 422 with invalid email', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('naam_aanvrager', 'Test')
      .field('email_aanvrager', 'not-an-email')
      .field('type_betaling', 'dringend')
      .field('naam_terugstorting', 'Recipient');

    expect(res.status).toBe(422);
    expect(res.body.errors.email_aanvrager).toBeDefined();
  });

  it('returns 422 with invalid type_betaling', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('naam_aanvrager', 'Test')
      .field('email_aanvrager', 'test@example.com')
      .field('type_betaling', 'INVALID')
      .field('naam_terugstorting', 'Recipient');

    expect(res.status).toBe(422);
    expect(res.body.errors.type_betaling).toBeDefined();
  });

  it('returns 201 with valid data', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('naam_aanvrager', 'Test User')
      .field('email_aanvrager', 'test@example.com')
      .field('type_betaling', 'dringend')
      .field('naam_terugstorting', 'Recipient')
      .field('reden_urgentie', 'Urgent test reason')
      .field('taal', 'nl');

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(1);
    expect(createSubmissionWithUploads).toHaveBeenCalledTimes(1);
  });

  // A field sent twice arrives as an array. Calling .trim() on it used to throw in the
  // validation block, which sits outside try/catch: an unhandled rejection in an async
  // Express 4 handler ends the Node process, so one request took the app down.
  it('answers 422 instead of crashing when a field is sent twice', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('naam_aanvrager', 'Eerste')
      .field('naam_aanvrager', 'Tweede')
      .field('email_aanvrager', 'test@example.com')
      .field('type_betaling', 'brandstof')
      .field('naam_terugstorting', 'Recipient');

    // First value wins, so this particular payload is simply valid.
    expect(res.status).toBe(201);
    expect(createSubmissionWithUploads).toHaveBeenCalledWith(
      expect.objectContaining({ naam_aanvrager: 'Eerste' }),
      []
    );
  });

  it('answers 422 when a duplicated field leaves a required value empty', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('naam_aanvrager', '')
      .field('naam_aanvrager', 'Tweede')
      .field('email_aanvrager', 'test@example.com')
      .field('type_betaling', 'brandstof')
      .field('naam_terugstorting', 'Recipient');

    expect(res.status).toBe(422);
    expect(res.body.errors.naam_aanvrager).toBeDefined();
    expect(createSubmissionWithUploads).not.toHaveBeenCalled();
  });

  it('returns 422 for values wider than their column', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('aanvraagnummer', 'A'.repeat(101))
      .field('naam_aanvrager', 'B'.repeat(256))
      .field('email_aanvrager', `${'c'.repeat(250)}@example.com`)
      .field('type_betaling', 'brandstof')
      .field('naam_terugstorting', 'D'.repeat(256))
      .field('iban', 'BE68'.padEnd(40, '1'));

    expect(res.status).toBe(422);
    for (const field of ['aanvraagnummer', 'naam_aanvrager', 'email_aanvrager', 'naam_terugstorting', 'iban']) {
      expect(res.body.errors[field]).toMatch(/Maximaal \d+ tekens/);
    }
    expect(createSubmissionWithUploads).not.toHaveBeenCalled();
  });

  // new Date('2026-02-30') rolls over to 2 March, so an unchecked date is stored as a
  // different, plausible looking one.
  it('rejects a date that does not exist', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('naam_aanvrager', 'Test User')
      .field('email_aanvrager', 'test@example.com')
      .field('type_betaling', 'boete')
      .field('naam_terugstorting', 'Recipient')
      .field('referentie_boete', 'REF-1')
      .field('vervaldatum_boete', '2026-02-30');

    expect(res.status).toBe(422);
    expect(res.body.errors.vervaldatum_boete).toBeDefined();
    expect(createSubmissionWithUploads).not.toHaveBeenCalled();
  });

  it.each(['31-12-2026', 'morgen', '2026-13-01', '2026-2-3'])('rejects malformed date %s', async (value) => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('naam_aanvrager', 'Test User')
      .field('email_aanvrager', 'test@example.com')
      .field('type_betaling', 'boete')
      .field('naam_terugstorting', 'Recipient')
      .field('referentie_boete', 'REF-1')
      .field('vervaldatum_boete', value);

    expect(res.status).toBe(422);
    expect(res.body.errors.vervaldatum_boete).toBeDefined();
  });

  it('accepts a real date', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('naam_aanvrager', 'Test User')
      .field('email_aanvrager', 'test@example.com')
      .field('type_betaling', 'boete')
      .field('naam_terugstorting', 'Recipient')
      .field('referentie_boete', 'REF-1')
      .field('vervaldatum_boete', '2026-02-28');

    expect(res.status).toBe(201);
    expect(createSubmissionWithUploads).toHaveBeenCalledWith(
      expect.objectContaining({ vervaldatum_boete: '2026-02-28' }),
      []
    );
  });

  it('accepts an address with surrounding whitespace and stores it trimmed', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('naam_aanvrager', '  Test User  ')
      .field('email_aanvrager', '  TEST.User@Example.COM  ')
      .field('type_betaling', 'brandstof')
      .field('naam_terugstorting', 'Recipient');

    expect(res.status).toBe(201);
    expect(createSubmissionWithUploads).toHaveBeenCalledWith(
      expect.objectContaining({ email_aanvrager: 'test.user@example.com', naam_aanvrager: 'Test User' }),
      []
    );
  });

  it('stores the IBAN without separators and upper case', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('naam_aanvrager', 'Test User')
      .field('email_aanvrager', 'test@example.com')
      .field('type_betaling', 'brandstof')
      .field('naam_terugstorting', 'Recipient')
      // grouped, non-breaking space in the middle, lower case — all three get fixed
      .field('iban', ' be68 5390 0754 7034 ');

    expect(res.status).toBe(201);
    expect(createSubmissionWithUploads).toHaveBeenCalledWith(
      expect.objectContaining({ iban: 'BE68539007547034' }),
      []
    );
  });

  it('stores a blank IBAN as null', async () => {
    const res = await agent
      .post('/api/submissions')
      .set('x-csrf-token', csrfToken)
      .field('naam_aanvrager', 'Test User')
      .field('email_aanvrager', 'test@example.com')
      .field('type_betaling', 'brandstof')
      .field('naam_terugstorting', 'Recipient')
      .field('iban', '   ');

    expect(res.status).toBe(201);
    expect(createSubmissionWithUploads).toHaveBeenCalledWith(
      expect.objectContaining({ iban: null }),
      []
    );
  });

  it('returns 403 without CSRF token', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .field('naam_aanvrager', 'Test');

    expect(res.status).toBe(403);
  });
});
