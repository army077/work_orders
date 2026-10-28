// Pure JS fixtures and generated SQL review. Never executes SQL or opens sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {baselineModel,checksCTEs,splitSQL} from './build_clean_baseline.mjs';
import {testData,testSeedFiles} from './build_test_seed.mjs';
import {runtimeCleanupIssues,runtimeCleanupFiles,runtimeMarker,frontendMarker} from './build_runtime_cleanup.mjs';
import {advancedTestTables,finalCleanupFiles} from './phase_a_cleanup_support.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const final=JSON.parse(read('runtime_cleanup_manifest.json'));
function actualFinal() {
 const actual=structuredClone(testData);
 for(const id of [1,2]) {
  const p=id===1?runtimeMarker:frontendMarker;
  (actual.machine_family??=[]).push({id,name:p+'FAMILY'});
  (actual.machine_model??=[]).push({id,name:p+'MODEL',family_id:id});
  (actual.maintenance_template??=[]).push({id,name:p+'TEMPLATE',model_id:id});
  (actual.template_section??=[]).push({id,title:p+'SECTION',template_id:id});
  (actual.template_task??=[]).push({id,title:p+'TASK',code:p+'CODE',section_id:id});
 }
 actual.work_order=[1,2,3].map(id=>{const p=id===3?frontendMarker:runtimeMarker;return {id,template_id:id===1?1:910001,machine_serial:p+'SERIAL',customer_name:p+'CUSTOMER',comments:p+'COMMENT'};});
 actual.work_order_task=[1,2,3,4,5,6,7].map(id=>({id,work_order_id:id===1?1:id<=4?2:3}));
 return actual;
}
test('final journal authorizes exactly the confirmed 20 rows and excludes deleted CRUD IDs',()=>{
 assert.deepEqual(final.ids,{
  inspection_order_task:[],inspection_order:[],work_order_task:[1,2,3,4,5,6,7],work_order:[1,2,3],template_task_inspection:[],
  template_task:[1,2],template_section:[1,2],maintenance_template:[1,2],machine_model:[1,2],machine_family:[1,2],
 });
 assert.equal(Object.values(final.ids).flat().length,20);
 assert.equal(final.provenance.sql_execution_authorized,false);
 assert.deepEqual(runtimeCleanupIssues(actualFinal(),final),[]);
});
test('frontend requires its own exact prefix, including order identity fields',()=>{
 const a=actualFinal();a.work_order[2].comments=runtimeMarker+'OTHER';
 assert.ok(runtimeCleanupIssues(a,final).includes('RUNTIME_OWNERSHIP_MISMATCH:work_order:3'));
});
test('unsupported marker cannot widen ownership',()=>{
 const j=structuredClone(final);j.origins.machine_family[2]='TEST_';
 assert.ok(runtimeCleanupIssues(actualFinal(),j).includes('RUNTIME_MARKER_UNAPPROVED:machine_family:2'));
});
test('reappearing deleted ID and unregistered runtime dependencies abort',()=>{
 for(const [t,row] of [['machine_family',{id:3,name:frontendMarker+'DELETED'}],['work_order_customs',{id:1,work_order_id:3}],['machine_customs',{id:1}],['inspection_order',{id:1,work_order_id:3}]]) {
  const a=actualFinal();(a[t]??=[]).push(row);
  assert.ok(runtimeCleanupIssues(a,final).some(i=>i.startsWith('UNREGISTERED_DATA:'+t)));
 }
});
test('missing registered row forces journal review instead of silently accepting a stale list',()=>{
 const a=actualFinal();a.work_order_task.pop();
 assert.ok(runtimeCleanupIssues(a,final).includes('RUNTIME_REGISTERED_ROW_MISSING:work_order_task:7'));
});
test('simulated runtime deletion preserves all 14 seed rows and seed cleanup leaves application tables empty',()=>{
 const a=actualFinal();
 for(const [t,ids] of Object.entries(final.ids))if(a[t])a[t]=a[t].filter(r=>!ids.includes(r.id));
 assert.deepEqual(runtimeCleanupIssues(a,final,{afterCleanup:true}),[]);
 assert.equal(Object.values(a).flat().length,14);
 for(const [t,rows] of Object.entries(testData)) {
  assert.deepEqual(a[t],rows);
  a[t]=a[t].filter(r=>!rows.some(s=>s.id===r.id));
 }
 assert.equal(Object.values(a).flat().length,0);
});
test('separate reset locks all tables, requires exact empty baseline, and restarts only seven known consumed sequences',()=>{
 const model=baselineModel(),sql=finalCleanupFiles().get('reset_sequences_after_test_calidad.sql');
 const top=splitSQL(sql).map(s=>s.replace(/^(?:\s*--[^\n]*(?:\n|$))*/,''));
 assert.equal(top[0],'BEGIN');assert.equal(top.at(-1),'COMMIT');
 assert.match(sql,/DATABASE_MUST_BE_CALIDAD/);assert.match(sql,/POSTGRESQL_16_REQUIRED/);
 assert.match(sql,/LOCK TABLE .* IN ACCESS EXCLUSIVE MODE/);
 assert.ok(sql.indexOf('PHASE_A_CLEANUP_SCHEMA_INVALID')<sql.indexOf('ALTER SEQUENCE'));
 assert.equal((sql.match(/name<>'logistica_schema_migrations' AND rows IS DISTINCT FROM 0/g)??[]).length,2);
 assert.deepEqual([...sql.matchAll(/ALTER SEQUENCE public\.(\w+) RESTART WITH 1;/g)].map(m=>m[1]).sort(),advancedTestTables.map(t=>t+'_id_seq').sort());
 assert.doesNotMatch(sql,/\b(?:DELETE FROM|INSERT INTO|TRUNCATE|setval\s*\()/);
 assert.match(sql.slice(sql.lastIndexOf('ALTER SEQUENCE')),/WHERE last_value::bigint IS DISTINCT FROM 1 OR is_called::boolean IS DISTINCT FROM false/);
 for(const t of model.tables)assert.ok(sql.includes('public.'+t.name));
});
test('empty-table checks stay enabled when only sequence state may differ',()=>{
 const sql=checksCTEs(baselineModel(),{allowSequenceState:advancedTestTables});
 assert.match(sql,/name<>'logistica_schema_migrations' AND rows IS DISTINCT FROM 0/);
 assert.ok(sql.includes("s->>'table' NOT IN ('machine_family','machine_model','maintenance_template','template_section','template_task','work_order','work_order_task')"));
 assert.match(checksCTEs(baselineModel()),/WHERE last_value::bigint IS DISTINCT FROM 1 OR is_called::boolean IS DISTINCT FROM false/);
});
test('seed cleanup enforces seed-only checkpoint before DELETE, then emptiness, without resetting sequences',()=>{
 const sql=testSeedFiles().get('cleanup_seed_calidad_test.sql');
 assert.ok(sql.indexOf('RUNTIME_ROWS_REMAIN')<sql.indexOf('DELETE FROM'));
 assert.ok(sql.indexOf('ORIGINAL_SEED_MISSING_OR_CHANGED')<sql.indexOf('DELETE FROM'));
 assert.ok(sql.lastIndexOf('PHASE_A_CLEANUP_SCHEMA_INVALID')>sql.lastIndexOf('DELETE FROM'));
 assert.doesNotMatch(sql,/ALTER SEQUENCE|\bTRUNCATE\b|\bsetval\s*\(/);
});
test('runtime post-validation is read-only, verifies all original seed content and all other tables empty',()=>{
 const sql=finalCleanupFiles().get('validate_runtime_cleanup_calidad.sql');
 assert.match(sql,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
 assert.match(sql,/RUNTIME_ROWS_REMAIN/);assert.match(sql,/ORIGINAL_SEED_MISSING_OR_CHANGED/);
 assert.doesNotMatch(sql,/\b(?:DELETE FROM|ALTER SEQUENCE|INSERT INTO|TRUNCATE)\b/);
 assert.match(sql,/ROLLBACK;\s*$/);
});
test('all final artifacts reproduce offline and runtime cleanup contains no sequence reset',()=>{
 for(const [name,sql] of finalCleanupFiles())assert.equal(read(name),sql);
 assert.doesNotMatch(runtimeCleanupFiles(final).get('cleanup_runtime_test_calidad.sql'),/ALTER SEQUENCE|\bsetval\s*\(/);
});
test('independent TEST_LOCAL checkpoint requires empty application tables before reset',()=>{
 const sql=finalCleanupFiles().get('validate_test_cleanup_calidad.sql');
 assert.match(sql,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
 assert.match(sql,/name<>'logistica_schema_migrations' AND rows IS DISTINCT FROM 0/);
 assert.match(sql,/'TEST_LOCAL_RESTANTES'/);assert.match(sql,/0 AS "APPLICATION_ROWS"/);
 assert.doesNotMatch(sql,/\b(?:DELETE FROM|ALTER SEQUENCE|INSERT INTO|TRUNCATE)\b/);
 assert.match(sql,/ROLLBACK;\s*$/);
});
