const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { listSubmissions, getSubmissionsForExport, updateSubmissionStatus, getUploadsForSubmission } = require('../models/submission');
const { streamCsv, streamXlsx } = require('../services/exportService');

const VALID_STATUSES = new Set(['nieuw', 'verwerkt']);

function parseId(val) {
  const n = parseInt(val, 10);
  return Number.isInteger(n) && n > 0 && String(n) === String(val) ? n : null;
}

router.get('/submissions', requireAdmin, async (req, res) => {
  try {
    const { from, to, status, page, pageSize } = req.query;
    const toInt = (val, fallback) => { const n = parseInt(val, 10); return Number.isFinite(n) && n > 0 ? n : fallback; };
    const result = await listSubmissions({
      from,
      to,
      status,
      page: toInt(page, 1),
      pageSize: toInt(pageSize, 20),
    });
    res.json(result);
  } catch (err) {
    console.error('Admin list error:', err.message);
    res.status(500).json({ error: 'Er is een fout opgetreden' });
  }
});

router.patch('/submissions/:id/status', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Ongeldig ID' });
  }
  const { status } = req.body || {};
  if (!status || !VALID_STATUSES.has(status)) {
    return res.status(422).json({ errors: { status: 'Ongeldige status' } });
  }
  try {
    const updated = await updateSubmissionStatus(id, status);
    if (!updated) {
      return res.status(404).json({ error: 'Aanvraag niet gevonden' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Status update error:', err.message);
    res.status(500).json({ error: 'Er is een fout opgetreden' });
  }
});

router.get('/submissions/:id/uploads', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({ error: 'Ongeldig ID' });
  }
  try {
    const uploads = await getUploadsForSubmission(id);
    res.json({ uploads });
  } catch (err) {
    console.error('Uploads list error:', err.message);
    res.status(500).json({ error: 'Er is een fout opgetreden' });
  }
});

router.get('/export', requireAdmin, async (req, res) => {
  try {
    const { from, to, status, format = 'csv' } = req.query;
    const rows = await getSubmissionsForExport({ from, to, status });

    if (format === 'xlsx') {
      await streamXlsx(rows, res);
    } else {
      streamCsv(rows, res);
    }
  } catch (err) {
    console.error('Export error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Export mislukt' });
    }
  }
});

module.exports = router;
