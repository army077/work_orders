// Offline only. Synthetic data is authored here; no production export is read.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { baselineModel,checksCTEs } from './build_clean_baseline.mjs';
import { expressionGuard } from './semantic_expressions.mjs';
import { assertSeedOnly,assertCleanupSchema } from './phase_a_cleanup_support.mjs';

export const marker='TEST_LOCAL_CALIDAD_20261027';
const id=910001;
const timestamp='2026-01-01T00:00:00+00:00';
export const testData={
 machine_family:[{id,name:marker+'_FAMILIA'}],
 machine_model:[{id,family_id:id,name:marker+'_MODELO',manufacturer:marker,bond_value:0,standard_days:1}],
 maintenance_template:[
  {id,name:marker+'_ENSAMBLE',template_type:'ENSAMBLE',model_id:id,version:1,is_published:true,created_by:marker,created_at:timestamp,updated_at:timestamp},
  {id:id+1,name:marker+'_INSPECCION',template_type:'INSPECCION',model_id:id,version:1,is_published:true,created_by:marker,created_at:timestamp,updated_at:timestamp},
 ],
 template_section:[
  {id,template_id:id,title:marker+'_SECCION',position:1},
  {id:id+1,template_id:id+1,title:'Inspección de ensamble',position:1},
  {id:id+2,template_id:id+1,title:'Inspección de pintura',position:2},
 ],
 template_task:[
  {id,section_id:id,code:'TEST_LOCAL_TAREA',title:marker+'_TAREA',expected_minutes:1,required:true,position:1,category:'Ensamble'},
  {id:id+1,section_id:id,code:'LIB001',title:marker+'_LIBERACION_ENSAMBLE',expected_minutes:1,required:true,position:2,category:'Ensamble'},
  {id:id+2,section_id:id,code:'LIB002',title:marker+'_LIBERACION_PINTURA',expected_minutes:1,required:true,position:3,category:'Ensamble'},
 ],
 template_task_inspection:[
  {id,section_id:id+1,revision_point:marker+'_PUNTO_ENSAMBLE',specs:marker,suggestions:marker,required:true,position:1,category:'Mecanica'},
  {id:id+1,section_id:id+2,revision_point:marker+'_PUNTO_PINTURA',specs:marker,suggestions:marker,required:true,position:1,category:'Mecanica'},
 ],
 plantilla_tecnicos:[
  {id,estatus:'Activo',sucursal:'TEST_LOCAL',nombre_tecnico:marker+'_OPERADOR',correo_tecnico:'test_local_operador@example.invalid',telefono:null,puesto:'Operador de producción',nombre_bonos:marker,numero_empleado:null},
  {id:id+1,estatus:'Activo',sucursal:'TEST_LOCAL',nombre_tecnico:marker+'_CALIDAD',correo_tecnico:'test_local_calidad@example.invalid',telefono:null,puesto:'Supervisor de calidad',nombre_bonos:marker,numero_empleado:null},
 ],
};
export const testTables=Object.keys(testData);
export const testRowCount=Object.values(testData).reduce((n,r)=>n+r.length,0);
export const testDependencies=[
 ['machine_model','family_id','machine_family'],['maintenance_template','model_id','machine_model'],
 ['template_section','template_id','maintenance_template'],['template_task','section_id','template_section'],['template_task_inspection','section_id','template_section'],
 ['work_order','template_id','maintenance_template'],['work_order','model_id','machine_model'],
 ['inspection_order','inspection_template_id','maintenance_template'],['inspection_order','model_id','machine_model'],
];
const lit=s=>"'"+String(s).replaceAll("'","''")+"'";
const value=v=>v===null?'NULL':typeof v==='string'?lit(v):String(v);
export function testDataIssues(actual,{cleanup=false}={}) {
 const issues=[];
 for(const [table,expected] of Object.entries(testData)) {
  const rows=actual[table]??[];
  if(!cleanup&&rows.length!==expected.length)issues.push('TEST_COUNT:'+table);
  for(const row of rows) {
   const e=expected.find(e=>e.id===row.id);
   if(e&&JSON.stringify(Object.fromEntries(Object.keys(e).map(k=>[k,row[k]])))!==JSON.stringify(e))issues.push('TEST_ROW_CHANGED:'+table+':'+row.id);
   if(!cleanup&&!e)issues.push('TEST_ROW_UNEXPECTED:'+table+':'+row.id);
  }
  if(!cleanup)for(const e of expected)if(!rows.some(r=>r.id===e.id))issues.push('TEST_ROW_MISSING:'+table+':'+e.id);
 }
 return issues;
}
export function cleanupIssues(actual) {
 const issues=testDataIssues(actual);
 for(const [t,rows] of Object.entries(actual))if(t!=='logistica_schema_migrations')for(const row of rows) {
  if(!testData[t]?.some(e=>e.id===row.id))issues.push('RUNTIME_CLEANUP_REQUIRED:'+t+':'+row.id);
 }
 for(const [child,col,parent] of testDependencies)for(const r of actual[child]??[]) {
  if(testData[parent].some(e=>e.id===r[col])&&!testData[child]?.some(e=>e.id===r.id))issues.push('TEST_EXTERNAL_REFERENCE:'+child+'.'+col);
 }
 const emails=testData.plantilla_tecnicos.map(r=>r.correo_tecnico);
 if(['work_order','inspection_order'].some(t=>actual[t]?.some(r=>emails.includes(r.assigned_tech_email))))issues.push('TEST_TECHNICIAN_REFERENCED');
 return issues;
}

function rowCTEs() {
 return `test_manifest AS (SELECT ${lit(JSON.stringify(testData))}::jsonb AS value),
 test_expected AS (SELECT e.key AS name,r.value AS record FROM test_manifest,LATERAL jsonb_each(value) e,LATERAL jsonb_array_elements(e.value) r),
 test_actual AS (${testTables.map(t=>`SELECT ${lit(t)}::text AS name,to_jsonb(a) AS record FROM public.${t} a`).join('\n UNION ALL ')}),
 test_row_issues(reason) AS (
 SELECT 'TEST_COUNT:'||e.key FROM test_manifest,LATERAL jsonb_each(value) e WHERE (SELECT count(*) FROM test_actual a WHERE a.name=e.key)<>jsonb_array_length(e.value)
 UNION ALL SELECT 'TEST_ROW_MISSING_OR_CHANGED:'||e.name||':'||(e.record->>'id') FROM test_expected e WHERE NOT EXISTS(SELECT 1 FROM test_actual a WHERE a.name=e.name AND a.record=e.record)
 UNION ALL SELECT 'TEST_ROW_UNEXPECTED:'||a.name||':'||(a.record->>'id') FROM test_actual a WHERE NOT EXISTS(SELECT 1 FROM test_expected e WHERE e.name=a.name AND e.record=a.record)
)`;
}
const guard=`DO $identity$ BEGIN
 IF current_database() IS DISTINCT FROM 'calidad' THEN RAISE EXCEPTION 'DATABASE_MUST_BE_CALIDAD'; END IF;
 IF current_setting('server_version_num')::int/10000<>16 THEN RAISE EXCEPTION 'POSTGRESQL_16_REQUIRED'; END IF;
END; $identity$;`;
const settings=`SET LOCAL search_path = pg_catalog, public;
SET LOCAL timezone = 'UTC';
SET LOCAL standard_conforming_strings = on;
SET LOCAL row_security = off;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';`;
function assertSchema(model,allowData=[]) {
 return `${expressionGuard(model)}
DO $schema$ DECLARE problem text; BEGIN
 WITH RECURSIVE ${checksCTEs(model,{allowData})}
 SELECT string_agg(reason,', ' ORDER BY reason) INTO problem FROM issues;
 IF problem IS NOT NULL THEN RAISE EXCEPTION 'TEST_SCHEMA_INVALID: %',problem; END IF;
END; $schema$;`;
}
function assertRows() {
 return `DO $test_rows$ DECLARE problem text; BEGIN
 WITH ${rowCTEs()}
 SELECT string_agg(reason,', ' ORDER BY reason) INTO problem FROM test_row_issues;
 IF problem IS NOT NULL THEN RAISE EXCEPTION 'SEED_TEST_INVALID: %',problem; END IF;
END; $test_rows$;`;
}
export function testSeedFiles() {
 const model=baselineModel();
 const header=`-- GENERATED OFFLINE by build_test_seed.mjs. Synthetic fixtures only.
-- Ownership: exact reserved IDs AND complete manifest rows; never a LIKE delete.
-- ${marker}; ${testRowCount} rows; no historical events or Firebase identities.
`;
 const lock=`LOCK TABLE ${model.tables.map(t=>'public.'+t.name).join(',')} IN ACCESS EXCLUSIVE MODE;`;
 const inserts=testTables.map(t=>{
  const cols=Object.keys(testData[t][0]);
  return `INSERT INTO public.${t} (${cols.map(c=>'"'+c+'"').join(',')}) VALUES\n${testData[t].map(r=>'('+cols.map(c=>value(r[c])).join(',')+')').join(',\n')};`;
 }).join('\n');
 const seed=header+`BEGIN;
${settings}
${guard}
${lock}
${assertSchema(model)}
-- Explicit IDs do not consume, restart or rewind any sequence.
${inserts}
${assertRows()}
SELECT 'SEED_TEST_CARGADO' AS "CHECK",'SI' AS "ESTADO",${testRowCount} AS "FILAS";
COMMIT;
`;
 const validate=header+`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
${settings}
${guard}
${assertSchema(model,testTables)}
${assertRows()}
SELECT 'SEED_TEST_VALIDO' AS "CHECK",'SI' AS "ESTADO",${testRowCount} AS "FILAS";
ROLLBACK;
`;
 const externalRefs=testDependencies.map(([child,col,parent])=>`SELECT ${lit('TEST_EXTERNAL_REFERENCE:'+child+'.'+col)} WHERE EXISTS(SELECT 1 FROM public.${child} a WHERE a.${col} IN (${testData[parent].map(r=>r.id).join(',')})${testData[child]?` AND a.id NOT IN (${testData[child].map(r=>r.id).join(',')})`:''})`).join('\n UNION ALL ');
 const deletes=[...testTables].reverse().map(t=>`DELETE FROM public.${t} a USING (SELECT r.value AS record FROM jsonb_each(${lit(JSON.stringify(testData))}::jsonb) e,LATERAL jsonb_array_elements(e.value) r WHERE e.key=${lit(t)}) owned WHERE to_jsonb(a)=owned.record;`).join('\n');
 const remaining=testTables.map(t=>`SELECT count(*) AS n FROM public.${t} WHERE id IN (${testData[t].map(r=>r.id).join(',')})`).join('\n UNION ALL ');
 const cleanup=header+`-- Abort on modified ownership or external references, including logical FKs.
-- API-created events are NOT owned by this seed and are never deleted here.
BEGIN;
${settings}
${guard}
${lock}
${assertSchema(model,model.tables.map(t=>t.name))}
-- This checkpoint requires exactly the original 14 seed rows, with runtime=0.
${assertSeedOnly(model)}
DO $ownership$ DECLARE problem text; BEGIN
 WITH ${rowCTEs()}, cleanup_issues(reason) AS (
 SELECT 'TEST_OWNERSHIP_CHANGED:'||a.name||':'||(a.record->>'id') FROM test_actual a JOIN test_expected e ON a.name=e.name AND a.record->>'id'=e.record->>'id' WHERE a.record<>e.record
 UNION ALL ${externalRefs}
 UNION ALL SELECT 'TEST_TECHNICIAN_REFERENCED' WHERE EXISTS(SELECT 1 FROM public.work_order WHERE assigned_tech_email IN (${testData.plantilla_tecnicos.map(r=>lit(r.correo_tecnico)).join(',')})) OR EXISTS(SELECT 1 FROM public.inspection_order WHERE assigned_tech_email IN (${testData.plantilla_tecnicos.map(r=>lit(r.correo_tecnico)).join(',')}))
 ) SELECT string_agg(reason,', ' ORDER BY reason) INTO problem FROM cleanup_issues;
 IF problem IS NOT NULL THEN RAISE EXCEPTION 'CLEANUP_TEST_ABORTED: %',problem; END IF;
END; $ownership$;
${deletes}
DO $remaining$ DECLARE n bigint; BEGIN
 SELECT sum(x.n) INTO n FROM (${remaining}) x;
 IF n<>0 THEN RAISE EXCEPTION 'TEST_LOCAL_RESTANTES: %',n; END IF;
END; $remaining$;
${assertCleanupSchema(model)}
SELECT 'TEST_LOCAL_RESTANTES' AS "CHECK",0 AS "RESTANTES";
COMMIT;
`;
 return new Map([['seed_calidad_test.sql',seed],['validate_seed_calidad_test.sql',validate],['cleanup_seed_calidad_test.sql',cleanup]]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)for(const [name,sql] of testSeedFiles())writeFileSync(new URL(name,import.meta.url),sql);
