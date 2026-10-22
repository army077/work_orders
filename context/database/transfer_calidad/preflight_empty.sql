-- SOLO PREPARADO. psql -X; requiere las cuatro variables expected_*.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
\ir identity.psql
SELECT 1 / (((:'transfer_mode' = 'production' AND current_database() = 'calidad')
  OR (:'transfer_mode' = 'local_rehearsal' AND current_database() = 'calidad_test_local'))::integer) AS destination_guard
\gset
-- \dt vacio no descarta vistas, secuencias, tipos, rutinas o extensiones.
WITH objects AS (
  SELECT 'relation' AS kind, format('%I.%I', n.nspname, c.relname) AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT 'routine', p.oid::regprocedure::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT 'type', format('%I.%I', n.nspname, t.typname)
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
  UNION ALL
  SELECT 'schema', nspname FROM pg_namespace
    WHERE nspname !~ '^pg_' AND nspname NOT IN ('public', 'information_schema')
  UNION ALL
  SELECT 'extension', extname FROM pg_extension WHERE extname <> 'plpgsql'
  UNION ALL
  SELECT 'event_trigger', evtname FROM pg_event_trigger
  UNION ALL
  SELECT 'foreign_server', srvname FROM pg_foreign_server
  UNION ALL
  SELECT 'publication', pubname FROM pg_publication
  UNION ALL
  SELECT 'subscription', subname FROM pg_subscription
    WHERE subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  UNION ALL
  SELECT 'large_objects', 'pg_largeobject_metadata' WHERE EXISTS (SELECT FROM pg_largeobject_metadata)
)
SELECT jsonb_build_object('kind', 'empty_preflight', 'database', current_database(),
  'empty', count(*) = 0, 'objects', coalesce(jsonb_agg(to_jsonb(objects) ORDER BY kind, name), '[]'))
FROM objects;
SELECT jsonb_build_object('kind', 'database_settings', 'encoding', pg_encoding_to_char(encoding),
  'collation', datcollate, 'ctype', datctype, 'provider', datlocprovider,
  'icu_locale', daticulocale, 'collation_version', datcollversion,
  'actual_collation_version', pg_database_collation_actual_version(oid),
  'owner', pg_get_userbyid(datdba), 'acl', datacl,
  'settings', (SELECT jsonb_agg(jsonb_build_object('role', setrole::regrole::text, 'config', setconfig))
    FROM pg_db_role_setting WHERE setdatabase = d.oid))
FROM pg_database d WHERE datname = current_database();
ROLLBACK;
