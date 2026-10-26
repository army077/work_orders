// Real JavaScript handlers, with query responses supplied by mocks only.
// No SQL engine, database driver, socket or SQL execution is used here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { loadApprovedSource,functionalFindings,sha256 } from './seed_source.mjs';
import { inheritedWarningReasons } from './render_seed.mjs';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const source=loadApprovedSource(),data=source.tables,findings=functionalFindings(data);
const validation=read('validate_seed_calidad.sql');

function loadRoute(file,query) {
 const handlers=new Map(),calls=[];
 const router=Object.fromEntries(['get','post','put','patch','delete'].map(method=>[method,(path,handler)=>handlers.set(method+' '+path,handler)]));
 const client={
  async query(sql,params=[]) {
   sql=sql.replace(/\s+/g,' ').trim();calls.push({sql,params});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
   return {rows:query(sql,params)};
  },
  release() {calls.push({sql:'RELEASE'});},
 };
 const module={exports:{}};
 vm.runInNewContext(read('../../api10/'+file),{
  module,console:{log(){},error(){}},require(name) {
   if(name==='express')return {Router:()=>router};
   if(name==='../db')return {connect:async()=>client,query:client.query};
   throw new Error('UNEXPECTED_IMPORT:'+name);
  },
 },{filename:file});
 return {
  calls,
  async invoke(method,path,req) {
   const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
   const handler=handlers.get(method+' '+path);assert.ok(handler,path);
   await handler(req,res);return res;
  },
 };
}

for(const template of data.maintenance_template.filter(t=>t.template_type!=='INSPECCION')) {
 test(`actual order handler materializes approved template ${template.id} without inspection/release prerequisites`,async()=>{
  const snapshots=[];
  const route=loadRoute('routes/workOrders.js',(sql,params)=>{
   if(sql==='SELECT * FROM maintenance_template WHERE id = $1')return [template];
   if(sql.startsWith('INSERT INTO work_order ('))return [{id:1,template_id:template.id,model_id:template.model_id}];
   if(sql.startsWith('SELECT * FROM template_section'))return data.template_section.filter(s=>s.template_id===params[0]).sort((a,b)=>a.position-b.position);
   if(sql.startsWith('SELECT * FROM template_task'))return data.template_task.filter(t=>t.section_id===params[0]).sort((a,b)=>a.position-b.position);
   if(sql.startsWith('INSERT INTO work_order_task')){snapshots.push(params);return [];}
   assert.fail('Unexpected query in order creation: '+sql);
  });
  const res=await route.invoke('post','/from-template',{body:{template_id:template.id}});
  assert.equal(res.code,201);assert.equal(res.body.template_id,template.id);
  const expected=data.template_section.filter(s=>s.template_id===template.id).sort((a,b)=>a.position-b.position)
   .flatMap(s=>data.template_task.filter(t=>t.section_id===s.id).sort((a,b)=>a.position-b.position)
    .map(t=>[1,s.title,t.title,t.code,t.expected_minutes,t.category]));
  assert.deepEqual(snapshots.map(p=>[...p.slice(0,5),p[6]]),expected);
  assert.deepEqual(snapshots.map(p=>p[5]),expected.map((_,i)=>i+1));
  assert.ok(route.calls.some(c=>c.sql==='COMMIT'));
  assert.ok(!route.calls.some(c=>c.sql==='ROLLBACK'||/inspection|LIB00/.test(c.sql)));
 });
}

for(const {template_id,model_id} of findings.assembly_without_inspection) {
 test(`actual inspection request for assembly ${template_id} returns scoped 404 and rolls back`,async()=>{
  const route=loadRoute('routes/quality.js',(sql,params)=>{
   if(sql.startsWith('SELECT * FROM work_order'))return [{id:1,model_id}];
   if(sql.startsWith('SELECT * FROM inspection_order'))return [];
   if(sql.startsWith('SELECT mt.*')) {
    assert.match(sql,/mt\.model_id = \$1/);assert.match(sql,/mt\.is_published = TRUE/);
    assert.match(sql,/ts\.title = \$2/);
    return data.maintenance_template.filter(t=>t.model_id===params[0]&&t.template_type==='INSPECCION'&&t.is_published
     &&data.template_section.some(s=>s.template_id===t.id&&s.title===params[1]));
   }
   assert.fail('Unexpected query before missing inspection rejection: '+sql);
  });
  const res=await route.invoke('post','/inspection/request',{body:{work_order_id:1,inspection_type:'Inspección de ensamble'}});
  assert.equal(res.code,404);assert.match(res.body.error,/INSPECCION publicada/);
  assert.ok(route.calls.some(c=>c.sql==='ROLLBACK'));
  assert.ok(!route.calls.some(c=>/^(?:INSERT|UPDATE)/.test(c.sql)));
 });
}

for(const {section_id,template_id} of findings.empty_sections) {
 test(`approved empty section ${section_id} contributes no activities on template ${template_id}`,()=>{
  assert.equal(data.template_task.filter(t=>t.section_id===section_id).length,0);
  const siblings=data.template_section.filter(s=>s.template_id===template_id);
  const count=data.template_task.filter(t=>siblings.some(s=>s.id===t.section_id)).length;
  if([61,69].includes(template_id))assert.equal(count,0);
  else assert.ok(count>0);
  assert.notEqual(data.maintenance_template.find(t=>t.id===template_id).template_type,'INSPECCION');
 });
}

for(const template_id of [61,69])test(`empty checklist on template ${template_id} lists successfully but has no tasks to restart`,async()=>{
 const route=loadRoute('routes/workOrders.js',(sql)=>{
  if(sql.startsWith('SELECT * FROM work_order_task')||sql.startsWith('UPDATE work_order_task'))return [];
  assert.fail('Unexpected empty checklist query: '+sql);
 });
 const list=await route.invoke('get','/:id/tasks',{params:{id:'1'}});
 assert.equal(list.code,200);assert.equal(list.body.length,0);
 const restart=await route.invoke('put','/:id/restart_stavance',{params:{id:'1'}});
 assert.equal(restart.code,404);
});

// A mock completed inspection isolates the later release-code prerequisite.
// It is not added to the approved graph: all nine currently fail request first.
for(const {template_id,missing} of findings.assembly_missing_release_codes)for(const code of missing) {
 const type=code==='LIB001'?'Inspección de ensamble':'Inspección de pintura';
 for(const [path,expected] of [['/liberar_orden/:id',404],['/:id/insp_end',409]]) {
  test(`actual ${path} rejects missing ${code} for template ${template_id} only`,async()=>{
   const route=loadRoute('routes/quality.js',(sql,params)=>{
    if(sql.startsWith('SELECT work_order_id, inspection_type FROM inspection_order'))return [{work_order_id:1,inspection_type:type}];
    if(sql.startsWith('SELECT status FROM inspection_order_task'))return [{status:'DONE'}];
    if(sql.startsWith('UPDATE work_order_task')){assert.equal(params[4],code);return [];}
    if(sql.startsWith('SELECT status FROM work_order_task')){assert.equal(params[1],code);return [];}
    assert.fail('Unexpected release query: '+sql);
   });
   const res=await route.invoke('put',path,{params:{id:'1'},body:{inspection_order_id:1,section_title:type}});
   assert.equal(res.code,expected);assert.ok(route.calls.some(c=>c.sql==='ROLLBACK'));
   assert.ok(!route.calls.some(c=>c.sql==='COMMIT'));
  });
 }
}

test('actual activity progress and production completion have no inspection/release gate',async()=>{
 const route=loadRoute('routes/workOrders.js',(sql,params)=>{
  if(sql.startsWith('UPDATE work_order_task'))return [{id:params[4],status:params[0]}];
  if(sql.startsWith('UPDATE work_order SET'))return [{id:params[0],status:'FINISHED'}];
  assert.fail('Unexpected activity/production prerequisite: '+sql);
 });
 const progress=await route.invoke('put','/:id/stavance',{params:{id:'1'},body:{status:'DONE'}});
 assert.equal(progress.code,200);assert.equal(progress.body.task.status,'DONE');
 const finish=await route.invoke('put','/:id/prod_end',{params:{id:'1'}});
 assert.equal(finish.code,200);assert.equal(finish.body.task.status,'FINISHED');
});

test('real Logistics authorization rejects an unregistered identity before allowing the flow',async()=>{
 const calls=[],module={exports:{}};
 let registered=false;
 vm.runInNewContext(read('../../api10/auth/requireLogisticaAuthorizedUser.js'),{
  module,console,require(name){
   assert.equal(name,'../db');return {async query(sql,params){
    assert.match(sql,/public\.logistica_authorized_users/);assert.match(sql,/is_active = true/);
    calls.push(params);return {rows:registered?[{id:1,firebase_uid:params[1]}]:[]};
   }};
  },
 });
 const req={auth:{firebaseProject:'logistica-ar',uid:'synthetic-test-only'}};
 const res={status(code){this.code=code;return this;},json(){return this;}};
 let nextCalls=0;
 await module.exports.requireLogisticaAuthorizedUser(req,res,()=>nextCalls++);
 assert.equal(res.code,403);assert.equal(nextCalls,0);
 registered=true;
 await module.exports.requireLogisticaAuthorizedUser(req,res,()=>nextCalls++);
 assert.equal(nextCalls,1);assert.equal(calls.length,2);
});

test('validator classifies only the audited three conditions as inherited nonblocking warnings',()=>{
 assert.deepEqual(inheritedWarningReasons,['ASSEMBLY_INSPECTION_CONFIG_MISSING','SECTION_WITHOUT_TASKS','ASSEMBLY_RELEASE_CODE_MISSING']);
 const gate=validation.slice(validation.indexOf('blocking_issues(reason) AS ('),validation.indexOf('), authorization AS ('));
 assert.match(gate,/SELECT reason FROM seed_issues/);
 assert.match(gate,/UNION ALL SELECT reason FROM functional_issues WHERE reason NOT IN/);
 assert.deepEqual([...gate.matchAll(/'([^']+)'/g)].map(m=>m[1]),inheritedWarningReasons);
 for(const reason of inheritedWarningReasons)assert.ok(validation.includes("('"+reason+"','"));
 assert.match(validation,/'ADVERTENCIA_HEREDADA','WARNING'/);
 assert.match(validation,/'INCIDENCIA_DATOS','ERROR'/);
 assert.match(validation,/'LIMITACION_FUNCIONAL','ERROR'/);
 for(const check of ['CALIDAD_SEED_OPERATIVO_VALIDO','BASELINE_APTO_PARA_DEPLOY']) {
  assert.ok(validation.includes("'"+check+"',CASE WHEN EXISTS(SELECT 1 FROM blocking_issues) THEN 'NO' ELSE 'SI' END"));
 }
});

test('validator keeps corruption, row drift, schema, events and sequence failures blocking',()=>{
 const integrity=validation.slice(validation.indexOf('seed_issues(reason) AS ('),validation.indexOf('inherited_warning_policy(reason,'));
 assert.match(integrity,/SELECT reason FROM schema_issues UNION ALL SELECT reason FROM master_data_issues/);
 assert.match(integrity,/SELECT reason FROM configuration_issues WHERE reason NOT IN/);
 for(const reason of ['MODEL_FAMILY_ORPHAN','TEMPLATE_MODEL_ORPHAN','SECTION_TEMPLATE_ORPHAN','TASK_SECTION_ORPHAN','INSPECTION_POINT_SECTION_ORPHAN','MASTER_COUNT:','MASTER_ROW_MISSING_OR_CHANGED:','MASTER_ROW_UNAPPROVED:','MASTER_SEQUENCE_STATE:','TEST_MARKER:','BASE_COLUMN_DRIFT','TABLE_NOT_EMPTY_OR_UNSUPPORTED']) {
  assert.ok(validation.includes(reason),reason);assert.ok(!inheritedWarningReasons.includes(reason));
 }
 assert.match(validation,/'LOGISTICA_AUTH_PENDIENTE',CASE WHEN pending THEN 'SI' ELSE 'NO' END/);
 assert.match(validation,/'scope','LOGISTICA'/);
});

test('audit preserves the exact seed, create SQL and production export bytes',()=>{
 for(const [name,hash] of [
  ['seed_calidad_operativo.sql','e2e8ff8c05ba485ad56ab889c095485efac15df612b32e862f4c1d18d6b04da8'],
  ['create_calidad.sql','efd14fd52b4b16b58fd0b5aa993de83e9c0a714e7f8e366181eb6f1a0b16265e'],
  ['sources/export_config_prod_20261023.json','47f5dddeb498f7b50ee61c7148f10bfa7635aaf773b12495134ffe8147349bd0'],
 ])assert.equal(sha256(readFileSync(new URL(name,import.meta.url))),hash,name);
 assert.equal(source.total,1139);
});
