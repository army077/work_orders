import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { generatedFiles, statements } from './build_package.mjs';
import { core, historical, rootFunctions } from '../transfer_calidad/manifest.mjs';
import { NAMES, artifacts, states } from '../migrations/prod/logistica_prod_support.js';
import { compareSnapshots, parseSnapshot } from '../transfer_calidad/compare_snapshots.mjs';
import { prepareDumpArgs } from '../transfer_calidad/prepare_dump_args.mjs';
import { parseReport, extractCapture, validateRestore, selectToc, transfer, captureApprovedSource } from './08_operar.mjs';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const sqlNames=[...generatedFiles().keys()].filter(n=>n.endsWith('.sql'));
const encode=rows=>rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
function records(database) {
  return [
    {kind:'identity',database,version:'16.15'},
    {kind:'database_settings',encoding:'UTF8'},
    {kind:'scope',tables:[...core.map(name=>({name,present:true,selected:true})),
      ...historical.map(name=>({name,present:database==='artecnologia',selected:false}))]},
    ...core.map(name=>({kind:'table',name,columns:[],constraints:[],indexes:[],triggers:[]})),
    ...core.map(name=>({kind:'count',name,count:'0',max_keys:{id:null}})),
    ...rootFunctions.map(n=>({kind:'function',name:`public.${n}(integer)`,definition:'sha256:fixture'})),
    {kind:'sequence',name:'public.work_order_id_seq',last_value:'1',is_called:false,definition:{increment:'1'}},
    {kind:'complete',tables:core.length,functions:rootFunctions.length,sequences:1,foreign_keys:0},
  ];
}
function report(database,rows=records(database)) {
  return [
    ...rows.map(detail=>({check:'CAPTURA',status:'METADATO',detail})),
    {check:database==='artecnologia'?'ORIGEN_APTO':'CAPTURA_RESTORE_APTA',status:'SI',detail:{}}
  ];
}
const tsv=rows=>'1\n'+rows.map(r=>[r.check,r.status,JSON.stringify(r.detail)].join('\t')).join('\n')+'\n';

test('transfer composes the existing backup/export/restore once in order without a separate preflight',async()=>{
  const calls=[];
  await transfer(async command=>{calls.push(command);});
  assert.deepEqual(calls,['backup','export','restore']);
});
test('transfer stops on each failed stage without continuing or retrying',async()=>{
  const stages=['backup','export','restore'];
  for(const failed of stages) {
    const calls=[];
    await assert.rejects(transfer(async command=>{
      calls.push(command);
      if(command===failed) throw new Error('STAGE_FAILED');
    }),/STAGE_FAILED/);
    assert.deepEqual(calls,stages.slice(0,stages.indexOf(failed)+1));
  }
});
function sourceClient(rows) {
  const queries=[];
  return {queries,async query(sql) {
    queries.push(sql);
    if(sql.includes('AS database_guard')) return {rows:[{database_guard:1}]};
    return {rows:sql.startsWith('WITH RECURSIVE')
      ?rows.map(row=>({CHECK:row.check,ESTADO:row.status,DETALLE:row.detail})):[]};
  }};
}
test('integrated source preflight accepts complete approved capture without manual review',async()=>{
  const rows=report('artecnologia'), client=sourceClient(rows);
  const baseline=await captureApprovedSource(client);
  assert.deepEqual(parseReport(baseline),rows);
  assert.equal(client.queries.filter(sql=>sql.startsWith('WITH RECURSIVE')).length,1);
  assert.ok(client.queries.some(sql=>sql.includes("current_database() = 'artecnologia'")));
});
test('critical origin results, wrong identity and truncated capture prevent export/restore',async()=>{
  const cases=[];
  for(const status of ['NO','REVISAR',undefined]) {
    const rows=report('artecnologia'); rows.at(-1).status=status;
    cases.push([rows,/NO_GO_ORIGEN_APTO/]);
  }
  const wrong=report('artecnologia'); wrong[0].detail.database='calidad';
  cases.push([wrong,/WRONG_DATABASE/]);
  const incomplete=report('artecnologia'); incomplete.splice(incomplete.findIndex(row=>row.detail.kind==='complete'),1);
  cases.push([incomplete,/INCOMPLETE/]);
  for(const [rows,error] of cases) {
    const calls=[];
    await assert.rejects(transfer(async command=>{
      calls.push(command);
      if(command==='backup') await captureApprovedSource(sourceClient(rows));
    }),error);
    assert.deepEqual(calls,['backup']);
  }
});

test('generated artifacts match authoritative sources apart from checkout line endings',()=>{
  assert.equal(core.length,15); assert.equal(historical.length,4);
  for(const [name,content] of generatedFiles()) assert.equal(read(name),content,name);
});
for(const [index,name] of sqlNames.entries()) {
  test(`${name}: read-only statements, fixed database/version guard, no psql or writes`,()=>{
    const sql=read(name), parsed=statements(sql);
    assert.match(parsed[0],/^BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY$/);
    assert.match(parsed[1],new RegExp(`current_database\\(\\) = '${index===0?'artecnologia':'calidad'}'`));
    assert.match(parsed[1],/server_version_num/);
    assert.equal(parsed.at(-1),'ROLLBACK');
    assert.ok(parsed.every(s=>/^(BEGIN|SELECT|WITH|SET LOCAL|ROLLBACK)\b/.test(s)));
    const outsideLiterals=sql.replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''");
    assert.doesNotMatch(outsideLiterals,/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|COPY|CALL|DO|GRANT|REVOKE)\b/i);
    assert.doesNotMatch(sql,/\b(nextval|setval|pg_advisory_lock|pg_notify|dblink|lo_import|pg_read_file)\s*\(/i);
    assert.doesNotMatch(sql,/^\\/m);
    assert.match(sql,/"CHECK"/); assert.match(sql,/"ESTADO"/); assert.match(sql,/"DETALLE"/);
  });
}
test('pending historical presence does not authorize data migration or invalidate excluded destination',()=>{
  const a=records('artecnologia'), b=records('calidad');
  assert.equal(compareSnapshots(encode(a),encode(b)).equivalent,true);
  const plan=prepareDumpArgs(encode(a));
  assert.ok(historical.every(n=>!plan.tables_and_sequences.includes(n)));
  assert.equal(plan.tables_and_sequences.length,16);
  a.find(r=>r.kind==='scope').tables[0].selected=false;
  assert.throws(()=>parseSnapshot(encode(a),'artecnologia'),/MISSING_CORE/);
});
test('capture parser rejects truncation, malformed TSV, scope overrides, wrong DB and missing success',()=>{
  assert.equal(parseReport(tsv(report('artecnologia'))).length,records('artecnologia').length+1);
  assert.throws(()=>parseReport('x\tSI\tnotjson'));
  assert.throws(()=>parseReport('unrecognized output'));
  const a=report('artecnologia'); a.splice(a.findIndex(r=>r.detail.kind==='complete'),1);
  assert.throws(()=>extractCapture(a,'artecnologia'),/INCOMPLETE/);
  assert.throws(()=>extractCapture(report('artecnologia'),'calidad'),/WRONG_DATABASE/);
  const b=report('artecnologia'); b.find(r=>r.check==='ORIGEN_APTO').status='REVISAR';
  assert.throws(()=>validateRestore(tsv(b),tsv(report('calidad'))),/ORIGIN_NOT_READY/);
});
test('restore comparator automatically detects counts, PK/FK/index/default/trigger/function/sequence drift',()=>{
  assert.equal(validateRestore(tsv(report('artecnologia')),tsv(report('calidad'))).RESTORE_VALIDADO,'SI');
  const mutations=[
    rows=>rows.find(r=>r.kind==='count').count='1',
    rows=>rows.find(r=>r.kind==='count').max_keys={id:'99'},
    rows=>rows.find(r=>r.kind==='table').constraints=[{name:'pk',validated:true}],
    rows=>rows.find(r=>r.kind==='table').constraints=[{name:'fk',validated:true}],
    rows=>rows.find(r=>r.kind==='table').indexes=[{name:'idx',valid:true,ready:true}],
    rows=>rows.find(r=>r.kind==='table').columns=[{name:'id',default:'sha256:changed'}],
    rows=>rows.find(r=>r.kind==='table').triggers=[{name:'guard',definition:'sha256:changed'}],
    rows=>rows.find(r=>r.kind==='function').definition='sha256:changed',
    rows=>rows.find(r=>r.kind==='sequence').last_value='2',
  ];
  for(const mutate of mutations) {
    const b=records('calidad'); mutate(b);
    assert.equal(validateRestore(tsv(report('artecnologia')),tsv(report('calidad',b))).RESTORE_VALIDADO,'NO');
  }
  const unsafe=report('calidad'); unsafe.find(r=>r.check==='CAPTURA_RESTORE_APTA').status='NO';
  assert.throws(()=>validateRestore(tsv(report('artecnologia')),tsv(unsafe)),/NOT_READY/);
});
test('sequence and external-dependency SQL fail closed and output hashed bodies only',()=>{
  for(const name of [sqlNames[0],sqlNames[2]]) {
    const sql=read(name);
    for(const code of ['OUTBOUND_FK','UNSAFE_SEQUENCE','UNSUPPORTED_DEPENDENCY','EVENT_TRIGGER','INVALID_FK']) assert.ok(sql.includes(code));
    assert.match(sql,/q\.seqcache<>1 OR q\.seqcycle/);
    assert.match(sql,/is_called[\s\S]+q\.seqincrement/);
    assert.match(sql,/min\(%I\)[\s\S]+max\(%I\)/);
    assert.match(sql,/sha256\(convert_to\(\(pg_get_functiondef/);
    assert.doesNotMatch(sql,/'routine_definition'/);
    assert.match(sql,/selected', name = ANY/);
  }
});
function tocFixture() {
  const a=report('artecnologia'), lines=[];
  core.forEach((name,i)=>{
    const oid=100+i, n=name.slice(7);
    a.push({check:'OBJETO_TOC',status:'METADATO',detail:{catalog:1259,oid}});
    lines.push(`${i+1}; 1259 ${oid} TABLE public ${n} owner`,`${i+100}; 0 ${oid} TABLE DATA public ${n} owner`,
      `${i+200}; 0 0 ACL public TABLE ${n} owner`);
  });
  rootFunctions.forEach((name,i)=>{
    a.push({check:'FUNCION_TOC',status:'METADATO',detail:{catalog:1255,oid:500+i}});
    lines.push(`${i+300}; 1255 ${500+i} FUNCTION public ${name}(integer) owner`,
      `${i+400}; 0 0 ACL public FUNCTION ${name}(integer) owner`);
  });
  lines.push('800; 0 0 SEQUENCE SET public work_order_id_seq owner',
    '801; 0 0 SEQUENCE OWNED BY public work_order_id_seq owner',
    '900; 1259 999 TABLE public desviaciones_calidad_legacy owner',
    '901; 0 999 TABLE DATA public desviaciones_calidad_legacy owner',
    '902; 0 0 ACL public TABLE work_order_other owner',
    '903; 0 0 DATABASE - artecnologia owner');
  return {a,lines};
}
test('TOC selection is fixed, exact, preserves archive order, includes function ACL and rejects incomplete exports',()=>{
  const {a,lines}=tocFixture(), selected=selectToc(lines.join('\n'),a);
  assert.doesNotMatch(selected,/legacy|work_order_other|DATABASE/);
  assert.match(selected,/ACL public FUNCTION move_section/);
  assert.match(selected,/SEQUENCE SET/); assert.match(selected,/SEQUENCE OWNED BY/);
  assert.deepEqual(selected.trim().split('\n'),lines.filter(l=>!l.startsWith('90')));
  assert.throws(()=>selectToc(lines.filter(l=>!l.includes('FUNCTION public move_section')).join('\n'),a),/FUNCTIONS_INCOMPLETE/);
  assert.throws(()=>selectToc(lines.filter(l=>!l.includes('TABLE DATA public machine_family ')).join('\n'),a),/DATA_INCOMPLETE/);
  assert.throws(()=>selectToc(lines.filter(l=>!l.includes('SEQUENCE SET public work_order_id_seq ')).join('\n'),a),/SEQUENCE_STATES_INCOMPLETE/);
  assert.throws(()=>selectToc('bad format',a),/TOC_FORMAT/);
});
test('logistics validator derives final shape, all seven hashes/order from existing production artifacts',()=>{
  const sql=read('04_validar_post_logistica_calidad.sql'), docs=read('05_COMANDOS_TRANSFERENCIA.md');
  assert.ok(sql.includes(states().at(-1).fingerprint));
  let last=0;
  for(const file of artifacts()) {
    assert.ok(sql.includes(file.sha256));
    const position=docs.indexOf('`'+file.name+'`'); assert.ok(position>last); last=position;
  }
  assert.equal(NAMES.length,7); assert.match(sql,/x\.applied_at>=y\.applied_at/);
  assert.match(sql,/count\(\*\) FROM ledger\)=7/);
  assert.doesNotMatch(sql,/FROM public\.(logistica_authorized_users|logistica_legacy_owner_mapping|logistica_deliveries)\b/);
});
test('operational commands stop/reject retries and reuse original migration applicator and comparator',()=>{
  const runner=read('08_operar.mjs'), docs=read('05_COMANDOS_TRANSFERENCIA.md');
  assert.match(runner,/from '..\/transfer_calidad\/compare_snapshots.mjs'/);
  assert.match(runner,/from '..\/migrations\/prod\/apply_logistica_migration_prod.js'/);
  assert.match(runner,/for\(const file of artifacts\(\)\)/);
  assert.match(runner,/MIGRATIONS_ALREADY_ATTEMPTED_STOP/);
  assert.match(runner,/RESTORE_ALREADY_ATTEMPTED_STOP/);
  assert.doesNotMatch(runner,/ESCRITORES_DETENIDOS|WRITERS_NOT_CONFIRMED_STOPPED|SOURCE_CHANGED_DURING_FREEZE/);
  assert.match(runner,/withExportedSnapshot/); assert.match(runner,/--snapshot=/);
  assert.match(runner,/SOURCE_TARGET_SERVER_MISMATCH/);
  assert.match(runner,/--single-transaction/); assert.match(runner,/--exit-on-error/);
  assert.doesNotMatch(runner,/native\('(?:pg_dump|pg_restore)',\[.*--(?:clean|create|disable-triggers|no-owner|no-acl)/);
  assert.match(docs,/BACKUP DE SEGURIDAD/); assert.match(docs,/EXPORT SELECTIVO/);
  assert.match(docs,/No editar el TOC manualmente/);
});
test('fixed Node18 target, no redundant administrator questions, public values and no embedded credentials',()=>{
  const admin=read('00_LEEME_ADMIN.md'), checklist=read('06_CHECKLIST_CUTOVER.md');
  const docs=[admin,checklist,read('05_COMANDOS_TRANSFERENCIA.md'),read('10_RUNBOOK_CUTOVER_FINAL.md')].join('\n');
  assert.doesNotMatch(docs,/Datos pendientes del administrador|NOMBRE_EXACTO_PM2_API10|DIRECTORIO_API10_REAL|Nombre exacto PM2 y directorio API10 confirmados/);
  assert.doesNotMatch(docs,/08_operar\.mjs preflight/);
  assert.match(admin,/Node.js v18.19.1/);
  for(const name of ['APP_ENV','PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','FIREBASE_LOGISTICA_PROJECT_ID',
    'GOOGLE_APPLICATION_CREDENTIALS','LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH','LOGISTICA_DRIVE_TOKEN_PATH','LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID']) assert.ok(checklist.includes(name));
  for(const file of readdirSync(new URL('./',import.meta.url))) {
    if(file.endsWith('.test.mjs')) continue;
    const content=read(file);
    assert.doesNotMatch(content,/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s]+:[^\s]+@|AIza[\w-]{30,}|gh[pousr]_[\w]{30,}/);
    assert.doesNotMatch(content,/<PASSWORD>/);
  }
  assert.match(checklist,/PGDATABASE=calidad/); assert.match(checklist,/FIREBASE_LOGISTICA_PROJECT_ID=logistica-ar/);
  assert.match(checklist,/no volver\s+ciegamente/i);
});
test('FileZilla manifest includes runtime and lockfile, excludes secrets/tests/admin assets',()=>{
  const paths=read('07_ARCHIVOS_API10_FILEZILLA.txt').trim().split('\n');
  assert.ok(paths.includes('package-lock.json')); assert.ok(paths.includes('db.js'));
  assert.equal(paths.length,new Set(paths).size);
  for(const path of paths) {
    assert.ok(existsSync(new URL('../../api10/'+path,import.meta.url)));
    assert.doesNotMatch(path,/\.env|credential|token|node_modules|tests|\.sql/);
  }
});
