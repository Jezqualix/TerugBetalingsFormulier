require('dotenv').config({ path: '.env.local' });
const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// Every table name goes through qualify(), so one env var moves the whole app
// between schemas: dbo on the legacy Azure SQL database, tbf on DockxDB. A
// schema cannot be a query parameter in T-SQL, so it is validated as a plain
// identifier before being interpolated. Rejecting rather than escaping keeps
// the rule easy to check: no brackets, no dots, no spaces, ever.
function schemaName() {
  const schema = process.env.DB_SCHEMA || 'dbo';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error(`DB_SCHEMA '${schema}' is not a plain identifier (letters, digits, underscore)`);
  }
  return schema;
}

function qualify(table) {
  return `[${schemaName()}].[${table}]`;
}

let poolPromise = null;

async function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect(config).catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

module.exports = { getPool, sql, qualify, schemaName };
