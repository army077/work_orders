// Offline fixtures and file contracts only. No SQL engine or DB access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { baselineModel,splitSQL } from './build_clean_baseline.mjs';
import { testData,testRowCount,testTables,testSeedFiles,testDataIssues,cleanupIssues,testDependencies } from './build_test_seed.mjs';
const copy=()=>JSON.parse(JSON.stringify(testData));
const model=baselineModel(),files=testSeedFiles();
function route(file,respond) {
 const handlers=new Map(),calls=[];
 const router=Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(path,handler)=>handlers.set(method+' '+path,handler)]));
 const client={async query(sql,params=[]) {sql=sql.replace(/\s+/g,' ').trim();calls.push(sql);return {rows:['BEGIN','COMMIT','ROLLBACK'].includes(sql)?[]:respond(sql,params)};},release(){}};
 const module={exports:{}};
 vm.runInNewContext(readFileSync(new URL('../../api10/routes/'+file,import.meta.url),'utf8'),{module,console:{log(){},error(){}},require(name){
  if(name==='express')return {Router:()=>router};
  if(name==='../db')return {connect:async()=>client,query:client.query};
  throw Error('UNEXPECTED_IMPORT:'+name);
 }});
 return {calls,async invoke(method,path,req) {const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};await handlers.get(method+' '+path)(req,res);return res;}};
}
test('three autonomous TEST files reproduce the synthetic source exactly',()=>{
 assert.equal(files.size,3);
 for(const [name,sql] of files)assert.equal(readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n'),sql,name);
 assert.equal(testRowCount,14);
 for(const rows of Object.values(testData))assert.ok(rows.length>=1&&rows.length<=3);
});
test('fixture is complete, typed, synthetic and independent of the approved production export',()=>{
 assert.deepEqual(testDataIssues(copy()),[]);
 for(const [name,rows] of Object.entries(testData)) {
  const columns=model.tables.find(t=>t.name===name).columns;
  for(const r of rows) {
   assert.deepEqual(Object.keys(r).sort(),columns.map(c=>c.name).sort(),name);
   for(const c of columns)if(c.not_null)assert.notEqual(r[c.name],null,name+'.'+c.name);
  }
 }
 const source=readFileSync(new URL('build_test_seed.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/seed_source|loadApprovedSource|sources\/export_config|firebase_uid/);
 for(const r of testData.plantilla_tecnicos)assert.ok(r.correo_tecnico.endsWith('@example.invalid'));
 assert.deepEqual(testTables,['machine_family','machine_model','maintenance_template','template_section','template_task','template_task_inspection','plantilla_tecnicos']);
});
test('family/model/assembly and both inspection/release paths form complete runtime graphs',()=>{
 for(const [child,col,parent] of testDependencies.filter(([child])=>testTables.includes(child)))for(const r of testData[child])assert.ok(testData[parent].some(p=>p.id===r[col]));
 const assembly=testData.maintenance_template.find(t=>t.template_type==='ENSAMBLE');
 const inspection=testData.maintenance_template.find(t=>t.template_type==='INSPECCION');
 assert.equal(assembly.model_id,inspection.model_id);assert.ok(inspection.is_published);
 for(const [title,code] of [['Inspección de ensamble','LIB001'],['Inspección de pintura','LIB002']]) {
  const section=testData.template_section.find(s=>s.template_id===inspection.id&&s.title===title);assert.ok(section);
  assert.ok(testData.template_task_inspection.some(p=>p.section_id===section.id));
  assert.ok(testData.template_task.some(t=>t.code===code));
  const runtime=readFileSync(new URL('../../api10/routes/quality.js',import.meta.url),'utf8');
  assert.ok(runtime.includes('"'+title+'": "'+code+'"'));
 }
});
test('real API10 order handler materializes the three TEST activities',async()=>{
 const snapshots=[];
 const r=route('workOrders.js',(sql,p)=>{
  if(sql.startsWith('SELECT * FROM maintenance_template'))return testData.maintenance_template.filter(t=>t.id===p[0]);
  if(sql.startsWith('INSERT INTO work_order ('))return [{id:1,template_id:910001,model_id:910001}];
  if(sql.startsWith('SELECT * FROM template_section'))return testData.template_section.filter(s=>s.template_id===p[0]);
  if(sql.startsWith('SELECT * FROM template_task'))return testData.template_task.filter(t=>t.section_id===p[0]);
  if(sql.startsWith('INSERT INTO work_order_task')){snapshots.push(p);return [];}
  assert.fail('Unexpected query: '+sql);
 });
 const res=await r.invoke('post','/from-template',{body:{template_id:910001}});
 assert.equal(res.code,201);assert.equal(snapshots.length,3);
 assert.deepEqual(snapshots.map(p=>p[3]),['TEST_LOCAL_TAREA','LIB001','LIB002']);assert.ok(r.calls.includes('COMMIT'));
});
for(const [type,code] of [['Inspección de ensamble','LIB001'],['Inspección de pintura','LIB002']]) {
 test('real API10 inspection request materializes TEST points: '+type,async()=>{
  const snapshots=[];
  const r=route('quality.js',(sql,p)=>{
   if(sql.startsWith('SELECT * FROM work_order WHERE'))return [{id:1,model_id:910001}];
   if(sql.startsWith('SELECT * FROM inspection_order WHERE'))return [];
   if(sql.startsWith('SELECT mt.*'))return testData.maintenance_template.filter(t=>t.model_id===p[0]&&t.template_type==='INSPECCION'&&t.is_published&&testData.template_section.some(s=>s.template_id===t.id&&s.title===p[1]));
   if(sql.startsWith('INSERT INTO inspection_order ('))return [{id:1,work_order_id:1,inspection_type:type}];
   if(sql.startsWith('SELECT * FROM template_section'))return testData.template_section.filter(s=>s.template_id===p[0]&&s.title===p[1]);
   if(sql.startsWith('SELECT * FROM template_task_inspection'))return testData.template_task_inspection.filter(t=>t.section_id===p[0]);
   if(sql.startsWith('INSERT INTO inspection_order_task')){snapshots.push(p);return [];}
   assert.fail('Unexpected query: '+sql);
  });
  const res=await r.invoke('post','/inspection/request',{body:{work_order_id:1,estacion:1,inspection_type:type}});
  assert.equal(res.code,201);assert.equal(snapshots.length,1);assert.equal(snapshots[0][6],type);assert.ok(r.calls.includes('COMMIT'));
 });
 test('real API10 release finds the TEST release code: '+code,async()=>{
  const r=route('quality.js',(sql,p)=>{
   if(sql.startsWith('SELECT work_order_id, inspection_type FROM inspection_order'))return [{work_order_id:1,inspection_type:type}];
   if(sql.startsWith('SELECT status FROM inspection_order_task'))return [{status:'DONE'}];
   if(sql.startsWith('UPDATE work_order_task')){assert.equal(p[4],code);return testData.template_task.filter(t=>t.code===p[4]);}
   assert.fail('Unexpected query: '+sql);
  });
  const res=await r.invoke('put','/liberar_orden/:id',{params:{id:'1'},body:{inspection_order_id:1,section_title:type}});
  assert.equal(res.code,200);assert.equal(res.body.task.code,code);assert.ok(r.calls.includes('COMMIT'));
 });
}
for(const [label,mutate] of [
 ['missing point',d=>d.template_task_inspection.pop()],
 ['orphan section',d=>d.template_section[0].template_id=999],
 ['wrong release code',d=>d.template_task[1].code='OTHER'],
 ['unpublished inspection',d=>d.maintenance_template[1].is_published=false],
 ['unexpected productive row',d=>d.machine_family.push({id:2,name:'Other'})],
 ['reserved ID collision',d=>d.machine_family[0].name='Other'],
])test('TEST validation rejects '+label,()=>{const d=copy();mutate(d);assert.ok(testDataIssues(d).length);});

test('cleanup preserves unrelated records, rejects changed ownership and is rerunnable',()=>{
 const d=copy();d.machine_family.push({id:5,name:'Unrelated'});
 assert.deepEqual(cleanupIssues(d),[]);
 const cleaned=Object.fromEntries(Object.entries(d).map(([t,rows])=>[t,rows.filter(r=>!testData[t].some(e=>e.id===r.id))]));
 assert.deepEqual(cleaned.machine_family,[{id:5,name:'Unrelated'}]);
 assert.deepEqual(cleanupIssues(cleaned),[]);
 d.machine_family[0].name='Changed';assert.ok(cleanupIssues(d).some(i=>i.startsWith('TEST_ROW_CHANGED')));
});
for(const [child,col,parent] of testDependencies)test('cleanup aborts for external reference '+child+'.'+col,()=>{
 const d=copy();(d[child]??=[]).push({id:17,[col]:testData[parent][0].id});
 assert.ok(cleanupIssues(d).includes('TEST_EXTERNAL_REFERENCE:'+child+'.'+col));
});
test('cleanup protects logical technician references as well as declared FKs',()=>{
 const d=copy();d.work_order=[{id:1,assigned_tech_email:testData.plantilla_tecnicos[0].correo_tecnico}];
 assert.ok(cleanupIssues(d).includes('TEST_TECHNICIAN_REFERENCED'));
});
test('seed guards empty baseline, validator is read-only, cleanup targets full owned rows only',()=>{
 const seed=files.get('seed_calidad_test.sql'),validation=files.get('validate_seed_calidad_test.sql'),cleanup=files.get('cleanup_seed_calidad_test.sql');
 assert.match(seed,/SEED_TEST_CARGADO/);assert.match(validation,/SEED_TEST_VALIDO/);assert.match(validation,/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
 for(const sql of files.values()) {
  assert.match(sql,/DATABASE_MUST_BE_CALIDAD/);assert.match(sql,/POSTGRESQL_16_REQUIRED/);
  assert.doesNotMatch(sql,/\b(?:TRUNCATE|setval|nextval)\s*\(|ALTER SEQUENCE|INSERT INTO public\.(?:work_order|inspection_order|logistica_|entregas_)/);
 }
 const queries=splitSQL(validation).map(s=>s.replace(/^(?:\s*--[^\n]*(?:\n|$))*/,''));
 assert.ok(queries.every(s=>/^(BEGIN|SET LOCAL|DO \$|SELECT|ROLLBACK)/.test(s)));
 assert.ok(!queries.some(s=>/^(INSERT|DELETE|UPDATE|ALTER|CREATE|COMMIT)\b/.test(s)));
 const deletes=splitSQL(cleanup).filter(s=>s.startsWith('DELETE FROM'));
 assert.equal(deletes.length,7);
 for(const d of deletes)assert.match(d,/WHERE to_jsonb\(a\)=owned.record$/);
 assert.match(cleanup,/RAISE EXCEPTION 'CLEANUP_TEST_ABORTED/);assert.match(cleanup,/TEST_LOCAL_RESTANTES/);
 assert.ok(cleanup.indexOf('CLEANUP_TEST_ABORTED')<cleanup.indexOf('DELETE FROM'));
 assert.ok(cleanup.indexOf('DELETE FROM public.template_task ')<cleanup.indexOf('DELETE FROM public.template_section '));
 assert.ok(cleanup.indexOf('DELETE FROM public.template_section ')<cleanup.indexOf('DELETE FROM public.maintenance_template '));
});
