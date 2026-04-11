# TerugBetalingsFormulier — Design Spec
**Date:** 2026-04-10  
**Status:** Approved

---

## Overview

A web application for DockX Rental that provides a refund/manual payment request form ("Aanvraagformulier voor terugbetalingen en kleine manuele betalingen"). Users fill in the form, optionally upload attachments, and submit. The backend stores submissions in MS SQL Server, sends email notifications, and provides an admin dashboard for viewing and exporting submissions.

---

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (LTS) |
| Framework | Express.js |
| Frontend | Static HTML + Alpine.js (no build step) |
| Database | MS SQL Server via `mssql` package |
| Email | Nodemailer (SMTP) |
| File upload | Multer |
| Export | `fast-csv` (CSV), `exceljs` (XLSX) |
| Security | `helmet`, `express-rate-limit`, `csurf` |
| Process (Windows) | NSSM as Windows service |
| Process (Linux) | systemd unit |
| Reverse proxy (Windows) | IIS with ARR + URL Rewrite |
| Reverse proxy (Linux) | Nginx |

**Port:** 3004

---

## Architecture

Single Node.js/Express process. Serves both static frontend files and REST API from the same process.

```
Browser
  └── GET /            → public/index.html  (form, NL/FR)
  └── GET /admin       → public/admin.html  (admin dashboard)
  └── POST /api/submissions       → submit form + file(s)
  └── GET  /api/submissions       → list submissions (admin only)
  └── GET  /api/export            → download CSV or XLSX (admin only)
  └── GET  /api/uploads/:file     → download uploaded file (admin only)
```

Admin routes are protected by a bearer token middleware. The token is a minimum 32-character random string stored in `.env.local`.

---

## Form Fields (based on screenshot)

| Field | Label (NL) | Label (FR) | Required | Notes |
|---|---|---|---|---|
| aanvraagnummer | Aanvraagnummer | Numéro de demande | No | Free text |
| naam_aanvrager | Naam aanvrager | Nom du demandeur | Yes | |
| email_aanvrager | E-mail aanvrager | E-mail du demandeur | Yes | Email format validation |
| type_betaling | Type betaling | Type de paiement | Yes | Radio: onkostennota / dringend / korting / andere |
| naam_terugstorting | Naam terugstorting | Nom remboursement | Yes | |
| iban | IBAN | IBAN | No | Basic format check (starts BE/NL/FR etc.) |
| omschrijving | Omschrijving betaling | Description du paiement | No | Textarea |
| bijlagen | Bijlagen | Pièces jointes | No | File upload (multiple), 2MB per file |

Language switcher (NL / FR) on the form page. Selected language stored in `taal` field on submission.

---

## Data Model

### `submissions`

```sql
CREATE TABLE submissions (
  id                INT IDENTITY(1,1) PRIMARY KEY,
  aanvraagnummer    NVARCHAR(100)    NULL,
  naam_aanvrager    NVARCHAR(255)    NOT NULL,
  email_aanvrager   NVARCHAR(255)    NOT NULL,
  type_betaling     NVARCHAR(50)     NOT NULL,
  naam_terugstorting NVARCHAR(255)   NOT NULL,
  iban              NVARCHAR(34)     NULL,
  omschrijving      NVARCHAR(MAX)    NULL,
  status            NVARCHAR(50)     NOT NULL DEFAULT 'nieuw',
  taal              NVARCHAR(5)      NOT NULL DEFAULT 'nl',
  created_at        DATETIME2        NOT NULL DEFAULT GETDATE()
);
```

### `uploads`

```sql
CREATE TABLE uploads (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  submission_id   INT              NOT NULL REFERENCES submissions(id),
  original_name   NVARCHAR(255)    NOT NULL,
  stored_name     NVARCHAR(255)    NOT NULL,
  mime_type       NVARCHAR(100)    NOT NULL,
  size_bytes      INT              NOT NULL,
  created_at      DATETIME2        NOT NULL DEFAULT GETDATE()
);
```

---

## Folder Structure

```
/
├── src/
│   ├── server.js                  # Express entry point, port 3004
│   ├── config/
│   │   └── db.js                  # mssql connection pool
│   ├── middleware/
│   │   ├── auth.js                # Bearer token check for admin routes
│   │   ├── rateLimiter.js         # 10 submissions / 15 min / IP
│   │   └── upload.js              # Multer: 2MB, MIME+ext whitelist, UUID rename
│   ├── routes/
│   │   ├── submissions.js         # POST /api/submissions
│   │   ├── admin.js               # GET /api/submissions, GET /api/export
│   │   └── files.js               # GET /api/uploads/:file
│   ├── services/
│   │   ├── mailService.js         # Nodemailer, NL+FR templates
│   │   └── exportService.js       # CSV + XLSX generation
│   └── models/
│       └── submission.js          # DB queries via prepared statements
├── public/
│   ├── index.html                 # Form page (Alpine.js, NL/FR i18n)
│   ├── admin.html                 # Admin dashboard (Alpine.js)
│   └── assets/
│       ├── style.css
│       └── i18n.js                # NL + FR translation strings
├── uploads/                       # Stored files (outside web root serving)
├── migrations/
│   └── 001_initial.sql
├── .env.example
├── .env.local                     # Not committed
├── CLAUDE.md
└── package.json
```

---

## File Upload Security

- **Max size:** 2MB per file
- **Allowed MIME types:** `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/zip`
- **Allowed extensions:** `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.pdf`, `.docx`, `.xlsx`, `.zip`
- **Storage:** Files renamed to `<uuid>.<ext>` on disk; `uploads/` directory is served only through authenticated `/api/uploads/:file` endpoint, never as static files
- **Path traversal prevention:** Stored name is generated server-side, never derived from user input

---

## Email

- **Trigger:** After successful DB insert
- **Recipients:** Admin (notification) + requester (confirmation)
- **Language:** Based on `taal` field — NL or FR template
- **Failure handling:** Non-blocking — if SMTP fails, submission is already saved; error is logged, user sees success message
- **Config:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ADMIN_EMAIL` from `.env.local`

---

## Export

- Endpoint: `GET /api/export?format=csv|xlsx&from=YYYY-MM-DD&to=YYYY-MM-DD&status=nieuw`
- Admin-only (bearer token)
- Streamed directly to browser as file download
- Includes: all submission fields + count of attachments per submission
- Does not include file contents inline

---

## Security Measures

| Threat | Mitigation |
|---|---|
| SQL injection | `mssql` prepared statements only — no string concatenation in queries |
| XSS | `helmet` CSP headers; Alpine.js uses text binding (not innerHTML) by default |
| CSRF | Double-submit cookie pattern via `csurf` (stateless) |
| Path traversal | Upload filenames generated server-side (UUID), never from user input |
| Dangerous uploads | MIME type + extension allowlist; files never executable or directly web-accessible |
| Brute force / spam | `express-rate-limit`: 10 submissions per 15 min per IP on POST /api/submissions |
| Info leakage | Error handler returns generic messages in production; no stack traces to client |
| Secrets | All config via `.env.local`, never hardcoded; `.env.local` gitignored |
| HTTP headers | `helmet()` with default secure headers |

---

## Admin Authentication

- **Current:** Bearer token from `.env.local` (`ADMIN_TOKEN`, min 32 chars)
- **Future:** Will be replaced with DB-backed credential system (separate user table)
- Admin dashboard (`/admin`) protected by the same token sent in `Authorization` header from Alpine.js

---

## i18n

- Translation strings defined in `public/assets/i18n.js` as a plain JS object with `nl` and `fr` keys
- Alpine.js reads the active language from a top-level `lang` data property
- Language switcher updates `lang`, all labels re-render reactively
- Default language: `nl`
- Email templates: separate NL and FR versions in `mailService.js`

---

## Environment Variables (`.env.example`)

```
PORT=3004

# MS SQL Server
DB_SERVER=
DB_DATABASE=
DB_USER=
DB_PASSWORD=
DB_ENCRYPT=true

# SMTP
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
ADMIN_EMAIL=

# Admin
ADMIN_TOKEN=

# Storage
UPLOAD_DIR=./uploads
```

---

## Deployment

### Windows + IIS

- Node.js process managed by **NSSM** as a Windows service
- IIS with **Application Request Routing (ARR)** + **URL Rewrite** as reverse proxy to `http://localhost:3004`
- Upload folder outside IIS web root
- Environment variables set in NSSM service config or via a `.env.local` file
- HTTPS terminated at IIS (certificate via Windows certificate store)

### Debian + Nginx

- Node.js process managed by **systemd** unit (`terugbetaling.service`)
- **Nginx** reverse proxy to `http://127.0.0.1:3004`
- Upload folder owned by the service user, not web-accessible
- Environment variables in systemd unit `EnvironmentFile=` pointing to `.env.local`
- HTTPS via Let's Encrypt / Certbot

---

## Assumptions

1. MS SQL Server instance is reachable from the Node.js host; connection string is provided in `.env.local`
2. SMTP credentials are not needed. E-mail is non-blocking so the app works without them
3. The `uploads/` directory will be created on first run if it doesn't exist
4. The admin dashboard is an internal tool — no public registration or password reset flow needed
