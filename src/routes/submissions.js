const express = require('express');
const router = express.Router();
const fs = require('fs');

const { doubleCsrfProtection } = require('../middleware/csrf');
const { submitLimiter } = require('../middleware/rateLimiter');
const { upload } = require('../middleware/upload');
const { createSubmission, createUploadRecord } = require('../models/submission');
const { sendAdminNotification, sendUserConfirmation } = require('../services/mailService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_TYPES = new Set(['onkostennota', 'dringend', 'brandstof', 'boete', 'andere']);

// Ensure upload dir exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

router.post(
  '/',
  submitLimiter,
  doubleCsrfProtection,
  (req, res, next) => {
    upload.array('bijlagen', 10)(req, res, (err) => {
      if (err) {
        return res.status(422).json({ errors: { bijlagen: err.message } });
      }
      next();
    });
  },
  async (req, res) => {
    const { aanvraagnummer, naam_aanvrager, email_aanvrager, type_betaling,
            naam_terugstorting, iban, omschrijving, taal,
            reden_urgentie, contract, klant,
            referentie_boete, vervaldatum_boete,
            gedetailleerde_omschrijving,
            onkosten_items, proplanner_aangevraagd } = req.body;

    const errors = {};
    if (!naam_aanvrager?.trim())                                      errors.naam_aanvrager = 'Verplicht';
    if (!email_aanvrager?.trim() || !EMAIL_RE.test(email_aanvrager)) errors.email_aanvrager = 'Geldig e-mailadres vereist';
    if (!type_betaling || !VALID_TYPES.has(type_betaling))           errors.type_betaling = 'Verplicht';
    if (!naam_terugstorting?.trim())                                  errors.naam_terugstorting = 'Verplicht';

    // Type-specific validation
    if (type_betaling === 'onkostennota') {
      try {
        const items = JSON.parse(onkosten_items || '[]');
        if (!Array.isArray(items) || items.length === 0) errors.onkosten_items = 'Verplicht';
        else if (items.some(it => !it.datum || !it.omschrijving?.trim() || !it.bedrag?.toString().trim()))
          errors.onkosten_items = 'Verplicht';
      } catch { errors.onkosten_items = 'Verplicht'; }
    }
    if (type_betaling === 'dringend' && !reden_urgentie?.trim())     errors.reden_urgentie = 'Verplicht';
    if (type_betaling === 'boete') {
      if (!referentie_boete?.trim())                                  errors.referentie_boete = 'Verplicht';
      if (!vervaldatum_boete)                                         errors.vervaldatum_boete = 'Verplicht';
    }
    if (type_betaling === 'andere' && !gedetailleerde_omschrijving?.trim()) errors.gedetailleerde_omschrijving = 'Verplicht';

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({ errors });
    }

    try {
      const lang = taal === 'fr' ? 'fr' : 'nl';
      const submissionId = await createSubmission({
        aanvraagnummer: aanvraagnummer?.trim() || null,
        naam_aanvrager: naam_aanvrager.trim(),
        email_aanvrager: email_aanvrager.trim().toLowerCase(),
        type_betaling,
        naam_terugstorting: naam_terugstorting.trim(),
        iban: iban?.trim() || null,
        omschrijving: omschrijving?.trim() || null,
        taal: lang,
        reden_urgentie: reden_urgentie?.trim() || null,
        contract: contract?.trim() || null,
        klant: klant?.trim() || null,
        referentie_boete: referentie_boete?.trim() || null,
        vervaldatum_boete: vervaldatum_boete || null,
        gedetailleerde_omschrijving: gedetailleerde_omschrijving?.trim() || null,
        onkosten_items: type_betaling === 'onkostennota' ? onkosten_items : null,
        proplanner_aangevraagd: proplanner_aangevraagd === 'true',
      });

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          await createUploadRecord({
            submission_id: submissionId,
            original_name: file.originalname,
            stored_name: file.filename,
            mime_type: file.mimetype,
            size_bytes: file.size,
          });
        }
      }

      // Non-blocking email
      sendAdminNotification({ submissionId, naam_aanvrager: naam_aanvrager.trim(), email_aanvrager, type_betaling, lang })
        .catch((err) => console.error('Admin mail failed:', err.message));
      sendUserConfirmation({ to: email_aanvrager.trim(), naam: naam_aanvrager.trim(), lang })
        .catch((err) => console.error('User mail failed:', err.message));

      res.status(201).json({ success: true, id: submissionId });
    } catch (err) {
      console.error('Submission error:', err.message);
      res.status(500).json({ error: 'Er is een fout opgetreden' });
    }
  }
);

module.exports = router;
