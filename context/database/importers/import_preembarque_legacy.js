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

// DRY-RUN exclusivo: no usa PostgreSQL, SQL ni HTTP. Su único efecto de
// escritura es un reporte JSON nuevo en output/ (ignorado por Git).
const SOURCE = Object.freeze({
  source_tab_gid: 808292040,
  source_sheet: 'Pre-Embarque',
  source_timezone: 'America/Mexico_City',
  source_snapshot_sha256: 'affe04cfa5199fbc24ceb45c6a5b2524ec3786c88b4fdc87dc12d3c42b0e1fd5',
  expected_rows: 1205,
  last_v1_row: 455,
  first_v2_row: 456,
});
// Rangos físicos autoritativos [desde, hasta], ambos inclusivos.
const OPERATIVE_RANGES = Object.freeze([
  [2, 352], [354, 743], [755, 777], [975, 1074], [1389, 1407], [1409, 1431], [1433, 1731],
]);
const COLUMNS = 17;
const COLUMN_LETTERS = 'ABCDEFGHIJKLMNOPQ'.split('');
const DATE_COLUMN = 3;
const TIME_COLUMN = 4;
const DAY_MS = 86400000;
const STATUSES = Object.freeze(['OK', 'INCOMPLETA', 'INVALIDA', 'AMBIGUA']);
// Columna física (0=A) de cada campo en cada layout.
const LAYOUTS = Object.freeze({
  LEGACY_V1: ['correlativo_raw', 'semana_raw', 'usuario_raw', 'fecha_raw', 'hora_raw',
    'cliente_raw', 'pedido_raw', 'serie_origen_raw', 'serie_asignada_raw', 'equipo_raw',
    'accesorio_raw', 'descripcion_raw', 'desviacion_raw', 'carpeta_drive_raw',
    'cantidad_imagenes_raw', 'version_app_raw', 'anio_raw'],
  LEGACY_V2: ['correlativo_raw', 'semana_raw', 'usuario_raw', 'fecha_raw', 'hora_raw',
    'cliente_raw', 'pedido_raw', 'serie_origen_raw', 'serie_asignada_raw', 'equipo_raw',
    'accesorio_raw', 'descripcion_raw', 'desviacion_raw', 'serie_modulo_generador_raw',
    'carpeta_drive_raw', 'cantidad_imagenes_raw', 'version_app_raw'],
});
const RAW_FIELDS = Object.freeze([
  'correlativo_raw', 'semana_raw', 'usuario_raw', 'fecha_raw', 'hora_raw', 'cliente_raw',
  'pedido_raw', 'serie_origen_raw', 'serie_asignada_raw', 'equipo_raw', 'accesorio_raw',
  'descripcion_raw', 'desviacion_raw', 'serie_modulo_generador_raw', 'carpeta_drive_raw',
  'cantidad_imagenes_raw', 'version_app_raw', 'anio_raw',
]);
const RELEVANT_FIELDS = Object.freeze({
  usuario_raw: 'MISSING_USER', cliente_raw: 'MISSING_CLIENT', pedido_raw: 'MISSING_ORDER',
  serie_origen_raw: 'MISSING_SOURCE_SERIAL', serie_asignada_raw: 'MISSING_ASSIGNED_SERIAL',
  equipo_raw: 'MISSING_MACHINE', carpeta_drive_raw: 'MISSING_DRIVE_FOLDER',
  cantidad_imagenes_raw: 'MISSING_IMAGE_COUNT', version_app_raw: 'MISSING_APP_VERSION',
});
// Campos que identifican el evento; excluye correlativo, semana, año y fila.
const CONTENT_FIELDS = Object.freeze(RAW_FIELDS.filter((f) => !['correlativo_raw', 'semana_raw', 'anio_raw'].includes(f)));

function invariant(condition, detail) {
  if (!condition) throw new Error(`Invariante incumplida: ${detail}`);
}
const missing = (value) => value === null || value === undefined || /^\s*$/u.test(value);
const pad = (value, width = 2) => String(value).padStart(width, '0');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const issue = (field, code, severity, detail) => ({ field, code, severity, detail });
const layoutFor = (row) => (row <= SOURCE.last_v1_row ? 'LEGACY_V1' : 'LEGACY_V2');

function inputPath(args) {
  if (args.length !== 2 || args[0] !== '--input' || !args[1]) {
    throw new Error('Uso: node context/database/importers/import_preembarque_legacy.js --input <ruta-absoluta.xlsx>');
  }
  const input = args[1];
  invariant(isAbsolute(input) && !input.startsWith('\\\\') && !input.startsWith('//')
    && extname(input).toLowerCase() === '.xlsx', 'el input debe ser un XLSX local con ruta absoluta');
  return resolve(input);
}

// Representación visible de la celda; los strings se toman tal cual (v) para
// conservar espacios y CR/LF. El resto usa el texto formateado (w).
function readRow(sheet, row, date1904) {
  const originals = [];
  const cells = COLUMN_LETTERS.map((_, column) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: row - 1, c: column })];
    originals.push(cell);
    if (!cell || cell.t === 'z') return null;
    if (cell.t === 's' && typeof cell.v === 'string') return cell.v;
    if (typeof cell.w === 'string') return cell.w;
    if (cell.v === undefined || cell.v === null) return null;
    if (typeof cell.v === 'string') return cell.v;
    invariant(typeof cell.v === 'number' || typeof cell.v === 'boolean',
      `tipo de celda inesperado en fila ${row}, columna ${column + 1}`);
    if (cell.t === 'e') return String(XLSX.utils.format_cell(cell));
    try {
      return XLSX.SSF.format(cell.z || 'General', cell.v, { date1904 });
    } catch {
      return String(cell.v);
    }
  });
  return { cells, originals };
}
const nonEmptyCell = (cell) => Boolean(cell) && cell.t !== 'z' && cell.v !== undefined && cell.v !== null && cell.v !== '';

function validDate(year, month, day) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12
    && day >= 1 && day <= days[month - 1];
}
const parsed = (state, value, format, detail = '') => ({ state, value, format, detail });
const isExcelTemporal = (cell) => cell?.t === 'n'
  && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z);

// Fechas: serial Excel o texto YYYY-MM-DD. El texto con barras no se adivina
// (D/M vs M/D es ambiguo en esta fuente, cuyo formato visible es m/d/yy).
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
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
    const adjustedDays = date1904 ? days : days - (days > 60 ? 1 : 0);
    const date = new Date(epoch + adjustedDays * DAY_MS);
    [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    if (match) {
      [year, month, day] = match.slice(1).map(Number);
      format = 'texto:YYYY-MM-DD';
    } else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(raw.trim())) {
      return parsed('AMBIGUA', null, 'texto:con barras', 'No se infiere D/M vs M/D ni el siglo');
    } else {
      return parsed('INVALIDA', null, format, 'Formato de fecha no reconocido');
    }
  }
  return validDate(year, month, day)
    ? parsed('OK', `${pad(year, 4)}-${pad(month)}-${pad(day)}`, format)
    : parsed('INVALIDA', null, format, 'La fecha no existe en el calendario');
}

// Horas: serial Excel, H:mm[:ss[.SSS]] o H.mm.ss en 24 horas, y variantes
// 12 horas con AM/PM, a.m./p.m. o marcadores Unicode ص (AM) y م (PM).
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
  const base = `${pad(hour)}:${pad(minute)}:${pad(second)}`;
  return parsed('OK', millisecond ? `${base}.${pad(millisecond, 3)}` : base, format);
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
    const civil = `${date}T${time.slice(0, 8)}`;
    const wall = Date.parse(`${date}T${time}Z`);
    if (!offsetsByDate.has(date)) {
      const noon = Date.parse(`${date}T12:00:00Z`);
      const offsets = new Set();
      // Offsets IANA alrededor del día; nunca un offset fijo.
      for (let hours = -48; hours <= 48; hours += 6) offsets.add(offsetAt(noon + hours * 3600000));
      offsetsByDate.set(date, offsets);
    }
    const offsets = new Set(offsetsByDate.get(date));
    const seed = dayjs.tz(civil, zone).valueOf();
    invariant(Number.isFinite(seed), 'no se pudo resolver la zona IANA');
    offsets.add(offsetAt(seed));
    const candidates = [...new Set([...offsets].map((offset) => wall - offset))]
      .filter((epoch) => civilAt(epoch) === civil);
    if (!candidates.length) return parsed('INVALIDA', null, zone, 'La hora civil no existe en la zona de origen');
    if (candidates.length > 1) return parsed('AMBIGUA', null, zone, 'La hora civil corresponde a varios instantes UTC');
    return parsed('OK', new Date(candidates[0]).toISOString(), zone);
  };
}

// WEEKNUM(fecha) de Excel (return_type 1): la semana 1 contiene el 1 de enero
// y las semanas empiezan en domingo. Solo se usa para observar, nunca se corrige.
function excelWeekNum(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = Date.UTC(year, month - 1, day);
  const jan1 = Date.UTC(year, 0, 1);
  const dayOfYear = Math.round((date - jan1) / DAY_MS);
  return Math.floor((dayOfYear + new Date(jan1).getUTCDay()) / 7) + 1;
}

const looksLikeUrl = (value) => !missing(value) && /^\s*https?:\/\//i.test(value);
const PLACEHOLDER = /^\s*(?:n\/?a|s\/n|sin\s+serie|-+|\.+)\s*$/i;

// Metadatos forenses por celda física A:Q, con orden de claves fijo para que
// la serialización (y el digest) sea determinística. Sin trim ni conversiones.
function cellsMeta(originals, row) {
  const nullable = (value) => (value === undefined ? null : value);
  return Object.fromEntries(COLUMN_LETTERS.map((letter, column) => {
    const cell = originals[column];
    return [letter, {
      address: `${letter}${row}`,
      t: nullable(cell?.t), v: nullable(cell?.v), w: nullable(cell?.w),
      z: nullable(cell?.z), f: nullable(cell?.f),
      hyperlink: cell?.l ? { target: nullable(cell.l.Target), tooltip: nullable(cell.l.Tooltip) } : null,
    }];
  }));
}

function buildRecord(sheet, row, snapshotHash, date1904, resolveCivil, formats) {
  const layout = layoutFor(row);
  const { cells, originals } = readRow(sheet, row, date1904);
  const record = {
    source_sheet: SOURCE.source_sheet, source_tab_gid: SOURCE.source_tab_gid,
    source_row: row, source_layout: layout,
    ...Object.fromEntries(RAW_FIELDS.map((f) => [f, null])),
  };
  const columnOf = {};
  LAYOUTS[layout].forEach((field, column) => {
    record[field] = cells[column];
    columnOf[field] = column;
  });
  const issues = [];

  // Fechas y horas.
  const date = parseDate(record.fecha_raw, originals[DATE_COLUMN], date1904);
  const time = parseTime(record.hora_raw, originals[TIME_COLUMN]);
  for (const [kind, result, field] of [['date', date, 'fecha_raw'], ['time', time, 'hora_raw']]) {
    formats[kind][result.format] = (formats[kind][result.format] ?? 0) + 1;
    if (result.state !== 'OK') {
      const prefix = result.state === 'INCOMPLETA' ? 'MISSING' : result.state === 'AMBIGUA' ? 'AMBIGUOUS' : 'INVALID';
      issues.push(issue(field, `${prefix}_${kind.toUpperCase()}`, 'error', result.detail));
    }
  }
  record.fecha_local = date.value;
  record.hora_local = time.value;
  record.captured_at_local = date.value && time.value ? `${date.value}T${time.value}` : null;
  record.captured_at_utc = null;
  record.source_cells_meta = cellsMeta(originals, row);
  let temporalState = ['INVALIDA', 'AMBIGUA', 'INCOMPLETA'].find((s) => date.state === s || time.state === s) ?? 'OK';
  if (temporalState === 'OK') {
    const instant = resolveCivil(date.value, time.value);
    temporalState = instant.state;
    record.captured_at_utc = instant.value;
    if (instant.state !== 'OK') {
      issues.push(issue('hora_raw', instant.state === 'AMBIGUA' ? 'AMBIGUOUS_TIME' : 'INVALID_TIME', 'error', instant.detail));
    }
  }

  // Campos relevantes vacíos.
  for (const [field, code] of Object.entries(RELEVANT_FIELDS)) {
    if (missing(record[field])) issues.push(issue(field, code, 'warning', `La fuente no contiene ${field}`));
  }
  if (!missing(record.carpeta_drive_raw) && !looksLikeUrl(record.carpeta_drive_raw)) {
    const target = originals[columnOf.carpeta_drive_raw]?.l?.Target;
    if (looksLikeUrl(target)) {
      issues.push(issue('carpeta_drive_raw', 'DRIVE_URL_IN_HYPERLINK', 'info',
        'El texto visible no es URL; el hipervínculo de la celda conserva la URL de Drive'));
    } else {
      issues.push(issue('carpeta_drive_raw', 'DRIVE_NOT_URL', 'warning', 'La carpeta Drive no es una URL http(s)'));
    }
  }
  if (['pedido_raw', 'serie_origen_raw', 'serie_asignada_raw'].some((f) => !missing(record[f]) && PLACEHOLDER.test(record[f]))) {
    issues.push(issue('pedido_raw', 'IDENTIFIERS_PLACEHOLDER', 'info', 'Pedido o series con valor placeholder (p. ej. N/A)'));
  }
  if (!missing(record.cantidad_imagenes_raw) && !/^\s*\d+\s*$/.test(record.cantidad_imagenes_raw)) {
    issues.push(issue('cantidad_imagenes_raw', 'IMAGE_COUNT_NOT_NUMERIC', 'warning', 'La cantidad de imágenes no es numérica'));
  }

  // Errores de fórmula/celdas y espacios/saltos, sin limpiar.
  RAW_FIELDS.forEach((field) => {
    const value = record[field];
    if (value === null) return;
    const cell = originals[columnOf[field]];
    if (cell?.t === 'e' || /^#(VALUE|REF|N\/A|DIV\/0|NAME\?|NUM|NULL)[!?]?$/i.test(value.trim())) {
      issues.push(issue(field, 'SHEET_ERROR_VALUE', 'warning', `Valor de error de hoja de cálculo: ${value}`));
    }
    if (/[\r\n]/.test(value)) issues.push(issue(field, 'CRLF_IN_VALUE', 'warning', 'Contiene CR/LF'));
    if (value !== value.trim()) issues.push(issue(field, 'LEADING_TRAILING_WHITESPACE', 'warning', 'Espacios iniciales o finales'));
  });

  // Series y pedidos numéricos / textuales.
  for (const field of ['serie_origen_raw', 'serie_asignada_raw']) {
    if (originals[columnOf[field]]?.t === 'n') {
      issues.push(issue(field, 'SERIAL_STORED_AS_NUMBER', 'warning', 'La serie estaba almacenada como número'));
    }
  }
  const orderCell = originals[columnOf.pedido_raw];
  const orderType = missing(record.pedido_raw) ? 'empty' : orderCell?.t === 'n' ? 'numeric' : 'text';
  if (orderType === 'numeric') issues.push(issue('pedido_raw', 'ORDER_STORED_AS_NUMBER', 'info', 'Pedido almacenado como número'));
  if (!missing(record.serie_origen_raw) && !missing(record.serie_asignada_raw)
    && record.serie_origen_raw.trim().toUpperCase() === record.serie_asignada_raw.trim().toUpperCase()) {
    issues.push(issue('serie_asignada_raw', 'SOURCE_EQUALS_ASSIGNED_SERIAL', 'info', 'Serie origen igual a serie asignada'));
  }

  // Semana: se preserva; solo se observa si es potencialmente incorrecta.
  const weekCell = originals[1];
  const weekFormula = typeof weekCell?.f === 'string' ? weekCell.f : null;
  if (weekFormula && /^WEEKNUM\(E\d+\)$/i.test(weekFormula.trim())) {
    issues.push(issue('semana_raw', 'WEEK_FORMULA_USES_TIME_COLUMN', 'warning', `${weekFormula} usa la hora (E) en lugar de la fecha (D)`));
  }
  if (!missing(record.semana_raw) && !/^\s*\d+\s*$/.test(record.semana_raw)) {
    issues.push(issue('semana_raw', 'WEEK_NOT_NUMERIC', 'warning', 'La semana no es numérica'));
  } else if (!missing(record.semana_raw) && date.value
    && Number(record.semana_raw) !== excelWeekNum(date.value)) {
    issues.push(issue('semana_raw', 'WEEK_DIFFERS_FROM_DATE_WEEKNUM', 'warning',
      `La semana almacenada difiere de WEEKNUM(fecha)=${excelWeekNum(date.value)}`));
  }

  // Estructura de columnas: dos interpretaciones plausibles → AMBIGUA.
  const driveColumn = layout === 'LEGACY_V1' ? columnOf.carpeta_drive_raw : columnOf.carpeta_drive_raw;
  const previous = cells[driveColumn - 1];
  const layoutMismatch = layout === 'LEGACY_V2'
    ? looksLikeUrl(previous) && !looksLikeUrl(cells[driveColumn])
    : !looksLikeUrl(cells[driveColumn]) && looksLikeUrl(cells[driveColumn + 1]);
  if (layoutMismatch) {
    issues.push(issue('carpeta_drive_raw', 'LAYOUT_COLUMN_MISMATCH', 'error',
      'La URL de Drive aparece en la columna del otro layout'));
  }

  // record_status conservador: INVALIDA > AMBIGUA > INCOMPLETA > OK.
  const incomplete = temporalState === 'INCOMPLETA' || missing(record.usuario_raw) || missing(record.equipo_raw)
    || (missing(record.pedido_raw) && missing(record.serie_origen_raw) && missing(record.serie_asignada_raw));
  record.record_status = temporalState === 'INVALIDA' ? 'INVALIDA'
    : (temporalState === 'AMBIGUA' || layoutMismatch) ? 'AMBIGUA'
      : incomplete ? 'INCOMPLETA' : 'OK';
  record.warnings = issues;
  record.source_snapshot_sha256 = snapshotHash;
  record._order_type = orderType;
  return record;
}

const contentKey = (record) => JSON.stringify(CONTENT_FIELDS.map((f) => record[f]));
const identityKey = (record) => JSON.stringify(
  ['equipo_raw', 'accesorio_raw', 'serie_origen_raw', 'serie_asignada_raw', 'serie_modulo_generador_raw'].map((f) => record[f]));

// Repeticiones: solo se reportan; ninguna fila se omite ni se deduplica.
function repetitionGroups(records, keyOf, techDuplicateKeys) {
  const groups = new Map();
  for (const record of records) {
    const key = keyOf(record);
    if (key === null) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups]
    .filter(([, group]) => group.length > 1)
    .map(([value, group]) => {
      const identities = new Set(group.map(identityKey));
      const classification = group.some((r) => techDuplicateKeys.has(contentKey(r))) ? 'CANDIDATO_DUPLICADO_TECNICO'
        : identities.size === group.length ? 'LEGITIMA_MULTIPLE' : 'REPETICION';
      return { value, classification, occurrence_count: group.length, source_rows: group.map((r) => r.source_row) };
    })
    .sort((a, b) => b.occurrence_count - a.occurrence_count || String(a.value).localeCompare(String(b.value)));
}
const summarizeGroups = (groups) => ({
  group_count: groups.length,
  rows_in_groups: groups.reduce((sum, g) => sum + g.occurrence_count, 0),
  by_classification: groups.reduce((acc, g) => ({ ...acc, [g.classification]: (acc[g.classification] ?? 0) + 1 }), {}),
  groups,
});

function excludedGaps(sheet, lastRow, date1904) {
  const included = new Set(OPERATIVE_RANGES.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)));
  const gaps = [];
  let start = null;
  for (let row = 2; row <= lastRow + 1; row++) {
    if (row <= lastRow && !included.has(row)) { start ??= row; continue; }
    if (start !== null) { gaps.push([start, row - 1]); start = null; }
  }
  return gaps.map(([from, to]) => {
    const nonEmptyRows = [];
    for (let row = from; row <= to; row++) {
      const { cells, originals } = readRow(sheet, row, date1904);
      if (originals.some(nonEmptyCell)) nonEmptyRows.push({ row, cells });
    }
    return {
      range: `${from}:${to}`, rows: to - from + 1, non_empty_rows: nonEmptyRows.length,
      non_empty_row_numbers: nonEmptyRows.map((r) => r.row),
      sample: nonEmptyRows.slice(0, 3).map(({ row, cells }) => ({
        row, cells: cells.map((c) => (c === null ? null : c.slice(0, 60))),
      })),
    };
  });
}

function saveReport(report) {
  const directory = fileURLToPath(new URL('./output/', import.meta.url));
  const filename = `preembarque_legacy_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, filename);
  writeFileSync(destination, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return destination;
}

export function loadRecords(input) {
  const bytes = readFileSync(input);
  const snapshotHash = sha256(bytes);
  if (snapshotHash !== SOURCE.source_snapshot_sha256) {
    throw new Error(`Snapshot no autorizado.\nHash esperado: ${SOURCE.source_snapshot_sha256}\nHash encontrado: ${snapshotHash}`);
  }
  const workbook = XLSX.read(bytes, {
    type: 'buffer', sheets: SOURCE.source_sheet, cellDates: false, cellText: true, cellNF: true,
    sheetStubs: true, cellFormula: true, cellHTML: false, bookVBA: false,
  });
  invariant(workbook.SheetNames.includes(SOURCE.source_sheet), `hoja ausente: ${SOURCE.source_sheet}`);
  const sheet = workbook.Sheets[SOURCE.source_sheet];
  invariant(Boolean(sheet), 'hoja autorizada no disponible');
  const date1904 = [true, 1, '1', 'true'].includes(workbook.Workbook?.WBProps?.date1904);
  const lastRow = XLSX.utils.decode_range(sheet['!ref']).e.r + 1;
  const headers = readRow(sheet, 1, date1904).cells;
  invariant(headers.length === COLUMNS && headers[0] === '#' && headers[DATE_COLUMN] === 'Fecha'
    && headers[TIME_COLUMN] === 'Hora', 'los encabezados A:E no coinciden con los esperados');

  const resolveCivil = createCivilResolver();
  const formats = { date: Object.create(null), time: Object.create(null) };
  const records = [];
  for (const [from, to] of OPERATIVE_RANGES) {
    for (let row = from; row <= to; row++) {
      records.push(buildRecord(sheet, row, snapshotHash, date1904, resolveCivil, formats));
    }
  }
  // El total debe ser exacto; no se ajusta la selección automáticamente.
  invariant(records.length === SOURCE.expected_rows,
    `se procesaron ${records.length} registros y se esperaban ${SOURCE.expected_rows}`);
  invariant(new Set(records.map((r) => r.source_row)).size === records.length, 'source_row duplicado');

  // Candidatos a duplicado técnico: contenido completo idéntico (sin correlativo/semana/año).
  const contentCounts = new Map();
  for (const r of records) contentCounts.set(contentKey(r), (contentCounts.get(contentKey(r)) ?? 0) + 1);
  const techDuplicateKeys = new Set([...contentCounts].filter(([, n]) => n > 1).map(([k]) => k));
  for (const r of records) {
    if (techDuplicateKeys.has(contentKey(r))) {
      r.warnings.push(issue(null, 'TECHNICAL_DUPLICATE_CANDIDATE', 'info', 'Contenido idéntico a otra fila (sin correlativo/semana/año)'));
    }
  }

  const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const layoutCounts = { LEGACY_V1: 0, LEGACY_V2: 0 };
  const issueCounts = Object.create(null);
  const severityCounts = { error: 0, warning: 0, info: 0 };
  const orderTypes = { numeric: 0, text: 0, empty: 0 };
  const samples = Object.create(null);
  for (const r of records) {
    statusCounts[r.record_status]++;
    layoutCounts[r.source_layout]++;
    orderTypes[r._order_type]++;
    for (const w of r.warnings) {
      severityCounts[w.severity]++;
      issueCounts[w.code] = { severity: w.severity, count: (issueCounts[w.code]?.count ?? 0) + 1 };
      samples[w.code] ??= [];
      if (samples[w.code].length < 5) samples[w.code].push({ source_row: r.source_row, field: w.field, detail: w.detail });
    }
    delete r._order_type;
  }
  return {
    bytes, snapshotHash, sheet, lastRow, date1904, headers, formats, records, techDuplicateKeys,
    statusCounts, layoutCounts, issueCounts, severityCounts, orderTypes, samples,
  };
}

function main() {
  const input = inputPath(process.argv.slice(2));
  const {
    bytes, snapshotHash, sheet, lastRow, date1904, headers, formats, records, techDuplicateKeys,
    statusCounts, layoutCounts, issueCounts, severityCounts, orderTypes, samples,
  } = loadRecords(input);
  const localDates = records.map((r) => r.fecha_local).filter(Boolean).sort();
  const instants = records.map((r) => r.captured_at_utc).filter(Boolean).sort();

  const byFields = (...fields) => (r) => {
    const values = fields.map((f) => r[f]);
    return values.some(missing) ? null : JSON.stringify(values);
  };
  const single = (field) => (r) => (missing(r[field]) ? null : r[field]);
  const duplicates = {
    policy: 'solo se reportan; ninguna fila se deduplica ni se omite',
    correlativo_raw: summarizeGroups(repetitionGroups(records, single('correlativo_raw'), techDuplicateKeys)),
    pedido_raw: summarizeGroups(repetitionGroups(records, single('pedido_raw'), techDuplicateKeys)),
    serie_origen_raw: summarizeGroups(repetitionGroups(records, single('serie_origen_raw'), techDuplicateKeys)),
    serie_asignada_raw: summarizeGroups(repetitionGroups(records, single('serie_asignada_raw'), techDuplicateKeys)),
    carpeta_drive_raw: summarizeGroups(repetitionGroups(records, single('carpeta_drive_raw'), techDuplicateKeys)),
    fecha_hora_pedido: summarizeGroups(repetitionGroups(records, byFields('fecha_raw', 'hora_raw', 'pedido_raw'), techDuplicateKeys)),
    fecha_hora_serie_origen: summarizeGroups(repetitionGroups(records, byFields('fecha_raw', 'hora_raw', 'serie_origen_raw'), techDuplicateKeys)),
    technical_duplicate_candidate_rows: records.filter((r) => techDuplicateKeys.has(contentKey(r))).map((r) => r.source_row),
  };

  const gaps = excludedGaps(sheet, lastRow, date1904);
  const digest = recordsDigest(records);
  const report = {
    mode: 'DRY_RUN', db_writes: 0, production_used: false,
    snapshot_sha256: snapshotHash, snapshot_size_bytes: bytes.length,
    sheet: SOURCE.source_sheet, gid: SOURCE.source_tab_gid, timezone: SOURCE.source_timezone,
    sheet_last_row: lastRow, headers,
    total_expected: SOURCE.expected_rows, total_processed: records.length,
    layout_counts: layoutCounts, status_counts: statusCounts,
    warning_count: severityCounts.warning, info_count: severityCounts.info, error_count: severityCounts.error,
    rows_with_warnings: records.filter((r) => r.warnings.some((w) => w.severity === 'warning')).length,
    rows_with_errors: records.filter((r) => r.warnings.some((w) => w.severity === 'error')).length,
    issue_counts: issueCounts, issue_samples: samples,
    pedido_types: orderTypes,
    temporal_range: {
      min_local_date: localDates[0] ?? null, max_local_date: localDates.at(-1) ?? null,
      min_instant_utc: instants[0] ?? null, max_instant_utc: instants.at(-1) ?? null,
      valid_instants: instants.length,
    },
    observed_temporal_formats: formats,
    included_ranges: OPERATIVE_RANGES.map(([a, b]) => ({ range: `${a}:${b}`, rows: b - a + 1 })),
    excluded_gaps: gaps,
    excluded_gap_non_empty_rows: gaps.reduce((sum, g) => sum + g.non_empty_rows, 0),
    duplicates,
    excel_date_system: date1904 ? '1904' : '1900',
    runtime_versions: { node: process.versions.node, icu: process.versions.icu, tz: process.versions.tz, xlsx: XLSX.version },
    normalized_records_digest_sha256: digest,
    records,
  };
  const destination = saveReport(report);
  console.log([
    'Snapshot válido: SI', `SHA-256: ${snapshotHash}`, `Archivo: ${input}`,
    `Hoja: ${SOURCE.source_sheet} (gid ${SOURCE.source_tab_gid})`,
    `Rangos: ${OPERATIVE_RANGES.map(([a, b]) => `${a}:${b}`).join(', ')}`,
    `Filas esperadas: ${SOURCE.expected_rows}`, `Filas procesadas: ${records.length}`,
    `LEGACY_V1: ${layoutCounts.LEGACY_V1}`, `LEGACY_V2: ${layoutCounts.LEGACY_V2}`,
    `OK: ${statusCounts.OK}`, `INCOMPLETA: ${statusCounts.INCOMPLETA}`,
    `INVALIDA: ${statusCounts.INVALIDA}`, `AMBIGUA: ${statusCounts.AMBIGUA}`,
    `Warnings: ${severityCounts.warning} | Info: ${severityCounts.info} | Errors: ${severityCounts.error}`,
    `Fecha mínima: ${localDates[0]} | Fecha máxima: ${localDates.at(-1)}`,
    `Celdas no vacías en huecos excluidos (filas): ${report.excluded_gap_non_empty_rows}`,
    ...gaps.map((g) => `  hueco ${g.range}: ${g.non_empty_rows} filas con datos`),
    ...Object.entries(issueCounts).map(([code, v]) => `  ${code} [${v.severity}]: ${v.count}`),
    ...Object.entries(duplicates).filter(([, v]) => v?.group_count !== undefined)
      .map(([k, v]) => `  repeticiones ${k}: ${v.group_count} grupos ${JSON.stringify(v.by_classification)}`),
    `Candidatos a duplicado técnico (filas): ${duplicates.technical_duplicate_candidate_rows.length}`,
    `Digest: ${digest}`,
    `Reporte: ${destination}`,
    'PostgreSQL writes = 0', 'production = not used', `processed = ${records.length}`,
    'DRY-RUN COMPLETADO',
  ].join('\n'));
}

export const recordsDigest = (records) => sha256(Buffer.from(JSON.stringify(records), 'utf8'));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`DRY-RUN ABORTADO: ${error.message}`);
    process.exitCode = 1;
  }
}
