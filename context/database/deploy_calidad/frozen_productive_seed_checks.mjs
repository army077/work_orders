// Historical validation source retained solely to reproduce the frozen productive
// seed byte-for-byte. It is NOT the validation policy for CREATE or new files.
import { extensionCatalog } from './build_package.mjs';
import { shapeSql } from '../migrations/prod/logistica_prod_support.js';
const lit=value=>"'"+String(value).replaceAll("'","''")+"'";
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
const sqlNormalize=expression=>`regexp_replace(replace(${expression},'"',''),'[[:space:]]','','g')`;
const defaultNormalize=expression=>sqlNormalize(`regexp_replace(coalesce(${expression},'NULL'),'::(character varying(?:\\([0-9]+\\))?|timestamp (?:with|without) time zone|double precision|text|jsonb|integer|numeric|boolean)','', 'g')`);
export function frozenProductionSeedChecks(model,{allowData=[]}={}) {
  const emptyCheck=allowData.length
    ? `name NOT IN (${['logistica_schema_migrations',...allowData].map(lit).join(',')})`
    : `name<>'logistica_schema_migrations'`;
  const freshCheck=allowData.length?`s->>'table' NOT IN (${allowData.map(lit).join(',')}) AND (`:'';
  const expected={base:model.base.map(t=>({name:t.name,columns:t.columns,constraints:t.constraints})),indexes:model.baseIndexes,functions:model.functions.map(f=>({name:f.name,hash:f.hash})),sequences:model.sequences,ledger:model.files};
  const expectedObjects=[
    ...model.tables.flatMap(t=>[['pg_class',t.name],['pg_type',t.name],['pg_type','_'+t.name]]),
    ...model.sequences.map(s=>['pg_class',s.name]),
    ...model.tables.flatMap(t=>t.constraints.filter(c=>['p','u'].includes(c.type)).map(c=>['pg_class',c.name])),
    ...model.indexes.map(sql=>['pg_class',sql.match(/INDEX (\w+)/)[1]]),
    ...model.functions.map(f=>['pg_proc',f.name]),['pg_proc','protect_logistica_legacy_owner_mapping'],
    ['pg_trigger','logistica_legacy_owner_mapping_row_guard'],['pg_trigger','logistica_legacy_owner_mapping_truncate_guard'],
  ];
  // Prepared states used temporary relations visible without a namespace, but
  // temporary functions are not implicitly visible. Make public relations visible
  // and retain the explicit function namespace used by those reference states.
  const logisticShape=shapeSql.replace('$1::text',"'public'::text")
    .replace('p.prosrc,',"replace(p.prosrc,chr(13),''),")
    .replace('pg_get_triggerdef(t.oid,true)',"replace(pg_get_triggerdef(t.oid,true),'EXECUTE FUNCTION protect_logistica_legacy_owner_mapping()','EXECUTE FUNCTION public.protect_logistica_legacy_owner_mapping()')")
    .trim().replace(/;$/,'');
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
 logistics_shape AS (${logisticShape}),
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
 OR a.attcollation IS DISTINCT FROM (SELECT typcollation FROM pg_type WHERE oid=a.atttypid)
 OR (NOT (c->>'serial')::boolean AND ${defaultNormalize('pg_get_expr(d.adbin,d.adrelid)')} IS DISTINCT FROM ${defaultNormalize("c->>'default'")})
 UNION ALL SELECT 'EXTRA_BASE_COLUMNS:'||(t->>'name') FROM base_tables WHERE (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.'||(t->>'name')) AND attnum>0 AND NOT attisdropped)<>jsonb_array_length(t->'columns')
 UNION ALL SELECT 'BASE_CONSTRAINT_DRIFT:'||table_name||'.'||(k->>'name') FROM constraints e LEFT JOIN pg_constraint a ON a.conrelid=to_regclass('public.'||table_name) AND a.conname=k->>'name'
 WHERE a.oid IS NULL OR a.contype::text<>k->>'type' OR NOT a.convalidated OR a.condeferrable OR a.condeferred
 OR (k->>'type'<>'c' AND (SELECT jsonb_agg(v.attname::text ORDER BY u.position) FROM unnest(a.conkey) WITH ORDINALITY u(attnum,position) JOIN pg_attribute v ON v.attrelid=a.conrelid AND v.attnum=u.attnum) IS DISTINCT FROM k->'columns')
 OR (k->>'type'='f' AND (a.confrelid IS DISTINCT FROM to_regclass('public.'||(k->>'reference')) OR a.confupdtype::text<>k->>'update' OR a.confdeltype::text<>k->>'delete' OR a.confmatchtype<>'s'
 OR (SELECT jsonb_agg(v.attname::text ORDER BY u.position) FROM unnest(a.confkey) WITH ORDINALITY u(attnum,position) JOIN pg_attribute v ON v.attrelid=a.confrelid AND v.attnum=u.attnum) IS DISTINCT FROM k->'reference_columns'))
 OR (k->>'type'='c' AND regexp_replace(${defaultNormalize('pg_get_constraintdef(a.oid,true)')},'[()]','','g') IS DISTINCT FROM regexp_replace(${defaultNormalize("k->>'definition'")},'[()]','','g'))
 UNION ALL SELECT 'EXTRA_BASE_CONSTRAINTS:'||(t->>'name') FROM base_tables WHERE (SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('public.'||(t->>'name')))<>jsonb_array_length(t->'constraints')
 UNION ALL SELECT 'BASE_INDEX_DRIFT:'||(i->>'name') FROM indexes LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||(i->>'name')) LEFT JOIN pg_index x ON x.indexrelid=c.oid
 WHERE c.oid IS NULL OR x.indrelid IS DISTINCT FROM to_regclass('public.'||(i->>'table')) OR NOT x.indisvalid OR NOT x.indisready OR ${sqlNormalize('pg_get_indexdef(c.oid)')} IS DISTINCT FROM ${sqlNormalize("i->>'definition'")}
 UNION ALL SELECT 'BASE_FUNCTION_DRIFT:'||(f->>'name') FROM functions LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||(f->>'name')||'(integer,integer,integer)')
 WHERE p.oid IS NULL OR p.prokind<>'f' OR p.prorettype<>'void'::regtype OR p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provolatile<>'v' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex') IS DISTINCT FROM f->>'hash'
 UNION ALL SELECT 'EXTRA_BASE_FUNCTION_OVERLOAD:'||p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN (${model.functions.map(f=>lit(f.name)).join(',')}) AND p.oid IS DISTINCT FROM to_regprocedure('public.'||p.proname||'(integer,integer,integer)')
 UNION ALL SELECT 'SEQUENCE_DRIFT:'||(s->>'name') FROM sequences LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||(s->>'name')) LEFT JOIN pg_sequence q ON q.seqrelid=c.oid
 WHERE c.relkind IS DISTINCT FROM 'S' OR q.seqtypid IS DISTINCT FROM (s->>'type')::regtype OR q.seqstart<>1 OR q.seqincrement<>1 OR q.seqmin<>1 OR q.seqmax<>CASE WHEN s->>'type'='integer' THEN 2147483647::bigint ELSE 9223372036854775807::bigint END OR q.seqcache<>1 OR q.seqcycle
 OR pg_get_serial_sequence('public.'||(s->>'table'),s->>'column') IS DISTINCT FROM 'public.'||(s->>'name')
 OR c.relowner IS DISTINCT FROM (SELECT relowner FROM pg_class WHERE oid=to_regclass('public.'||(s->>'table')))
 OR NOT EXISTS(SELECT FROM pg_depend d JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_class'::regclass AND d.refobjid=to_regclass('public.'||(s->>'table')) AND a.attname=s->>'column' AND d.deptype='a')
 OR (SELECT replace(pg_get_expr(d.adbin,d.adrelid),'public.','') FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=to_regclass('public.'||(s->>'table')) AND a.attname=s->>'column') IS DISTINCT FROM format('nextval(%L::regclass)',s->>'name')
 UNION ALL SELECT 'SEQUENCE_NOT_FRESH:'||(s->>'name') FROM sequence_state WHERE ${freshCheck}last_value::bigint IS DISTINCT FROM 1 OR is_called::boolean IS DISTINCT FROM false${allowData.length?')':''}
 UNION ALL SELECT 'UNEXPECTED_BASE_TRIGGER:'||tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT to_regclass('public.'||(t->>'name')) FROM base_tables)
 UNION ALL SELECT 'LOGISTICA_FINAL_SCHEMA_DRIFT' FROM logistics_shape WHERE fingerprint<>${lit(model.logisticsFingerprint)}
 UNION ALL SELECT 'LEDGER_DRIFT' WHERE (SELECT count(*) FROM ledger)<>7 OR EXISTS(SELECT FROM ledger_expected e FULL JOIN ledger l ON l.migration_name=e.f->>'name' WHERE e.f IS NULL OR l.migration_name IS NULL OR l.migration_sha256 IS DISTINCT FROM e.f->>'sha256' OR l.applied_at IS NULL OR l.applied_by IS NULL)
 UNION ALL SELECT 'LEDGER_ORDER_DRIFT' WHERE EXISTS(SELECT FROM ledger_expected a JOIN ledger x ON x.migration_name=a.f->>'name' JOIN ledger_expected b ON b.position>a.position JOIN ledger y ON y.migration_name=b.f->>'name' WHERE x.applied_at::timestamptz>=y.applied_at::timestamptz)
 UNION ALL SELECT 'UNSUPPORTED_RULE_POLICY_OR_INHERITANCE' WHERE EXISTS(SELECT FROM pg_policy WHERE polrelid IN (SELECT oid FROM counts)) OR EXISTS(SELECT FROM pg_rewrite WHERE ev_class IN (SELECT oid FROM counts)) OR EXISTS(SELECT FROM pg_inherits WHERE inhrelid IN (SELECT oid FROM counts) OR inhparent IN (SELECT oid FROM counts))
)`;
}
