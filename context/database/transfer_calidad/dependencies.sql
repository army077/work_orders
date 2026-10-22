-- SOLO PREPARADO. Reporte JSONL de catalogos; no ejecuta rutinas del proyecto.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\ir manifest.psql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\ir identity.psql
-- Salientes e IN entrantes. Una FK entrante no obliga a copiar al consumidor.
WITH selected AS (
  SELECT to_regclass(t) AS oid FROM unnest(:'core_tables'::text[] || :'historical_tables'::text[]) t
)
SELECT jsonb_build_object('kind', 'fk_dependency', 'name', k.conname,
  'child', k.conrelid::regclass::text, 'parent', k.confrelid::regclass::text,
  'child_selected', k.conrelid IN (SELECT oid FROM selected WHERE oid IS NOT NULL),
  'parent_selected', k.confrelid IN (SELECT oid FROM selected WHERE oid IS NOT NULL),
  'validated', k.convalidated, 'definition', pg_get_constraintdef(k.oid, true))
FROM pg_constraint k WHERE k.contype = 'f'
  AND (k.conrelid IN (SELECT oid FROM selected) OR k.confrelid IN (SELECT oid FROM selected))
ORDER BY k.conrelid::regclass::text, k.conname;

-- Raices: tablas, defaults, indices, constraints, triggers, rules, policies, move_*.
-- UNION rompe ciclos. Se sigue la dependencia SALIENTE, no todo un esquema.
-- pg_depend no registra todas las referencias de cuerpos PL/pgSQL / SQL dinamico.
WITH RECURSIVE selected AS (
  SELECT to_regclass(t) AS oid FROM unnest(:'core_tables'::text[] || :'historical_tables'::text[]) t
), roots(classid, objid) AS (
  SELECT 'pg_class'::regclass::oid, oid FROM selected WHERE oid IS NOT NULL
  UNION SELECT 'pg_class'::regclass::oid, indexrelid FROM pg_index WHERE indrelid IN (SELECT oid FROM selected)
  UNION SELECT 'pg_attrdef'::regclass::oid, oid FROM pg_attrdef WHERE adrelid IN (SELECT oid FROM selected)
  UNION SELECT 'pg_constraint'::regclass::oid, oid FROM pg_constraint WHERE conrelid IN (SELECT oid FROM selected)
  UNION SELECT 'pg_trigger'::regclass::oid, oid FROM pg_trigger WHERE tgrelid IN (SELECT oid FROM selected) AND NOT tgisinternal
  UNION SELECT 'pg_rewrite'::regclass::oid, oid FROM pg_rewrite WHERE ev_class IN (SELECT oid FROM selected)
  UNION SELECT 'pg_policy'::regclass::oid, oid FROM pg_policy WHERE polrelid IN (SELECT oid FROM selected)
  UNION SELECT 'pg_proc'::regclass::oid, p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(:'root_functions'::text[])
  UNION SELECT 'pg_class'::regclass::oid, d.objid FROM pg_depend d
    JOIN pg_class c ON c.oid = d.objid AND c.relkind = 'S'
    WHERE d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass
      AND d.refobjid IN (SELECT oid FROM selected) AND d.deptype IN ('a', 'i')
), closure(classid, objid) AS (
  SELECT classid, objid FROM roots
  UNION
  SELECT d.refclassid, d.refobjid FROM closure c
    JOIN pg_depend d ON d.classid = c.classid AND d.objid = c.objid
)
SELECT jsonb_build_object('kind', 'object_dependency', 'type', i.type, 'schema', i.schema,
  'name', i.name, 'identity', i.identity,
  'root', EXISTS (SELECT FROM roots r WHERE r.classid = c.classid AND r.objid = c.objid),
  'routine_definition', CASE WHEN c.classid = 'pg_proc'::regclass AND p.prokind IN ('f', 'p')
    THEN pg_get_functiondef(p.oid) ELSE NULL END,
  'extension', (SELECT e.extname FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
    WHERE d.classid = c.classid AND d.objid = c.objid AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e' LIMIT 1))
FROM closure c CROSS JOIN LATERAL pg_identify_object(c.classid, c.objid, 0) i
LEFT JOIN pg_proc p ON c.classid = 'pg_proc'::regclass AND p.oid = c.objid
WHERE coalesce(i.schema, '') NOT IN ('pg_catalog', 'information_schema')
ORDER BY i.type, i.schema, i.identity;

-- Dependencias entre DBs/roles y objetos no cubiertos por el closure: revision manual.
SELECT jsonb_build_object('kind', 'database_settings', 'database', current_database(),
  'settings', (SELECT jsonb_agg(jsonb_build_object('role', setrole::regrole::text, 'config', setconfig))
    FROM pg_db_role_setting WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())),
  'extensions', (SELECT jsonb_agg(jsonb_build_object('name', extname, 'version', extversion,
    'schema', extnamespace::regnamespace::text) ORDER BY extname) FROM pg_extension),
  'event_triggers', (SELECT jsonb_agg(jsonb_build_object('name', evtname,
    'enabled', evtenabled, 'function', evtfoid::regprocedure::text) ORDER BY evtname) FROM pg_event_trigger));
ROLLBACK;
