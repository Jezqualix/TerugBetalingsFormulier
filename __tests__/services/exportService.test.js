// __tests__/services/exportService.test.js
const { PassThrough } = require('stream');

const mockRows = [
  {
    id: 1,
    aanvraagnummer: 'REQ-001',
    naam_aanvrager: 'Test User',
    email_aanvrager: 'test@example.com',
    type_betaling: 'dringend',
    naam_terugstorting: 'Recipient',
    iban: 'BE27000000000000',
    omschrijving: 'Test',
    status: 'nieuw',
    taal: 'nl',
    upload_count: 2,
    created_at: new Date('2026-01-01T12:00:00Z'),
  },
];

describe('streamCsv', () => {
  it('streams CSV containing headers and row data', (done) => {
    const { streamCsv } = require('../../src/services/exportService');
    const chunks = [];
    const mockRes = new PassThrough();
    mockRes.setHeader = jest.fn();

    mockRes.on('data', (chunk) => chunks.push(chunk));
    mockRes.on('end', () => {
      const csv = Buffer.concat(chunks).toString();
      expect(csv).toContain('Naam aanvrager');
      expect(csv).toContain('Test User');
      expect(csv).toContain('REQ-001');
      done();
    });

    streamCsv(mockRows, mockRes);
  });
});

describe('streamXlsx', () => {
  it('streams a valid XLSX buffer (PK ZIP header)', async () => {
    const { streamXlsx } = require('../../src/services/exportService');
    const chunks = [];
    const mockRes = new PassThrough();
    mockRes.setHeader = jest.fn();

    const dataPromise = new Promise((resolve) => {
      mockRes.on('data', (c) => chunks.push(c));
      mockRes.on('end', () => resolve(Buffer.concat(chunks)));
    });

    await streamXlsx(mockRows, mockRes);
    const buf = await dataPromise;

    // XLSX is a ZIP — must start with PK
    expect(buf.slice(0, 2).toString('ascii')).toBe('PK');
  });
});
