// __tests__/services/mailService.test.js
jest.mock('nodemailer');

const nodemailer = require('nodemailer');
const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'test' });
nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

const { sendAdminNotification, sendUserConfirmation, templates } = require('../../src/services/mailService');

describe('templates', () => {
  it('has nl and fr admin templates', () => {
    expect(templates.admin.nl.subject).toContain('{{id}}');
    expect(templates.admin.fr.subject).toContain('{{id}}');
  });

  it('nl admin body includes submission data', () => {
    const body = templates.admin.nl.body({ submissionId: 5, naam_aanvrager: 'Jan', email_aanvrager: 'jan@test.com', type_betaling: 'dringend' });
    expect(body).toContain('Jan');
    expect(body).toContain('5');
  });

  it('fr user body includes recipient name', () => {
    const body = templates.user.fr.body({ naam: 'Pierre' });
    expect(body).toContain('Pierre');
  });
});

describe('sendAdminNotification', () => {
  it('calls sendMail with admin email and correct subject', async () => {
    await sendAdminNotification({ submissionId: 7, naam_aanvrager: 'Test', email_aanvrager: 'test@test.com', type_betaling: 'korting', lang: 'nl' });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: process.env.ADMIN_EMAIL,
        subject: expect.stringContaining('7'),
      })
    );
  });
});

describe('sendUserConfirmation', () => {
  it('calls sendMail with user email', async () => {
    sendMailMock.mockClear();
    await sendUserConfirmation({ to: 'user@test.com', naam: 'User', lang: 'fr' });
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'user@test.com' })
    );
  });
});

describe('transport configuration', () => {
  it('configures smtp2go auth from env and does not set ignoreTLS', () => {
    const config = nodemailer.createTransport.mock.calls[0][0];
    expect(config.host).toBe(process.env.SMTP_HOST);
    expect(config.port).toBe(parseInt(process.env.SMTP_PORT, 10));
    expect(config.auth).toEqual({
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    });
    expect(config.ignoreTLS).toBeUndefined();
  });
});
