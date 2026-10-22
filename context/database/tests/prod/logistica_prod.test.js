import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  NAMES,artifacts,states,sha256,verifyLedger,requireNextMigration,targetFromOptions,matchesTarget,
} from '../../migrations/prod/logistica_prod_support.js';
import {renderMigration} from './artifact_blueprint.js';
import {parseSnapshot,approvalFromOptions,validateRecords} from '../../importers/import_entregas_logistica_prod.js';
import {applyApprovedSnapshot,reconcileInTransaction} from '../../importers/apply_entregas_logistica_prod.js';
import {snapshotFixture} from './snapshot_fixture.js';
import {readOnlyPreflight} from '../../migrations/prod/preflight_logistica_prod.js';
import {applyMigration} from '../../migrations/prod/apply_logistica_migration_prod.js';
const code=expected=>e=>e.code===expected;
const files=artifacts(),expected=states();
const identity={database:'calidad',username:'approved_role',session_user:'approved_role',
  address:'192.0.2.10',port:5432,version_num:160015}; // RFC 5737, no destino real.
const target={user:'approved_role',address:'192.0.2.10',port:5432};

test('runner PROD ejecuta exactamente los bytes cuyo SHA registra, sin transformar SQL',async()=>{
  let applied=false,submitted=0;
  const client={async query(sql){
    if(sql===files[0].sql){
      assert.ok(Buffer.from(sql,'utf8').equals(readFileSync(new URL('../../migrations/prod/'+files[0].name,import.meta.url))));
      assert.equal(sha256(Buffer.from(sql)),files[0].sha256);
      submitted++;applied=true;return [{command:'COMMIT'}];
    }
    if(sql.startsWith('WITH settings'))return {rows:[{fingerprint:expected[applied?1:0].fingerprint,
      shape:{tables:Object.fromEntries(Object.keys(expected[0].columns).map(name=>[name,
        expected[applied?1:0].columns[name]===null?null:{columns:expected[applied?1:0].columns[name]}]))}}]};
    if(sql.startsWith('SELECT migration_name'))return {rows:[{migration_name:files[0].name,migration_sha256:files[0].sha256}]};
    return {rows:[]};
  }};
  assert.equal((await applyMigration(client,target,files[0].name)).applied,true);
  assert.equal(submitted,1);
});

test('siete SQL reproducibles, hashes de bytes exactos y DDL separado de LOCAL',()=>{
  assert.equal(files.length,7);assert.equal(expected.length,8);
  files.forEach((f,i)=>{
    assert.equal(f.sql,renderMigration(f.name,i,expected,files.slice(0,i)));
    assert.equal(f.sha256,sha256(Buffer.from(f.sql)));
    assert.equal(f.sha256,sha256(readFileSync(new URL('../../migrations/prod/'+f.name,import.meta.url))));
    assert.match(f.sql,/BEGIN;/);assert.match(f.sql,/COMMIT;\s*$/);
    assert.ok(f.sql.indexOf('PROD_IDENTITY_OR_APPROVAL_REQUIRED')<f.sql.indexOf('-- BEGIN LOGISTICA DDL'));
    assert.match(f.sql,/current_database\(\) IS DISTINCT FROM 'calidad'/);
    assert.match(f.sql,/inet_server_addr/);assert.match(f.sql,/session_user/);
    assert.match(f.sql,/LOGISTICA_SCHEMA_DRIFT/);assert.doesNotMatch(f.sql,/IF NOT EXISTS/i);
  });
});
test('orden exige prefijo exacto, checksum conocido, sin saltos ni nombres desconocidos',()=>{
  const ledger=files.map(f=>({migration_name:f.name,migration_sha256:f.sha256}));
  for(let i=0;i<=7;i++) assert.equal(verifyLedger(ledger.slice(0,i)),i);
  assert.throws(()=>verifyLedger(ledger.slice(1,2)),code('MIGRATION_CHECKSUM_OR_ORDER_MISMATCH'));
  assert.throws(()=>verifyLedger([{...ledger[0],migration_sha256:'0'.repeat(64)}]),code('MIGRATION_CHECKSUM_OR_ORDER_MISMATCH'));
  assert.throws(()=>verifyLedger([ledger[0],ledger[0]]),code('DUPLICATE_MIGRATION'));
});
test('rerun conocido aborta; drift aborta incluso cuando figura aplicado',()=>{
  assert.equal(requireNextMigration({drift:false,stage:0},NAMES[0]).name,NAMES[0]);
  assert.throws(()=>requireNextMigration({drift:false,stage:0},NAMES[1]),code('MIGRATION_ORDER_REQUIRED'));
  assert.throws(()=>requireNextMigration({drift:false,stage:7},NAMES[0]),code('MIGRATION_ALREADY_REGISTERED'));
  assert.throws(()=>requireNextMigration({drift:true,stage:7},NAMES[0]),code('LOGISTICA_SCHEMA_DRIFT'));
});
test('guard requiere entorno y confirmacion operacional completos, no solo nombre DB',()=>{
  const env={APP_ENV:'production',PGDATABASE:'calidad',PGHOST:'example.invalid',PGPORT:'5432',PGUSER:target.user,PGPASSWORD:'TEST_ONLY_NOT_A_SECRET'};
  const opts={'--expected-user':target.user,'--expected-server-address':target.address,'--expected-server-port':'5432','--confirm-production':'calidad'};
  assert.deepEqual(targetFromOptions(opts,env),target);
  assert.throws(()=>targetFromOptions({...opts,'--expected-server-address':''},env),code('EXPECTED_SERVER_ADDRESS_REQUIRED'));
  assert.throws(()=>targetFromOptions(opts,{...env,APP_ENV:'local'}),code('PROD_ENV_REQUIRED'));
  for(const database of ['artecnologia','artecnologia_test_local','calidad_test_local','artecnologia_test'])
    assert.throws(()=>targetFromOptions(opts,{...env,PGDATABASE:database}),code('PROD_ENV_REQUIRED'));
  assert.throws(()=>targetFromOptions({...opts,'--confirm-production':'artecnologia'},env),code('PROD_CONFIRMATION_REQUIRED'));
  assert.equal(matchesTarget(identity,target),true);
  for(const change of [{database:'artecnologia'},{database:'calidad_test_local'},{database:'artecnologia_test_local'},{address:'127.0.0.1'},{username:'workorders_test'},{port:5433},{version_num:170001},{session_user:'other'}])
    assert.equal(matchesTarget({...identity,...change},target),false);
});
test('SHA aprobado invalido rechaza antes de interpretar XLSX',()=>{
  const f=snapshotFixture();
  assert.throws(()=>parseSnapshot(Buffer.from('not an xlsx'),f.approval),code('UNAUTHORIZED_SNAPSHOT'));
});
test('conteo aprobado distinto rechaza',()=>{
  const f=snapshotFixture();assert.throws(()=>parseSnapshot(f.bytes,{...f.approval,count:4}),code('WRONG_ROW_COUNT'));
});
test('hoja aprobada debe ser Entregas y debe existir literalmente',()=>{
  const f=snapshotFixture();
  assert.throws(()=>parseSnapshot(f.bytes,{...f.approval,sheet:'Otra'}),code('APPROVED_SHEET_REQUIRED'));
  const other=snapshotFixture({sheet:'Otra'});
  assert.throws(()=>parseSnapshot(other.bytes,other.approval),code('MISSING_APPROVED_SHEET'));
});
test('aprobaciones no tienen SHA ni conteo por defecto',()=>{
  assert.throws(()=>approvalFromOptions({'--input':'C:\\approved\\final.xlsx','--sheet':'Entregas'}),code('APPROVED_COUNT_REQUIRED'));
  assert.throws(()=>approvalFromOptions({'--input':'C:\\approved\\final.xlsx','--sheet':'Entregas','--expected-count':'3'}),code('APPROVED_SHA_REQUIRED'));
  assert.throws(()=>approvalFromOptions({'--input':'relative.xlsx'}),code('ABSOLUTE_LOCAL_XLSX_REQUIRED'));
  assert.throws(()=>approvalFromOptions({'--input':'\\\\remote\\final.xlsx'}),code('ABSOLUTE_LOCAL_XLSX_REQUIRED'));
});
test('preserva pedidos 0/1/largos, nulos, hora textual y anomalias sin UTC',()=>{
  const f=snapshotFixture(),parsed=parseSnapshot(f.bytes,f.approval),r=parsed.records;
  assert.deepEqual(r.map(x=>x.pedido),['0','1','123456789012345678901234567890']);
  assert.equal(r[0].local_datetime,'2025-01-01T13:02:03');
  assert.equal(r[1].local_datetime,'2025-01-02T12:00:00');
  assert.equal(r[2].local_datetime,null);assert.equal(r[2].correo,null);assert.equal(r[2].drive_folder_id,null);
  assert.equal(r[0].legacy_image_count,17);assert.equal(r[0].observaciones,'831');
  assert.equal(r[0].ubicacion,'undefined');assert.equal(r[0].drive_folder_id,'TEST_ONLY_A');
  assert.ok(r[0].warnings.some(w=>w.code==='NUMERIC_OBSERVATION'));
  assert.ok(r[1].warnings.some(w=>w.code==='LOCATION_COORDINATES_MISMATCH'));
  assert.equal('authorized_user_id' in r[0],false);assert.equal('status' in r[0],false);
  assert.equal('photo_count' in r[0],false);assert.equal('client_request_id' in r[0],false);
  assert.deepEqual(parsed,parseSnapshot(f.bytes,f.approval));
});
test('mutacion de contenido normalizado se rechaza antes de SQL',()=>{
  const f=snapshotFixture(),parsed=parseSnapshot(f.bytes,f.approval);
  parsed.records[0].pedido='CHANGED';
  assert.throws(()=>validateRecords(parsed.records,parsed.approval),code('RECORD_CHANGED_AFTER_NORMALIZATION'));
});
test('scope diferente aborta antes de INSERT',async()=>{
  const f=snapshotFixture(),parsed=parseSnapshot(f.bytes,f.approval),queries=[];
  const client={async query(sql){queries.push(sql);return {rows:sql.startsWith('SELECT')?[{record:{...parsed.records[0],source_snapshot_sha256:'0'.repeat(64)}}]:[]};}};
  await assert.rejects(()=>reconcileInTransaction(client,parsed),code('DIFFERENT_LEGACY_SNAPSHOT_SCOPE'));
  assert.equal(queries.some(q=>q.startsWith('INSERT')),false);
});
test('CLI apply rechaza LOCAL antes de BEGIN o cualquier escritura',async()=>{
  const f=snapshotFixture(),parsed=parseSnapshot(f.bytes,f.approval),queries=[];
  const client={async query(sql){queries.push(sql);return {rows:[{...identity,database:'artecnologia_test_local'}]};}};
  await assert.rejects(()=>applyApprovedSnapshot(client,target,parsed),code('PROD_IDENTITY_MISMATCH'));
  assert.equal(queries.length,1);assert.match(queries[0],/^SELECT /);
});
test('preflight solo usa SELECT/SET LOCAL dentro de READ ONLY y siempre ROLLBACK',async()=>{
  const queries=[];
  const shape={tables:Object.fromEntries(['logistica_authorized_users','logistica_deliveries','logistica_delivery_evidence','entregas_logistica_legacy','logistica_legacy_owner_mapping','logistica_schema_migrations'].map(n=>[n,null]))};
  const client={async query(sql){queries.push(sql);
    if(sql.includes('current_database()'))return {rows:[identity]};
    if(sql.startsWith('WITH settings'))return {rows:[{fingerprint:expected[0].fingerprint,shape}]};
    return {rows:[]};
  }};
  const report=await readOnlyPreflight(client,target);
  assert.equal(report.go,true);assert.equal(report.migrations.length,0);
  assert.equal(queries[0],'BEGIN READ ONLY');assert.equal(queries.at(-1),'ROLLBACK');
  assert.ok(queries.every(q=>/^(BEGIN READ ONLY|ROLLBACK|SET LOCAL|SELECT |WITH settings)/.test(q)));
  assert.ok(queries.every(q=>!/(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|nextval|set_config)\b/i.test(q)));
});
