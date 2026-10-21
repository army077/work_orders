-- PROD: ejecutar solamente mediante apply_logistica_migration_prod.js.
-- Sin backfill, usuarios, ownership, HTTP ni acceso a Drive.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF current_database() IS DISTINCT FROM 'artecnologia'
     OR current_user IS DISTINCT FROM session_user
     OR current_user = 'workorders_test'
     OR current_setting('logistica.confirm_production',true) IS DISTINCT FROM 'artecnologia'
     OR current_setting('logistica.expected_user',true) IS DISTINCT FROM current_user::text
     OR coalesce(current_setting('logistica.expected_server_address',true),'') = ''
     OR current_setting('logistica.expected_server_address',true) IS DISTINCT FROM host(inet_server_addr())
     OR current_setting('logistica.expected_server_port',true) IS DISTINCT FROM inet_server_port()::text
     OR inet_server_addr() IS NULL
     OR current_setting('server_version_num')::int / 10000 <> 16
     OR current_setting('logistica.migration_name',true) IS DISTINCT FROM '20261019_extend_logistica_delivery_evidence.sql'
     OR coalesce(current_setting('logistica.migration_sha256',true),'') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'PROD_IDENTITY_OR_APPROVAL_REQUIRED';
  END IF;
END;
$guard$;
SELECT pg_advisory_xact_lock(2026102101);
DO $locks$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['logistica_authorized_users','logistica_deliveries','logistica_delivery_evidence','entregas_logistica_legacy','logistica_legacy_owner_mapping','logistica_schema_migrations'] LOOP
    IF to_regclass('public.'||name) IS NOT NULL THEN
      EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',name);
    END IF;
  END LOOP;
END;
$locks$;
DO $shape$
DECLARE actual_hash text;
BEGIN
WITH settings AS (SELECT 'public'::text AS ns),
names(name) AS (VALUES
  ('logistica_authorized_users'), ('logistica_deliveries'),
  ('logistica_delivery_evidence'), ('entregas_logistica_legacy'),
  ('logistica_legacy_owner_mapping'), ('logistica_schema_migrations')),
relations AS (
  SELECT n.name, c.*, s.ns FROM names n CROSS JOIN settings s
  LEFT JOIN pg_class c ON c.oid = to_regclass(format('%I.%I', s.ns, n.name))
),
tables AS (
  SELECT r.name, CASE WHEN r.oid IS NULL THEN NULL ELSE jsonb_build_object(
    'kind', r.relkind, 'persistence', CASE
      WHEN r.relpersistence='t' AND r.ns ~ '^pg_temp_[0-9]+$' THEN 'p'
      ELSE r.relpersistence::text END,
    'rls', r.relrowsecurity, 'force_rls', r.relforcerowsecurity,
    'columns', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,
      replace(pg_get_expr(d.adbin,d.adrelid),quote_ident(r.ns)||'.','public.'),
      a.attidentity,a.attgenerated,a.attcollation::regcollation::text
    ) ORDER BY a.attnum) FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
    'constraints', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,
      replace(pg_get_constraintdef(c.oid,true),quote_ident(r.ns)||'.','public.')
    ) ORDER BY c.conname COLLATE "C") FROM pg_constraint c WHERE c.conrelid=r.oid),'[]'::jsonb),
    'indexes', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      x.relname,i.indisvalid,i.indisready,
      replace(pg_get_indexdef(i.indexrelid),quote_ident(r.ns)||'.','public.')
    ) ORDER BY x.relname COLLATE "C") FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid
      WHERE i.indrelid=r.oid),'[]'::jsonb),
    'triggers', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      t.tgname,t.tgenabled,
      replace(pg_get_triggerdef(t.oid,true),quote_ident(r.ns)||'.','public.')
    ) ORDER BY t.tgname COLLATE "C") FROM pg_trigger t
      WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),'[]'::jsonb),
    'rules', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      w.rulename,replace(pg_get_ruledef(w.oid,true),quote_ident(r.ns)||'.','public.')
    ) ORDER BY w.rulename COLLATE "C") FROM pg_rewrite w WHERE w.ev_class=r.oid),'[]'::jsonb),
    'policies', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      p.polname,p.polcmd,p.polpermissive,p.polroles::text,
      pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)
    ) ORDER BY p.polname COLLATE "C") FROM pg_policy p WHERE p.polrelid=r.oid),'[]'::jsonb),
    'inheritance', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      replace(i.inhparent::regclass::text,quote_ident(r.ns)||'.','public.'),
      replace(i.inhrelid::regclass::text,quote_ident(r.ns)||'.','public.')
    ) ORDER BY i.inhseqno) FROM pg_inherits i
      WHERE i.inhparent=r.oid OR i.inhrelid=r.oid),'[]'::jsonb)
  ) END AS detail FROM relations r
),
sequences AS (
  SELECT n.name||'_id_seq' AS name, CASE WHEN c.oid IS NULL THEN NULL ELSE
    jsonb_build_array(c.relkind,q.seqtypid::regtype::text,q.seqstart,q.seqincrement,
      q.seqmin,q.seqmax,q.seqcache,q.seqcycle,
      (SELECT jsonb_agg(jsonb_build_array(p.relname,d.refobjsubid,d.deptype)
       ORDER BY p.relname COLLATE "C") FROM pg_depend d
       JOIN pg_class p ON p.oid=d.refobjid
       WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype IN ('a','i')))
    END AS detail
  FROM names n CROSS JOIN settings s
  LEFT JOIN pg_class c ON c.oid=to_regclass(format('%I.%I',s.ns,n.name||'_id_seq'))
  LEFT JOIN pg_sequence q ON q.seqrelid=c.oid WHERE n.name<>'logistica_schema_migrations'
),
signature AS (SELECT jsonb_build_object(
  'tables',(SELECT jsonb_object_agg(name,detail) FROM tables),
  'sequences',(SELECT jsonb_object_agg(name,detail) FROM sequences),
  'mapping_functions',COALESCE((SELECT jsonb_agg(jsonb_build_array(
    p.proname,pg_get_function_identity_arguments(p.oid),p.prorettype::regtype::text,
    p.prosrc,p.prosecdef,p.provolatile,p.proconfig,l.lanname
  ) ORDER BY pg_get_function_identity_arguments(p.oid) COLLATE "C")
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang CROSS JOIN settings s
    WHERE n.nspname=s.ns AND p.proname='protect_logistica_legacy_owner_mapping'),'[]'::jsonb)
) AS shape)
SELECT encode(sha256(convert_to(shape::text,'UTF8')),'hex') INTO actual_hash FROM signature;

IF actual_hash IS DISTINCT FROM '10e86be74790e2177a4698d7419b10af4d8dc9e630a76f045adc18ce76e97dbe' THEN
  RAISE EXCEPTION 'LOGISTICA_SCHEMA_DRIFT_OR_ALREADY_APPLIED';
END IF;
END;
$shape$;
DO $ledger$
DECLARE actual jsonb;
BEGIN
  SELECT coalesce(jsonb_object_agg(migration_name,migration_sha256),'{}'::jsonb)
    INTO actual FROM public.logistica_schema_migrations;
  IF actual IS DISTINCT FROM '{"20261016_create_logistica_authorized_users.sql":"fb17ed0c093292f7df11ad5e1862d59ffe4b2902e200ab33a334ce54ea3b4cd8","20261016_create_logistica_deliveries.sql":"7aa40d501685dffb2fd2847888bac1186be1d74c3f6fc7309aeb6df989a4e033"}'::jsonb THEN
    RAISE EXCEPTION 'MIGRATION_CHECKSUM_OR_ORDER_MISMATCH';
  END IF;
END;
$ledger$;
-- BEGIN LOGISTICA DDL
-- Mantiene estable la precondicion mientras se agrega la columna NOT NULL.
LOCK TABLE public.logistica_delivery_evidence IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.logistica_delivery_evidence) THEN
        RAISE EXCEPTION
            'Se requiere logistica_delivery_evidence vacia; definir un backfill explicito antes de migrar evidencias existentes';
    END IF;
END;
$$;

ALTER TABLE public.logistica_delivery_evidence
    ADD COLUMN client_evidence_id UUID NOT NULL,
    ADD COLUMN status TEXT NOT NULL DEFAULT 'PENDING',
    ADD COLUMN processing_token UUID,
    ADD COLUMN processing_expires_at TIMESTAMPTZ,
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD CONSTRAINT logistica_delivery_evidence_client_evidence_uk
        UNIQUE (client_evidence_id),
    ADD CONSTRAINT logistica_delivery_evidence_status_chk
        CHECK (status IN ('PENDING', 'UPLOADED', 'FAILED')),
    ADD CONSTRAINT logistica_delivery_evidence_processing_pair_chk
        CHECK ((processing_token IS NULL) = (processing_expires_at IS NULL)),
    ADD CONSTRAINT logistica_delivery_evidence_uploaded_metadata_chk
        CHECK (
            status <> 'UPLOADED'
            OR (
                -- Un CHECK acepta UNKNOWN: los IS NOT NULL son deliberados.
                storage_provider IS NOT NULL
                AND storage_provider = 'GOOGLE_DRIVE'
                AND external_file_id IS NOT NULL
                AND btrim(external_file_id) <> ''
                AND mime_type IS NOT NULL
                AND btrim(mime_type) <> ''
                AND file_size_bytes IS NOT NULL
                AND file_size_bytes > 0
                AND sha256 IS NOT NULL
                AND sha256 ~ '^[0-9A-Fa-f]{64}$'
            )
        );

-- Conserva todas las restricciones originales, incluida la firma unica.
-- La referencia externa puede reservarse antes de subir; no prueba el upload.
-- PENDING/FAILED admiten metadata parcial para reconciliacion posterior.
CREATE UNIQUE INDEX logistica_delivery_evidence_external_file_uk
    ON public.logistica_delivery_evidence (storage_provider, external_file_id)
    WHERE external_file_id IS NOT NULL;

-- Sin triggers, bytes, Base64, finalizacion ni limite de cantidad de fotos.
-- END LOGISTICA DDL
DO $shape$
DECLARE actual_hash text;
BEGIN
WITH settings AS (SELECT 'public'::text AS ns),
names(name) AS (VALUES
  ('logistica_authorized_users'), ('logistica_deliveries'),
  ('logistica_delivery_evidence'), ('entregas_logistica_legacy'),
  ('logistica_legacy_owner_mapping'), ('logistica_schema_migrations')),
relations AS (
  SELECT n.name, c.*, s.ns FROM names n CROSS JOIN settings s
  LEFT JOIN pg_class c ON c.oid = to_regclass(format('%I.%I', s.ns, n.name))
),
tables AS (
  SELECT r.name, CASE WHEN r.oid IS NULL THEN NULL ELSE jsonb_build_object(
    'kind', r.relkind, 'persistence', CASE
      WHEN r.relpersistence='t' AND r.ns ~ '^pg_temp_[0-9]+$' THEN 'p'
      ELSE r.relpersistence::text END,
    'rls', r.relrowsecurity, 'force_rls', r.relforcerowsecurity,
    'columns', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,
      replace(pg_get_expr(d.adbin,d.adrelid),quote_ident(r.ns)||'.','public.'),
      a.attidentity,a.attgenerated,a.attcollation::regcollation::text
    ) ORDER BY a.attnum) FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb),
    'constraints', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      c.conname,c.contype,c.convalidated,c.condeferrable,c.condeferred,
      replace(pg_get_constraintdef(c.oid,true),quote_ident(r.ns)||'.','public.')
    ) ORDER BY c.conname COLLATE "C") FROM pg_constraint c WHERE c.conrelid=r.oid),'[]'::jsonb),
    'indexes', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      x.relname,i.indisvalid,i.indisready,
      replace(pg_get_indexdef(i.indexrelid),quote_ident(r.ns)||'.','public.')
    ) ORDER BY x.relname COLLATE "C") FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid
      WHERE i.indrelid=r.oid),'[]'::jsonb),
    'triggers', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      t.tgname,t.tgenabled,
      replace(pg_get_triggerdef(t.oid,true),quote_ident(r.ns)||'.','public.')
    ) ORDER BY t.tgname COLLATE "C") FROM pg_trigger t
      WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),'[]'::jsonb),
    'rules', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      w.rulename,replace(pg_get_ruledef(w.oid,true),quote_ident(r.ns)||'.','public.')
    ) ORDER BY w.rulename COLLATE "C") FROM pg_rewrite w WHERE w.ev_class=r.oid),'[]'::jsonb),
    'policies', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      p.polname,p.polcmd,p.polpermissive,p.polroles::text,
      pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)
    ) ORDER BY p.polname COLLATE "C") FROM pg_policy p WHERE p.polrelid=r.oid),'[]'::jsonb),
    'inheritance', COALESCE((SELECT jsonb_agg(jsonb_build_array(
      replace(i.inhparent::regclass::text,quote_ident(r.ns)||'.','public.'),
      replace(i.inhrelid::regclass::text,quote_ident(r.ns)||'.','public.')
    ) ORDER BY i.inhseqno) FROM pg_inherits i
      WHERE i.inhparent=r.oid OR i.inhrelid=r.oid),'[]'::jsonb)
  ) END AS detail FROM relations r
),
sequences AS (
  SELECT n.name||'_id_seq' AS name, CASE WHEN c.oid IS NULL THEN NULL ELSE
    jsonb_build_array(c.relkind,q.seqtypid::regtype::text,q.seqstart,q.seqincrement,
      q.seqmin,q.seqmax,q.seqcache,q.seqcycle,
      (SELECT jsonb_agg(jsonb_build_array(p.relname,d.refobjsubid,d.deptype)
       ORDER BY p.relname COLLATE "C") FROM pg_depend d
       JOIN pg_class p ON p.oid=d.refobjid
       WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype IN ('a','i')))
    END AS detail
  FROM names n CROSS JOIN settings s
  LEFT JOIN pg_class c ON c.oid=to_regclass(format('%I.%I',s.ns,n.name||'_id_seq'))
  LEFT JOIN pg_sequence q ON q.seqrelid=c.oid WHERE n.name<>'logistica_schema_migrations'
),
signature AS (SELECT jsonb_build_object(
  'tables',(SELECT jsonb_object_agg(name,detail) FROM tables),
  'sequences',(SELECT jsonb_object_agg(name,detail) FROM sequences),
  'mapping_functions',COALESCE((SELECT jsonb_agg(jsonb_build_array(
    p.proname,pg_get_function_identity_arguments(p.oid),p.prorettype::regtype::text,
    p.prosrc,p.prosecdef,p.provolatile,p.proconfig,l.lanname
  ) ORDER BY pg_get_function_identity_arguments(p.oid) COLLATE "C")
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang CROSS JOIN settings s
    WHERE n.nspname=s.ns AND p.proname='protect_logistica_legacy_owner_mapping'),'[]'::jsonb)
) AS shape)
SELECT encode(sha256(convert_to(shape::text,'UTF8')),'hex') INTO actual_hash FROM signature;

IF actual_hash IS DISTINCT FROM 'cd18eb00c206d910d23350676b22f0be9d8b1855d0a2119c986ca857795df772' THEN
  RAISE EXCEPTION 'LOGISTICA_POST_SCHEMA_DRIFT';
END IF;
END;
$shape$;
INSERT INTO public.logistica_schema_migrations(migration_name,migration_sha256)
  VALUES ('20261019_extend_logistica_delivery_evidence.sql',current_setting('logistica.migration_sha256'));
COMMIT;
