const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const directory = join(__dirname, '../tests');
const files = readdirSync(directory).filter(name => name.endsWith('.test.js')).sort().map(name => join(directory, name));
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', env: {
  ...process.env, RUN_CALIDAD_API_TESTS: '0', RUN_LOGISTICA_DELIVERY_HISTORY_LOCAL_TESTS: '0',
} });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
