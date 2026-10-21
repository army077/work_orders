import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const require = createRequire(new URL('../../../api10/package.json', import.meta.url));
const { Client } = require('pg');
export const NAMES = Object.freeze([
  '20261016_create_logistica_authorized_users.sql',
  '20261016_create_logistica_deliveries.sql',
  '20261019_extend_logistica_delivery_evidence.sql',
  '20261019_add_logistica_delivery_drive_folder.sql',
  '20261020_add_logistica_delivery_completion.sql',
  '20261021_create_entregas_logistica_legacy.sql',
  '20261021_create_logistica_legacy_owner_mapping.sql',
]);
export const TABLES = Object.freeze(['logistica_authorized_users','logistica_deliveries',
  'logistica_delivery_evidence','entregas_logistica_legacy','logistica_legacy_owner_mapping',
  'logistica_schema_migrations']);
export const shapeSql = readFileSync(new URL('./logistica_schema_shape.sql', import.meta.url),'utf8');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function invariant(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}
export const isMain = url => process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);
export function safeFailure(error) {
  console.error(JSON.stringify({ ok: false, code: /^[A-Z0-9_]+$/.test(error.code || '')
    ? error.code : 'OPERATION_FAILED' }));
  process.exitCode = 1;
}
export function options(args, allowed) {
  const result = {};
  for (let i=0;i<args.length;i+=2) {
    invariant(allowed.includes(args[i]) && args[i+1] && !Object.hasOwn(result,args[i]), 'INVALID_ARGUMENTS');
    result[args[i]]=args[i+1];
  }
  return result;
}
export const TARGET_ARGS = ['--expected-user','--expected-server-address','--expected-server-port','--confirm-production'];
export function targetFromOptions(opts, env=process.env) {
  invariant(env.APP_ENV==='production' && env.PGDATABASE==='artecnologia', 'PROD_ENV_REQUIRED');
  for (const name of ['PGHOST','PGPORT','PGUSER','PGPASSWORD']) invariant(env[name]?.trim(), 'PG_CONFIG_REQUIRED');
  invariant(!['local','test','workorders_test'].includes(env.PGUSER), 'PROD_ROLE_REQUIRED');
  invariant(opts['--confirm-production']==='artecnologia', 'PROD_CONFIRMATION_REQUIRED');
  invariant(opts['--expected-user']===env.PGUSER, 'EXPECTED_USER_REQUIRED');
  invariant(opts['--expected-server-address']?.trim(), 'EXPECTED_SERVER_ADDRESS_REQUIRED');
  const port=opts['--expected-server-port'];
  invariant(typeof port==='string' && /^[1-9][0-9]*$/.test(port) && Number(port)<=65535
    && env.PGPORT===port, 'EXPECTED_SERVER_PORT_REQUIRED');
  return { user:env.PGUSER,address:opts['--expected-server-address'],port:Number(port) };
}
export const identitySql = 'SELECT current_database() AS database,current_user AS username,'
  + 'session_user AS session_user,host(inet_server_addr()) AS address,inet_server_port() AS port,'
  + "current_setting('server_version_num')::int AS version_num,version() AS version";
export function matchesTarget(identity,target) {
  return identity.database==='artecnologia' && identity.username===target.user
    && identity.session_user===target.user && identity.username!=='workorders_test'
    && identity.address===target.address && identity.port===target.port
    && Math.floor(identity.version_num/10000)===16;
}
export async function assertTarget(client,target) {
  const identity=(await client.query(identitySql)).rows[0];
  invariant(matchesTarget(identity,target),'PROD_IDENTITY_MISMATCH');
  return identity;
}
export async function connectProduction(target) {
  const client=new Client({host:process.env.PGHOST,port:target.port,user:target.user,
    password:process.env.PGPASSWORD,database:'artecnologia',connectionTimeoutMillis:5000,
    application_name:'logistica_prod_admin'});
  try { await client.connect(); await assertTarget(client,target); return client; }
  catch(error) { await client.end().catch(()=>{}); throw error; }
}
export function artifacts() {
  return NAMES.map(name=>{
    const bytes=readFileSync(new URL('./'+name,import.meta.url));
    invariant(Buffer.from(bytes.toString('utf8')).equals(bytes),'MIGRATION_INVALID_UTF8');
    return { name,sha256:sha256(bytes),sql:bytes.toString('utf8') };
  });
}
export function states() {
  return JSON.parse(readFileSync(new URL('./logistica_schema_states.json',import.meta.url),'utf8'));
}
export async function schemaState(client, schema='public') {
  invariant(/^[a-z][a-z0-9_]*$/.test(schema),'INVALID_SCHEMA_NAME');
  return (await client.query(shapeSql,[schema])).rows[0];
}
export function verifyLedger(rows, files=artifacts()) {
  invariant(rows.length<=NAMES.length,'UNKNOWN_MIGRATION');
  const byName=new Map(rows.map(r=>[r.migration_name,r]));
  invariant(byName.size===rows.length,'DUPLICATE_MIGRATION');
  for (let i=0;i<rows.length;i++) {
    invariant(byName.get(files[i].name)?.migration_sha256===files[i].sha256,'MIGRATION_CHECKSUM_OR_ORDER_MISMATCH');
  }
  return rows.length;
}
export async function inspectSchema(client, schema='public') {
  const actual=await schemaState(client,schema), expected=states();
  const ledgerShape=actual.shape.tables.logistica_schema_migrations;
  const ledgerExpected=expected[1].columns.logistica_schema_migrations;
  invariant(!ledgerShape || isDeepStrictEqual(ledgerShape.columns,ledgerExpected),'LEDGER_DRIFT');
  const ledger=ledgerShape ? (await client.query('SELECT migration_name,migration_sha256,'
    + 'applied_at::text,applied_by FROM "'+schema+'".logistica_schema_migrations ORDER BY migration_name')).rows : [];
  const stage=verifyLedger(ledger);
  const columnConflicts=[],conflictingColumns=[];
  for(const name of TABLES) {
    const present=actual.shape.tables[name]?.columns??null,wanted=expected[stage].columns[name];
    if(!isDeepStrictEqual(present,wanted)) {
      columnConflicts.push(name);
      const names=[...new Set([...(present??[]),...(wanted??[])].map(c=>c[0]))];
      conflictingColumns.push({table:name,columns:names.filter(n=>
        !isDeepStrictEqual(present?.find(c=>c[0]===n),wanted?.find(c=>c[0]===n)))});
    }
  }
  return {stage,ledger,fingerprint:actual.fingerprint,shape:actual.shape,
    drift:actual.fingerprint!==expected[stage].fingerprint,columnConflicts,conflictingColumns};
}
export async function configureMigration(client,target,file) {
  const entries={
    'logistica.confirm_production':'artecnologia',
    'logistica.expected_user':target.user,'logistica.expected_server_address':target.address,
    'logistica.expected_server_port':String(target.port),
    'logistica.migration_name':file.name,'logistica.migration_sha256':file.sha256,
  };
  for(const [name,value] of Object.entries(entries)) await client.query('SELECT set_config($1,$2,false)',[name,value]);
}
export function requireNextMigration(state,name,files=artifacts()) {
  invariant(!state.drift,'LOGISTICA_SCHEMA_DRIFT');
  const index=files.findIndex(f=>f.name===name);
  invariant(index>=0,'UNKNOWN_MIGRATION');
  invariant(index>=state.stage,'MIGRATION_ALREADY_REGISTERED');
  invariant(index===state.stage,'MIGRATION_ORDER_REQUIRED');
  return files[index];
}
