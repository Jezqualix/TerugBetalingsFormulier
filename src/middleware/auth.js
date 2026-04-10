const crypto = require('crypto');

function requireAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);
  if (!process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(process.env.ADMIN_TOKEN);
  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireAdminToken };
