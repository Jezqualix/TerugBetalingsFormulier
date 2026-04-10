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

app.use(helmet());
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev-cookie-secret'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/api/csrf-token', (req, res) => {
  res.json({ token: generateToken(req, res) });
});

app.use('/api/submissions', submissionsRouter);
app.use('/api', adminRouter);
app.use('/api', filesRouter);

// Error handler
app.use((err, req, res, next) => {
  if (err.message === 'invalid csrf token') {
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
