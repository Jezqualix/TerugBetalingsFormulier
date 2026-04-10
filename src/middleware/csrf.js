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
