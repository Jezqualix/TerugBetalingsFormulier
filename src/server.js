require('dotenv').config({ path: '.env.local' });
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const { generateToken } = require('./middleware/csrf');
const { getPrincipalOrDev } = require('./middleware/principal');
const submissionsRouter = require('./routes/submissions');
const adminRouter = require('./routes/admin');
const filesRouter = require('./routes/files');

const app = express();

// Trust proxy for correct IP detection behind IIS ARR / Nginx
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-eval'", 'cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'cdn.jsdelivr.net', 'fonts.gstatic.com'],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: null, // disabled: app runs over HTTP behind IIS/Nginx which handles HTTPS
      },
    },
    // Helmet's default Referrer-Policy is 'no-referrer', which strips the Referer
    // header. Azure Container Apps Easy Auth has a built-in anti-CSRF check that
    // rejects state-changing requests with an empty Referer (403, "Cross-site
    // request forgery detected ... from referer ''"). 'same-origin' sends the
    // Referer on same-origin requests (never cross-origin), satisfying that check
    // while the app's own csrf-csrf double-submit protection stays in force.
    referrerPolicy: { policy: 'same-origin' },
  })
);

app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-cookie-secret'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Liveness endpoint — no DB ping, so a brief SQL hiccup does not kill the container.
// Excluded from Easy Auth so it stays reachable without a token.
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

// CSRF token endpoint (must come before static files so it's served as API)
app.get('/api/csrf-token', (req, res) => {
  res.json({ token: generateToken(req, res) });
});

// Signed-in user, for pre-filling the requester fields on the form. Easy Auth already
// guards every route, so no extra auth check here. Responds {} when there is no
// identity (local dev without Easy Auth) — the form then just stays empty.
app.get('/api/me', (req, res) => {
  res.json(getPrincipalOrDev(req) || {});
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
  if (err.message === 'invalid csrf token') {
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
