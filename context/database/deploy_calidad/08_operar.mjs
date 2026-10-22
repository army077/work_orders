// Explicit CLI only. Importing this module performs no I/O against PostgreSQL.
import { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { compareSnapshots, parseSnapshot } from '../transfer_calidad/compare_snapshots.mjs';
import { prepareDumpArgs } from '../transfer_calidad/prepare_dump_args.mjs';
import { core, historical } from '../transfer_calidad/manifest.mjs';
import { artifacts, assertTarget, identitySql } from '../migrations/prod/logistica_prod_support.js';
import { applyMigration } from '../migrations/prod/apply_logistica_migration_prod.js';
import { withExportedSnapshot } from '../transfer_calidad/live_snapshot.mjs';
import { compareDelta } from '../transfer_calidad/compare_delta.mjs';
import { statements } from './build_package.mjs';
import { parseArchiveSequences,archiveSequenceDifferences } from '../transfer_calidad/archive_sequences.mjs';

const check=(value,code)=>{if(!value) throw new Error(code);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function hashFile(path) {
  const digest=createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
const sqlPath=name=>fileURLToPath(new URL(name,import.meta.url));
export function parseReport(text) {
  return text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line=>{
    const columns=line.split('\t');
    // The first SELECT is the integer identity guard; no credentials in its output.
    if(columns.length===1 && columns[0]==='1') return null;
    check(columns.length===3,'REPORT_FORMAT');
    return {check:columns[0],status:columns[1],detail:JSON.parse(columns[2])};
  }).filter(Boolean);
}
export function extractCapture(report,database) {
  const rows=report.filter(r=>r.check==='CAPTURA').map(r=>r.detail);
  const data=rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
  parseSnapshot(data,database);
  check(rows.find(r=>r.kind==='scope').tables.every(t=>t.selected===core.includes(t.name)),'FIXED_SCOPE_REQUIRED');
  return data;
}
export function validateRestore(source,destination,{snapshot,rowBaseline,rowDestination,archiveSequences}={}) {
  const a=parseReport(source), b=parseReport(destination);
  check(a.find(r=>r.check==='ORIGEN_APTO')?.status==='SI','ORIGIN_NOT_READY');
  check(b.find(r=>r.check==='CAPTURA_RESTORE_APTA')?.status==='SI','RESTORE_CAPTURE_NOT_READY');
  if(snapshot) check(snapshot.status==='COMPLETE' && snapshot.strategy==='SNAPSHOT_CON_DELTA','SNAPSHOT_NOT_COMPLETE');
  const result=compareSnapshots(extractCapture(a,'artecnologia'),extractCapture(b,'calidad'),snapshot?
    {mode:'production_snapshot_delta',snapshotId:snapshot.snapshot_id}:undefined);
  const ok=result.equivalent && result.warnings.length===0;
  if(snapshot) {
    check(typeof rowBaseline==='string' && typeof rowDestination==='string','ROW_HASH_CAPTURES_REQUIRED');
    check(snapshot.baseline_sha256===hash(source) && snapshot.delta_baseline_sha256===hash(rowBaseline),'SNAPSHOT_CAPTURE_HASH_MISMATCH');
    const rows=compareDelta(rowBaseline,rowDestination);
    const sequences=report=>report.filter(r=>r.check==='CAPTURA'&&r.detail.kind==='sequence').map(r=>r.detail);
    const sequenceDifferences=archiveSequenceDifferences(sequences(b),archiveSequences,snapshot,sequences(a).map(r=>r.name));
    return {RESTORE_VALIDADO:ok && rows.status==='SIN_DIFERENCIAS_OBSERVADAS' && !sequenceDifferences.length?'SI':'NO',...result,
      archive_sequence_differences:sequenceDifferences,
      row_hash_validation:rows.status,row_review:rows.review,row_differences:rows.differences,snapshot_id:snapshot.snapshot_id};
  }
  return {RESTORE_VALIDADO:ok?'SI':'NO',...result,scope:'LEGACY_STRICT_STRUCTURE_AND_COUNTS'};
}
export function selectToc(toc,report) {
  const snapshot=extractCapture(report,'artecnologia');
  check(report.find(r=>r.check==='ORIGEN_APTO')?.status==='SI','ORIGIN_NOT_READY');
  const plan=prepareDumpArgs(snapshot);
  const rows=[...parseSnapshot(snapshot,'artecnologia').values()];
  const objects=new Set(report.filter(r=>['OBJETO_TOC','FUNCION_TOC'].includes(r.check))
    .map(r=>`${r.detail.catalog} ${r.detail.oid}`));
  check(objects.size>=core.length+3,'TOC_METADATA_MISSING');
  const relations=new Set(plan.tables_and_sequences.map(n=>n.slice('public.'.length)));
  const signatures=new Set(rows.filter(r=>r.kind==='function').map(r=>r.name.slice('public.'.length).replaceAll(/\s/g,'')));
  const selected=[], tables=new Set(), functions=new Set(), data=new Set(), sequenceSets=new Set();
  const sequenceNames=rows.filter(r=>r.kind==='sequence').map(r=>r.name);
  for(const line of toc.split(/\r?\n/)) {
    if(!line || line.startsWith(';')) continue;
    const m=line.match(/^\d+; (\d+) (\d+) (.+)$/);
    check(m,'TOC_FORMAT');
    const description=m[3];
    let allowed=objects.has(`${m[1]} ${m[2]}`);
    // Entries with synthetic OIDs must match an approved object, never a substring.
    const aux=description.match(/^(TABLE DATA|SEQUENCE SET|SEQUENCE OWNED BY) public ([a-z_][a-z0-9_]*) \S+$/);
    if(aux) allowed=relations.has(aux[2]);
    if(aux?.[1]==='SEQUENCE SET') allowed=sequenceNames.includes('public.'+aux[2]);
    const acl=description.match(/^ACL public (TABLE|SEQUENCE|COLUMN|FUNCTION) (.+) \S+$/);
    if(acl) {
      const identity=acl[2].replaceAll(/\s/g,'');
      allowed=acl[1]==='FUNCTION' ? signatures.has(identity) :
        acl[1]==='COLUMN' ? [...relations].some(n=>identity.startsWith(n+'.')) : relations.has(identity);
    }
    if(!allowed) continue;
    check(!/^(DATABASE|SCHEMA|EXTENSION|EVENT TRIGGER|BLOB|FOREIGN TABLE|MATERIALIZED VIEW) /.test(description),'UNSUPPORTED_TOC_ENTRY');
    // Comments/security labels are not required by the captured structural contract.
    if(/^(COMMENT|SECURITY LABEL) /.test(description)) continue;
    selected.push(line);
    if(aux?.[1]==='SEQUENCE SET') sequenceSets.add('public.'+aux[2]);
    const table=description.match(/^TABLE public (\S+) \S+$/); if(table) tables.add('public.'+table[1]);
    const tableData=description.match(/^TABLE DATA public (\S+) \S+$/); if(tableData) data.add('public.'+tableData[1]);
    const fn=description.match(/^FUNCTION public (.+) \S+$/); if(fn) functions.add(fn[1].replaceAll(/\s/g,''));
  }
  check(core.every(n=>tables.has(n)&&data.has(n)) && tables.size===core.length,'TOC_TABLES_OR_DATA_INCOMPLETE');
  check([...signatures].every(n=>functions.has(n)) && functions.size===signatures.size,'TOC_FUNCTIONS_INCOMPLETE');
  check(sequenceNames.every(n=>sequenceSets.has(n))&&sequenceNames.length===sequenceSets.size,'TOC_SEQUENCE_STATES_INCOMPLETE');
  check(historical.every(n=>!tables.has(n)),'HISTORICAL_NOT_APPROVED');
  return selected.join('\n')+'\n';
}
function native(tool,args,{database,readonly=true}={}) {
  const env={...process.env,PGDATABASE:database,PGAPPNAME:'deploy_calidad_controlled',
    PGOPTIONS:`-c default_transaction_read_only=${readonly?'on':'off'}`};
  // No shell, no CLI password, no echo of stderr (may contain server details).
  const result=spawnSync(tool,['--no-password',...args],{env,encoding:'utf8',maxBuffer:128*1024*1024});
  const state=result.stderr?.match(/\bERROR:\s+([0-9A-Z]{5})\b/)?.[1];
  check(!result.error && result.status===0,'NATIVE_OPERATION_FAILED_'+tool.toUpperCase()+(state?'_SQLSTATE_'+state:''));
  return result.stdout;
}
async function nativeAsync(tool,args,database) {
  await new Promise((resolve,reject)=>{
    const child=spawn(tool,['--no-password',...args],{env:{...process.env,PGDATABASE:database,
      PGAPPNAME:'deploy_calidad_snapshot',PGOPTIONS:'-c default_transaction_read_only=on'},stdio:['ignore','ignore','pipe']});
    // Never echo server messages, credentials or data.
    child.stderr.resume();
    child.once('error',()=>reject(new Error('BACKUP_PROCESS_FAILED')));
    child.once('close',code=>code===0?resolve():reject(new Error('BACKUP_PROCESS_FAILED')));
  });
}
export async function captureInSnapshot(client,sql) {
  const parsed=statements(sql);
  check(parsed[0]==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' && parsed.at(-1)==='ROLLBACK','CAPTURE_TRANSACTION_REQUIRED');
  let output='';
  for(const query of parsed.slice(1,-1)) {
    const result=await client.query(query);
    for(const row of result.rows??[]) {
      if(Object.hasOwn(row,'database_guard')) output+=String(row.database_guard)+'\n';
      else if(row.CHECK) output+=[row.CHECK,row.ESTADO,JSON.stringify(row.DETALLE)].join('\t')+'\n';
    }
  }
  return output;
}
function capture(name,database,path) {
  const text=native('psql',['-X','-q','-t','-A','-F','\t','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate',
    '--dbname='+database,'--file='+sqlPath(name)],{database});
  const report=parseReport(text);
  const identity=report.find(r=>r.check==='IDENTIDAD')?.detail;
  check(identity?.database===database && identity.current_user===process.env.PGUSER && /^16\./.test(identity.version),'CAPTURE_IDENTITY_MISMATCH');
  writeFileSync(path,text,{flag:'wx',mode:0o600}); return report;
}
function ready(report,key) { check(report.find(r=>r.check===key)?.status==='SI','NO_GO_'+key); }
function config() {
  for(const name of ['PGHOST','PGPORT','PGUSER','BACKUP_DIR']) check(process.env[name]?.trim(),'CONFIG_MISSING_'+name);
  check(/^\d+$/.test(process.env.PGPORT),'PORT_INVALID');
  // libpq and node-pg may use an existing protected passfile; never create or print it.
  check(process.env.PGPASSFILE || process.env.PGPASSWORD,'SECURE_CREDENTIAL_SOURCE_REQUIRED');
  check(!['workorders_test','local','test'].includes(process.env.PGUSER),'ADMIN_ROLE_REQUIRED');
  check(!process.env.PGSERVICE && !process.env.PGOPTIONS,'AMBIGUOUS_LIBPQ_SETTINGS');
}
export async function main(command) {
  check(['preflight','backup','export','restore','validate-restore','migrate','validate-final','delta'].includes(command),'COMMAND_INVALID');
  config();
  const dir=resolve(process.env.BACKUP_DIR), p=name=>resolve(dir,name);
  mkdirSync(dir,{recursive:true,mode:0o700});
  const read=name=>readFileSync(p(name),'utf8');
  const save=(name,value)=>writeFileSync(p(name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  if(command==='preflight') {
    ready(capture('01_preflight_artecnologia.sql','artecnologia',p('preflight_origen.tsv')),'ORIGEN_APTO');
    ready(capture('02_preflight_calidad.sql','calidad',p('preflight_destino.tsv')),'DESTINO_VACIO_Y_APTO');
    return;
  }
  if(command==='backup') {
    check(!existsSync(p('artecnologia_seguridad.dump')),'BACKUP_ALREADY_EXISTS');
    const require=createRequire(new URL('../../api10/package.json',import.meta.url));
    const {Client}=require('pg');
    const client=new Client({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,
      password:process.env.PGPASSWORD,database:'artecnologia',connectionTimeoutMillis:5000,application_name:'deploy_calidad_snapshot_keeper'});
    const startedAt=new Date().toISOString();
    let snapshot;
    try {
      await client.connect();
      client.on('error',()=>{}); // No raw connection messages; awaited operations still fail closed.
      snapshot=await withExportedSnapshot(client,async meta=>{
        save('snapshot_started.json',{...meta,status:'STARTED',client_started_at:startedAt});
        const baseline=await captureInSnapshot(client,readFileSync(sqlPath('01_preflight_artecnologia.sql'),'utf8'));
        ready(parseReport(baseline),'ORIGEN_APTO');
        writeFileSync(p('origen_definitivo.tsv'),baseline,{flag:'wx',mode:0o600});
        const deltaSql=readFileSync(new URL('../transfer_calidad/capture_delta_artecnologia.sql',import.meta.url),'utf8');
        writeFileSync(p('delta_baseline.tsv'),await captureInSnapshot(client,deltaSql),{flag:'wx',mode:0o600});
        await nativeAsync('pg_dump',['--format=custom','--snapshot='+meta.snapshot_id,'--dbname=artecnologia',
          '--file='+p('artecnologia_seguridad.dump')],'artecnologia');
        return {...meta,status:'COMPLETE',client_started_at:startedAt,completed_at:new Date().toISOString(),
          backup:'artecnologia_seguridad.dump',backup_sha256:await hashFile(p('artecnologia_seguridad.dump')),
          baseline_sha256:hash(baseline),delta_baseline_sha256:await hashFile(p('delta_baseline.tsv'))};
      });
    } finally { await client.end(); }
    const toc=native('pg_restore',['--list',p('artecnologia_seguridad.dump')],{database:'artecnologia'});
    writeFileSync(p('seguridad.toc'),toc,{flag:'wx',mode:0o600});
    save('snapshot.json',snapshot);
    save('backup_ok.json',{sha256:snapshot.backup_sha256,snapshot_id:snapshot.snapshot_id});
    return;
  }
  const backup=JSON.parse(read('backup_ok.json'));
  const snapshot=JSON.parse(read('snapshot.json'));
  check(snapshot.status==='COMPLETE' && snapshot.snapshot_id===backup.snapshot_id &&
    snapshot.backup_sha256===backup.sha256 && snapshot.baseline_sha256===hash(read('origen_definitivo.tsv')) &&
    snapshot.delta_baseline_sha256===await hashFile(p('delta_baseline.tsv')),'SNAPSHOT_RECEIPT_MISMATCH');
  check(await hashFile(p('artecnologia_seguridad.dump'))===backup.sha256,'BACKUP_CHANGED');
  if(command==='export') {
    const report=parseReport(read('origen_definitivo.tsv'));
    const selected=selectToc(read('seguridad.toc'),report);
    writeFileSync(p('selectivo.toc'),selected,{flag:'wx',mode:0o600});
    check(!existsSync(p('calidad_selectivo.sql')),'EXPORT_ALREADY_EXISTS');
    native('pg_restore',['--use-list='+p('selectivo.toc'),'--file='+p('calidad_selectivo.sql'),p('artecnologia_seguridad.dump')],{database:'artecnologia'});
    const sequenceToc=selected.split('\n').filter(line=>/; \d+ \d+ SEQUENCE SET /.test(line)).join('\n')+'\n';
    writeFileSync(p('sequence_states.toc'),sequenceToc,{flag:'wx',mode:0o600});
    native('pg_restore',['--use-list='+p('sequence_states.toc'),'--file='+p('sequence_states.sql'),p('artecnologia_seguridad.dump')],{database:'artecnologia'});
    const sequenceNames=[...parseSnapshot(extractCapture(report,'artecnologia'),'artecnologia').values()].filter(r=>r.kind==='sequence').map(r=>r.name);
    save('sequence_states.json',{snapshot_id:snapshot.snapshot_id,backup_sha256:backup.sha256,
      sequences:parseArchiveSequences(read('sequence_states.sql'),sequenceNames)});
    save('export_ok.json',{backup:backup.sha256,snapshot_id:snapshot.snapshot_id,toc:hash(selected),
      sequence_states_sha256:hash(read('sequence_states.json')),
      sql:await hashFile(p('calidad_selectivo.sql')),completed_at:new Date().toISOString()});
    return;
  }
  const exported=JSON.parse(read('export_ok.json'));
  check(exported.backup===backup.sha256 && exported.toc===hash(read('selectivo.toc')) &&
    exported.sequence_states_sha256===hash(read('sequence_states.json')),'EXPORT_CHANGED');
  if(command==='restore') {
    check(!existsSync(p('restore_started.json')),'RESTORE_ALREADY_ATTEMPTED_STOP');
    const dest=capture('02_preflight_calidad.sql','calidad',p('destino_inmediatamente_antes_restore.tsv'));
    ready(dest,'DESTINO_VACIO_Y_APTO');
    const source=parseReport(read('origen_definitivo.tsv')).find(r=>r.check==='CAPTURA'&&r.detail.kind==='identity').detail;
    const target=dest.find(r=>r.check==='IDENTIDAD').detail;
    check(source.address===target.address && source.port===target.port && source.user===target.current_user,'SOURCE_TARGET_SERVER_MISMATCH');
    save('restore_started.json',{destination:'calidad'});
    // Native archive order preserves interleaved functions/defaults/constraints.
    // One transaction: no --clean, --create, --disable-triggers, --no-owner or --no-acl.
    native('pg_restore',['--exit-on-error','--single-transaction','--dbname=calidad',
      '--use-list='+p('selectivo.toc'),p('artecnologia_seguridad.dump')],{database:'calidad',readonly:false});
    save('restore_completed.json',{backup:backup.sha256});
    return;
  }
  check(JSON.parse(read('restore_completed.json')).backup===backup.sha256,'RESTORE_NOT_COMPLETED');
  if(command==='validate-restore') {
    capture('03_validar_post_restore_calidad.sql','calidad',p('destino_post_restore.tsv'));
    const deltaText=native('psql',['-X','-q','-t','-A','-F','\t','-v','ON_ERROR_STOP=1','--dbname=calidad',
      '--file='+fileURLToPath(new URL('../transfer_calidad/capture_delta_calidad.sql',import.meta.url))],{database:'calidad'});
    writeFileSync(p('delta_destino_post_restore.tsv'),deltaText,{flag:'wx',mode:0o600});
    const result=validateRestore(read('origen_definitivo.tsv'),read('destino_post_restore.tsv'),{
      snapshot,rowBaseline:read('delta_baseline.tsv'),rowDestination:deltaText,archiveSequences:JSON.parse(read('sequence_states.json'))});
    save('restore_validado.json',result); check(result.RESTORE_VALIDADO==='SI','RESTORE_NOT_VALIDATED');
    console.log('RESTORE_VALIDADO = SI'); return;
  }
  check(JSON.parse(read('restore_validado.json')).RESTORE_VALIDADO==='SI','RESTORE_NOT_VALIDATED');
  if(command==='delta') {
    const started=new Date().toISOString(),id=started.replaceAll(/[^0-9TZ]/g,'');
    const collect=database=>native('psql',['-X','-q','-t','-A','-F','\t','-v','ON_ERROR_STOP=1',
      '--dbname='+database,'--file='+fileURLToPath(new URL('../transfer_calidad/capture_delta_'+database+'.sql',import.meta.url))],{database});
    const source=collect('artecnologia'),destination=collect('calidad');
    writeFileSync(p('delta_origen_'+id+'.tsv'),source,{flag:'wx',mode:0o600});
    writeFileSync(p('delta_destino_'+id+'.tsv'),destination,{flag:'wx',mode:0o600});
    const result=compareDelta(source,destination,read('delta_baseline.tsv'));
    save('delta_'+id+'.json',{...result,snapshot_id:snapshot.snapshot_id,started_at:started,completed_at:new Date().toISOString()});
    console.log(result.status+'; automatic_writes=false');
    if(result.review.length||result.differences.length) process.exitCode=2;
    return;
  }
  if(command==='migrate') {
    check(!existsSync(p('migrations_started.json')),'MIGRATIONS_ALREADY_ATTEMPTED_STOP');
    check(process.env.APP_ENV==='production' && process.env.PGDATABASE==='calidad','PRODUCTION_CALIDAD_ENV_REQUIRED');
    const require=createRequire(new URL('../../api10/package.json',import.meta.url));
    const {Client}=require('pg');
    const client=new Client({host:process.env.PGHOST,port:Number(process.env.PGPORT),user:process.env.PGUSER,
      password:process.env.PGPASSWORD,database:'calidad',connectionTimeoutMillis:5000,application_name:'deploy_calidad_migrations'});
    try {
      await client.connect();
      const identity=(await client.query(identitySql)).rows[0];
      // Compare the server identity captured on the empty destination, not an invented address.
      const origin=[...parseSnapshot(extractCapture(parseReport(read('origen_definitivo.tsv')),'artecnologia'),'artecnologia').values()].find(r=>r.kind==='identity');
      const target={user:process.env.PGUSER,address:origin.address,port:origin.port};
      await assertTarget(client,target);
      check(identity.port===Number(process.env.PGPORT),'PORT_IDENTITY_MISMATCH');
      save('migrations_started.json',{destination:'calidad'});
      for(const file of artifacts()) {
        const result=await applyMigration(client,target,file.name);
        save(file.name+'.result.json',result); // Success verified before submitting the next exact file.
        console.log(file.name+' = PASS');
      }
    } finally { await client.end(); }
    return;
  }
  const final=capture('04_validar_post_logistica_calidad.sql','calidad',p('destino_post_logistica.tsv'));
  ready(final,'LOGISTICA_SCHEMA_VALIDO');
  save('logistica_validada.json',{LOGISTICA_SCHEMA_VALIDO:'SI'});
  console.log('LOGISTICA_SCHEMA_VALIDO = SI');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main(process.argv.length===3?process.argv[2]:null).catch(error=>{
    const code=/^[A-Z0-9_]+$/.test(error.message||'')?error.message:
      /^[A-Z0-9_]+$/.test(error.code||'')?error.code:'OPERATION_NOT_CONFIRMED';
    console.error(JSON.stringify({status:'DETENERSE',code,
      action:'No continuar ni reintentar automaticamente; enviar metadatos a Codex.'}));
    process.exitCode=1;
  });
}
