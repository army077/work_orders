// Pure JavaScript fixtures and file review. Never executes SQL or calls API27.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { testData } from './build_test_seed.mjs';
import { splitSQL } from './build_clean_baseline.mjs';
import { runtimeMarker as marker,cleanupOrder,emptyRuntimeJournal,runtimeCleanupIssues,runtimeCleanupFiles } from './build_runtime_cleanup.mjs';
const clone=x=>structuredClone(x);
function fixture() {
 const actual=clone(testData),journal=emptyRuntimeJournal();journal.reviewed=true;
 const add=(t,row)=>{(actual[t]??=[]).push(row);journal.ids[t].push(row.id);};
 add('machine_family',{id:1,name:marker+'FAMILY'});
 add('machine_model',{id:1,name:marker+'MODEL',family_id:1});
 add('maintenance_template',{id:1,name:marker+'TEMPLATE',model_id:1});
 add('template_section',{id:1,title:marker+'SECTION',template_id:1});
 add('template_task',{id:1,title:marker+'TASK',code:marker+'CODE',section_id:1});
 add('work_order',{id:1,template_id:1,machine_serial:marker+'W1',customer_name:marker+'CUSTOMER1',comments:marker+'COMMENT1'});
 add('work_order',{id:2,template_id:910001,machine_serial:marker+'W2',customer_name:marker+'CUSTOMER2',comments:marker+'COMMENT2'});
 for(const [id,work_order_id] of [[1,1],[2,2],[3,2],[4,2]])add('work_order_task',{id,work_order_id,task_title:'Inherited snapshot'});
 add('inspection_order',{id:1,work_order_id:2,inspection_template_id:910002});
 add('inspection_order_task',{id:1,inspection_order_id:1,template_task_inspection_id:910001,revision_point:'Inherited point'});
 return {actual,journal};
}
test('runtime cleanup artifacts reproduce the final reviewed journal; no-manifest generation remains disabled',()=>{
 const final=JSON.parse(readFileSync(new URL('runtime_cleanup_manifest.json',import.meta.url),'utf8'));
 for(const [name,sql] of runtimeCleanupFiles(final))assert.equal(readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n'),sql);
 assert.match(runtimeCleanupFiles().get('cleanup_runtime_test_calidad.sql'),/"reviewed":false/);
 assert.deepEqual(runtimeCleanupIssues(clone(testData),emptyRuntimeJournal()),['RUNTIME_JOURNAL_REVIEW_REQUIRED']);
});
test('registered CRUD graph includes snapshots from seed references and removes only its own rows',()=>{
 const {actual,journal}=fixture();assert.deepEqual(runtimeCleanupIssues(actual,journal),[]);
 const remaining=Object.fromEntries(Object.entries(actual).map(([t,rows])=>[t,rows.filter(r=>!journal.ids[t]?.includes(r.id))]));
 for(const [t,rows] of Object.entries(testData))assert.deepEqual(remaining[t],rows);
 assert.equal(Object.values(remaining).flat().length,14);
 assert.deepEqual(runtimeCleanupIssues(remaining,journal,{afterCleanup:true}),[]);
});
test('IDs already deleted by the sacrificial API DELETE steps do not authorize another row',()=>{
 const {actual,journal}=fixture();journal.ids.machine_family.push(20);
 assert.ok(runtimeCleanupIssues(actual,journal).includes('RUNTIME_REGISTERED_ROW_MISSING:machine_family:20'));
 actual.machine_family.push({id:20,name:'Other family'});
 assert.ok(runtimeCleanupIssues(actual,journal).some(i=>i.startsWith('RUNTIME_OWNERSHIP_MISMATCH')));
});
for(const [name,change] of [
 ['original seed ID',d=>d.journal.ids.machine_family.push(910001)],
 ['original template changed',d=>d.actual.maintenance_template[0].version=2],
 ['original point removed',d=>d.actual.template_task_inspection.pop()],
 ['unregistered productive family',d=>d.actual.machine_family.push({id:30,name:'Other family'})],
 ['unregistered materialized task',d=>d.actual.work_order_task.push({id:30,work_order_id:2})],
 ['unregistered inspection',d=>d.actual.inspection_order.push({id:30,work_order_id:2,inspection_template_id:910002})],
 ['wrong family marker',d=>d.actual.machine_family.at(-1).name='Other'],
 ['wrong order marker',d=>d.actual.work_order[0].comments='Other'],
 ['unowned task parent',d=>d.actual.work_order_task[0].work_order_id=999],
 ['unowned inspection parent',d=>d.actual.inspection_order[0].work_order_id=999],
 ['unowned inspection task parent',d=>d.actual.inspection_order_task[0].inspection_order_id=999],
 ['missing inspection definition',d=>d.actual.inspection_order_task[0].template_task_inspection_id=999],
 ['unrelated production delay',d=>d.actual.prod_delayments=[{id:1,id_actividad:2,comments:'Other'}]],
 ['unrelated deviation',d=>d.actual.desviaciones_calidad=[{id:1,id_actividad:1,comentarios:'Other'}]],
 ['unrelated authorization',d=>d.actual.logistica_authorized_users=[{id:1}]],
 ['duplicate journal IDs',d=>d.journal.ids.work_order.push(1)],
 ['string ID',d=>d.journal.ids.machine_family=['1']],
 ['nonpositive ID',d=>d.journal.ids.machine_family=[0]],
 ['wrong marker',d=>d.journal.marker='Other'],
 ['unknown table',d=>d.journal.ids.plantilla_tecnicos=[910001]],
])test('runtime cleanup rejects '+name,()=>{
 const d=fixture();change(d);assert.ok(runtimeCleanupIssues(d.actual,d.journal).length>0);
});
test('SQL checks all ownership and seed before deleting and never restarts sequences',()=>{
 const sql=runtimeCleanupFiles().get('cleanup_runtime_test_calidad.sql');
 const top=splitSQL(sql).map(q=>q.replace(/^(?:\s*--[^\n]*(?:\n|$))*/,''));
 assert.equal(top[0],'BEGIN');assert.equal(top.at(-1),'COMMIT');
 assert.match(sql,/DATABASE_MUST_BE_CALIDAD/);assert.match(sql,/POSTGRESQL_16_REQUIRED/);
 assert.match(sql,/"reviewed":false/);assert.match(sql,/LOCK TABLE .* IN ACCESS EXCLUSIVE MODE/);
 assert.ok(sql.indexOf('ORIGINAL_SEED_MISSING_OR_CHANGED')<sql.indexOf("EXECUTE format('DELETE"));
 assert.match(sql,/RUNTIME_REGISTERED_ROW_MISSING/);
 assert.match(sql,/DELETE FROM public\.%I WHERE id=ANY\(\$1\)/);
 assert.doesNotMatch(sql,/\bTRUNCATE\b|\bsetval\s*\(|\bLIKE\s*'/);
 assert.doesNotMatch(sql,/ALTER SEQUENCE/);
 assert.ok(cleanupOrder.indexOf('inspection_order_task')<cleanupOrder.indexOf('inspection_order'));
 assert.ok(cleanupOrder.indexOf('inspection_order')<cleanupOrder.indexOf('work_order'));
 assert.ok(cleanupOrder.indexOf('template_task')<cleanupOrder.indexOf('template_section'));
 assert.match(sql,/RUNTIME_POST_CLEANUP_INVALID/);
});
test('plan derives three materialized tasks from actual immutable seed relationships',()=>{
 const t=testData.maintenance_template.find(t=>t.id===910001);
 const sections=testData.template_section.filter(s=>s.template_id===t.id);
 const tasks=sections.flatMap(s=>testData.template_task.filter(t=>t.section_id===s.id).sort((a,b)=>a.position-b.position));
 assert.equal(sections.length,1);assert.equal(tasks.length,3);
 assert.deepEqual(tasks.map(t=>t.code),['TEST_LOCAL_TAREA','LIB001','LIB002']);
 assert.ok(readFileSync(new URL('19_PLAN_CRUD_API27.md',import.meta.url),'utf8').includes('TAREAS_ESPERADAS_AL_CREAR_ORDEN_910001=3'));
});
