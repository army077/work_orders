// Approved master-data input only. This module never connects to any service.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { baselineModel } from './build_clean_baseline.mjs';

export const masters=['machine_family','machine_model','maintenance_template','template_section','template_task','template_task_inspection','plantilla_tecnicos'];
export const sourcePath='sources/export_config_prod_20261023.json';
export const approvedSourceHash='47f5dddeb498f7b50ee61c7148f10bfa7635aaf773b12495134ffe8147349bd0';
export const sha256=value=>createHash('sha256').update(value).digest('hex');
const check=(ok,reason)=>{if(!ok)throw new Error(reason);};
const metadataColumns=['created_at','updated_at','created_by'];
export const sourceColumns=()=>Object.fromEntries(baselineModel().tables.filter(t=>masters.includes(t.name))
 .map(t=>[t.name,t.columns.filter(c=>!metadataColumns.includes(c.name))]));
export const testMarker=/(^|[^\p{L}\p{N}])(TEST([_ -]LOCAL)?|FIXTURE)([^\p{L}\p{N}]|$)/iu;

export function parseExport(text) {
 const data=JSON.parse(text.replace(/^\uFEFF/,''));
 // JSON.parse accepts duplicate keys. Reject them before any data can be lost.
 const stack=[];
 for(let i=0;i<text.length;i++) {
  const c=text[i];
  if(c==='{'||c==='['){stack.push(c==='{'?new Set():null);continue;}
  if(c==='}'||c===']'){stack.pop();continue;}
  if(c!=='"')continue;
  const start=i++;
  for(;i<text.length;i++){if(text[i]==='\\')i++;else if(text[i]==='"')break;}
  let next=i+1;while(/\s/.test(text[next]??'')&&next<text.length)next++;
  if(text[next]===':'&&stack.at(-1)) {
   const key=JSON.parse(text.slice(start,i+1)),keys=stack.at(-1);
   check(!keys.has(key),'DUPLICATE_JSON_KEY:'+key);keys.add(key);
  }
 }
 return data;
}
export function validateExport(data) {
 check(data&&data.source?.database==='artecnologia','SOURCE_DATABASE');
 check(/^16\./.test(data.source.postgresql)&&data.source.read_only==='on','SOURCE_ENVIRONMENT');
 check(Number.isFinite(Date.parse(data.source.captured_at)),'SOURCE_CAPTURE_TIME');
 check(data.logistica_authorized_users==='ALTA_MANUAL_REQUERIDA','MANUAL_LOGISTICS_REQUIRED');
 check(data.tables&&JSON.stringify(Object.keys(data.tables).sort())===JSON.stringify([...masters].sort()),'MASTER_SCOPE');
 const definitions=sourceColumns(),tables=data.tables,maps={};
 for(const name of masters) {
  const rows=tables[name],columns=definitions[name];
  check(Array.isArray(rows)&&rows.length>0,'MASTER_EMPTY:'+name);maps[name]=new Map();
  for(const row of rows) {
   check(row&&typeof row==='object'&&!Array.isArray(row),'ROW_OBJECT:'+name);
   check(JSON.stringify(Object.keys(row).sort())===JSON.stringify(columns.map(c=>c.name).sort()),'ROW_COLUMNS:'+name);
   check(Number.isSafeInteger(row.id)&&row.id>0&&row.id<2147483647,'MASTER_ID:'+name);
   check(!maps[name].has(row.id),'DUPLICATE_ID:'+name+':'+row.id);maps[name].set(row.id,row);
   check(!testMarker.test(JSON.stringify(row)),'TEST_MARKER:'+name+':'+row.id);
   for(const column of columns) {
    const value=row[column.name];
    if(value===null){check(!column.not_null,'NULL_REQUIRED:'+name+':'+row.id+':'+column.name);continue;}
    if(column.type==='integer')check(Number.isSafeInteger(value)&&value>=-2147483648&&value<=2147483647,'INTEGER_VALUE:'+name+':'+row.id+':'+column.name);
    else if(column.type==='boolean')check(typeof value==='boolean','BOOLEAN_VALUE:'+name+':'+row.id+':'+column.name);
    else if(column.type==='numeric')check(typeof value==='number'&&Number.isFinite(value),'NUMERIC_VALUE:'+name+':'+row.id+':'+column.name);
    else {
     check(typeof value==='string'&&!/[\u0000\uFFFD]/.test(value),'TEXT_VALUE:'+name+':'+row.id+':'+column.name);
     const limit=column.type.match(/character varying\((\d+)\)/)?.[1];
     check(!limit||Array.from(value).length<=Number(limit),'TEXT_LENGTH:'+name+':'+row.id+':'+column.name);
    }
   }
  }
 }
 const relations=[['machine_model','family_id','machine_family'],['maintenance_template','model_id','machine_model'],['template_section','template_id','maintenance_template'],['template_task','section_id','template_section'],['template_task_inspection','section_id','template_section']];
 for(const [child,key,parent] of relations)for(const row of tables[child])check(maps[parent].has(row[key]),'ORPHAN:'+child+':'+row.id+':'+key);
 const sections=maps.template_section,templates=maps.maintenance_template;
 for(const t of tables.maintenance_template) {
  check(t.is_published===true&&t.version>=1,'PUBLISHED_TEMPLATE:'+t.id);
  check(['MANTENIMIENTO','INSTALACION','DIAGNOSTICO','REPARACION','ENSAMBLE','INSPECCION'].includes(t.template_type),'TEMPLATE_TYPE:'+t.id);
 }
 for(const row of tables.template_task)check(templates.get(sections.get(row.section_id).template_id).template_type!=='INSPECCION','MIXED_TASK:'+row.id);
 for(const row of tables.template_task_inspection)check(templates.get(sections.get(row.section_id).template_id).template_type==='INSPECCION','MIXED_INSPECTION_POINT:'+row.id);
 for(const name of ['template_section','template_task','template_task_inspection']) {
  const unique=new Set();
  for(const row of tables[name]) {
   check(row.position>=1&&(row.expected_minutes??0)>=0,'POSITION_OR_MINUTES:'+name+':'+row.id);
   const key=JSON.stringify([row.template_id??row.section_id,row.position]);
   check(!unique.has(key),'DUPLICATE_POSITION:'+name+':'+row.id);unique.add(key);
  }
 }
 const modelNames=new Set();for(const row of tables.machine_model){const key=JSON.stringify([row.family_id,row.name]);check(!modelNames.has(key),'DUPLICATE_MODEL_NAME');modelNames.add(key);}
 for(const row of tables.plantilla_tecnicos)check(row.estatus.toLowerCase()==='activo'&&['Operador de producción','Supervisor de calidad'].includes(row.puesto),'TECHNICIAN_SELECTION:'+row.id);
 const audit=data.audit;
 check(Number.isSafeInteger(audit?.published_templates)&&audit.published_templates>=tables.maintenance_template.length,'PUBLISHED_COUNT');
 check(audit.candidate_templates===tables.maintenance_template.length&&audit.published_templates-audit.candidate_templates===audit.quarantined_or_missing_master_templates,'CANDIDATE_COUNT');
 check(audit.tasks_on_inspection_template===0&&audit.inspection_points_on_task_template===0,'MIXED_SOURCE_AUDIT');
 // The legacy status label is deliberately not a gate: the user accepted this export.
 return {data,tables,definitions,maps,counts:Object.fromEntries(masters.map(n=>[n,tables[n].length])),maxIds:Object.fromEntries(masters.map(n=>[n,Math.max(...tables[n].map(r=>r.id))])),total:masters.reduce((n,k)=>n+tables[k].length,0)};
}
export function loadApprovedSource() {
 const bytes=readFileSync(new URL(sourcePath,import.meta.url));
 check(sha256(bytes)===approvedSourceHash,'APPROVED_SOURCE_BYTES_CHANGED');
 return {...validateExport(parseExport(bytes.toString('utf8'))),hash:sha256(bytes)};
}
export function functionalFindings(tables) {
 const templates=tables.maintenance_template,sections=tables.template_section,tasks=tables.template_task,points=tables.template_task_inspection;
 const assembly=templates.filter(t=>t.template_type==='ENSAMBLE');
 const emptySections=sections.filter(s=>!(templates.find(t=>t.id===s.template_id).template_type==='INSPECCION'?points:tasks).some(a=>a.section_id===s.id));
 const missingInspection=assembly.filter(t=>!templates.some(i=>i.template_type==='INSPECCION'&&i.model_id===t.model_id));
 const missingCodes=assembly.map(t=>({template_id:t.id,missing:['LIB001','LIB002'].filter(code=>!tasks.some(a=>a.code===code&&sections.some(s=>s.id===a.section_id&&s.template_id===t.id)))})).filter(r=>r.missing.length);
 const blankBonus= tables.plantilla_tecnicos.filter(r=>!r.nombre_bonos.trim()).map(r=>r.id);
 const emailGroups=new Map();for(const r of tables.plantilla_tecnicos){const key=r.correo_tecnico.trim().toLowerCase();emailGroups.set(key,[...(emailGroups.get(key)??[]),r.id]);}
 return {empty_sections:emptySections.map(s=>({section_id:s.id,template_id:s.template_id})),assembly_without_inspection:missingInspection.map(t=>({template_id:t.id,model_id:t.model_id})),assembly_missing_release_codes:missingCodes,technicians_blank_bonus_name:blankBonus,duplicate_technician_email_ids:[...emailGroups.values()].filter(v=>v.length>1),ambiguous_trial_template_names:templates.filter(t=>/prueb/i.test(t.name)).map(t=>({id:t.id,name:t.name}))};
}
