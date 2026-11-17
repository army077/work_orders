import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  SOURCE, invariant, inputPath, loadRecords, summarize, validateRecords,
} from './import_entregas_logistica_legacy.js';

// No utiliza db.js, Firebase, HTTP ni integraciones Drive.
// Esquema: ejecutar previamente 20261021_create_entregas_logistica_legacy.sql
// node --env-file=context/api10/.env.local context/database/importers/apply_entregas_logistica_legacy_local.js --apply-local --input <xlsx-absoluto>
const require = createRequire(new URL('../../api10/package.json', import.meta.url));
const { Client } = require('pg');
export const TABLE = 'public.entregas_logistica_legacy';
export const DB = Object.freeze({
  host: '127.0.0.1', port: 5432, database: 'artecnologia_test_local',
  user: 'workorders_test', ssl: false, connectionTimeoutMillis: 5000,
});
export const COLUMNS = Object.freeze([
  'source_snapshot_sha256', 'source_sheet', 'source_row', 'legacy_key', 'content_hash',
  'legacy_correlative', 'correo', 'usuario', 'fecha_raw', 'hora_raw', 'local_datetime',
  'pedido', 'equipo', 'chofer', 'observaciones', 'instalara', 'latitude', 'longitude',
  'legacy_image_count', 'drive_folder_url', 'drive_folder_id', 'ubicacion', 'app_version',
  'ticket', 'informacion_correcta', 'actualizado_zoho', 'comentarios', 'raw_payload',
  'warnings', 'import_batch_id',
]);
export const SQL = Object.freeze({
  identity: 'SELECT current_database() AS db, current_user AS role, '
    + 'host(inet_server_addr()) AS host, inet_server_port() AS port',
  schema: 'SELECT c.relkind, c.relrowsecurity, c.relhasrules, '
    + 'EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) AS triggers, '
    + 'EXISTS (SELECT 1 FROM pg_constraint x WHERE x.conrelid=c.oid AND x.contype= \'f\') AS fks, '
    + 'EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhparent=c.oid OR i.inhrelid=c.oid) AS inheritance '
    + 'FROM pg_class c WHERE c.oid=to_regclass(\'' + TABLE + '\')',
  lock: 'LOCK TABLE ' + TABLE + ' IN SHARE ROW EXCLUSIVE MODE',
  records: 'SELECT to_jsonb(t) - \'id\' - \'imported_at\' - \'import_batch_id\' AS record '
    + 'FROM ' + TABLE + ' t WHERE source_snapshot_sha256=$1 AND source_sheet=$2 ORDER BY source_row',
  insert: 'INSERT INTO ' + TABLE + ' (' + COLUMNS.join(', ') + ') VALUES ('
    + COLUMNS.map((_, i) => '$' + (i + 1)).join(', ') + ') RETURNING legacy_key',
  total: 'SELECT count(*)::int AS n FROM ' + TABLE,
});

export function guardEnvironment(env = process.env) {
  invariant(env.APP_ENV === 'local'
    && ['127.0.0.1', 'localhost', '::1'].includes(env.PGHOST)
    && env.PGPORT === '5432' && env.PGDATABASE === DB.database && env.PGUSER === DB.user,
  'LOCAL_ENVIRONMENT_REQUIRED');
  invariant(typeof env.PGPASSWORD === 'string' && env.PGPASSWORD.trim().length > 0,
    'LOCAL_PASSWORD_REQUIRED');
}

export async function assertLocalConnection(client) {
  const row = (await client.query(SQL.identity)).rows[0];
  invariant(row?.db === DB.database && row?.role === DB.user
    && ['127.0.0.1', '::1'].includes(row?.host) && Number(row?.port) === DB.port,
  'LOCAL_CONNECTION_REQUIRED');
}

export async function connectLocal() {
  guardEnvironment();
  const client = new Client({ ...DB, password: process.env.PGPASSWORD });
  try {
    await client.connect();
    await assertLocalConnection(client);
    return client;
  } catch (error) {
    try { await client.end(); } catch { /* No imprimir datos de conexion. */ }
    throw error;
  }
}

function conflict(code, row) {
  throw Object.assign(new Error(code + ' source_row=' + row), { code, sourceRow: row });
}
export function classifyRecords(records, existing) {
  const expected = new Map(records.map((r) => [r.source_row, r]));
  const seen = new Set();
  for (const saved of existing) {
    const record = expected.get(saved.source_row);
    if (!record || seen.has(saved.source_row)) conflict('LEGACY_SOURCE_CONFLICT', saved.source_row);
    if (saved.legacy_key !== record.legacy_key) conflict('LEGACY_KEY_CONFLICT', saved.source_row);
    if (saved.content_hash !== record.content_hash) conflict('LEGACY_CONTENT_CONFLICT', saved.source_row);
    if (!isDeepStrictEqual(saved, record)) conflict('LEGACY_ROW_CONFLICT', saved.source_row);
    seen.add(saved.source_row);
  }
  return { newRecords: records.filter((r) => !seen.has(r.source_row)), matched: seen.size };
}

async function readExisting(client) {
  return (await client.query(SQL.records, [SOURCE.sha256, SOURCE.sheet])).rows.map((r) => r.record);
}

export async function applyRecords(client, records) {
  validateRecords(records);
  await assertLocalConnection(client);
  let open = false, commitPending = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    open = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query(SQL.lock);
    const schema = (await client.query(SQL.schema)).rows[0];
    invariant(schema?.relkind === 'r' && schema.relrowsecurity === false
      && schema.relhasrules === false && schema.triggers === false
      && schema.fks === false && schema.inheritance === false, 'UNSAFE_LEGACY_SCHEMA');
    const classification = classifyRecords(records, await readExisting(client));
    const batch = randomUUID();
    for (const record of classification.newRecords) {
      const values = COLUMNS.map((c) => c === 'import_batch_id' ? batch
        : ['raw_payload', 'warnings'].includes(c) ? JSON.stringify(record[c]) : record[c]);
      const inserted = await client.query(SQL.insert, values);
      invariant(inserted.rowCount === 1, 'INSERT_NOT_CONFIRMED');
    }
    const verified = classifyRecords(records, await readExisting(client));
    invariant(verified.matched === SOURCE.count && verified.newRecords.length === 0,
      'POST_IMPORT_VERIFICATION_FAILED');
    const total = (await client.query(SQL.total)).rows[0].n;
    commitPending = true;
    const result = await client.query('COMMIT');
    invariant(result.command === 'COMMIT', 'COMMIT_NOT_CONFIRMED');
    commitPending = false;
    open = false;
    return {
      inserted: classification.newRecords.length, matched: classification.matched,
      sourceTotal: verified.matched, tableTotal: total,
      // Un replay no cambia batch ni imported_at de las filas existentes.
      importBatchId: classification.newRecords.length ? batch : null,
    };
  } catch (error) {
    if (open) {
      try { await client.query('ROLLBACK'); } catch { /* Cerrar conexion sin retry oculto. */ }
    }
    if (commitPending) {
      throw Object.assign(new Error('COMMIT incierto; repetir el mismo importador y snapshot.'),
        { code: 'LEGACY_COMMIT_UNCERTAIN' });
    }
    throw error;
  }
}

async function main() {
  const { records } = loadRecords(inputPath(process.argv.slice(2), true));
  const client = await connectLocal();
  try {
    const result = await applyRecords(client, records);
    console.log(JSON.stringify({ ...summarize(records), ...result }));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // No imprimir passwords, SQL parametrizado, datos de personas ni errores PG completos.
    console.error('APPLY LOCAL ABORTADO: ' + (error.code || 'IMPORT_ERROR')
      + (error.sourceRow ? ' source_row=' + error.sourceRow : ''));
    process.exitCode = 1;
  });
}
