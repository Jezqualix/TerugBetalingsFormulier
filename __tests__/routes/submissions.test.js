// __tests__/routes/submissions.test.js
jest.mock('../../src/config/db');
jest.mock('../../src/models/submission');
jest.mock('../../src/services/mailService');

const request = require('supertest');
const app = require('../../src/server');
const { createSubmission, createUploadRecord } = require('../../src/models/submission');
const { sendAdminNotification, sendUserConfirmation } = require('../../src/services/mailService');

describe('POST /api/submissions', () => {
  let agent;
  let csrfToken;

  beforeEach(async () => {
    jest.clearAllMocks();
    createSubmission.mockResolvedValue(1);
    createUploadRecord.mockResolvedValue();
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
    expect(createSubmission).toHaveBeenCalledTimes(1);
  });

  it('returns 403 without CSRF token', async () => {
    const res = await request(app)
      .post('/api/submissions')
      .field('naam_aanvrager', 'Test');

    expect(res.status).toBe(403);
  });
});
