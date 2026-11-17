'use strict';

// Implementación para una ejecución posterior y explícita en LOCAL TEST.
// No reutiliza db.js ni admite configuración de conexión por CLI/URL.
const { createHash, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { extname, resolve } = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { Client } = require('pg');

const SOURCE = Object.freeze({
  source_spreadsheet_id: '1BlTb7Btw_BwWjEXHLlfwq0GFAnC5d0G8GjGHc36SW5U',
  source_tab_gid: 670260508,
  source_sheet: 'Proceso de liberación Empaque',
  source_snapshot_sha256: 'affe04cfa5199fbc24ceb45c6a5b2524ec3786c88b4fdc87dc12d3c42b0e1fd5',
  source_hash_version: 1,
  source_timezone: 'America/Mexico_City',
});
const DB = Object.freeze({
  host: '127.0.0.1', port: 5432, database: 'artecnologia_test_local',
  user: 'workorders_test', ssl: false,
});
const TABLE = 'public.liberaciones_empaque_legacy';
const FIRST_ROW = 2;
const LAST_ROW = 29;
const ROW_COUNT = 28;
const BOUNDARY_ROW = 30;
const COLUMN_COUNT = 14;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const EXPECTED_COUNTS = Object.freeze({ OK: 28, INCOMPLETA: 0, INVALIDA: 0, AMBIGUA: 0 });
const EXPECTED_SERIAL_NUMBER_ROWS = Object.freeze([
  { source_row: 11, numero_serie: '5619' },
  { source_row: 29, numero_serie: '80204' },
]);
const EXPECTED_DUPLICATE_SERIES = Object.freeze([
  { value: 'DJ250111004W37Q03', source_rows: [4, 7] },
  { value: '2025-03-089', source_rows: [9, 15] },
]);
const EXPECTED_DUPLICATE_DRIVE_ROWS = Object.freeze([[4, 7], [9, 15]]);
const EXPECTED_WITHOUT_CR = Object.freeze([16, 19, 27, 29]);
const EXPECTED_TRAILING_CR_COUNT = 24;
const MIN_LOCAL_DATE = '2025-07-04';
const MAX_LOCAL_DATE = '2026-01-26';
const MIN_INSTANT = '2025-07-04T13:43:28.000Z';
const MAX_INSTANT = '2026-01-26T18:08:37.000Z';
const EXPECTED_HEADERS = Object.freeze([
  '#', 'Num de semana', 'Correo', 'Usuario', 'Fecha', 'Hora', 'Numero de serie',
  'Equipo afectado', 'Accesorio', 'Operador Responsable', 'Estacion',
  'Carpeta Drive', 'Cant.img.guardadas', 'Version \nApp',
]);
// Orden exacto de las columnas A:N de la fuente.
const RAW_FIELDS = Object.freeze([
  'source_legacy_id', 'num_semana_raw', 'correo', 'usuario', 'fecha_raw', 'hora_raw',
  'numero_serie', 'equipo_afectado', 'accesorio', 'operador_responsable', 'estacion_raw',
  'carpeta_drive_url', 'cant_img_guardadas_raw', 'version_app',
]);
const INSERT_COLUMNS = Object.freeze([
  'source_spreadsheet_id', 'source_tab_gid', 'source_sheet', 'source_row',
  'source_legacy_id', 'source_snapshot_sha256', 'import_batch_id', 'source_hash',
  'source_hash_version', 'source_payload', ...RAW_FIELDS.slice(1), 'source_timezone',
  'fecha_local', 'hora_local', 'fecha_hora_normalizada', 'normalization_status',
  'validation_issues',
]);
const RECORD_FIELDS = Object.freeze(INSERT_COLUMNS.filter((field) => field !== 'import_batch_id'));
const IGNORED_FIELDS = new Set(['id', 'imported_at', 'import_batch_id']);
const FORBIDDEN_COLUMNS = ['work_order_id', 'inspection_order_id', 'inspection_order_task_id'];

const SQL = Object.freeze({
  preflight: `SELECT
  current_database() AS database_name,
  current_user AS user_name,
  host(inet_server_addr()) AS server_addr,
  inet_server_port() AS server_port;`,
  table: `SELECT to_regclass('${TABLE}')::text AS table_name;`,
  columns: `SELECT a.attname AS column_name
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2
  AND c.relkind IN ('r', 'p')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;`,
  // JSONB evita los parsers DATE/TIMESTAMPTZ de pg que dependen del host o
  // pierden microsegundos. También permite detectar columnas adicionales.
  positions: `SELECT to_jsonb(legacy) AS record
FROM ${TABLE} AS legacy
WHERE source_spreadsheet_id = $1
  AND source_tab_gid = $2
  AND source_row BETWEEN $3 AND $4
ORDER BY source_row;`,
  begin: 'BEGIN ISOLATION LEVEL READ COMMITTED;',
  lock: `LOCK TABLE ${TABLE} IN SHARE ROW EXCLUSIVE MODE;`,
  // Solo se construyen identificadores constantes y placeholders, nunca valores.
  insert: `INSERT INTO ${TABLE} (${INSERT_COLUMNS.join(', ')})
VALUES (${INSERT_COLUMNS.map((_, index) => `$${index + 1}`).join(', ')});`,
  rollback: 'ROLLBACK;',
  commit: 'COMMIT;',
});

function invariant(condition, detail) {
  if (!condition) throw new Error(detail);
}
const has = (value, field) => Object.prototype.hasOwnProperty.call(value, field);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isStringOrNull = (value) => value === null || typeof value === 'string';

function parseCli(args) {
  const usage = 'Uso: node context/api10/scripts/importers/apply_liberaciones_empaque_legacy_local.js --apply-local --input <ruta-xlsx> --report <ruta-json>';
  invariant(args.length === 5, usage);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    invariant(['--apply-local', '--input', '--report'].includes(flag) && !has(options, flag), usage);
    if (flag === '--apply-local') options[flag] = true;
    else {
      const value = args[++index];
      invariant(typeof value === 'string' && value.length > 0 && !value.startsWith('--'), usage);
      invariant(!value.startsWith('\\\\') && !value.startsWith('//'), 'Se requieren archivos locales.');
      options[flag] = resolve(value);
    }
  }
  invariant(options['--apply-local'] === true && options['--input'] && options['--report'], usage);
  invariant(extname(options['--input']).toLowerCase() === '.xlsx'
    && extname(options['--report']).toLowerCase() === '.json', 'Se requiere un XLSX y un reporte JSON.');
  return { input: options['--input'], report: options['--report'] };
}

function validateTemporal(record, formatter) {
  const row = record.source_row;
  invariant(record.normalization_status === 'OK' && typeof record.fecha_local === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(record.fecha_local)
    && record.fecha_local >= MIN_LOCAL_DATE && record.fecha_local <= MAX_LOCAL_DATE
    && typeof record.hora_local === 'string' && /^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(record.hora_local)
    && typeof record.fecha_hora_normalizada === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.fecha_hora_normalizada),
  `Campos temporales inválidos en source_row ${row}.`);
  const instant = new Date(record.fecha_hora_normalizada);
  invariant(Number.isFinite(instant.getTime()) && instant.toISOString() === record.fecha_hora_normalizada,
    `Instante inválido en source_row ${row}.`);
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}.${String(instant.getUTCMilliseconds()).padStart(3, '0')}`;
  invariant(date === record.fecha_local && time === record.hora_local,
    `El instante no corresponde a America/Mexico_City en source_row ${row}.`);
}

function validateDuplicates(report, records) {
  const group = (field) => {
    const groups = new Map();
    for (const record of records) {
      const value = record[field];
      if (value === null || /^\s*$/u.test(value)) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(record.source_row);
    }
    return [...groups].filter(([, rows]) => rows.length > 1)
      .map(([value, source_rows]) => ({ value, source_rows }));
  };
  const series = group('numero_serie');
  invariant(isDeepStrictEqual(series, EXPECTED_DUPLICATE_SERIES), 'Duplicados de numero_serie no autorizados en records.');
  const drive = group('carpeta_drive_url').map((item) => item.source_rows);
  invariant(isDeepStrictEqual(drive, EXPECTED_DUPLICATE_DRIVE_ROWS), 'Duplicados de carpeta_drive_url no autorizados en records.');
  invariant(isObject(report.duplicates), 'El reporte no contiene duplicates.');
  const reported = (field) => (Array.isArray(report.duplicates[field]) ? report.duplicates[field] : null);
  const reportedSeries = reported('numero_serie');
  const reportedDrive = reported('carpeta_drive_url');
  invariant(reportedSeries && isDeepStrictEqual(
    reportedSeries.map(({ value, source_rows, occurrence_count }) => ({ value, source_rows, occurrence_count })),
    EXPECTED_DUPLICATE_SERIES.map((item) => ({ ...item, occurrence_count: 2 }))),
  'Duplicados de numero_serie del reporte no autorizados.');
  invariant(reportedDrive && isDeepStrictEqual(reportedDrive.map((item) => item.source_rows), EXPECTED_DUPLICATE_DRIVE_ROWS)
    && reportedDrive.every((item) => item.occurrence_count === 2),
  'Duplicados de carpeta_drive_url del reporte no autorizados.');
}

function validateReport(report) {
  invariant(isObject(report), 'El reporte debe ser un objeto.');
  const expected = {
    mode: 'DRY_RUN', snapshot_sha256: SOURCE.source_snapshot_sha256,
    source_spreadsheet_id: SOURCE.source_spreadsheet_id, source_tab_gid: SOURCE.source_tab_gid,
    source_sheet: SOURCE.source_sheet, range: `A${FIRST_ROW}:N${LAST_ROW}`, expected_rows: ROW_COUNT,
    processed_rows: ROW_COUNT, source_hash_version: SOURCE.source_hash_version,
    source_timezone: SOURCE.source_timezone, first_source_row: FIRST_ROW, last_source_row: LAST_ROW,
    rows_with_warnings: 2, rows_with_errors: 0,
  };
  for (const [field, value] of Object.entries(expected)) {
    invariant(report[field] === value, `Metadato del reporte no autorizado: ${field}.`);
  }
  invariant(isObject(report.boundary_row) && report.boundary_row.source_row === BOUNDARY_ROW
    && report.boundary_row.empty === true && report.boundary_row.included_in_records === false,
  'La frontera 30 debe existir vacía y permanecer excluida.');
  invariant(isDeepStrictEqual(report.normalization_counts, EXPECTED_COUNTS), 'Conteos temporales no autorizados.');
  invariant(isDeepStrictEqual({ ...report.validation_issue_counts }, { SERIAL_STORED_AS_NUMBER: 2 }),
    'Resumen de validation_issues no autorizado.');
  invariant(isObject(report.temporal_range) && report.temporal_range.min_local_date === MIN_LOCAL_DATE
    && report.temporal_range.max_local_date === MAX_LOCAL_DATE
    && report.temporal_range.min_instant_utc === MIN_INSTANT
    && report.temporal_range.max_instant_utc === MAX_INSTANT
    && report.temporal_range.valid_instants === ROW_COUNT, 'Rango temporal del reporte no autorizado.');
  invariant(Array.isArray(report.headers) && isDeepStrictEqual(report.headers, EXPECTED_HEADERS),
    'Encabezados A:N del reporte no autorizados.');
  invariant(Array.isArray(report.records) && report.records.length === ROW_COUNT,
    `Se requieren exactamente ${ROW_COUNT} records.`);

  const formatter = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
    timeZone: SOURCE.source_timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const counts = { OK: 0, INCOMPLETA: 0, INVALIDA: 0, AMBIGUA: 0 };
  const warningRows = [];
  const fieldSet = [...RECORD_FIELDS].sort();
  let warnings = 0, errors = 0;
  report.records.forEach((record, index) => {
    invariant(isObject(record) && record.source_row === FIRST_ROW + index, `Secuencia inválida en record ${index}.`);
    const row = record.source_row;
    invariant([...IGNORED_FIELDS].every((field) => !has(record, field)),
      `Campos generados por DB/batch presentes en source_row ${row}.`);
    invariant(isDeepStrictEqual(Object.keys(record).sort(), fieldSet),
      `Campos faltantes o desconocidos en source_row ${row}.`);
    for (const [field, value] of Object.entries(SOURCE)) {
      invariant(record[field] === value, `Metadato ${field} no autorizado en source_row ${row}.`);
    }
    const payload = record.source_payload;
    invariant(isObject(payload) && Array.isArray(payload.headers) && payload.headers.length === COLUMN_COUNT
      && payload.headers.every(isStringOrNull) && isDeepStrictEqual(payload.headers, EXPECTED_HEADERS)
      && Array.isArray(payload.cells) && payload.cells.length === COLUMN_COUNT
      && payload.cells.every(isStringOrNull),
    `Payload inválido en source_row ${row}.`);
    invariant(RAW_FIELDS.every((field, column) => record[field] === payload.cells[column]),
      `Mapeo A:N inválido en source_row ${row}.`);
    invariant(typeof record.source_hash === 'string' && HASH_PATTERN.test(record.source_hash)
      && record.source_hash === sha256(Buffer.from(JSON.stringify(payload.cells), 'utf8')),
    `source_hash v1 inválido en source_row ${row}.`);
    invariant(Array.isArray(record.validation_issues) && record.validation_issues.every((item) => isObject(item)
      && ['field', 'code', 'detail'].every((field) => typeof item[field] === 'string')
      && ['warning', 'error'].includes(item.severity)), `validation_issues inválido en source_row ${row}.`);
    validateTemporal(record, formatter);
    counts[record.normalization_status]++;
    const hasWarning = record.validation_issues.some((item) => item.severity === 'warning');
    warnings += Number(hasWarning);
    errors += Number(record.validation_issues.some((item) => item.severity === 'error'));
    if (hasWarning) {
      invariant(record.validation_issues.length === 1 && record.validation_issues[0].code === 'SERIAL_STORED_AS_NUMBER'
        && record.validation_issues[0].field === 'numero_serie' && record.validation_issues[0].severity === 'warning',
      `Warning no autorizado en source_row ${row}.`);
      warningRows.push({ source_row: row, numero_serie: record.numero_serie });
    } else {
      invariant(record.validation_issues.length === 0, `validation_issues inesperados en source_row ${row}.`);
    }
  });
  invariant(isDeepStrictEqual(counts, EXPECTED_COUNTS) && warnings === 2 && errors === 0,
    'Los conteos recalculados de records no coinciden con el reporte autorizado.');
  invariant(isDeepStrictEqual(warningRows, EXPECTED_SERIAL_NUMBER_ROWS),
    'Las filas con SERIAL_STORED_AS_NUMBER no son las autorizadas.');

  const records = report.records;
  const withoutCr = records.filter((record) => !(record.equipo_afectado ?? '').endsWith('\r')).map((record) => record.source_row);
  invariant(isDeepStrictEqual(withoutCr, EXPECTED_WITHOUT_CR)
    && records.length - withoutCr.length === EXPECTED_TRAILING_CR_COUNT,
  'Filas con CR final en equipo_afectado no autorizadas.');
  invariant(isObject(report.anomalies)
    && Array.isArray(report.anomalies.equipo_afectado_without_trailing_cr_rows)
    && isDeepStrictEqual(report.anomalies.equipo_afectado_without_trailing_cr_rows, EXPECTED_WITHOUT_CR)
    && Array.isArray(report.anomalies.equipo_afectado_trailing_cr_rows)
    && report.anomalies.equipo_afectado_trailing_cr_rows.length === EXPECTED_TRAILING_CR_COUNT
    && Array.isArray(report.anomalies.numero_serie_stored_as_number)
    && isDeepStrictEqual(report.anomalies.numero_serie_stored_as_number.map(({ source_row, raw }) => ({ source_row, numero_serie: raw })),
      EXPECTED_SERIAL_NUMBER_ROWS),
  'Anomalías del reporte no autorizadas.');
  validateDuplicates(report, records);

  const locals = records.map((record) => record.fecha_local).sort();
  const instants = records.map((record) => record.fecha_hora_normalizada).sort();
  invariant(locals[0] === MIN_LOCAL_DATE && locals.at(-1) === MAX_LOCAL_DATE
    && instants[0] === MIN_INSTANT && instants.at(-1) === MAX_INSTANT,
  'El rango temporal de los records no coincide con el autorizado.');
  return records;
}

function canonicalTime(value) {
  if (value === null) return null;
  const match = typeof value === 'string' && /^(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  return match ? `${match[1]}.${(match[2] ?? '').padEnd(6, '0')}` : undefined;
}

function canonicalInstant(value) {
  if (value === null) return null;
  const match = typeof value === 'string'
    && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::\d{2})?)$/.exec(value);
  if (!match) return undefined;
  const offset = match[3].length === 3 ? `${match[3]}:00` : match[3];
  const instant = new Date(`${match[1]}${offset}`);
  if (!Number.isFinite(instant.getTime())) return undefined;
  // Compara instantes, sin depender del timezone de sesión ni perder microsegundos.
  return `${instant.toISOString().slice(0, 19)}.${(match[2] ?? '').padEnd(6, '0')}Z`;
}

function differingFields(actual, planned) {
  const fields = new Set([...Object.keys(actual), ...Object.keys(planned)]);
  return [...fields].filter((field) => {
    if (IGNORED_FIELDS.has(field)) return false;
    if (!has(actual, field) || !has(planned, field)) return true;
    const normalize = field === 'hora_local' ? canonicalTime
      : field === 'fecha_hora_normalizada' ? canonicalInstant : (value) => value;
    const left = normalize(actual[field]), right = normalize(planned[field]);
    // isDeepStrictEqual compara JSONB estructuralmente, sin depender del orden de claves.
    return left === undefined || right === undefined || !isDeepStrictEqual(left, right);
  });
}

async function readPositions(client) {
  const result = await client.query(SQL.positions,
    [SOURCE.source_spreadsheet_id, SOURCE.source_tab_gid, FIRST_ROW, LAST_ROW]);
  return result.rows.map((row) => row.record);
}

function classify(records, existing) {
  const byRow = new Map();
  const duplicateRows = new Set();
  for (const record of existing) {
    invariant(isObject(record) && Number.isInteger(record.source_row)
      && record.source_row >= FIRST_ROW && record.source_row <= LAST_ROW, 'Posición DB inesperada.');
    if (byRow.has(record.source_row)) duplicateRows.add(record.source_row);
    byRow.set(record.source_row, record);
  }
  const result = { NEW: [], EXACT_EXISTING: [], CONFLICT: [] };
  for (const planned of records) {
    const actual = byRow.get(planned.source_row);
    if (!actual) result.NEW.push(planned);
    else {
      const fields = differingFields(actual, planned);
      if (duplicateRows.has(planned.source_row)) fields.push('DUPLICATE_SOURCE_POSITION');
      if (fields.length) result.CONFLICT.push({ source_row: planned.source_row, fields });
      else result.EXACT_EXISTING.push(planned.source_row);
    }
  }
  return result;
}

function requireNoConflicts(result) {
  invariant(result.CONFLICT.length === 0,
    `CONFLICT: ${JSON.stringify(result.CONFLICT)}. Se aborta sin sobrescribir filas.`);
}

function printClassification(label, result) {
  console.log(`${label}: NEW=${result.NEW.length}, EXACT_EXISTING=${result.EXACT_EXISTING.length}, CONFLICT=${result.CONFLICT.length}`);
}

async function preflight(client) {
  const { rows } = await client.query(SQL.preflight);
  const identity = rows[0];
  invariant(rows.length === 1 && identity.database_name === DB.database && identity.user_name === DB.user
    && Number(identity.server_port) === DB.port && ['127.0.0.1', '::1'].includes(identity.server_addr),
  'Preflight rechazado: la conexión no corresponde al LOCAL TEST autorizado.');
  const table = await client.query(SQL.table);
  invariant(table.rows.length === 1 && table.rows[0].table_name !== null, `No existe ${TABLE}.`);
  const catalog = await client.query(SQL.columns, ['public', 'liberaciones_empaque_legacy']);
  const columns = new Set(catalog.rows.map((row) => row.column_name));
  const missing = [...INSERT_COLUMNS, 'id', 'imported_at'].filter((field) => !columns.has(field));
  const forbidden = FORBIDDEN_COLUMNS.filter((field) => columns.has(field));
  invariant(missing.length === 0 && forbidden.length === 0,
    `Esquema no autorizado: faltantes=${missing.join(',')}; prohibidas=${forbidden.join(',')}.`);
}

async function apply(records, password) {
  const client = new Client({ ...DB, password });
  let transactionOpen = false;
  let failed = false;
  try {
    await client.connect();
    await preflight(client);
    let classification = classify(records, await readPositions(client));
    printClassification('Preflight de posiciones', classification);
    requireNoConflicts(classification);
    if (classification.NEW.length === 0) {
      console.log('Inserts realizados: 0\nEstado: YA IMPORTADO / IDEMPOTENTE');
      return;
    }
    await client.query(SQL.begin);
    transactionOpen = true;
    await client.query(SQL.lock);
    // READ COMMITTED: la lectura tras esperar el lock ve importaciones ya terminadas.
    classification = classify(records, await readPositions(client));
    printClassification('Posiciones bajo lock', classification);
    requireNoConflicts(classification);
    if (classification.NEW.length === 0) {
      await client.query(SQL.rollback);
      transactionOpen = false;
      console.log('Inserts realizados: 0\nEstado: YA IMPORTADO / IDEMPOTENTE');
      return;
    }
    const batch = randomUUID();
    for (const record of classification.NEW) {
      const values = INSERT_COLUMNS.map((field) => {
        if (field === 'import_batch_id') return batch;
        if (field === 'source_payload' || field === 'validation_issues') return JSON.stringify(record[field]);
        return record[field];
      });
      await client.query(SQL.insert, values);
    }
    const persisted = await readPositions(client);
    const verification = classify(records, persisted);
    requireNoConflicts(verification);
    invariant(persisted.length === ROW_COUNT && verification.NEW.length === 0
      && verification.EXACT_EXISTING.length === ROW_COUNT && verification.CONFLICT.length === 0,
    `Verificación incompleta: se requieren ${ROW_COUNT}/${ROW_COUNT} filas exactas.`);
    await client.query(SQL.commit);
    transactionOpen = false;
    console.log(`Verificación: ${ROW_COUNT}/${ROW_COUNT}\nInserts realizados: ${classification.NEW.length}\nEstado: IMPORTADO`);
    console.log(`import_batch_id: ${batch}`);
  } catch (error) {
    failed = true;
    if (transactionOpen) {
      try {
        await client.query(SQL.rollback);
      } catch {
        console.error('No se pudo confirmar ROLLBACK; se cerrará la conexión sin reintentar la importación.');
      }
    }
    throw error;
  } finally {
    try {
      await client.end();
    } catch (error) {
      if (!failed) throw error;
      console.error('Error al cerrar el cliente PostgreSQL.');
    }
  }
}

async function main() {
  const paths = parseCli(process.argv.slice(2));
  const password = process.env.PGPASSWORD;
  invariant(typeof password === 'string' && password.trim().length > 0,
    'Falta PGPASSWORD. Define esa variable en esta sesión antes de ejecutar la aplicación local.');
  const bytes = readFileSync(paths.input);
  invariant(sha256(bytes) === SOURCE.source_snapshot_sha256, 'Snapshot XLSX no autorizado; no se conectará a PostgreSQL.');
  const report = JSON.parse(readFileSync(paths.report, 'utf8'));
  const records = validateReport(report);
  console.log(`Snapshot y reporte validados: ${ROW_COUNT} filas (source_row ${FIRST_ROW}-${LAST_ROW}).`);
  await apply(records, password);
}

main().catch((error) => {
  const password = process.env.PGPASSWORD;
  const message = String(error.message);
  console.error(`APLICACIÓN LOCAL ABORTADA: ${password ? message.split(password).join('[REDACTADO]') : message}`);
  process.exitCode = 1;
});
