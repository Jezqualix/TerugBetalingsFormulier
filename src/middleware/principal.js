// Identity injected by Azure Container Apps Easy Auth.
//
// Easy Auth sets X-MS-CLIENT-PRINCIPAL (base64 JSON with the token's claims) and
// X-MS-CLIENT-PRINCIPAL-NAME (UPN) on every authenticated request, and strips any
// client-supplied variants — so these headers are trusted as long as the container
// is only reachable behind Easy Auth.
//
// Used to pre-fill the requester fields on the form (see GET /api/me). The values
// stay editable client-side, so this is a convenience, not an authorization source.

const { isDevMode } = require('../dev/devStore');

// v2 tokens carry short claim names; v1 tokens are mapped to the schema URIs.
const NAME_CLAIMS = [
  'name',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
];
const EMAIL_CLAIMS = [
  'preferred_username',
  'email',
  'upn',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn',
];

// Returns [] if the header is absent or malformed (never throws).
function claimsFromPrincipalHeader(req) {
  const raw = req.headers['x-ms-client-principal'];
  if (!raw) return [];
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return Array.isArray(decoded.claims) ? decoded.claims : [];
  } catch {
    return [];
  }
}

// { name, email } for the signed-in user, or null when not behind Easy Auth.
// The -NAME header is the fallback for both fields: it holds the UPN, which for
// Dockx accounts is the mail address.
function getPrincipal(req) {
  const claims = claimsFromPrincipalHeader(req);
  const pick = (types) => {
    const hit = claims.find((c) => types.includes(c.typ) && c.val);
    return hit ? hit.val : null;
  };
  const upn = req.headers['x-ms-client-principal-name'] || null;
  const email = pick(EMAIL_CLAIMS) || upn;
  const name = pick(NAME_CLAIMS) || email;
  if (!name && !email) return null;
  return { name, email };
}

// Dev-mode stand-in so the pre-fill is visible on `npm run dev` (no Easy Auth locally).
const DEV_PRINCIPAL = { name: 'Dev Gebruiker', email: 'dev.gebruiker@dockx-group.be' };

function getPrincipalOrDev(req) {
  return getPrincipal(req) || (isDevMode() ? DEV_PRINCIPAL : null);
}

module.exports = { claimsFromPrincipalHeader, getPrincipal, getPrincipalOrDev };
