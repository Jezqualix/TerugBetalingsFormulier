const { getPool, sql } = require('../config/db');

async function createSubmission(data) {
  const pool = await getPool();
  const result = await pool.request()
    .input('aanvraagnummer',     sql.NVarChar(100),  data.aanvraagnummer || null)
    .input('naam_aanvrager',     sql.NVarChar(255),  data.naam_aanvrager)
    .input('email_aanvrager',    sql.NVarChar(255),  data.email_aanvrager)
    .input('type_betaling',      sql.NVarChar(50),   data.type_betaling)
    .input('naam_terugstorting', sql.NVarChar(255),  data.naam_terugstorting)
    .input('iban',               sql.NVarChar(34),   data.iban || null)
    .input('omschrijving',       sql.NVarChar(sql.MAX), data.omschrijving || null)
    .input('taal',               sql.NVarChar(5),    data.taal || 'nl')
    .input('reden_urgentie',              sql.NVarChar(sql.MAX), data.reden_urgentie || null)
    .input('contract',                    sql.NVarChar(sql.MAX), data.contract || null)
    .input('klant',                       sql.NVarChar(sql.MAX), data.klant || null)
    .input('referentie_boete',            sql.NVarChar(255),     data.referentie_boete || null)
    .input('vervaldatum_boete',           sql.Date,              data.vervaldatum_boete || null)
    .input('gedetailleerde_omschrijving', sql.NVarChar(sql.MAX), data.gedetailleerde_omschrijving || null)
    .input('onkosten_items',             sql.NVarChar(sql.MAX), data.onkosten_items || null)
    .input('proplanner_aangevraagd',     sql.Bit,               data.proplanner_aangevraagd ? 1 : 0)
    .query(`
      INSERT INTO submissions
        (aanvraagnummer, naam_aanvrager, email_aanvrager, type_betaling,
         naam_terugstorting, iban, omschrijving, taal,
         reden_urgentie, contract, klant, referentie_boete, vervaldatum_boete,
         gedetailleerde_omschrijving, onkosten_items, proplanner_aangevraagd)
      OUTPUT INSERTED.id
      VALUES
        (@aanvraagnummer, @naam_aanvrager, @email_aanvrager, @type_betaling,
         @naam_terugstorting, @iban, @omschrijving, @taal,
         @reden_urgentie, @contract, @klant, @referentie_boete, @vervaldatum_boete,
         @gedetailleerde_omschrijving, @onkosten_items, @proplanner_aangevraagd)
    `);
  return result.recordset[0].id;
}

async function createUploadRecord(data) {
  const pool = await getPool();
  await pool.request()
    .input('submission_id', sql.Int,           data.submission_id)
    .input('original_name', sql.NVarChar(255), data.original_name)
    .input('stored_name',   sql.NVarChar(255), data.stored_name)
    .input('mime_type',     sql.NVarChar(100), data.mime_type)
    .input('size_bytes',    sql.Int,           data.size_bytes)
    .query(`
      INSERT INTO uploads (submission_id, original_name, stored_name, mime_type, size_bytes)
      VALUES (@submission_id, @original_name, @stored_name, @mime_type, @size_bytes)
    `);
}

async function listSubmissions({ from, to, status, page = 1, pageSize = 20 } = {}) {
  const pool = await getPool();

  function buildConditions(request) {
    const conditions = [];
    if (from) {
      request.input('from', sql.DateTime2, new Date(from));
      conditions.push('created_at >= @from');
    }
    if (to) {
      request.input('to', sql.DateTime2, new Date(to));
      conditions.push('created_at < DATEADD(day, 1, @to)');
    }
    if (status) {
      request.input('status', sql.NVarChar(50), status);
      conditions.push('status = @status');
    }
    return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  }

  const countReq = pool.request();
  const where = buildConditions(countReq);
  const countResult = await countReq.query(
    `SELECT COUNT(*) AS total FROM submissions ${where}`
  );

  const dataReq = pool.request();
  buildConditions(dataReq);
  dataReq
    .input('offset',   sql.Int, (page - 1) * pageSize)
    .input('pageSize', sql.Int, pageSize);

  const dataResult = await dataReq.query(`
    SELECT
      s.*,
      (SELECT COUNT(*) FROM uploads u WHERE u.submission_id = s.id) AS upload_count
    FROM submissions s
    ${where}
    ORDER BY s.created_at DESC
    OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
  `);

  return {
    rows: dataResult.recordset,
    total: countResult.recordset[0].total,
    page,
    pageSize,
  };
}

async function getSubmissionsForExport({ from, to, status } = {}) {
  const pool = await getPool();
  const request = pool.request();
  const conditions = [];

  if (from) {
    request.input('from', sql.DateTime2, new Date(from));
    conditions.push('created_at >= @from');
  }
  if (to) {
    request.input('to', sql.DateTime2, new Date(to));
    conditions.push('created_at < DATEADD(day, 1, @to)');
  }
  if (status) {
    request.input('status', sql.NVarChar(50), status);
    conditions.push('status = @status');
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await request.query(`
    SELECT
      s.id, s.aanvraagnummer, s.naam_aanvrager, s.email_aanvrager,
      s.type_betaling, s.naam_terugstorting, s.iban, s.omschrijving,
      s.reden_urgentie, s.contract, s.klant,
      s.referentie_boete, s.vervaldatum_boete, s.gedetailleerde_omschrijving,
      s.onkosten_items, s.proplanner_aangevraagd,
      s.status, s.taal, s.created_at,
      (SELECT COUNT(*) FROM uploads u WHERE u.submission_id = s.id) AS upload_count
    FROM submissions s
    ${where}
    ORDER BY s.created_at DESC
  `);

  return result.recordset;
}

module.exports = { createSubmission, createUploadRecord, listSubmissions, getSubmissionsForExport };
