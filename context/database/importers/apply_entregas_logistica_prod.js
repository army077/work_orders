import {randomUUID} from 'node:crypto';
import {COLUMNS,classifyRecords} from './apply_entregas_logistica_legacy_local.js';
import {approvalFromOptions,loadApprovedSnapshot,validateRecords} from './import_entregas_logistica_prod.js';
import {
  TARGET_ARGS,options,targetFromOptions,connectProduction,assertTarget,inspectSchema,
  invariant,isMain,safeFailure,
} from '../migrations/prod/logistica_prod_support.js';

const TABLE='public.entregas_logistica_legacy';
const recordsSQL="SELECT to_jsonb(t)-'id'-'imported_at'-'import_batch_id' AS record FROM "+TABLE+' t ORDER BY source_row';
const insertSQL='INSERT INTO '+TABLE+' ('+COLUMNS.join(',')+') VALUES ('
  +COLUMNS.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING legacy_key';

// Nucleo transaccional probado con tablas temporales. El CLI exige guard PROD,
// esquema exacto y ledger completo antes de invocarlo. No hace COMMIT propio.
export async function reconcileInTransaction(client,parsed) {
  const {records,approval}=parsed;
  validateRecords(records,approval);
  await client.query('LOCK TABLE '+TABLE+' IN SHARE ROW EXCLUSIVE MODE');
  const existing=(await client.query(recordsSQL)).rows.map(r=>r.record);
  invariant(existing.every(r=>r.source_snapshot_sha256===approval.sha256
    &&r.source_sheet===approval.sheet),'DIFFERENT_LEGACY_SNAPSHOT_SCOPE');
  const classified=classifyRecords(records,existing);
  const batch=randomUUID();
  for(const record of classified.newRecords) {
    const values=COLUMNS.map(c=>c==='import_batch_id'?batch
      :['raw_payload','warnings'].includes(c)?JSON.stringify(record[c]):record[c]);
    invariant((await client.query(insertSQL,values)).rowCount===1,'INSERT_NOT_CONFIRMED');
  }
  const after=classifyRecords(records,(await client.query(recordsSQL)).rows.map(r=>r.record));
  invariant(after.matched===approval.count&&after.newRecords.length===0,'POST_IMPORT_VERIFICATION_FAILED');
  const anomalies={};
  for(const record of records) for(const warning of record.warnings)
    (anomalies[warning.code]??=[]).push(record.source_row);
  return {inserted:classified.newRecords.length,matched:classified.matched,total:after.matched,anomalies,
    snapshot:approval.sha256,sheet:approval.sheet,import_batch_id:classified.newRecords.length?batch:null};
}
export async function applyApprovedSnapshot(client,target,parsed) {
  validateRecords(parsed.records,parsed.approval);
  await assertTarget(client,target);
  let commitPending=false;
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL search_path=pg_catalog');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await assertTarget(client,target);
    await client.query('SELECT pg_advisory_xact_lock(2026102101)');
    await client.query('LOCK TABLE '+TABLE+' IN SHARE ROW EXCLUSIVE MODE');
    const schema=await inspectSchema(client);
    invariant(!schema.drift&&schema.stage===7,'COMPLETE_APPROVED_SCHEMA_REQUIRED');
    const result=await reconcileInTransaction(client,parsed);
    commitPending=true;
    invariant((await client.query('COMMIT')).command==='COMMIT','COMMIT_NOT_CONFIRMED');
    commitPending=false;
    return result;
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    if(commitPending) throw Object.assign(new Error('IMPORT_COMMIT_UNCERTAIN'),{code:'IMPORT_COMMIT_UNCERTAIN'});
    throw error;
  }
}
async function main() {
  const opts=options(process.argv.slice(2),[...TARGET_ARGS,'--input','--approved-sha256','--sheet','--expected-count']);
  const target=targetFromOptions(opts);
  const {input,approval}=approvalFromOptions(opts);
  // Archivo, SHA, hoja y conteo se comprueban antes de abrir la conexion.
  const parsed=loadApprovedSnapshot(input,approval);
  const client=await connectProduction(target);
  try {console.log(JSON.stringify(await applyApprovedSnapshot(client,target,parsed)));}
  finally {await client.end();}
}
if(isMain(import.meta.url)) main().catch(safeFailure);
