process.env.PORT = '3005';
// Set DEV_MODE before any module loads so dotenv (which does not override an
// existing var) cannot pull DEV_MODE=true from a developer's .env.local into the
// test run — that would trigger the dev auth bypass + in-memory data and break
// the auth/model suites. Tests needing dev mode set this themselves and restore it.
process.env.DEV_MODE = 'false';
process.env.ADMIN_TOKEN = 'test-admin-token-32chars-minimum-00';
process.env.CSRF_SECRET = 'test-csrf-secret-32-chars-min-0000';
process.env.COOKIE_SECRET = 'test-cookie-secret-32-chars-min-00';
process.env.UPLOAD_DIR = './uploads-test';
process.env.SMTP_HOST = 'localhost';
process.env.SMTP_PORT = '25';
process.env.SMTP_USER = 'test-smtp-user';
process.env.SMTP_PASS = 'test-smtp-pass';
process.env.SMTP_FROM = 'test@example.com';
process.env.ADMIN_EMAIL = 'admin@example.com';
