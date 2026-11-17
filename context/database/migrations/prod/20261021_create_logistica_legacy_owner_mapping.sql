-- PROD: ejecutar solamente mediante apply_logistica_migration_prod.js.
-- Sin backfill, usuarios, ownership, HTTP ni acceso a Drive.
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $guard$
BEGIN
  IF current_database() IS DISTINCT FROM 'calidad'
     OR current_user IS DISTINCT FROM session_user
     OR current_user = 'workorders_test'
     OR current_setting('logistica.confirm_production',true) IS DISTINCT FROM 'calidad'
     OR current_setting('logistica.expected_user',true) IS DISTINCT FROM current_user::text
     OR coalesce(current_setting('logistica.expected_server_address',true),'') = ''
     OR current_setting('logistica.expected_server_address',true) IS DISTINCT FROM host(inet_server_addr())
     OR current_setting('logistica.expected_server_port',true) IS DISTINCT FROM inet_server_port()::text
     OR inet_server_addr() IS NULL
     OR current_setting('server_version_num')::int / 10000 <> 16
     OR current_setting('logistica.migration_name',true) IS DISTINCT FROM '20261021_create_logistica_legacy_owner_mapping.sql'
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

IF actual_hash IS DISTINCT FROM 'a26d7758ff94786b2d3beb3f7a559e78f2270d5adafb67e52e6770989e9713d2' THEN
  RAISE EXCEPTION 'LOGISTICA_SCHEMA_DRIFT_OR_ALREADY_APPLIED';
END IF;
END;
$shape$;
DO $ledger$
DECLARE actual jsonb;
BEGIN
  SELECT coalesce(jsonb_object_agg(migration_name,migration_sha256),'{}'::jsonb)
    INTO actual FROM public.logistica_schema_migrations;
  IF actual IS DISTINCT FROM '{"20261016_create_logistica_authorized_users.sql":"fc648e1e00f21c70bada0d7cdbd08bfcb7b6280e794ae4bbb0b05e3c2eb84844","20261016_create_logistica_deliveries.sql":"caaf530fba5860f6e7b2e1fe0659d66bef0de1bcebafa35e6241811c31504382","20261019_extend_logistica_delivery_evidence.sql":"25a31baa36e135424bcef69dc2ef73bec7c64d8c0cc7adcbcb4af7e50cf42f35","20261019_add_logistica_delivery_drive_folder.sql":"6bc3c84bd0cc830467e7f0d3dc7a72065aa72c0d259d7935663a95684f8e9f25","20261020_add_logistica_delivery_completion.sql":"9a44b2246d10d84612420f8d2cd15482238e56b4b65b3bbda96cfd5377aea8d0","20261021_create_entregas_logistica_legacy.sql":"f9e6bf843dd9dd4c8310b1af0e6b6bb6385ab7ea7ebaf6809a229e1952d35bef"}'::jsonb THEN
    RAISE EXCEPTION 'MIGRATION_CHECKSUM_OR_ORDER_MISMATCH';
  END IF;
END;
$ledger$;
-- BEGIN LOGISTICA DDL
CREATE TABLE public.logistica_legacy_owner_mapping (
    id BIGSERIAL PRIMARY KEY,
    -- Comparacion exacta y determinista. Nunca lower/trim/unaccent en la identidad.
    source_snapshot_sha256 TEXT COLLATE "C" NOT NULL,
    source_sheet TEXT COLLATE "C" NOT NULL,
    legacy_usuario TEXT COLLATE "C" NOT NULL,
    legacy_correo TEXT COLLATE "C" NOT NULL,
    authorized_user_id BIGINT NOT NULL,
    approval_basis TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT true,
    revoked_at TIMESTAMPTZ,
    revoked_by TEXT,
    revocation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT logistica_legacy_owner_mapping_user_fk
        FOREIGN KEY (authorized_user_id)
        REFERENCES public.logistica_authorized_users(id) ON DELETE RESTRICT,
    CONSTRAINT logistica_legacy_owner_mapping_source_chk
        CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'
            AND source_sheet !~ '^[[:space:]]*$'
            AND legacy_usuario !~ '^[[:space:]]*$'
            AND legacy_correo !~ '^[[:space:]]*$'),
    CONSTRAINT logistica_legacy_owner_mapping_basis_chk
        CHECK (approval_basis !~ '^[[:space:]]*$'),
    -- Rechaza los fundamentos insuficientes literales indicados por la politica.
    -- No pretende decidir la suficiencia semantica de un texto: eso es humano.
    CONSTRAINT logistica_legacy_owner_mapping_weak_basis_chk
        CHECK (approval_basis !~*
            '^[[:space:]]*(mismo[[:space:]]+correo|mismo[[:space:]]+nombre|Firebase[[:space:]]+encontr[oó][[:space:]]+el[[:space:]]+email|Workspace[[:space:]]+tiene[[:space:]]+actualmente[[:space:]]+esa[[:space:]]+direcci[oó]n)[[:space:].!]*$'),
    CONSTRAINT logistica_legacy_owner_mapping_approver_chk
        CHECK (approved_by !~ '^[[:space:]]*$'),
    CONSTRAINT logistica_legacy_owner_mapping_time_chk
        CHECK (isfinite(approved_at) AND isfinite(created_at) AND isfinite(updated_at)
            AND approved_at <= created_at AND updated_at >= created_at),
    CONSTRAINT logistica_legacy_owner_mapping_revocation_chk
        CHECK (
            (is_active AND revoked_at IS NULL AND revoked_by IS NULL
                AND revocation_reason IS NULL)
            OR
            (NOT is_active AND revoked_at IS NOT NULL AND isfinite(revoked_at)
                AND revoked_at >= approved_at AND revoked_at >= created_at
                AND updated_at >= revoked_at
                AND revoked_by IS NOT NULL AND revoked_by !~ '^[[:space:]]*$'
                AND revocation_reason IS NOT NULL
                AND revocation_reason !~ '^[[:space:]]*$')
        )
);

CREATE UNIQUE INDEX logistica_legacy_owner_mapping_active_uk
    ON public.logistica_legacy_owner_mapping
        (source_snapshot_sha256, source_sheet, legacy_usuario, legacy_correo)
    WHERE is_active;

CREATE INDEX logistica_legacy_owner_mapping_user_idx
    ON public.logistica_legacy_owner_mapping (authorized_user_id);

-- Estos triggers SOLO protegen auditoria. No consultan emails, Firebase,
-- Workspace, datos legacy ni crean mappings en ninguna tabla.
CREATE FUNCTION public.protect_logistica_legacy_owner_mapping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'logistica_legacy_owner_mapping_history_guard',
            MESSAGE = 'El historial no se borra: se requiere revocacion explicita';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.is_active IS DISTINCT FROM true
           OR NEW.revoked_at IS NOT NULL
           OR NEW.revoked_by IS NOT NULL
           OR NEW.revocation_reason IS NOT NULL THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                CONSTRAINT = 'logistica_legacy_owner_mapping_initial_guard',
                MESSAGE = 'Una aprobacion nueva debe iniciar activa y sin revocacion';
        END IF;
        -- Metadatos de registro del servidor; nunca generan fundamento/aprobador.
        NEW.created_at := clock_timestamp();
        NEW.updated_at := NEW.created_at;
        RETURN NEW;
    END IF;
    IF NOT OLD.is_active THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'logistica_legacy_owner_mapping_revoked_guard',
            MESSAGE = 'Una aprobacion revocada es inmutable';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['is_active', 'revoked_at', 'revoked_by',
            'revocation_reason', 'updated_at'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['is_active', 'revoked_at', 'revoked_by',
            'revocation_reason', 'updated_at']) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'logistica_legacy_owner_mapping_approval_guard',
            MESSAGE = 'La aprobacion original no se modifica; revocar y aprobar otra';
    END IF;
    IF NEW.is_active IS DISTINCT FROM false THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'logistica_legacy_owner_mapping_transition_guard',
            MESSAGE = 'La unica actualizacion permitida es una revocacion explicita';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE TRIGGER logistica_legacy_owner_mapping_row_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.logistica_legacy_owner_mapping
    FOR EACH ROW EXECUTE FUNCTION public.protect_logistica_legacy_owner_mapping();

CREATE TRIGGER logistica_legacy_owner_mapping_truncate_guard
    BEFORE TRUNCATE ON public.logistica_legacy_owner_mapping
    FOR EACH STATEMENT EXECUTE FUNCTION public.protect_logistica_legacy_owner_mapping();

COMMENT ON TABLE public.logistica_legacy_owner_mapping IS
    'Conciliacion manual auditable. Una identidad tecnica actual no prueba quien realizo una entrega historica. Sin mappings iniciales ni automatismos.';
COMMENT ON COLUMN public.logistica_legacy_owner_mapping.approval_basis IS
    'Fundamento humano obligatorio. Coincidencia de correo/nombre, Firebase o Workspace no basta. Los CHECK no sustituyen revision administrativa.';
COMMENT ON COLUMN public.logistica_legacy_owner_mapping.legacy_usuario IS
    'Exacto, sin fusionar variantes. CHOFER FORANEO y Choferes AR son cuentas potencialmente compartidas: no autoasignar.';
COMMENT ON COLUMN public.logistica_legacy_owner_mapping.authorized_user_id IS
    'Destino tecnico aprobado, no evidencia automatica de autoria historica. Reasignacion solo por revocacion y nueva fila.';
COMMENT ON COLUMN public.logistica_legacy_owner_mapping.source_sheet IS
    'Scope exacto junto a snapshot, usuario y correo. Si una cuenta compartida tiene varios autores, se necesitara una excepcion futura por legacy_key; NO usar mapping global. Excepcion aun no implementada.';
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

IF actual_hash IS DISTINCT FROM 'c7e7d4d23745580b151b7b8876b35023ecc0cd8e908f0f79cb46f2417582bead' THEN
  RAISE EXCEPTION 'LOGISTICA_POST_SCHEMA_DRIFT';
END IF;
END;
$shape$;
INSERT INTO public.logistica_schema_migrations(migration_name,migration_sha256)
  VALUES ('20261021_create_logistica_legacy_owner_mapping.sql',current_setting('logistica.migration_sha256'));
COMMIT;
