// Plantilla verificable de los artefactos. No es un ejecutor ni un comando PROD.
import {shapeSql,TABLES} from '../../migrations/prod/logistica_prod_support.js';
import {localBody,ledgerDDL} from './fixture.js';
export const ddlBody=(name,index)=>(index===0?ledgerDDL+'\n\n':'')+localBody(name);
function shapeGuard(hash,label) {
  const query=shapeSql.replace('$1::text',"'public'::text")
    .replace("SELECT encode(sha256(convert_to(shape::text,'UTF8')),'hex') AS fingerprint, shape FROM signature;",
      "SELECT encode(sha256(convert_to(shape::text,'UTF8')),'hex') INTO actual_hash FROM signature;");
  return `DO $shape$\nDECLARE actual_hash text;\nBEGIN\n${query}\nIF actual_hash IS DISTINCT FROM '${hash}' THEN
  RAISE EXCEPTION '${label}';
END IF;\nEND;\n$shape$;`;
}
export function renderMigration(name,index,states,previous) {
  return `-- PROD: ejecutar solamente mediante apply_logistica_migration_prod.js.
-- Sin backfill, usuarios, ownership, HTTP ni acceso a Drive.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF current_database() IS DISTINCT FROM 'artecnologia'
     OR current_user IS DISTINCT FROM session_user
     OR current_user = 'workorders_test'
     OR current_setting('logistica.confirm_production',true) IS DISTINCT FROM 'artecnologia'
     OR current_setting('logistica.expected_user',true) IS DISTINCT FROM current_user::text
     OR coalesce(current_setting('logistica.expected_server_address',true),'') = ''
     OR current_setting('logistica.expected_server_address',true) IS DISTINCT FROM host(inet_server_addr())
     OR current_setting('logistica.expected_server_port',true) IS DISTINCT FROM inet_server_port()::text
     OR inet_server_addr() IS NULL
     OR current_setting('server_version_num')::int / 10000 <> 16
     OR current_setting('logistica.migration_name',true) IS DISTINCT FROM '${name}'
     OR coalesce(current_setting('logistica.migration_sha256',true),'') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'PROD_IDENTITY_OR_APPROVAL_REQUIRED';
  END IF;
END;
$guard$;
SELECT pg_advisory_xact_lock(2026102101);
DO $locks$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[${TABLES.map(n=>"'"+n+"'").join(',')}] LOOP
    IF to_regclass('public.'||name) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',name);
    END IF;
  END LOOP;
END;
$locks$;
${shapeGuard(states[index].fingerprint,'LOGISTICA_SCHEMA_DRIFT_OR_ALREADY_APPLIED')}
DO $ledger$
DECLARE actual jsonb;
BEGIN
${index===0?'  -- El fingerprint anterior exige ausencia del ledger.':`  SELECT coalesce(jsonb_object_agg(migration_name,migration_sha256),'{}'::jsonb)
    INTO actual FROM public.logistica_schema_migrations;
  IF actual IS DISTINCT FROM '${JSON.stringify(Object.fromEntries(previous.map(f=>[f.name,f.sha256])))}'::jsonb THEN
    RAISE EXCEPTION 'MIGRATION_CHECKSUM_OR_ORDER_MISMATCH';
  END IF;`}
END;
$ledger$;
-- BEGIN LOGISTICA DDL
${ddlBody(name,index)}
-- END LOGISTICA DDL
${shapeGuard(states[index+1].fingerprint,'LOGISTICA_POST_SCHEMA_DRIFT')}
INSERT INTO public.logistica_schema_migrations(migration_name,migration_sha256)
  VALUES ('${name}',current_setting('logistica.migration_sha256'));
COMMIT;
`;
}
