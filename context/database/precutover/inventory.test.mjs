import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync, realpathSync, readdirSync } from 'node:fs';
import { join, sep, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TABLES, MASTERS, RELATIONSHIPS, DATABASES, plan } from './scope.mjs';
import { captureDatabase, loadSeedIds } from './inventory.mjs';
import { runInventory, parseOptions, connectionConfigs, writeReports } from './run_inventory.mjs';
import { readableSummary } from './compare.mjs';
import { fingerprintsSql, orphanSql, ident, tableSql, IDENTITY_SQL } from './sql.mjs';

const hash = value => createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const SECRET = 'SENSITIVE_SENTINEL';
const personal = {nombre_tecnico:SECRET+' Person',correo_tecnico:SECRET+'@example.invalid',telefono:'555-'+SECRET,
    nombre_bonos:SECRET+' bonus',numero_empleado:'123',sucursal:SECRET+' branch',estatus:'Activo',puesto:'Operador de producción'};
const defaultHash=hash('');
const configs={source:{database:'artecnologia',user:SECRET+'read1'},destination:{database:'calidad',user:SECRET+'read2'}};
const seed=()=>Object.fromEntries(MASTERS.map(name=>[name,new Set(['1'])]));
const column=(name,type='int4')=>({name,type,typeSchema:'pg_catalog',typeModifier:-1,notNull:true,identity:'',generated:'',collation:'-',defaultHash});
const baseFks = RELATIONSHIPS.filter(r=>['machine_model','maintenance_template','template_task','work_order','work_order_task','work_order_customs',
    'prod_delayments','inspection_order','logistica_deliveries','logistica_delivery_evidence','logistica_legacy_owner_mapping'].includes(r.child)
    && !(r.child==='inspection_order'&&r.columns[0]==='work_order_id'));

function fixture(side, alter=()=>{}) {
    const tables={};
    for(const name of TABLES){
        const ledger=name==='logistica_schema_migrations',pk=ledger?'migration_name':'id';
        const columns=[column(pk,ledger?'text':'int4')];
        const row=ledger?{migration_name:'TEST_ONLY_MIGRATION'}:{id:'1'};
        for(const r of RELATIONSHIPS.filter(r=>r.child===name)){columns.push(column(r.columns[0]));row[r.columns[0]]='1';}
        if(name==='plantilla_tecnicos')for(const [key,value]of Object.entries(personal)){columns.push(column(key,'text'));row[key]=value;}
        if(name==='maintenance_template'){
            for(const key of ['name','created_at','updated_at','created_by']){columns.push(column(key,'text'));row[key]='TEST_ONLY_'+key;}
            columns.push(column('is_published','bool'));row.is_published=true;
        }
        tables[name]={catalog:{oid:String(TABLES.indexOf(name)+1),name,kind:'r',rls:false,force_rls:false,inheritance:false,can_select:true,columns,
            constraints:[{kind:'p',columns:[pk],validated:true,deferrable:false,deferred:false,definitionHash:hash(name+':pk')}],indexes:[],triggers:[]},rows:[row]};
    }
    const state={side,tables,fks:baseFks.map(r=>({...r,columns:[...r.columns],parentColumns:[...r.parentColumns]})),sequences:[],
        identity:{database:DATABASES[side],same_role:true,expected_role:true,version_num:160015,read_only:true,repeatable_read:true,
            dangerous_role:false,write_privileges:false,create_privileges:false},failures:{},queries:[],ends:0,connects:0};
    alter(state);return state;
}

function fakeClient(state){
    return {on(){},async connect(){state.connects++;if(state.connectError)throw state.connectError;},async end(){state.ends++;if(state.endError)throw state.endError;},
        async query(q){
            state.queries.push(q);
            const failure=state.failures[q.inventoryTag];
            if(failure)throw failure;
            if(q.inventoryTag==='identity')return {rows:[state.identity]};
            if(q.inventoryTag==='catalog')return {rows:Object.values(state.tables).map(t=>t.catalog)};
            if(q.inventoryTag==='foreign_keys')return {rows:state.fks.map(r=>({child_schema:'public',parent_schema:'public',child:r.child,parent:r.parent,
                columns:r.columns,parent_columns:r.parentColumns,validated:r.validated!==false,match:r.match??'s',builtin_equality:r.builtin_equality!==false}))};
            if(q.inventoryTag==='sequences')return {rows:state.sequences};
            if(q.inventoryTag.startsWith('sequence:'))return {rows:[{last_value:state.sequenceValue??'2',is_called:false}]};
            if(q.inventoryTag.startsWith('count:')){
                const t=state.tables[q.inventoryTag.slice(6)],rows=t.rows,pk=t.catalog.constraints.find(c=>c.kind==='p')?.columns??[];
                const ids=rows.filter(r=>r.id!==undefined).map(r=>BigInt(r.id)).sort((a,b)=>a<b?-1:a>b?1:0);
                const keys=rows.map(r=>JSON.stringify(pk.map(k=>r[k])));
                return {rows:[{count:String(rows.length),min_id:ids.length?String(ids[0]):null,max_id:ids.length?String(ids.at(-1)):null,
                    duplicate_keys:pk.length?String(keys.length-new Set(keys).size):null,null_keys:pk.length?String(rows.filter(r=>pk.some(k=>r[k]==null)).length):null,
                    published_count:t.catalog.name==='maintenance_template'?String(rows.filter(r=>r.is_published===true).length):null}]};
            }
            if(q.inventoryTag.startsWith('fingerprints:')){
                const name=q.inventoryTag.slice(13),t=state.tables[name],pk=t.catalog.constraints.find(c=>c.kind==='p').columns;
                const select=(r,columns)=>Object.fromEntries(columns.map(c=>[c,r[c]]));
                const business=t.catalog.columns.map(c=>c.name).filter(c=>name!=='maintenance_template'||!['created_at','updated_at','created_by'].includes(c));
                const rows=t.rows.map(r=>({key_hash:hash(select(r,pk)),id:pk.length===1&&pk[0]==='id'?r.id:null,
                    business_hash:hash(select(r,business)),full_hash:hash(select(r,t.catalog.columns.map(c=>c.name))),
                    refs:Object.fromEntries(RELATIONSHIPS.filter(rel=>rel.child===name).map(rel=>[rel.columns[0],r[rel.columns[0]]??null])),
                    unexpectedPersonalField:SECRET}));
                if(state.rowOverride)return {rows:state.rowOverride(name,rows)};
                return {rows:rows.slice(0,q.values[0])};
            }
            if(q.inventoryTag.startsWith('orphans:')){
                const [child,columns,parent,parentColumns]=JSON.parse(q.inventoryTag.slice(8));
                const missing=state.tables[child].rows.filter(c=>{
                    const nonnull=columns.filter(k=>c[k]!=null).length;
                    const fk=state.fks.find(r=>r.child===child&&r.parent===parent&&JSON.stringify(r.columns)===JSON.stringify(columns));
                    if(fk?.match==='f'&&nonnull>0&&nonnull<columns.length)return true;
                    return nonnull===columns.length&&!state.tables[parent].rows.some(p=>columns.every((k,i)=>p[parentColumns[i]]===c[k]));
                }).length;
                return {rows:[{missing:String(missing)}]};
            }
            return {rows:[]};
        }};
}

async function paired(alterSource=()=>{},alterDestination=()=>{},options={}){
    const source=fixture('source',alterSource),destination=fixture('destination',alterDestination);
    const report=await runInventory(configs,{clientFactory:(_c,side)=>fakeClient(side==='source'?source:destination),seedIds:seed(),...options});
    return {report,source,destination};
}
const table=(report,name)=>report.tables.find(t=>t.table===name);
const comp=(report,name)=>report.comparisons.find(t=>t.table===name);

test('plan covers all 25 confirmed tables, 19 explicit relationships, no connection',()=>{
    const p=plan();assert.equal(p.connections,0);assert.equal(p.tables.length,25);assert.equal(new Set(p.tables).size,25);
    assert.equal(p.applicationRelationships.length,19);assert.equal(p.mode,'PLAN');assert.ok(p.tables.includes('entregas_logistica_legacy'));
});
test('plan CLI succeeds with all sockets blocked and no connection settings',()=>{
    const r=spawnSync(process.execPath,['--require',fileURLToPath(new URL('./offline_guard.cjs',import.meta.url)),
        fileURLToPath(new URL('./run_inventory.mjs',import.meta.url)),'--plan'],{encoding:'utf8',env:{SystemRoot:process.env.SystemRoot,PATH:process.env.PATH}});
    assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).connections,0);assert.equal(r.stderr,'');
});
test('no execution mode is implicit; flags and numeric limits are strict',()=>{
    for(const args of [[],['--execute-readonly'],['--plan','--out','x'],['--execute-readonly','--out','relative'],
        ['--execute-readonly','--out',process.cwd(),'--timeout-ms','0'],['--execute-readonly','--out',process.cwd(),'--max-rows','NaN'],
        ['--execute-readonly','--out',process.cwd(),'--out',process.cwd()]])assert.throws(()=>parseOptions(args));
    assert.equal(parseOptions(['--execute-readonly','--out',process.cwd()]).timeoutMs,20000);
});
test('explicit independent credentials required; ambient PG variables cannot supply missing endpoints',()=>{
    assert.throws(()=>connectionConfigs({PGHOST:'localhost',PGUSER:'person',PGPASSWORD:SECRET}));
    const env={PRECUTOVER_READ_ONLY_ACK:'SI'};
    for(const [prefix,database]of [['PRECUTOVER_SOURCE_','artecnologia'],['PRECUTOVER_DESTINATION_','calidad']])
        for(const [key,value]of Object.entries({PGHOST:'localhost',PGPORT:'5432',PGUSER:'test_reader',PGPASSWORD:SECRET,PGDATABASE:database,SSL_MODE:'verify-full'}))env[prefix+key]=value;
    assert.notEqual(connectionConfigs(env).source,connectionConfigs(env).destination);
    for(const patch of [{PRECUTOVER_DESTINATION_PGDATABASE:'wrong'},{PRECUTOVER_SOURCE_SSL_MODE:'require'},
        {PRECUTOVER_SOURCE_PGHOST:'postgres://'+SECRET+'@localhost'},{PRECUTOVER_SOURCE_PGPASSWORD:''}])assert.throws(()=>connectionConfigs({...env,...patch}));
});
test('wrong requested database refuses both clients before connecting',async()=>{
    let calls=0;
    await assert.rejects(runInventory({...configs,destination:{...configs.destination,database:'artecnologia'}},{clientFactory:()=>{calls++;},seedIds:seed()}));
    assert.equal(calls,0);
});
for(const side of ['source','destination'])test('wrong live '+side+' identity stops its catalog reads and closes it',async()=>{
    const edit=s=>{s.identity.database='wrong';};
    const result=await paired(side==='source'?edit:undefined,side==='destination'?edit:undefined);
    const state=result[side];assert.equal(result.report.status,'NO-GO');assert.equal(state.ends,1);
    assert.equal(state.queries.some(q=>q.inventoryTag==='catalog'),false);assert.equal(result.report.environments[side].identity,null);
});
for(const patch of [{version_num:150009},{same_role:false},{expected_role:false},{read_only:false},{repeatable_read:false},
    {dangerous_role:true},{write_privileges:true},{create_privileges:true}])test('rejects unsafe identity '+JSON.stringify(patch),async()=>{
    const {report,source}=await paired(s=>Object.assign(s.identity,patch));
    assert.equal(report.status,'NO-GO');assert.equal(source.ends,1);assert.equal(source.queries.some(q=>q.inventoryTag==='catalog'),false);
});
test('complete identical mock inventories can PASS; counts and string IDs stay exact',async()=>{
    const {report,source,destination}=await paired();
    assert.equal(report.status,'PASS');assert.equal(report.totals.source.tablesCounted,25);assert.equal(table(report,'work_order').source.count,'1');
    assert.equal(table(report,'work_order').source.minId,'1');assert.equal(source.ends,1);assert.equal(destination.ends,1);
    assert.equal(report.migrationAuthorized,false);assert.equal(report.atomicAcrossDatabases,false);
});
test('critical table absence is confirmed absence and NO-GO, not a zero-row PASS',async()=>{
    const {report}=await paired(s=>{delete s.tables.work_order;});
    assert.equal(table(report,'work_order').source.exists,false);assert.equal(table(report,'work_order').source.count,null);assert.equal(report.status,'NO-GO');
});
test('absent optional legacy is WARNING and never inferred to be modern events',async()=>{
    const remove=s=>{delete s.tables.preembarque_legacy;};
    const {report}=await paired(remove,remove);assert.equal(report.status,'WARNING');
    assert.equal(table(report,'preembarque_legacy').source.status,'WARNING');
    assert.equal(report.dependencies.source.some(r=>r.child==='preembarque_legacy'),false);
});
test('connection failure leaves unknown tables, NO-GO, and closes both clients',async()=>{
    const {report,source,destination}=await paired(s=>{s.connectError=Object.assign(new Error(SECRET),{code:'ECONNREFUSED'});});
    assert.equal(report.status,'NO-GO');assert.equal(table(report,'work_order').source.exists,null);
    assert.equal(source.ends,1);assert.equal(destination.ends,1);assert.doesNotMatch(JSON.stringify(report),new RegExp(SECRET));
});
test('insufficient table privileges do not execute a data scan or fabricate counts',async()=>{
    const {report,source}=await paired(s=>{s.tables.plantilla_tecnicos.catalog.can_select=false;});
    assert.equal(table(report,'plantilla_tecnicos').source.count,null);assert.equal(report.status,'NO-GO');
    assert.equal(source.queries.some(q=>q.inventoryTag==='count:plantilla_tecnicos'),false);
});
for(const [name,code]of [['permission','42501'],['timeout','57014']])test(name+' query failure is recovered using a savepoint and reported unavailable',async()=>{
    const {report,source}=await paired(s=>{s.failures['count:work_order']=Object.assign(new Error(SECRET),{code});});
    assert.equal(report.status,'NO-GO');assert.equal(table(report,'work_order').source.count,null);
    assert.ok(source.queries.some(q=>q.inventoryTag==='recover'));assert.equal(table(report,'work_order_task').source.count,'1');
    assert.equal(source.ends,1);assert.doesNotMatch(JSON.stringify(report),new RegExp(SECRET));
});
test('broken recovery stops the capture and still closes',async()=>{
    const {report,source}=await paired(s=>{s.failures['count:work_order']=new Error(SECRET);s.failures.recover=new Error(SECRET);});
    assert.equal(report.status,'NO-GO');assert.equal(report.environments.source.complete,false);assert.equal(source.ends,1);
});
test('connection close failure is NO-GO',async()=>{
    const {report}=await paired(s=>{s.endError=new Error(SECRET);});assert.equal(report.status,'NO-GO');
});
test('duplicate primary keys cannot PASS or produce content comparisons',async()=>{
    const {report}=await paired(s=>s.tables.work_order.rows.push({...s.tables.work_order.rows[0]}));
    assert.equal(table(report,'work_order').source.duplicateKeys,'1');assert.equal(comp(report,'work_order').rowsComparable,false);assert.equal(report.status,'NO-GO');
});
test('duplicate fingerprint keys and truncated row sets fail completeness',async()=>{
    for(const transform of [rows=>[...rows,...rows],()=>[]]){
        const {report}=await paired(s=>{s.rowOverride=(name,rows)=>name==='machine_family'?transform(rows):rows;});
        assert.equal(report.status,'NO-GO');assert.equal(comp(report,'machine_family').rowsComparable,false);
    }
});
test('matching IDs with different personal business data are conflicts without raw values',async()=>{
    const {report}=await paired(undefined,s=>{s.tables.plantilla_tecnicos.rows[0].nombre_tecnico=SECRET+' Different';});
    const comparison=comp(report,'plantilla_tecnicos');assert.equal(comparison.status,'NO-GO');assert.equal(comparison.potentialIdConflicts.count,'1');
    assert.deepEqual(comparison.potentialIdConflicts.ids,['1']);assert.doesNotMatch(JSON.stringify(report),new RegExp(SECRET));
});
test('only source/destination records and capped technical samples are distinguished',async()=>{
    const editSource=s=>s.tables.machine_customs.rows=[{id:'2'},{id:'3'}];
    const editDest=s=>s.tables.machine_customs.rows=[{id:'4'}];
    const {report}=await paired(editSource,editDest,{sampleLimit:1});
    const c=comp(report,'machine_customs');assert.equal(c.sourceOnly.count,'2');assert.deepEqual(c.sourceOnly.ids,['2']);assert.equal(c.sourceOnly.truncated,true);
    assert.deepEqual(c.destinationOnly.ids,['4']);assert.equal(c.potentialIdConflicts.count,'0');
});
test('recreated template metadata is excluded while name changes remain conflicts',async()=>{
    const {report}=await paired(undefined,s=>{s.tables.maintenance_template.rows[0].updated_at=SECRET;});
    assert.equal(comp(report,'maintenance_template').potentialIdConflicts.count,'0');assert.equal(comp(report,'maintenance_template').recreatedMetadataOnly.count,'1');
    const other=await paired(undefined,s=>{s.tables.maintenance_template.rows[0].name=SECRET;});
    assert.equal(comp(other.report,'maintenance_template').potentialIdConflicts.count,'1');
});
test('actual FK and application logical relationship are explicitly different',async()=>{
    const {report}=await paired();
    assert.equal(report.dependencies.source.find(r=>r.child==='work_order_task').kind,'FK');
    assert.equal(report.dependencies.source.find(r=>r.child==='desviaciones_calidad').kind,'LOGICAL_APPLICATION');
});
for(const [child,column]of [['work_order_task','work_order_id'],['inspection_order','work_order_id'],
    ['inspection_order_task','inspection_order_id'],['desviaciones_calidad','id_actividad'],
    ['logistica_deliveries','authorized_user_id'],['logistica_delivery_evidence','delivery_id'],['logistica_legacy_owner_mapping','authorized_user_id']])
test('detects missing local parent for '+child+'.'+column,async()=>{
    const {report}=await paired(s=>{s.tables[child].rows[0][column]='999';});
    const check=report.dependencies.source.find(r=>r.child===child&&r.columns.includes(column));assert.equal(check.missing,'1');assert.equal(check.status,'NO-GO');
});
test('orders whose template/model exist in source but not destination are detected',async()=>{
    const {report}=await paired(undefined,s=>{s.tables.maintenance_template.rows=[];s.tables.machine_model.rows=[];});
    for(const parent of ['maintenance_template','machine_model']){
        const c=report.dependencies.crossDatabase.find(r=>r.child==='work_order'&&r.parent===parent);
        assert.equal(c.missingRowReferences,'1');assert.deepEqual(c.missingReferences.ids,['1']);assert.equal(c.status,'NO-GO');
    }
});
test('references outside seed are not labeled creations after snapshot',async()=>{
    const change=s=>{s.tables.maintenance_template.rows[0].id='100';s.tables.work_order.rows[0].template_id='100';s.tables.template_section.rows[0].template_id='100';s.tables.inspection_order.rows[0].inspection_template_id='100';};
    const {report}=await paired(change,change);
    const c=report.dependencies.crossDatabase.find(r=>r.child==='work_order'&&r.parent==='maintenance_template');
    assert.deepEqual(c.referencesOutsideSeed.ids,['100']);assert.equal(c.status,'PASS');
    assert.equal(report.seed.excludedTemplateIdsKnown,false);assert.equal(report.seed.originalPublishedTemplates,54);assert.equal(report.seed.selectedTemplates,51);
});
test('FK to outside scope and FK without validation are not silently PASS',async()=>{
    for(const edit of [s=>s.fks.push({child:'work_order',columns:['model_id'],parent:'outside',parentColumns:['id']}),s=>{s.fks[0].validated=false;}]){
        const {report}=await paired(edit);assert.equal(report.status,'NO-GO');assert.ok(report.dependencies.source.some(r=>r.kind==='FK'&&r.status==='NO-GO'));
    }
});
test('compound MATCH FULL detects partial-null violations',async()=>{
    const {report}=await paired(s=>{
        s.fks.push({child:'work_order',columns:['template_id','model_id'],parent:'maintenance_template',parentColumns:['id','model_id'],match:'f'});
        s.tables.work_order.rows[0].model_id=null;
    });
    const c=report.dependencies.source.find(r=>r.child==='work_order'&&r.columns.length===2);assert.equal(c.missing,'1');assert.equal(c.status,'NO-GO');
});
for(const patch of [{rls:true},{inheritance:true},{kind:'p'}])test('unsupported table shape is unavailable '+JSON.stringify(patch),async()=>{
    const {report,source}=await paired(s=>Object.assign(s.tables.work_order.catalog,patch));
    assert.equal(report.status,'NO-GO');assert.equal(table(report,'work_order').source.count,null);
    assert.equal(source.queries.some(q=>q.inventoryTag==='count:work_order'),false);
});
test('unknown/domain type is not scanned or echoed',async()=>{
    const {report}=await paired(s=>{s.tables.work_order.catalog.columns[0].type=SECRET;s.tables.work_order.catalog.columns[0].typeSchema=SECRET;});
    assert.equal(report.status,'NO-GO');assert.doesNotMatch(JSON.stringify(report),new RegExp(SECRET));
});
test('schema differences block row comparison even when counts are equal',async()=>{
    const {report}=await paired(undefined,s=>{s.tables.machine_family.catalog.columns.push(column('extra','text'));s.tables.machine_family.rows[0].extra=SECRET;});
    assert.equal(comp(report,'machine_family').rowsComparable,false);assert.deepEqual(comp(report,'machine_family').structure.destinationOnlyColumns,['extra']);assert.equal(report.status,'NO-GO');
});
test('row limits retain exact counts but never imply complete inspection',async()=>{
    const {report}=await paired(s=>{s.tables.machine_customs.rows=[{id:'1'},{id:'2'}];},undefined,{maxRows:1,maxTotalRows:10});
    assert.equal(table(report,'machine_customs').source.count,'2');assert.equal(comp(report,'machine_customs').rowsComparable,false);assert.equal(report.status,'NO-GO');
});
test('sequence discovery reads state without consuming it and detects unsafe IDs',async()=>{
    const sequence={table_name:'work_order',column_name:'id',sequence_schema:'public',sequence_name:'work_order_id_seq',increment:'1',minimum:'1',maximum:'2147483647',cache:'1',cycle:false,can_select:true};
    const {report,source}=await paired(s=>{s.sequences=[sequence];s.sequenceValue='1';});
    const seq=table(report,'work_order').source.sequences[0];assert.equal(seq.status,'NO-GO');assert.equal(seq.code,'UNSAFE_SEQUENCE');
    assert.ok(source.queries.some(q=>q.inventoryTag.startsWith('sequence:')));
});
test('sequence lacking SELECT permission remains unavailable',async()=>{
    const {report}=await paired(s=>{s.sequences=[{table_name:'work_order',column_name:'id',sequence_schema:'public',sequence_name:'work_order_id_seq',increment:'1',minimum:'1',maximum:'2147483647',cache:'1',cycle:false,can_select:false}];});
    assert.equal(table(report,'work_order').source.sequences[0].status,'NO-GO');assert.equal(report.status,'NO-GO');
});
test('BIGINT IDs and counts are not rounded by Number',async()=>{
    const edit=s=>{s.tables.machine_customs.catalog.columns[0].type='int8';s.tables.machine_customs.rows=[{id:'9223372036854775806'}];};
    const {report}=await paired(edit,edit);assert.equal(table(report,'machine_customs').source.maxId,'9223372036854775806');assert.equal(report.status,'PASS');
});
test('aborted capture never connects; cancellation during query closes clients',async()=>{
    const controller=new AbortController();controller.abort();let factories=0;
    const result=await captureDatabase('source',configs.source,{clientFactory:()=>{factories++;},signal:controller.signal});
    assert.equal(factories,0);assert.equal(result.complete,false);assert.equal(result.checks[0].code,'ABORTED');
    const active=new AbortController(),state=fixture('source');
    const client=fakeClient(state),original=client.query;
    client.query=async q=>{if(q.inventoryTag==='catalog')active.abort();return original(q);};
    const captured=await captureDatabase('source',configs.source,{clientFactory:()=>client,signal:active.signal});
    assert.equal(state.ends,1);assert.equal(captured.complete,false);
});
test('abort while constructing the client closes it without connecting',async()=>{
    const controller=new AbortController(),state=fixture('source');
    const result=await captureDatabase('source',configs.source,{signal:controller.signal,clientFactory:async()=>{
        controller.abort();return fakeClient(state);
    }});
    assert.equal(state.connects,0);assert.equal(state.ends,1);assert.equal(result.complete,false);
});
test('direct capture rejects unsafe timeout interpolation before constructing any client',async()=>{
    let clients=0;
    await assert.rejects(captureDatabase('source',configs.source,{timeoutMs:"1'; SELECT 1",clientFactory:()=>{clients++;}}));
    assert.equal(clients,0);
});
test('approved seed loader returns only IDs, checks its hash, and rejects arbitrary files',()=>{
    const ids=loadSeedIds();assert.equal(Object.values(ids).reduce((n,s)=>n+s.size,0),1139);
    assert.equal(ids.maintenance_template.size,51);assert.doesNotMatch(JSON.stringify(Object.fromEntries(Object.entries(ids).map(([k,v])=>[k,[...v]]))),/@/);
    assert.throws(()=>loadSeedIds(Buffer.from(SECRET)));
});
test('SQL interpolation is restricted to known scope and validated catalog identifiers',()=>{
    for(const input of ['id;select 1','name"','a@example.invalid','pg_catalog.x'])assert.throws(()=>ident(input));
    assert.throws(()=>tableSql('outside'));assert.throws(()=>orphanSql({child:'work_order',parent:'outside',columns:['id'],parentColumns:['id']}));
});
test('configuration SQL hashes business values on server and normalizes NUMERIC scale',()=>{
    const table={name:'machine_model',primaryKey:['id'],columns:[column('id'),column('bond_value','numeric')]};
    const sql=fingerprintsSql(table);assert.match(sql,/pg_catalog\.trim_scale/);assert.match(sql,/pg_catalog\.sha256/);assert.match(sql,/LIMIT \$1/);
    assert.doesNotMatch(sql,/SELECT\s+\*/i);
});
test('every emitted command is read-only or a fixed READ ONLY transaction control',async()=>{
    const {source,destination}=await paired();
    for(const q of [...source.queries,...destination.queries]){
        const stripped=q.text.replace(/'(?:''|[^'])*'/g,"''").replace(/--[^\n]*/g,'');
        assert.match(stripped.trim(),/^(SELECT|WITH|BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY|SET LOCAL|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK)\b/i);
        assert.doesNotMatch(stripped,/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|COMMIT|GRANT|COPY|CALL|DO)\b/i);
        assert.doesNotMatch(stripped,/\b(nextval|setval|dblink|pg_advisory_lock)\s*\(/i);
        assert.doesNotMatch(stripped,/read_only\s*=\s*off/i);
        assert.ok(q.query_timeout>=20000);
    }
    assert.match(IDENTITY_SQL,/has_sequence_privilege/);assert.match(IDENTITY_SQL,/write_privileges/);
});
test('JSON and readable report omit personal values, credentials, row hashes and arbitrary error text',async()=>{
    const {report}=await paired(s=>{s.failures['sequence:unused']=new Error(SECRET);});
    const output=JSON.stringify(report)+'\n'+readableSummary(report);
    for(const value of [SECRET,...Object.values(personal).filter(v=>String(v).includes(SECRET))])assert.equal(output.includes(value),false);
    assert.doesNotMatch(output,/businessHash|fullHash|keyHash|unexpectedPersonalField|password|PGPASSWORD/);
    assert.equal(report.totals.tables,25);
});
test('operational historical runners are never imported by the new tool',()=>{
    for(const file of ['scope.mjs','sql.mjs','inventory.mjs','compare.mjs','run_inventory.mjs']){
        const source=readFileSync(new URL(file,import.meta.url),'utf8');assert.doesNotMatch(source,/from\s+['"][^'"]*(08_operar|09_comparar_restore|apply_|db\.js|server\.js)/);
    }
});

test('missing primary key cannot produce PASS even with readable rows',async()=>{
    const {report}=await paired(s=>{s.tables.machine_customs.catalog.constraints=[];});
    assert.equal(comp(report,'machine_customs').rowsComparable,false);assert.equal(report.status,'NO-GO');
});
test('null primary key is counted as invalid',async()=>{
    const {report}=await paired(s=>{s.tables.logistica_schema_migrations.rows=[{migration_name:null}];});
    assert.equal(table(report,'logistica_schema_migrations').source.nullKeys,'1');assert.equal(report.status,'NO-GO');
});
test('non-numeric ID in a malformed driver response is not exposed',async()=>{
    const {report}=await paired(s=>{s.rowOverride=(name,rows)=>name==='work_order'?rows.map(r=>({...r,id:SECRET+'@example.invalid'})):rows;});
    assert.equal(report.status,'NO-GO');assert.doesNotMatch(JSON.stringify(report),new RegExp(SECRET));
});
test('global row budget marks incomplete tables rather than partial matches',async()=>{
    const {report}=await paired(undefined,undefined,{maxTotalRows:2});
    assert.equal(report.status,'NO-GO');assert.equal(comp(report,'work_order').rowsComparable,false);
});
test('cached sequence requires review despite a safe observed upper candidate',async()=>{
    const {report}=await paired(s=>{s.sequences=[{table_name:'work_order',column_name:'id',sequence_schema:'public',sequence_name:'work_order_id_seq',increment:'1',minimum:'1',maximum:'2147483647',cache:'10',cycle:false,can_select:true}];});
    const sequence=table(report,'work_order').source.sequences[0];assert.equal(sequence.status,'WARNING');assert.equal(sequence.code,'SEQUENCE_CACHE_REQUIRES_REVIEW');
});
test('textual PK values are never printed, even with business conflicts',async()=>{
    const edit=s=>{s.tables.logistica_schema_migrations.rows=[{migration_name:SECRET+'@example.invalid'}];};
    const {report}=await paired(edit);
    const c=comp(report,'logistica_schema_migrations');assert.equal(c.sourceOnly.count,'1');assert.deepEqual(c.sourceOnly.ids,[]);
    assert.equal(c.sourceOnly.technicalIdsAvailable,false);assert.doesNotMatch(JSON.stringify(report),new RegExp(SECRET));
});
test('current publication counts and seed differences appear in readable summary',async()=>{
    const {report}=await paired(s=>{s.tables.maintenance_template.rows[0].id='2';s.tables.maintenance_template.rows[0].is_published=false;});
    assert.equal(table(report,'maintenance_template').source.publishedCount,'0');
    const summary=readableSummary(report);assert.match(summary,/IDs_fuera_seed/);assert.match(summary,/54 publicadas\/51 seleccionadas/);
});
test('report writer creates only sanitized JSON/text and refuses overwrites',async()=>{
    const {report}=await paired();
    const root=mkdtempSync(fileURLToPath(new URL('./.offline-',import.meta.url)));
    try{
        const out=join(root,'report');writeReports(out,report);
        assert.deepEqual(readdirSync(out).sort(),['inventory.json','summary.txt']);
        const json=readFileSync(join(out,'inventory.json'),'utf8');assert.equal(JSON.parse(json).status,'PASS');assert.doesNotMatch(json,new RegExp(SECRET));
        assert.throws(()=>writeReports(out,report));assert.equal(readFileSync(join(out,'inventory.json'),'utf8'),json);
    }finally{
        const resolved=realpathSync(root),suite=realpathSync(fileURLToPath(new URL('.',import.meta.url)));
        assert.ok(resolved.startsWith(suite+sep)&&basename(resolved).startsWith('.offline-'));
        rmSync(resolved,{recursive:true,force:true});
    }
});
