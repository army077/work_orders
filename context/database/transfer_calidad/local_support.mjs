import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { invariant } from '../migrations/prod/logistica_prod_support.js';
const require = createRequire(new URL('../../api10/package.json', import.meta.url));
const { Client } = require('pg');
export const SOURCE = 'artecnologia_test_local';
export const DESTINATION = 'calidad_test_local';
export function assertLocalConfig(env = process.env) {
  invariant(env.APP_ENV === 'local' && env.PGDATABASE === SOURCE && env.PGUSER === 'workorders_test'
    && ['127.0.0.1', 'localhost', '::1'].includes(env.PGHOST) && env.PGPORT === '5432'
    && Boolean(env.PGPASSWORD), 'LOCAL_REHEARSAL_ENV_REQUIRED');
}
export async function connectLocal(database) {
  assertLocalConfig();
  invariant([SOURCE, DESTINATION].includes(database), 'LOCAL_DATABASE_REQUIRED');
  const client = new Client({ host: '127.0.0.1', port: 5432, user: 'workorders_test',
    password: process.env.PGPASSWORD, database, ssl: false, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const { rows: [id] } = await client.query("SELECT current_database() db,current_user username,session_user session_user,"
      + "host(inet_server_addr()) address,inet_server_port() port,current_setting('server_version_num')::int version");
    invariant(id.db === database && id.username === 'workorders_test' && id.session_user === 'workorders_test'
      && id.address === '127.0.0.1' && id.port === 5432 && Math.floor(id.version / 10000) === 16, 'LOCAL_IDENTITY_REQUIRED');
    return client;
  } catch (error) { await client.end().catch(() => {}); throw error; }
}
export const readJsonLines = path => readFileSync(path, 'utf8').split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s));
export async function sourceState(client, names) {
  const output = {};
  for (const table of names) {
    invariant(/^public\.[a-z_][a-z0-9_]*$/.test(table), 'INVALID_IDENTIFIER');
    if (!(await client.query('SELECT to_regclass($1) AS oid', [table])).rows[0].oid) continue;
    output[table] = (await client.query("SELECT count(*)::text count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) digest FROM " + table + ' t')).rows[0];
    const seq = (await client.query('SELECT pg_get_serial_sequence($1,$2) name', [table, 'id'])).rows[0].name;
    if (seq) {
      invariant(/^public\.[a-z_][a-z0-9_]*$/.test(seq), 'INVALID_SEQUENCE_IDENTIFIER');
      output[table].sequence = (await client.query('SELECT last_value::text,is_called FROM ' + seq)).rows[0];
    }
  }
  return output;
}
