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
