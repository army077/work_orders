import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalConfig } from './local_support.mjs';
import { sequenceSafety } from './sequence_safety.mjs';
const env = { APP_ENV: 'local', PGDATABASE: 'artecnologia_test_local', PGUSER: 'workorders_test',
  PGHOST: '127.0.0.1', PGPORT: '5432', PGPASSWORD: 'TEST_ONLY_NOT_A_SECRET' };
test('harness rechaza cualquier configuracion productiva, remota o sin credenciales locales', () => {
  assert.doesNotThrow(() => assertLocalConfig(env));
  for (const patch of [{ APP_ENV: 'production' }, { PGDATABASE: 'calidad' }, { PGDATABASE: 'artecnologia' },
    { PGDATABASE: 'calidad_test_local' }, { PGHOST: '192.0.2.10' }, { PGUSER: 'postgres' }, { PGPASSWORD: '' }, { PGPORT: '5433' }])
    assert.throws(() => assertLocalConfig({ ...env, ...patch }), /LOCAL_REHEARSAL_ENV_REQUIRED/);
});
function client({ last = '10', called = true, increment = '1', cache = '1', cycle = false, min = null, max = '10' } = {}) {
  const queries = [];
  return { queries, async query(sql) {
    queries.push(sql);
    assert.doesNotMatch(sql, /\b(?:nextval|setval|INSERT|UPDATE|DELETE)\b/i);
    if (sql.startsWith('WITH selected')) return { rows: [{ sequence: 'public.seq', table_name: 'public.composite_key', column_name: 'folio',
      increment, min: increment === '-1' ? '-100' : '1', max: '9223372036854775807', cache, cycle, numeric_column: true }] };
    if (sql.startsWith('SELECT last_value')) return { rows: [{ last_value: last, is_called: called }] };
    return { rows: [{ min, max }] };
  } };
}
test('siguiente candidato verifica is_called, BIGINT y columna consumidora sin suponer id', async () => {
  for (const options of [{}, { last: '9007199254740993', max: '9007199254740992', called: false },
    { last: '10', called: false, max: '9' }, { last: '-10', increment: '-1', min: '-10' }]) {
    const c = client(options), result = await sequenceSafety(c, ['public.composite_key']);
    assert.equal(result.safe, true); assert.equal(result.checked_consumers, 1);
    assert.ok(c.queries.some(sql => sql.includes('"folio"')));
  }
});
test('colision, agotamiento, CYCLE y cache no comprobable bloquean sin reparar datos', async () => {
  for (const options of [{ max: '11' }, { called: false }, { last: '9223372036854775807' }, { cache: '10' }, { cycle: true }])
    assert.equal((await sequenceSafety(client(options), ['public.composite_key'])).safe, false);
});
