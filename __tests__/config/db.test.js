// __tests__/config/db.test.js
const { qualify, schemaName } = require('../../src/config/db');

describe('schemaName', () => {
  const original = process.env.DB_SCHEMA;
  afterEach(() => {
    if (original === undefined) delete process.env.DB_SCHEMA;
    else process.env.DB_SCHEMA = original;
  });

  it('defaults to dbo so the legacy database keeps working without the new env var', () => {
    delete process.env.DB_SCHEMA;
    expect(schemaName()).toBe('dbo');
  });

  it('returns the configured schema', () => {
    process.env.DB_SCHEMA = 'tbf';
    expect(schemaName()).toBe('tbf');
  });

  // The schema is interpolated into SQL because T-SQL cannot parameterise an
  // object name, so the validation is the only thing standing between an env
  // var and arbitrary SQL. Each case below is a way out of an identifier.
  it.each([
    ['tbf; DROP TABLE submissions --', 'statement terminator'],
    ['tbf]', 'closing bracket, would escape the brackets qualify adds'],
    ['dbo.tbf', 'a dot, which would let one env var pick another schema'],
    ['tbf schema', 'a space'],
    ['1tbf', 'a leading digit'],
    ['', 'empty, once explicitly set'],
  ])('rejects %s (%s)', (value) => {
    process.env.DB_SCHEMA = value;
    if (value === '') {
      // An empty string is falsy, so it falls back to the default rather than
      // reaching the validator. Pinned so a future refactor cannot make an
      // empty DB_SCHEMA mean "no schema" and silently produce [].[table].
      expect(schemaName()).toBe('dbo');
      return;
    }
    expect(() => schemaName()).toThrow(/not a plain identifier/);
  });
});

describe('qualify', () => {
  const original = process.env.DB_SCHEMA;
  afterEach(() => {
    if (original === undefined) delete process.env.DB_SCHEMA;
    else process.env.DB_SCHEMA = original;
  });

  it('brackets both parts', () => {
    process.env.DB_SCHEMA = 'tbf';
    expect(qualify('submissions')).toBe('[tbf].[submissions]');
    expect(qualify('uploads')).toBe('[tbf].[uploads]');
  });

  it('follows the env var at call time, not at import time', () => {
    process.env.DB_SCHEMA = 'dbo';
    expect(qualify('submissions')).toBe('[dbo].[submissions]');
    process.env.DB_SCHEMA = 'tbf';
    expect(qualify('submissions')).toBe('[tbf].[submissions]');
  });
});
