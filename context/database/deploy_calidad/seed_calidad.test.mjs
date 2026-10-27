import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { baselineModel,cleanFiles,splitSQL,checksCTEs } from './build_clean_baseline.mjs';
import { masters,seedFiles,configurationChecks } from './build_seed_support.mjs';
import { fixtureOptions } from './preflight_fixture.mjs';
import { masters as approvedMasters,loadApprovedSource } from './seed_source.mjs';

let DatabaseSync;
try { ({DatabaseSync}=await import('node:sqlite')); }
catch(error) { if(error.code!=='ERR_UNKNOWN_BUILTIN_MODULE')throw error; }
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const model=baselineModel(),generated=seedFiles();
const seed=read('seed_calidad_operativo.sql'),validation=read('validate_seed_calidad.sql'),exportSQL=read('export_seed_config_artecnologia.sql');
const top=sql=>splitSQL(sql).map(s=>s.replace(/^(?:\s*--[^\n]*(?:\n|$))*/,'').trim());
const lit=value=>value==null?'NULL':typeof value==='boolean'?String(Number(value)):typeof value==='number'?String(value):"'"+value.replaceAll("'","''")+"'";
function fixture() {
 // Deliberately synthetic data lives only in this offline test, never in seed.
 return {
  machine_family:[{id:1,name:'Family'}],
  machine_model:[{id:2,family_id:1,name:'Model'}],
  maintenance_template:[{id:10,name:'Assembly',model_id:2,template_type:'ENSAMBLE',is_published:true},{id:11,name:'Inspection',model_id:2,template_type:'INSPECCION',is_published:true}],
  template_section:[{id:20,template_id:10,title:'Assembly',position:1},{id:21,template_id:11,title:'Inspección de ensamble',position:1},{id:22,template_id:11,title:'Inspección de pintura',position:2}],
  template_task:[{id:30,section_id:20,title:'Release assembly',code:'LIB001',position:1,expected_minutes:0},{id:31,section_id:20,title:'Release paint',code:'LIB002',position:2,expected_minutes:0}],
  template_task_inspection:[{id:40,section_id:21,revision_point:'Point A',position:1},{id:41,section_id:22,revision_point:'Point B',position:1}],
  plantilla_tecnicos:[{id:50,estatus:'synthetic-status',sucursal:'synthetic-branch',correo_tecnico:'synthetic@example.invalid',nombre_bonos:'Synthetic',puesto:'Operador de producción'}],
  logistica_authorized_users:[],
 };
}
function evaluate(data,query) {
 const db=new DatabaseSync(':memory:');
 try {
  const ctes=model.tables.map(t=>{
   const rows=data[t.name]??[];
   return t.name+'('+t.columns.map(c=>c.name).join(',')+') AS ('+(rows.length
    ?'VALUES '+rows.map(r=>'('+t.columns.map(c=>lit(r[c.name])).join(',')+')').join(',')
    :'SELECT '+t.columns.map(()=>'NULL').join(',')+' WHERE false')+')';
  });
  ctes.push('counts(name,rows) AS (VALUES '+model.tables.map(t=>'('+lit(t.name)+','+(data[t.name]?.length??0)+')').join(',')+')');
  if(data.sequence_state)ctes.push('sequence_state(s,last_value,is_called) AS (VALUES '+data.sequence_state.map(s=>'('+[JSON.stringify(s.s),s.last_value,s.is_called].map(lit).join(',')+')').join(',')+')');
  db.function('btrim',v=>v==null?null:v.trim());
  const allRows=Object.values(data).flat();
  db.function('row_marker',id=>JSON.stringify(allRows.find(r=>r.id===id)));
  db.function('regexp',(pattern,value)=>Number(new RegExp(pattern.replaceAll('[:alnum:]','a-zA-Z0-9'),'i').test(value)));
  query=query.replaceAll('public.','').replace(/::(?:bigint|boolean)\b/g,'').replace(/to_jsonb\((\w+)\)::text/g,'row_marker($1.id)')
   .replace(/(row_marker\([^)]+\)) !~\* ('[^']+')/g,'NOT regexp($2,$1)')
   .replace(/(row_marker\([^)]+\)) ~\* ('[^']+')/g,'regexp($2,$1)');
  return db.prepare('WITH '+ctes.join(',')+', '+query).all();
 } finally {db.close();}
}
const issues=data=>evaluate(data,configurationChecks+' SELECT reason FROM configuration_issues').map(r=>r.reason);

test('seed/export/validator reproduce their offline generator without altering the baseline',()=>{
 for(const [name,sql] of generated)assert.equal(read(name),sql,name);
 for(const [name,sql] of cleanFiles())assert.equal(read(name),sql,name);
 assert.equal(generated.size,4);
});
test('approved seed has a guarded transaction, seven master inserts and transactional sequence restarts',()=>{
 const queries=top(seed);
 assert.equal(queries[0],'BEGIN');assert.equal(queries.at(-1),'COMMIT');
 assert.match(seed,/current_database\(\) IS DISTINCT FROM 'calidad'/);
 assert.match(seed,/SEED_BASELINE_INCOMPATIBLE/);assert.match(seed,/SEED_DATA_INVALID/);
 assert.ok(!seed.includes("RAISE EXCEPTION 'PENDIENTE_EXPORT_CONFIG_PROD'"));
 assert.deepEqual(queries.filter(s=>s.startsWith('INSERT INTO')).map(s=>s.match(/^INSERT INTO public\.(\w+)/)[1]),approvedMasters);
 assert.equal(queries.filter(s=>s.startsWith('ALTER SEQUENCE')).length,7);
 assert.ok(queries.every(s=>! /^(?:UPDATE|DELETE|DROP|TRUNCATE|CREATE|COPY|MERGE)\b/.test(s)));
 assert.ok(queries.filter(s=>/^ALTER\b/.test(s)).every(s=>/^ALTER SEQUENCE public\.\w+_id_seq RESTART WITH \d+$/.test(s)));
 assert.ok(queries.findIndex(s=>s.startsWith('ALTER SEQUENCE'))>queries.findLastIndex(s=>s.startsWith('INSERT INTO')));
 assert.doesNotMatch(seed,/SELECT\s+(?:setval|nextval)\s*\(/i);
 assert.match(queries.at(-2),/^SELECT 'CALIDAD_SEED_CARGADO'/);
 assert.match(seed,/ALTA_MANUAL_REQUERIDA/);
});
for(const [name,sql,database] of [['export',exportSQL,'artecnologia'],['validation',validation,'calidad']]) {
 test(`${name} is READ ONLY, guarded, rollback-only and free of execution/network writes`,()=>{
  const queries=top(sql);
  assert.equal(queries[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(queries.at(-1),'ROLLBACK');
  assert.ok(queries.every(s=>/^(BEGIN\b|DO \$(?:identity|semantic_expressions)\$|SET LOCAL\b|WITH\b|ROLLBACK\b)/.test(s)));
  if(name==='export') {
   assert.match(sql,/ec\.database_name = 'artecnologia'/);
   assert.match(sql,/ec\.major_version = 16/);assert.match(sql,/ec\.read_only_mode = 'on'/);
  } else assert.match(sql,new RegExp("current_database\\(\\) IS DISTINCT FROM '"+database+"'"));
  assert.doesNotMatch(sql,/\b(?:EXECUTE|dblink|postgres_fdw|pg_advisory_xact_lock|setval|pg_export_snapshot)\s*\(/i);
 });
}
test('origin export only reads the seven master tables, never authorization or events',()=>{
 const queried=[...exportSQL.matchAll(/(?:FROM|JOIN) public\.(\w+)/g)].map(m=>m[1]);
 assert.deepEqual([...new Set(queried)].sort(),[...masters].sort());
 assert.match(exportSQL,/WHERE lower\(a\.estatus\)='activo'/);
 assert.match(exportSQL,/'plantilla_tecnicos',coalesce\(\(SELECT jsonb_agg\(to_jsonb\(a\) ORDER BY id\) FROM technicians a\)/);
 assert.match(exportSQL,/'logistica_authorized_users','ALTA_MANUAL_REQUERIDA'/);
 assert.doesNotMatch(exportSQL,/pg_\w*dump|dblink|COPY|INSERT INTO/i);
});
test('post-seed schema checks allow only masters/auth, preserving initial baseline contract',()=>{
 const checks=checksCTEs(model,{allowData:[...masters,'logistica_authorized_users']});
 assert.ok(checks.includes("name NOT IN ('logistica_schema_migrations','machine_family'"));
 for(const name of ['work_order','work_order_task','inspection_order','inspection_order_task','logistica_deliveries','logistica_delivery_evidence','entregas_logistica_legacy','logistica_legacy_owner_mapping']) {
  assert.ok(!masters.includes(name));
  assert.ok(checks.includes("('"+name+"')"));
 }
 assert.match(checks,/TABLE_NOT_EMPTY_OR_UNSUPPORTED/);
 assert.match(checks,/SEQUENCE_NOT_FRESH/);
 assert.match(validation,/MASTER_SEQUENCE_STATE/);
 assert.ok(!validation.includes("UNION ALL SELECT 'PENDIENTE_EXPORT_CONFIG_PROD'"));
 assert.match(validation,/MASTER_ROW_MISSING_OR_CHANGED/);
 assert.match(validation,/CALIDAD_SEED_DATOS_VALIDOS/);
 assert.match(validation,/LOGISTICA_AUTH_PENDIENTE/);
});
test('complete synthetic master graph satisfies relational checks without Logistics users',fixtureOptions,()=>{
 assert.deepEqual(issues(fixture()),[]);
});
test('empty masters cannot be certified as operational configuration',fixtureOptions,()=>{
 const rows=issues({});
 for(const name of masters)assert.ok(rows.includes('MASTER_EMPTY:'+name));
});
test('real approved data retains all inherited findings in the SQL checks',fixtureOptions,()=>{
 assert.deepEqual(issues(loadApprovedSource().tables).sort(),[
  'ASSEMBLY_INSPECTION_CONFIG_MISSING','ASSEMBLY_RELEASE_CODE_MISSING',
  'DUPLICATE_TECHNICIAN_EMAIL','SECTION_WITHOUT_TASKS','TECHNICIAN_REQUIRED_FIELDS',
 ].sort());
});
for(const [label,change,expected] of [
 ['logical section FK',d=>d.template_section[0].template_id=999,'SECTION_TEMPLATE_ORPHAN'],
 ['logical inspection point FK',d=>d.template_task_inspection[0].section_id=999,'INSPECTION_POINT_SECTION_ORPHAN'],
 ['model FK',d=>d.machine_model[0].family_id=999,'MODEL_FAMILY_ORPHAN'],
 ['task FK',d=>d.template_task[0].section_id=999,'TASK_SECTION_ORPHAN'],
 ['release code',d=>d.template_task[1].code=null,'ASSEMBLY_RELEASE_CODE_MISSING'],
 ['empty inspection section',d=>d.template_task_inspection.pop(),'SECTION_WITHOUT_INSPECTION_POINTS'],
 ['published inspection',d=>d.maintenance_template[1].is_published=false,'UNPUBLISHED_TEMPLATE'],
 ['duplicate technician',d=>d.plantilla_tecnicos.push({...d.plantilla_tecnicos[0],id:51}),'DUPLICATE_TECHNICIAN_EMAIL'],
 ['ambiguous inspection',d=>{d.maintenance_template.push({...d.maintenance_template[1],id:12});d.template_section.push({id:23,template_id:12,title:'Inspección de ensamble',position:1});},'AMBIGUOUS_INSPECTION'],
])test(`incompatible ${label} is detected by actual relational checks`,fixtureOptions,()=>{
 const data=fixture();change(data);assert.ok(issues(data).includes(expected));
});
const exportCTEs=()=>exportSQL.slice(exportSQL.indexOf('raw_published AS ('),exportSQL.indexOf('technician_status_profile AS (')).trim().replace(/,$/,'');
const candidates=data=>evaluate(data,exportCTEs()+' SELECT id FROM candidates ORDER BY id').map(r=>r.id);
test('export selects only published master graphs and preserves their IDs for later remapping',fixtureOptions,()=>{
 const data=fixture();data.maintenance_template[0].is_published=false;
 assert.deepEqual(candidates(data),[11]);
 const selected=evaluate(data,exportCTEs()+' SELECT id FROM families');
 assert.deepEqual(selected.map(r=>r.id),[1]);
});
test('explicit test marker quarantines the full template graph instead of exporting partial tasks',fixtureOptions,()=>{
 const data=fixture();data.template_task[0].title='TEST_LOCAL task';
 assert.deepEqual(candidates(data),[11]);
 data.machine_family[0].name='TEST family';assert.deepEqual(candidates(data),[]);
});
test('functional inspection wording is not confused with explicit test-data markers',fixtureOptions,()=>{
 const data=fixture();data.template_task_inspection[0].revision_point='Prueba de presión';
 assert.deepEqual(candidates(data),[10,11]);
});
test('missing master parents cannot produce apparently usable export candidates',fixtureOptions,()=>{
 const data=fixture();data.machine_model[0].family_id=999;assert.deepEqual(candidates(data),[]);
});
test('technician export follows the real frontend active selector and API10 roles',fixtureOptions,()=>{
 const data=fixture(),base=data.plantilla_tecnicos[0];
 data.plantilla_tecnicos=[
  {...base,id:50,estatus:'Activo'},
  {...base,id:51,estatus:'ACTIVO',puesto:'Supervisor de calidad'},
  {...base,id:52,estatus:'Inactivo'},
  {...base,id:53,estatus:'Activo',puesto:'unrelated role'},
  {...base,id:54,estatus:'Activo ',puesto:'Supervisor de calidad'},
 ];
 assert.deepEqual(evaluate(data,exportCTEs()+' SELECT id FROM technicians ORDER BY id').map(r=>r.id),[50,51]);
});
test('technician test identities are excluded instead of becoming real seed candidates',fixtureOptions,()=>{
 const data=fixture();data.plantilla_tecnicos[0].estatus='Activo';
 data.plantilla_tecnicos[0].nombre_tecnico='TEST_LOCAL person';
 assert.deepEqual(evaluate(data,exportCTEs()+' SELECT id FROM technicians'),[]);
});
test('Logistics absence is reported separately and never added as a configuration error',fixtureOptions,()=>{
 const authorization=validation.slice(validation.indexOf('authorization AS ('),validation.indexOf('), report AS ('))+')';
 const data=fixture();
 assert.equal(evaluate(data,authorization+' SELECT pending FROM authorization')[0].pending,1);
 data.logistica_authorized_users=[{id:60,firebase_project:'logistica-ar',firebase_uid:'synthetic-only',is_active:false}];
 assert.equal(evaluate(data,authorization+' SELECT pending FROM authorization')[0].pending,1);
 data.logistica_authorized_users[0].is_active=true;
 assert.equal(evaluate(data,authorization+' SELECT pending FROM authorization')[0].pending,0);
 assert.deepEqual(issues(data),[]);
});
test('populated master sequences cannot collide with the next runtime insert',fixtureOptions,()=>{
 const start=validation.indexOf("SELECT 'MASTER_SEQUENCE_STATE:machine_family'");
 const check=validation.slice(start,validation.indexOf('\n UNION ALL ',start));
 const data=fixture();
 const next=loadApprovedSource().maxIds.machine_family+1;
 data.sequence_state=[{s:{table:'machine_family'},last_value:next-1,is_called:false}];
 const query='sequence_test AS ('+check+') SELECT * FROM sequence_test';
 assert.equal(evaluate(data,query).length,1);
 data.sequence_state[0].last_value=next;
 assert.equal(evaluate(data,query).length,0);
 data.sequence_state[0].is_called=true;
 assert.equal(evaluate(data,query).length,1);
 data.sequence_state[0].is_called=false;
 assert.equal(evaluate(data,query).length,0);
});
