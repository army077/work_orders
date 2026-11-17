// Offline authoring only. Never connects to PostgreSQL or runs generated SQL.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { core, logistics, rootFunctions } from '../transfer_calidad/manifest.mjs';
import { artifacts, states } from '../migrations/prod/logistica_prod_support.js';
import { extensionCatalog } from './build_package.mjs';
import { indexManifest,catalogIssues } from './semantic_catalog.mjs';
import { expressionGuard } from './semantic_expressions.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8').replaceAll('\r\n','\n');
const lit=value=>"'"+String(value).replaceAll("'","''")+"'";
const hash=value=>createHash('sha256').update(value).digest('hex');
const ensure=(condition,message)=>{if(!condition) throw new Error(message);};
// Split SQL respecting strings, quoted identifiers, dollar bodies, comments and
// nested parentheses. A separator inside a CHECK or function is never a boundary.
export function splitSQL(sql,separator=';') {
  const parts=[]; let start=0,depth=0,quote=null,dollar=null,comment=false;
  for(let i=0;i<sql.length;i++) {
    const c=sql[i],next=sql[i+1];
    if(comment) {if(c==='\n') comment=false;continue;}
    if(dollar) {if(sql.startsWith(dollar,i)){i+=dollar.length-1;dollar=null;}continue;}
    if(quote) {if(c===quote){if(next===quote)i++;else quote=null;}continue;}
    if(c==='-'&&next==='-'){comment=true;i++;continue;}
    if(c==="'"||c==='"'){quote=c;continue;}
    if(c==='$') {const m=sql.slice(i).match(/^\$[a-z_0-9]*\$/i);if(m){dollar=m[0];i+=dollar.length-1;continue;}}
    if(c==='(')depth++; if(c===')')depth--;
    if(c===separator&&(separator===';'||depth===0)){parts.push(sql.slice(start,i).trim());start=i+1;}
  }
  ensure(!quote&&!dollar&&depth===0,'UNTERMINATED_SQL');
  if(sql.slice(start).trim())parts.push(sql.slice(start).trim());
  return parts;
}
const uncomment=sql=>sql.replace(/--[^\n]*/g,'').trim();
export const normalized=sql=>sql.replace(/\s+/g,'').replaceAll('"','');
const names=sql=>sql.split(',').map(s=>s.trim().replaceAll('"',''));
const typeName=type=>({SERIAL:'integer',BIGSERIAL:'bigint',INTEGER:'integer',TEXT:'text',BOOLEAN:'boolean',NUMERIC:'numeric',JSONB:'jsonb',TIMESTAMPTZ:'timestamp with time zone',TIMESTAMP:'timestamp without time zone','DOUBLE PRECISION':'double precision',VARCHAR:'character varying'}[type]??type.replace(/^VARCHAR/i,'character varying').replace(/^NUMERIC/i,'numeric').toLowerCase());

export function columnModel(part) {
  const m=part.match(/^"?(\w+)"?\s+(DOUBLE PRECISION|TIMESTAMP WITHOUT TIME ZONE|\w+(?:\(\d+(?:,\d+)?\))?)([\s\S]*)$/i);
  ensure(m,'UNRECOGNIZED_COLUMN:'+part);
  const [,name,type,rest]=m, serial=/^(BIG)?SERIAL$/i.test(type);
  const def=rest.match(/\bDEFAULT\s+([\s\S]+?)(?=\s+(?:NOT NULL|PRIMARY KEY|UNIQUE|CONSTRAINT|REFERENCES)\b|$)/i)?.[1]?.trim()??null;
  return {name,type:typeName(type.toUpperCase()),not_null:serial||/NOT NULL|PRIMARY KEY/i.test(rest),
    serial,default:def,collation:rest.match(/COLLATE\s+"([^"]+)"/i)?.[1]??null};
}
function tableModel(name,parts) {
  const columns=parts.filter(p=>! /^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY)\b/i.test(p)).map(columnModel);
  const constraints=[];
  for(const column of columns) {
    const part=parts.find(p=>p.match(/^"?(\w+)"?/)?.[1]===column.name);
    if(/PRIMARY KEY/i.test(part))constraints.push({name:name+'_pkey',type:'p',columns:[column.name]});
    const check=part.match(/\bCHECK\s*(\([\s\S]+\))$/i);
    if(check)constraints.push({name:name+'_'+column.name+'_check',type:'c',columns:[],definition:'CHECK '+check[1]});
  }
  for(const part of parts.filter(p=>/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY)\b/i.test(p))) {
    const named=part.match(/^CONSTRAINT\s+"?(\w+)"?\s+([\s\S]+)$/i);
    const body=named?.[2]??part;
    const kind=body.match(/^(PRIMARY KEY|UNIQUE|FOREIGN KEY|CHECK)/i)?.[1];
    ensure(kind,'UNRECOGNIZED_CONSTRAINT:'+part);
    const columns=kind==='CHECK'?[]:names(body.match(/\(([^)]+)\)/)[1]);
    const constraint={name:named?.[1]??name+'_pkey',type:({'PRIMARY KEY':'p',UNIQUE:'u','FOREIGN KEY':'f',CHECK:'c'})[kind],columns};
    if(kind==='FOREIGN KEY') {
      const ref=body.match(/REFERENCES\s+(?:public\.)?"?(\w+)"?\s*\(([^)]+)\)/i);
      constraint.reference=ref[1];constraint.reference_columns=names(ref[2]);
      const action=key=>({'NO ACTION':'a',RESTRICT:'r',CASCADE:'c','SET NULL':'n','SET DEFAULT':'d'})[body.match(new RegExp('ON '+key+' (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)','i'))?.[1]??'NO ACTION'];
      constraint.update=action('UPDATE');constraint.delete=action('DELETE');
    }
    if(kind==='CHECK')constraint.definition=body;
    constraints.push(constraint);
  }
  return {name,parts,columns,constraints};
}
export function baselineModel() {
  const tables=new Map(),indexes=[],aux=[];
  for(const query of splitSQL(read('../create tables.sql'))) {
    const m=uncomment(query).match(/^CREATE TABLE "(\w+)"\s*\(([\s\S]*)\)$/);
    ensure(m,'UNRECOGNIZED_BASE_TABLE');
    const name=m[1],parts=[];
    for(let part of splitSQL(m[2],',')) {
      part=uncomment(part);
      const index=part.match(/^(UNIQUE )?INDEX "(\w+)"\s*\(([^)]+)\)$/);
      if(index) {
        if(index[1])parts.push(`CONSTRAINT ${index[2]} UNIQUE (${index[3]})`);
        else indexes.push(`CREATE INDEX ${index[2]} ON public.${name} (${index[3]})`);
      } else parts.push(part.replace(/REFERENCES "(\w+)"/g,'REFERENCES public."$1"'));
    }
    tables.set(name,parts);
  }
  ensure(JSON.stringify([...tables.keys()].sort())===JSON.stringify(core.map(n=>n.slice(7)).sort()),'BASE_MANIFEST_DRIFT');
  for(const file of artifacts()) {
    const body=file.sql.replaceAll('\r\n','\n').split('-- BEGIN LOGISTICA DDL')[1]?.split('-- END LOGISTICA DDL')[0];
    ensure(body,'MISSING_PROD_DDL:'+file.name);
    for(const statement of splitSQL(body)) {
      // Preserve function bodies byte-for-byte (their source is fingerprinted).
      const sql=statement.replace(/^(?:\s*--[^\n]*(?:\n|$))*/,'').trim();
      if(!sql)continue;
      const create=sql.match(/^CREATE TABLE public\.(\w+)\s*\(([\s\S]*)\)$/i);
      const alter=sql.match(/^ALTER TABLE public\.(\w+)\s+([\s\S]+)$/i);
      if(create)tables.set(create[1],splitSQL(create[2],',').map(uncomment));
      else if(alter) {
        for(const clause of splitSQL(alter[2],',')) {
          ensure(/^ADD (COLUMN|CONSTRAINT) /i.test(clause),'UNSUPPORTED_BASELINE_ALTER');
          tables.get(alter[1]).push(clause.replace(/^ADD COLUMN /i,'').replace(/^ADD CONSTRAINT /i,'CONSTRAINT '));
        }
      } else if(/^CREATE (UNIQUE )?INDEX /i.test(sql))indexes.push(sql);
      else if(/^(CREATE FUNCTION|CREATE TRIGGER|COMMENT ON) /i.test(sql))aux.push(sql);
      else ensure(/^(LOCK TABLE|DO \$\$)/.test(sql),'UNSUPPORTED_PROD_STATEMENT:'+sql.slice(0,80));
    }
  }
  ensure(JSON.stringify([...tables.keys()].filter(n=>!core.includes('public.'+n)).sort())===JSON.stringify(logistics.map(n=>n.slice(7)).sort()),'LOGISTICS_MANIFEST_DRIFT');
  const models=[...tables].map(([name,parts])=>tableModel(name,parts));
  const ordered=[];
  while(ordered.length<models.length) {
    const ready=models.filter(t=>!ordered.includes(t)&&t.constraints.filter(c=>c.type==='f').every(c=>ordered.some(t=>t.name===c.reference)));
    ensure(ready.length,'CYCLIC_FOREIGN_KEYS');ordered.push(...ready);
  }
  const bodies=[...read('../functions/functions.sql').matchAll(/--(move_\w+)\s*\$\$([\s\S]*?)\$\$/g)];
  ensure(bodies.length===rootFunctions.length,'MISSING_MOVE_BODIES');
  const functions=bodies.map(([,name,source])=>{
    const owner=name==='move_section'?'p_template_id':'p_section_id';
    let body=source.trim().replace(/\b(FROM|UPDATE) (?!public\.)(template_\w+)/g,'$1 public.$2');
    if(!body.endsWith(';'))body+=';';
    return {name,body,argnames:[owner,'p_id','p_newpos'],hash:hash(body),ddl:`CREATE FUNCTION public.${name}(${owner} integer, p_id integer, p_newpos integer)\nRETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER\nSET search_path = pg_catalog\nAS $move$${body}$move$`};
  });
  const base=ordered.filter(t=>core.includes('public.'+t.name));
  const baseIndexes=base.flatMap(t=>[
    ...t.constraints.filter(c=>['p','u'].includes(c.type)).map(c=>({name:c.name,table:t.name,definition:`CREATE UNIQUE INDEX ${c.name} ON public.${t.name} USING btree (${c.columns.join(', ')})`})),
    ...indexes.filter(sql=>sql.includes(`ON public.${t.name} `)).map(sql=>({name:sql.match(/INDEX (\w+)/)[1],table:t.name,definition:sql.replace(' (',' USING btree (')})),
  ]);
  const model={tables:ordered,indexes,aux,functions,base,baseIndexes,
    sequences:ordered.flatMap(t=>t.columns.filter(c=>c.serial).map(c=>({name:t.name+'_'+c.name+'_seq',table:t.name,column:c.name,type:c.type}))),
    files:artifacts().map(f=>({name:f.name,sha256:f.sha256})),logisticsFingerprint:states().at(-1).fingerprint};
  model.semanticIndexes=indexManifest(model);
  model.mappingFunctionHash=hash(aux.find(s=>s.startsWith('CREATE FUNCTION')).match(/AS \$\$([\s\S]+)\$\$$/)[1]);
  return model;
}

const userNamespace=`n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'`;
function inventoryCTEs() {
  const catalogs=[['pg_class','relnamespace','relname'],['pg_proc','pronamespace','proname'],['pg_type','typnamespace','typname'],['pg_collation','collnamespace','collname'],['pg_conversion','connamespace','conname'],['pg_operator','oprnamespace','oprname'],['pg_opclass','opcnamespace','opcname'],['pg_opfamily','opfnamespace','opfname']];
  return `${extensionCatalog}, objects AS (
${catalogs.map(([catalog,namespace,name])=>` SELECT '${catalog}'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.${name}::text AS name
 FROM ${catalog} o JOIN pg_namespace n ON n.oid=o.${namespace} WHERE ${userNamespace}`).join('\n UNION ALL\n')}
 UNION ALL SELECT 'pg_trigger'::regclass::oid,t.oid,n.nspname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND ${userNamespace}
 UNION ALL SELECT 'pg_namespace'::regclass::oid,n.oid,n.nspname,n.nspname FROM pg_namespace n WHERE ${userNamespace} AND n.nspname<>'public'
 UNION ALL SELECT 'pg_event_trigger'::regclass::oid,oid,'',evtname FROM pg_event_trigger
 UNION ALL SELECT 'pg_foreign_server'::regclass::oid,oid,'',srvname FROM pg_foreign_server
 UNION ALL SELECT 'pg_foreign_data_wrapper'::regclass::oid,oid,'',fdwname FROM pg_foreign_data_wrapper
 UNION ALL SELECT 'pg_publication'::regclass::oid,oid,'',pubname FROM pg_publication
 UNION ALL SELECT 'pg_subscription'::regclass::oid,oid,'',subname FROM pg_subscription WHERE subdbid=(SELECT oid FROM pg_database WHERE datname=current_database())
 UNION ALL SELECT 'pg_largeobject_metadata'::regclass::oid,oid,'',oid::text FROM pg_largeobject_metadata
), application_objects AS (
 SELECT o.* FROM objects o WHERE NOT EXISTS(SELECT FROM extension_infrastructure e WHERE e.classid=o.classid AND e.objid=o.objid)
)`;
}
function identityGuard() {
  return `DO $identity$ BEGIN
 IF current_database() IS DISTINCT FROM 'calidad' THEN RAISE EXCEPTION 'DATABASE_MUST_BE_CALIDAD'; END IF;
 IF current_setting('server_version_num')::int / 10000 <> 16 THEN RAISE EXCEPTION 'POSTGRESQL_16_REQUIRED'; END IF;
END; $identity$;`;
}
export function checksCTEs(model,{allowData=[],allowSequenceState=allowData}={}) {
  const emptyCheck=allowData.length
    ? `name NOT IN (${['logistica_schema_migrations',...allowData].map(lit).join(',')})`
    : `name<>'logistica_schema_migrations'`;
  const freshCheck=allowSequenceState.length?`s->>'table' NOT IN (${allowSequenceState.map(lit).join(',')}) AND (`:'';
  const expected={base:model.tables.map(t=>({name:t.name,columns:t.columns,constraints:t.constraints})),indexes:model.semanticIndexes,functions:model.functions.map(f=>({name:f.name,hash:f.hash,argnames:f.argnames})),sequences:model.sequences,ledger:model.files,
    mappingFunctionHash:model.mappingFunctionHash,triggers:[{name:'logistica_legacy_owner_mapping_row_guard',type:31},{name:'logistica_legacy_owner_mapping_truncate_guard',type:34}]};
  const expectedObjects=[
    ...model.tables.flatMap(t=>[['pg_class',t.name],['pg_type',t.name],['pg_type','_'+t.name]]),
    ...model.sequences.map(s=>['pg_class',s.name]),
    ...model.tables.flatMap(t=>t.constraints.filter(c=>['p','u'].includes(c.type)).map(c=>['pg_class',c.name])),
    ...model.indexes.map(sql=>['pg_class',sql.match(/INDEX (\w+)/)[1]]),
    ...model.functions.map(f=>['pg_proc',f.name]),['pg_proc','protect_logistica_legacy_owner_mapping'],
    ['pg_trigger','logistica_legacy_owner_mapping_row_guard'],['pg_trigger','logistica_legacy_owner_mapping_truncate_guard'],
  ];
  return `${inventoryCTEs()}, expected AS (SELECT ${lit(JSON.stringify(expected))}::jsonb AS value),
 expected_objects(catalog,name) AS (VALUES ${expectedObjects.map(([cat,name])=>`(${lit(cat)},${lit(name)})`).join(',')}),
 expected_tables(name) AS (VALUES ${model.tables.map(t=>`(${lit(t.name)})`).join(',')}),
 counts AS (
 SELECT e.name,c.oid,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,x.rows::bigint AS rows
 FROM expected_tables e LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||e.name)
 CROSS JOIN LATERAL XMLTABLE('/table/row' PASSING query_to_xml(
 CASE WHEN c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
 THEN format('SELECT count(*) AS rows FROM ONLY public.%I',e.name) ELSE 'SELECT NULL::bigint AS rows' END,
 false,false,'') COLUMNS rows text PATH 'rows') x
), base_tables AS (SELECT t FROM expected,LATERAL jsonb_array_elements(value->'base') t),
 columns AS (SELECT t->>'name' AS table_name,c,ordinality AS position FROM base_tables,LATERAL jsonb_array_elements(t->'columns') WITH ORDINALITY a(c,ordinality)),
 constraints AS (SELECT t->>'name' AS table_name,k FROM base_tables,LATERAL jsonb_array_elements(t->'constraints') k),
 indexes AS (SELECT i FROM expected,LATERAL jsonb_array_elements(value->'indexes') i),
 functions AS (SELECT f FROM expected,LATERAL jsonb_array_elements(value->'functions') f),
 sequences AS (SELECT s FROM expected,LATERAL jsonb_array_elements(value->'sequences') s),
 sequence_state AS (SELECT s,x.* FROM sequences CROSS JOIN LATERAL XMLTABLE('/table/row' PASSING query_to_xml(
 CASE WHEN EXISTS(SELECT FROM pg_class WHERE oid=to_regclass('public.'||(s->>'name')) AND relkind='S')
 THEN format('SELECT last_value,is_called FROM public.%I',s->>'name') ELSE 'SELECT NULL::bigint AS last_value,NULL::boolean AS is_called' END,
 false,false,'') COLUMNS last_value text PATH 'last_value',is_called text PATH 'is_called') x),
 ledger_expected AS (SELECT f,ordinality AS position FROM expected,LATERAL jsonb_array_elements(value->'ledger') WITH ORDINALITY a(f,ordinality)),
 ledger AS (SELECT x.* FROM XMLTABLE('/table/row' PASSING query_to_xml(
 CASE WHEN EXISTS(SELECT FROM pg_class WHERE oid=to_regclass('public.logistica_schema_migrations') AND relkind='r')
 THEN 'SELECT migration_name,migration_sha256,applied_at::text,applied_by FROM public.logistica_schema_migrations'
 ELSE 'SELECT NULL::text AS migration_name,NULL::text AS migration_sha256,NULL::text AS applied_at,NULL::text AS applied_by WHERE false' END,
 false,false,'') COLUMNS migration_name text PATH 'migration_name',migration_sha256 text PATH 'migration_sha256',applied_at text PATH 'applied_at',applied_by text PATH 'applied_by') x),
 issues(reason) AS (
 SELECT 'MISSING_EXTENSION:'||required.name FROM unnest(ARRAY['plpgsql','citext']) required(name) WHERE NOT EXISTS(SELECT FROM installed_extensions e WHERE e.name=required.name)
 UNION ALL SELECT 'UNEXPECTED_OBJECT:'||schema||'.'||name FROM application_objects o WHERE schema<>'public' OR NOT EXISTS(SELECT FROM expected_objects e WHERE e.catalog::regclass=o.classid AND e.name=o.name)
 UNION ALL SELECT 'MISSING_OBJECT:'||e.catalog||':'||e.name FROM expected_objects e WHERE NOT EXISTS(SELECT FROM application_objects o WHERE o.schema='public' AND o.classid=e.catalog::regclass AND o.name=e.name)
 UNION ALL SELECT 'TABLE_NOT_EMPTY_OR_UNSUPPORTED:'||name FROM counts WHERE oid IS NULL OR relkind<>'r' OR relpersistence<>'p' OR relrowsecurity OR relforcerowsecurity OR (${emptyCheck} AND rows IS DISTINCT FROM 0)
 UNION ALL SELECT 'BASE_COLUMN_DRIFT:'||table_name||'.'||(c->>'name') FROM columns e
 LEFT JOIN pg_attribute a ON a.attrelid=to_regclass('public.'||table_name) AND a.attname=c->>'name' AND NOT a.attisdropped
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attnum IS DISTINCT FROM position::int OR format_type(a.atttypid,a.atttypmod) IS DISTINCT FROM c->>'type'
 OR a.attnotnull IS DISTINCT FROM (c->>'not_null')::boolean OR a.attidentity<>'' OR a.attgenerated<>''
 OR a.attcollation IS DISTINCT FROM CASE WHEN c->>'collation' IS NOT NULL THEN to_regcollation(format('%I',c->>'collation'))::oid ELSE (SELECT typcollation FROM pg_type WHERE oid=a.atttypid) END
 UNION ALL SELECT 'EXTRA_BASE_COLUMNS:'||(t->>'name') FROM base_tables WHERE (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.'||(t->>'name')) AND attnum>0 AND NOT attisdropped)<>jsonb_array_length(t->'columns')
 UNION ALL SELECT 'BASE_CONSTRAINT_DRIFT:'||table_name||'.'||(k->>'name') FROM constraints e LEFT JOIN pg_constraint a ON a.conrelid=to_regclass('public.'||table_name) AND a.conname=k->>'name'
 WHERE a.oid IS NULL OR a.contype::text<>k->>'type' OR NOT a.convalidated OR a.condeferrable OR a.condeferred
 OR (k->>'type'<>'c' AND (SELECT jsonb_agg(v.attname::text ORDER BY u.position) FROM unnest(a.conkey) WITH ORDINALITY u(attnum,position) JOIN pg_attribute v ON v.attrelid=a.conrelid AND v.attnum=u.attnum) IS DISTINCT FROM k->'columns')
 OR (k->>'type'='f' AND (a.confrelid IS DISTINCT FROM to_regclass('public.'||(k->>'reference')) OR a.confupdtype::text<>k->>'update' OR a.confdeltype::text<>k->>'delete' OR a.confmatchtype<>'s'
 OR (SELECT jsonb_agg(v.attname::text ORDER BY u.position) FROM unnest(a.confkey) WITH ORDINALITY u(attnum,position) JOIN pg_attribute v ON v.attrelid=a.confrelid AND v.attnum=u.attnum) IS DISTINCT FROM k->'reference_columns'))
 UNION ALL SELECT 'EXTRA_BASE_CONSTRAINTS:'||(t->>'name') FROM base_tables WHERE (SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('public.'||(t->>'name')))<>jsonb_array_length(t->'constraints')
 UNION ALL SELECT 'BASE_INDEX_DRIFT:'||(i->>'name') FROM indexes LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||(i->>'name')) LEFT JOIN pg_index x ON x.indexrelid=c.oid
 WHERE c.oid IS NULL OR x.indrelid IS DISTINCT FROM to_regclass('public.'||(i->>'table')) OR NOT x.indisvalid OR NOT x.indisready
 UNION ALL SELECT 'BASE_FUNCTION_DRIFT:'||(f->>'name') FROM functions LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||(f->>'name')||'(integer,integer,integer)')
 WHERE p.oid IS NULL OR p.prokind<>'f' OR p.prorettype<>'void'::regtype OR p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provolatile<>'v' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex') IS DISTINCT FROM f->>'hash'
 OR to_jsonb(p.proargnames) IS DISTINCT FROM f->'argnames' OR p.pronargs<>3 OR p.proargmodes IS NOT NULL OR p.provariadic<>0 OR p.prosupport<>0
 UNION ALL SELECT 'EXTRA_BASE_FUNCTION_OVERLOAD:'||p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${model.functions.map(f=>lit(f.name)).join(',')}) AND p.oid IS DISTINCT FROM to_regprocedure('public.'||p.proname||'(integer,integer,integer)')
 UNION ALL SELECT 'SEQUENCE_DRIFT:'||(s->>'name') FROM sequences LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||(s->>'name')) LEFT JOIN pg_sequence q ON q.seqrelid=c.oid
 WHERE c.relkind IS DISTINCT FROM 'S' OR q.seqtypid IS DISTINCT FROM (s->>'type')::regtype OR q.seqstart<>1 OR q.seqincrement<>1 OR q.seqmin<>1 OR q.seqmax<>CASE WHEN s->>'type'='integer' THEN 2147483647::bigint ELSE 9223372036854775807::bigint END OR q.seqcache<>1 OR q.seqcycle
 OR to_regclass(pg_get_serial_sequence('public.'||(s->>'table'),s->>'column')) IS DISTINCT FROM to_regclass('public.'||(s->>'name'))
 OR c.relowner IS DISTINCT FROM (SELECT relowner FROM pg_class WHERE oid=to_regclass('public.'||(s->>'table')))
 OR NOT EXISTS(SELECT FROM pg_depend d JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_class'::regclass AND d.refobjid=to_regclass('public.'||(s->>'table')) AND a.attname=s->>'column' AND d.deptype='a')
 UNION ALL SELECT 'SEQUENCE_NOT_FRESH:'||(s->>'name') FROM sequence_state WHERE ${freshCheck}last_value::bigint IS DISTINCT FROM 1 OR is_called::boolean IS DISTINCT FROM false${allowSequenceState.length?')':''}
${catalogIssues()}
 UNION ALL SELECT 'LEDGER_DRIFT' WHERE (SELECT count(*) FROM ledger)<>7 OR EXISTS(SELECT FROM ledger_expected e FULL JOIN ledger l ON l.migration_name=e.f->>'name' WHERE e.f IS NULL OR l.migration_name IS NULL OR l.migration_sha256 IS DISTINCT FROM e.f->>'sha256' OR l.applied_at IS NULL OR l.applied_by IS NULL)
 UNION ALL SELECT 'LEDGER_ORDER_DRIFT' WHERE EXISTS(SELECT FROM ledger_expected a JOIN ledger x ON x.migration_name=a.f->>'name' JOIN ledger_expected b ON b.position>a.position JOIN ledger y ON y.migration_name=b.f->>'name' WHERE x.applied_at::timestamptz>=y.applied_at::timestamptz)
 UNION ALL SELECT 'UNSUPPORTED_RULE_POLICY_OR_INHERITANCE' WHERE EXISTS(SELECT FROM pg_policy WHERE polrelid IN (SELECT oid FROM counts)) OR EXISTS(SELECT FROM pg_rewrite WHERE ev_class IN (SELECT oid FROM counts)) OR EXISTS(SELECT FROM pg_inherits WHERE inhrelid IN (SELECT oid FROM counts) OR inhparent IN (SELECT oid FROM counts))
)`;
}
export function cleanFiles() {
  const model=baselineModel();
  const header=`-- GENERATED OFFLINE by build_clean_baseline.mjs. PostgreSQL 16 / HeidiSQL.\n`;
  const checks=checksCTEs(model);
  const tableDDL=model.tables.map(t=>`CREATE TABLE public.${t.name} (\n  ${t.parts.join(',\n  ')}\n);`).join('\n\n');
  const ledger=model.files.map((f,i)=>`(${lit(f.name)},${lit(f.sha256)},transaction_timestamp()+interval '${i} microseconds',current_user)`).join(',\n');
  const baseline=header+`-- Clean installation only. Never execute incremental migrations after this baseline.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL timezone = 'UTC';
${identityGuard()}
SELECT pg_advisory_xact_lock(2026102101);
DO $empty$ DECLARE issue text; BEGIN
 WITH RECURSIVE ${inventoryCTEs()}
 SELECT string_agg(schema||'.'||name,', ' ORDER BY schema,name) INTO issue FROM application_objects;
 IF issue IS NOT NULL THEN RAISE EXCEPTION 'APPLICATION_OBJECTS_ALREADY_PRESENT: %',issue; END IF;
 IF to_regnamespace('public') IS NULL THEN RAISE EXCEPTION 'PUBLIC_SCHEMA_REQUIRED'; END IF;
 IF EXISTS(SELECT FROM unnest(ARRAY['plpgsql','citext']) required(name) WHERE NOT EXISTS(SELECT FROM pg_extension e WHERE e.extname=required.name)) THEN RAISE EXCEPTION 'PLPGSQL_AND_CITEXT_EXTENSIONS_REQUIRED'; END IF;
END; $empty$;

${tableDDL}

${model.indexes.map(sql=>sql+';').join('\n\n')}

${model.functions.map(f=>f.ddl+';').join('\n\n')}

${model.aux.map(sql=>sql+';').join('\n\n')}

-- SYSTEM metadata only: these seven versions are INCLUDED by the baseline,
-- not seven independently executed migration attempts. No application seeds.
INSERT INTO public.logistica_schema_migrations(migration_name,migration_sha256,applied_at,applied_by) VALUES
${ledger};
COMMENT ON TABLE public.logistica_schema_migrations IS 'Clean baseline includes the seven recorded schema versions; business tables start empty. Do not run incremental migrations again.';

${expressionGuard(model)}

DO $validate$ DECLARE issue text; BEGIN
 WITH RECURSIVE ${checks}
 SELECT string_agg(reason,', ' ORDER BY reason) INTO issue FROM issues;
 IF issue IS NOT NULL THEN RAISE EXCEPTION 'CALIDAD_BASELINE_INVALID: %',issue; END IF;
END; $validate$;
-- Accept this result only together with the following successful COMMIT.
-- Keeping it inside the transaction prevents success after an aborted COMMIT.
SELECT 'CALIDAD_BASELINE_CREADO' AS "CHECK",'SI' AS "ESTADO";
COMMIT;
`;
  const validation=header+`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
${identityGuard()}
SET LOCAL search_path = pg_catalog, public;
SET LOCAL standard_conforming_strings = on;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';
SET LOCAL row_security = off;
SET LOCAL timezone = 'UTC';
${expressionGuard(model)}
WITH RECURSIVE ${checks}, report AS (
 SELECT 0 AS position,'EXTENSION_INFRA'::text AS "CHECK",'INFO'::text AS "ESTADO",jsonb_build_object('name',name,'schema',schema,'version',version) AS "DETALLE" FROM installed_extensions
 UNION ALL SELECT 1,'INCIDENCIA','NO',jsonb_build_object('reason',reason) FROM issues
 UNION ALL SELECT 2,'CALIDAD_SCHEMA_VALIDO',CASE WHEN EXISTS(SELECT FROM issues) THEN 'NO' ELSE 'SI' END,jsonb_build_object('tables',${model.tables.length},'application_rows',(SELECT sum(rows) FROM counts WHERE name<>'logistica_schema_migrations'),'ledger_rows',(SELECT count(*) FROM ledger))
) SELECT "CHECK","ESTADO","DETALLE" FROM report ORDER BY position,"CHECK";
ROLLBACK;
`;
  return new Map([['create_calidad.sql',baseline],['validate_create_calidad.sql',validation]]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  for(const [name,bytes] of cleanFiles())writeFileSync(new URL(name,import.meta.url),bytes);
}
