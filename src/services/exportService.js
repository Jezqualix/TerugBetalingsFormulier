const fastCsv = require('fast-csv');
const ExcelJS = require('exceljs');

const COLUMNS = [
  { header: 'ID',                  key: 'id' },
  { header: 'Aanvraagnummer',      key: 'aanvraagnummer' },
  { header: 'Naam aanvrager',      key: 'naam_aanvrager' },
  { header: 'E-mail aanvrager',    key: 'email_aanvrager' },
  { header: 'Type betaling',       key: 'type_betaling' },
  { header: 'Naam terugstorting',  key: 'naam_terugstorting' },
  { header: 'IBAN',                key: 'iban' },
  { header: 'Omschrijving',        key: 'omschrijving' },
  { header: 'Status',              key: 'status' },
  { header: 'Taal',                key: 'taal' },
  { header: 'Bijlagen',            key: 'upload_count' },
  { header: 'Datum',               key: 'created_at' },
];

function toRow(row) {
  return COLUMNS.reduce((acc, col) => {
    let val = row[col.key];
    if (val instanceof Date) val = val.toISOString();
    acc[col.header] = val ?? '';
    return acc;
  }, {});
}

function streamCsv(rows, res) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="submissions.csv"');

  const csvStream = fastCsv.format({ headers: true });
  csvStream.pipe(res);
  for (const row of rows) csvStream.write(toRow(row));
  csvStream.end();
}

async function streamXlsx(rows, res) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="submissions.xlsx"');

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Submissions');

  sheet.columns = COLUMNS.map((col) => ({ header: col.header, key: col.key, width: 22 }));

  for (const row of rows) {
    const mapped = { ...row };
    if (mapped.created_at instanceof Date) {
      mapped.created_at = mapped.created_at.toLocaleString('nl-BE');
    }
    sheet.addRow(mapped);
  }

  sheet.getRow(1).font = { bold: true };
  await workbook.xlsx.write(res);
}

module.exports = { streamCsv, streamXlsx };
