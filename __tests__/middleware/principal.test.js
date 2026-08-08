// __tests__/middleware/principal.test.js
const { getPrincipal, claimsFromPrincipalHeader } = require('../../src/middleware/principal');

const encode = (claims) => Buffer.from(JSON.stringify({ auth_typ: 'aad', claims })).toString('base64');
const reqWith = (headers) => ({ headers });

describe('claimsFromPrincipalHeader', () => {
  it('returns [] when the header is absent', () => {
    expect(claimsFromPrincipalHeader(reqWith({}))).toEqual([]);
  });

  it('returns [] for a malformed (non-base64-JSON) header instead of throwing', () => {
    expect(claimsFromPrincipalHeader(reqWith({ 'x-ms-client-principal': 'not-base64!!' }))).toEqual([]);
  });

  it('returns [] when the decoded payload has no claims array', () => {
    const raw = Buffer.from(JSON.stringify({ auth_typ: 'aad' })).toString('base64');
    expect(claimsFromPrincipalHeader(reqWith({ 'x-ms-client-principal': raw }))).toEqual([]);
  });
});

describe('getPrincipal', () => {
  it('reads name and email from v2 claim names', () => {
    const raw = encode([
      { typ: 'name', val: 'Danny De bie' },
      { typ: 'preferred_username', val: 'danny.debie@dockx-group.be' },
    ]);
    expect(getPrincipal(reqWith({ 'x-ms-client-principal': raw }))).toEqual({
      name: 'Danny De bie',
      email: 'danny.debie@dockx-group.be',
    });
  });

  it('reads name and email from v1 schema-URI claim names', () => {
    const raw = encode([
      { typ: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name', val: 'Danny De bie' },
      { typ: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress', val: 'danny.debie@dockx-group.be' },
    ]);
    expect(getPrincipal(reqWith({ 'x-ms-client-principal': raw }))).toEqual({
      name: 'Danny De bie',
      email: 'danny.debie@dockx-group.be',
    });
  });

  it('falls back to the UPN header when the claims carry no email', () => {
    const raw = encode([{ typ: 'name', val: 'Danny De bie' }]);
    expect(
      getPrincipal(reqWith({ 'x-ms-client-principal': raw, 'x-ms-client-principal-name': 'danny.debie@dockx-group.be' }))
    ).toEqual({ name: 'Danny De bie', email: 'danny.debie@dockx-group.be' });
  });

  it('uses the email as name when no name claim is present', () => {
    expect(getPrincipal(reqWith({ 'x-ms-client-principal-name': 'danny.debie@dockx-group.be' }))).toEqual({
      name: 'danny.debie@dockx-group.be',
      email: 'danny.debie@dockx-group.be',
    });
  });

  it('returns null without Easy Auth headers', () => {
    expect(getPrincipal(reqWith({}))).toBeNull();
  });

  it('returns null when a malformed header leaves nothing usable', () => {
    expect(getPrincipal(reqWith({ 'x-ms-client-principal': '%%%' }))).toBeNull();
  });
});
