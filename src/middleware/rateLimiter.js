const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_SUBMISSIONS = 25;

// Key on the Easy Auth identity, not on the IP address. Behind the Container Apps
// ingress `req.ip` is the office NAT address, so everyone in the building shares a
// single counter and one colleague's submissions eat another's quota. Easy Auth sets
// X-MS-CLIENT-PRINCIPAL-NAME on every authenticated request and strips any
// client-supplied variant, so it cannot be spoofed from outside. Falls back to the
// IP when there is no Easy Auth in front (local dev, tests).
function submissionKey(req) {
  const upn = req.headers['x-ms-client-principal-name'];
  // Lowercased: Entra is case-insensitive on the UPN, so Danny.Debie@ and
  // danny.debie@ must not end up as two separate counters.
  return upn ? upn.toLowerCase() : req.ip;
}

const submitLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: MAX_SUBMISSIONS,
  keyGenerator: submissionKey,
  // Only completed submissions count. The limiter runs before validation, so
  // without this a run of typos would burn the quota and block the next — correct —
  // attempt. Note that this also means rejected requests are never throttled.
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

module.exports = { submitLimiter, submissionKey, WINDOW_MS, MAX_SUBMISSIONS };
