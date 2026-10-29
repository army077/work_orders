// Authoring only. No SQL execution or HTTP calls. The journal is supplied AFTER
// manual CRUD testing. No manifest generates a disabled SQL; final reviewed IDs
// authorize preparation only, never execution.
import { readFileSync,writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { baselineModel,checksCTEs } from './build_clean_baseline.mjs';
import { expressionGuard } from './semantic_expressions.mjs';
import { testData } from './build_test_seed.mjs';
import { advancedTestTables,finalCleanupFiles,assertSeedOnly } from './phase_a_cleanup_support.mjs';
export const runtimeMarker='TEST_LOCAL_CRUD_20261027_';
export const frontendMarker='TEST_LOCAL_CRUD_FRONT_20261027_';
export const cleanupOrder=['inspection_order_task','inspection_order','work_order_task','work_order','template_task_inspection','template_task','template_section','maintenance_template','machine_model','machine_family'];
export const emptyRuntimeJournal=()=>({reviewed:false,marker:runtimeMarker,ids:Object.fromEntries(cleanupOrder.map(t=>[t,[]]))});
const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
function ownership(row,table,ids,prefix) {
 const marked=v=>typeof v==='string'&&v.startsWith(prefix);
 const owns=(t,id)=>ids[t].includes(id);
 switch(table) {
  case 'machine_family':return marked(row.name);
  case 'machine_model':return marked(row.name)&&owns('machine_family',row.family_id);
  case 'maintenance_template':return marked(row.name)&&owns('machine_model',row.model_id);
  case 'template_section':return marked(row.title)&&owns('maintenance_template',row.template_id);
  case 'template_task':return marked(row.title)&&marked(row.code)&&owns('template_section',row.section_id);
  case 'template_task_inspection':return marked(row.revision_point)&&owns('template_section',row.section_id);
  case 'work_order':return marked(row.machine_serial)&&marked(row.customer_name)&&marked(row.comments)&&(row.template_id===910001||owns('maintenance_template',row.template_id));
  case 'work_order_task':return owns('work_order',row.work_order_id);
  case 'inspection_order':return owns('work_order',row.work_order_id)&&(row.inspection_template_id===910002||owns('maintenance_template',row.inspection_template_id));
  case 'inspection_order_task':return owns('inspection_order',row.inspection_order_id);
  default:return false;
 }
}
export function runtimeCleanupIssues(actual,journal,{afterCleanup=false}={}) {
 const issues=[];
 if(journal.reviewed!==true||journal.marker!==runtimeMarker||!journal.ids)return ['RUNTIME_JOURNAL_REVIEW_REQUIRED'];
 if(Object.keys(journal.ids).some(t=>!cleanupOrder.includes(t)))return ['RUNTIME_JOURNAL_UNKNOWN_TABLE'];
 for(const t of cleanupOrder) {
  const ids=journal.ids[t];
  if(!Array.isArray(ids)||ids.some(id=>!Number.isSafeInteger(id)||id<=0||id>2147483647)||new Set(ids).size!==ids.length)return ['RUNTIME_JOURNAL_INVALID_IDS:'+t];
  if(ids.some(id=>testData[t]?.some(r=>r.id===id)))issues.push('ORIGINAL_SEED_ID_FORBIDDEN:'+t);
  for(const id of ids) {
   const prefix=journal.origins?.[t]?.[id]??runtimeMarker;
   if(![runtimeMarker,frontendMarker].includes(prefix))issues.push('RUNTIME_MARKER_UNAPPROVED:'+t+':'+id);
   if(!afterCleanup&&!(actual[t]??[]).some(r=>r.id===id))issues.push('RUNTIME_REGISTERED_ROW_MISSING:'+t+':'+id);
  }
 }
 if(!cleanupOrder.some(t=>journal.ids[t].length))issues.push('RUNTIME_JOURNAL_EMPTY');
 for(const [t,rows] of Object.entries(testData))for(const seed of rows) {
  const row=(actual[t]??[]).find(r=>r.id===seed.id);
  if(!row||!isDeepStrictEqual(row,seed))issues.push('ORIGINAL_SEED_MISSING_OR_CHANGED:'+t+':'+seed.id);
 }
 for(const [t,rows] of Object.entries(actual)) {
  if(t==='logistica_schema_migrations')continue;
  for(const r of rows) {
   const seed=testData[t]?.find(e=>e.id===r.id);
   if(seed)continue;
   if(!cleanupOrder.includes(t)||!journal.ids[t].includes(r.id))issues.push('UNREGISTERED_DATA:'+t+':'+r.id);
   else if(afterCleanup||!ownership(r,t,journal.ids,journal.origins?.[t]?.[r.id]??runtimeMarker))issues.push('RUNTIME_OWNERSHIP_MISMATCH:'+t+':'+r.id);
  }
 }
 // Logical relationships are not all backed by FK constraints in this schema.
 const has=(t,id)=>(actual[t]??[]).some(r=>r.id===id);
 for(const row of actual.work_order_task??[])if(!has('work_order',row.work_order_id))issues.push('ORPHAN_WORK_ORDER_TASK');
 for(const row of actual.inspection_order??[])if(!has('work_order',row.work_order_id))issues.push('ORPHAN_INSPECTION_ORDER');
 for(const row of actual.inspection_order_task??[])if(!has('inspection_order',row.inspection_order_id)||!has('template_task_inspection',row.template_task_inspection_id))issues.push('ORPHAN_INSPECTION_TASK');
 return issues;
}
export function runtimeCleanupFiles(journal=emptyRuntimeJournal()) {
 const model=baselineModel(),tables=model.tables.map(t=>t.name);
 const ownershipSQL=`CASE crud_table_name
 WHEN 'machine_family' THEN left(row_data->>'name',length(prefix))=prefix
 WHEN 'machine_model' THEN left(row_data->>'name',length(prefix))=prefix AND (manifest->'ids'->'machine_family') @> jsonb_build_array((row_data->>'family_id')::int)
 WHEN 'maintenance_template' THEN left(row_data->>'name',length(prefix))=prefix AND (manifest->'ids'->'machine_model') @> jsonb_build_array((row_data->>'model_id')::int)
 WHEN 'template_section' THEN left(row_data->>'title',length(prefix))=prefix AND (manifest->'ids'->'maintenance_template') @> jsonb_build_array((row_data->>'template_id')::int)
 WHEN 'template_task' THEN left(row_data->>'title',length(prefix))=prefix AND left(row_data->>'code',length(prefix))=prefix AND (manifest->'ids'->'template_section') @> jsonb_build_array((row_data->>'section_id')::int)
 WHEN 'template_task_inspection' THEN left(row_data->>'revision_point',length(prefix))=prefix AND (manifest->'ids'->'template_section') @> jsonb_build_array((row_data->>'section_id')::int)
 WHEN 'work_order' THEN left(row_data->>'machine_serial',length(prefix))=prefix AND left(row_data->>'customer_name',length(prefix))=prefix AND left(row_data->>'comments',length(prefix))=prefix AND ((row_data->>'template_id')::int=910001 OR (manifest->'ids'->'maintenance_template') @> jsonb_build_array((row_data->>'template_id')::int))
 WHEN 'work_order_task' THEN (manifest->'ids'->'work_order') @> jsonb_build_array((row_data->>'work_order_id')::int)
 WHEN 'inspection_order' THEN (manifest->'ids'->'work_order') @> jsonb_build_array((row_data->>'work_order_id')::int) AND ((row_data->>'inspection_template_id')::int=910002 OR (manifest->'ids'->'maintenance_template') @> jsonb_build_array((row_data->>'inspection_template_id')::int))
 WHEN 'inspection_order_task' THEN (manifest->'ids'->'inspection_order') @> jsonb_build_array((row_data->>'inspection_order_id')::int)
 ELSE false END`;
 const allRows=tables.filter(t=>t!=='logistica_schema_migrations').map(t=>`SELECT ${lit(t)}::text AS table_name,to_jsonb(a) AS record FROM ONLY public.${t} a`).join('\n UNION ALL ');
 // The same complete row scan is used before and after deletes; the latter
 // rejects every non-seed row. Sequence restoration is a separate empty-DB step.
 const sql=`-- GENERATED OFFLINE by build_runtime_cleanup.mjs. DO NOT execute before review.
-- Only the original 14 seed rows, the system ledger and journaled CRUD rows may
-- exist. ANY unrelated row aborts the entire transaction before DELETE.
-- No sequence changes here. Reset is separate, only AFTER both cleanups.
-- Generate with --manifest a reviewed local JSON journal. Never infer IDs by LIKE.
BEGIN;
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
LOCK TABLE ${tables.map(t=>'public.'+t).join(',')} IN ACCESS EXCLUSIVE MODE;
${expressionGuard(model)}
DO $runtime_cleanup$
DECLARE
 manifest jsonb:=${lit(JSON.stringify(journal))}::jsonb;
 seed jsonb:=${lit(JSON.stringify(testData))}::jsonb;
 prefix text;
 crud_table_name text; row_data jsonb; expected_row jsonb; id_value jsonb;
 owned_ids int[]; problem text; pass int;
BEGIN
 IF manifest->'reviewed' IS DISTINCT FROM 'true'::jsonb OR manifest->>'marker' IS DISTINCT FROM ${lit(runtimeMarker)} OR jsonb_typeof(manifest->'ids') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'RUNTIME_JOURNAL_REVIEW_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(manifest->'ids') k WHERE NOT (k=ANY(ARRAY[${cleanupOrder.map(lit).join(',')}]))) THEN RAISE EXCEPTION 'RUNTIME_JOURNAL_UNKNOWN_TABLE'; END IF;
 FOREACH crud_table_name IN ARRAY ARRAY[${cleanupOrder.map(lit).join(',')}] LOOP
  IF jsonb_typeof(manifest->'ids'->crud_table_name) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'RUNTIME_JOURNAL_INVALID_IDS: %',crud_table_name; END IF;
  FOR id_value IN SELECT value FROM jsonb_array_elements(manifest->'ids'->crud_table_name) LOOP
   IF jsonb_typeof(id_value)<>'number' OR id_value::text !~ '^[1-9][0-9]*$' THEN RAISE EXCEPTION 'RUNTIME_JOURNAL_INVALID_ID'; END IF;
   IF (id_value::text)::numeric>2147483647 THEN RAISE EXCEPTION 'RUNTIME_JOURNAL_ID_OUT_OF_RANGE'; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(seed->crud_table_name,'[]'::jsonb)) e WHERE e->'id'=id_value) THEN RAISE EXCEPTION 'ORIGINAL_SEED_ID_FORBIDDEN: %',crud_table_name; END IF;
   prefix:=coalesce(manifest->'origins'->crud_table_name->>(id_value::text),${lit(runtimeMarker)});
   IF prefix NOT IN (${lit(runtimeMarker)},${lit(frontendMarker)}) THEN RAISE EXCEPTION 'RUNTIME_MARKER_UNAPPROVED'; END IF;
   EXECUTE format('SELECT to_jsonb(a) FROM ONLY public.%I a WHERE id=$1',crud_table_name) INTO row_data USING (id_value::text)::int;
   IF row_data IS NULL THEN RAISE EXCEPTION 'RUNTIME_REGISTERED_ROW_MISSING: % %',crud_table_name,id_value; END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements(manifest->'ids'->crud_table_name)) THEN RAISE EXCEPTION 'RUNTIME_JOURNAL_DUPLICATE_ID'; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM jsonb_each(manifest->'ids') e WHERE jsonb_array_length(e.value)>0) THEN RAISE EXCEPTION 'RUNTIME_JOURNAL_EMPTY'; END IF;
 WITH RECURSIVE ${checksCTEs(model,{allowData:tables,allowSequenceState:advancedTestTables})}
 SELECT string_agg(reason,', ' ORDER BY reason) INTO problem FROM issues;
 IF problem IS NOT NULL THEN RAISE EXCEPTION 'RUNTIME_SCHEMA_INVALID: %',problem; END IF;
 -- Require all 14 original seed records unchanged before performing any deletion.
 FOR crud_table_name,expected_row IN SELECT e.key,r.value FROM jsonb_each(seed) e,LATERAL jsonb_array_elements(e.value) r LOOP
  EXECUTE format('SELECT to_jsonb(a) FROM ONLY public.%I a WHERE id=$1',crud_table_name) INTO row_data USING (expected_row->>'id')::int;
  IF row_data IS DISTINCT FROM expected_row THEN RAISE EXCEPTION 'ORIGINAL_SEED_MISSING_OR_CHANGED: %',crud_table_name; END IF;
 END LOOP;
 FOR pass IN 1..2 LOOP
  FOR crud_table_name,row_data IN ${allRows} LOOP
   SELECT value INTO expected_row FROM jsonb_array_elements(coalesce(seed->crud_table_name,'[]'::jsonb)) WHERE value->'id'=row_data->'id';
   IF expected_row IS NOT NULL THEN
    IF row_data IS DISTINCT FROM expected_row THEN RAISE EXCEPTION 'ORIGINAL_SEED_CHANGED'; END IF;
    CONTINUE;
   END IF;
   IF pass=2 THEN RAISE EXCEPTION 'RUNTIME_ROWS_REMAIN: %',crud_table_name; END IF;
   IF NOT coalesce((manifest->'ids'->crud_table_name) @> jsonb_build_array((row_data->>'id')::int),false) THEN RAISE EXCEPTION 'UNREGISTERED_DATA: %',crud_table_name; END IF;
   prefix:=coalesce(manifest->'origins'->crud_table_name->>(row_data->>'id'),${lit(runtimeMarker)});
   IF NOT coalesce((${ownershipSQL}),false) THEN RAISE EXCEPTION 'RUNTIME_OWNERSHIP_MISMATCH: %',crud_table_name; END IF;
  END LOOP;
  IF pass=1 THEN
   IF EXISTS(SELECT 1 FROM public.work_order_task t LEFT JOIN public.work_order w ON w.id=t.work_order_id WHERE w.id IS NULL)
    OR EXISTS(SELECT 1 FROM public.inspection_order i LEFT JOIN public.work_order w ON w.id=i.work_order_id WHERE w.id IS NULL)
    OR EXISTS(SELECT 1 FROM public.inspection_order_task i LEFT JOIN public.inspection_order o ON o.id=i.inspection_order_id LEFT JOIN public.template_task_inspection p ON p.id=i.template_task_inspection_id WHERE o.id IS NULL OR p.id IS NULL) THEN RAISE EXCEPTION 'RUNTIME_LOGICAL_ORPHAN'; END IF;
   FOREACH crud_table_name IN ARRAY ARRAY[${cleanupOrder.map(lit).join(',')}] LOOP
    SELECT coalesce(array_agg(value::int),ARRAY[]::int[]) INTO owned_ids FROM jsonb_array_elements_text(manifest->'ids'->crud_table_name);
    EXECUTE format('DELETE FROM public.%I WHERE id=ANY($1)',crud_table_name) USING owned_ids;
   END LOOP;
  END IF;
 END LOOP;
 WITH RECURSIVE ${checksCTEs(model,{allowData:Object.keys(testData),allowSequenceState:advancedTestTables})}
 SELECT string_agg(reason,', ' ORDER BY reason) INTO problem FROM issues;
 IF problem IS NOT NULL THEN RAISE EXCEPTION 'RUNTIME_POST_CLEANUP_INVALID: %',problem; END IF;
END; $runtime_cleanup$;
${assertSeedOnly(model)}
SELECT 'RUNTIME_CRUD_RESTANTES' AS "CHECK",0 AS "RESTANTES",'SEMILLAS_ORIGINALES_14_CONSERVADAS' AS "ESTADO";
COMMIT;
`;
 return new Map([['cleanup_runtime_test_calidad.sql',sql],['runtime_crud_journal.example.json',JSON.stringify(emptyRuntimeJournal(),null,2)+'\n'],...finalCleanupFiles()]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const args=process.argv.slice(2);
 if(args.length!==0&&(args.length!==2||args[0]!=='--manifest'))throw Error('USAGE: node build_runtime_cleanup.mjs [--manifest LOCAL_JOURNAL.json]');
 const journal=args.length?JSON.parse(readFileSync(args[1],'utf8')):emptyRuntimeJournal();
 for(const [name,sql] of runtimeCleanupFiles(journal))writeFileSync(new URL(name,import.meta.url),sql);
}
