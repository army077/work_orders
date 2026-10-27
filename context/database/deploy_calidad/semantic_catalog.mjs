// Manifest derived from the exact DDL, without a PostgreSQL connection.
export function indexManifest(model) {
 const result=model.tables.flatMap(t=>t.constraints.filter(c=>['p','u'].includes(c.type)).map(c=>({name:c.name,table:t.name,columns:c.columns,unique:true,primary:c.type==='p',predicate:null})));
 for(const sql of model.indexes) {
  const m=sql.match(/^CREATE (UNIQUE )?INDEX (\w+)\s+ON public\.(\w+)\s*\(([^)]+)\)(?:\s+WHERE ([\s\S]+))?$/);
  if(!m)throw Error('UNSUPPORTED_SEMANTIC_INDEX');
  result.push({name:m[2],table:m[3],columns:m[4].split(',').map(c=>c.trim().replaceAll('"','')),unique:!!m[1],primary:false,predicate:m[5]??null});
 }
 return result;
}
export function catalogIssues() {
 return `
 UNION ALL SELECT 'INDEX_CATALOG_DRIFT:'||(i->>'name') FROM indexes
 LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||(i->>'name'))
 LEFT JOIN pg_index x ON x.indexrelid=c.oid LEFT JOIN pg_am am ON am.oid=c.relam
 WHERE c.relkind IS DISTINCT FROM 'i' OR c.relpersistence IS DISTINCT FROM 'p'
 OR x.indisunique IS DISTINCT FROM (i->>'unique')::boolean OR x.indisprimary IS DISTINCT FROM (i->>'primary')::boolean
 OR x.indisexclusion OR x.indnullsnotdistinct OR NOT x.indimmediate OR NOT x.indislive
 OR am.amname IS DISTINCT FROM 'btree' OR x.indnatts IS DISTINCT FROM jsonb_array_length(i->'columns')
 OR x.indnkeyatts IS DISTINCT FROM jsonb_array_length(i->'columns') OR x.indexprs IS NOT NULL
 OR (SELECT jsonb_agg(a.attname::text ORDER BY k.n) FROM unnest(x.indkey) WITH ORDINALITY k(attnum,n) LEFT JOIN pg_attribute a ON a.attrelid=x.indrelid AND a.attnum=k.attnum) IS DISTINCT FROM i->'columns'
 OR EXISTS(SELECT 1 FROM unnest(x.indoption) v WHERE v<>0)
 OR EXISTS(SELECT 1 FROM unnest(x.indclass,x.indcollation,x.indkey) k(opclass,collation,attnum)
 LEFT JOIN pg_opclass opc ON opc.oid=k.opclass LEFT JOIN pg_attribute a ON a.attrelid=x.indrelid AND a.attnum=k.attnum
 WHERE NOT opc.opcdefault OR opc.opcnamespace IS DISTINCT FROM 'pg_catalog'::regnamespace
 OR opc.opcmethod IS DISTINCT FROM c.relam OR opc.opcintype IS DISTINCT FROM CASE WHEN a.atttypid='character varying'::regtype THEN 'text'::regtype ELSE a.atttypid END
 OR k.collation IS DISTINCT FROM a.attcollation)
 UNION ALL SELECT 'MAPPING_FUNCTION_DRIFT' WHERE NOT EXISTS(
 SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
 WHERE p.oid=to_regprocedure('public.protect_logistica_legacy_owner_mapping()')
 AND p.prokind='f' AND p.prorettype='trigger'::regtype AND NOT p.proretset AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proleakproof
 AND p.proparallel='u' AND p.provolatile='v' AND l.lanname='plpgsql'
 AND p.proconfig=ARRAY['search_path=pg_catalog']::text[] AND p.pronargs=0 AND p.pronargdefaults=0 AND p.proargnames IS NULL AND p.proallargtypes IS NULL AND p.proargmodes IS NULL AND p.provariadic=0 AND p.prosupport=0
 AND encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex')=(SELECT value->>'mappingFunctionHash' FROM expected))
 UNION ALL SELECT 'MAPPING_FUNCTION_OVERLOAD' FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname='protect_logistica_legacy_owner_mapping' AND p.oid IS DISTINCT FROM to_regprocedure('public.protect_logistica_legacy_owner_mapping()')
 UNION ALL SELECT 'TRIGGER_DRIFT:'||(e->>'name') FROM expected,LATERAL jsonb_array_elements(value->'triggers') e
 LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('public.logistica_legacy_owner_mapping') AND t.tgname=e->>'name' AND NOT t.tgisinternal
 WHERE t.oid IS NULL OR t.tgtype IS DISTINCT FROM (e->>'type')::smallint OR t.tgenabled IS DISTINCT FROM 'O'
 OR t.tgfoid IS DISTINCT FROM to_regprocedure('public.protect_logistica_legacy_owner_mapping()') OR t.tgnargs<>0 OR octet_length(t.tgargs)<>0
 OR cardinality(t.tgattr::smallint[])<>0 OR t.tgqual IS NOT NULL OR t.tgconstraint<>0 OR t.tgdeferrable OR t.tginitdeferred
 OR t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL
 UNION ALL SELECT 'UNEXPECTED_TRIGGER:'||t.tgname FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN (SELECT oid FROM counts)
 AND NOT EXISTS(SELECT 1 FROM expected,LATERAL jsonb_array_elements(value->'triggers') e WHERE t.tgrelid=to_regclass('public.logistica_legacy_owner_mapping') AND t.tgname=e->>'name')
 UNION ALL SELECT 'EXPRESSION_DEPENDENCY_DRIFT' WHERE EXISTS(
 SELECT 1 FROM pg_depend d JOIN pg_proc p ON d.refclassid='pg_proc'::regclass AND p.oid=d.refobjid
 WHERE p.pronamespace<>'pg_catalog'::regnamespace AND (
 (d.classid='pg_constraint'::regclass AND d.objid IN (SELECT oid FROM pg_constraint WHERE conrelid IN (SELECT oid FROM counts)))
 OR (d.classid='pg_attrdef'::regclass AND d.objid IN (SELECT oid FROM pg_attrdef WHERE adrelid IN (SELECT oid FROM counts)))
 OR (d.classid='pg_class'::regclass AND d.objid IN (SELECT indexrelid FROM pg_index WHERE indrelid IN (SELECT oid FROM counts)))))
 UNION ALL SELECT 'EXPRESSION_OPERATOR_DRIFT' WHERE EXISTS(
 SELECT 1 FROM pg_depend d JOIN pg_operator o ON d.refclassid='pg_operator'::regclass AND o.oid=d.refobjid
 WHERE o.oprnamespace<>'pg_catalog'::regnamespace AND (
 (d.classid='pg_constraint'::regclass AND d.objid IN (SELECT oid FROM pg_constraint WHERE conrelid IN (SELECT oid FROM counts)))
 OR (d.classid='pg_attrdef'::regclass AND d.objid IN (SELECT oid FROM pg_attrdef WHERE adrelid IN (SELECT oid FROM counts)))
 OR (d.classid='pg_class'::regclass AND d.objid IN (SELECT indexrelid FROM pg_index WHERE indrelid IN (SELECT oid FROM counts)))))
 UNION ALL SELECT 'CONSTRAINT_ATTRIBUTES_DRIFT:'||conname FROM pg_constraint WHERE conrelid IN (SELECT oid FROM counts) AND ((contype='c' AND connoinherit) OR NOT conislocal OR coninhcount<>0)
 UNION ALL SELECT 'BASE_FUNCTION_ATTRIBUTES_DRIFT:'||p.proname FROM pg_proc p WHERE p.oid IN (SELECT to_regprocedure('public.'||(f->>'name')||'(integer,integer,integer)') FROM functions) AND (p.proretset OR p.pronargdefaults<>0 OR p.proallargtypes IS NOT NULL)
`;
}
