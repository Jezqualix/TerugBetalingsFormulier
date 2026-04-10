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
