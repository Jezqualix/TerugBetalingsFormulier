const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAdminToken } = require('../middleware/auth');

router.get('/uploads/:filename', requireAdminToken, (req, res) => {
  // path.basename strips any directory component — prevents traversal
  const filename = path.basename(req.params.filename);
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
  const filePath = path.join(uploadDir, filename);

  // Secondary check: resolved path must start with upload dir
  if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.sendFile(filePath);
});

module.exports = router;
