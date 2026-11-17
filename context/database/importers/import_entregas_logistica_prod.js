import { readFileSync } from 'node:fs';
import { extname,isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import XLSX from 'xlsx';
import { HEADERS,legacyKey,contentHash,localDatetime,folderId } from './import_entregas_logistica_legacy.js';
import { invariant,sha256 } from '../migrations/prod/logistica_prod_support.js';
const LETTERS='ABCDEFGHIJKLMNOPQRST'.split('');
export function validateApproval(approval) {
  invariant(approval&&/^[0-9a-f]{64}$/.test(approval.sha256??''),'APPROVED_SHA_REQUIRED');
  invariant(approval.sheet==='Entregas','APPROVED_SHEET_REQUIRED');
  invariant(Number.isSafeInteger(approval.count)&&approval.count>0,'APPROVED_COUNT_REQUIRED');
}
export function approvalFromOptions(opts) {
  const input=opts['--input'];
  invariant(typeof input==='string'&&isAbsolute(input)&&!input.startsWith('\\\\')&&!input.startsWith('//')
    &&extname(input).toLowerCase()==='.xlsx','ABSOLUTE_LOCAL_XLSX_REQUIRED');
  invariant(/^[1-9][0-9]*$/.test(opts['--expected-count']??''),'APPROVED_COUNT_REQUIRED');
  const approval={sha256:opts['--approved-sha256'],sheet:opts['--sheet'],count:Number(opts['--expected-count'])};
  validateApproval(approval);
  return {input,approval};
}
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
export function buildRecord(cells, row, approval) {
  invariant(Number.isInteger(row) && row >= 2,
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
  if ((value(get('D')) === null) !== (value(get('E')) === null))
    warn('INCOMPLETE_LOCAL_DATETIME', 'local_datetime');
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
    source_snapshot_sha256: approval.sha256, source_sheet: approval.sheet, source_row: row,
    legacy_key: legacyKey(approval.sha256, approval.sheet, row),
    content_hash: contentHash(raw_payload),
    legacy_correlative: text(get('A')), correo: text(get('B')), usuario: text(get('C')),
    fecha_raw: text(get('D')), hora_raw: text(get('E')),
    local_datetime: value(get('D')) === null || value(get('E')) === null ? null : localDatetime(get('D'), get('E')),
    pedido: pedido === null ? null : String(pedido),
    equipo: text(get('G')), chofer: text(get('H')), observaciones: text(get('I')),
    instalara: text(get('J')), latitude, longitude, legacy_image_count: images,
    drive_folder_url: url, drive_folder_id: url === null ? null : folderId(url), ubicacion,
    app_version: text(get('P')), ticket: text(get('Q')),
    informacion_correcta: boolean(get('R')), actualizado_zoho: boolean(get('S')),
    comentarios: text(get('T')), raw_payload, warnings,
  };
}


export function validateRecords(records,approval) {
  validateApproval(approval);
  invariant(Array.isArray(records)&&records.length===approval.count,'WRONG_ROW_COUNT');
  const positions=new Set();
  for(const record of records) {
    invariant(!positions.has(record.source_row),'DUPLICATE_SOURCE_ROW');
    positions.add(record.source_row);
    invariant(isDeepStrictEqual(record,buildRecord(record.raw_payload?.cells,record.source_row,approval)),
      'RECORD_CHANGED_AFTER_NORMALIZATION');
  }
}
export function parseSnapshot(bytes,approval) {
  validateApproval(approval);
  invariant(Buffer.isBuffer(bytes)&&sha256(bytes)===approval.sha256,'UNAUTHORIZED_SNAPSHOT');
  const wb=XLSX.read(bytes,{type:'buffer',sheets:approval.sheet,cellDates:false,cellNF:true,
    cellText:true,cellFormula:true,sheetStubs:true,cellHTML:false,bookVBA:false});
  const sheet=wb.Sheets[approval.sheet];
  invariant(sheet,'MISSING_APPROVED_SHEET');
  invariant(![true,1,'1','true'].includes(wb.Workbook?.WBProps?.date1904),'UNEXPECTED_DATE_SYSTEM');
  invariant(isDeepStrictEqual(LETTERS.map(c=>sheet[c+'1']?.v??null),HEADERS),'UNEXPECTED_HEADERS');
  const range=sheet['!ref']&&XLSX.utils.decode_range(sheet['!ref']);
  invariant(range&&range.s.r===0&&range.s.c===0&&range.e.c>=19,'UNEXPECTED_SHEET_RANGE');
  for(const [address,cell] of Object.entries(sheet)) {
    if(address.startsWith('!')) continue;
    if(XLSX.utils.decode_cell(address).c>19) invariant(!cell.f&&(cell.v==null||cell.v===''),'DATA_OUTSIDE_APPROVED_COLUMNS');
  }
  const records=[];
  for(let row=2;row<=range.e.r+1;row++) {
    const cells=Object.fromEntries(LETTERS.map(c=>[c,originalCell(sheet[c+row])]));
    if(!Object.values(cells).some(c=>value(c)!==null&&value(c)!=='')) continue;
    records.push(buildRecord(cells,row,approval));
  }
  validateRecords(records,approval);
  return {approval:{...approval},records};
}
export const loadApprovedSnapshot=(input,approval)=>parseSnapshot(readFileSync(input),approval);
