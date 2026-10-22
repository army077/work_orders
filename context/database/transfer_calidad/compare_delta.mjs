// Offline, read-only file comparator. Never imports pg or executes corrective SQL.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { core } from './manifest.mjs';
const check=(ok,code)=>{if(!ok) throw new Error(code);};
const sha=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
export function parseDelta(text,database) {
 check(['artecnologia','calidad'].includes(database),'UNAPPROVED_DATABASE');
 const records=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(line=>{
   if(line==='1') return null;
   const fields=line.split('\t');
   if(fields.length===1) return JSON.parse(line);
   check(fields.length===3 && fields[0]==='DELTA' && fields[1]==='METADATO','DELTA_FORMAT');
   return JSON.parse(fields[2]);
 }).filter(Boolean);
 check(records.at(-1)?.kind==='delta_complete','DELTA_INCOMPLETE');
 const identities=records.filter(r=>r.kind==='delta_identity');
 check(identities.length===1 && identities[0].database===database && /^16\./.test(identities[0].version),'DELTA_IDENTITY');
 check(identities[0].canonical==='pg16-jsonb-v1-UTC-ISO','DELTA_CANONICAL_FORMAT');
 check(typeof identities[0].snapshot_visibility==='string' && identities[0].snapshot_visibility.length>0 &&
   Number.isFinite(Date.parse(identities[0].started_at)),'DELTA_CAPTURE_TIME_REQUIRED');
 const tables=new Map(),rows=new Map();
 for(const record of records) {
   check(['delta_identity','delta_table','delta_row','delta_complete'].includes(record.kind),'DELTA_UNKNOWN_RECORD');
   if(record.kind==='delta_table') {
     check(core.includes(record.name) && !tables.has(record.name),'DELTA_TABLE_SCOPE');
     check(typeof record.supported==='boolean' && sha(record.schema_sha256),'DELTA_TABLE_INVALID');
     if(record.supported) check(Array.isArray(record.pk_columns)&&record.pk_columns.length>0&&/^\d+$/.test(record.rows),'DELTA_PK_REQUIRED');
     tables.set(record.name,record);
   }
   if(record.kind==='delta_row') {
     check(core.includes(record.name) && sha(record.pk_sha256) && sha(record.row_sha256),'DELTA_ROW_INVALID');
     const key=record.name+':'+record.pk_sha256;
     check(!rows.has(key),'DELTA_DUPLICATE_PK');
     // Exposed PKs contain only numeric/UUID strings. Text PKs stay hashed.
     check(record.pk===null || record.pk && typeof record.pk==='object' && !Array.isArray(record.pk)
       && Object.values(record.pk).every(v=>typeof v==='string' && (/^-?\d+$/.test(v)||/^[a-fA-F0-9-]{36}$/.test(v))),'DELTA_PK_PRIVACY');
     rows.set(key,record);
   }
 }
 check(tables.size===core.length,'DELTA_TABLES_INCOMPLETE');
 const complete=records.at(-1);
 check(Number.isFinite(Date.parse(complete.completed_at)),'DELTA_CAPTURE_TIME_REQUIRED');
 check(records.filter(r=>r.kind==='delta_complete').length===1 && complete.tables===tables.size && complete.rows===rows.size,'DELTA_COUNTS_INCOMPLETE');
 for(const table of tables.values()) {
   const actual=[...rows.values()].filter(r=>r.name===table.name);
   check(table.supported ? String(actual.length)===table.rows : actual.length===0,'DELTA_ROWS_INCOMPLETE');
 }
 return {identity:{...identities[0],completed_at:complete.completed_at},tables,rows};
}
export function compareDelta(sourceBytes,destinationBytes,baselineBytes) {
 const source=parseDelta(sourceBytes,'artecnologia'),destination=parseDelta(destinationBytes,'calidad');
 const baseline=baselineBytes?parseDelta(baselineBytes,'artecnologia'):null;
 const review=[],differences=[];
 for(const name of core) {
   const a=source.tables.get(name),b=destination.tables.get(name),base=baseline?.tables.get(name);
   if(!a.supported || !b.supported || a.schema_sha256!==b.schema_sha256 || base && (!base.supported||base.schema_sha256!==a.schema_sha256)) {
     review.push({table:name,status:'NO_COMPARABLE_REQUIERE_REVISION'}); continue;
   }
   const keys=[...new Set([...source.rows.keys(),...destination.rows.keys()])].filter(key=>key.startsWith(name+':')).sort();
   for(const key of keys) {
     const left=source.rows.get(key),right=destination.rows.get(key),old=baseline?.rows.get(key);
     if(left&&right&&left.row_sha256===right.row_sha256) continue;
     differences.push({table:name,pk:(left||right).pk,pk_sha256:(left||right).pk_sha256,
       type:!right?'SOLO_ORIGEN':!left?'SOLO_DESTINO':'CONTENIDO_DISTINTO',
       source_changed_since_snapshot:baseline ? left ? !old||old.row_sha256!==left.row_sha256 : !!old : null,
       destination_changed_since_snapshot:baseline ? right ? !old||old.row_sha256!==right.row_sha256 : !!old : null});
   }
 }
 return {status:review.length?'REVISAR_TABLAS_NO_COMPARABLES':differences.length?'CONCILIACION_DELTA_PENDIENTE':'SIN_DIFERENCIAS_OBSERVADAS',
   automatic_reconciliation:false,automatic_writes:false,baseline_used:!!baseline,
   captures:{source:source.identity,destination:destination.identity,baseline:baseline?.identity??null},review,differences};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
   check(process.argv.length===4||process.argv.length===5,'USAGE_TWO_REPORTS_AND_OPTIONAL_BASELINE');
   const result=compareDelta(readFileSync(process.argv[2],'utf8'),readFileSync(process.argv[3],'utf8'),process.argv[4]?readFileSync(process.argv[4],'utf8'):undefined);
   console.log(JSON.stringify(result,null,2));
   if(result.review.length||result.differences.length) process.exitCode=2;
 } catch { console.error('DELTA = NO_VALIDADO; captura incompleta, insegura o incompatible.');process.exitCode=1; }
}
