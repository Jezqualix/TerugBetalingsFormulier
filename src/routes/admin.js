const express = require('express');
const router = express.Router();
const { requireAdminToken } = require('../middleware/auth');
const { listSubmissions, getSubmissionsForExport } = require('../models/submission');
const { streamCsv, streamXlsx } = require('../services/exportService');

router.get('/submissions', requireAdminToken, async (req, res) => {
  try {
    const { from, to, status, page, pageSize } = req.query;
    const result = await listSubmissions({
      from,
      to,
      status,
      page: parseInt(page || '1', 10),
      pageSize: parseInt(pageSize || '20', 10),
    });
    res.json(result);
  } catch (err) {
    console.error('Admin list error:', err.message);
    res.status(500).json({ error: 'Er is een fout opgetreden' });
  }
});

router.get('/export', requireAdminToken, async (req, res) => {
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
