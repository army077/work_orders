import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const SOURCE = Object.freeze({
  source_spreadsheet_id: '1BlTb7Btw_BwWjEXHLlfwq0GFAnC5d0G8GjGHc36SW5U',
  source_tab_gid: 1418261973,
  source_sheet: 'Proceso de inspeccion',
  first_source_row: 2,
  last_source_row: 3935,
  expected_rows: 3934,
  source_timezone: 'America/Mexico_City',
  source_hash_version: 1,
  source_snapshot_sha256: 'affe04cfa5199fbc24ceb45c6a5b2524ec3786c88b4fdc87dc12d3c42b0e1fd5',
});
const OBSERVED_SIZE = 2467949;
const BOUNDARY_ROW = 3936;
const FIRST_DATE = '2023-06-30';
const LAST_DATE = '2025-12-17';
const DAY_MS = 86400000;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const FIELDS = Object.freeze([
  'source_legacy_id', 'num_semana_raw', 'correo', 'usuario',
  'fecha_raw', 'hora_raw', 'numero_serie', 'equipo_afectado',
  'accesorio', 'numero_revision_raw', 'responsable_defecto_incidente',
  'parte_afectada', 'area_responsable', 'causa_raiz',
  'clasificacion_defecto_incidente', 'tipo_defectivo',
  'clasificacion_defectivo', 'disposicion_defectivo', 'descripcion',
  'desviacion', 'folio_desviacion', 'carpeta_drive_url',
  'cant_img_guardadas_raw', 'version_app',
]);
const REQUIRED_FIELDS = Object.freeze({
  source_legacy_id: 'MISSING_LEGACY_ID', correo: 'MISSING_EMAIL',
  usuario: 'MISSING_USER', numero_serie: 'MISSING_SERIAL',
  equipo_afectado: 'MISSING_MACHINE', numero_revision_raw: 'MISSING_REVISION',
  responsable_defecto_incidente: 'MISSING_RESPONSIBLE',
  descripcion: 'MISSING_DESCRIPTION', carpeta_drive_url: 'MISSING_DRIVE_FOLDER',
});

function invariant(condition, detail) {
  if (!condition) throw new Error(`Invariante incumplida: ${detail}`);
}
const missing = (value) => value === null || /^\s*$/u.test(value);
const pad = (value, width = 2) => String(value).padStart(width, '0');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const issue = (field, code, severity, detail) => ({ field, code, severity, detail });

// v1 = SHA-256(UTF-8(JSON.stringify(cells))). Array ordenado de 24 strings/null.
// Sin trim, normalización, metadatos, headers ni campos derivados. No deduplica.
function sourceHashV1(cells) {
  invariant(cells.length === 24 && cells.every((v) => v === null || typeof v === 'string'),
    'cells debe contener exactamente 24 strings/null');
  return sha256(Buffer.from(JSON.stringify(cells), 'utf8'));
}

function inputPath(args) {
  if (args.length !== 2 || args[0] !== '--input' || !args[1]) {
    throw new Error('Uso: node context/database/importers/import_desviaciones_legacy.js --input <ruta-absoluta.xlsx>');
  }
  const input = args[1];
  invariant(isAbsolute(input) && !input.startsWith('\\\\') && !input.startsWith('//')
    && extname(input).toLowerCase() === '.xlsx', 'el input debe ser un XLSX local con ruta absoluta');
  return resolve(input);
}

function readRow(sheet, row, date1904) {
  const issues = [];
  const originals = [];
  const cells = FIELDS.map((field, column) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: row - 1, c: column })];
    originals.push(cell);
    if (!cell || cell.t === 'z') return null;
    if (typeof cell.w === 'string') return cell.w; // Incluye el string vacío.
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
  invariant(cells.length === 24 && cells.every((v) => v === null || typeof v === 'string'),
    `fila ${row}: se requieren 24 valores string/null`);
  return { cells, originals, issues };
}

function validDate(year, month, day) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12
    && day >= 1 && day <= days[month - 1];
}
const parsed = (state, value, format, detail = '') => ({ state, value, format, detail });
const isExcelTemporal = (cell) => cell?.t === 'n'
  && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z);

// Formatos textuales admitidos según el contrato: D/M/YYYY (día primero)
// y YYYY-MM-DD. No se adivina MM/DD ni el siglo de un año de dos dígitos.
// Los formatos realmente observados se contabilizan al ejecutar el dry-run.
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
    const text = raw.trim(); // Solo copia para interpretar; raw/cells no cambian.
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

// H:mm[:ss[.SSS]] o H.mm.ss en 24 horas; h:mm[:ss[.SSS]] con
// AM/PM, a.m./p.m. o los marcadores Unicode ص (AM) y م (PM).
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
    const text = raw.trim(); // Solo copia para interpretar; raw/cells no cambian.
    const dotted = /^(\d{1,2})\.(\d{2})\.(\d{2})$/.exec(text);
    const match = dotted ?? /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?\s*(?:([ap])\.?\s*m\.?|([صم]))?$/i.exec(text);
    if (!match) return parsed('INVALIDA', null, format, 'Formato de hora no reconocido');
    hour = Number(match[1]);
    minute = Number(match[2]);
    second = Number(match[3] ?? 0);
    millisecond = Number((match[4] ?? '').padEnd(3, '0'));
    const meridiem = match[5]?.toLowerCase()
      ?? (match[6] === 'ص' ? 'a' : match[6] === 'م' ? 'p' : undefined);
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
    const wall = Date.parse(`${civil}Z`); // Coordenadas civiles, aún no el instante real.
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
  const date = parseDate(record.fecha_raw, originals[4], date1904);
  const time = parseTime(record.hora_raw, originals[5]);
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
  if (date.value && (date.value < FIRST_DATE || date.value > LAST_DATE)) {
    record.validation_issues.push(issue('fecha_raw', 'DATE_OUT_OF_EXPECTED_RANGE', 'warning',
      `Fecha fuera del periodo ${FIRST_DATE} a ${LAST_DATE}`));
  }
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

function annotateDuplicates(records) {
  const groups = new Map();
  for (const record of records) {
    if (missing(record.source_legacy_id)) continue;
    if (!groups.has(record.source_legacy_id)) groups.set(record.source_legacy_id, []);
    groups.get(record.source_legacy_id).push(record);
  }
  const duplicates = [];
  for (const [legacy_id, group] of groups) {
    if (group.length < 2) continue;
    duplicates.push({ legacy_id, source_rows: group.map((record) => record.source_row), occurrence_count: group.length });
    for (const record of group) record.validation_issues.push(issue('source_legacy_id',
      'DUPLICATE_LEGACY_ID', 'warning', `ID original repetido en ${group.length} filas; se conservan todas`));
  }
  return duplicates;
}

function validateRecords(records, headers) {
  invariant(FIELDS.length === 24 && headers.length === 24, 'se requieren 24 columnas y encabezados');
  invariant(records.length === SOURCE.expected_rows, `processed_rows debe ser ${SOURCE.expected_rows}`);
  records.forEach((record, index) => {
    invariant(record.source_row === SOURCE.first_source_row + index
      && record.source_row <= SOURCE.last_source_row && record.source_row !== BOUNDARY_ROW,
    'secuencia de filas fuera del rango histórico');
    invariant(record.source_payload.headers.length === 24
      && record.source_payload.headers.every((header, column) => header === headers[column])
      && FIELDS.every((field, column) => record[field] === record.source_payload.cells[column]),
    `payload o mapeo inválido en fila ${record.source_row}`);
    invariant(HASH_PATTERN.test(record.source_hash)
      && record.source_hash === sourceHashV1(record.source_payload.cells), `hash inválido en fila ${record.source_row}`);
    invariant(['OK', 'INCOMPLETA', 'INVALIDA', 'AMBIGUA'].includes(record.normalization_status)
      && (record.normalization_status === 'OK') === (record.fecha_hora_normalizada !== null),
    `estado temporal inválido en fila ${record.source_row}`);
  });
  invariant(records[0].source_row === 2 && records.at(-1).source_row === 3935, 'límites históricos incorrectos');
}

// Único destino de escritura: un reporte JSON nuevo en output/ (ignorado por Git).
function saveReport(report) {
  const directory = fileURLToPath(new URL('./output/', import.meta.url));
  const filename = `desviaciones_legacy_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, filename);
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return destination;
}

function main() {
  const input = inputPath(process.argv.slice(2));
  const bytes = readFileSync(input);
  const snapshotHash = sha256(bytes);
  if (snapshotHash !== SOURCE.source_snapshot_sha256) {
    throw new Error(`Snapshot no autorizado.\nHash esperado: ${SOURCE.source_snapshot_sha256}\nHash encontrado: ${snapshotHash}`);
  }
  // Se procesa exactamente el mismo Buffer verificado, sin reabrir el archivo.
  const workbook = XLSX.read(bytes, {
    type: 'buffer', sheets: SOURCE.source_sheet, sheetRows: BOUNDARY_ROW,
    cellDates: false, cellText: true, cellNF: true, sheetStubs: true,
    cellFormula: false, cellHTML: false, bookVBA: false,
  });
  invariant(workbook.SheetNames.includes(SOURCE.source_sheet), `hoja ausente: ${SOURCE.source_sheet}`);
  const sheet = workbook.Sheets[SOURCE.source_sheet];
  invariant(Boolean(sheet), 'hoja autorizada no disponible');
  const date1904 = [true, 1, '1', 'true'].includes(workbook.Workbook?.WBProps?.date1904);
  const headerRow = readRow(sheet, 1, date1904);
  const headers = headerRow.cells;
  const boundary = readRow(sheet, BOUNDARY_ROW, date1904);
  invariant(boundary.cells.some((value) => !missing(value)), 'no hay datos en la frontera 3936');
  const resolveCivil = createCivilResolver();
  const formats = { date: Object.create(null), time: Object.create(null) };
  const records = [];
  for (let sourceRow = SOURCE.first_source_row; sourceRow <= SOURCE.last_source_row; sourceRow++) {
    const { cells, originals, issues } = readRow(sheet, sourceRow, date1904);
    const sourceHash = sourceHashV1(cells); // Antes de interpretar o validar contenido.
    const record = {
      ...Object.fromEntries(FIELDS.map((field, column) => [field, cells[column]])),
      source_spreadsheet_id: SOURCE.source_spreadsheet_id,
      source_tab_gid: SOURCE.source_tab_gid, source_sheet: SOURCE.source_sheet,
      source_row: sourceRow, source_snapshot_sha256: snapshotHash,
      source_hash: sourceHash, source_hash_version: SOURCE.source_hash_version,
      source_timezone: SOURCE.source_timezone,
      source_payload: { headers, cells }, validation_issues: issues,
    };
    for (const [field, code] of Object.entries(REQUIRED_FIELDS)) {
      if (missing(record[field])) issues.push(issue(field, code, 'warning', `La fuente no contiene ${field}`));
    }
    const populated = cells.filter((value) => !missing(value)).length;
    if (populated <= 3) issues.push(issue('source_payload', populated === 0 ? 'EMPTY_SOURCE_ROW' : 'SPARSE_SOURCE_ROW',
      'warning', `Fila conservada con ${populated} de 24 celdas con contenido`));
    normalizeTemporal(record, originals, date1904, resolveCivil, formats);
    records.push(record);
  }
  const duplicateIds = annotateDuplicates(records);
  validateRecords(records, headers);
  const normalizationCounts = { OK: 0, INCOMPLETA: 0, INVALIDA: 0, AMBIGUA: 0 };
  const issueCounts = Object.create(null);
  for (const record of records) {
    normalizationCounts[record.normalization_status]++;
    for (const item of record.validation_issues) issueCounts[item.code] = (issueCounts[item.code] ?? 0) + 1;
  }
  const report = {
    mode: 'DRY_RUN', snapshot_sha256: snapshotHash, snapshot_size_bytes: bytes.length,
    snapshot_size_matches_observed: bytes.length === OBSERVED_SIZE,
    source_spreadsheet_id: SOURCE.source_spreadsheet_id,
    source_tab_gid: SOURCE.source_tab_gid, source_sheet: SOURCE.source_sheet,
    range: 'A2:X3935', expected_rows: SOURCE.expected_rows, processed_rows: records.length,
    source_hash_version: SOURCE.source_hash_version, source_timezone: SOURCE.source_timezone,
    normalization_counts: normalizationCounts, validation_issue_counts: issueCounts,
    duplicate_legacy_ids: duplicateIds,
    rows_with_warnings: records.filter((r) => r.validation_issues.some((i) => i.severity === 'warning')).length,
    rows_with_errors: records.filter((r) => r.validation_issues.some((i) => i.severity === 'error')).length,
    first_source_row: records[0].source_row, last_source_row: records.at(-1).source_row,
    excluded_boundary_row: { source_row: BOUNDARY_ROW, exists: true, included_in_records: false, source_legacy_id: boundary.cells[0] },
    header_validation_issues: headerRow.issues,
    observed_temporal_formats: formats, excel_date_system: date1904 ? '1904' : '1900',
    runtime_versions: { node: process.versions.node, icu: process.versions.icu, tz: process.versions.tz, xlsx: XLSX.version },
    records,
  };
  const destination = saveReport(report);
  console.log([
    'Snapshot válido: SI', `SHA-256: ${snapshotHash}`, `Archivo: ${input}`,
    `Hoja: ${SOURCE.source_sheet}`, `Rango: ${report.range}`,
    `Filas esperadas: ${SOURCE.expected_rows}`, `Filas procesadas: ${records.length}`,
    `Normalización OK: ${normalizationCounts.OK}`, `Incompletas: ${normalizationCounts.INCOMPLETA}`,
    `Inválidas: ${normalizationCounts.INVALIDA}`, `Ambiguas: ${normalizationCounts.AMBIGUA}`,
    `Filas con warnings: ${report.rows_with_warnings}`, `Filas con errores: ${report.rows_with_errors}`,
    `IDs legacy repetidos: ${duplicateIds.length}`, `Reporte: ${destination}`,
    'Escrituras DB: 0', 'DRY-RUN COMPLETADO',
  ].join('\n'));
}

try {
  main();
} catch (error) {
  console.error(`DRY-RUN ABORTADO: ${error.message}`);
  process.exitCode = 1;
}
