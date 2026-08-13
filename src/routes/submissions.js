const express = require('express');
const router = express.Router();
const fs = require('fs');

const { doubleCsrfProtection } = require('../middleware/csrf');
const { submitLimiter } = require('../middleware/rateLimiter');
const { upload } = require('../middleware/upload');
const { createSubmissionWithUploads } = require('../models/submission');
const { sendAdminNotification, sendUserConfirmation } = require('../services/mailService');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_TYPES = new Set(['onkostennota', 'dringend', 'brandstof', 'boete', 'andere']);

// Column widths from migrations/001_initial.sql and 002_type_specific_fields.sql.
// Without these checks MS SQL rejects the INSERT with "String or binary data would
// be truncated", which reaches the user as a blank 500 instead of a field error.
const MAX_LENGTHS = {
  aanvraagnummer: 100,
  naam_aanvrager: 255,
  email_aanvrager: 255,
  naam_terugstorting: 255,
  iban: 34,
  referentie_boete: 255,
};
const MAX_FILENAME = 255; // uploads.original_name

// Which detail fields belong to which payment type. The form submits its whole state,
// so someone who fills in "dringende terugstorting", changes their mind and picks
// "boete" used to send the urgency fields along — and they were stored on the boete
// row, where they also turned up in the admin list and the export. Anything outside
// this list is dropped, the way onkosten_items always was.
const TYPE_FIELDS = {
  onkostennota: ['onkosten_items'],
  dringend:     ['reden_urgentie', 'contract', 'klant', 'proplanner_aangevraagd'],
  brandstof:    ['contract', 'klant'],
  boete:        ['referentie_boete', 'vervaldatum_boete'],
  andere:       ['gedetailleerde_omschrijving'],
};

// A field sent twice arrives as an array (multipart allows repeats). Every string
// method below would throw on that, and a throw here used to take the whole process
// down: this validation runs before the DB call, and an unhandled rejection in an
// async Express 4 handler exits Node. Collapsing to the first value keeps the request
// a normal 422 instead.
function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

// IBAN goes into the database in the ISO 13616 electronic format: no separators,
// upper case. People paste it both grouped ("BE68 5390 0754 7034") and plain
// ("BE68539007547034"), which stored the same account under two different strings
// — no way to match on it, and inconsistent exports. Normalising here (not only in
// the browser) covers every client. Note \s also matches the non-breaking space
// that Word and Excel like to paste.
function normalizeIban(raw) {
  return (raw || '').replace(/\s/g, '').toUpperCase() || null;
}

// A date must survive the round trip. `new Date('2026-02-30')` silently rolls over
// to 2 March, so without this check a mistyped date is stored as a different, plausible
// looking one.
function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Files are written to disk by multer before this handler runs, so every path that
// does not create a submission has to remove them again — otherwise a rejected form
// leaves an upload nobody can reach or trace.
function discardFiles(files) {
  for (const file of files || []) {
    fs.unlink(file.path, (err) => {
      if (err) console.error('Could not remove rejected upload:', err.message);
    });
  }
}

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
    try {
      const aanvraagnummer     = first(req.body.aanvraagnummer);
      const naam_aanvrager     = first(req.body.naam_aanvrager);
      const email_aanvrager    = first(req.body.email_aanvrager);
      const type_betaling      = first(req.body.type_betaling);
      const naam_terugstorting = first(req.body.naam_terugstorting);
      const iban               = first(req.body.iban);
      const omschrijving       = first(req.body.omschrijving);
      const taal               = first(req.body.taal);
      const reden_urgentie     = first(req.body.reden_urgentie);
      const contract           = first(req.body.contract);
      const klant              = first(req.body.klant);
      const referentie_boete   = first(req.body.referentie_boete);
      const vervaldatum_boete  = first(req.body.vervaldatum_boete);
      const gedetailleerde_omschrijving = first(req.body.gedetailleerde_omschrijving);
      const onkosten_items     = first(req.body.onkosten_items);
      const proplanner_aangevraagd = first(req.body.proplanner_aangevraagd);

      const errors = {};

      // Trim before validating, not only before storing: an address pasted from
      // Outlook carries a trailing space, and the regex rejects whitespace.
      const naamAanvrager     = (naam_aanvrager ?? '').trim();
      const emailAanvrager    = (email_aanvrager ?? '').trim();
      const naamTerugstorting = (naam_terugstorting ?? '').trim();
      const ibanNormalized    = normalizeIban(iban);

      if (!naamAanvrager)                                     errors.naam_aanvrager = 'Verplicht';
      if (!emailAanvrager || !EMAIL_RE.test(emailAanvrager))  errors.email_aanvrager = 'Geldig e-mailadres vereist';
      if (!type_betaling || !VALID_TYPES.has(type_betaling))  errors.type_betaling = 'Verplicht';
      if (!naamTerugstorting)                                 errors.naam_terugstorting = 'Verplicht';

      // Type-specific validation
      if (type_betaling === 'onkostennota') {
        try {
          const parsed = JSON.parse(onkosten_items || '[]');
          if (!Array.isArray(parsed) || parsed.length === 0) errors.onkosten_items = 'Verplicht';
          else if (parsed.some((it) => !it.datum || !it.omschrijving?.trim() || !it.bedrag?.toString().trim()))
            errors.onkosten_items = 'Verplicht';
        } catch { errors.onkosten_items = 'Verplicht'; }
      }
      if (type_betaling === 'dringend' && !reden_urgentie?.trim())     errors.reden_urgentie = 'Verplicht';
      if (type_betaling === 'boete') {
        if (!referentie_boete?.trim())                                  errors.referentie_boete = 'Verplicht';
        if (!vervaldatum_boete)                                         errors.vervaldatum_boete = 'Verplicht';
        else if (!isValidDate(vervaldatum_boete))                       errors.vervaldatum_boete = 'Ongeldige datum (jjjj-mm-dd)';
      }
      if (type_betaling === 'andere' && !gedetailleerde_omschrijving?.trim()) errors.gedetailleerde_omschrijving = 'Verplicht';

      // Length limits, checked against the value as it will be stored.
      const lengthChecks = {
        aanvraagnummer: aanvraagnummer?.trim(),
        naam_aanvrager: naamAanvrager,
        email_aanvrager: emailAanvrager,
        naam_terugstorting: naamTerugstorting,
        iban: ibanNormalized,
        referentie_boete: referentie_boete?.trim(),
      };
      for (const [field, value] of Object.entries(lengthChecks)) {
        if (value && value.length > MAX_LENGTHS[field] && !errors[field]) {
          errors[field] = `Maximaal ${MAX_LENGTHS[field]} tekens`;
        }
      }
      const tooLongName = (req.files || []).find((f) => f.originalname.length > MAX_FILENAME);
      if (tooLongName) errors.bijlagen = `Bestandsnaam mag maximaal ${MAX_FILENAME} tekens zijn`;

      if (Object.keys(errors).length > 0) {
        discardFiles(req.files);
        return res.status(422).json({ errors });
      }

      const lang = taal === 'fr' ? 'fr' : 'nl';
      const belongsToType = (field) => TYPE_FIELDS[type_betaling].includes(field);
      const forType = (field, value) => (belongsToType(field) ? value : null);
      const uploads = (req.files || []).map((file) => ({
        original_name: file.originalname,
        stored_name: file.filename,
        mime_type: file.mimetype,
        size_bytes: file.size,
      }));

      // One transaction: a failing upload row used to leave the submission behind,
      // so the user saw an error, re-submitted, and the request existed twice.
      const submissionId = await createSubmissionWithUploads({
        aanvraagnummer: aanvraagnummer?.trim() || null,
        naam_aanvrager: naamAanvrager,
        email_aanvrager: emailAanvrager.toLowerCase(),
        type_betaling,
        naam_terugstorting: naamTerugstorting,
        iban: ibanNormalized,
        omschrijving: omschrijving?.trim() || null,
        taal: lang,
        reden_urgentie: forType('reden_urgentie', reden_urgentie?.trim() || null),
        contract: forType('contract', contract?.trim() || null),
        klant: forType('klant', klant?.trim() || null),
        referentie_boete: forType('referentie_boete', referentie_boete?.trim() || null),
        vervaldatum_boete: forType('vervaldatum_boete', vervaldatum_boete || null),
        gedetailleerde_omschrijving: forType('gedetailleerde_omschrijving', gedetailleerde_omschrijving?.trim() || null),
        onkosten_items: forType('onkosten_items', onkosten_items || null),
        proplanner_aangevraagd: belongsToType('proplanner_aangevraagd') && proplanner_aangevraagd === 'true',
      }, uploads);

      // Non-blocking email
      sendAdminNotification({ submissionId, naam_aanvrager: naamAanvrager, email_aanvrager: emailAanvrager, type_betaling, lang })
        .catch((err) => console.error('Admin mail failed:', err.message));
      sendUserConfirmation({ to: emailAanvrager, naam: naamAanvrager, lang })
        .catch((err) => console.error('User mail failed:', err.message));

      res.status(201).json({ success: true, id: submissionId });
    } catch (err) {
      // Catches everything, including bad input shapes: an uncaught throw in an async
      // handler is an unhandled rejection, which ends the Node process.
      console.error('Submission error:', err.message);
      discardFiles(req.files);
      res.status(500).json({ error: 'Er is een fout opgetreden' });
    }
  }
);

module.exports = router;
