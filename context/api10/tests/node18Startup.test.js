const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const path = require('node:path');
test('API10 starts and health returns 200 with TEST config and outbound networking forbidden', { timeout: 20000 }, async () => {
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'helpers/offlineServerGuard.cjs'), path.join(__dirname, '../server.js')], {
    env: { ...process.env, APP_ENV: 'test', PGHOST: '127.0.0.1', PGPORT: '9', PGUSER: 'TEST_ONLY_ROLE',
      PGPASSWORD: 'TEST_ONLY_NOT_A_SECRET', PGDATABASE: 'artecnologia_test', FIREBASE_LOGISTICA_PROJECT_ID: 'logistica-ar' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', () => reject(new Error('SERVER_EXITED_BEFORE_READY')));
      child.stderr.on('data', () => reject(new Error('SERVER_STARTUP_ERROR')));
      child.stdout.on('data', bytes => { if (String(bytes).includes('API10 escuchando')) resolve(); });
    });
    const response = await new Promise((resolve, reject) => http.get('http://127.0.0.1:3010/api10/health', res => {
      let body = ''; res.on('data', b => body += b); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject));
    assert.equal(response.status, 200); assert.equal(response.body.ok, true);
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  }
});
