// Comparacion exclusivamente de archivos locales. No importa pg ni abre conexiones.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const manifest = readFileSync(new URL('./manifest.psql', import.meta.url), 'utf8');
const entries = name => manifest.match(new RegExp(String.raw`\\set ${name} '\{([^}]+)\}'`))[1].split(',');
export const core = entries('core_tables');
export const historical = entries('historical_tables');
const canonical = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(canonical)
    : Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const stable = value => JSON.stringify(canonical(value));
const check = (condition, reason) => { if (!condition) throw new Error(reason); };

export function parseSnapshot(bytes, database) {
  check(['artecnologia', 'calidad', 'artecnologia_test_local', 'calidad_test_local'].includes(database), 'UNAPPROVED_DATABASE');
  const rows = bytes.replace(/^\uFEFF/, '').split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s));
  check(rows.at(-1)?.kind === 'complete', 'SNAPSHOT_INCOMPLETE');
  const indexed = new Map();
  const kinds = ['identity', 'database_settings', 'scope', 'table', 'count', 'sequence', 'function', 'fk_rows', 'complete'];
  for (const row of rows) {
    check(kinds.includes(row.kind), 'UNKNOWN_RECORD_KIND');
    const key = row.kind + ':' + (row.name ?? '');
    check(!indexed.has(key), 'DUPLICATE_RECORD:' + key);
    indexed.set(key, row);
  }
  const one = kind => { const r = indexed.get(kind + ':'); check(r, 'MISSING_RECORD:' + kind); return r; };
  check(one('identity').database === database, 'WRONG_DATABASE');
  check(/^16\./.test(one('identity').version), 'WRONG_POSTGRESQL_MAJOR');
  if (database.endsWith('_test_local')) {
    const id = one('identity');
    check(id.user === 'workorders_test' && ['127.0.0.1', '::1'].includes(id.address) && id.port === 5432, 'LOCAL_IDENTITY_REQUIRED');
  }
  one('database_settings');
  const scope = one('scope').tables;
  check(Array.isArray(scope), 'INVALID_SCOPE');
  check(stable(scope.map(r => r.name).sort()) === stable([...core, ...historical].sort()), 'UNEXPECTED_SCOPE');
  for (const name of core) check(scope.some(r => r.name === name && r.present === true), 'MISSING_CORE:' + name);
  const present = scope.filter(r => r.present === true).map(r => r.name).sort();
  const get = kind => rows.filter(r => r.kind === kind);
  for (const kind of ['table', 'count']) {
    check(stable(get(kind).map(r => r.name).sort()) === stable(present), 'MISSING_OR_EXTRA_' + kind.toUpperCase());
  }
  for (const row of get('count')) {
    check(/^\d+$/.test(row.count) && row.max_keys && typeof row.max_keys === 'object', 'INVALID_COUNT');
  }
  for (const row of get('sequence')) {
    check(/^-?\d+$/.test(row.last_value) && typeof row.is_called === 'boolean' && row.definition, 'INVALID_SEQUENCE');
  }
  for (const name of entries('root_functions')) {
    check(get('function').some(r => r.name.startsWith('public.' + name + '(')), 'MISSING_FUNCTION:' + name);
  }
  const complete = one('complete');
  for (const [field, kind] of [['tables', 'table'], ['sequences', 'sequence'], ['foreign_keys', 'fk_rows'], ['functions', 'function']]) {
    check(complete[field] === get(kind).length, 'INCOMPLETE_SECTION:' + field);
  }
  return indexed;
}

export function compareSnapshots(sourceBytes, destinationBytes, { mode = 'production' } = {}) {
  check(['production', 'local_rehearsal'].includes(mode), 'UNAPPROVED_MODE');
  const local = mode === 'local_rehearsal';
  const source = parseSnapshot(sourceBytes, local ? 'artecnologia_test_local' : 'artecnologia');
  const destination = parseSnapshot(destinationBytes, local ? 'calidad_test_local' : 'calidad');
  const mismatches = [];
  const permissionDifferences = [];
  // Solo el ensayo LOCAL restaura --no-owner/--no-acl como workorders_test.
  // Se reportan las diferencias; este mapeo NUNCA se aplica a comparacion PROD.
  const structure = value => value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(structure) : Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['owner', 'acl'].includes(key)).map(([key, item]) => [key, structure(item)])) : value;
  for (const key of new Set([...source.keys(), ...destination.keys()])) {
    if (key === 'identity:') continue; // DB, hora y rol ya identificados; no son equivalentes entre DBs.
    const left = source.get(key), right = destination.get(key);
    if (local && stable(left) !== stable(right) && stable(structure(left)) === stable(structure(right))) permissionDifferences.push(key);
    if (stable(local ? structure(left) : left) !== stable(local ? structure(right) : right)) mismatches.push(key);
  }
  const warnings = [];
  for (const [key, row] of source) {
    if (row.kind === 'fk_rows' && (row.violations !== '0' || !row.validated)) warnings.push('REVIEW_EXISTING_FK:' + key);
    if (row.kind === 'table') {
      for (const c of row.constraints) if (!c.validated) warnings.push('NOT_VALID:' + row.name + '.' + c.name);
      for (const i of row.indexes) if (!i.valid || !i.ready) warnings.push('INVALID_INDEX:' + row.name + '.' + i.name);
    }
  }
  return { equivalent: mismatches.length === 0, mismatches, warnings, permission_differences: permissionDifferences,
    local_role_mapping: local ? 'Propietarios/ACL originales registrados; destino aislado con workorders_test' : null,
    scope: 'Baseline antes de Logistica; no certifica igualdad de cada celda ni cierre de dependencias auxiliares.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    check(process.argv.length === 4, 'USAGE: node compare_snapshots.mjs origen.jsonl destino.jsonl');
    const result = compareSnapshots(readFileSync(process.argv[2], 'utf8'), readFileSync(process.argv[3], 'utf8'));
    console.log(JSON.stringify(result, null, 2));
    if (!result.equivalent || result.warnings.length) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
