// Offline SQL authoring only. No DB driver, connection or SQL execution.
import { baselineModel,checksCTEs } from './build_clean_baseline.mjs';
import { expressionGuard } from './semantic_expressions.mjs';
import { testData } from './build_test_seed.mjs';
export const advancedTestTables=['machine_family','machine_model','maintenance_template','template_section','template_task','work_order','work_order_task'];
export const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
export function cleanupPreamble(model,{readOnly=false}={}) {
 return `${readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;':'BEGIN;'}
SET LOCAL search_path = pg_catalog, public;
SET LOCAL standard_conforming_strings = on;
SET LOCAL timezone = 'UTC';
SET LOCAL row_security = off;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
DO $identity$ BEGIN
 IF current_database() IS DISTINCT FROM 'calidad' THEN RAISE EXCEPTION 'DATABASE_MUST_BE_CALIDAD'; END IF;
 IF current_setting('server_version_num')::int/10000<>16 THEN RAISE EXCEPTION 'POSTGRESQL_16_REQUIRED'; END IF;
END; $identity$;
${readOnly?'':`LOCK TABLE ${model.tables.map(t=>'public.'+t.name).join(',')} IN ACCESS EXCLUSIVE MODE;`}
${expressionGuard(model)}`;
}
export function assertCleanupSchema(model,{allowData=[],allowAdvanced=true}={}) {
 return `DO $cleanup_schema$ DECLARE problem text; BEGIN
 WITH RECURSIVE ${checksCTEs(model,{allowData,allowSequenceState:allowAdvanced?advancedTestTables:[]})}
 SELECT string_agg(reason,', ' ORDER BY reason) INTO problem FROM issues;
 IF problem IS NOT NULL THEN RAISE EXCEPTION 'PHASE_A_CLEANUP_SCHEMA_INVALID: %',problem; END IF;
END; $cleanup_schema$;`;
}
export function assertSeedOnly(model) {
 return `${assertCleanupSchema(model,{allowData:Object.keys(testData)})}
DO $seed_only$ DECLARE seed jsonb:=${lit(JSON.stringify(testData))}::jsonb; t text; expected jsonb; actual jsonb; BEGIN
 FOR t,expected IN SELECT e.key,r.value FROM jsonb_each(seed) e,LATERAL jsonb_array_elements(e.value) r LOOP
  EXECUTE format('SELECT to_jsonb(a) FROM ONLY public.%I a WHERE id=$1',t) INTO actual USING (expected->>'id')::int;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'ORIGINAL_SEED_MISSING_OR_CHANGED: %',t; END IF;
 END LOOP;
 FOR t,actual IN ${Object.keys(testData).map(t=>`SELECT ${lit(t)}::text,to_jsonb(a) FROM ONLY public.${t} a`).join('\n UNION ALL ')} LOOP
  IF NOT (seed->t) @> jsonb_build_array(actual) THEN RAISE EXCEPTION 'RUNTIME_ROWS_REMAIN: %',t; END IF;
 END LOOP;
END; $seed_only$;`;
}
export function finalCleanupFiles() {
 const model=baselineModel();
 const reset=`-- GENERATED OFFLINE. Only after runtime AND original seed cleanup.
-- All 20 application tables must be empty; the seven-row system ledger remains.
-- Reject unknown objects/dependencies and advanced sequences outside the seven tested tables.
${cleanupPreamble(model)}
${assertCleanupSchema(model)}
-- Empty tables and exact schema were checked under exclusive locks BEFORE restart.
${model.sequences.filter(s=>advancedTestTables.includes(s.table)).map(s=>`ALTER SEQUENCE public.${s.name} RESTART WITH 1;`).join('\n')}
${assertCleanupSchema(model,{allowAdvanced:false})}
SELECT 'SEQUENCES_BASELINE_RESTAURADAS' AS "CHECK",'SI' AS "ESTADO";
COMMIT;
`;
 const validate=`-- GENERATED OFFLINE. Read-only checkpoint after runtime cleanup, before seed cleanup.
${cleanupPreamble(model,{readOnly:true})}
${assertSeedOnly(model)}
SELECT 'RUNTIME_CRUD_RESTANTES' AS "CHECK",0 AS "RESTANTES",14 AS "SEMILLAS_ORIGINALES";
ROLLBACK;
`;
 const validateEmpty=`-- GENERATED OFFLINE. Read-only checkpoint after BOTH cleanups, before reset.
${cleanupPreamble(model,{readOnly:true})}
${assertCleanupSchema(model)}
SELECT 'TEST_LOCAL_RESTANTES' AS "CHECK",0 AS "RESTANTES",0 AS "APPLICATION_ROWS";
ROLLBACK;
`;
 return new Map([['reset_sequences_after_test_calidad.sql',reset],['validate_runtime_cleanup_calidad.sql',validate],['validate_test_cleanup_calidad.sql',validateEmpty]]);
}
