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

// DRY-RUN exclusivo: no usa PostgreSQL, SQL ni red. Su único efecto de
// escritura es un reporte JSON nuevo en output/ (ignorado por Git).
const SOURCE = Object.freeze({
  source_spreadsheet_id: '1BlTb7Btw_BwWjEXHLlfwq0GFAnC5d0G8GjGHc36SW5U',
  source_tab_gid: 464343719,
  source_sheet: 'Procesos de liberacion',
  declared_ref: 'A1:Q2005',
  declared_last_row: 2005,
  first_source_row: 2,
  last_source_row: 1015,
  expected_rows: 1014,
  excluded_test_row: 1016,
  boundary_row: 1017,
  source_timezone: 'America/Mexico_City',
  source_hash_version: 1,
  source_snapshot_sha256: 'affe04cfa5199fbc24ceb45c6a5b2524ec3786c88b4fdc87dc12d3c42b0e1fd5',
});
const EXPECTED_HEADERS = Object.freeze([
  '#', 'Num de semana', 'Correo', 'Usuario', 'Fecha', 'Hora', 'Numero de serie',
  'Equipo afectado', 'Accesorio', 'Operador Responsable', 'Estacion', 'Descripcion',
  'Desviacion', 'Folio Desviacion', 'Carpeta Drive', 'Cant.img.guardadas', 'Version \nApp',
]);
const FIELDS = Object.freeze([
  'source_legacy_id', 'num_semana_raw', 'correo', 'usuario', 'fecha_raw',
  'hora_raw', 'numero_serie', 'equipo_afectado', 'accesorio',
  'operador_responsable', 'estacion_raw', 'descripcion', 'desviacion',
  'folio_desviacion', 'carpeta_drive_url', 'cant_img_guardadas_raw', 'version_app',
]);
const COLUMNS = FIELDS.length;
const DATE_COLUMN = 4;
const TIME_COLUMN = 5;
const SERIAL_COLUMN = 6;
const DAY_MS = 86400000;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
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
const TEST_ROW_EXPECTED = Object.freeze({
  fecha_local: '2026-10-01', numero_serie: '12', descripcion: 'descripcion',
  desviacion: 'desviacion', folio_desviacion: '123', cant_img_guardadas_raw: '0',
});

function invariant(condition, detail) {
  if (!condition) throw new Error(`Invariante incumplida: ${detail}`);
}
const missing = (value) => value === null || /^\s*$/u.test(value);
const pad = (value, width = 2) => String(value).padStart(width, '0');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const issue = (field, code, severity, detail) => ({ field, code, severity, detail });

// v1 = SHA-256(UTF-8(JSON.stringify(cells))). Array ordenado de 17 strings/null.
// Sin trim, normalización, metadatos, headers ni campos derivados. No deduplica.
function sourceHashV1(cells) {
  invariant(cells.length === COLUMNS && cells.every((v) => v === null || typeof v === 'string'),
    `cells debe contener exactamente ${COLUMNS} strings/null`);
  return sha256(Buffer.from(JSON.stringify(cells), 'utf8'));
}

function inputPath(args) {
  if (args.length !== 2 || args[0] !== '--input' || !args[1]) {
    throw new Error('Uso: node context/database/importers/import_procesos_liberacion_legacy.js --input <ruta-absoluta.xlsx>');
  }
  const input = args[1];
  invariant(isAbsolute(input) && !input.startsWith('\\\\') && !input.startsWith('//')
    && extname(input).toLowerCase() === '.xlsx', 'el input debe ser un XLSX local con ruta absoluta');
  return resolve(input);
}

// Representación visible de la celda. Los strings se toman tal cual (v) para
// conservar literalmente espacios, NBSP, CR y LF; el resto usa el texto
// formateado (w), igual que los otros importadores.
function readRow(sheet, row, date1904) {
  const issues = [];
  const originals = [];
  const cells = FIELDS.map((field, column) => {
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
  invariant(cells.length === COLUMNS && cells.every((v) => v === null || typeof v === 'string'),
    `fila ${row}: se requieren ${COLUMNS} valores string/null`);
  return { cells, originals, issues };
}

// Contenido literal, incluso espacios: es la prueba estricta de "vacío".
const isBlankCell = (cell) => !cell || cell.t === 'z' || cell.v === undefined || cell.v === null || cell.v === '';

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
  FIELDS.forEach((field, column) => {
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

// Duplicados exactos (o con trim) de un campo raw. Solo se reportan: no se
// deduplica ni se altera ninguna fila.
function duplicateGroups(records, field, key = (value) => value) {
  const groups = new Map();
  for (const record of records) {
    if (missing(record[field])) continue;
    const groupKey = key(record[field]);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(record);
  }
  return [...groups]
    .filter(([, group]) => group.length > 1)
    .map(([value, group]) => ({
      value,
      source_rows: group.map((record) => record.source_row),
      legacy_ids: group.map((record) => record.source_legacy_id),
      occurrence_count: group.length,
    }));
}

function validateRecords(records, headers) {
  invariant(headers.length === COLUMNS && headers.every((h, i) => h === EXPECTED_HEADERS[i]),
    'los encabezados A:Q no coinciden con los esperados');
  invariant(records.length === SOURCE.expected_rows, `processed_rows debe ser ${SOURCE.expected_rows}`);
  records.forEach((record, index) => {
    invariant(record.source_row === SOURCE.first_source_row + index
      && record.source_row <= SOURCE.last_source_row
      && record.source_row !== SOURCE.excluded_test_row && record.source_row !== SOURCE.boundary_row,
    'secuencia de filas fuera del rango de la fuente');
    invariant(record.source_payload.headers.length === COLUMNS
      && record.source_payload.cells.length === COLUMNS
      && FIELDS.every((field, column) => record[field] === record.source_payload.cells[column]),
    `payload o mapeo inválido en fila ${record.source_row}`);
    invariant(HASH_PATTERN.test(record.source_hash)
      && record.source_hash === sourceHashV1(record.source_payload.cells), `hash inválido en fila ${record.source_row}`);
    invariant(['OK', 'INCOMPLETA', 'INVALIDA', 'AMBIGUA'].includes(record.normalization_status)
      && (record.normalization_status === 'OK') === (record.fecha_hora_normalizada !== null),
    `estado temporal inválido en fila ${record.source_row}`);
  });
  invariant(records[0].source_row === SOURCE.first_source_row
    && records.at(-1).source_row === SOURCE.last_source_row, 'límites de la fuente incorrectos');
}

// La fila 1016 se excluye solo si conserva las características de prueba
// observadas; de lo contrario se aborta en vez de excluir silenciosamente.
function guardTestRow(sheet, date1904) {
  const { cells, originals } = readRow(sheet, SOURCE.excluded_test_row, date1904);
  const same = (column, expected) => {
    const cell = originals[column];
    if (!cell || cell.t === 'z') return false;
    return cell.t === 'n' ? cell.v === Number(expected) : cell.v === expected;
  };
  const date = parseDate(cells[DATE_COLUMN], originals[DATE_COLUMN], date1904);
  const checks = {
    fecha_local: date.state === 'OK' && date.value === TEST_ROW_EXPECTED.fecha_local,
    numero_serie: same(6, TEST_ROW_EXPECTED.numero_serie),
    descripcion: same(11, TEST_ROW_EXPECTED.descripcion),
    desviacion: same(12, TEST_ROW_EXPECTED.desviacion),
    folio_desviacion: same(13, TEST_ROW_EXPECTED.folio_desviacion),
    cant_img_guardadas_raw: same(15, TEST_ROW_EXPECTED.cant_img_guardadas_raw),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  invariant(failed.length === 0,
    `la fila ${SOURCE.excluded_test_row} ya no coincide con la prueba esperada (${failed.join(', ')}); no se excluye silenciosamente`);
  return {
    source_row: SOURCE.excluded_test_row,
    excluded: true,
    reason: 'Fila de prueba posterior al histórico (fecha 2026-10-01, serie 12, descripcion/desviacion de ejemplo, folio 123, 0 imágenes)',
    guard_checks: checks,
    cells,
    source_hash: sourceHashV1(cells),
    source_hash_version: SOURCE.source_hash_version,
  };
}

function assertNothingAfterTestRow(sheet) {
  const offenders = [];
  for (let row = SOURCE.boundary_row; row <= SOURCE.declared_last_row; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      if (!isBlankCell(sheet[XLSX.utils.encode_cell({ r: row - 1, c: column })])) {
        offenders.push(XLSX.utils.encode_cell({ r: row - 1, c: column }));
      }
    }
  }
  invariant(offenders.length === 0,
    `hay contenido posterior a la fila ${SOURCE.excluded_test_row}: ${offenders.slice(0, 10).join(', ')}`);
}

function saveReport(report) {
  const directory = fileURLToPath(new URL('./output/', import.meta.url));
  const filename = `procesos_liberacion_legacy_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
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
  // Se lee la hoja completa para validar el rango declarado y la frontera.
  const workbook = XLSX.read(bytes, {
    type: 'buffer', sheets: SOURCE.source_sheet,
    cellDates: false, cellText: true, cellNF: true, sheetStubs: true,
    cellFormula: false, cellHTML: false, bookVBA: false,
  });
  invariant(workbook.SheetNames.includes(SOURCE.source_sheet), `hoja ausente: ${SOURCE.source_sheet}`);
  const sheet = workbook.Sheets[SOURCE.source_sheet];
  invariant(Boolean(sheet), 'hoja autorizada no disponible');
  invariant(sheet['!ref'] === SOURCE.declared_ref, `rango declarado inesperado: ${sheet['!ref']}`);
  const date1904 = [true, 1, '1', 'true'].includes(workbook.Workbook?.WBProps?.date1904);
  const headerRow = readRow(sheet, 1, date1904);
  const headers = headerRow.cells;
  const boundary = readRow(sheet, SOURCE.boundary_row, date1904);
  invariant(boundary.cells.every(missing), `la fila frontera ${SOURCE.boundary_row} debe estar vacía`);
  assertNothingAfterTestRow(sheet);
  const excluded = guardTestRow(sheet, date1904);

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
    normalizeTemporal(record, originals, date1904, resolveCivil, formats);
    detectAnomalies(record, originals);
    records.push(record);
  }
  validateRecords(records, headers);

  const normalizationCounts = { OK: 0, INCOMPLETA: 0, INVALIDA: 0, AMBIGUA: 0 };
  const issueCounts = Object.create(null);
  for (const record of records) {
    normalizationCounts[record.normalization_status]++;
    for (const item of record.validation_issues) issueCounts[item.code] = (issueCounts[item.code] ?? 0) + 1;
  }
  const instants = records.map((r) => r.fecha_hora_normalizada).filter(Boolean).sort();
  const localDates = records.map((r) => r.fecha_local).filter(Boolean).sort();
  const rowsWith = (code) => records.filter((r) => r.validation_issues.some((i) => i.code === code)).map((r) => r.source_row);
  const fieldsWith = (code) => records
    .map((r) => ({ source_row: r.source_row, fields: r.validation_issues.filter((i) => i.code === code).map((i) => i.field) }))
    .filter((entry) => entry.fields.length > 0);
  const hasIssue = (r, severity) => r.validation_issues.some((i) => i.severity === severity);

  const report = {
    mode: 'DRY_RUN', db_writes: 0, snapshot_sha256: snapshotHash, snapshot_size_bytes: bytes.length,
    source_spreadsheet_id: SOURCE.source_spreadsheet_id,
    source_tab_gid: SOURCE.source_tab_gid, source_sheet: SOURCE.source_sheet,
    declared_range: sheet['!ref'],
    range: `A${SOURCE.first_source_row}:Q${SOURCE.last_source_row}`,
    expected_rows: SOURCE.expected_rows, processed_rows: records.length,
    candidate_rows: records.length + 1, included_rows: records.length, excluded_rows_count: 1,
    source_hash_version: SOURCE.source_hash_version, source_timezone: SOURCE.source_timezone,
    headers,
    // Huella de las 1014 posiciones y hashes para que el apply verifique el mismo conjunto.
    records_digest_sha256: sha256(Buffer.from(JSON.stringify(records.map((r) => [r.source_row, r.source_hash])), 'utf8')),
    normalization_counts: normalizationCounts, validation_issue_counts: issueCounts,
    rows_with_warnings: records.filter((r) => hasIssue(r, 'warning')).length,
    rows_with_errors: records.filter((r) => hasIssue(r, 'error')).length,
    first_source_row: records[0].source_row, last_source_row: records.at(-1).source_row,
    excluded_rows: [excluded],
    boundary_row: { source_row: SOURCE.boundary_row, empty: true, included_in_records: false },
    nothing_after_excluded_row_within_declared_range: true,
    temporal_range: {
      min_local_date: localDates[0] ?? null, max_local_date: localDates.at(-1) ?? null,
      min_instant_utc: instants[0] ?? null, max_instant_utc: instants.at(-1) ?? null,
      valid_instants: instants.length,
    },
    observed_temporal_formats: formats,
    incomplete_rows: records.filter((r) => r.normalization_status === 'INCOMPLETA').map((r) => ({
      source_row: r.source_row, issues: r.validation_issues.filter((i) => i.severity === 'error'),
    })),
    duplicates: {
      source_legacy_id: duplicateGroups(records, 'source_legacy_id'),
      numero_serie: duplicateGroups(records, 'numero_serie'),
      numero_serie_trimmed: duplicateGroups(records, 'numero_serie', (value) => value.trim()),
      carpeta_drive_url: duplicateGroups(records, 'carpeta_drive_url'),
      policy: 'solo se reportan; ninguna fila se deduplica ni se omite',
    },
    anomalies: {
      numero_serie_stored_as_number: records.filter((r) => r.validation_issues.some((i) => i.code === 'SERIAL_STORED_AS_NUMBER'))
        .map((r) => ({ source_row: r.source_row, raw: r.numero_serie })),
      numero_serie_date_format: records.filter((r) => r.validation_issues.some((i) => i.code === 'SERIAL_DATE_FORMAT'))
        .map((r) => ({ source_row: r.source_row, raw: r.numero_serie })),
      whitespace_only_cells: fieldsWith('WHITESPACE_ONLY'),
      leading_whitespace_rows: fieldsWith('LEADING_WHITESPACE'),
      trailing_whitespace_rows: fieldsWith('TRAILING_WHITESPACE'),
      rows_with_cr: fieldsWith('CONTAINS_CR'),
      rows_with_lf: fieldsWith('CONTAINS_LF'),
      rows_with_nbsp: fieldsWith('CONTAINS_NBSP'),
      missing_usuario_rows: rowsWith('MISSING_USER'),
      missing_estacion_rows: rowsWith('MISSING_STATION'),
      missing_operador_rows: rowsWith('MISSING_OPERATOR'),
      missing_drive_rows: rowsWith('MISSING_DRIVE_FOLDER'),
      zero_images_rows: rowsWith('ZERO_IMAGES'),
      partial_rows: records.filter((r) => r.validation_issues.some((i) => i.code === 'PARTIAL_ROW' || i.code === 'BLANK_ROW'))
        .map((r) => ({ source_row: r.source_row, issues: r.validation_issues.filter((i) => ['PARTIAL_ROW', 'BLANK_ROW'].includes(i.code)).map((i) => i.detail) })),
    },
    excel_date_system: date1904 ? '1904' : '1900',
    runtime_versions: { node: process.versions.node, icu: process.versions.icu, tz: process.versions.tz, xlsx: XLSX.version },
    records,
  };
  const destination = saveReport(report);
  console.log([
    'Snapshot válido: SI', `SHA-256: ${snapshotHash}`, `Archivo: ${input}`,
    `Hoja: ${SOURCE.source_sheet}`, `Rango: ${report.range}`,
    `Filas esperadas: ${SOURCE.expected_rows}`, `Filas procesadas: ${records.length}`,
    `Fila excluida: ${SOURCE.excluded_test_row} (prueba); frontera ${SOURCE.boundary_row} vacía`,
    `Normalización OK: ${normalizationCounts.OK}`, `Incompletas: ${normalizationCounts.INCOMPLETA}`,
    `Inválidas: ${normalizationCounts.INVALIDA}`, `Ambiguas: ${normalizationCounts.AMBIGUA}`,
    `Filas con warnings: ${report.rows_with_warnings}`, `Filas con errores: ${report.rows_with_errors}`,
    `Duplicados #: ${report.duplicates.source_legacy_id.length}`,
    `Duplicados serie: ${report.duplicates.numero_serie.length}`,
    `Duplicados Drive: ${report.duplicates.carpeta_drive_url.length}`,
    `Reporte: ${destination}`,
    'Escrituras DB: 0', 'DRY-RUN COMPLETADO',
  ].join('\n'));
}

try {
  main();
} catch (error) {
  console.error(`DRY-RUN ABORTADO: ${error.message}`);
  process.exitCode = 1;
}
