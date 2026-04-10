// __tests__/middleware/upload.test.js
const { ALLOWED_MIMES, ALLOWED_EXTS } = require('../../src/middleware/upload');

describe('ALLOWED_MIMES', () => {
  it('allows PDF', () => expect(ALLOWED_MIMES.has('application/pdf')).toBe(true));
  it('allows JPEG', () => expect(ALLOWED_MIMES.has('image/jpeg')).toBe(true));
  it('allows DOCX', () => expect(ALLOWED_MIMES.has('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true));
  it('allows XLSX', () => expect(ALLOWED_MIMES.has('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true));
  it('allows ZIP', () => expect(ALLOWED_MIMES.has('application/zip')).toBe(true));
  it('rejects exe', () => expect(ALLOWED_MIMES.has('application/x-msdownload')).toBe(false));
  it('rejects octet-stream', () => expect(ALLOWED_MIMES.has('application/octet-stream')).toBe(false));
  it('rejects PHP', () => expect(ALLOWED_MIMES.has('application/x-httpd-php')).toBe(false));
});

describe('ALLOWED_EXTS', () => {
  it('allows .pdf', () => expect(ALLOWED_EXTS.has('.pdf')).toBe(true));
  it('allows .jpg', () => expect(ALLOWED_EXTS.has('.jpg')).toBe(true));
  it('allows .docx', () => expect(ALLOWED_EXTS.has('.docx')).toBe(true));
  it('rejects .exe', () => expect(ALLOWED_EXTS.has('.exe')).toBe(false));
  it('rejects .php', () => expect(ALLOWED_EXTS.has('.php')).toBe(false));
  it('rejects .sh', () => expect(ALLOWED_EXTS.has('.sh')).toBe(false));
  it('rejects .bat', () => expect(ALLOWED_EXTS.has('.bat')).toBe(false));
});
