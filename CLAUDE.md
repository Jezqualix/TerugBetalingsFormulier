# TerugBetalingsFormulier

## Quick Start
1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in values
3. Run all migrations in order against your MS SQL Server instance:
   - `migrations/001_initial.sql` — base tables
   - `migrations/002_type_specific_fields.sql` — type-specific columns
   - `migrations/003_onkosten_proplanner.sql` — onkosten items + proplanner checkbox
4. `npm run dev` (development) or `npm start` (production)
5. Open http://localhost:3004

## Local layout/dev mode (no DB, no auth)
For viewing/tweaking the UI without setting up SQL Server, Entra or SMTP:
1. `npm install`
2. Set `DEV_MODE=true` in `.env.local` (copy from `.env.example`) — nothing else required.
3. `npm run dev` → http://localhost:3004

With `DEV_MODE=true` (and `NODE_ENV` not `production`) the model layer serves
in-memory demo data (`src/dev/devStore.js`) and `requireAdmin` is bypassed, so
the admin dashboard renders fully with sample rows, uploads, export and status
toggling — all mutations reset on restart. Hard-gated: it can never activate in
Azure, where `NODE_ENV=production`. File downloads 404 (seed files aren't on disk).

## Architecture
Single Express process on port 3004. Serves static frontend + REST API from the same process.

```
Browser
  └── GET /              → public/index.html  (form, NL/FR)
  └── GET /admin         → public/admin.html  (admin dashboard)
  └── POST /api/submissions       → submit form + file(s)
  └── GET  /api/submissions       → list submissions (admin only)
  └── GET  /api/export            → download CSV or XLSX (admin only)
  └── GET  /api/uploads/:file     → download uploaded file (admin only)
  └── GET  /api/csrf-token        → CSRF token endpoint
```

## Testing
`npm test` — 44 tests, 8 suites, all passing.

## Key Directories
- `src/` — Backend source
- `public/` — Static frontend (served by Express)
- `public/assets/` — style.css, i18n.js, form.js, admin.js
- `uploads/` — Uploaded files (gitignored, never web-accessible directly)
- `migrations/` — SQL DDL files
- `docs/superpowers/specs/` — Design spec
- `docs/superpowers/plans/` — Implementation plan
- `docs/deploy-iis.md` — Windows/IIS deployment guide
- `docs/deploy-nginx.md` — Debian/Nginx deployment guide

## Admin Dashboard
Access at `/admin`. Enter your `ADMIN_TOKEN` from `.env.local`.

## Deployment
- Windows/IIS: NSSM service + IIS ARR reverse proxy. See `docs/deploy-iis.md`.
- Debian/Nginx: systemd unit + Nginx reverse proxy. See `docs/deploy-nginx.md`.
- App runs on port 3004, binds to all interfaces (0.0.0.0).

---

## Implementation Status: COMPLETE

All 17 tasks from the implementation plan have been implemented, reviewed (spec + quality), and committed. Final state: 44/44 tests passing.

### What was built (task summary)

| Task | Description | Key files |
|---|---|---|
| 1 | Project scaffold, package.json, .env.example | `package.json`, `.env.example` |
| 2 | DB config + migration | `src/config/db.js`, `migrations/001_initial.sql` |
| 3 | CSRF middleware (csrf-csrf) | `src/middleware/csrf.js` |
| 4 | Auth middleware (bearer token) | `src/middleware/auth.js` |
| 5 | Upload middleware (multer) | `src/middleware/upload.js` |
| 6 | Rate limiter | `src/middleware/rateLimiter.js` |
| 7 | Submission model | `src/models/submission.js` |
| 8 | Mail service (nodemailer) | `src/services/mailService.js` |
| 9 | Export service (fast-csv, exceljs) | `src/services/exportService.js` |
| 10 | Submissions route POST | `src/routes/submissions.js` |
| 11 | Admin routes GET | `src/routes/admin.js` |
| 12 | Files route | `src/routes/files.js` |
| 13 | Express server entry point | `src/server.js` |
| 14 | i18n strings + CSS | `public/assets/i18n.js`, `public/assets/style.css` |
| 15 | Form page | `public/index.html`, `public/assets/form.js` |
| 16 | Admin dashboard | `public/admin.html`, `public/assets/admin.js` |
| 17 | Deployment docs | `docs/deploy-iis.md`, `docs/deploy-nginx.md` |

### Key technical decisions & non-obvious patterns

**DB (`src/config/db.js`):**
- Promise-caching lazy pool: `if (!poolPromise) poolPromise = sql.connect().catch(err => { poolPromise = null; throw err; })` — avoids race condition.

**Auth (`src/middleware/auth.js`):**
- `crypto.timingSafeEqual()` with length pre-check — prevents timing attacks on bearer token comparison.

**CSRF (`src/middleware/csrf.js`):**
- Uses `csrf-csrf` (double-submit cookie). Token fetched from `/api/csrf-token`, sent as `x-csrf-token` header.
- Error check: `err.message === 'invalid csrf token'` (NOT `err.code === 'EBADCSRFTOKEN'` — that's the old `csurf` package).

**Upload (`src/middleware/upload.js`):**
- MIME + extension dual allowlist (OR logic = reject if either fails).
- Multer wrapped in error-catching callback in the route: `upload.array()(req, res, err => { if (err) return res.status(422)... })`.

**Export (`src/services/exportService.js`):**
- CSV uses `stream.pipeline()` not `.pipe()` — handles client disconnect without crashing process. Ignores `ERR_STREAM_DESTROYED`.

**Admin route (`src/routes/admin.js`):**
- NaN guard for pagination: `toInt(val, fallback)` using `Number.isFinite(n) && n > 0`.
- Two separate `pool.request()` objects for count + data queries — avoids mssql parameter reuse error.

**Files route (`src/routes/files.js`):**
- Deterministic path traversal check: `if (filename !== path.basename(raw)) return res.status(400)` — runs before any filesystem access.

**Server (`src/server.js`):**
- `app.set('trust proxy', 1)` — required for correct `req.ip` behind IIS ARR / Nginx.
- Static files served AFTER API routes to prevent shadowing.
- Helmet CSP: `upgradeInsecureRequests: null` — disabled because app runs over HTTP behind a reverse proxy. Without this, browsers running over HTTP would try to upgrade asset requests to HTTPS and fail.
- Helmet CSP allows: `cdn.jsdelivr.net` (Alpine.js), `fonts.googleapis.com` + `fonts.gstatic.com` (Inter font).
- Helmet CSP: `'unsafe-eval'` in `scriptSrc` — required because Alpine.js v3 uses `new Function()` to evaluate expressions. Without it, all `x-text`/`x-show`/`x-data` bindings silently fail.

**Frontend:**
- Alpine.js loaded from CDN (`@3`). `formApp()` in `public/assets/form.js`, `adminApp()` in `public/assets/admin.js` — kept as external files, NOT inline scripts (inline scripts are blocked by CSP `script-src 'self'`).
- All text bindings use `x-text` (never `x-html`) — XSS safe.
- Admin stores token in `localStorage`, clears `tokenInput` immediately after login.
- Export uses `fetch()` + `Authorization` header + `URL.createObjectURL(blob)`.

**Mail (`src/services/mailService.js`):**
- nodemailer with no `auth` object — IP-based SMTP authentication.
- Non-blocking: email errors are logged but do not fail the submission response.

### Known deployment gotchas

**CSP + HTTP:** When running behind a reverse proxy over HTTP, Helmet's default `upgrade-insecure-requests` CSP directive causes browsers to upgrade asset requests to HTTPS, which fails. Fix: `upgradeInsecureRequests: null` in `src/server.js`.

**CSP + Alpine.js:** Alpine.js v3 requires `'unsafe-eval'` in CSP `script-src`. Without it, Alpine loads but can't evaluate any expressions — form appears with no text and both show/hide states visible. Fix: `scriptSrc: ["'self'", "'unsafe-eval'", 'cdn.jsdelivr.net']`.

**DB connection + self-signed cert:** Internal SQL Server instances (e.g. SQLEXPRESS on `vw-2025-dev-1`) use self-signed certs. Set `DB_TRUST_CERT=true` in `.env.local`, otherwise login fails with misleading "Login failed for user" error (the TLS handshake for the login packet fails, not the credentials).

---

## Frontend file structure
```
public/
  index.html          ← form page (Alpine x-data="formApp()")
  admin.html          ← admin dashboard (Alpine x-data="adminApp()")
  assets/
    style.css         ← Dockx brand design system (Inter font, brand-900 header, accent yellow)
    i18n.js           ← window.i18n with nl + fr keys
    form.js           ← formApp() Alpine component (external, not inline)
    admin.js          ← adminApp() Alpine component (external, not inline)
```

## Design System (Dockx brand)
Header: `background: #003012` (brand-900), `border-bottom: 3px solid #ffdd00` (accent yellow).
Logo: "DOCK" white + "X" yellow + "RENTAL" faded uppercase.
Primary button (submit): yellow `#ffdd00` background, dark-green bold text.
Cards: white, `border-top: 4px solid #007c30`, 12px radius, subtle shadow, max-width 900px.
Table header: `background: #007c30` (brand-600), white text.
Font: Inter from Google Fonts.
Radio buttons: simple inline style (no card borders).

---

## Session 2 changes (2026-04-10/11)

### Bugs fixed
- **CSP `unsafe-eval`**: Added `'unsafe-eval'` to helmet `scriptSrc` so Alpine.js can evaluate expressions (`src/server.js`).
- **DB login error**: `DB_TRUST_CERT=true` needed for internal SQLEXPRESS with self-signed cert.

### 5 payment types with dynamic detail sections
Changed from 4 types (onkostennota, dringend, korting, andere) to 5:

| Type | Detail section fields |
|---|---|
| `onkostennota` | Dynamic expense items table: datum (date picker), omschrijving, bedrag. Add/remove rows. Stored as JSON in `onkosten_items` column. |
| `dringend` | Reden van urgentie*, Contract, Klant, "Reeds aangevraagd in ProPlanner" checkbox (`proplanner_aangevraagd` BIT column). |
| `brandstof` | Contract, Klant |
| `boete` | Referentie Boete*, Vervaldatum Boete* (date picker) |
| `andere` | Gedetailleerde omschrijving* |

### DB migrations added
- `migrations/002_type_specific_fields.sql` — adds `reden_urgentie`, `contract`, `klant`, `referentie_boete`, `vervaldatum_boete`, `gedetailleerde_omschrijving` columns.
- `migrations/003_onkosten_proplanner.sql` — adds `onkosten_items` (NVARCHAR(MAX) JSON), `proplanner_aangevraagd` (BIT).

### Other changes
- **Label rename**: "Naam terugstorting" → "Naam begunstigde" / "Nom du bénéficiaire".
- **IBAN validation**: Client-side ISO 13616 mod-97 check (optional field, validates only when filled).
- **Form wider**: max-width 720px → 900px.
- **Radio buttons**: removed card-style borders, now simple inline radio options.
- **Date fields**: native `<input type="date">` with browser date picker.
- **All i18n keys**: added for both NL and FR for all new fields.
- **Export service**: includes all new columns.
- **Server-side validation**: type-specific required field checks added to `src/routes/submissions.js`.

## Deployment (Azure Container Apps)
Web-service op het gedeelde RG_AI-platform (cae-ai/dockxaiacr/kv-dockx-ai), achter Entra Easy Auth,
met Azure SQL (dockxazsql1 → TerugBetalingsFormulier_DB), Azure Files voor uploads en smtp2go voor mail.
Handmatige deploy via `az acr build` (hier) + `az deployment group create` (in de IaC-repo).
De Bicep staat in een **aparte repo**: `D:\DEVELOPMENT\BICEP` — zie
`BICEP/workloads/terugbetalingsformulier/README.md` (recept) en `BICEP/docs/HANDLEIDING.md` (NL gids).
Dit project heeft geen `infra/`-map meer. Ontwerp: `docs/superpowers/specs/2026-07-23-azure-container-apps-design.md`.
