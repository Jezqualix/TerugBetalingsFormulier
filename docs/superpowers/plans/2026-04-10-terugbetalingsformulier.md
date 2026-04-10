# TerugBetalingsFormulier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready Node.js/Express web application serving a Dutch/French refund request form, storing submissions in MS SQL Server, handling file uploads, sending IP-authenticated SMTP email, and providing an authenticated admin dashboard with CSV/XLSX export.

**Architecture:** Single Express process on port 3004 serving static Alpine.js frontend files and a REST API. MS SQL Server via parameterized queries (`mssql`). Multer for file uploads stored on disk outside the web root. Admin routes protected by bearer token from `.env.local`. CSRF protection via double-submit cookie (`csrf-csrf`).

**Tech Stack:** Node.js 20+, Express 4, Alpine.js 3 (CDN), mssql 10, Multer, Nodemailer, ExcelJS, fast-csv, helmet, express-rate-limit, csrf-csrf, cookie-parser, uuid, Jest, Supertest

---

## File Map

| File | Responsibility |
|---|---|
| `src/server.js` | Express entry point, middleware wiring, error handler |
| `src/config/db.js` | mssql connection pool (lazy init) |
| `src/middleware/auth.js` | Bearer token check for admin routes |
| `src/middleware/csrf.js` | csrf-csrf instance (shared across routes) |
| `src/middleware/upload.js` | Multer config: 2MB, MIME+ext allowlist, UUID rename |
| `src/middleware/rateLimiter.js` | 10 submissions / 15 min / IP |
| `src/models/submission.js` | All DB queries via prepared statements |
| `src/services/mailService.js` | Nodemailer, NL+FR templates, IP-auth SMTP |
| `src/services/exportService.js` | CSV (fast-csv) and XLSX (ExcelJS) streaming |
| `src/routes/submissions.js` | POST /api/submissions |
| `src/routes/admin.js` | GET /api/submissions, GET /api/export |
| `src/routes/files.js` | GET /api/uploads/:filename |
| `public/assets/i18n.js` | NL + FR translation strings |
| `public/assets/style.css` | Form + admin styles |
| `public/index.html` | Form page (Alpine.js, NL/FR) |
| `public/admin.html` | Admin dashboard (Alpine.js) |
| `migrations/001_initial.sql` | submissions + uploads table DDL |
| `__tests__/middleware/auth.test.js` | Auth middleware tests |
| `__tests__/middleware/upload.test.js` | Upload allowlist tests |
| `__tests__/models/submission.test.js` | Model tests (mocked DB) |
| `__tests__/services/mailService.test.js` | Mail template tests |
| `__tests__/services/exportService.test.js` | CSV/XLSX streaming tests |
| `__tests__/routes/submissions.test.js` | Submission route integration tests |
| `__tests__/routes/admin.test.js` | Admin route integration tests |
| `__tests__/routes/files.test.js` | Files route integration tests |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `jest.config.js`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `CLAUDE.md`
- Create: `uploads/.gitkeep`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "terugbetalingsformulier",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "test": "jest --runInBand",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "cookie-parser": "^1.4.6",
    "csrf-csrf": "^3.0.0",
    "dotenv": "^16.4.5",
    "exceljs": "^4.4.0",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "fast-csv": "^4.3.6",
    "helmet": "^7.1.0",
    "mime-types": "^2.1.35",
    "mssql": "^10.0.1",
    "multer": "^1.4.5-lts.1",
    "nodemailer": "^6.9.13",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "nodemon": "^3.0.3",
    "supertest": "^6.3.4"
  }
}
```

- [ ] **Step 2: Create jest.config.js**

```javascript
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  setupFiles: ['<rootDir>/__tests__/setup.js'],
};
```

- [ ] **Step 3: Create `__tests__/setup.js`**

```javascript
process.env.PORT = '3005';
process.env.ADMIN_TOKEN = 'test-admin-token-32chars-minimum-00';
process.env.CSRF_SECRET = 'test-csrf-secret-32-chars-min-0000';
process.env.COOKIE_SECRET = 'test-cookie-secret-32-chars-min-00';
process.env.UPLOAD_DIR = './uploads-test';
process.env.SMTP_HOST = 'localhost';
process.env.SMTP_PORT = '25';
process.env.SMTP_FROM = 'test@example.com';
process.env.ADMIN_EMAIL = 'admin@example.com';
```

- [ ] **Step 4: Create `.env.example`**

```
PORT=3004

# MS SQL Server
DB_SERVER=
DB_DATABASE=
DB_USER=
DB_PASSWORD=
DB_ENCRYPT=true
DB_TRUST_CERT=false

# SMTP (IP-authenticated — no credentials needed)
SMTP_HOST=
SMTP_PORT=25
SMTP_FROM=
ADMIN_EMAIL=

# Admin dashboard
ADMIN_TOKEN=

# Security (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
CSRF_SECRET=
COOKIE_SECRET=

# Storage
UPLOAD_DIR=./uploads
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
.env.local
uploads/*
!uploads/.gitkeep
uploads-test/
*.log
```

- [ ] **Step 6: Create `CLAUDE.md`**

```markdown
# TerugBetalingsFormulier

## Quick Start
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in values
3. Run `migrations/001_initial.sql` against your MS SQL Server instance
4. `npm run dev` (development) or `npm start` (production)
5. Open http://localhost:3004

## Architecture
Single Express process on port 3004. See `docs/superpowers/specs/` for full design.

## Testing
`npm test`

## Key Directories
- `src/` — Backend source
- `public/` — Static frontend (served by Express)
- `uploads/` — Uploaded files (gitignored, never web-accessible directly)
- `migrations/` — SQL DDL files

## Admin Dashboard
Access at `/admin`. Enter your `ADMIN_TOKEN` from `.env.local`.

## Deployment
- Windows/IIS: NSSM service + IIS ARR reverse proxy. See `docs/deploy-iis.md`.
- Debian/Nginx: systemd unit + Nginx reverse proxy. See `docs/deploy-nginx.md`.
```

- [ ] **Step 7: Create directory structure and `uploads/.gitkeep`**

```bash
mkdir -p src/config src/middleware src/models src/routes src/services public/assets migrations __tests__/middleware __tests__/models __tests__/routes __tests__/services
touch uploads/.gitkeep
```

- [ ] **Step 8: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: project scaffold — package.json, dirs, env example"
```

---

## Task 2: Database Config & Migration

**Files:**
- Create: `src/config/db.js`
- Create: `migrations/001_initial.sql`

- [ ] **Step 1: Create `migrations/001_initial.sql`**

```sql
-- Run this against your MS SQL Server database before starting the app.

CREATE TABLE submissions (
  id                  INT IDENTITY(1,1)  PRIMARY KEY,
  aanvraagnummer      NVARCHAR(100)      NULL,
  naam_aanvrager      NVARCHAR(255)      NOT NULL,
  email_aanvrager     NVARCHAR(255)      NOT NULL,
  type_betaling       NVARCHAR(50)       NOT NULL,
  naam_terugstorting  NVARCHAR(255)      NOT NULL,
  iban                NVARCHAR(34)       NULL,
  omschrijving        NVARCHAR(MAX)      NULL,
  status              NVARCHAR(50)       NOT NULL CONSTRAINT DF_submissions_status   DEFAULT 'nieuw',
  taal                NVARCHAR(5)        NOT NULL CONSTRAINT DF_submissions_taal     DEFAULT 'nl',
  created_at          DATETIME2          NOT NULL CONSTRAINT DF_submissions_created  DEFAULT GETDATE()
);

CREATE TABLE uploads (
  id              INT IDENTITY(1,1)  PRIMARY KEY,
  submission_id   INT                NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  original_name   NVARCHAR(255)      NOT NULL,
  stored_name     NVARCHAR(255)      NOT NULL,
  mime_type       NVARCHAR(100)      NOT NULL,
  size_bytes      INT                NOT NULL,
  created_at      DATETIME2          NOT NULL CONSTRAINT DF_uploads_created DEFAULT GETDATE()
);
```

- [ ] **Step 2: Create `src/config/db.js`**

```javascript
require('dotenv').config({ path: '.env.local' });
const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
  }
  return pool;
}

module.exports = { getPool, sql };
```

- [ ] **Step 3: Commit**

```bash
git add migrations/001_initial.sql src/config/db.js
git commit -m "feat: db config (lazy mssql pool) and initial SQL migration"
```

---

## Task 3: CSRF Middleware

**Files:**
- Create: `src/middleware/csrf.js`

No unit test for this — it wraps a well-tested library. Integration tested via the submissions route tests (Task 10).

- [ ] **Step 1: Create `src/middleware/csrf.js`**

```javascript
const { doubleCsrf } = require('csrf-csrf');

const { doubleCsrfProtection, generateToken } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET || 'dev-csrf-secret-change-in-production',
  cookieName: 'x-csrf-token',
  cookieOptions: {
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
  },
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
});

module.exports = { doubleCsrfProtection, generateToken };
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware/csrf.js
git commit -m "feat: CSRF double-submit cookie middleware"
```

---

## Task 4: Auth Middleware + Tests

**Files:**
- Create: `src/middleware/auth.js`
- Create: `__tests__/middleware/auth.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/middleware/auth.test.js
const request = require('supertest');
const express = require('express');

const { requireAdminToken } = require('../../src/middleware/auth');

const app = express();
app.get('/protected', requireAdminToken, (req, res) => res.json({ ok: true }));

describe('requireAdminToken', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('returns 401 with wrong token', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer wrong-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 with malformed header (no Bearer prefix)', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', process.env.ADMIN_TOKEN);
    expect(res.status).toBe(401);
  });

  it('returns 200 with correct token', async () => {
    const res = await request(app)
      .get('/protected')
      .set('Authorization', `Bearer ${process.env.ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=auth
```

Expected: `Cannot find module '../../src/middleware/auth'`

- [ ] **Step 3: Create `src/middleware/auth.js`**

```javascript
function requireAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireAdminToken };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=auth
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/auth.js __tests__/middleware/auth.test.js
git commit -m "feat: admin bearer token auth middleware with tests"
```

---

## Task 5: Upload Middleware + Tests

**Files:**
- Create: `src/middleware/upload.js`
- Create: `__tests__/middleware/upload.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/middleware/upload.test.js
const { ALLOWED_MIMES, ALLOWED_EXTS } = require('../../src/middleware/upload');

describe('ALLOWED_MIMES', () => {
  it('allows PDF', () => expect(ALLOWED_MIMES.has('application/pdf')).toBe(true));
  it('allows JPEG', () => expect(ALLOWED_MIMES.has('image/jpeg')).toBe(true));
  it('allows DOCX', () => expect(ALLOWED_MIMES.has('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true));
  it('allows XLSX', () => expect(ALLOWED_MIMES.has('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true));
  it('allows ZIP', () => expect(ALLOWED_MIMES.has('application/zip')).toBe(true));
  it('rejects exe', () => expect(ALLOWED_MIMES.has('application/x-msdownload')).toBe(false));
  it('rejects octet-stream', () => expect(ALLOWED_MIMES.has('application/octet-stream')).toBe(false));
  it('rejects PHP', () => expect(ALLOWED_MIMES.has('application/x-httpd-php')).toBe(false));
});

describe('ALLOWED_EXTS', () => {
  it('allows .pdf', () => expect(ALLOWED_EXTS.has('.pdf')).toBe(true));
  it('allows .jpg', () => expect(ALLOWED_EXTS.has('.jpg')).toBe(true));
  it('allows .docx', () => expect(ALLOWED_EXTS.has('.docx')).toBe(true));
  it('rejects .exe', () => expect(ALLOWED_EXTS.has('.exe')).toBe(false));
  it('rejects .php', () => expect(ALLOWED_EXTS.has('.php')).toBe(false));
  it('rejects .sh', () => expect(ALLOWED_EXTS.has('.sh')).toBe(false));
  it('rejects .bat', () => expect(ALLOWED_EXTS.has('.bat')).toBe(false));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=upload
```

Expected: `Cannot find module '../../src/middleware/upload'`

- [ ] **Step 3: Create `src/middleware/upload.js`**

```javascript
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
]);

const ALLOWED_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.pdf', '.docx', '.xlsx', '.zip',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIMES.has(file.mimetype) || !ALLOWED_EXTS.has(ext)) {
    return cb(new Error(`File type not allowed: ${file.mimetype}`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter,
});

module.exports = { upload, ALLOWED_MIMES, ALLOWED_EXTS };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=upload
```

Expected: 15 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/middleware/upload.js __tests__/middleware/upload.test.js
git commit -m "feat: Multer upload middleware with MIME/ext allowlist and tests"
```

---

## Task 6: Rate Limiter Middleware

**Files:**
- Create: `src/middleware/rateLimiter.js`

No dedicated test — rate limiting behavior is time-dependent and tested at the integration level.

- [ ] **Step 1: Create `src/middleware/rateLimiter.js`**

```javascript
const rateLimit = require('express-rate-limit');

const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

module.exports = { submitLimiter };
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware/rateLimiter.js
git commit -m "feat: rate limiter middleware (10 req / 15 min / IP)"
```

---

## Task 7: Submission Model + Tests

**Files:**
- Create: `src/models/submission.js`
- Create: `__tests__/models/submission.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=models/submission
```

Expected: `Cannot find module '../../src/models/submission'`

- [ ] **Step 3: Create `src/models/submission.js`**

```javascript
const { getPool, sql } = require('../config/db');

async function createSubmission(data) {
  const pool = await getPool();
  const result = await pool.request()
    .input('aanvraagnummer',     sql.NVarChar(100),  data.aanvraagnummer || null)
    .input('naam_aanvrager',     sql.NVarChar(255),  data.naam_aanvrager)
    .input('email_aanvrager',    sql.NVarChar(255),  data.email_aanvrager)
    .input('type_betaling',      sql.NVarChar(50),   data.type_betaling)
    .input('naam_terugstorting', sql.NVarChar(255),  data.naam_terugstorting)
    .input('iban',               sql.NVarChar(34),   data.iban || null)
    .input('omschrijving',       sql.NVarChar(sql.MAX), data.omschrijving || null)
    .input('taal',               sql.NVarChar(5),    data.taal || 'nl')
    .query(`
      INSERT INTO submissions
        (aanvraagnummer, naam_aanvrager, email_aanvrager, type_betaling,
         naam_terugstorting, iban, omschrijving, taal)
      OUTPUT INSERTED.id
      VALUES
        (@aanvraagnummer, @naam_aanvrager, @email_aanvrager, @type_betaling,
         @naam_terugstorting, @iban, @omschrijving, @taal)
    `);
  return result.recordset[0].id;
}

async function createUploadRecord(data) {
  const pool = await getPool();
  await pool.request()
    .input('submission_id', sql.Int,          data.submission_id)
    .input('original_name', sql.NVarChar(255), data.original_name)
    .input('stored_name',   sql.NVarChar(255), data.stored_name)
    .input('mime_type',     sql.NVarChar(100), data.mime_type)
    .input('size_bytes',    sql.Int,           data.size_bytes)
    .query(`
      INSERT INTO uploads (submission_id, original_name, stored_name, mime_type, size_bytes)
      VALUES (@submission_id, @original_name, @stored_name, @mime_type, @size_bytes)
    `);
}

async function listSubmissions({ from, to, status, page = 1, pageSize = 20 } = {}) {
  const pool = await getPool();

  function buildConditions(request) {
    const conditions = [];
    if (from) {
      request.input('from', sql.DateTime2, new Date(from));
      conditions.push('created_at >= @from');
    }
    if (to) {
      request.input('to', sql.DateTime2, new Date(to));
      conditions.push('created_at < DATEADD(day, 1, @to)');
    }
    if (status) {
      request.input('status', sql.NVarChar(50), status);
      conditions.push('status = @status');
    }
    return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  }

  const countReq = pool.request();
  const where = buildConditions(countReq);
  const countResult = await countReq.query(
    `SELECT COUNT(*) AS total FROM submissions ${where}`
  );

  const dataReq = pool.request();
  buildConditions(dataReq);
  dataReq
    .input('offset',   sql.Int, (page - 1) * pageSize)
    .input('pageSize', sql.Int, pageSize);

  const dataResult = await dataReq.query(`
    SELECT
      s.*,
      (SELECT COUNT(*) FROM uploads u WHERE u.submission_id = s.id) AS upload_count
    FROM submissions s
    ${where}
    ORDER BY s.created_at DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
  `);

  return {
    rows: dataResult.recordset,
    total: countResult.recordset[0].total,
    page,
    pageSize,
  };
}

async function getSubmissionsForExport({ from, to, status } = {}) {
  const pool = await getPool();
  const request = pool.request();
  const conditions = [];

  if (from) {
    request.input('from', sql.DateTime2, new Date(from));
    conditions.push('created_at >= @from');
  }
  if (to) {
    request.input('to', sql.DateTime2, new Date(to));
    conditions.push('created_at < DATEADD(day, 1, @to)');
  }
  if (status) {
    request.input('status', sql.NVarChar(50), status);
    conditions.push('status = @status');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await request.query(`
    SELECT
      s.id, s.aanvraagnummer, s.naam_aanvrager, s.email_aanvrager,
      s.type_betaling, s.naam_terugstorting, s.iban, s.omschrijving,
      s.status, s.taal, s.created_at,
      (SELECT COUNT(*) FROM uploads u WHERE u.submission_id = s.id) AS upload_count
    FROM submissions s
    ${where}
    ORDER BY s.created_at DESC
  `);

  return result.recordset;
}

module.exports = { createSubmission, createUploadRecord, listSubmissions, getSubmissionsForExport };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=models/submission
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/models/submission.js __tests__/models/submission.test.js
git commit -m "feat: submission model with prepared statements and tests"
```

---

## Task 8: Mail Service + Tests

**Files:**
- Create: `src/services/mailService.js`
- Create: `__tests__/services/mailService.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// __tests__/services/mailService.test.js
jest.mock('nodemailer');

const nodemailer = require('nodemailer');
const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'test' });
nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

const { sendAdminNotification, sendUserConfirmation, templates } = require('../../src/services/mailService');

describe('templates', () => {
  it('has nl and fr admin templates', () => {
    expect(templates.admin.nl.subject).toContain('{{id}}');
    expect(templates.admin.fr.subject).toContain('{{id}}');
  });

  it('nl admin body includes submission data', () => {
    const body = templates.admin.nl.body({ submissionId: 5, naam_aanvrager: 'Jan', email_aanvrager: 'jan@test.com', type_betaling: 'dringend' });
    expect(body).toContain('Jan');
    expect(body).toContain('5');
  });

  it('fr user body includes recipient name', () => {
    const body = templates.user.fr.body({ naam: 'Pierre' });
    expect(body).toContain('Pierre');
  });
});

describe('sendAdminNotification', () => {
  it('calls sendMail with admin email and correct subject', async () => {
    await sendAdminNotification({ submissionId: 7, naam_aanvrager: 'Test', email_aanvrager: 'test@test.com', type_betaling: 'korting', lang: 'nl' });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: process.env.ADMIN_EMAIL,
        subject: expect.stringContaining('7'),
      })
    );
  });
});

describe('sendUserConfirmation', () => {
  it('calls sendMail with user email', async () => {
    sendMailMock.mockClear();
    await sendUserConfirmation({ to: 'user@test.com', naam: 'User', lang: 'fr' });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@test.com' })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=mailService
```

Expected: `Cannot find module '../../src/services/mailService'`

- [ ] **Step 3: Create `src/services/mailService.js`**

```javascript
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '25', 10),
  secure: false,
  // No auth object — server uses IP-based authentication
});

const templates = {
  admin: {
    nl: {
      subject: 'Nieuwe terugbetalingsaanvraag #{{id}}',
      body: ({ submissionId, naam_aanvrager, email_aanvrager, type_betaling }) =>
        `Nieuwe terugbetalingsaanvraag ontvangen.\n\nID: ${submissionId}\nNaam aanvrager: ${naam_aanvrager}\nE-mail aanvrager: ${email_aanvrager}\nType betaling: ${type_betaling}\n\nBekijk alle aanvragen in het adminpaneel.`,
    },
    fr: {
      subject: 'Nouvelle demande de remboursement #{{id}}',
      body: ({ submissionId, naam_aanvrager, email_aanvrager, type_betaling }) =>
        `Nouvelle demande de remboursement reçue.\n\nID: ${submissionId}\nNom du demandeur: ${naam_aanvrager}\nE-mail: ${email_aanvrager}\nType de paiement: ${type_betaling}\n\nConsultez toutes les demandes dans le panneau d'administration.`,
    },
  },
  user: {
    nl: {
      subject: 'Bevestiging van uw terugbetalingsaanvraag',
      body: ({ naam }) =>
        `Beste ${naam},\n\nUw terugbetalingsaanvraag is succesvol ontvangen. We nemen zo snel mogelijk contact met u op.\n\nMet vriendelijke groeten,\nDockX Rental`,
    },
    fr: {
      subject: 'Confirmation de votre demande de remboursement',
      body: ({ naam }) =>
        `Cher(e) ${naam},\n\nVotre demande de remboursement a bien été reçue. Nous vous contacterons dans les plus brefs délais.\n\nCordialement,\nDockX Rental`,
    },
  },
};

async function sendAdminNotification({ submissionId, naam_aanvrager, email_aanvrager, type_betaling, lang = 'nl' }) {
  const tmpl = templates.admin[lang] || templates.admin.nl;
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: process.env.ADMIN_EMAIL,
    subject: tmpl.subject.replace('{{id}}', submissionId),
    text: tmpl.body({ submissionId, naam_aanvrager, email_aanvrager, type_betaling }),
  });
}

async function sendUserConfirmation({ to, naam, lang = 'nl' }) {
  const tmpl = templates.user[lang] || templates.user.nl;
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: tmpl.subject,
    text: tmpl.body({ naam }),
  });
}

module.exports = { sendAdminNotification, sendUserConfirmation, templates };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=mailService
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/mailService.js __tests__/services/mailService.test.js
git commit -m "feat: mail service with NL/FR templates and tests"
```

---

## Task 9: Export Service + Tests

**Files:**
- Create: `src/services/exportService.js`
- Create: `__tests__/services/exportService.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern=exportService
```

Expected: `Cannot find module '../../src/services/exportService'`

- [ ] **Step 3: Create `src/services/exportService.js`**

```javascript
const fastCsv = require('fast-csv');
const ExcelJS = require('exceljs');

const COLUMNS = [
  { header: 'ID',                  key: 'id' },
  { header: 'Aanvraagnummer',      key: 'aanvraagnummer' },
  { header: 'Naam aanvrager',      key: 'naam_aanvrager' },
  { header: 'E-mail aanvrager',    key: 'email_aanvrager' },
  { header: 'Type betaling',       key: 'type_betaling' },
  { header: 'Naam terugstorting',  key: 'naam_terugstorting' },
  { header: 'IBAN',                key: 'iban' },
  { header: 'Omschrijving',        key: 'omschrijving' },
  { header: 'Status',              key: 'status' },
  { header: 'Taal',                key: 'taal' },
  { header: 'Bijlagen',            key: 'upload_count' },
  { header: 'Datum',               key: 'created_at' },
];

function toRow(row) {
  return COLUMNS.reduce((acc, col) => {
    let val = row[col.key];
    if (val instanceof Date) val = val.toISOString();
    acc[col.header] = val ?? '';
    return acc;
  }, {});
}

function streamCsv(rows, res) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="submissions.csv"');

  const csvStream = fastCsv.format({ headers: true });
  csvStream.pipe(res);
  for (const row of rows) csvStream.write(toRow(row));
  csvStream.end();
}

async function streamXlsx(rows, res) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="submissions.xlsx"');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Submissions');

  sheet.columns = COLUMNS.map((col) => ({ header: col.header, key: col.key, width: 22 }));

  for (const row of rows) {
    const mapped = { ...row };
    if (mapped.created_at instanceof Date) {
      mapped.created_at = mapped.created_at.toLocaleString('nl-BE');
    }
    sheet.addRow(mapped);
  }

  sheet.getRow(1).font = { bold: true };
  await workbook.xlsx.write(res);
}

module.exports = { streamCsv, streamXlsx };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=exportService
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/exportService.js __tests__/services/exportService.test.js
git commit -m "feat: export service (CSV + XLSX streaming) with tests"
```

---

## Task 10: Submission Route + Tests

**Files:**
- Create: `src/routes/submissions.js`
- Create: `src/server.js` (minimal, for testing — expanded in Task 13)
- Create: `__tests__/routes/submissions.test.js`

- [ ] **Step 1: Create minimal `src/server.js`** (will be completed in Task 13)

```javascript
require('dotenv').config({ path: '.env.local' });
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const { generateToken } = require('./middleware/csrf');
const submissionsRouter = require('./routes/submissions');

const app = express();

app.use(helmet());
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-cookie-secret'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/api/csrf-token', (req, res) => {
  res.json({ token: generateToken(req, res) });
});

app.use('/api/submissions', submissionsRouter);

// Error handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN' || err.message === 'invalid csrf token') {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  if (process.env.NODE_ENV !== 'production') console.error(err.message);
  res.status(err.status || 500).json({ error: 'An error occurred' });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3004;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
```

- [ ] **Step 2: Create `src/routes/submissions.js`**

```javascript
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { doubleCsrfProtection } = require('../middleware/csrf');
const { submitLimiter } = require('../middleware/rateLimiter');
const { upload } = require('../middleware/upload');
const { createSubmission, createUploadRecord } = require('../models/submission');
const { sendAdminNotification, sendUserConfirmation } = require('../services/mailService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_TYPES = new Set(['onkostennota', 'dringend', 'korting', 'andere']);

// Ensure upload dir exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

router.post(
  '/',
  submitLimiter,
  doubleCsrfProtection,
  upload.array('bijlagen', 10),
  async (req, res) => {
    const { aanvraagnummer, naam_aanvrager, email_aanvrager, type_betaling,
            naam_terugstorting, iban, omschrijving, taal } = req.body;

    const errors = {};
    if (!naam_aanvrager?.trim())                                      errors.naam_aanvrager = 'Verplicht';
    if (!email_aanvrager?.trim() || !EMAIL_RE.test(email_aanvrager)) errors.email_aanvrager = 'Geldig e-mailadres vereist';
    if (!type_betaling || !VALID_TYPES.has(type_betaling))           errors.type_betaling = 'Verplicht';
    if (!naam_terugstorting?.trim())                                  errors.naam_terugstorting = 'Verplicht';

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({ errors });
    }

    try {
      const lang = taal === 'fr' ? 'fr' : 'nl';
      const submissionId = await createSubmission({
        aanvraagnummer: aanvraagnummer?.trim() || null,
        naam_aanvrager: naam_aanvrager.trim(),
        email_aanvrager: email_aanvrager.trim().toLowerCase(),
        type_betaling,
        naam_terugstorting: naam_terugstorting.trim(),
        iban: iban?.trim() || null,
        omschrijving: omschrijving?.trim() || null,
        taal: lang,
      });

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          await createUploadRecord({
            submission_id: submissionId,
            original_name: file.originalname,
            stored_name: file.filename,
            mime_type: file.mimetype,
            size_bytes: file.size,
          });
        }
      }

      // Non-blocking email
      sendAdminNotification({ submissionId, naam_aanvrager: naam_aanvrager.trim(), email_aanvrager, type_betaling, lang })
        .catch((err) => console.error('Admin mail failed:', err.message));
      sendUserConfirmation({ to: email_aanvrager.trim(), naam: naam_aanvrager.trim(), lang })
        .catch((err) => console.error('User mail failed:', err.message));

      res.status(201).json({ success: true, id: submissionId });
    } catch (err) {
      console.error('Submission error:', err.message);
      res.status(500).json({ error: 'Er is een fout opgetreden' });
    }
  }
);

module.exports = router;
```

- [ ] **Step 3: Write the failing tests**

```javascript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=routes/submissions
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server.js src/routes/submissions.js __tests__/routes/submissions.test.js
git commit -m "feat: submission route with CSRF, validation, file upload, tests"
```

---

## Task 11: Admin Route + Tests

**Files:**
- Create: `src/routes/admin.js`
- Modify: `src/server.js` (add admin router)
- Create: `__tests__/routes/admin.test.js`

- [ ] **Step 1: Create `src/routes/admin.js`**

```javascript
const express = require('express');
const router = express.Router();
const { requireAdminToken } = require('../middleware/auth');
const { listSubmissions, getSubmissionsForExport } = require('../models/submission');
const { streamCsv, streamXlsx } = require('../services/exportService');

router.get('/submissions', requireAdminToken, async (req, res) => {
  try {
    const { from, to, status, page, pageSize } = req.query;
    const result = await listSubmissions({
      from,
      to,
      status,
      page: parseInt(page || '1', 10),
      pageSize: parseInt(pageSize || '20', 10),
    });
    res.json(result);
  } catch (err) {
    console.error('Admin list error:', err.message);
    res.status(500).json({ error: 'Er is een fout opgetreden' });
  }
});

router.get('/export', requireAdminToken, async (req, res) => {
  try {
    const { from, to, status, format = 'csv' } = req.query;
    const rows = await getSubmissionsForExport({ from, to, status });

    if (format === 'xlsx') {
      await streamXlsx(rows, res);
    } else {
      streamCsv(rows, res);
    }
  } catch (err) {
    console.error('Export error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export mislukt' });
    }
  }
});

module.exports = router;
```

- [ ] **Step 2: Add admin router to `src/server.js`** (add after submissions router line)

```javascript
// Add these lines to src/server.js after the submissions router import:
const adminRouter = require('./routes/admin');

// Add after: app.use('/api/submissions', submissionsRouter);
app.use('/api', adminRouter);
```

The updated imports block in server.js should be:
```javascript
const { generateToken } = require('./middleware/csrf');
const submissionsRouter = require('./routes/submissions');
const adminRouter = require('./routes/admin');
```

And the routes block:
```javascript
app.get('/api/csrf-token', (req, res) => {
  res.json({ token: generateToken(req, res) });
});

app.use('/api/submissions', submissionsRouter);
app.use('/api', adminRouter);
```

- [ ] **Step 3: Write the failing tests**

```javascript
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
    streamXlsx.mockResolvedValue();
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=routes/admin
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/admin.js src/server.js __tests__/routes/admin.test.js
git commit -m "feat: admin route (list + export) with auth and tests"
```

---

## Task 12: Files Route + Tests

**Files:**
- Create: `src/routes/files.js`
- Modify: `src/server.js` (add files router)
- Create: `__tests__/routes/files.test.js`

- [ ] **Step 1: Create `src/routes/files.js`**

```javascript
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAdminToken } = require('../middleware/auth');

router.get('/uploads/:filename', requireAdminToken, (req, res) => {
  // path.basename strips any directory component — prevents traversal
  const filename = path.basename(req.params.filename);
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
  const filePath = path.join(uploadDir, filename);

  // Secondary check: resolved path must start with upload dir
  if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.sendFile(filePath);
});

module.exports = router;
```

- [ ] **Step 2: Add files router to `src/server.js`**

Add to imports:
```javascript
const filesRouter = require('./routes/files');
```

Add after the admin router line:
```javascript
app.use('/api', filesRouter);
```

- [ ] **Step 3: Write the failing tests**

```javascript
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
    // Either 400 (blocked) or 404 (not found) — both acceptable, not 200
    expect([400, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern=routes/files
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/files.js src/server.js __tests__/routes/files.test.js
git commit -m "feat: file serving route (admin-only, path traversal protected) with tests"
```

---

## Task 13: Complete server.js

**Files:**
- Modify: `src/server.js`

Replace the content of `src/server.js` with the complete version including static files, SPA routing, and full helmet CSP.

- [ ] **Step 1: Replace `src/server.js` with the complete version**

```javascript
require('dotenv').config({ path: '.env.local' });
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const { generateToken } = require('./middleware/csrf');
const submissionsRouter = require('./routes/submissions');
const adminRouter = require('./routes/admin');
const filesRouter = require('./routes/files');

const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'cdn.jsdelivr.net'],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
  })
);

app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-cookie-secret'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CSRF token endpoint (must come before static files so it's served as API)
app.get('/api/csrf-token', (req, res) => {
  res.json({ token: generateToken(req, res) });
});

// API routes
app.use('/api/submissions', submissionsRouter);
app.use('/api', adminRouter);
app.use('/api', filesRouter);

// Static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback for /admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN' || err.message === 'invalid csrf token') {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  if (process.env.NODE_ENV !== 'production') console.error(err.message);
  res.status(err.status || 500).json({ error: 'An error occurred' });
});

module.exports = app;

if (require.main === module) {
  const PORT = parseInt(process.env.PORT || '3004', 10);
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
```

- [ ] **Step 2: Run all tests to ensure nothing broke**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: complete server.js with helmet CSP, static files, SPA routing"
```

---

## Task 14: i18n + CSS

**Files:**
- Create: `public/assets/i18n.js`
- Create: `public/assets/style.css`

- [ ] **Step 1: Create `public/assets/i18n.js`**

```javascript
window.i18n = {
  nl: {
    title: 'Aanvraagformulier voor terugbetalingen en kleine manuele betalingen',
    subtitle: 'Gebruik dit formulier om terugbetalingen of kleine manuele betalingen aan te vragen. Zorg ervoor dat alle verplichte velden ingevuld zijn voor de verwerking van uw aanvraag.',
    aanvraagnummer: 'Aanvraagnummer',
    aanvragerDetails: 'Aanvrager Details',
    naamAanvrager: 'Naam aanvrager',
    emailAanvrager: 'E-mail aanvrager',
    typeBetaling: 'Type betaling',
    types: {
      onkostennota: 'Onkostennota',
      dringend: 'Dringende terugbetaling',
      korting: 'Korting',
      andere: 'Andere terugbetaling',
    },
    algemeneBedrijfsgegevens: 'Algemene Bedrijfsgegevens',
    naamTerugstorting: 'Naam terugstorting',
    iban: 'IBAN',
    omschrijving: 'Omschrijving betaling',
    bijlagen: 'Bijlagen',
    dropFiles: 'Sleep bestanden hierheen of',
    browse: 'blader',
    submit: 'Versturen',
    submitting: 'Bezig met versturen\u2026',
    successTitle: 'Aanvraag ingediend',
    successMsg: 'Uw aanvraag is succesvol ontvangen. U ontvangt een bevestiging per e-mail.',
    errorMsg: 'Er is een fout opgetreden. Probeer het opnieuw.',
    required: 'Verplicht',
    invalidEmail: 'Geldig e-mailadres vereist',
    fileTooLarge: 'Bestand te groot (max. 2\u00a0MB)',
    fileTypeNotAllowed: 'Bestandstype niet toegestaan',
    maxFiles: 'Maximaal 10 bestanden',
    remove: 'Verwijder',
    allowedTypes: 'Toegelaten: PDF, JPG, PNG, GIF, WEBP, DOCX, XLSX, ZIP',
  },
  fr: {
    title: 'Formulaire de demande de remboursements et de petits paiements manuels',
    subtitle: 'Utilisez ce formulaire pour demander des remboursements ou des petits paiements manuels. Assurez-vous que tous les champs obligatoires sont remplis pour le traitement de votre demande.',
    aanvraagnummer: 'Numéro de demande',
    aanvragerDetails: 'Détails du demandeur',
    naamAanvrager: 'Nom du demandeur',
    emailAanvrager: 'E-mail du demandeur',
    typeBetaling: 'Type de paiement',
    types: {
      onkostennota: 'Note de frais',
      dringend: 'Remboursement urgent',
      korting: 'Réduction',
      andere: 'Autre remboursement',
    },
    algemeneBedrijfsgegevens: 'Informations générales',
    naamTerugstorting: 'Nom pour remboursement',
    iban: 'IBAN',
    omschrijving: 'Description du paiement',
    bijlagen: 'Pièces jointes',
    dropFiles: 'Déposez les fichiers ici ou',
    browse: 'parcourir',
    submit: 'Envoyer',
    submitting: 'Envoi en cours\u2026',
    successTitle: 'Demande soumise',
    successMsg: 'Votre demande a bien été reçue. Vous recevrez une confirmation par e-mail.',
    errorMsg: 'Une erreur est survenue. Veuillez réessayer.',
    required: 'Obligatoire',
    invalidEmail: 'Adresse e-mail valide requise',
    fileTooLarge: 'Fichier trop volumineux (max.\u00a02\u00a0Mo)',
    fileTypeNotAllowed: 'Type de fichier non autorisé',
    maxFiles: '10 fichiers maximum',
    remove: 'Supprimer',
    allowedTypes: 'Autorisés\u00a0: PDF, JPG, PNG, GIF, WEBP, DOCX, XLSX, ZIP',
  },
};
```

- [ ] **Step 2: Create `public/assets/style.css`**

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #333;
  background: #f5f5f5;
  padding: 0 0 60px;
}

/* Header */
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  background: #fff;
  border-bottom: 1px solid #e0e0e0;
  margin-bottom: 24px;
}

.logo { display: flex; align-items: baseline; gap: 2px; }
.logo-dock { font-size: 22px; font-weight: 900; color: #1a1a1a; letter-spacing: -1px; }
.logo-x    { font-size: 22px; font-weight: 900; color: #e63329; letter-spacing: -1px; }
.logo-rental { font-size: 9px; letter-spacing: 3px; text-transform: uppercase; color: #666; margin-left: 4px; align-self: flex-end; }

/* Language switcher */
.lang-switcher { display: flex; gap: 4px; }
.lang-switcher button {
  padding: 4px 10px;
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: #666;
}
.lang-switcher button.active {
  background: #1a1a1a;
  color: #fff;
  border-color: #1a1a1a;
}

/* Main container */
.form-container, .admin-container, .login-card, .success-card {
  max-width: 720px;
  margin: 0 auto;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 32px;
}

h1 { font-size: 18px; font-weight: 700; margin-bottom: 8px; color: #1a1a1a; }
.form-subtitle { font-size: 13px; color: #555; margin-bottom: 24px; line-height: 1.6; }

/* Sections */
.section-header {
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
  background: #f9f9f9;
  border: 1px solid #e0e0e0;
  padding: 8px 12px;
  margin: 20px 0 14px;
  border-radius: 3px;
}

/* Form groups */
.form-row { display: flex; gap: 16px; }
.form-row .form-group { flex: 1; }

.form-group { margin-bottom: 14px; }

label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #333;
  margin-bottom: 4px;
}

.required { color: #e63329; margin-left: 2px; }

input[type="text"],
input[type="email"],
input[type="password"],
input[type="date"],
select,
textarea {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid #ccc;
  border-radius: 3px;
  font-size: 13px;
  color: #333;
  background: #fff;
  transition: border-color 0.15s;
}
input:focus, textarea:focus, select:focus { outline: none; border-color: #666; }

textarea { resize: vertical; min-height: 80px; }

.form-group.error input,
.form-group.error textarea { border-color: #e63329; }

.error-msg { font-size: 12px; color: #e63329; margin-top: 3px; display: block; }

/* Radio group */
.radio-group { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
.radio-label { display: flex; align-items: center; gap: 8px; font-weight: 400; cursor: pointer; }
.radio-label input { width: auto; }

/* Drop zone */
.drop-zone {
  border: 2px dashed #ccc;
  border-radius: 4px;
  padding: 20px;
  text-align: center;
  cursor: pointer;
  color: #888;
  font-size: 13px;
  transition: border-color 0.15s, background 0.15s;
}
.drop-zone:hover, .drop-zone.dragging {
  border-color: #666;
  background: #fafafa;
}
.drop-zone .link { color: #0066cc; text-decoration: underline; cursor: pointer; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
.allowed-types { font-size: 11px; color: #999; margin-top: 4px; }

/* File list */
.file-list { list-style: none; margin-top: 8px; }
.file-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  background: #f9f9f9;
  border: 1px solid #e8e8e8;
  border-radius: 3px;
  margin-bottom: 4px;
  font-size: 12px;
}
.file-list li span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { color: #888; flex-shrink: 0; }
.file-list button {
  background: none;
  border: none;
  color: #e63329;
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
  flex-shrink: 0;
}

/* Submit button */
.btn-submit {
  display: block;
  width: 100%;
  padding: 10px;
  margin-top: 20px;
  background: #1a1a1a;
  color: #fff;
  border: none;
  border-radius: 3px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-submit:hover:not(:disabled) { background: #333; }
.btn-submit:disabled { background: #999; cursor: not-allowed; }

/* Success card */
.success-card { text-align: center; padding: 48px 32px; }
.success-card h2 { font-size: 20px; margin-bottom: 8px; color: #2e7d32; }

/* Admin */
.login-card { max-width: 360px; margin-top: 60px; }
.login-card h1 { margin-bottom: 20px; }

.admin-container { max-width: 1100px; padding: 24px; }
.admin-container h1 { margin-bottom: 16px; }

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 16px;
  padding: 12px;
  background: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 3px;
}
.filters input, .filters select { width: auto; padding: 5px 8px; font-size: 12px; }
.btn-export {
  padding: 5px 12px;
  background: #1a1a1a;
  color: #fff;
  border: none;
  border-radius: 3px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-export:hover { background: #333; }
.btn-logout { padding: 5px 12px; background: #fff; border: 1px solid #ccc; border-radius: 3px; font-size: 12px; cursor: pointer; }

.table-wrapper { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid #e8e8e8; white-space: nowrap; }
th { background: #f5f5f5; font-weight: 600; color: #555; font-size: 11px; text-transform: uppercase; }
tr:hover td { background: #fafafa; }

.pagination { display: flex; align-items: center; gap: 12px; margin-top: 12px; font-size: 13px; }
.pagination button {
  padding: 4px 10px;
  border: 1px solid #ccc;
  background: #fff;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}
.pagination button:disabled { opacity: 0.4; cursor: default; }

@media (max-width: 600px) {
  .form-row { flex-direction: column; }
  header { flex-direction: column; gap: 12px; }
}
```

- [ ] **Step 3: Commit**

```bash
git add public/assets/i18n.js public/assets/style.css
git commit -m "feat: NL/FR i18n strings and form/admin CSS"
```

---

## Task 15: Form Page

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create `public/index.html`**

```html
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DockX Rental — Terugbetalingsformulier</title>
  <link rel="stylesheet" href="/assets/style.css">
  <script src="/assets/i18n.js"></script>
</head>
<body>
  <div x-data="formApp()" x-init="init()">

    <header>
      <div class="logo">
        <span class="logo-dock">DOCK</span><span class="logo-x">X</span>
        <span class="logo-rental">RENTAL</span>
      </div>
      <div class="lang-switcher">
        <button :class="{ active: lang === 'nl' }" @click="lang = 'nl'">NL</button>
        <button :class="{ active: lang === 'fr' }" @click="lang = 'fr'">FR</button>
      </div>
    </header>

    <!-- Success state -->
    <div x-show="submitted" class="form-container" style="text-align:center;padding:48px 32px;">
      <h2 style="color:#2e7d32;margin-bottom:8px;" x-text="t('successTitle')"></h2>
      <p x-text="t('successMsg')"></p>
    </div>

    <!-- Form -->
    <div x-show="!submitted" class="form-container">
      <h1 x-text="t('title')"></h1>
      <p class="form-subtitle" x-text="t('subtitle')"></p>

      <form @submit.prevent="submit" novalidate>

        <!-- Aanvraagnummer -->
        <div class="form-group">
          <label for="aanvraagnummer" x-text="t('aanvraagnummer')"></label>
          <input id="aanvraagnummer" type="text" x-model="form.aanvraagnummer">
        </div>

        <!-- Aanvrager Details -->
        <div class="section-header" x-text="t('aanvragerDetails')"></div>
        <div class="form-row">
          <div class="form-group" :class="{ error: errors.naam_aanvrager }">
            <label for="naam_aanvrager">
              <span x-text="t('naamAanvrager')"></span><span class="required">*</span>
            </label>
            <input id="naam_aanvrager" type="text" x-model="form.naam_aanvrager">
            <span class="error-msg" x-show="errors.naam_aanvrager" x-text="t('required')"></span>
          </div>
          <div class="form-group" :class="{ error: errors.email_aanvrager }">
            <label for="email_aanvrager">
              <span x-text="t('emailAanvrager')"></span><span class="required">*</span>
            </label>
            <input id="email_aanvrager" type="email" x-model="form.email_aanvrager">
            <span class="error-msg" x-show="errors.email_aanvrager" x-text="errors.email_aanvrager || t('invalidEmail')"></span>
          </div>
        </div>

        <!-- Type betaling -->
        <div class="form-group" :class="{ error: errors.type_betaling }">
          <label>
            <span x-text="t('typeBetaling')"></span><span class="required">*</span>
          </label>
          <div class="radio-group">
            <template x-for="type in ['onkostennota', 'dringend', 'korting', 'andere']" :key="type">
              <label class="radio-label">
                <input type="radio" :value="type" x-model="form.type_betaling">
                <span x-text="t('types')[type]"></span>
              </label>
            </template>
          </div>
          <span class="error-msg" x-show="errors.type_betaling" x-text="t('required')"></span>
        </div>

        <!-- Algemene Bedrijfsgegevens -->
        <div class="section-header" x-text="t('algemeneBedrijfsgegevens')"></div>

        <div class="form-group" :class="{ error: errors.naam_terugstorting }">
          <label for="naam_terugstorting">
            <span x-text="t('naamTerugstorting')"></span><span class="required">*</span>
          </label>
          <input id="naam_terugstorting" type="text" x-model="form.naam_terugstorting">
          <span class="error-msg" x-show="errors.naam_terugstorting" x-text="t('required')"></span>
        </div>

        <div class="form-group">
          <label for="iban" x-text="t('iban')"></label>
          <input id="iban" type="text" x-model="form.iban" placeholder="BE00 0000 0000 0000">
        </div>

        <div class="form-group">
          <label for="omschrijving" x-text="t('omschrijving')"></label>
          <textarea id="omschrijving" x-model="form.omschrijving" rows="4"></textarea>
        </div>

        <!-- Bijlagen -->
        <div class="form-group">
          <label x-text="t('bijlagen')"></label>
          <div
            class="drop-zone"
            :class="{ dragging: isDragging }"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop($event)"
            @click="$refs.fileInput.click()"
          >
            <input
              type="file"
              x-ref="fileInput"
              multiple
              class="sr-only"
              accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.docx,.xlsx,.zip"
              @change="handleFileChange($event)"
            >
            <p>
              <span x-text="t('dropFiles')"></span>&nbsp;<span class="link" x-text="t('browse')"></span>
            </p>
          </div>
          <p class="allowed-types" x-text="t('allowedTypes')"></p>

          <ul class="file-list" x-show="files.length > 0">
            <template x-for="(file, i) in files" :key="i">
              <li>
                <span x-text="file.name"></span>
                <span class="file-size" x-text="formatSize(file.size)"></span>
                <button type="button" @click="removeFile(i)" x-text="t('remove')"></button>
              </li>
            </template>
          </ul>

          <template x-for="err in fileErrors" :key="err">
            <span class="error-msg" x-text="err"></span>
          </template>
        </div>

        <span class="error-msg" x-show="submitError" x-text="t('errorMsg')"></span>

        <button type="submit" class="btn-submit" :disabled="submitting">
          <span x-text="submitting ? t('submitting') : t('submit')"></span>
        </button>

      </form>
    </div><!-- /.form-container -->

  </div><!-- /x-data -->

  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script>
    function formApp() {
      return {
        lang: 'nl',
        form: {
          aanvraagnummer: '',
          naam_aanvrager: '',
          email_aanvrager: '',
          type_betaling: '',
          naam_terugstorting: '',
          iban: '',
          omschrijving: '',
        },
        files: [],
        fileErrors: [],
        errors: {},
        submitting: false,
        submitted: false,
        submitError: false,
        isDragging: false,
        csrfToken: '',

        t(key) {
          const parts = key.split('.');
          let val = window.i18n[this.lang];
          for (const p of parts) val = val?.[p];
          return val !== undefined ? val : key;
        },

        async init() {
          try {
            const res = await fetch('/api/csrf-token');
            const data = await res.json();
            this.csrfToken = data.token;
          } catch (e) {
            console.error('Could not fetch CSRF token');
          }
        },

        handleFileChange(event) {
          this.addFiles(Array.from(event.target.files));
          event.target.value = '';
        },

        handleDrop(event) {
          this.isDragging = false;
          this.addFiles(Array.from(event.dataTransfer.files));
        },

        addFiles(newFiles) {
          this.fileErrors = [];
          const MAX = 2 * 1024 * 1024;
          const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.docx', '.xlsx', '.zip']);

          for (const file of newFiles) {
            if (this.files.length >= 10) {
              this.fileErrors.push(this.t('maxFiles'));
              break;
            }
            const ext = '.' + file.name.split('.').pop().toLowerCase();
            if (!ALLOWED.has(ext)) {
              this.fileErrors.push(`${file.name}: ${this.t('fileTypeNotAllowed')}`);
              continue;
            }
            if (file.size > MAX) {
              this.fileErrors.push(`${file.name}: ${this.t('fileTooLarge')}`);
              continue;
            }
            this.files.push(file);
          }
        },

        removeFile(i) { this.files.splice(i, 1); },

        formatSize(b) {
          if (b < 1024) return b + ' B';
          if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
          return (b / 1024 / 1024).toFixed(1) + ' MB';
        },

        validate() {
          this.errors = {};
          if (!this.form.naam_aanvrager.trim()) this.errors.naam_aanvrager = true;
          if (!this.form.email_aanvrager.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.form.email_aanvrager)) {
            this.errors.email_aanvrager = this.t('invalidEmail');
          }
          if (!this.form.type_betaling) this.errors.type_betaling = true;
          if (!this.form.naam_terugstorting.trim()) this.errors.naam_terugstorting = true;
          return Object.keys(this.errors).length === 0;
        },

        async submit() {
          if (!this.validate()) return;
          this.submitting = true;
          this.submitError = false;

          const fd = new FormData();
          for (const [k, v] of Object.entries(this.form)) fd.append(k, v);
          fd.append('taal', this.lang);
          for (const file of this.files) fd.append('bijlagen', file);

          try {
            const res = await fetch('/api/submissions', {
              method: 'POST',
              headers: { 'x-csrf-token': this.csrfToken },
              body: fd,
            });
            if (res.ok) {
              this.submitted = true;
            } else {
              const data = await res.json().catch(() => ({}));
              if (data.errors) {
                this.errors = data.errors;
              } else {
                this.submitError = true;
              }
            }
          } catch (e) {
            this.submitError = true;
          } finally {
            this.submitting = false;
          }
        },
      };
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: form page with Alpine.js, NL/FR i18n, file upload, CSRF"
```

---

## Task 16: Admin Dashboard

**Files:**
- Create: `public/admin.html`

- [ ] **Step 1: Create `public/admin.html`**

```html
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DockX Rental — Admin</title>
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <div x-data="adminApp()" x-init="init()">

    <!-- Login -->
    <div x-show="!authenticated" style="display:flex;justify-content:center;padding:60px 16px;">
      <div class="login-card">
        <div class="logo" style="margin-bottom:20px;">
          <span class="logo-dock">DOCK</span><span class="logo-x">X</span>
          <span class="logo-rental">RENTAL</span>
        </div>
        <h1>Admin</h1>
        <form @submit.prevent="login" style="margin-top:20px;">
          <div class="form-group">
            <label for="tokenInput">Admin token</label>
            <input id="tokenInput" type="password" x-model="tokenInput" autocomplete="off">
          </div>
          <span class="error-msg" x-show="loginError">Ongeldig token</span>
          <button type="submit" class="btn-submit" :disabled="loggingIn">
            <span x-text="loggingIn ? 'Bezig\u2026' : 'Aanmelden'"></span>
          </button>
        </form>
      </div>
    </div>

    <!-- Dashboard -->
    <template x-if="authenticated">
      <div>
        <header>
          <div class="logo">
            <span class="logo-dock">DOCK</span><span class="logo-x">X</span>
            <span class="logo-rental">RENTAL</span>
          </div>
          <button class="btn-logout" @click="logout">Afmelden</button>
        </header>

        <div class="admin-container">
          <h1>Aanvragen</h1>

          <!-- Filters -->
          <div class="filters">
            <label style="font-size:12px;font-weight:600;">Van</label>
            <input type="date" x-model="filters.from" @change="page=1;loadSubmissions()">
            <label style="font-size:12px;font-weight:600;">Tot</label>
            <input type="date" x-model="filters.to" @change="page=1;loadSubmissions()">
            <select x-model="filters.status" @change="page=1;loadSubmissions()">
              <option value="">Alle statussen</option>
              <option value="nieuw">Nieuw</option>
              <option value="verwerkt">Verwerkt</option>
            </select>
            <button class="btn-export" @click="exportData('csv')">Export CSV</button>
            <button class="btn-export" @click="exportData('xlsx')">Export XLSX</button>
          </div>

          <!-- Loading -->
          <p x-show="loading" style="color:#888;font-size:13px;margin-bottom:12px;">Laden&hellip;</p>

          <!-- Table -->
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Datum</th>
                  <th>Naam aanvrager</th>
                  <th>E-mail</th>
                  <th>Type betaling</th>
                  <th>Naam terugstorting</th>
                  <th>IBAN</th>
                  <th>Omschrijving</th>
                  <th>Status</th>
                  <th>Taal</th>
                  <th>Bijlagen</th>
                </tr>
              </thead>
              <tbody>
                <template x-for="row in rows" :key="row.id">
                  <tr>
                    <td x-text="row.id"></td>
                    <td x-text="fmtDate(row.created_at)"></td>
                    <td x-text="row.naam_aanvrager"></td>
                    <td x-text="row.email_aanvrager"></td>
                    <td x-text="row.type_betaling"></td>
                    <td x-text="row.naam_terugstorting"></td>
                    <td x-text="row.iban || '—'"></td>
                    <td x-text="row.omschrijving ? (row.omschrijving.length > 40 ? row.omschrijving.slice(0,40)+'…' : row.omschrijving) : '—'"></td>
                    <td x-text="row.status"></td>
                    <td x-text="(row.taal || 'nl').toUpperCase()"></td>
                    <td x-text="row.upload_count"></td>
                  </tr>
                </template>
                <tr x-show="!loading && rows.length === 0">
                  <td colspan="11" style="text-align:center;color:#888;padding:20px;">
                    Geen aanvragen gevonden
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div class="pagination" x-show="total > pageSize">
            <button @click="prevPage()" :disabled="page <= 1">&larr; Vorige</button>
            <span x-text="`Pagina ${page} van ${Math.ceil(total / pageSize) || 1} (${total} resultaten)`"></span>
            <button @click="nextPage()" :disabled="page >= Math.ceil(total / pageSize)">Volgende &rarr;</button>
          </div>

        </div><!-- /.admin-container -->
      </div>
    </template>

  </div><!-- /x-data -->

  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script>
    function adminApp() {
      return {
        authenticated: false,
        tokenInput: '',
        token: '',
        loginError: false,
        loggingIn: false,
        rows: [],
        total: 0,
        page: 1,
        pageSize: 20,
        loading: false,
        filters: { from: '', to: '', status: '' },

        init() {
          const saved = localStorage.getItem('dockx_admin_token');
          if (saved) {
            this.token = saved;
            this.authenticated = true;
            this.$nextTick(() => this.loadSubmissions());
          }
        },

        async login() {
          this.loginError = false;
          this.loggingIn = true;
          try {
            const res = await fetch('/api/submissions?pageSize=1', {
              headers: { 'Authorization': `Bearer ${this.tokenInput}` },
            });
            if (res.ok) {
              this.token = this.tokenInput;
              localStorage.setItem('dockx_admin_token', this.token);
              this.authenticated = true;
              this.$nextTick(() => this.loadSubmissions());
            } else {
              this.loginError = true;
            }
          } catch (e) {
            this.loginError = true;
          } finally {
            this.loggingIn = false;
          }
        },

        logout() {
          localStorage.removeItem('dockx_admin_token');
          this.token = '';
          this.tokenInput = '';
          this.authenticated = false;
          this.rows = [];
          this.total = 0;
        },

        async loadSubmissions() {
          this.loading = true;
          const p = new URLSearchParams({ page: this.page, pageSize: this.pageSize });
          if (this.filters.from)   p.set('from', this.filters.from);
          if (this.filters.to)     p.set('to', this.filters.to);
          if (this.filters.status) p.set('status', this.filters.status);

          try {
            const res = await fetch(`/api/submissions?${p}`, {
              headers: { 'Authorization': `Bearer ${this.token}` },
            });
            if (res.status === 401) { this.logout(); return; }
            const data = await res.json();
            this.rows = data.rows;
            this.total = data.total;
          } catch (e) {
            console.error('Load failed', e);
          } finally {
            this.loading = false;
          }
        },

        prevPage() { if (this.page > 1) { this.page--; this.loadSubmissions(); } },
        nextPage() { this.page++; this.loadSubmissions(); },

        async exportData(format) {
          const p = new URLSearchParams({ format });
          if (this.filters.from)   p.set('from', this.filters.from);
          if (this.filters.to)     p.set('to', this.filters.to);
          if (this.filters.status) p.set('status', this.filters.status);

          try {
            const res = await fetch(`/api/export?${p}`, {
              headers: { 'Authorization': `Bearer ${this.token}` },
            });
            if (!res.ok) { alert('Export mislukt'); return; }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `submissions.${format}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch (e) {
            alert('Export mislukt');
          }
        },

        fmtDate(dt) {
          return new Date(dt).toLocaleString('nl-BE', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
          });
        },
      };
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Run all tests one final time**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: admin dashboard with Alpine.js, filtering, pagination, export"
```

---

## Task 17: Deployment Files

**Files:**
- Create: `docs/deploy-iis.md`
- Create: `docs/deploy-nginx.md`

- [ ] **Step 1: Create `docs/deploy-iis.md`**

````markdown
# Deployment: Windows + IIS

## Prerequisites
- Node.js 20 LTS installed
- IIS with ARR (Application Request Routing) and URL Rewrite modules
- NSSM (Non-Sucking Service Manager)

## 1. Application Setup

```cmd
cd C:\inetpub\apps\terugbetalingsformulier
npm install --omit=dev
copy .env.example .env.local
# Fill in .env.local with production values
```

Run the migration:
```
sqlcmd -S <DB_SERVER> -d <DB_DATABASE> -U <DB_USER> -P <DB_PASSWORD> -i migrations\001_initial.sql
```

## 2. NSSM Service

```cmd
nssm install TerugBetalingsFormulier "C:\Program Files\nodejs\node.exe"
nssm set TerugBetalingsFormulier AppDirectory "C:\inetpub\apps\terugbetalingsformulier"
nssm set TerugBetalingsFormulier AppParameters "src\server.js"
nssm set TerugBetalingsFormulier AppEnvironmentExtra "NODE_ENV=production"
nssm set TerugBetalingsFormulier AppStdout "C:\inetpub\logs\terugbetaling-out.log"
nssm set TerugBetalingsFormulier AppStderr "C:\inetpub\logs\terugbetaling-err.log"
nssm set TerugBetalingsFormulier Start SERVICE_AUTO_START
nssm start TerugBetalingsFormulier
```

Environment variables from `.env.local` can be added with additional `nssm set ... AppEnvironmentExtra` calls, or set at the system level.

## 3. IIS ARR Reverse Proxy

Create a new IIS site pointing to an empty folder. Add `web.config`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="ReverseProxy" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:3004/{R:1}" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
          </serverVariables>
        </rule>
      </rules>
    </rewrite>
    <httpProtocol>
      <customHeaders>
        <remove name="X-Powered-By" />
      </customHeaders>
    </httpProtocol>
  </system.webServer>
</configuration>
```

Enable ARR proxy in IIS Manager: Application Request Routing → Server Proxy Settings → Enable proxy.

## 4. HTTPS
Configure an HTTPS binding on the IIS site using a certificate from the Windows Certificate Store (or Let's Encrypt via win-acme).

## 5. Upload Folder
Set `UPLOAD_DIR` in `.env.local` to an absolute path outside the IIS web root, e.g. `C:\data\terugbetaling-uploads`. Ensure the NSSM service account has write access to this folder.
````

- [ ] **Step 2: Create `docs/deploy-nginx.md`**

````markdown
# Deployment: Debian + Nginx

## Prerequisites
- Node.js 20 LTS (`curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs`)
- Nginx
- A non-root service user (e.g. `terugbetaling`)

## 1. Application Setup

```bash
mkdir -p /opt/terugbetalingsformulier
cd /opt/terugbetalingsformulier
# Copy application files here
npm install --omit=dev
cp .env.example .env.local
# Edit .env.local with production values
chmod 600 .env.local
```

Run the migration (using sqlcmd or Azure Data Studio):
```bash
sqlcmd -S $DB_SERVER -d $DB_DATABASE -U $DB_USER -P $DB_PASSWORD -i migrations/001_initial.sql
```

## 2. systemd Unit

Create `/etc/systemd/system/terugbetaling.service`:

```ini
[Unit]
Description=TerugBetalingsFormulier
After=network.target

[Service]
Type=simple
User=terugbetaling
WorkingDirectory=/opt/terugbetalingsformulier
EnvironmentFile=/opt/terugbetalingsformulier/.env.local
Environment=NODE_ENV=production
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable terugbetaling
systemctl start terugbetaling
systemctl status terugbetaling
```

## 3. Nginx Reverse Proxy

`/etc/nginx/sites-available/terugbetaling`:

```nginx
server {
    listen 80;
    server_name forms.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name forms.example.com;

    ssl_certificate     /etc/letsencrypt/live/forms.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/forms.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Upload size limit (must be >= 2MB per file × max files)
    client_max_body_size 25M;

    location / {
        proxy_pass         http://127.0.0.1:3004;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/terugbetaling /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## 4. HTTPS via Let's Encrypt
```bash
apt-get install certbot python3-certbot-nginx
certbot --nginx -d forms.example.com
```

## 5. Upload Folder
Set `UPLOAD_DIR=/var/data/terugbetaling-uploads` in `.env.local`. Ensure the `terugbetaling` user owns it:
```bash
mkdir -p /var/data/terugbetaling-uploads
chown terugbetaling:terugbetaling /var/data/terugbetaling-uploads
chmod 750 /var/data/terugbetaling-uploads
```
````

- [ ] **Step 3: Final full test run**

```bash
npm test
```

Expected: All tests pass, 0 failures.

- [ ] **Step 4: Final commit**

```bash
git add docs/deploy-iis.md docs/deploy-nginx.md
git commit -m "docs: IIS and Nginx deployment guides"
```

---

## Self-Review

**Spec coverage check:**
- [x] Form fields (aanvraagnummer, naam_aanvrager, email, type_betaling, naam_terugstorting, iban, omschrijving, bijlagen) — Tasks 15, 10
- [x] NL/FR i18n with language switcher — Tasks 14, 15
- [x] Server-side validation — Task 10 (submissions route)
- [x] Client-side validation — Task 15 (Alpine.js form)
- [x] File upload (Multer, 2MB, MIME+ext allowlist, UUID rename) — Tasks 5, 10
- [x] MS SQL Server via prepared statements — Tasks 2, 7
- [x] SMTP email NL/FR templates, IP-auth (no credentials), non-blocking — Task 8
- [x] Admin dashboard with filtering + pagination — Task 16
- [x] CSV + XLSX export with date/status filters — Tasks 9, 11
- [x] Bearer token admin auth — Tasks 4, 11
- [x] CSRF protection — Tasks 3, 10
- [x] helmet, rate-limit, secure headers — Tasks 6, 13
- [x] Path traversal prevention — Task 12
- [x] Error responses safe (no stack traces) — Task 13
- [x] Port 3004 — Task 13
- [x] .env.example with all variables — Task 1
- [x] IIS deployment — Task 17
- [x] Nginx deployment — Task 17
- [x] CLAUDE.md — Task 1

**No placeholders found.**

**Type consistency:** `createSubmission`, `createUploadRecord`, `listSubmissions`, `getSubmissionsForExport` defined in Task 7 and used in Tasks 10 and 11. `streamCsv`, `streamXlsx` defined in Task 9 and used in Task 11. `requireAdminToken` defined in Task 4 and used in Tasks 11 and 12. `doubleCsrfProtection` and `generateToken` defined in Task 3 and used in Tasks 10 and 13. All consistent.
