const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '2525', 10),
  secure: false, // 2525/587 → STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const templates = {
  admin: {
    nl: {
      subject: 'Nieuwe terugbetalingsaanvraag #{{id}}',
      body: ({ submissionId, naam_aanvrager, email_aanvrager, type_betaling }) =>
        `Nieuwe terugbetalingsaanvraag ontvangen.\n\nID: ${submissionId}\nNaam aanvrager: ${naam_aanvrager}\nE-mail aanvrager: ${email_aanvrager}\nType betaling: ${type_betaling}\n\nBekijk alle aanvragen in het adminpaneel.`,
    },
    fr: {
      subject: 'Nouvelle demande de remboursement #{{id}}',
      body: ({ submissionId, naam_aanvrager, email_aanvrager, type_betaling }) =>
        `Nouvelle demande de remboursement reçue.\n\nID: ${submissionId}\nNom du demandeur: ${naam_aanvrager}\nE-mail: ${email_aanvrager}\nType de paiement: ${type_betaling}\n\nConsultez toutes les demandes dans le panneau d'administration.`,
    },
  },
  user: {
    nl: {
      subject: 'Bevestiging van uw terugbetalingsaanvraag',
      body: ({ naam }) =>
        `Beste ${naam},\n\nUw terugbetalingsaanvraag is succesvol ontvangen. We nemen zo snel mogelijk contact met u op.\n\nMet vriendelijke groeten,\nDockX Rental`,
    },
    fr: {
      subject: 'Confirmation de votre demande de remboursement',
      body: ({ naam }) =>
        `Cher(e) ${naam},\n\nVotre demande de remboursement a bien été reçue. Nous vous contacterons dans les plus brefs délais.\n\nCordialement,\nDockX Rental`,
    },
  },
};

async function sendAdminNotification({ submissionId, naam_aanvrager, email_aanvrager, type_betaling, lang = 'nl' }) {
  const tmpl = templates.admin[lang] || templates.admin.nl;
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: process.env.ADMIN_EMAIL,
    replyTo: email_aanvrager,
    subject: tmpl.subject.replace('{{id}}', submissionId),
    text: tmpl.body({ submissionId, naam_aanvrager, email_aanvrager, type_betaling }),
  });
}

async function sendUserConfirmation({ to, naam, lang = 'nl' }) {
  const tmpl = templates.user[lang] || templates.user.nl;
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: tmpl.subject,
    text: tmpl.body({ naam }),
  });
}

module.exports = { sendAdminNotification, sendUserConfirmation, templates };
