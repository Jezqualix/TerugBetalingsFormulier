// In-memory data store for local layout/dev work — NO database, NO auth.
//
// Enabled only when DEV_MODE=true AND NODE_ENV is not 'production' (hard gate:
// this can never activate in the Azure Container App, which sets
// NODE_ENV=production). The model layer (src/models/submission.js) and the
// admin auth middleware (src/middleware/auth.js) branch to this store so the
// whole app runs on `npm run dev` alone — no SQL Server, no SMTP, no Entra.
//
// Mutations (status changes, test submissions) persist for the process
// lifetime and reset on restart.

function isDevMode() {
  return process.env.DEV_MODE === 'true' && process.env.NODE_ENV !== 'production';
}

// --- Seed data: one submission per payment type, mixed status/language ---
let submissions = [
  {
    id: 1,
    aanvraagnummer: 'AV-2026-001',
    naam_aanvrager: 'Jan Janssens',
    email_aanvrager: 'jan.janssens@example.be',
    type_betaling: 'onkostennota',
    naam_terugstorting: 'Jan Janssens',
    iban: 'BE68539007547034',
    omschrijving: 'Onkosten juni — parking en tol tijdens klantbezoeken.',
    taal: 'nl',
    reden_urgentie: null,
    contract: null,
    klant: null,
    referentie_boete: null,
    vervaldatum_boete: null,
    gedetailleerde_omschrijving: null,
    onkosten_items: JSON.stringify([
      { datum: '2026-06-03', omschrijving: 'Parking Antwerpen', bedrag: '12.50' },
      { datum: '2026-06-11', omschrijving: 'Tol Liefkenshoektunnel', bedrag: '6.00' },
    ]),
    proplanner_aangevraagd: 0,
    status: 'nieuw',
    created_at: new Date('2026-07-20T09:14:00'),
  },
  {
    id: 2,
    aanvraagnummer: 'AV-2026-002',
    naam_aanvrager: 'Marie Dubois',
    email_aanvrager: 'marie.dubois@example.be',
    type_betaling: 'dringend',
    naam_terugstorting: 'Marie Dubois',
    iban: null,
    omschrijving: null,
    taal: 'nl',
    reden_urgentie: 'Leverancier eist onmiddellijke betaling, levering geblokkeerd.',
    contract: 'CTR-4471',
    klant: 'Bouwbedrijf De Nijs',
    referentie_boete: null,
    vervaldatum_boete: null,
    gedetailleerde_omschrijving: null,
    onkosten_items: null,
    proplanner_aangevraagd: 1,
    status: 'verwerkt',
    created_at: new Date('2026-07-19T15:42:00'),
  },
  {
    id: 3,
    aanvraagnummer: 'AV-2026-003',
    naam_aanvrager: 'Pierre Lemaire',
    email_aanvrager: 'pierre.lemaire@example.be',
    type_betaling: 'brandstof',
    naam_terugstorting: 'Pierre Lemaire',
    iban: 'BE62510007547061',
    omschrijving: null,
    taal: 'fr',
    reden_urgentie: null,
    contract: 'CTR-3390',
    klant: 'Transports Wallonie SA',
    referentie_boete: null,
    vervaldatum_boete: null,
    gedetailleerde_omschrijving: null,
    onkosten_items: null,
    proplanner_aangevraagd: 0,
    status: 'nieuw',
    created_at: new Date('2026-07-18T11:05:00'),
  },
  {
    id: 4,
    aanvraagnummer: 'AV-2026-004',
    naam_aanvrager: 'Sofie Peeters',
    email_aanvrager: 'sofie.peeters@example.be',
    type_betaling: 'boete',
    naam_terugstorting: 'Sofie Peeters',
    iban: null,
    omschrijving: 'Parkeerboete tijdens dienstverplaatsing.',
    taal: 'nl',
    reden_urgentie: null,
    contract: null,
    klant: null,
    referentie_boete: 'BOETE-2026-8891',
    vervaldatum_boete: new Date('2026-08-15'),
    gedetailleerde_omschrijving: null,
    onkosten_items: null,
    proplanner_aangevraagd: 0,
    status: 'nieuw',
    created_at: new Date('2026-07-17T08:30:00'),
  },
  {
    id: 5,
    aanvraagnummer: 'AV-2026-005',
    naam_aanvrager: 'Luc Vermeulen',
    email_aanvrager: 'luc.vermeulen@example.be',
    type_betaling: 'andere',
    naam_terugstorting: 'Vermeulen Consulting BV',
    iban: 'BE43068999999501',
    omschrijving: null,
    taal: 'fr',
    reden_urgentie: null,
    contract: null,
    klant: null,
    referentie_boete: null,
    vervaldatum_boete: null,
    gedetailleerde_omschrijving: 'Remboursement de frais divers liés à la formation externe du personnel.',
    onkosten_items: null,
    proplanner_aangevraagd: 0,
    status: 'verwerkt',
    created_at: new Date('2026-07-16T14:20:00'),
  },
];

let uploads = [
  { id: 1, submission_id: 1, original_name: 'onkostennota-juni.pdf', stored_name: 'dev-onkostennota-juni.pdf', mime_type: 'application/pdf', size_bytes: 148213 },
  { id: 2, submission_id: 3, original_name: 'tankbon-1.jpg', stored_name: 'dev-tankbon-1.jpg', mime_type: 'image/jpeg', size_bytes: 88422 },
  { id: 3, submission_id: 3, original_name: 'tankbon-2.jpg', stored_name: 'dev-tankbon-2.jpg', mime_type: 'image/jpeg', size_bytes: 91050 },
];

let nextSubmissionId = 6;
let nextUploadId = 4;

function uploadCount(submissionId) {
  return uploads.filter((u) => u.submission_id === submissionId).length;
}

function matchesFilters(row, { from, to, status }) {
  if (status && row.status !== status) return false;
  if (from && row.created_at < new Date(from)) return false;
  if (to) {
    const end = new Date(to);
    end.setDate(end.getDate() + 1); // < to + 1 day (inclusive of `to`)
    if (row.created_at >= end) return false;
  }
  return true;
}

function devList({ from, to, status, page = 1, pageSize = 20 } = {}) {
  const filtered = submissions
    .filter((r) => matchesFilters(r, { from, to, status }))
    .sort((a, b) => b.created_at - a.created_at);
  const start = (page - 1) * pageSize;
  const rows = filtered.slice(start, start + pageSize).map((r) => ({
    ...r,
    upload_count: uploadCount(r.id),
  }));
  return { rows, total: filtered.length, page, pageSize };
}

function devExport({ from, to, status } = {}) {
  return submissions
    .filter((r) => matchesFilters(r, { from, to, status }))
    .sort((a, b) => b.created_at - a.created_at)
    .map((r) => ({ ...r, upload_count: uploadCount(r.id) }));
}

function devUploads(submissionId) {
  return uploads
    .filter((u) => u.submission_id === submissionId)
    .map((u) => ({ id: u.id, original_name: u.original_name, stored_name: u.stored_name, mime_type: u.mime_type, size_bytes: u.size_bytes }));
}

function devUpdateStatus(id, status) {
  const row = submissions.find((r) => r.id === id);
  if (!row) return false;
  row.status = status;
  return true;
}

function devCreateSubmission(data) {
  const id = nextSubmissionId++;
  submissions.push({
    id,
    aanvraagnummer: data.aanvraagnummer || null,
    naam_aanvrager: data.naam_aanvrager,
    email_aanvrager: data.email_aanvrager,
    type_betaling: data.type_betaling,
    naam_terugstorting: data.naam_terugstorting,
    iban: data.iban || null,
    omschrijving: data.omschrijving || null,
    taal: data.taal || 'nl',
    reden_urgentie: data.reden_urgentie || null,
    contract: data.contract || null,
    klant: data.klant || null,
    referentie_boete: data.referentie_boete || null,
    vervaldatum_boete: data.vervaldatum_boete ? new Date(data.vervaldatum_boete) : null,
    gedetailleerde_omschrijving: data.gedetailleerde_omschrijving || null,
    onkosten_items: data.onkosten_items || null,
    proplanner_aangevraagd: data.proplanner_aangevraagd ? 1 : 0,
    status: 'nieuw',
    created_at: new Date(),
  });
  return id;
}

function devCreateUpload(data) {
  const id = nextUploadId++;
  uploads.push({
    id,
    submission_id: data.submission_id,
    original_name: data.original_name,
    stored_name: data.stored_name,
    mime_type: data.mime_type,
    size_bytes: data.size_bytes,
  });
}

module.exports = {
  isDevMode,
  devList,
  devExport,
  devUploads,
  devUpdateStatus,
  devCreateSubmission,
  devCreateUpload,
};
