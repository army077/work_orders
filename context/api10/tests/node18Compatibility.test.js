const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { audit } = require('../scripts/audit_node18_engines.cjs');
const { parseLocalEnv } = require('../scripts/start_local.cjs');

test('full runtime lock (including optional installed branches) accepts Node 18.19.1', () => {
  const result = audit(require('../package-lock.json'));
  assert.equal(result.compatible, true);
  assert.deepEqual(require('./engines_node18_final.json'), result);
  assert.equal(result.incompatible.length, 0);
  assert.ok(result.optional_runtime > 0);
  const bad = structuredClone(require('../package-lock.json'));
  bad.packages['node_modules/firebase-admin'].engines.node = '>=22';
  assert.equal(audit(bad).compatible, false);
});
test('engine audit distinguishes dev-only and required/optional transitive paths', () => {
  const lock = { packages: { '': { dependencies: { a: '1' } },
    'node_modules/a': { version: '1', dependencies: { b: '1' }, optionalDependencies: { c: '1' } },
    'node_modules/b': { version: '1', engines: { node: '>=22' } },
    'node_modules/c': { version: '1', optional: true, engines: { node: '>=20' } },
    'node_modules/d': { version: '1', dev: true, engines: { node: '>=22' } } } };
  const result = audit(lock);
  assert.equal(result.incompatible.length, 2);
  assert.equal(result.rows.find(r => r.name === 'd').classification, 'dev');
  assert.equal(result.rows.find(r => r.name === 'c').classification, 'optional-runtime');
});
test('Node18 local env loader preserves quoted values without evaluating shell content', () => {
  assert.deepEqual(parseLocalEnv('APP_ENV=local\nPGHOST=127.0.0.1 # local\nX="test # only"\nY=literal$(unused)'),
    { APP_ENV: 'local', PGHOST: '127.0.0.1', X: 'test # only', Y: 'literal$(unused)' });
  assert.throws(() => parseLocalEnv('broken line'), /INVALID/);
});
test('real Firebase SDK: ADC initialization and RS256 verifyIdToken, no Google network', async () => {
  const https = require('node:https'), oldRequest = https.request;
  https.request = () => { throw new Error('NETWORK_FORBIDDEN_IN_TEST'); };
  const oldProject = process.env.FIREBASE_LOGISTICA_PROJECT_ID;
  const oldCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  process.env.FIREBASE_LOGISTICA_PROJECT_ID = 'logistica-ar';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const firebaseLib = path.resolve(path.dirname(require.resolve('firebase-admin/app')), '..');
  const { HttpClient } = require(path.join(firebaseLib, 'utils/api-request.js'));
  const send = HttpClient.prototype.send;
  let certificateRequests = 0;
  HttpClient.prototype.send = async function (request) {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
    certificateRequests++;
    return { isJson: () => true, headers: { 'cache-control': 'public,max-age=3600' },
      data: { TEST_ONLY_KEY: publicKey.export({ type: 'spki', format: 'pem' }) } };
  };
  const { getLogisticaAuth } = require('../auth/firebaseLogistica');
  const { deleteApp } = require('firebase-admin/app');
  let auth;
  try {
    auth = getLogisticaAuth();
    assert.equal(typeof auth.app.options.credential.getAccessToken, 'function');
    const { OAuth2Client } = require('google-auth-library');
    const adcClient = new OAuth2Client('TEST_ONLY_CLIENT', 'TEST_ONLY_NOT_A_REAL_SECRET');
    adcClient.setCredentials({ refresh_token: 'TEST_ONLY_NOT_A_REAL_TOKEN' });
    let adcRefresh = false;
    adcClient.transporter.request = async options => {
      assert.match(String(options.url), /oauth2\.googleapis\.com\/token/);
      adcRefresh = true;
      return { data: { access_token: 'TEST_ONLY_ACCESS_TOKEN', expires_in: 3600, token_type: 'Bearer' } };
    };
    // Simulate credential discovery, exercising the real ADC wrapper and OAuth2 refresh.
    auth.app.options.credential.googleAuth.getClient = async () => adcClient;
    const access = await auth.app.options.credential.getAccessToken();
    assert.equal(access.access_token, 'TEST_ONLY_ACCESS_TOKEN'); assert.equal(adcRefresh, true);
    const now = Math.floor(Date.now() / 1000);
    const token = patch => {
      const payload = { aud: 'logistica-ar', iss: 'https://securetoken.google.com/logistica-ar', sub: 'TEST_ONLY_UID',
        iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'custom' }, ...patch };
      const data = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'TEST_ONLY_KEY' })).toString('base64url') + '.'
        + Buffer.from(JSON.stringify(payload)).toString('base64url');
      return data + '.' + crypto.sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
    };
    assert.equal((await auth.verifyIdToken(token({}))).uid, 'TEST_ONLY_UID');
    await assert.rejects(auth.verifyIdToken(token({ aud: 'TEST_ONLY_OTHER_PROJECT' })));
    await assert.rejects(auth.verifyIdToken(token({ exp: now - 3600 })));
    const middleware = require('../auth/requireLogisticaFirebaseAuth').requireLogisticaFirebaseAuth;
    const req = { headers: { authorization: 'Bearer ' + token({}) }, body: { uid: 'IGNORED_CLIENT_UID' } };
    let next = false;
    await middleware(req, { status() { throw new Error('UNEXPECTED_AUTH_FAILURE'); } }, () => { next = true; });
    assert.equal(next, true); assert.equal(req.auth.uid, 'TEST_ONLY_UID');
    assert.ok(certificateRequests > 0);
  } finally {
    HttpClient.prototype.send = send; https.request = oldRequest;
    if (auth) await deleteApp(auth.app);
    if (oldProject === undefined) delete process.env.FIREBASE_LOGISTICA_PROJECT_ID; else process.env.FIREBASE_LOGISTICA_PROJECT_ID = oldProject;
    if (oldCredentials === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS; else process.env.GOOGLE_APPLICATION_CREDENTIALS = oldCredentials;
  }
});
test('real allowlist middleware uses only verified UID and rejects absent/inactive membership', async () => {
  const module = { exports: {} }, calls = [];
  let rows = [];
  vm.runInNewContext(fs.readFileSync(require.resolve('../auth/requireLogisticaAuthorizedUser'), 'utf8'), {
    module, console, require(name) { assert.equal(name, '../db'); return { async query(sql, args) { calls.push({ sql, args }); return { rows }; } }; }
  });
  const middleware = module.exports.requireLogisticaAuthorizedUser;
  const req = { auth: { uid: 'VERIFIED_UID', firebaseProject: 'logistica-ar' }, body: { uid: 'UNTRUSTED_UID' } };
  let status;
  const response = { status(code) { status = code; return this; }, json() {} };
  await middleware(req, response, () => assert.fail('must deny'));
  assert.equal(status, 403); assert.match(calls[0].sql, /is_active = true/);
  assert.equal(JSON.stringify(calls[0].args), JSON.stringify(['logistica-ar', 'VERIFIED_UID']));
  rows = [{ id: '1', firebase_uid: 'VERIFIED_UID', email: null, display_name: null }];
  let next = false; await middleware(req, response, () => { next = true; });
  assert.equal(next, true); assert.equal(req.logisticaUser.firebaseUid, 'VERIFIED_UID');
});
test('real googleapis OAuth2/Drive construction and generated request adapter with isolated transport', async () => {
  fs.mkdirSync(path.join(__dirname, '../runtime-node18.local'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(__dirname, '../runtime-node18.local/drive-test-'));
  const names = ['LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH', 'LOGISTICA_DRIVE_TOKEN_PATH', 'LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID'];
  const saved = names.map(name => process.env[name]);
  const https = require('node:https'), request = https.request;
  https.request = () => { throw new Error('NETWORK_FORBIDDEN_IN_TEST'); };
  try {
    const credentials = path.join(dir, 'credentials.json'), token = path.join(dir, 'token.json');
    fs.writeFileSync(credentials, JSON.stringify({ installed: { client_id: 'TEST_ONLY_CLIENT', client_secret: 'TEST_ONLY_NOT_A_REAL_SECRET' } }));
    fs.writeFileSync(token, JSON.stringify({ refresh_token: 'TEST_ONLY_NOT_A_REAL_TOKEN' }));
    Object.assign(process.env, { LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH: credentials, LOGISTICA_DRIVE_TOKEN_PATH: token, LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID: 'TEST_ONLY_ROOT' });
    const client = require('../integrations/logisticaDrive').getLogisticaDriveClient();
    const auth = client.context._options.auth;
    assert.equal(auth.credentials.refresh_token, 'TEST_ONLY_NOT_A_REAL_TOKEN');
    assert.equal(typeof auth.refreshAccessToken, 'function');
    let refreshed = false;
    auth.transporter.request = async options => {
      assert.match(String(options.url), /oauth2\.googleapis\.com\/token/);
      refreshed = true;
      return { data: { access_token: 'TEST_ONLY_DRIVE_ACCESS_TOKEN', expires_in: 3600, token_type: 'Bearer' } };
    };
    assert.equal((await auth.getAccessToken()).token, 'TEST_ONLY_DRIVE_ACCESS_TOKEN');
    assert.equal(refreshed, true);
    let options;
    auth.request = async input => { options = input; return { data: { ids: ['TEST_ONLY_ID'] } }; };
    assert.deepEqual((await client.files.generateIds({ count: 1 })).data.ids, ['TEST_ONLY_ID']);
    assert.match(String(options.url), /drive\/v3\/files\/generateIds/);
  } finally {
    https.request = request;
    for (const name of ['credentials.json', 'token.json']) {
      const file = path.join(dir, name); if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(dir);
    names.forEach((name, i) => saved[i] === undefined ? delete process.env[name] : process.env[name] = saved[i]);
  }
});
test('forbidden ZIP/ASF input is rejected before any vulnerable format parser, regardless of client MIME', async () => {
  const { validateEvidenceInput } = require('../services/logisticaEvidencePolicy');
  for (const buffer of [Buffer.from('504b0304' + '00'.repeat(64), 'hex'), Buffer.from('3026b2758e66cf11a6d900aa0062ce6c' + '00'.repeat(64), 'hex')]) {
    await assert.rejects(validateEvidenceInput('1', { client_evidence_id: '00000000-0000-4000-8000-000000000001', evidence_type: 'PHOTO' },
      { fieldname: 'file', mimetype: 'image/png', buffer }), error => error.status === 400);
  }
});
