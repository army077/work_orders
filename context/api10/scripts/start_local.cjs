// Node 18 replacement for --env-file. Only the fixed local file and LOCAL target.
const fs = require('node:fs');
const path = require('node:path');
function parseLocalEnv(text) {
  const output = {};
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) throw new Error('LOCAL_ENV_FORMAT_INVALID');
    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      const quoted = value.match(/^("[^"\r\n]*"|'[^'\r\n]*')\s*(?:#.*)?$/);
      if (!quoted) throw new Error('LOCAL_ENV_FORMAT_INVALID');
      value = quoted[1].slice(1, -1);
    } else value = value.replace(/\s+#.*$/, '').trim();
    output[match[1]] = value;
  }
  return output;
}
module.exports = { parseLocalEnv };
if (require.main === module) {
  const values = parseLocalEnv(fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8'));
  // Match --env-file precedence, then enforce LOCAL before loading server/db.
  for (const [key, value] of Object.entries(values)) if (!Object.hasOwn(process.env, key)) process.env[key] = value;
  if (process.env.APP_ENV !== 'local' || process.env.PGDATABASE !== 'artecnologia_test_local'
    || !['127.0.0.1', 'localhost', '::1'].includes(process.env.PGHOST)) throw new Error('LOCAL_ENV_REQUIRED');
  require('../server');
}
