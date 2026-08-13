const crypto = require('crypto');
const { isDevMode } = require('../dev/devStore');
const { claimsFromPrincipalHeader } = require('./principal');

function tokenValid(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  if (!process.env.ADMIN_TOKEN) return false;
  const tokenBuf = Buffer.from(authHeader.slice(7));
  const secretBuf = Buffer.from(process.env.ADMIN_TOKEN);
  return tokenBuf.length === secretBuf.length && crypto.timingSafeEqual(tokenBuf, secretBuf);
}

// Roles injected by Azure Container Apps Easy Auth via the (trusted, non-spoofable)
// X-MS-CLIENT-PRINCIPAL header. Returns [] if absent or malformed.
function rolesFromPrincipalHeader(req) {
  return claimsFromPrincipalHeader(req)
    .filter((c) => c.typ === 'roles' || c.typ === 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role')
    .map((c) => c.val);
}

function hasAdminRole(req) {
  const adminRole = process.env.ADMIN_ROLE || 'Admin';
  return rolesFromPrincipalHeader(req).includes(adminRole);
}

function requireAdmin(req, res, next) {
  if (isDevMode()) return next(); // local layout/dev only (NODE_ENV !== production)
  if (tokenValid(req)) return next(); // break-glass / non-interactive
  if (hasAdminRole(req)) return next();
  // Authenticated via Easy Auth but missing the role → 403; otherwise unauthenticated → 401.
  if (req.headers['x-ms-client-principal']) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { requireAdmin, rolesFromPrincipalHeader, hasAdminRole };
