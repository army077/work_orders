import test from 'node:test';
import assert from 'node:assert/strict';
import {
  artifacts,states,schemaState,inspectSchema,requireNextMigration,NAMES,
} from '../../migrations/prod/logistica_prod_support.js';
import {readOnlyPreflight} from '../../migrations/prod/preflight_logistica_prod.js';
import {connectTest,beginFixture,inSchema,protectedState} from './fixture.js';
import {parseSnapshot} from '../../importers/import_entregas_logistica_prod.js';
import {reconcileInTransaction} from '../../importers/apply_entregas_logistica_prod.js';
import {snapshotFixture} from './snapshot_fixture.js';
const enabled=process.env.RUN_LOGISTICA_PROD_ARTIFACT_TESTS==='1';
const files=artifacts(),expected=states();
const body=file=>file.sql.split('-- BEGIN LOGISTICA DDL\n')[1].split('-- END LOGISTICA DDL')[0];
const shapeGuards=file=>[...file.sql.matchAll(/DO \$shape\$[\s\S]*?\$shape\$;/g)].map(m=>m[0]);
const fixtureGuard=(sql,schema)=>sql.replace("'public'::text", "'"+schema+"'::text");
const errorCode=c=>e=>e.code===c;
async function applyFixtureStage(client,schema,i) {
  await client.query(inSchema(body(files[i]),schema));
  await client.query('INSERT INTO '+schema+'.logistica_schema_migrations(migration_name,migration_sha256) VALUES($1,$2)',[files[i].name,files[i].sha256]);
}
async function rollbackCase(client,fn) {
  await client.query('SAVEPOINT expected_failure');
  try {await fn();} finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    await client.query('RELEASE SAVEPOINT expected_failure');
  }
}
test('artefactos PROD en PostgreSQL LOCAL: fixtures temporales y rollback', {skip:!enabled},async t=>{
  const client=await connectTest(),before=await protectedState(client);
  try {
    for(const file of files) await t.test('guard rechaza LOCAL: '+file.name,async()=>{
      try {
        await assert.rejects(()=>client.query(file.sql),e=>e.code==='P0001'&&e.message==='PROD_IDENTITY_OR_APPROVAL_REQUIRED');
      } finally {await client.query('ROLLBACK');}
    });
    await t.test('orden, dependencias y huellas completas de las siete etapas',async()=>{
      const schema=await beginFixture(client);
      try {
        for(let stage=0;stage<=7;stage++) {
          if(stage) {
            const file=files[stage-1],guards=shapeGuards(file);
            assert.equal(guards.length,2);
            await client.query(fixtureGuard(guards[0],schema));
            const ledgerGuard=file.sql.match(/DO \$ledger\$[\s\S]*?\$ledger\$;/)[0];
            await client.query(inSchema(ledgerGuard,schema));
            await client.query(inSchema(body(file),schema));
            await client.query(fixtureGuard(guards[1],schema));
            await client.query('INSERT INTO '+schema+'.logistica_schema_migrations(migration_name,migration_sha256) VALUES($1,$2)',[file.name,file.sha256]);
          }
          const current=await inspectSchema(client,schema);
          assert.equal(current.fingerprint,expected[stage].fingerprint,'stage '+stage);
          assert.equal(current.drift,false);assert.equal(current.stage,stage);
          if(stage<7) {
            assert.equal(requireNextMigration(current,NAMES[stage]).name,NAMES[stage]);
            if(stage<6) assert.throws(()=>requireNextMigration(current,NAMES[stage+1]),errorCode('MIGRATION_ORDER_REQUIRED'));
          }
        }
        const current=await inspectSchema(client,schema);
        assert.throws(()=>requireNextMigration(current,NAMES[0]),errorCode('MIGRATION_ALREADY_REGISTERED'));
        assert.equal((await client.query('SELECT count(*)::int n FROM '+schema+'.logistica_legacy_owner_mapping')).rows[0].n,0);
      } finally {await client.query('ROLLBACK');}
    });
    await t.test('drift de columna, indice y ledger bloquean; no se reparan',async()=>{
      const schema=await beginFixture(client);
      try {
        for(let i=0;i<2;i++) await applyFixtureStage(client,schema,i);
        await rollbackCase(client,async()=>{
          await client.query('ALTER TABLE '+schema+'.logistica_deliveries ALTER COLUMN pedido TYPE varchar(100)');
          const current=await inspectSchema(client,schema);
          assert.equal(current.drift,true);assert.ok(current.columnConflicts.includes('logistica_deliveries'));
          assert.ok(current.conflictingColumns.some(c=>c.table==='logistica_deliveries'&&c.columns.includes('pedido')));
          assert.throws(()=>requireNextMigration(current,NAMES[2]),errorCode('LOGISTICA_SCHEMA_DRIFT'));
          await assert.rejects(()=>client.query(fixtureGuard(shapeGuards(files[2])[0],schema)),
            e=>e.code==='P0001'&&e.message==='LOGISTICA_SCHEMA_DRIFT_OR_ALREADY_APPLIED');
        });
        await rollbackCase(client,async()=>{
          await client.query('CREATE INDEX unexpected_drift ON '+schema+'.logistica_deliveries(chofer)');
          assert.equal((await inspectSchema(client,schema)).drift,true);
        });
        await rollbackCase(client,async()=>{
          await client.query('UPDATE '+schema+".logistica_schema_migrations SET migration_sha256=repeat('0',64) WHERE migration_name=$1",[NAMES[0]]);
          await assert.rejects(()=>inspectSchema(client,schema),errorCode('MIGRATION_CHECKSUM_OR_ORDER_MISMATCH'));
        });
        assert.equal((await inspectSchema(client,schema)).drift,false);
      } finally {await client.query('ROLLBACK');}
    });
    await t.test('extend evidence rechaza fila preexistente antes de ALTER',async()=>{
      const schema=await beginFixture(client);
      try {
        for(let i=0;i<2;i++)await applyFixtureStage(client,schema,i);
        const id=(await client.query('INSERT INTO '+schema+".logistica_authorized_users(firebase_project,firebase_uid) VALUES('logistica-ar','TEST_ONLY_NOT_REAL_FIREBASE') RETURNING id")).rows[0].id;
        const delivery=(await client.query('INSERT INTO '+schema+`.logistica_deliveries(client_request_id,authorized_user_id,firebase_project,firebase_uid,pedido,equipos,chofer)
          VALUES('00000000-0000-4000-8000-000000000001',$1,'logistica-ar','TEST_ONLY_NOT_REAL_FIREBASE','FIXTURE','FIXTURE','FIXTURE') RETURNING id`,[id])).rows[0].id;
        await client.query('INSERT INTO '+schema+".logistica_delivery_evidence(delivery_id,evidence_type,sequence_no) VALUES($1,'PHOTO',1)",[delivery]);
        await rollbackCase(client,async()=>{
          await assert.rejects(()=>client.query(inSchema(body(files[2]),schema)),e=>e.code==='P0001'&&e.message.includes('vacia'));
        });
        assert.equal((await schemaState(client,schema)).fingerprint,expected[2].fingerprint);
        assert.equal((await client.query('SELECT count(*)::int n FROM '+schema+'.logistica_delivery_evidence')).rows[0].n,1);
      } finally {await client.query('ROLLBACK');}
    });
    await t.test('importador mismo snapshot es idempotente; hash distinto y scope ajeno abortan',async()=>{
      const schema=await beginFixture(client);
      try {
        for(let i=0;i<6;i++) await applyFixtureStage(client,schema,i);
        const wrapper={query:(sql,args)=>client.query(inSchema(sql,schema),args)};
        const f=snapshotFixture(),parsed=parseSnapshot(f.bytes,f.approval);
        const first=await reconcileInTransaction(wrapper,parsed);
        assert.equal(first.inserted,3);assert.equal(first.matched,0);assert.equal(first.total,3);
        const metadataSQL='SELECT id::text,legacy_key,import_batch_id::text,imported_at::text FROM '+schema+'.entregas_logistica_legacy ORDER BY id';
        const original=(await client.query(metadataSQL)).rows;
        const second=await reconcileInTransaction(wrapper,parsed);
        assert.equal(second.inserted,0);assert.equal(second.matched,3);assert.equal(second.total,3);
        assert.deepEqual((await client.query(metadataSQL)).rows,original);
        const data=(await client.query('SELECT pedido,local_datetime::text,legacy_image_count,drive_folder_id FROM '+schema+'.entregas_logistica_legacy ORDER BY source_row')).rows;
        assert.deepEqual(data.map(r=>r.pedido),['0','1','123456789012345678901234567890']);
        assert.equal(data[0].local_datetime,'2025-01-01 13:02:03');assert.equal(data[0].legacy_image_count,17);
        await rollbackCase(client,async()=>{
          await client.query('UPDATE '+schema+".entregas_logistica_legacy SET content_hash=repeat('0',64) WHERE source_row=2");
          await assert.rejects(()=>reconcileInTransaction(wrapper,parsed),errorCode('LEGACY_CONTENT_CONFLICT'));
        });
        await rollbackCase(client,async()=>{
          await client.query('UPDATE '+schema+".entregas_logistica_legacy SET source_snapshot_sha256=repeat('0',64)");
          await assert.rejects(()=>reconcileInTransaction(wrapper,parsed),errorCode('DIFFERENT_LEGACY_SNAPSHOT_SCOPE'));
        });
        assert.deepEqual((await client.query(metadataSQL)).rows,original);
        for(const table of ['logistica_authorized_users','logistica_deliveries','logistica_delivery_evidence'])
          assert.equal((await client.query('SELECT count(*)::int n FROM '+schema+'.'+table)).rows[0].n,0);
      } finally {await client.query('ROLLBACK');}
    });
    await t.test('preflight real LOCAL solo lectura, reporta NO-GO sin cambiar filas',async()=>{
      const sql=[];
      const wrapper={async query(text,args){sql.push(text);return client.query(text,args);}};
      const report=await readOnlyPreflight(wrapper,{user:'not_local',address:'192.0.2.10',port:5432});
      assert.equal(report.database_correct,false);assert.equal(report.go,false);
      assert.equal(report.counts.entregas_logistica_legacy,before.entregas_logistica_legacy.count);
      assert.ok(sql.every(q=>/^(BEGIN READ ONLY|ROLLBACK|SET LOCAL|SELECT |WITH settings)/.test(q)));
      assert.equal(sql.at(-1),'ROLLBACK');
    });
    await t.test('tablas, datos y secuencias public protegidos permanecen exactos',async()=>{
      assert.deepEqual(await protectedState(client),before);
    });
  } finally {await client.query('ROLLBACK');await client.end();}
});
