require('dotenv').config({ path: '.env.local' });
const nodemailer = require('nodemailer');

(async () => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '25', 10),
    secure: false,
    ignoreTLS: true,
  });

  console.log('SMTP config:');
  console.log('  host:', process.env.SMTP_HOST);
  console.log('  port:', process.env.SMTP_PORT);
  console.log('  from:', process.env.SMTP_FROM);

  try {
    console.log('\nVerifying SMTP connection...');
    await transporter.verify();
    console.log('  OK — server accepts connections');
  } catch (err) {
    console.error('  FAIL — verify error:', err.message);
    process.exit(1);
  }

  const to = 'danny.debie@dockx.be';
  try {
    console.log(`\nSending test mail to ${to}...`);
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: '[TEST] TerugBetalingsFormulier — SMTP test',
      text:
        'Dit is een testmail vanuit de TerugBetalingsFormulier applicatie.\n\n' +
        'Als u deze mail ontvangt, werkt de SMTP-relay vanuit de server correct.\n\n' +
        'Tijdstip: ' + new Date().toISOString() + '\n' +
        'Host: ' + require('os').hostname() + '\n',
    });
    console.log('  OK — messageId:', info.messageId);
    console.log('  response:', info.response);
    console.log('  accepted:', info.accepted);
    console.log('  rejected:', info.rejected);
  } catch (err) {
    console.error('  FAIL — send error:', err.message);
    process.exit(2);
  }
})();
