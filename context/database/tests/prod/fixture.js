import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { invariant, TABLES } from '../../migrations/prod/logistica_prod_support.js';
const require=createRequire(new URL('../../../api10/package.json',import.meta.url));
const {Client}=require('pg');
export function localBody(name) {
  const source=readFileSync(new URL('../../migrations/local/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
  const end=source.indexOf('$$;',source.indexOf('DO $$'))+3;
  invariant(end>3,'LOCAL_GUARD_NOT_FOUND');
  return source.slice(end,source.lastIndexOf('COMMIT;')).trim();
}
export const ledgerDDL=`CREATE TABLE public.logistica_schema_migrations (
  migration_name TEXT PRIMARY KEY,
  migration_sha256 TEXT NOT NULL CHECK (migration_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by TEXT NOT NULL DEFAULT current_user
);`;
export async function beginFixture(client) {
  await client.query('BEGIN');
  await client.query('CREATE TEMP TABLE logistica_prod_fixture_anchor(value int) ON COMMIT DROP');
  const schema=(await client.query('SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema()')).rows[0].nspname;
  await client.query('SET LOCAL search_path=pg_catalog');
  return schema;
}
export const inSchema=(sql,schema)=>{
  invariant(/^pg_temp_[0-9]+$/.test(schema),'TEST_SCHEMA_REQUIRED');
  return sql.replaceAll('public.',schema+'.');
};
export async function connectTest() {
  invariant(process.env.RUN_LOGISTICA_PROD_ARTIFACT_TESTS==='1','EXPLICIT_LOCAL_TEST_FLAG_REQUIRED');
  invariant(process.env.APP_ENV==='local'&&process.env.PGDATABASE==='artecnologia_test_local'
    &&process.env.PGUSER==='workorders_test'&&['127.0.0.1','localhost','::1'].includes(process.env.PGHOST)
    &&process.env.PGPORT==='5432','LOCAL_TEST_ENV_REQUIRED');
  const client=new Client({host:process.env.PGHOST,port:5432,user:'workorders_test',
    password:process.env.PGPASSWORD,database:'artecnologia_test_local',ssl:false,connectionTimeoutMillis:5000});
  try {
    await client.connect();
    const {rows:[id]}=await client.query("SELECT current_database() db,current_user role,host(inet_server_addr()) address,inet_server_port() port");
    invariant(id.db==='artecnologia_test_local'&&id.role==='workorders_test'
      &&['127.0.0.1','::1'].includes(id.address)&&id.port===5432,'LOCAL_TEST_CONNECTION_REQUIRED');
    return client;
  } catch(error) {await client.end().catch(()=>{});throw error;}
}
export async function protectedState(client) {
  const output={};
  for(const name of TABLES.slice(0,5)) {
    const {rows:[row]}=await client.query("SELECT count(*)::text AS count,md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY id),'')) hash FROM public."+name+' t');
    const {rows:seq}=await client.query('SELECT last_value::text,is_called FROM public.'+name+'_id_seq');
    output[name]={...row,sequence:seq};
  }
  return output;
}
