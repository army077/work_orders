import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecords, recordsDigest } from './import_preembarque_legacy.js';

// pg solo está instalado en context/api10; no se instalan paquetes nuevos.
const require = createRequire(new URL('../../api10/package.json', import.meta.url));
const { Client } = require('pg');

// APPLY exclusivo para LOCAL TEST. Sin configuración de conexión por CLI/URL.
const DB = Object.freeze({
  host: '127.0.0.1', port: 5432, database: 'artecnologia_test_local',
  user: 'workorders_test', ssl: false,
});
const EXPECTED = Object.freeze({
  sha: 'affe04cfa5199fbc24ceb45c6a5b2524ec3786c88b4fdc87dc12d3c42b0e1fd5',
  digest: '1bf9ed8719f5156c30aea795fe0471ca580195e0f646998013dbefe885087506',
  rows: 1205,
});
const TABLE = 'public.preembarque_legacy';
const INSERT_COLUMNS = Object.freeze([
  'source_sheet', 'source_tab_gid', 'source_row', 'source_layout',
  'correlativo_raw', 'semana_raw', 'usuario_raw', 'fecha_raw', 'hora_raw', 'cliente_raw',
  'pedido_raw', 'serie_origen_raw', 'serie_asignada_raw', 'equipo_raw', 'accesorio_raw',
  'descripcion_raw', 'desviacion_raw', 'serie_modulo_generador_raw', 'carpeta_drive_raw',
  'cantidad_imagenes_raw', 'version_app_raw', 'anio_raw',
  'fecha_local', 'hora_local', 'captured_at_local', 'captured_at_utc',
  'source_cells_meta', 'record_status', 'warnings', 'source_snapshot_sha256', 'import_batch_id',
]);
const JSON_COLUMNS = new Set(['source_cells_meta', 'warnings']);
const INSERT_SQL = `INSERT INTO ${TABLE} (${INSERT_COLUMNS.join(', ')})
VALUES (${INSERT_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
ON CONFLICT (source_sheet, source_tab_gid, source_row, source_snapshot_sha256) DO NOTHING
RETURNING id`;

function invariant(condition, detail) {
  if (!condition) throw new Error(`Invariante incumplida: ${detail}`);
}

function inputPath(args) {
  invariant(args.length === 2 && args[0] === '--input' && args[1]
    && isAbsolute(args[1]) && !args[1].startsWith('\\\\') && extname(args[1]).toLowerCase() === '.xlsx',
  'Uso: node apply_preembarque_legacy_local.js --input <ruta-absoluta.xlsx>');
  return resolve(args[1]);
}

const countBy = (records, key) => records.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {});

async function preflight(client) {
  const { rows } = await client.query(
    `SELECT current_database() AS db, current_user AS usr, host(inet_server_addr()) AS addr,
            inet_server_port() AS port, to_regclass('${TABLE}')::text AS tbl`);
  const id = rows[0];
  invariant(id.db === DB.database && id.usr === DB.user && Number(id.port) === DB.port
    && ['127.0.0.1', '::1'].includes(id.addr), 'la conexión no corresponde al LOCAL TEST autorizado');
  invariant(id.tbl === 'preembarque_legacy' || id.tbl === TABLE, `no existe ${TABLE}`);
}

async function scalar(client, sql, params = []) {
  return (await client.query(sql, params)).rows[0];
}

async function forensic(client) {
  const { rows } = await client.query(
    `SELECT source_row, carpeta_drive_raw, serie_origen_raw, serie_asignada_raw, source_cells_meta
       FROM ${TABLE} WHERE source_snapshot_sha256 = $1 AND source_row IN (40, 89, 578, 601)
      ORDER BY source_row`, [EXPECTED.sha]);
  const by = Object.fromEntries(rows.map((r) => [r.source_row, r]));
  const checks = {
    'N89 carpeta_drive_raw': by[89]?.carpeta_drive_raw,
    'N89 hyperlink.target': by[89]?.source_cells_meta.N.hyperlink?.target,
    'H40 v': by[40]?.source_cells_meta.H.v,
    'H578 v': by[578]?.source_cells_meta.H.v,
    'H601 v': by[601]?.source_cells_meta.H.v,
    'I601 v': by[601]?.source_cells_meta.I.v,
  };
  const expected = {
    'N89 carpeta_drive_raw': 'Embarque',
    'N89 hyperlink.target': 'https://drive.google.com/drive/folders/1Ox02nr21RPK1SxcCM0iCAWSKMChH9d5H',
    'H40 v': 23177, 'H578 v': 45436, 'H601 v': 45552, 'I601 v': 45552,
  };
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${k} = ${JSON.stringify(v)}`);
    invariant(v === expected[k], `verificación forense fallida: ${k}`);
  }
}

async function apply(records, password) {
  const client = new Client({ ...DB, password });
  let open = false;
  let failed = false;
  try {
    await client.connect();
    await preflight(client);
    const before = Number((await scalar(client, `SELECT COUNT(*) AS n FROM ${TABLE}`)).n);
    console.log(`Filas antes: ${before}`);
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    open = true;
    await client.query(`LOCK TABLE ${TABLE} IN SHARE ROW EXCLUSIVE MODE`);
    const batch = randomUUID();
    let inserted = 0;
    for (const record of records) {
      const values = INSERT_COLUMNS.map((c) => {
        if (c === 'import_batch_id') return batch;
        return JSON_COLUMNS.has(c) ? JSON.stringify(record[c]) : record[c];
      });
      inserted += (await client.query(INSERT_SQL, values)).rowCount;
    }
    const conflicts = records.length - inserted;
    invariant(inserted + conflicts === EXPECTED.rows, 'inserted + conflicts != 1205');

    const total = Number((await scalar(client, `SELECT COUNT(*) AS n FROM ${TABLE}`)).n);
    const own = await scalar(client,
      `SELECT COUNT(*) AS n, COUNT(DISTINCT source_row) AS d FROM ${TABLE} WHERE source_snapshot_sha256 = $1`, [EXPECTED.sha]);
    invariant(total === before + inserted, 'el total de la tabla no coincide con before + inserted');
    invariant(Number(own.n) === EXPECTED.rows && Number(own.d) === EXPECTED.rows,
      'se requieren 1205 filas y 1205 source_row distintos para el SHA');
    const batchRows = Number((await scalar(client, `SELECT COUNT(*) AS n FROM ${TABLE} WHERE import_batch_id = $1`, [batch])).n);
    invariant(batchRows === inserted, 'el batch de esta corrida no coincide con lo insertado');
    if (inserted === EXPECTED.rows) {
      const batches = Number((await scalar(client, `SELECT COUNT(DISTINCT import_batch_id) AS n FROM ${TABLE}`)).n);
      invariant(batches === 1 && before === 0, 'la primera corrida debe usar un único batch sobre tabla vacía');
    }
    const layouts = Object.fromEntries((await client.query(
      `SELECT source_layout k, COUNT(*)::int n FROM ${TABLE} GROUP BY 1`)).rows.map((r) => [r.k, r.n]));
    const statuses = Object.fromEntries((await client.query(
      `SELECT record_status k, COUNT(*)::int n FROM ${TABLE} GROUP BY 1`)).rows.map((r) => [r.k, r.n]));
    const expLayouts = countBy(records, 'source_layout');
    const expStatuses = countBy(records, 'record_status');
    invariant(JSON.stringify(layouts, Object.keys(layouts).sort()) === JSON.stringify(expLayouts, Object.keys(expLayouts).sort())
      && JSON.stringify(statuses, Object.keys(statuses).sort()) === JSON.stringify(expStatuses, Object.keys(expStatuses).sort()),
    'distribución por layout/status distinta de la esperada');
    console.log('Verificación forense:');
    await forensic(client);
    await client.query('COMMIT');
    open = false;
    console.log([
      `import_batch_id (esta corrida): ${batch}`,
      `inserted = ${inserted}`, `conflicts = ${conflicts}`, `total tabla = ${total}`,
      `por source_layout: ${JSON.stringify(layouts)}`, `por record_status: ${JSON.stringify(statuses)}`,
      `batches distintos en tabla: ${(await scalar(client, `SELECT COUNT(DISTINCT import_batch_id)::int AS n FROM ${TABLE}`)).n}`,
    ].join('\n'));
  } catch (error) {
    failed = true;
    if (open) {
      try { await client.query('ROLLBACK'); } catch { console.error('No se pudo confirmar ROLLBACK.'); }
    }
    throw error;
  } finally {
    try { await client.end(); } catch (error) { if (!failed) throw error; }
  }
}

async function main() {
  const input = inputPath(process.argv.slice(2));
  const password = process.env.PGPASSWORD;
  invariant(typeof password === 'string' && password.trim().length > 0, 'Falta PGPASSWORD en esta sesión.');
  // loadRecords valida el SHA-256 del snapshot antes de interpretar nada.
  const { records, snapshotHash } = loadRecords(input);
  invariant(snapshotHash === EXPECTED.sha, 'snapshot no autorizado');
  invariant(records.length === EXPECTED.rows, `se esperaban ${EXPECTED.rows} registros`);
  const digest = recordsDigest(records);
  invariant(digest === EXPECTED.digest, `digest inesperado: ${digest}`);
  console.log(`Snapshot y digest validados: ${records.length} registros\nDigest: ${digest}`);
  await apply(records, password);
  console.log('APPLY LOCAL COMPLETADO (producción no utilizada)');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const password = process.env.PGPASSWORD;
    const message = String(error.message);
    console.error(`APPLY LOCAL ABORTADO: ${password ? message.split(password).join('[REDACTADO]') : message}`);
    process.exitCode = 1;
  });
}
