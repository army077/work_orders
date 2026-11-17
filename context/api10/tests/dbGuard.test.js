const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require.resolve('../db.js'), 'utf8');
const base = { APP_ENV: 'production', PGHOST: 'example.invalid', PGPORT: '5432',
  PGUSER: 'TEST_ONLY_ROLE', PGPASSWORD: 'TEST_ONLY_NOT_A_SECRET', PGDATABASE: 'calidad' };
function load(env) {
  const pools = [], module = { exports: {} };
  const sandbox = { process: { env }, module, require(name) {
    assert.equal(name, 'pg');
    return { Pool: class { constructor(config) { pools.push(config); } } };
  } };
  vm.runInNewContext(source, sandbox, { filename: 'db.js' });
  assert.equal(pools.length, 1, 'Un solo Pool');
  return pools[0];
}
test('db.js real: production/calidad permitido, otros destinos rechazados', () => {
  assert.equal(load(base).database, 'calidad');
  for (const PGDATABASE of ['artecnologia', 'artecnologia_test_local', 'calidad_test_local', 'artecnologia_test'])
    assert.throws(() => load({ ...base, PGDATABASE }), /Base de datos no permitida/);
});
test('db.js real: LOCAL mantiene base aislada y host loopback', () => {
  for (const PGHOST of ['localhost', '127.0.0.1', '::1'])
    assert.equal(load({ ...base, APP_ENV: 'local', PGDATABASE: 'artecnologia_test_local', PGHOST }).database, 'artecnologia_test_local');
  assert.throws(() => load({ ...base, APP_ENV: 'local', PGDATABASE: 'artecnologia_test_local' }), /solo permite PostgreSQL local/);
  for (const PGDATABASE of ['calidad', 'artecnologia', 'calidad_test_local'])
    assert.throws(() => load({ ...base, APP_ENV: 'local', PGDATABASE, PGHOST: '127.0.0.1' }), /Base de datos no permitida/);
});
test('db.js real: TEST mantiene artecnologia_test, rechaza bases productivas/locales', () => {
  assert.equal(load({ ...base, APP_ENV: 'test', PGDATABASE: 'artecnologia_test' }).database, 'artecnologia_test');
  for (const PGDATABASE of ['calidad', 'artecnologia', 'artecnologia_test_local', 'calidad_test_local'])
    assert.throws(() => load({ ...base, APP_ENV: 'test', PGDATABASE }), /Base de datos no permitida/);
});
test('db.js real: faltantes y APP_ENV desconocido fallan antes del Pool', () => {
  for (const key of Object.keys(base)) {
    const env = { ...base }; delete env[key];
    assert.throws(() => load(env), /Falta la variable de entorno/);
  }
  for (const APP_ENV of ['staging', 'Production']) assert.throws(() => load({ ...base, APP_ENV }), /APP_ENV no válido/);
});
