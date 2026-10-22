-- SOLO PREPARADO. Salida JSONL: psql -X -q -t -A --output=<archivo> -f snapshot.sql.
-- Capturar ORIGEN y DESTINO sin escritores y ANTES de Logistica.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\ir manifest.psql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\ir identity.psql
SELECT jsonb_build_object('kind', 'identity', 'database', current_database(),
  'user', current_user, 'address', host(inet_server_addr()), 'port', inet_server_port(),
  'version', current_setting('server_version'), 'captured_at', current_timestamp);
SELECT jsonb_build_object('kind', 'database_settings', 'encoding', pg_encoding_to_char(encoding),
  'collation', datcollate, 'ctype', datctype, 'provider', datlocprovider,
  'icu_locale', daticulocale, 'collation_version', datcollversion,
  'actual_collation_version', pg_database_collation_actual_version(oid))
FROM pg_database WHERE datname = current_database();
-- No se admiten vistas/foreign tables/particiones silenciosamente. Exigen ampliar el plan.
SELECT 1 / ((NOT EXISTS (
  SELECT FROM unnest(:'core_tables'::text[]) t(name)
  LEFT JOIN pg_class c ON c.oid = to_regclass(t.name)
  WHERE c.oid IS NULL OR c.relkind <> 'r'
) AND NOT EXISTS (
  SELECT FROM unnest(:'historical_tables'::text[]) t(name)
  JOIN pg_class c ON c.oid = to_regclass(t.name) WHERE c.relkind <> 'r'
) AND NOT EXISTS (
  SELECT FROM pg_inherits i
  WHERE i.inhrelid IN (SELECT to_regclass(t) FROM unnest(:'core_tables'::text[] || :'historical_tables'::text[]) t)
     OR i.inhparent IN (SELECT to_regclass(t) FROM unnest(:'core_tables'::text[] || :'historical_tables'::text[]) t)
) AND NOT EXISTS (
  SELECT FROM unnest(:'logistics_tables'::text[]) t WHERE to_regclass(t) IS NOT NULL
    AND :'transfer_mode' <> 'local_rehearsal'
))::integer) AS baseline_guard
\gset
SELECT jsonb_build_object('kind', 'scope', 'tables', jsonb_agg(jsonb_build_object(
  'name', name, 'present', to_regclass(name) IS NOT NULL) ORDER BY name))
FROM unnest(:'core_tables'::text[] || :'historical_tables'::text[]) t(name);

-- Catalogo por tabla: no se supone PK=id. Definiciones sin OIDs portables entre DBs.
WITH selected AS (
  SELECT c.*, n.nspname, format('%I.%I', n.nspname, c.relname) AS qualified
  FROM unnest(:'core_tables'::text[] || :'historical_tables'::text[]) t(name)
  JOIN pg_class c ON c.oid = to_regclass(t.name)
  JOIN pg_namespace n ON n.oid = c.relnamespace
)
SELECT jsonb_build_object('kind', 'table', 'name', s.qualified,
  'persistence', relpersistence, 'rls', relrowsecurity, 'force_rls', relforcerowsecurity,
  'options', reloptions, 'replica_identity', relreplident,
  'owner', pg_get_userbyid(relowner), 'acl', relacl,
  'tablespace', coalesce((SELECT spcname FROM pg_tablespace WHERE oid = reltablespace), 'DATABASE_DEFAULT'),
  'columns', (SELECT jsonb_agg(jsonb_build_object(
    'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
    'default', pg_get_expr(d.adbin, d.adrelid), 'identity', a.attidentity, 'generated', a.attgenerated,
    'collation', a.attcollation::regcollation::text, 'acl', a.attacl,
    'storage', a.attstorage, 'compression', a.attcompression) ORDER BY a.attnum)
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = s.oid AND a.attnum > 0 AND NOT a.attisdropped),
  'constraints', coalesce((SELECT jsonb_agg(jsonb_build_object(
    'name', conname, 'type', contype, 'validated', convalidated,
    'deferrable', condeferrable, 'deferred', condeferred,
    'definition', pg_get_constraintdef(oid, true)) ORDER BY conname)
    FROM pg_constraint WHERE conrelid = s.oid), '[]'::jsonb),
  'indexes', coalesce((SELECT jsonb_agg(jsonb_build_object('name', c.relname,
    'definition', pg_get_indexdef(i.indexrelid), 'valid', i.indisvalid, 'ready', i.indisready,
    'clustered', i.indisclustered, 'replica_identity', i.indisreplident) ORDER BY c.relname)
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = s.oid), '[]'::jsonb),
  'triggers', coalesce((SELECT jsonb_agg(jsonb_build_object('name', tgname, 'enabled', tgenabled,
    'definition', pg_get_triggerdef(oid, true), 'function', tgfoid::regprocedure::text) ORDER BY tgname)
    FROM pg_trigger WHERE tgrelid = s.oid AND NOT tgisinternal), '[]'::jsonb),
  'rules', coalesce((SELECT jsonb_agg(pg_get_ruledef(oid, true) ORDER BY rulename)
    FROM pg_rewrite WHERE ev_class = s.oid), '[]'::jsonb),
  'policies', coalesce((SELECT jsonb_agg(jsonb_build_object('name', polname,
    'command', polcmd, 'permissive', polpermissive,
    'roles', (SELECT jsonb_agg(r::regrole::text ORDER BY r::regrole::text) FROM unnest(polroles) r),
    'using', pg_get_expr(polqual, polrelid), 'check', pg_get_expr(polwithcheck, polrelid)) ORDER BY polname)
    FROM pg_policy WHERE polrelid = s.oid), '[]'::jsonb))
FROM selected s ORDER BY s.qualified;

-- COUNT exacto y MAX de cada columna numerica de PK, mas id si existe y es numerico.
WITH selected AS (
  SELECT to_regclass(name) AS oid, name FROM unnest(:'core_tables'::text[] || :'historical_tables'::text[]) t(name)
  WHERE to_regclass(name) IS NOT NULL
), maxima AS (
  SELECT s.oid, string_agg(format('%L, max(%I)::text', a.attname, a.attname), ', ' ORDER BY a.attnum) AS fields
  FROM selected s JOIN pg_attribute a ON a.attrelid = s.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE a.atttypid IN ('int2'::regtype, 'int4'::regtype, 'int8'::regtype, 'numeric'::regtype)
    AND (a.attname = 'id' OR EXISTS (
      SELECT FROM pg_constraint k WHERE k.conrelid = s.oid AND k.contype = 'p' AND a.attnum = ANY(k.conkey)))
  GROUP BY s.oid
)
SELECT format('SELECT jsonb_build_object(''kind'', ''count'', ''name'', %L, ''count'', count(*)::text, ''max_keys'', %s) FROM %s;',
  s.name, CASE WHEN m.fields IS NULL THEN '''{}''::jsonb' ELSE 'jsonb_build_object(' || m.fields || ')' END, s.oid::regclass)
FROM selected s LEFT JOIN maxima m ON m.oid = s.oid ORDER BY s.name
\gexec

-- Secuencias OWNED BY/IDENTITY y secuencias usadas por defaults, aun sin ownership.
WITH selected AS (
  SELECT to_regclass(name) AS oid FROM unnest(:'core_tables'::text[] || :'historical_tables'::text[]) t(name)
), sequences AS (
  SELECT d.objid AS oid FROM pg_depend d JOIN selected t ON d.refobjid = t.oid
    JOIN pg_class c ON c.oid = d.objid AND c.relkind = 'S'
    WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
  UNION
  SELECT d.refobjid FROM pg_attrdef a JOIN selected t ON a.adrelid = t.oid
    JOIN pg_depend d ON d.classid = 'pg_attrdef'::regclass AND d.objid = a.oid
    JOIN pg_class c ON c.oid = d.refobjid AND c.relkind = 'S' WHERE d.refclassid = 'pg_class'::regclass
)
SELECT format('SELECT jsonb_build_object(''kind'', ''sequence'', ''name'', %L, ''definition'', %L::jsonb, ''last_value'', last_value::text, ''is_called'', is_called) FROM %s;',
  c.oid::regclass::text,
  jsonb_build_object('type', q.seqtypid::regtype::text, 'start', q.seqstart::text,
    'increment', q.seqincrement::text, 'min', q.seqmin::text, 'max', q.seqmax::text,
    'cache', q.seqcache::text, 'cycle', q.seqcycle, 'owner', pg_get_userbyid(c.relowner), 'acl', c.relacl,
    'ownership', (SELECT jsonb_agg(jsonb_build_object('table', d.refobjid::regclass::text,
      'column', a.attname, 'kind', d.deptype) ORDER BY d.refobjid::regclass::text, a.attname)
      FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
        AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i'))), c.oid::regclass)
FROM sequences s JOIN pg_class c ON c.oid = s.oid JOIN pg_sequence q ON q.seqrelid = c.oid ORDER BY c.oid::regclass::text
\gexec

-- Los cuerpos move_* del repositorio NO son CREATE FUNCTION completos.
-- Se capturan firmas reales, sobrecargas y funciones de triggers. No se invocan.
WITH selected AS (
  SELECT to_regclass(name) AS oid FROM unnest(:'core_tables'::text[] || :'historical_tables'::text[]) t(name)
)
SELECT jsonb_build_object('kind', 'function', 'name', p.oid::regprocedure::text,
  'definition', pg_get_functiondef(p.oid), 'owner', pg_get_userbyid(p.proowner), 'acl', p.proacl)
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prokind IN ('f', 'p') AND ((n.nspname = 'public' AND p.proname = ANY(:'root_functions'::text[]))
  OR p.oid IN (SELECT tgfoid FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM selected) AND NOT tgisinternal))
ORDER BY p.oid::regprocedure::text;

-- FK compuestas y MATCH SIMPLE/FULL: revisa filas sin ALTER/VALIDATE CONSTRAINT.
WITH selected AS (
  SELECT to_regclass(name) AS oid FROM unnest(:'core_tables'::text[] || :'historical_tables'::text[]) t(name)
), predicates AS (
  SELECT k.oid, k.conrelid, k.confrelid, k.conname, k.confmatchtype, k.convalidated,
    string_agg(format('c.%I IS NOT NULL', ca.attname), ' AND ' ORDER BY u.n) AS all_nonnull,
    string_agg(format('c.%I IS NULL', ca.attname), ' AND ' ORDER BY u.n) AS all_null,
    string_agg(format('p.%I OPERATOR(%I.%s) c.%I', pa.attname, ns.nspname, op.oprname, ca.attname), ' AND ' ORDER BY u.n) AS equality
  FROM pg_constraint k
  CROSS JOIN LATERAL unnest(k.conkey, k.confkey, k.conpfeqop) WITH ORDINALITY u(child_col, parent_col, eqop, n)
  JOIN pg_attribute ca ON ca.attrelid = k.conrelid AND ca.attnum = u.child_col
  JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = u.parent_col
  JOIN pg_operator op ON op.oid = u.eqop JOIN pg_namespace ns ON ns.oid = op.oprnamespace
  WHERE k.contype = 'f' AND k.conrelid IN (SELECT oid FROM selected)
  GROUP BY k.oid, k.conrelid, k.confrelid, k.conname, k.confmatchtype, k.convalidated
)
SELECT format('SELECT jsonb_build_object(''kind'', ''fk_rows'', ''name'', %L, ''validated'', %L::boolean, ''violations'', count(*)::text) FROM %s c WHERE %s;',
  conrelid::regclass::text || '.' || conname, convalidated, conrelid::regclass,
  CASE WHEN confmatchtype = 'f' THEN '(' || 'NOT (' || all_null || ') AND NOT (' || all_nonnull || ')) OR ' ELSE '' END
    || '((' || all_nonnull || ') AND NOT EXISTS (SELECT FROM ' || confrelid::regclass::text || ' p WHERE ' || equality || '))')
FROM predicates ORDER BY conrelid::regclass::text, conname
\gexec
-- Marca final: el comparador rechaza archivos truncados o ejecuciones abortadas.
WITH selected AS (
  SELECT to_regclass(name) AS oid FROM unnest(:'core_tables'::text[] || :'historical_tables'::text[]) t(name)
  WHERE to_regclass(name) IS NOT NULL
), sequences AS (
  SELECT d.objid AS oid FROM pg_depend d JOIN selected t ON d.refobjid = t.oid
    JOIN pg_class c ON c.oid = d.objid AND c.relkind = 'S'
    WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
  UNION
  SELECT d.refobjid FROM pg_attrdef a JOIN selected t ON a.adrelid = t.oid
    JOIN pg_depend d ON d.classid = 'pg_attrdef'::regclass AND d.objid = a.oid
    JOIN pg_class c ON c.oid = d.refobjid AND c.relkind = 'S' WHERE d.refclassid = 'pg_class'::regclass
)
SELECT jsonb_build_object('kind', 'complete', 'tables', (SELECT count(*) FROM selected),
  'sequences', (SELECT count(*) FROM sequences),
  'foreign_keys', (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND conrelid IN (SELECT oid FROM selected)),
  'functions', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind IN ('f', 'p') AND ((n.nspname = 'public' AND p.proname = ANY(:'root_functions'::text[]))
      OR p.oid IN (SELECT tgfoid FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM selected) AND NOT tgisinternal))));
ROLLBACK;
