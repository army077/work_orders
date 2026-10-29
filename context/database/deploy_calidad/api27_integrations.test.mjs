// Pure JavaScript mocks and file inspection. No SQL, credentials or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { splitSQL } from './build_clean_baseline.mjs';
const require = createRequire(import.meta.url);
const { checkLocalConfiguration, checkDriveReadOnly, main } = require('./api27_integration_preflight.cjs');
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const directory = path.resolve('preflight-test-path-not-created');
const env = { APP_ENV: 'production', PGDATABASE: 'calidad', PGHOST: 'example.invalid',
  PGPORT: '5432', PGUSER: 'TEST_ONLY_ROLE', PGPASSWORD: 'TEST_ONLY_NOT_A_REAL_PASSWORD',
  FIREBASE_LOGISTICA_PROJECT_ID: 'logistica-ar',
  GOOGLE_APPLICATION_CREDENTIALS: path.join(directory, 'firebase.json'),
  LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH: path.join(directory, 'oauth.json'),
  LOGISTICA_DRIVE_TOKEN_PATH: path.join(directory, 'token.json'),
  LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID: 'TEST_ONLY_FOLDER' };
const documents = () => ({
  [env.GOOGLE_APPLICATION_CREDENTIALS]: { type: 'service_account', project_id: 'logistica-ar',
    client_email: 'test-only@example.invalid', private_key: 'TEST_ONLY_NOT_A_REAL_KEY' },
  [env.LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH]: { installed: {
    client_id: 'TEST_ONLY_CLIENT', client_secret: 'TEST_ONLY_NOT_A_REAL_SECRET' } },
  [env.LOGISTICA_DRIVE_TOKEN_PATH]: { refresh_token: 'TEST_ONLY_NOT_A_REAL_TOKEN' },
});
const evaluate = (values = env, docs = documents(), parsePrivateKey = () => {}) => checkLocalConfiguration({
  env: values, readFile: name => JSON.stringify(docs[name]), parsePrivateKey,
});
const goodFolder = { mimeType: 'application/vnd.google-apps.folder', trashed: false,
  capabilities: { canAddChildren: true } };

test('importing the preparation tool reads no files and opens no services', () => {
  const module = { exports: {} };
  const fakeRequire = name => {
    if (name === 'node:fs') return { readFileSync() { assert.fail('FILE_READ_ON_IMPORT'); } };
    if (name === 'node:path') return path;
    if (name === 'node:crypto') return { createPrivateKey() { assert.fail('KEY_PARSE_ON_IMPORT'); } };
    assert.fail('UNEXPECTED_IMPORT:' + name);
  };
  fakeRequire.main = null;
  vm.runInNewContext(read('api27_integration_preflight.cjs'), { module, require: fakeRequire });
  assert.deepEqual(Object.keys(module.exports), ['checkLocalConfiguration', 'checkDriveReadOnly', 'main']);
});
test('local checks return booleans only and validate a key without returning credentials', () => {
  let parsed = 0;
  const flags = evaluate(env, documents(), () => { parsed++; });
  assert.deepEqual(flags, { PG_CONFIG_LOCAL_OK: true, FIREBASE_CONFIG_LOCAL_OK: true, DRIVE_LOCAL_CONFIG_OK: true });
  assert.equal(parsed, 1);
  assert.doesNotMatch(JSON.stringify(flags), /TEST_ONLY|private_key|refresh_token/);
});
for (const [label, patch, field] of [
  ['wrong database', { PGDATABASE: 'artecnologia' }, 'PG_CONFIG_LOCAL_OK'],
  ['nonproduction environment', { APP_ENV: 'test' }, 'PG_CONFIG_LOCAL_OK'],
  ['missing DB password', { PGPASSWORD: '' }, 'PG_CONFIG_LOCAL_OK'],
  ['invalid port', { PGPORT: '65536' }, 'PG_CONFIG_LOCAL_OK'],
  ['wrong Firebase project', { FIREBASE_LOGISTICA_PROJECT_ID: 'other-project' }, 'FIREBASE_CONFIG_LOCAL_OK'],
  ['relative Firebase file', { GOOGLE_APPLICATION_CREDENTIALS: 'relative.json' }, 'FIREBASE_CONFIG_LOCAL_OK'],
  ['invalid Drive folder syntax', { LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID: 'https://example.invalid/' }, 'DRIVE_LOCAL_CONFIG_OK'],
]) test('local preflight rejects ' + label, () => assert.equal(evaluate({ ...env, ...patch })[field], false));

test('malformed/unreadable JSON, missing refresh token and malformed keys fail closed', () => {
  const docs = documents(); delete docs[env.LOGISTICA_DRIVE_TOKEN_PATH].refresh_token;
  assert.equal(evaluate(env, docs).DRIVE_LOCAL_CONFIG_OK, false);
  assert.equal(evaluate(env, documents(), () => { throw Error('PRIVATE_KEY_DETAILS'); }).FIREBASE_CONFIG_LOCAL_OK, false);
  const flags = checkLocalConfiguration({ env, readFile() { throw Error('SECRET_PATH'); } });
  assert.equal(flags.FIREBASE_CONFIG_LOCAL_OK, false); assert.equal(flags.DRIVE_LOCAL_CONFIG_OK, false);
});
test('web OAuth and installed OAuth use the same required refresh-only fields as the backend', () => {
  const docs = documents();
  docs[env.LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH].web = docs[env.LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH].installed;
  delete docs[env.LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH].installed;
  assert.equal(evaluate(env, docs).DRIVE_LOCAL_CONFIG_OK, true);
});
test('Drive readiness makes exactly one metadata GET and no object/permission writes', async () => {
  const calls = [];
  const ok = await checkDriveReadOnly({ getRootFolderId: () => 'TEST_ONLY_FOLDER',
    getClient: () => ({ files: { async get(params, options) {
      calls.push({ params, options }); return { data: goodFolder };
    } } }) });
  assert.equal(ok, true); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { params: { fileId: 'TEST_ONLY_FOLDER',
    fields: 'mimeType,trashed,capabilities(canAddChildren)', supportsAllDrives: true },
    options: { timeout: 45000, retry: false } });
});
test('Drive denies trashed/nonfolder/read-only/missing metadata and provider failures', async () => {
  for (const data of [null, {}, { ...goodFolder, trashed: true },
    { ...goodFolder, mimeType: 'image/png' }, { ...goodFolder, capabilities: {} },
    { ...goodFolder, capabilities: { canAddChildren: false } }]) {
    assert.equal(await checkDriveReadOnly({ getRootFolderId: () => 'TEST_ONLY_FOLDER',
      getClient: () => ({ files: { async get() { return { data }; } } }) }), false);
  }
  assert.equal(await checkDriveReadOnly({ getRootFolderId: () => 'TEST_ONLY_FOLDER',
    getClient() { throw Error('SECRET_PROVIDER_DETAILS'); } }), false);
});
test('local CLI mode never loads the API copy or performs a Drive request', async () => {
  const lines = [];
  const code = await main(['--local-config'], { output: line => lines.push(line),
    inspectLocal: () => ({ PG_CONFIG_LOCAL_OK: true, FIREBASE_CONFIG_LOCAL_OK: true, DRIVE_LOCAL_CONFIG_OK: true }),
    load() { assert.fail('API_LOADED_IN_LOCAL_MODE'); } });
  assert.equal(code, 0); assert.equal(lines.length, 3);
  assert.ok(lines.every(line => /^[A-Z_]+ = SI$/.test(line)));
});
test('Drive CLI rejects invalid args and never loads API code after invalid local configuration', async () => {
  for (const args of [[], ['--drive-readonly'], ['--drive-readonly', '--api-dir', 'relative']]) {
    assert.equal(await main(args, { output() {}, load() { assert.fail(); } }), 1);
  }
  const lines = [];
  assert.equal(await main(['--drive-readonly', '--api-dir', directory], {
    output: line => lines.push(line), inspectLocal: () => ({ DRIVE_LOCAL_CONFIG_OK: false }),
    load() { assert.fail(); } }), 1);
  assert.deepEqual(lines, ['DRIVE_CONFIG_OK = NO']);
});
test('Drive CLI prints only SI/NO, including when provider errors contain secret details', async () => {
  for (const failed of [false, true]) {
    const lines = [];
    const code = await main(['--drive-readonly', '--api-dir', directory], {
      output: line => lines.push(line), inspectLocal: () => ({ DRIVE_LOCAL_CONFIG_OK: true }),
      load: file => {
        assert.equal(file, path.join(directory, 'integrations', 'logisticaDrive.js'));
        return { getPedidosFolderId: () => 'TEST_ONLY_FOLDER', getLogisticaDriveClient: () => ({
          files: { async get() { if (failed) throw Error('SECRET_REFRESH_TOKEN_AND_FOLDER'); return { data: goodFolder }; } },
        }) };
      },
    });
    assert.equal(code, failed ? 1 : 0);
    assert.deepEqual(lines, [`DRIVE_CONFIG_OK = ${failed ? 'NO' : 'SI'}`]);
  }
});
test('manual registration binds only the real UID and optional labels, and never silently upserts', () => {
  const sql = read('register_logistica_real_user.sql');
  const statements = splitSQL(sql).map(s => s.replace(/^(?:\s*--[^\n]*(?:\n|$))*/, '').trim());
  assert.equal(statements[0], 'BEGIN'); assert.equal(statements.at(-1), 'COMMIT');
  assert.match(sql, /DATABASE_MUST_BE_CALIDAD/); assert.match(sql, /POSTGRESQL_16_REQUIRED/);
  assert.match(sql, /VALUES \('logistica-ar', \$1::text, \$2::text, \$3::text, true\)/);
  assert.equal(statements.filter(s => s.startsWith('INSERT INTO')).length, 1);
  assert.doesNotMatch(sql, /ON CONFLICT|\b(?:UPDATE|DELETE|TRUNCATE|CREATE|ALTER)\b/);
});
test('authorization verification is read-only, exact UID/project/active, and returns no identity', () => {
  const sql = read('validate_logistica_real_user.sql');
  assert.match(sql, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(sql, /firebase_project = 'logistica-ar'[\s\S]*firebase_uid = \$1::text[\s\S]*is_active = true/);
  assert.match(sql, /'LOGISTICA_AUTH_ACTIVA'/); assert.match(sql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|TRUNCATE)\b/);
});
