import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { core, historical, rootFunctions } from './manifest.mjs';
import { deltaFiles } from './build_delta_sql.mjs';
import { compareDelta, parseDelta } from './compare_delta.mjs';
import { withExportedSnapshot } from './live_snapshot.mjs';
import { compareSnapshots } from './compare_snapshots.mjs';
import { captureInSnapshot, validateRestore } from '../deploy_calidad/08_operar.mjs';
import { statements } from '../deploy_calidad/build_package.mjs';
import { parseArchiveSequences } from './archive_sequences.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const bytes=rows=>rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
function fixture(database,items=[]) {
 return [
 {kind:'delta_identity',database,version:'16.15',canonical:'pg16-jsonb-v1-UTC-ISO',snapshot_visibility:'1:2:',started_at:'2026-10-22T00:00:00Z'},
 ...core.map(name=>({kind:'delta_table',name,supported:true,schema_sha256:sha('schema'),pk_columns:['id'],rows:String(name===core[0]?items.length:0)})),
 ...items.map(([id,value])=>({kind:'delta_row',name:core[0],pk:{id:String(id)},pk_sha256:sha(JSON.stringify({id:String(id)})),row_sha256:sha(JSON.stringify(value))})),
 {kind:'delta_complete',tables:core.length,rows:items.length,completed_at:'2026-10-22T00:01:00Z'}];
}
test('same counts but new PK and changed row hash detect INSERT and UPDATE, no automatic reconciliation',()=>{
 const baseline=bytes(fixture('artecnologia',[['1',{a:'old'}]]));
 const source=bytes(fixture('artecnologia',[['1',{a:'updated'}],['9007199254740993',{a:'inserted'}]]));
 const destination=bytes(fixture('calidad',[['1',{a:'old'}],['3',{a:'new destination'}]]));
 const result=compareDelta(source,destination,baseline);
 assert.equal(result.status,'CONCILIACION_DELTA_PENDIENTE');
 assert.deepEqual(result.differences.map(r=>r.type).sort(),['CONTENIDO_DISTINTO','SOLO_DESTINO','SOLO_ORIGEN']);
 assert.equal(result.differences.find(r=>r.type==='SOLO_ORIGEN').pk.id,'9007199254740993');
 assert.equal(result.differences.find(r=>r.type==='CONTENIDO_DISTINTO').source_changed_since_snapshot,true);
 assert.equal(result.differences.find(r=>r.type==='CONTENIDO_DISTINTO').destination_changed_since_snapshot,false);
 assert.equal(result.automatic_writes,false); assert.equal(result.automatic_reconciliation,false);
});
test('identical states, row ordering and reordered JSON properties do not create false differences',()=>{
 const a=fixture('artecnologia',[['1',{a:1}],['2',{b:null}]]),b=fixture('calidad',[['2',{b:null}],['1',{a:1}]]);
 assert.equal(compareDelta(bytes(a),bytes(b)).status,'SIN_DIFERENCIAS_OBSERVADAS');
});
test('same new PK used by both sides is reported as conflict, never inferred as safe copy/delete',()=>{
 const base=bytes(fixture('artecnologia',[]));
 const result=compareDelta(bytes(fixture('artecnologia',[['2',{x:1}]])),bytes(fixture('calidad',[['2',{x:2}]])),base);
 assert.equal(result.differences[0].type,'CONTENIDO_DISTINTO');
 assert.equal(result.differences[0].source_changed_since_snapshot,true);
 assert.equal(result.differences[0].destination_changed_since_snapshot,true);
 assert.equal(JSON.stringify(result).includes('DELETE'),false);
});
test('unsupported/no-PK tables or schema differences require review, never false equality by count',()=>{
 const a=fixture('artecnologia'),b=fixture('calidad');
 a.find(r=>r.kind==='delta_table').supported=false;
 assert.equal(compareDelta(bytes(a),bytes(b)).status,'REVISAR_TABLAS_NO_COMPARABLES');
 a.find(r=>r.kind==='delta_table').supported=true;
 b.find(r=>r.kind==='delta_table').schema_sha256=sha('different schema');
 assert.equal(compareDelta(bytes(a),bytes(b)).review.length,1);
});
test('truncated/wrong DB, duplicates, extra scopes, missing sections and exposed text PKs fail closed',()=>{
 const a=fixture('artecnologia',[['1',{a:1}]]);
 assert.throws(()=>parseDelta(bytes(a.slice(0,-1)),'artecnologia'),/INCOMPLETE/);
 assert.throws(()=>parseDelta(bytes(a),'calidad'),/IDENTITY/);
 const duplicate=structuredClone(a);duplicate.splice(-1,0,a.find(r=>r.kind==='delta_row'));
 assert.throws(()=>parseDelta(bytes(duplicate),'artecnologia'),/DUPLICATE_PK/);
 const pii=structuredClone(a);pii.find(r=>r.kind==='delta_row').pk={email:'must-not-be-exposed@example.invalid'};
 assert.throws(()=>parseDelta(bytes(pii),'artecnologia'),/PRIVACY/);
 const missing=a.filter(r=>!(r.kind==='delta_table'&&r.name===core[1]));
 assert.throws(()=>parseDelta(bytes(missing),'artecnologia'),/TABLES_INCOMPLETE/);
});
test('delta SQL generation synchronized, fixed guards and deterministic whole-row hash; SELECT only',()=>{
 for(const [name,sql] of deltaFiles()) {
  assert.equal(readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n'),sql);
  const parsed=statements(sql);
  assert.equal(parsed[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.match(parsed[1],new RegExp("current_database\\(\\)='"+(name.includes('artecnologia')?'artecnologia':'calidad')+"'"));
  assert.equal(parsed.at(-1),'ROLLBACK');
  assert.ok(parsed.every(s=>/^(BEGIN|SELECT|WITH|SET LOCAL|ROLLBACK)\b/.test(s)));
  const outside=sql.replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''");
  assert.doesNotMatch(outside,/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|CALL|COPY|DO)\b/i);
  assert.match(sql,/sha256\(convert_to\(to_jsonb\(r\)::text/);
  assert.match(sql,/timezone='UTC'/);assert.match(sql,/extra_float_digits=3/);
 }
 const comparator=readFileSync(new URL('./compare_delta.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(comparator,/from ['"](?:pg|node:child_process)|writeFile|INSERT INTO|UPDATE public|DELETE FROM/);
});
test('snapshot keeper holds READ ONLY transaction across callback/dump and always rolls back, without freeze',async()=>{
 const queries=[];let active=false;
 const client={async query(sql){queries.push(sql);if(sql.startsWith('BEGIN'))active=true;if(sql==='ROLLBACK')active=false;
  return {rows:sql.includes('current_database()')?[{database:'artecnologia',version_num:160015}]:sql.includes('pg_export_snapshot')?[{snapshot_id:'00000003-0000001B-1',started_at:'2026-10-22T00:00:00Z'}]:[]};}};
 const result=await withExportedSnapshot(client,async meta=>{assert.equal(active,true);assert.equal(meta.strategy,'SNAPSHOT_CON_DELTA');return meta.snapshot_id;});
 assert.equal(result,'00000003-0000001B-1');assert.equal(active,false);assert.equal(queries.at(-1),'ROLLBACK');
 await assert.rejects(withExportedSnapshot(client,async()=>{throw new Error('DUMP_FAILED');}),/DUMP_FAILED/);
 assert.equal(active,false);
});
test('capture reused inside keeper never starts/ends a second transaction',async()=>{
 const queries=[];
 const client={async query(sql){queries.push(sql);return {rows:[{CHECK:'TEST',ESTADO:'SI',DETALLE:{safe:true}}]};}};
 const result=await captureInSnapshot(client,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT 1; ROLLBACK;');
 assert.deepEqual(queries,['SELECT 1']);assert.match(result,/TEST\tSI/);
});
test('new snapshot mode requires exported ID; default comparison remains strict',()=>{
 assert.throws(()=>compareSnapshots('','',{mode:'production_snapshot_delta'}),/EXPORTED_SNAPSHOT_REQUIRED/);
});
function structure(database) {
 return [
 {kind:'identity',database,version:'16.15'}, {kind:'database_settings',encoding:'UTF8'},
 {kind:'scope',tables:[...core.map(name=>({name,present:true,selected:true})),...historical.map(name=>({name,present:false,selected:false}))]},
 ...core.map(name=>({kind:'table',name,constraints:[],indexes:[],owner:'APP_OWNER',acl:null})),
 ...core.map(name=>({kind:'count',name,count:'0',max_keys:{}})),
 {kind:'sequence',name:'public.test_seq',last_value:'1',is_called:false,definition:{increment:'1',cache:'1',owner:'APP_OWNER'}},
 ...rootFunctions.map(name=>({kind:'function',name:'public.'+name+'(integer)',definition:'sha256:fixture'})),
 {kind:'complete',tables:core.length,sequences:1,functions:rootFunctions.length,foreign_keys:0}];
}
test('live mode excludes only non-MVCC sequence state; definition, owners and counts remain strict',()=>{
 const a=structure('artecnologia'),b=structure('calidad');
 b.find(r=>r.kind==='sequence').last_value='10';
 const mode={mode:'production_snapshot_delta',snapshotId:'00000003-0000001B-1'};
 assert.equal(compareSnapshots(bytes(a),bytes(b)).equivalent,false);
 const result=compareSnapshots(bytes(a),bytes(b),mode);
 assert.equal(result.equivalent,true);assert.equal(result.sequence_state_differences.length,1);
 const mutations=[r=>r.find(t=>t.kind==='sequence').definition.increment='2',r=>r.find(t=>t.kind==='table').owner='OTHER',
 r=>r.find(t=>t.kind==='count').count='1'];
 for(const mutate of mutations){const changed=structuredClone(b);mutate(changed);assert.equal(compareSnapshots(bytes(a),bytes(changed),mode).equivalent,false);}
});
test('snapshot restore approval requires bound baseline and complete row hashes, independent of counts',()=>{
 const tsv=(rows,key)=>rows.map(detail=>['CAPTURA','METADATO',JSON.stringify(detail)].join('\t')).join('\n')+'\n'+key+'\tSI\t{}\n';
 const a=tsv(structure('artecnologia'),'ORIGEN_APTO'),b=tsv(structure('calidad'),'CAPTURA_RESTORE_APTA');
 const base=bytes(fixture('artecnologia')),target=bytes(fixture('calidad'));
 const snapshot={status:'COMPLETE',strategy:'SNAPSHOT_CON_DELTA',snapshot_id:'00000003-0000001B-1',baseline_sha256:sha(a),delta_baseline_sha256:sha(base),backup_sha256:sha('archive')};
 const archiveSequences={snapshot_id:snapshot.snapshot_id,backup_sha256:snapshot.backup_sha256,sequences:[{name:'public.test_seq',last_value:'1',is_called:false}]};
 assert.throws(()=>validateRestore(a,b,{snapshot}),/ROW_HASH_CAPTURES_REQUIRED/);
 assert.equal(validateRestore(a,b,{snapshot,rowBaseline:base,rowDestination:target,archiveSequences}).RESTORE_VALIDADO,'SI');
 const changed=bytes(fixture('calidad',[['1',{x:'unexpected'}]]));
 assert.equal(validateRestore(a,b,{snapshot,rowBaseline:base,rowDestination:changed,archiveSequences}).RESTORE_VALIDADO,'NO');
 assert.equal(validateRestore(a,b,{snapshot,rowBaseline:base,rowDestination:target,
   archiveSequences:{...archiveSequences,sequences:[{name:'public.test_seq',last_value:'500',is_called:false}]}}).RESTORE_VALIDADO,'NO');
 assert.throws(()=>validateRestore(a,b,{snapshot:{...snapshot,baseline_sha256:sha('wrong')},rowBaseline:base,rowDestination:target}),/HASH_MISMATCH/);
});
test('archive sequence parser requires every state exactly once, preserving BIGINT/is_called without executing SQL',()=>{
 const sql="-- native archive metadata\nSELECT pg_catalog.setval('public.a_seq', 9007199254740993, true);";
 assert.deepEqual(parseArchiveSequences(sql,['public.a_seq']),[{name:'public.a_seq',last_value:'9007199254740993',is_called:true}]);
 assert.throws(()=>parseArchiveSequences(sql,['public.other_seq']),/SCOPE/);
 assert.throws(()=>parseArchiveSequences(sql+sql,['public.a_seq']),/SCOPE/);
 assert.throws(()=>parseArchiveSequences('', ['public.a_seq']),/INCOMPLETE/);
});
test('wrong source identity rejects snapshot before callback and releases transaction',async()=>{
 const queries=[];let called=false;
 const client={async query(sql){queries.push(sql);return {rows:[{database:'calidad',version_num:160015}]};}};
 await assert.rejects(withExportedSnapshot(client,async()=>{called=true;}),/SOURCE_IDENTITY_MISMATCH/);
 assert.equal(called,false);assert.equal(queries.at(-1),'ROLLBACK');
});
