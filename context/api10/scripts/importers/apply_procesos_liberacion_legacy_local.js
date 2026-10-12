'use strict';

// Implementación para una ejecución posterior y explícita en LOCAL TEST.
// No reutiliza db.js ni admite configuración de conexión por CLI/URL.
const { createHash, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { extname, resolve } = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const XLSX = require('xlsx');
const { Client } = require('pg');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc.js');
const timezone = require('dayjs/plugin/timezone.js');

dayjs.extend(utc);
dayjs.extend(timezone);

const SOURCE = Object.freeze({
  source_spreadsheet_id: '1BlTb7Btw_BwWjEXHLlfwq0GFAnC5d0G8GjGHc36SW5U',
  source_tab_gid: 464343719,
  source_sheet: 'Procesos de liberacion',
  source_snapshot_sha256: 'affe04cfa5199fbc24ceb45c6a5b2524ec3786c88b4fdc87dc12d3c42b0e1fd5',
  source_hash_version: 1,
  source_timezone: 'America/Mexico_City',
});
const DB = Object.freeze({
  host: '127.0.0.1', port: 5432, database: 'artecnologia_test_local',
  user: 'workorders_test', ssl: false,
  connectionTimeoutMillis: 30000, statement_timeout: 120000, lock_timeout: 60000,
});
const TABLE = 'public.procesos_liberacion_legacy';
const DECLARED_REF = 'A1:Q2005';
const DECLARED_LAST_ROW = 2005;
const FIRST_ROW = 2;
const LAST_ROW = 1015;
const ROW_COUNT = 1014;
const TEST_ROW = 1016;
const BOUNDARY_ROW = 1017;
const COLUMN_COUNT = 17;
const DAY_MS = 86400000;
const DATE_COLUMN = 4;
const TIME_COLUMN = 5;
const SERIAL_COLUMN = 6;
const REQUIRED_FIELDS = Object.freeze({
  correo: 'MISSING_EMAIL', usuario: 'MISSING_USER', numero_serie: 'MISSING_SERIAL',
  equipo_afectado: 'MISSING_MACHINE', operador_responsable: 'MISSING_OPERATOR',
  estacion_raw: 'MISSING_STATION', carpeta_drive_url: 'MISSING_DRIVE_FOLDER',
});
// Campos presentes en todo registro completo, sin depender de la era de la app.
const CORE_FIELDS = Object.freeze([
  'correo', 'fecha_raw', 'hora_raw', 'numero_serie', 'equipo_afectado', 'accesorio',
  'descripcion', 'carpeta_drive_url', 'cant_img_guardadas_raw', 'version_app',
]);
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const EXPECTED_COUNTS = Object.freeze({ OK: 1012, INCOMPLETA: 2, INVALIDA: 0, AMBIGUA: 0 });
const EXPECTED_INCOMPLETE_ROWS = Object.freeze([833, 834]);
const EXPECTED_HEADERS = Object.freeze([
  '#', 'Num de semana', 'Correo', 'Usuario', 'Fecha', 'Hora', 'Numero de serie',
  'Equipo afectado', 'Accesorio', 'Operador Responsable', 'Estacion', 'Descripcion',
  'Desviacion', 'Folio Desviacion', 'Carpeta Drive', 'Cant.img.guardadas', 'Version \nApp',
]);
// Orden exacto de las columnas A:Q de la fuente.
const RAW_FIELDS = Object.freeze([
  'source_legacy_id', 'num_semana_raw', 'correo', 'usuario', 'fecha_raw', 'hora_raw',
  'numero_serie', 'equipo_afectado', 'accesorio', 'operador_responsable', 'estacion_raw',
  'descripcion', 'desviacion', 'folio_desviacion', 'carpeta_drive_url',
  'cant_img_guardadas_raw', 'version_app',
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
const EXPECTED_DB_COLUMNS = new Set([...INSERT_COLUMNS, 'id', 'imported_at']);
const FORBIDDEN_COLUMNS = ['work_order_id', 'inspection_order_id', 'inspection_order_task_id'];
// Contrato de la migración local; format_type incluye cualquier precisión/modificador.
const EXPECTED_COLUMN_CONTRACT = Object.freeze(Object.fromEntries([
  ...RAW_FIELDS.map((field) => [field, ['text', false]]),
  ['id', ['bigint', true]],
  ['source_spreadsheet_id', ['text', true]],
  ['source_tab_gid', ['bigint', true]],
  ['source_sheet', ['text', true]],
  ['source_row', ['integer', true]],
  ['source_snapshot_sha256', ['text', true]],
  ['import_batch_id', ['uuid', true]],
  ['source_hash', ['text', true]],
  ['source_hash_version', ['smallint', true]],
  ['imported_at', ['timestamp with time zone', true]],
  ['source_payload', ['jsonb', true]],
  ['source_timezone', ['text', true]],
  ['fecha_local', ['date', false]],
  ['hora_local', ['time without time zone', false]],
  ['fecha_hora_normalizada', ['timestamp with time zone', false]],
  ['normalization_status', ['text', true]],
  ['validation_issues', ['jsonb', true]],
]));
const TEST_ROW_EXPECTED = Object.freeze({
  fecha_local: '2026-10-01', numero_serie: '12', descripcion: 'descripcion',
  desviacion: 'desviacion', folio_desviacion: '123', cant_img_guardadas_raw: '0',
});

const SQL = Object.freeze({
  preflight: `SELECT
  current_database() AS database_name,
  current_user AS user_name,
  host(inet_server_addr()) AS server_addr,
  inet_server_port() AS server_port;`,
  table: `SELECT c.oid::regclass::text AS table_name, c.relkind, c.relispartition,
  EXISTS (SELECT 1 FROM pg_catalog.pg_inherits AS i
          WHERE i.inhrelid = c.oid OR i.inhparent = c.oid) AS has_inheritance
FROM pg_catalog.pg_class AS c
WHERE c.oid = to_regclass('${TABLE}');`,
  columns: `SELECT a.attname AS column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null, a.attidentity AS identity_kind,
  a.attgenerated AS generated_kind
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2
  AND c.relkind = 'r'
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum;`,
  constraints: `SELECT con.contype AS kind, con.convalidated AS validated,
  con.condeferrable AS deferrable, idx.indisvalid AS index_valid,
  idx.indisready AS index_ready,
  ARRAY(SELECT a.attname::text
        FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, position)
        JOIN pg_catalog.pg_attribute AS a
          ON a.attrelid = con.conrelid AND a.attnum = key.attnum
        ORDER BY key.position) AS columns
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_index AS idx ON idx.indexrelid = con.conindid
WHERE con.conrelid = to_regclass('${TABLE}')
  AND con.contype IN ('p', 'u');`,
  hooks: `SELECT 'trigger' AS kind, tgname AS name
FROM pg_catalog.pg_trigger
WHERE tgrelid = to_regclass('${TABLE}') AND NOT tgisinternal
UNION ALL
SELECT 'rule' AS kind, rulename AS name
FROM pg_catalog.pg_rewrite
WHERE ev_class = to_regclass('${TABLE}');`,
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
const pad = (value, width = 2) => String(value).padStart(width, '0');
const sorted = (values) => [...values].sort();
const missing = (value) => value === null || /^\s*$/u.test(value);
const issue = (field, code, severity, detail) => ({ field, code, severity, detail });

function parseCli(args) {
  const usage = 'Uso: node context/api10/scripts/importers/apply_procesos_liberacion_legacy_local.js --apply-local --input <ruta-xlsx> --report <ruta-json>';
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

// ---------------------------------------------------------------------------
// Revalidación independiente del XLSX congelado (no se confía solo en el JSON).
// ---------------------------------------------------------------------------

// Misma representación visible que el dry-run: strings literales (v), resto texto formateado (w).
function readRow(sheet, row, date1904) {
  const issues = [];
  const originals = [];
  const cells = RAW_FIELDS.map((field, column) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: row - 1, c: column })];
    originals.push(cell);
    if (!cell || cell.t === 'z') return null;
    if (cell.t === 's' && typeof cell.v === 'string') return cell.v;
    if (typeof cell.w === 'string') return cell.w;
    if (cell.v === undefined || cell.v === null) return null;
    if (typeof cell.v === 'string') return cell.v;
    invariant(typeof cell.v === 'number' || typeof cell.v === 'boolean',
      `tipo de celda inesperado en fila ${row}, columna ${column + 1}`);
    try {
      if (cell.t === 'e') return String(XLSX.utils.format_cell(cell));
      return XLSX.SSF.format(cell.z || 'General', cell.v, { date1904 });
    } catch {
      issues.push(issue(field, 'DISPLAY_FORMAT_UNAVAILABLE', 'warning',
        'No se pudo reproducir el formato visible; se conserva el valor interno como texto'));
      return String(cell.v);
    }
  });
  invariant(cells.length === COLUMN_COUNT && cells.every((v) => v === null || typeof v === 'string'),
    `fila ${row}: se requieren ${COLUMN_COUNT} valores string/null`);
  return { cells, originals, issues };
}

const isBlankCell = (cell) => !cell || cell.t === 'z' || cell.v === undefined || cell.v === null || cell.v === '';
// Lógica determinista replicada del dry-run import_procesos_liberacion_legacy.js.
// Se conserva el orden de las incidencias: lectura, normalización y anomalías.
function validDate(year, month, day) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12
    && day >= 1 && day <= days[month - 1];
}
const parsed = (state, value, format, detail = '') => ({ state, value, format, detail });
const isExcelTemporal = (cell) => cell?.t === 'n'
  && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z);

// Fechas: serial Excel (sin cellDates) o texto D/M/YYYY / YYYY-MM-DD.
// No se adivina MM/DD ni el siglo de un año de dos dígitos en texto.
function parseDate(raw, cell, date1904) {
  if (missing(raw)) return parsed('INCOMPLETA', null, 'ausente', 'Falta la fecha');
  let year, month, day;
  let format = 'texto:no reconocido';
  if (isExcelTemporal(cell)) {
    format = `serial Excel:${cell.z}`;
    const serial = cell.v;
    const days = Math.floor(serial);
    if (!Number.isFinite(serial) || serial < 0 || serial >= 2958466
      || (!date1904 && (days === 0 || days === 60))) {
      return parsed('INVALIDA', null, format, 'Serial de fecha inválido, incluido el día ficticio 1900-02-29');
    }
    // Aritmética de calendario UTC: no usa Date local ni el timezone del host.
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const adjustedDays = date1904 ? days : days - (days > 60 ? 1 : 0);
    const date = new Date(epoch + adjustedDays * DAY_MS);
    [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else {
    const text = raw.trim();
    let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (match) {
      [day, month, year] = match.slice(1).map(Number);
      format = 'texto:D/M/YYYY';
    } else if ((match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text))) {
      [year, month, day] = match.slice(1).map(Number);
      format = 'texto:YYYY-MM-DD';
    } else if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(text)) {
      return parsed('AMBIGUA', null, 'texto:año de dos dígitos', 'No se infiere el siglo');
    } else {
      return parsed('INVALIDA', null, format, 'Formato de fecha no reconocido');
    }
  }
  return validDate(year, month, day)
    ? parsed('OK', `${pad(year, 4)}-${pad(month)}-${pad(day)}`, format)
    : parsed('INVALIDA', null, format, 'La fecha no existe en el calendario');
}

// Horas: serial Excel, H:mm[:ss[.SSS]] o H.mm.ss en 24 horas, y
// h:mm[:ss[.SSS]] con AM/PM, a.m./p.m. o marcadores Unicode ص (AM) y م (PM).
// El parsing usa regex numéricas, nunca el locale configurado en la máquina.
function parseTime(raw, cell) {
  if (missing(raw)) return parsed('INCOMPLETA', null, 'ausente', 'Falta la hora');
  let hour, minute, second, millisecond;
  let format = 'texto:no reconocido';
  if (isExcelTemporal(cell)) {
    format = `serial Excel:${cell.z}`;
    if (!Number.isFinite(cell.v) || cell.v < 0 || cell.v >= 2958466
      || /\[(h+|m+|s+)\]/i.test(cell.z)) {
      return parsed('INVALIDA', null, format, 'Serial de hora inválido o formato de duración');
    }
    const milliseconds = Math.round((cell.v - Math.floor(cell.v)) * DAY_MS);
    if (milliseconds >= DAY_MS) return parsed('INVALIDA', null, format, 'Hora fuera del día civil');
    hour = Math.floor(milliseconds / 3600000);
    minute = Math.floor(milliseconds / 60000) % 60;
    second = Math.floor(milliseconds / 1000) % 60;
    millisecond = milliseconds % 1000;
  } else {
    const text = raw.trim();
    const dotted = /^(\d{1,2})\.(\d{2})\.(\d{2})$/.exec(text);
    const match = dotted ?? /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?\s*(?:([ap])\.?\s*m\.?|([\u0635\u0645]))?$/i.exec(text);
    if (!match) return parsed('INVALIDA', null, format, 'Formato de hora no reconocido');
    hour = Number(match[1]);
    minute = Number(match[2]);
    second = Number(match[3] ?? 0);
    millisecond = Number((match[4] ?? '').padEnd(3, '0'));
    const meridiem = match[5]?.toLowerCase()
      ?? (match[6] === '\u0635' ? 'a' : match[6] === '\u0645' ? 'p' : undefined);
    format = dotted ? 'texto:24 horas con puntos'
      : match[6] ? `texto:12 horas con meridiem árabe ${meridiem === 'p' ? 'PM' : 'AM'}`
        : meridiem ? 'texto:12 horas AM/PM o a.m./p.m.' : 'texto:24 horas';
    if (meridiem) {
      if (hour < 1 || hour > 12) return parsed('INVALIDA', null, format, 'Hora de 12 horas fuera de rango');
      hour = hour % 12 + (meridiem === 'p' ? 12 : 0);
    }
  }
  if (hour > 23 || minute > 59 || second > 59) return parsed('INVALIDA', null, format, 'Hora fuera de rango');
  return parsed('OK', `${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(millisecond, 3)}`, format);
}

function createCivilResolver() {
  const zone = SOURCE.source_timezone;
  const formatter = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const civilAt = (epoch) => {
    const p = Object.fromEntries(formatter.formatToParts(new Date(epoch)).map(({ type, value }) => [type, value]));
    return `${pad(p.year, 4)}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  };
  const offsetAt = (epoch) => Date.parse(`${civilAt(epoch)}Z`) - Math.floor(epoch / 1000) * 1000;
  const offsetsByDate = new Map();
  return (date, time) => {
    const civil = `${date}T${time}`;
    const wall = Date.parse(`${civil}Z`);
    if (!offsetsByDate.has(date)) {
      const noon = Date.parse(`${date}T12:00:00Z`);
      const offsets = new Set();
      // Offsets IANA alrededor del día; nunca un offset fijo. Permite detectar
      // horas repetidas y huecos, en vez de aceptar la elección automática.
      for (let hours = -48; hours <= 48; hours += 6) offsets.add(offsetAt(noon + hours * 3600000));
      offsetsByDate.set(date, offsets);
    }
    const offsets = new Set(offsetsByDate.get(date));
    const seed = dayjs.tz(civil, zone).valueOf();
    invariant(Number.isFinite(seed), 'no se pudo resolver la zona IANA');
    offsets.add(offsetAt(seed));
    const candidates = [...new Set([...offsets].map((offset) => wall - offset))]
      .filter((epoch) => civilAt(epoch) === civil.slice(0, 19));
    if (!candidates.length) return parsed('INVALIDA', null, zone, 'La hora civil no existe en la zona de origen');
    if (candidates.length > 1) return parsed('AMBIGUA', null, zone, 'La hora civil corresponde a varios instantes UTC');
    return parsed('OK', new Date(candidates[0]).toISOString(), zone);
  };
}

function normalizeTemporal(record, originals, date1904, resolveCivil, formats) {
  const date = parseDate(record.fecha_raw, originals[DATE_COLUMN], date1904);
  const time = parseTime(record.hora_raw, originals[TIME_COLUMN]);
  for (const [kind, result, field] of [['date', date, 'fecha_raw'], ['time', time, 'hora_raw']]) {
    formats[kind][result.format] = (formats[kind][result.format] ?? 0) + 1;
    if (result.state !== 'OK') {
      const code = `${result.state === 'INCOMPLETA' ? 'MISSING' : result.state === 'AMBIGUA' ? 'AMBIGUOUS' : 'INVALID'}_${kind.toUpperCase()}`;
      record.validation_issues.push(issue(field, code, 'error', result.detail));
    }
  }
  record.fecha_local = date.value;
  record.hora_local = time.value;
  record.fecha_hora_normalizada = null;
  // Prioridad temporal: inválida, ambigua, incompleta. Otros campos no participan.
  record.normalization_status = ['INVALIDA', 'AMBIGUA', 'INCOMPLETA']
    .find((state) => date.state === state || time.state === state) ?? 'OK';
  if (record.normalization_status === 'OK') {
    const instant = resolveCivil(date.value, time.value);
    record.normalization_status = instant.state;
    record.fecha_hora_normalizada = instant.value;
    if (instant.state !== 'OK') record.validation_issues.push(issue('hora_raw',
      instant.state === 'AMBIGUA' ? 'AMBIGUOUS_TIME' : 'INVALID_TIME', 'error', instant.detail));
  }
}

// Advertencias de calidad por fila. Solo describen; nunca corrigen el valor.
function detectAnomalies(record, originals) {
  const { validation_issues: issues } = record;
  RAW_FIELDS.forEach((field, column) => {
    const value = record[field];
    if (typeof value !== 'string' || value.length === 0) return;
    if (value.trim() === '') {
      issues.push(issue(field, 'WHITESPACE_ONLY', 'warning', 'El campo contiene solo espacios en blanco'));
      return;
    }
    if (/^\s/u.test(value)) issues.push(issue(field, 'LEADING_WHITESPACE', 'warning', 'Espacio en blanco inicial conservado'));
    if (/\s$/u.test(value)) issues.push(issue(field, 'TRAILING_WHITESPACE', 'warning', 'Espacio en blanco final conservado'));
    if (value.includes('\u00a0')) issues.push(issue(field, 'CONTAINS_NBSP', 'warning', 'Contiene espacio de no separación (NBSP)'));
    if (value.includes('\r')) issues.push(issue(field, 'CONTAINS_CR', 'warning', 'Contiene retorno de carro (CR)'));
    if (value.includes('\n')) issues.push(issue(field, 'CONTAINS_LF', 'warning', 'Contiene salto de línea (LF)'));
    void column;
  });
  for (const [field, code] of Object.entries(REQUIRED_FIELDS)) {
    if (missing(record[field])) issues.push(issue(field, code, 'warning', `La fuente no contiene ${field}`));
  }
  const serial = originals[SERIAL_COLUMN];
  if (serial?.t === 'n') {
    issues.push(issue('numero_serie', 'SERIAL_STORED_AS_NUMBER', 'warning',
      'La serie estaba almacenada como número; se conserva su texto visible'));
    if (isExcelTemporal(serial)) {
      issues.push(issue('numero_serie', 'SERIAL_DATE_FORMAT', 'warning',
        `La celda numérica de la serie tiene formato de fecha (${serial.z}); se conserva su texto visible`));
    }
  }
  if (!missing(record.cant_img_guardadas_raw) && /^0+(?:\.0+)?$/.test(record.cant_img_guardadas_raw.trim())) {
    issues.push(issue('cant_img_guardadas_raw', 'ZERO_IMAGES', 'warning', 'La fila reporta 0 imágenes guardadas'));
  }
  const absent = CORE_FIELDS.filter((field) => missing(record[field]));
  if (absent.length === CORE_FIELDS.length) {
    issues.push(issue('source_row', 'BLANK_ROW', 'warning', 'La fila no contiene ningún campo base con información'));
  } else if (absent.length > 0) {
    issues.push(issue('source_row', 'PARTIAL_ROW', 'warning', `Faltan campos base: ${absent.join(', ')}`));
  }
}

function validateWorkbook(bytes, records, report) {
  const workbook = XLSX.read(bytes, {
    type: 'buffer', sheets: SOURCE.source_sheet,
    cellDates: false, cellText: true, cellNF: true, sheetStubs: true,
    cellFormula: false, cellHTML: false, bookVBA: false,
  });
  invariant(workbook.SheetNames.includes(SOURCE.source_sheet), `Hoja ausente en el XLSX: ${SOURCE.source_sheet}.`);
  const sheet = workbook.Sheets[SOURCE.source_sheet];
  invariant(Boolean(sheet) && sheet['!ref'] === DECLARED_REF, 'Rango declarado de la hoja no autorizado.');
  const date1904 = [true, 1, '1', 'true'].includes(workbook.Workbook?.WBProps?.date1904);
  invariant(date1904 === false, 'El XLSX debe usar el sistema de fechas 1900.');

  const header = readRow(sheet, 1, date1904).cells;
  invariant(isDeepStrictEqual(header, [...EXPECTED_HEADERS]), 'Encabezados A:Q del XLSX no autorizados.');

  invariant(readRow(sheet, BOUNDARY_ROW, date1904).cells.every((value) => value === null || /^\s*$/u.test(value))
    && Array.from({ length: COLUMN_COUNT }, (_, column) => sheet[XLSX.utils.encode_cell({ r: BOUNDARY_ROW - 1, c: column })]).every(isBlankCell),
  `La frontera ${BOUNDARY_ROW} del XLSX debe estar vacía.`);
  for (let row = BOUNDARY_ROW; row <= DECLARED_LAST_ROW; row++) {
    for (let column = 0; column < COLUMN_COUNT; column++) {
      invariant(isBlankCell(sheet[XLSX.utils.encode_cell({ r: row - 1, c: column })]),
        `Hay contenido posterior a la fila ${TEST_ROW} en el XLSX (fila ${row}).`);
    }
  }

  // La fila 1016 se compara semánticamente (fecha/serie pueden ser celdas numéricas).
  const test = readRow(sheet, TEST_ROW, date1904);
  const same = (column, expected) => {
    const cell = test.originals[column];
    if (!cell || cell.t === 'z') return false;
    return cell.t === 'n' ? cell.v === Number(expected) : cell.v === expected;
  };
  const testDate = parseDate(test.cells[DATE_COLUMN], test.originals[DATE_COLUMN], date1904);
  invariant(testDate.state === 'OK' && testDate.value === TEST_ROW_EXPECTED.fecha_local
    && same(6, TEST_ROW_EXPECTED.numero_serie) && same(11, TEST_ROW_EXPECTED.descripcion)
    && same(12, TEST_ROW_EXPECTED.desviacion) && same(13, TEST_ROW_EXPECTED.folio_desviacion)
    && same(15, TEST_ROW_EXPECTED.cant_img_guardadas_raw),
  `La fila ${TEST_ROW} del XLSX ya no coincide con la prueba posterior autorizada.`);
  const excluded = report.excluded_rows;
  invariant(Array.isArray(excluded) && excluded.length === 1 && isObject(excluded[0])
    && excluded[0].source_row === TEST_ROW && excluded[0].excluded === true
    && isDeepStrictEqual(excluded[0].cells, test.cells),
  `El reporte no documenta la exclusión exacta de la fila ${TEST_ROW}.`);

  // Reconstruir desde XLSX, sin copiar derivados ni incidencias del reporte.
  const resolveCivil = createCivilResolver();
  const formats = { date: Object.create(null), time: Object.create(null) };
  const derivedFields = [
    'fecha_local', 'hora_local', 'fecha_hora_normalizada',
    'normalization_status', 'validation_issues',
  ];
  records.forEach((record) => {
    const { cells, originals, issues } = readRow(sheet, record.source_row, date1904);
    invariant(isDeepStrictEqual(cells, record.source_payload.cells),
      `Las celdas del XLSX no coinciden con el reporte en source_row ${record.source_row}.`);
    const recalculated = {
      ...Object.fromEntries(RAW_FIELDS.map((field, column) => [field, cells[column]])),
      source_row: record.source_row, validation_issues: issues,
    };
    normalizeTemporal(recalculated, originals, date1904, resolveCivil, formats);
    detectAnomalies(recalculated, originals);
    if (EXPECTED_INCOMPLETE_ROWS.includes(record.source_row)) {
      invariant(missing(cells[DATE_COLUMN]) && missing(cells[TIME_COLUMN])
        && recalculated.normalization_status === 'INCOMPLETA'
        && recalculated.fecha_local === null && recalculated.hora_local === null
        && recalculated.fecha_hora_normalizada === null
        && record.normalization_status === 'INCOMPLETA'
        && record.fecha_local === null && record.hora_local === null
        && record.fecha_hora_normalizada === null,
      `La fila incompleta ${record.source_row} debe conservar fecha/hora ausentes y derivados null.`);
    }
    // El dry-run emite representaciones canónicas y un array de incidencias ordenado.
    for (const field of derivedFields) {
      invariant(isDeepStrictEqual(recalculated[field], record[field]),
        `Derivado ${field} no reproducible desde XLSX en source_row ${record.source_row}.`);
    }
  });
}

// ---------------------------------------------------------------------------
// Validación del reporte.
// ---------------------------------------------------------------------------

function validateTemporal(record, formatter) {
  const row = record.source_row;
  if (record.normalization_status !== 'OK') {
    invariant(record.fecha_hora_normalizada === null
      && (record.fecha_local === null || /^\d{4}-\d{2}-\d{2}$/.test(record.fecha_local))
      && (record.hora_local === null || /^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(record.hora_local)),
    `Campos temporales inválidos en source_row ${row}.`);
    return;
  }
  invariant(/^\d{4}-\d{2}-\d{2}$/.test(record.fecha_local)
    && /^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(record.hora_local)
    && typeof record.fecha_hora_normalizada === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.fecha_hora_normalizada),
  `Campos temporales inválidos en source_row ${row}.`);
  const instant = new Date(record.fecha_hora_normalizada);
  invariant(Number.isFinite(instant.getTime()) && instant.toISOString() === record.fecha_hora_normalizada,
    `Instante inválido en source_row ${row}.`);
  const parts = Object.fromEntries(formatter.formatToParts(instant).map(({ type, value }) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}.${pad(instant.getUTCMilliseconds(), 3)}`;
  invariant(date === record.fecha_local && time === record.hora_local,
    `El instante no corresponde a America/Mexico_City en source_row ${row}.`);
}

function groupDuplicates(records, field) {
  const groups = new Map();
  for (const record of records) {
    const value = record[field];
    if (value === null || /^\s*$/u.test(value)) continue;
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(record);
  }
  return [...groups].filter(([, group]) => group.length > 1).map(([value, group]) => ({
    value,
    source_rows: group.map((record) => record.source_row),
    legacy_ids: group.map((record) => record.source_legacy_id),
    occurrence_count: group.length,
  }));
}

function validateReport(report) {
  invariant(isObject(report), 'El reporte debe ser un objeto.');
  const expected = {
    mode: 'DRY_RUN', db_writes: 0, snapshot_sha256: SOURCE.source_snapshot_sha256,
    source_spreadsheet_id: SOURCE.source_spreadsheet_id, source_tab_gid: SOURCE.source_tab_gid,
    source_sheet: SOURCE.source_sheet, declared_range: DECLARED_REF, range: `A${FIRST_ROW}:Q${LAST_ROW}`,
    expected_rows: ROW_COUNT, processed_rows: ROW_COUNT, included_rows: ROW_COUNT,
    source_hash_version: SOURCE.source_hash_version, source_timezone: SOURCE.source_timezone,
    first_source_row: FIRST_ROW, last_source_row: LAST_ROW,
    nothing_after_excluded_row_within_declared_range: true,
  };
  for (const [field, value] of Object.entries(expected)) {
    invariant(report[field] === value, `Metadato del reporte no autorizado: ${field}.`);
  }
  invariant(isObject(report.boundary_row) && report.boundary_row.source_row === BOUNDARY_ROW
    && report.boundary_row.empty === true && report.boundary_row.included_in_records === false,
  `La frontera ${BOUNDARY_ROW} debe existir vacía y permanecer excluida.`);
  invariant(isDeepStrictEqual(report.normalization_counts, EXPECTED_COUNTS), 'Conteos temporales no autorizados.');
  invariant(Array.isArray(report.headers) && isDeepStrictEqual(report.headers, [...EXPECTED_HEADERS]),
    'Encabezados A:Q del reporte no autorizados.');
  invariant(Array.isArray(report.records) && report.records.length === ROW_COUNT,
    `Se requieren exactamente ${ROW_COUNT} records.`);
  invariant(typeof report.records_digest_sha256 === 'string' && HASH_PATTERN.test(report.records_digest_sha256),
    'El reporte no contiene un records_digest_sha256 válido.');

  const formatter = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
    timeZone: SOURCE.source_timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const counts = { OK: 0, INCOMPLETA: 0, INVALIDA: 0, AMBIGUA: 0 };
  const issueCounts = {};
  const fieldSet = sorted(RECORD_FIELDS);
  const incompleteRows = [];
  let warningRows = 0, errorRows = 0;
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
    invariant(isObject(payload) && isDeepStrictEqual(Object.keys(payload).sort(), ['cells', 'headers'])
      && Array.isArray(payload.headers) && payload.headers.length === COLUMN_COUNT
      && isDeepStrictEqual(payload.headers, [...EXPECTED_HEADERS])
      && Array.isArray(payload.cells) && payload.cells.length === COLUMN_COUNT
      && payload.cells.every(isStringOrNull),
    `Payload inválido en source_row ${row}.`);
    invariant(RAW_FIELDS.every((field, column) => record[field] === payload.cells[column]),
      `Mapeo A:Q inválido en source_row ${row}.`);
    invariant(typeof record.source_hash === 'string' && HASH_PATTERN.test(record.source_hash)
      && record.source_hash === sha256(Buffer.from(JSON.stringify(payload.cells), 'utf8')),
    `source_hash v1 inválido en source_row ${row}.`);
    invariant(Array.isArray(record.validation_issues) && record.validation_issues.every((item) => isObject(item)
      && ['field', 'code', 'detail'].every((field) => typeof item[field] === 'string')
      && ['warning', 'error'].includes(item.severity)), `validation_issues inválido en source_row ${row}.`);
    invariant(Object.prototype.hasOwnProperty.call(counts, record.normalization_status),
      `Estado de normalización inválido en source_row ${row}.`);
    validateTemporal(record, formatter);
    counts[record.normalization_status]++;
    if (record.normalization_status === 'INCOMPLETA') incompleteRows.push(row);
    for (const item of record.validation_issues) issueCounts[item.code] = (issueCounts[item.code] ?? 0) + 1;
    warningRows += Number(record.validation_issues.some((item) => item.severity === 'warning'));
    errorRows += Number(record.validation_issues.some((item) => item.severity === 'error'));
  });
  invariant(isDeepStrictEqual(counts, EXPECTED_COUNTS), 'Los conteos recalculados de records no coinciden con los autorizados.');
  invariant(isDeepStrictEqual(incompleteRows, [...EXPECTED_INCOMPLETE_ROWS]),
    'Las filas INCOMPLETA no son exactamente 833 y 834.');
  invariant(report.rows_with_warnings === warningRows && report.rows_with_errors === errorRows
    && isDeepStrictEqual(report.validation_issue_counts, issueCounts),
  'Los resúmenes de validation_issues del reporte no coinciden con los records.');

  // Digest global del dry-run: SHA-256 de JSON.stringify([[source_row, source_hash], ...]).
  const digest = sha256(Buffer.from(JSON.stringify(report.records.map((r) => [r.source_row, r.source_hash])), 'utf8'));
  invariant(digest === report.records_digest_sha256, 'records_digest_sha256 no coincide con los 1014 records del reporte.');

  const records = report.records;
  const locals = sorted(records.map((record) => record.fecha_local).filter(Boolean));
  const instants = sorted(records.map((record) => record.fecha_hora_normalizada).filter(Boolean));
  invariant(isObject(report.temporal_range) && report.temporal_range.min_local_date === locals[0]
    && report.temporal_range.max_local_date === locals.at(-1)
    && report.temporal_range.min_instant_utc === instants[0]
    && report.temporal_range.max_instant_utc === instants.at(-1)
    && report.temporal_range.valid_instants === instants.length
    && instants.length === EXPECTED_COUNTS.OK,
  'El rango temporal del reporte no coincide con los records.');

  invariant(isObject(report.duplicates), 'El reporte no contiene duplicates.');
  for (const [reportKey, field] of [['source_legacy_id', 'source_legacy_id'], ['numero_serie', 'numero_serie'], ['carpeta_drive_url', 'carpeta_drive_url']]) {
    invariant(isDeepStrictEqual(report.duplicates[reportKey], groupDuplicates(records, field)),
      `Duplicados de ${reportKey} del reporte no coinciden con los records.`);
  }
  return records;
}

// ---------------------------------------------------------------------------
// Comparación y escritura.
// ---------------------------------------------------------------------------

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
  await validateSchemaContract(client);
}

async function validateSchemaContract(client) {
  const table = await client.query(SQL.table);
  invariant(table.rows.length === 1 && table.rows[0].table_name !== null, `No existe ${TABLE}.`);
  invariant(table.rows[0].relkind === 'r' && table.rows[0].relispartition === false
    && table.rows[0].has_inheritance === false,
  'Se requiere la tabla ordinaria local, sin particiones ni herencia.');
  const catalog = await client.query(SQL.columns, ['public', 'procesos_liberacion_legacy']);
  const columns = new Set(catalog.rows.map((row) => row.column_name));
  const missing = [...EXPECTED_DB_COLUMNS].filter((field) => !columns.has(field));
  const extra = [...columns].filter((field) => !EXPECTED_DB_COLUMNS.has(field));
  const forbidden = FORBIDDEN_COLUMNS.filter((field) => columns.has(field));
  invariant(missing.length === 0 && extra.length === 0 && forbidden.length === 0,
    `Esquema no autorizado: faltantes=${missing.join(',')}; adicionales=${extra.join(',')}; prohibidas=${forbidden.join(',')}.`);
  for (const column of catalog.rows) {
    const [dataType, notNull] = EXPECTED_COLUMN_CONTRACT[column.column_name];
    invariant(column.data_type === dataType && column.not_null === notNull
      && column.identity_kind === (column.column_name === 'id' ? 'a' : '')
      && column.generated_kind === '',
    `Contrato de columna no autorizado: ${column.column_name}.`);
  }
  const constraints = await client.query(SQL.constraints);
  const matches = (constraint, kind, fields) => constraint.kind === kind
    && constraint.validated === true && constraint.deferrable === false
    && constraint.index_valid === true && constraint.index_ready === true
    && isDeepStrictEqual(constraint.columns, fields);
  invariant(constraints.rows.some((constraint) => matches(constraint, 'p', ['id'])),
    'Se requiere PK válida e inmediata sobre id.');
  invariant(constraints.rows.some((constraint) => matches(constraint, 'u',
    ['source_spreadsheet_id', 'source_tab_gid', 'source_row'])),
  'Se requiere UNIQUE válido e inmediato sobre la posición exacta de procedencia.');
  const hooks = await client.query(SQL.hooks);
  invariant(hooks.rows.length === 0,
    `Triggers de usuario o reglas no autorizados: ${JSON.stringify(hooks.rows)}.`);
}

async function apply(records, password) {
  const client = new Client({ ...DB, password });
  let transactionOpen = false;
  let failed = false;
  let connectionError = null;
  let commitPending = false;
  // El listener nunca lanza: las consultas pendientes rechazan y el guard
  // también detecta un error ocurrido entre dos consultas.
  client.on('error', (error) => {
    connectionError ??= error;
  });
  const session = {
    async query(...args) {
      if (connectionError) throw connectionError;
      const result = await client.query(...args);
      if (connectionError) throw connectionError;
      return result;
    },
  };
  try {
    await client.connect();
    if (connectionError) throw connectionError;
    await preflight(session);
    let classification = classify(records, await readPositions(session));
    printClassification('Preflight de posiciones', classification);
    requireNoConflicts(classification);
    // El preflight nunca basta para declarar idempotencia: siempre se
    // continúa con BEGIN + LOCK y se reclasifica bajo lock.
    await session.query(SQL.begin);
    transactionOpen = true;
    await session.query(SQL.lock);
    // El contrato se comprueba de nuevo sobre la tabla ya bloqueada.
    await validateSchemaContract(session);
    // READ COMMITTED: la lectura tras esperar el lock ve importaciones ya terminadas.
    classification = classify(records, await readPositions(session));
    printClassification('Posiciones bajo lock', classification);
    requireNoConflicts(classification);
    if (classification.NEW.length === 0) {
      invariant(classification.EXACT_EXISTING.length === ROW_COUNT,
        'La idempotencia exige las 1014 posiciones exactas bajo lock.');
      await session.query(SQL.rollback);
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
      await session.query(SQL.insert, values);
    }
    const persisted = await readPositions(session);
    const verification = classify(records, persisted);
    requireNoConflicts(verification);
    invariant(persisted.length === ROW_COUNT && verification.NEW.length === 0
      && verification.EXACT_EXISTING.length === ROW_COUNT && verification.CONFLICT.length === 0,
    `Verificación incompleta: se requieren ${ROW_COUNT}/${ROW_COUNT} filas exactas.`);
    commitPending = true;
    const committed = await session.query(SQL.commit);
    invariant(committed.command === 'COMMIT', 'PostgreSQL no confirmó COMMIT.');
    commitPending = false;
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
    if (commitPending) {
      throw new Error(
        'No se pudo confirmar COMMIT; el resultado puede ser indeterminado. '
        + 'La forma segura de resolverlo es volver a ejecutar el mismo apply local '
        + 'con el mismo XLSX y reporte: su idempotencia determinará si las filas '
        + 'ya quedaron confirmadas. Causa: ' + String(error.message),
        { cause: error },
      );
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
  validateWorkbook(bytes, records, report);
  console.log(`Snapshot, XLSX y reporte validados: ${ROW_COUNT} filas (source_row ${FIRST_ROW}-${LAST_ROW}).`);
  await apply(records, password);
}

main().catch((error) => {
  const password = process.env.PGPASSWORD;
  const message = String(error.message);
  console.error(`APLICACIÓN LOCAL ABORTADA: ${password ? message.split(password).join('[REDACTADO]') : message}`);
  process.exitCode = 1;
});
