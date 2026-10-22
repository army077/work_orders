import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots, core, historical, parseSnapshot } from './compare_snapshots.mjs';
import { prepareDumpArgs } from './prepare_dump_args.mjs';

function fixture(database) {
  return [
    { kind: 'identity', database, version: '16.15', captured_at: 'fixture' },
    { kind: 'database_settings', encoding: 'UTF8' },
    { kind: 'scope', tables: [...core.map(name => ({ name, present: true })), ...historical.map(name => ({ name, present: false }))] },
    ...core.map(name => ({ kind: 'table', name, constraints: [], indexes: [] })),
    ...core.map(name => ({ kind: 'count', name, count: '0', max_keys: { id: null } })),
    { kind: 'sequence', name: 'public.fixture_seq', definition: { increment: '1' }, last_value: '9007199254740993', is_called: false },
    ...['move_section', 'move_task', 'move_task_inspection'].map(name => ({ kind: 'function', name: `public.${name}(integer,integer,integer)`, definition: 'fixture' })),
    { kind: 'fk_rows', name: 'public.fixture.fk', validated: true, violations: '0' },
    { kind: 'complete', tables: core.length, sequences: 1, foreign_keys: 1, functions: 3 },
  ];
}
const bytes = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
test('identidad distinta por DB y orden de propiedades JSON no producen falso negativo', () => {
  const a = fixture('artecnologia'), b = fixture('calidad');
  b[1] = { encoding: 'UTF8', kind: 'database_settings' };
  assert.equal(compareSnapshots(bytes(a), bytes(b)).equivalent, true);
});
test('COUNT, MAX, estructura y estado exacto de secuencia producen diferencias', () => {
  for (const [kind, mutate] of [
    ['count', r => { r.count = '1'; }], ['count', r => { r.max_keys = { clave: '42' }; }],
    ['table', r => { r.constraints = [{ name: 'pk_compuesta', validated: true }]; }],
    ['sequence', r => { r.is_called = true; }], ['sequence', r => { r.last_value = '9007199254740994'; }],
  ]) {
    const a = fixture('artecnologia'), b = fixture('calidad');
    mutate(b.find(r => r.kind === kind));
    assert.equal(compareSnapshots(bytes(a), bytes(b)).equivalent, false);
  }
});
test('rechaza captura truncada, DB equivocada, duplicados y secciones faltantes', () => {
  const rows = fixture('artecnologia');
  assert.throws(() => parseSnapshot(bytes(rows.slice(0, -1)), 'artecnologia'), /INCOMPLETE/);
  assert.throws(() => parseSnapshot(bytes(rows), 'calidad'), /WRONG_DATABASE/);
  assert.throws(() => parseSnapshot(bytes([rows[0], ...rows]), 'artecnologia'), /DUPLICATE/);
  assert.throws(() => parseSnapshot(bytes(rows.filter(r => r.kind !== 'sequence')), 'artecnologia'), /INCOMPLETE_SECTION/);
  assert.throws(() => parseSnapshot(bytes(rows.filter(r => r.kind !== 'count')), 'artecnologia'), /MISSING_OR_EXTRA_COUNT/);
  assert.throws(() => parseSnapshot(bytes(rows.filter(r => r.kind !== 'function')), 'artecnologia'), /MISSING_FUNCTION/);
});
test('FK historica no validada o con huerfanos exige revision aun con conteos iguales', () => {
  const a = fixture('artecnologia'), b = fixture('calidad');
  for (const rows of [a, b]) Object.assign(rows.find(r => r.kind === 'fk_rows'), { validated: false, violations: '2' });
  const result = compareSnapshots(bytes(a), bytes(b));
  assert.equal(result.equivalent, true);
  assert.equal(result.warnings.length, 1);
});
test('no exige id para PK compuesta o tabla sin PK numerica; falta una tabla no pasa', () => {
  const a = fixture('artecnologia'), b = fixture('calidad');
  for (const rows of [a, b]) rows.find(r => r.kind === 'count').max_keys = {};
  assert.equal(compareSnapshots(bytes(a), bytes(b)).equivalent, true);
  const name = core[0];
  assert.throws(() => parseSnapshot(bytes(a.filter(r => !(r.kind === 'table' && r.name === name))), 'artecnologia'), /MISSING_OR_EXTRA_TABLE/);
});
test('modo LOCAL exige identidad aislada y reporta el cambio de owner/ACL sin permitirlo en PROD', () => {
  const a = fixture('artecnologia_test_local'), b = fixture('calidad_test_local');
  for (const rows of [a, b]) Object.assign(rows[0], { user: 'workorders_test', address: '127.0.0.1', port: 5432 });
  a.find(r => r.kind === 'table').owner = 'postgres';
  b.find(r => r.kind === 'table').owner = 'workorders_test';
  const result = compareSnapshots(bytes(a), bytes(b), { mode: 'local_rehearsal' });
  assert.equal(result.equivalent, true); assert.equal(result.permission_differences.length, 1);
  assert.throws(() => compareSnapshots(bytes(a), bytes(b)), /WRONG_DATABASE/);
  b[0].address = '192.0.2.10';
  assert.throws(() => compareSnapshots(bytes(a), bytes(b), { mode: 'local_rehearsal' }), /LOCAL_IDENTITY_REQUIRED/);
  const prodA = fixture('artecnologia'), prodB = fixture('calidad');
  prodA.find(r => r.kind === 'table').owner = 'postgres';
  prodB.find(r => r.kind === 'table').owner = 'workorders_test';
  assert.equal(compareSnapshots(bytes(prodA), bytes(prodB)).equivalent, false);
});
test('dump selectivo excluye Logistica y requiere aprobacion explicita de historicos presentes', () => {
  const rows = fixture('artecnologia');
  const plan = prepareDumpArgs(bytes(rows));
  assert.equal(plan.argv.filter(a => a.startsWith('--table=')).length, core.length + 1);
  assert.ok(plan.argv.includes('--dbname=artecnologia'));
  assert.ok(plan.argv.every(a => !/logistica/.test(a)));
  const name = historical[0];
  rows.find(r => r.kind === 'scope').tables.find(t => t.name === name).present = true;
  rows.splice(-1, 0, { kind: 'table', name, constraints: [], indexes: [] }, { kind: 'count', name, count: '1', max_keys: { id: '1' } });
  rows.at(-1).tables++;
  assert.throws(() => prepareDumpArgs(bytes(rows)), /HISTORICAL_APPROVAL_REQUIRED/);
  assert.ok(prepareDumpArgs(bytes(rows), { approvedHistorical: [name] }).tables_and_sequences.includes(name));
});
