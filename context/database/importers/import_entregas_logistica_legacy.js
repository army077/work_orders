import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import XLSX from 'xlsx';

// Lectura/dry-run sin DB, HTTP, Drive, escrituras ni conversion a UTC.
// node context/database/importers/import_entregas_logistica_legacy.js --input <xlsx-absoluto>
export const SOURCE = Object.freeze({
  sha256: 'affe04cfa5199fbc24ceb45c6a5b2524ec3786c88b4fdc87dc12d3c42b0e1fd5',
  sheet: 'Entregas', firstRow: 2, lastRow: 1003, count: 1002,
});
export const HEADERS = Object.freeze([
  '--', 'CORREO', 'USUARIO', 'FECHA', 'HORA', 'PEDIDO', 'EQUIPO', 'CHOFER',
  'OBSERVACIONES', 'Lugar donde se instalara', 'LATITUDE', 'LONGITUDE',
  'Cant.img.guardadas', 'Carpeta Drive', 'UBICACION', 'Version \nApp',
  'Ticket', 'Informacion Correcta?', '¿Actualizado en ZOHO?', 'Comentarios',
]);
const LETTERS = 'ABCDEFGHIJKLMNOPQRST'.split('');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export function invariant(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

// Orden canonico independiente del orden de claves de JSONB.
export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) =>
      JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export const legacyKey = (snapshot, sheet, row) =>
  sha256(canonicalJson([snapshot, sheet, row]));
export const contentHash = (rawPayload) => sha256(canonicalJson(rawPayload));

function originalCell(cell) {
  if (!cell) return null;
  invariant(['s', 'n', 'b', 'z'].includes(cell.t), 'UNSUPPORTED_CELL_TYPE');
  const v = cell.v ?? null;
  invariant(v === null || ['string', 'boolean', 'number'].includes(typeof v),
    'UNSUPPORTED_CELL_VALUE');
  invariant(typeof v !== 'number' || Number.isFinite(v), 'NON_FINITE_CELL');
  return {
    t: cell.t, v, w: cell.w ?? null, z: cell.z ?? null, f: cell.f ?? null,
    hyperlink: cell.l ? {
      target: cell.l.Target ?? null, tooltip: cell.l.Tooltip ?? null,
    } : null,
  };
}
const value = (cell) => !cell || cell.t === 'z' ? null : cell.v;
const text = (cell) => {
  const v = value(cell);
  return v === null ? null : typeof v === 'string' ? v : cell.w ?? String(v);
};
const number = (cell) => {
  const v = value(cell);
  invariant(v === null || typeof v === 'number', 'EXPECTED_NUMBER');
  return v;
};
const boolean = (cell) => {
  const v = value(cell);
  invariant(v === null || typeof v === 'boolean', 'EXPECTED_BOOLEAN');
  return v;
};
const pad = (n) => String(n).padStart(2, '0');

export function localDatetime(dateCell, timeCell) {
  const serial = value(dateCell);
  invariant(typeof serial === 'number' && Number.isInteger(serial)
    && serial > 60 && serial < 2958466, 'INVALID_EXCEL_DATE');
  const d = XLSX.SSF.parse_date_code(serial, { date1904: false });
  invariant(Boolean(d), 'INVALID_EXCEL_DATE');
  const time = value(timeCell);
  let h, m, s;
  if (typeof time === 'number') {
    invariant(time >= 0 && time < 1, 'INVALID_EXCEL_TIME');
    const seconds = Math.round(time * 86400);
    invariant(Math.abs(time * 86400 - seconds) < 0.0001, 'SUBSECOND_TIME_UNEXPECTED');
    h = Math.floor(seconds / 3600); m = Math.floor(seconds % 3600 / 60); s = seconds % 60;
  } else {
    const match = typeof time === 'string'
      && /^(\d{1,2}):(\d{2}):(\d{2})\s*([ap])\.m\.$/i.exec(time);
    invariant(match && Number(match[1]) >= 1 && Number(match[1]) <= 12,
      'INVALID_TEXT_TIME');
    h = Number(match[1]) % 12 + (match[4].toLowerCase() === 'p' ? 12 : 0);
    m = Number(match[2]); s = Number(match[3]);
  }
  invariant(h >= 0 && h < 24 && m >= 0 && m < 60 && s >= 0 && s < 60,
    'INVALID_TIME');
  return String(d.y).padStart(4, '0') + '-' + pad(d.m) + '-' + pad(d.d)
    + 'T' + pad(h) + ':' + pad(m) + ':' + pad(s);
}

export function folderId(url) {
  invariant(typeof url === 'string', 'MISSING_DRIVE_FOLDER_URL');
  let parsed;
  try { parsed = new URL(url); } catch { invariant(false, 'INVALID_DRIVE_FOLDER_URL'); }
  const match = /^\/drive\/folders\/([A-Za-z0-9_-]+)\/?$/.exec(parsed.pathname);
  invariant(parsed.protocol === 'https:' && parsed.hostname === 'drive.google.com'
    && !parsed.username && !parsed.password && match, 'INVALID_DRIVE_FOLDER_URL');
  return match[1];
}

export function buildRecord(cells, row) {
  invariant(Number.isInteger(row) && row >= SOURCE.firstRow && row <= SOURCE.lastRow,
    'SOURCE_ROW_OUT_OF_RANGE');
  invariant(isDeepStrictEqual(Object.keys(cells).sort(), [...LETTERS].sort()),
    'INVALID_SOURCE_COLUMNS');
  const get = (column) => cells[column];
  const pedido = value(get('F'));
  invariant(pedido === null || typeof pedido === 'string'
    || Number.isSafeInteger(pedido), 'UNSAFE_ORDER_VALUE');
  const raw_payload = { version: 1, cells };
  const warnings = [];
  const warn = (code, field) => warnings.push({ code, field });
  if (pedido === 0 || pedido === 1) warn('ORDER_ZERO_OR_ONE', 'pedido');
  const images = number(get('M'));
  invariant(images === null || Number.isSafeInteger(images), 'INVALID_IMAGE_COUNT');
  if (images > 15) warn('REPORTED_IMAGE_COUNT_ABOVE_15', 'legacy_image_count');
  if (typeof value(get('I')) === 'number') warn('NUMERIC_OBSERVATION', 'observaciones');
  const latitude = number(get('K')), longitude = number(get('L'));
  const ubicacion = text(get('O'));
  if (ubicacion !== null) {
    const match = /\/maps\/search\/([+-]?[0-9.]+),\+?([+-]?[0-9.]+)/.exec(ubicacion);
    if (!match || !Number.isFinite(Number(match[1])) || !Number.isFinite(Number(match[2]))) {
      warn('LOCATION_URL_UNPARSEABLE', 'ubicacion');
    } else if (latitude !== null && longitude !== null
      && (Math.abs(Number(match[1]) - latitude) > 1e-7
        || Math.abs(Number(match[2]) - longitude) > 1e-7)) {
      warn('LOCATION_COORDINATES_MISMATCH', 'ubicacion');
    }
  }
  const url = text(get('N'));
  return {
    source_snapshot_sha256: SOURCE.sha256, source_sheet: SOURCE.sheet, source_row: row,
    legacy_key: legacyKey(SOURCE.sha256, SOURCE.sheet, row),
    content_hash: contentHash(raw_payload),
    legacy_correlative: text(get('A')), correo: text(get('B')), usuario: text(get('C')),
    fecha_raw: text(get('D')), hora_raw: text(get('E')),
    local_datetime: localDatetime(get('D'), get('E')),
    pedido: pedido === null ? null : String(pedido),
    equipo: text(get('G')), chofer: text(get('H')), observaciones: text(get('I')),
    instalara: text(get('J')), latitude, longitude, legacy_image_count: images,
    drive_folder_url: url, drive_folder_id: folderId(url), ubicacion,
    app_version: text(get('P')), ticket: text(get('Q')),
    informacion_correcta: boolean(get('R')), actualizado_zoho: boolean(get('S')),
    comentarios: text(get('T')), raw_payload, warnings,
  };
}

export function validateRecords(records) {
  invariant(Array.isArray(records) && records.length === SOURCE.count, 'WRONG_ROW_COUNT');
  const positions = new Set();
  for (const record of records) {
    invariant(record.raw_payload?.version === 1, 'INVALID_PAYLOAD_VERSION');
    invariant(!positions.has(record.source_row), 'DUPLICATE_SOURCE_ROW');
    positions.add(record.source_row);
    invariant(isDeepStrictEqual(record, buildRecord(record.raw_payload.cells, record.source_row)),
      'RECORD_CHANGED_AFTER_NORMALIZATION');
  }
  invariant(positions.size === SOURCE.count, 'INCOMPLETE_SOURCE_ROWS');
}

export function parseSnapshot(bytes) {
  invariant(Buffer.isBuffer(bytes) && sha256(bytes) === SOURCE.sha256,
    'UNAUTHORIZED_SNAPSHOT');
  // Solo se interpreta Entregas. Nunca se calculan formulas ni se siguen URLs.
  const wb = XLSX.read(bytes, {
    type: 'buffer', sheets: SOURCE.sheet, cellDates: false, cellNF: true,
    cellText: true, cellFormula: true, sheetStubs: true, cellHTML: false, bookVBA: false,
  });
  const sheet = wb.Sheets[SOURCE.sheet];
  const range = sheet?.['!ref'] && XLSX.utils.decode_range(sheet['!ref']);
  // sheetStubs incluye estilos vacios hasta AH; los datos autorizados son A:T.
  invariant(range && range.s.r === 0 && range.s.c === 0
    && range.e.r === 2006 && range.e.c >= 19, 'UNEXPECTED_SHEET_RANGE');
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith('!')) continue;
    const position = XLSX.utils.decode_cell(address);
    if (position.c > 19 || position.r > SOURCE.lastRow - 1) {
      invariant(!cell.f && (cell.v === undefined || cell.v === null || cell.v === ''),
        'DATA_OUTSIDE_AUTHORIZED_RANGE');
    }
  }
  invariant(![true, 1, '1', 'true'].includes(wb.Workbook?.WBProps?.date1904),
    'UNEXPECTED_DATE_SYSTEM');
  invariant(isDeepStrictEqual(LETTERS.map((c) => sheet[c + '1']?.v ?? null), HEADERS),
    'UNEXPECTED_HEADERS');
  const records = [];
  for (let row = SOURCE.firstRow; row <= SOURCE.lastRow; row++) {
    const cells = Object.fromEntries(LETTERS.map((c) => [c, originalCell(sheet[c + row])]));
    invariant(Object.values(cells).some((c) => value(c) !== null && value(c) !== ''),
      'EMPTY_SOURCE_ROW');
    records.push(buildRecord(cells, row));
  }
  validateRecords(records);
  return {
    snapshotHash: SOURCE.sha256, sourceSheet: SOURCE.sheet,
    timezone: null, count: records.length, records,
  };
}

export function inputPath(args, apply = false) {
  const usage = apply ? '--apply-local --input <xlsx-absoluto>' : '--input <xlsx-absoluto>';
  invariant(args.length === (apply ? 3 : 2) && (!apply || args[0] === '--apply-local'),
    'USAGE: ' + usage);
  const offset = apply ? 1 : 0;
  const name = args[offset + 1];
  invariant(args[offset] === '--input' && typeof name === 'string' && isAbsolute(name)
    && !name.startsWith('\\\\') && !name.startsWith('//')
    && extname(name).toLowerCase() === '.xlsx', 'USAGE: ' + usage);
  return resolve(name);
}

export const loadRecords = (input) => parseSnapshot(readFileSync(input));
export function summarize(records) {
  const anomalies = {};
  for (const r of records) for (const w of r.warnings) {
    (anomalies[w.code] ??= []).push(r.source_row);
  }
  return {
    snapshot: SOURCE.sha256, sheet: SOURCE.sheet, rows: records.length,
    timezone: null, anomalies,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(summarize(loadRecords(inputPath(process.argv.slice(2))).records)));
  } catch (error) {
    console.error('DRY-RUN ABORTADO: ' + (error.code || 'IMPORT_ERROR'));
    process.exitCode = 1;
  }
}
