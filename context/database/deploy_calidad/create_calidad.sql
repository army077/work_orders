-- GENERATED OFFLINE by build_clean_baseline.mjs. PostgreSQL 16 / HeidiSQL.
-- Clean installation only. Never execute incremental migrations after this baseline.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL timezone = 'UTC';
DO $identity$ BEGIN
 IF current_database() IS DISTINCT FROM 'calidad' THEN RAISE EXCEPTION 'DATABASE_MUST_BE_CALIDAD'; END IF;
 IF current_setting('server_version_num')::int / 10000 <> 16 THEN RAISE EXCEPTION 'POSTGRESQL_16_REQUIRED'; END IF;
END; $identity$;
SELECT pg_advisory_xact_lock(2026102101);
DO $empty$ DECLARE issue text; BEGIN
 WITH RECURSIVE installed_extensions AS (
 SELECT e.oid,e.extname AS name,n.nspname AS schema,e.extversion AS version
 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
), extension_members(classid,objid,extension_oid) AS (
 -- Only extension membership ('e') and internal implementation ('i') are infrastructure.
 -- A normal dependency on an extension type/function does not imply membership.
 SELECT d.classid,d.objid,e.oid FROM pg_depend d JOIN installed_extensions e ON e.oid=d.refobjid
 WHERE d.refclassid='pg_extension'::regclass AND d.deptype='e' AND d.objsubid=0 AND d.refobjsubid=0
 UNION
 SELECT d.classid,d.objid,m.extension_oid FROM extension_members m JOIN pg_depend d
 ON d.refclassid=m.classid AND d.refobjid=m.objid
 WHERE d.deptype='i' AND d.objsubid=0 AND d.refobjsubid=0
), extension_infrastructure AS (
 SELECT 'pg_extension'::regclass::oid AS classid,oid AS objid,oid AS extension_oid FROM installed_extensions
 UNION SELECT classid,objid,extension_oid FROM extension_members
), objects AS (
 SELECT 'pg_class'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.relname::text AS name
 FROM pg_class o JOIN pg_namespace n ON n.oid=o.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_proc'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.proname::text AS name
 FROM pg_proc o JOIN pg_namespace n ON n.oid=o.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_type'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.typname::text AS name
 FROM pg_type o JOIN pg_namespace n ON n.oid=o.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_collation'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.collname::text AS name
 FROM pg_collation o JOIN pg_namespace n ON n.oid=o.collnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_conversion'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.conname::text AS name
 FROM pg_conversion o JOIN pg_namespace n ON n.oid=o.connamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_operator'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.oprname::text AS name
 FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_opclass'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.opcname::text AS name
 FROM pg_opclass o JOIN pg_namespace n ON n.oid=o.opcnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_opfamily'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.opfname::text AS name
 FROM pg_opfamily o JOIN pg_namespace n ON n.oid=o.opfnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL SELECT 'pg_trigger'::regclass::oid,t.oid,n.nspname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL SELECT 'pg_namespace'::regclass::oid,n.oid,n.nspname,n.nspname FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_' AND n.nspname<>'public'
 UNION ALL SELECT 'pg_event_trigger'::regclass::oid,oid,'',evtname FROM pg_event_trigger
 UNION ALL SELECT 'pg_foreign_server'::regclass::oid,oid,'',srvname FROM pg_foreign_server
 UNION ALL SELECT 'pg_foreign_data_wrapper'::regclass::oid,oid,'',fdwname FROM pg_foreign_data_wrapper
 UNION ALL SELECT 'pg_publication'::regclass::oid,oid,'',pubname FROM pg_publication
 UNION ALL SELECT 'pg_subscription'::regclass::oid,oid,'',subname FROM pg_subscription WHERE subdbid=(SELECT oid FROM pg_database WHERE datname=current_database())
 UNION ALL SELECT 'pg_largeobject_metadata'::regclass::oid,oid,'',oid::text FROM pg_largeobject_metadata
), application_objects AS (
 SELECT o.* FROM objects o WHERE NOT EXISTS(SELECT FROM extension_infrastructure e WHERE e.classid=o.classid AND e.objid=o.objid)
)
 SELECT string_agg(schema||'.'||name,', ' ORDER BY schema,name) INTO issue FROM application_objects;
 IF issue IS NOT NULL THEN RAISE EXCEPTION 'APPLICATION_OBJECTS_ALREADY_PRESENT: %',issue; END IF;
 IF to_regnamespace('public') IS NULL THEN RAISE EXCEPTION 'PUBLIC_SCHEMA_REQUIRED'; END IF;
 IF EXISTS(SELECT FROM unnest(ARRAY['plpgsql','citext']) required(name) WHERE NOT EXISTS(SELECT FROM pg_extension e WHERE e.extname=required.name)) THEN RAISE EXCEPTION 'PLPGSQL_AND_CITEXT_EXTENSIONS_REQUIRED'; END IF;
END; $empty$;

CREATE TABLE public.template_section (
  "id" SERIAL NOT NULL,
  "template_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT template_section_template_id_position_key UNIQUE ("template_id", "position")
);

CREATE TABLE public.template_task_inspection (
  "id" SERIAL NOT NULL,
  "section_id" INTEGER NOT NULL,
  "revision_point" TEXT NOT NULL,
  "specs" TEXT NULL DEFAULT NULL,
  "suggestions" TEXT NULL DEFAULT NULL,
  "required" BOOLEAN NULL DEFAULT true,
  "position" INTEGER NOT NULL DEFAULT 1,
  "category" TEXT NULL DEFAULT 'Mecanica',
  PRIMARY KEY ("id")
);

CREATE TABLE public.machine_family (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE public.machine_customs (
  "id" SERIAL NOT NULL,
  "custom_title" TEXT NOT NULL,
  "custom_value" NUMERIC(10,2) NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE public.inspection_order_task (
  "id" SERIAL NOT NULL,
  "inspection_order_id" INTEGER NULL DEFAULT NULL,
  "template_task_inspection_id" INTEGER NULL DEFAULT NULL,
  "revision_point" VARCHAR(500) NULL DEFAULT NULL,
  "specs" TEXT NULL DEFAULT NULL,
  "suggestions" TEXT NULL DEFAULT NULL,
  "status" VARCHAR(50) NULL DEFAULT 'PENDING',
  "started_at" TIMESTAMP NULL DEFAULT NULL,
  "finished_at" TIMESTAMP NULL DEFAULT NULL,
  "actual_minutes" INTEGER NULL DEFAULT NULL,
  "comments" TEXT NULL DEFAULT NULL,
  "section_title" TEXT NULL DEFAULT NULL,
  "position" INTEGER NULL DEFAULT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE public.desviaciones_calidad (
  "id" SERIAL NOT NULL,
  "id_actividad" INTEGER NOT NULL,
  "correo" VARCHAR(120) NULL DEFAULT NULL,
  "usuario" VARCHAR(120) NULL DEFAULT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "serial_number" VARCHAR(120) NULL DEFAULT NULL,
  "afected_machine" VARCHAR(200) NULL DEFAULT NULL,
  "num_revision" INTEGER NULL DEFAULT NULL,
  "nombre_tecnico" VARCHAR(120) NULL DEFAULT NULL,
  "parte_afectada" VARCHAR(200) NULL DEFAULT NULL,
  "causa_raiz" VARCHAR(200) NULL DEFAULT NULL,
  "clasificacion_defecto" VARCHAR(120) NULL DEFAULT NULL,
  "tipo_defectivo" VARCHAR(120) NULL DEFAULT NULL,
  "clasificacion_defectivo" VARCHAR(200) NULL DEFAULT NULL,
  "comentarios" TEXT NULL DEFAULT NULL,
  "evidencias" JSONB NULL DEFAULT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE public.plantilla_tecnicos (
  "id" SERIAL NOT NULL,
  "estatus" VARCHAR(50) NOT NULL,
  "sucursal" VARCHAR(50) NOT NULL,
  "nombre_tecnico" VARCHAR(50) NULL DEFAULT NULL,
  "correo_tecnico" VARCHAR(70) NOT NULL,
  "telefono" VARCHAR(20) NULL DEFAULT NULL,
  "puesto" VARCHAR(50) NULL DEFAULT NULL,
  "nombre_bonos" VARCHAR(70) NOT NULL,
  "numero_empleado" INTEGER NULL DEFAULT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE public.logistica_schema_migrations (
  migration_name TEXT PRIMARY KEY,
  migration_sha256 TEXT NOT NULL CHECK (migration_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by TEXT NOT NULL DEFAULT current_user
);

CREATE TABLE public.logistica_authorized_users (
  id BIGSERIAL PRIMARY KEY,
  firebase_project TEXT NOT NULL,
  firebase_uid TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT logistica_authorized_users_project_chk
        CHECK (firebase_project = 'logistica-ar'),
  CONSTRAINT logistica_authorized_users_uid_chk
        CHECK (btrim(firebase_uid) <> ''),
  CONSTRAINT logistica_authorized_users_project_uid_uk
        UNIQUE (firebase_project, firebase_uid)
);

CREATE TABLE public.entregas_logistica_legacy (
  id BIGSERIAL PRIMARY KEY,
  source_snapshot_sha256 TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  legacy_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  legacy_correlative TEXT,
  correo TEXT,
  usuario TEXT,
  fecha_raw TEXT,
  hora_raw TEXT,
  local_datetime TIMESTAMP WITHOUT TIME ZONE,
  pedido TEXT,
  equipo TEXT,
  chofer TEXT,
  observaciones TEXT,
  instalara TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  legacy_image_count INTEGER,
  drive_folder_url TEXT,
  drive_folder_id TEXT,
  ubicacion TEXT,
  app_version TEXT,
  ticket TEXT,
  informacion_correcta BOOLEAN,
  actualizado_zoho BOOLEAN,
  comentarios TEXT,
  raw_payload JSONB NOT NULL,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  import_batch_id UUID NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT entregas_logistica_legacy_key_uk UNIQUE (legacy_key),
  CONSTRAINT entregas_logistica_legacy_source_uk
        UNIQUE (source_snapshot_sha256, source_sheet, source_row),
  CONSTRAINT entregas_logistica_legacy_snapshot_chk
        CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT entregas_logistica_legacy_key_chk
        CHECK (legacy_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT entregas_logistica_legacy_content_chk
        CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT entregas_logistica_legacy_source_chk
        CHECK (source_sheet = 'Entregas' AND source_row >= 2),
  CONSTRAINT entregas_logistica_legacy_payload_chk
        CHECK (jsonb_typeof(raw_payload) = 'object'),
  CONSTRAINT entregas_logistica_legacy_warnings_chk
        CHECK (jsonb_typeof(warnings) = 'array')
);

CREATE TABLE public.template_task (
  "id" SERIAL NOT NULL,
  "section_id" INTEGER NOT NULL,
  "code" TEXT NULL DEFAULT NULL,
  "title" TEXT NOT NULL,
  "expected_minutes" INTEGER NOT NULL DEFAULT 0,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "position" INTEGER NOT NULL,
  "category" VARCHAR(255) NULL DEFAULT 'Mantenimiento',
  PRIMARY KEY ("id"),
  CONSTRAINT template_task_section_id_position_key UNIQUE ("section_id", "position"),
  CONSTRAINT "template_task_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES public."template_section" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE public.machine_model (
  "id" SERIAL NOT NULL,
  "family_id" INTEGER NULL DEFAULT NULL,
  "name" TEXT NOT NULL,
  "manufacturer" TEXT NULL DEFAULT NULL,
  "bond_value" NUMERIC NULL DEFAULT NULL,
  "standard_days" NUMERIC NULL DEFAULT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT machine_model_family_id_name_key UNIQUE ("family_id", "name"),
  CONSTRAINT "machine_model_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES public."machine_family" ("id") ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE public.logistica_deliveries (
  id BIGSERIAL PRIMARY KEY,
  client_request_id UUID NOT NULL,
  authorized_user_id BIGINT NOT NULL,
  firebase_project TEXT NOT NULL,
  firebase_uid TEXT NOT NULL,
  auth_email TEXT,
  auth_display_name TEXT,
  pedido TEXT NOT NULL,
  equipos TEXT NOT NULL,
  chofer TEXT NOT NULL,
  observaciones TEXT,
  instalara TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  app_version TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_EVIDENCE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT logistica_deliveries_client_request_uk
        UNIQUE (client_request_id),
  CONSTRAINT logistica_deliveries_authorized_user_fk
        FOREIGN KEY (authorized_user_id)
        REFERENCES public.logistica_authorized_users(id)
        ON DELETE RESTRICT,
  CONSTRAINT logistica_deliveries_project_chk
        CHECK (firebase_project = 'logistica-ar'),
  CONSTRAINT logistica_deliveries_uid_chk
        CHECK (btrim(firebase_uid) <> ''),
  CONSTRAINT logistica_deliveries_pedido_chk
        CHECK (btrim(pedido) <> ''),
  CONSTRAINT logistica_deliveries_equipos_chk
        CHECK (btrim(equipos) <> ''),
  CONSTRAINT logistica_deliveries_chofer_chk
        CHECK (btrim(chofer) <> ''),
  CONSTRAINT logistica_deliveries_latitude_chk
        CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT logistica_deliveries_longitude_chk
        CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT logistica_deliveries_coordinates_chk
        CHECK (
            (latitude IS NULL AND longitude IS NULL)
            OR (latitude IS NOT NULL AND longitude IS NOT NULL)
        ),
  CONSTRAINT logistica_deliveries_status_chk
        CHECK (status IN ('PENDING_EVIDENCE', 'COMPLETED', 'FAILED')),
  drive_folder_id TEXT,
  CONSTRAINT logistica_deliveries_drive_folder_chk
        CHECK (drive_folder_id IS NULL OR btrim(drive_folder_id) <> ''),
  completion_latitude NUMERIC NULL,
  completion_longitude NUMERIC NULL,
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT logistica_deliveries_completion_pair_chk
        CHECK ((completion_latitude IS NULL) = (completion_longitude IS NULL)),
  CONSTRAINT logistica_deliveries_completion_latitude_chk
        CHECK (completion_latitude BETWEEN -90 AND 90),
  CONSTRAINT logistica_deliveries_completion_longitude_chk
        CHECK (completion_longitude BETWEEN -180 AND 180),
  CONSTRAINT logistica_deliveries_completed_metadata_chk
        CHECK (status <> 'COMPLETED' OR (
            completed_at IS NOT NULL
            AND completion_latitude IS NOT NULL
            AND completion_longitude IS NOT NULL
        ))
);

CREATE TABLE public.logistica_legacy_owner_mapping (
  id BIGSERIAL PRIMARY KEY,
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

CREATE TABLE public.maintenance_template (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "template_type" TEXT NOT NULL,
  "model_id" INTEGER NULL DEFAULT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "created_by" TEXT NULL DEFAULT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "maintenance_template_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES public."machine_model" ("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "maintenance_template_template_type_check" CHECK (((template_type = ANY (ARRAY['MANTENIMIENTO'::text, 'INSTALACION'::text, 'DIAGNOSTICO'::text, 'REPARACION'::text, 'ENSAMBLE'::text, 'INSPECCION'::text]))))
);

CREATE TABLE public.logistica_delivery_evidence (
  id BIGSERIAL PRIMARY KEY,
  delivery_id BIGINT NOT NULL,
  evidence_type TEXT NOT NULL,
  sequence_no INTEGER NOT NULL,
  storage_provider TEXT,
  external_file_id TEXT,
  external_url TEXT,
  original_filename TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT logistica_delivery_evidence_delivery_fk
        FOREIGN KEY (delivery_id)
        REFERENCES public.logistica_deliveries(id)
        ON DELETE CASCADE,
  CONSTRAINT logistica_delivery_evidence_type_chk
        CHECK (evidence_type IN ('PHOTO', 'SIGNATURE')),
  CONSTRAINT logistica_delivery_evidence_sequence_chk
        CHECK (sequence_no > 0),
  CONSTRAINT logistica_delivery_evidence_sequence_uk
        UNIQUE (delivery_id, evidence_type, sequence_no),
  client_evidence_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  processing_token UUID,
  processing_expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT logistica_delivery_evidence_client_evidence_uk
        UNIQUE (client_evidence_id),
  CONSTRAINT logistica_delivery_evidence_status_chk
        CHECK (status IN ('PENDING', 'UPLOADED', 'FAILED')),
  CONSTRAINT logistica_delivery_evidence_processing_pair_chk
        CHECK ((processing_token IS NULL) = (processing_expires_at IS NULL)),
  CONSTRAINT logistica_delivery_evidence_uploaded_metadata_chk
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
        )
);

CREATE TABLE public.work_order (
  "id" SERIAL NOT NULL,
  "template_id" INTEGER NOT NULL,
  "template_version" INTEGER NOT NULL,
  "model_id" INTEGER NULL DEFAULT NULL,
  "machine_serial" TEXT NULL DEFAULT NULL,
  "customer_name" TEXT NULL DEFAULT NULL,
  "site_address" TEXT NULL DEFAULT NULL,
  "assigned_tech_email" TEXT NULL DEFAULT NULL,
  "status" TEXT NULL DEFAULT 'OPEN',
  "scheduled_at" TIMESTAMPTZ NULL DEFAULT NULL,
  "started_at" TIMESTAMPTZ NULL DEFAULT NULL,
  "finished_at" TIMESTAMPTZ NULL DEFAULT NULL,
  "created_at" TIMESTAMPTZ NULL DEFAULT NULL,
  "diagnostic_result" VARCHAR(255) NULL DEFAULT NULL::character varying,
  "tech_support" VARCHAR(255) NULL DEFAULT NULL,
  "folio_sai" VARCHAR(255) NULL DEFAULT NULL,
  "initial_status" VARCHAR(255) NULL DEFAULT NULL::character varying,
  "comments" VARCHAR(1000) NULL DEFAULT NULL,
  "extra_points" NUMERIC NULL DEFAULT NULL,
  "id_reserva" INTEGER NULL DEFAULT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "work_order_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES public."machine_model" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "work_order_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES public."maintenance_template" ("id") ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE TABLE public.inspection_order (
  "id" SERIAL NOT NULL,
  "inspection_template_id" INTEGER NULL DEFAULT NULL,
  "model_id" INTEGER NULL DEFAULT NULL,
  "assigned_tech_email" VARCHAR(255) NULL DEFAULT NULL::character varying,
  "status" VARCHAR(50) NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP NULL DEFAULT now(),
  "started_at" TIMESTAMP NULL DEFAULT NULL,
  "finished_at" TIMESTAMP NULL DEFAULT NULL,
  "work_order_id" INTEGER NULL DEFAULT NULL,
  "estacion" INTEGER NULL DEFAULT NULL,
  "inspection_type" VARCHAR(255) NULL DEFAULT NULL::character varying,
  "evidencias" JSONB NULL DEFAULT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "inspection_order_inspection_template_id_fkey" FOREIGN KEY ("inspection_template_id") REFERENCES public."maintenance_template" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "inspection_order_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES public."machine_model" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE public.work_order_task (
  "id" SERIAL NOT NULL,
  "work_order_id" INTEGER NOT NULL,
  "section_title" TEXT NOT NULL,
  "task_title" TEXT NOT NULL,
  "code" TEXT NULL DEFAULT NULL,
  "expected_minutes" INTEGER NOT NULL DEFAULT 0,
  "position" INTEGER NOT NULL,
  "status" VARCHAR NULL DEFAULT NULL,
  "observation" TEXT NULL DEFAULT NULL,
  "actual_minutes" INTEGER NULL DEFAULT NULL,
  "photo_url" TEXT NULL DEFAULT NULL,
  "started_at" TIMESTAMPTZ NULL DEFAULT NULL,
  "finished_at" TIMESTAMPTZ NULL DEFAULT NULL,
  "category" VARCHAR(255) NULL DEFAULT 'Mantenimiento',
  "extra_data" JSONB NULL DEFAULT '{}',
  PRIMARY KEY ("id"),
  CONSTRAINT work_order_task_work_order_id_position_key UNIQUE ("work_order_id", "position"),
  CONSTRAINT "work_order_task_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES public."work_order" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE public.work_order_customs (
  "id" SERIAL NOT NULL,
  "work_order_id" INTEGER NULL DEFAULT NULL,
  "custom_title" VARCHAR(255) NULL DEFAULT NULL,
  "custom_value" NUMERIC NULL DEFAULT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "work_order_customs_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES public."work_order" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE public.prod_delayments (
  "id" SERIAL NOT NULL,
  "id_actividad" INTEGER NULL DEFAULT NULL,
  "categoria_retraso" VARCHAR(255) NULL DEFAULT NULL,
  "tiempo_retraso" DOUBLE PRECISION NULL DEFAULT NULL,
  "comments" VARCHAR(1000) NULL DEFAULT NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "prod_delayments_id_actividad_fkey" FOREIGN KEY ("id_actividad") REFERENCES public."work_order_task" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE INDEX idx_work_order_diagnostic_result ON public.work_order ("diagnostic_result");

CREATE INDEX idx_section_template ON public.template_section ("template_id", "position");

CREATE INDEX idx_task_section ON public.template_task ("section_id", "position");

CREATE UNIQUE INDEX logistica_delivery_evidence_signature_uk
    ON public.logistica_delivery_evidence (delivery_id)
    WHERE evidence_type = 'SIGNATURE';

CREATE INDEX logistica_deliveries_pedido_idx
    ON public.logistica_deliveries (pedido);

CREATE INDEX logistica_deliveries_created_at_idx
    ON public.logistica_deliveries (created_at);

CREATE INDEX logistica_deliveries_authorized_user_idx
    ON public.logistica_deliveries (authorized_user_id);

CREATE INDEX logistica_deliveries_status_idx
    ON public.logistica_deliveries (status);

CREATE INDEX logistica_delivery_evidence_delivery_idx
    ON public.logistica_delivery_evidence (delivery_id);

CREATE UNIQUE INDEX logistica_delivery_evidence_external_file_uk
    ON public.logistica_delivery_evidence (storage_provider, external_file_id)
    WHERE external_file_id IS NOT NULL;

CREATE UNIQUE INDEX logistica_deliveries_drive_folder_uk
    ON public.logistica_deliveries (drive_folder_id)
    WHERE drive_folder_id IS NOT NULL;

CREATE INDEX entregas_logistica_legacy_pedido_idx
    ON public.entregas_logistica_legacy (pedido);

CREATE INDEX entregas_logistica_legacy_local_datetime_idx
    ON public.entregas_logistica_legacy (local_datetime);

CREATE INDEX entregas_logistica_legacy_drive_folder_idx
    ON public.entregas_logistica_legacy (drive_folder_id);

CREATE INDEX entregas_logistica_legacy_batch_idx
    ON public.entregas_logistica_legacy (import_batch_id);

CREATE UNIQUE INDEX logistica_legacy_owner_mapping_active_uk
    ON public.logistica_legacy_owner_mapping
        (source_snapshot_sha256, source_sheet, legacy_usuario, legacy_correo)
    WHERE is_active;

CREATE INDEX logistica_legacy_owner_mapping_user_idx
    ON public.logistica_legacy_owner_mapping (authorized_user_id);

CREATE FUNCTION public.move_section(p_template_id integer, p_id integer, p_newpos integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
AS $move$DECLARE
  v_count   int;   -- total de filas del template
  v_newpos  int;   -- posición objetivo acotada 1..N
BEGIN
  -- 0) Si no hay filas, nada que hacer
  SELECT COUNT(*) INTO v_count
  FROM public.template_section
  WHERE template_id = p_template_id;

  IF v_count = 0 THEN
    RETURN;
  END IF;

  -- 1) Acota la posición objetivo al rango [1..N]
  v_newpos := GREATEST(1, LEAST(p_newpos, v_count));

  -- 2) BUMP: libera el rango 1..N para evitar colisiones del índice único
  UPDATE public.template_section
  SET position = position + 100000
  WHERE template_id = p_template_id;

  -- 3) Reasignación: coloca todas las filas en 1..N con el elemento movido en v_newpos
  WITH cur AS (
    SELECT id, position - 100000 AS oldpos
    FROM public.template_section
    WHERE template_id = p_template_id
  ),
  ordered AS (
    -- reasignamos a 1..(N-1) todos menos el movido, preservando su orden relativo
    SELECT id, ROW_NUMBER() OVER (ORDER BY oldpos) AS rn
    FROM cur
    WHERE id <> p_id
  ),
  final AS (
    -- quienes van después o igual a v_newpos se recorren +1
    SELECT id,
           CASE WHEN rn >= v_newpos THEN rn + 1 ELSE rn END AS final_pos
    FROM ordered
    UNION ALL
    -- el movido va exactamente a v_newpos
    SELECT p_id AS id, v_newpos AS final_pos
  )
  UPDATE public.template_section s
  SET position = f.final_pos
  FROM final f
  WHERE s.id = f.id AND s.template_id = p_template_id;

  -- 4) Normalización por si acaso (deja 1..N garantizado)
  WITH ord AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS rn
    FROM public.template_section
    WHERE template_id = p_template_id
  )
  UPDATE public.template_section s
  SET position = ord.rn
  FROM ord
  WHERE s.id = ord.id AND s.template_id = p_template_id;

END;$move$;

CREATE FUNCTION public.move_task(p_section_id integer, p_id integer, p_newpos integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
AS $move$DECLARE
  v_count  int;
  v_newpos int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.template_task
  WHERE section_id = p_section_id;

  IF v_count = 0 THEN
    RETURN;
  END IF;

  v_newpos := GREATEST(1, LEAST(p_newpos, v_count));

  -- 1) Bump para evitar colisiones de UNIQUE(section_id, position)
  UPDATE public.template_task
  SET position = position + 100000
  WHERE section_id = p_section_id;

  -- 2) Reasignar todas en 1..N con la tarea movida en v_newpos
  WITH cur AS (
    SELECT id, position - 100000 AS oldpos
    FROM public.template_task
    WHERE section_id = p_section_id
  ),
  ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY oldpos) AS rn
    FROM cur
    WHERE id <> p_id
  ),
  final AS (
    SELECT id,
           CASE WHEN rn >= v_newpos THEN rn + 1 ELSE rn END AS final_pos
    FROM ordered
    UNION ALL
    SELECT p_id AS id, v_newpos AS final_pos
  )
  UPDATE public.template_task t
  SET position = f.final_pos
  FROM final f
  WHERE t.id = f.id AND t.section_id = p_section_id;

  -- 3) Normaliza por si acaso
  WITH ord AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) rn
    FROM public.template_task
    WHERE section_id = p_section_id
  )
  UPDATE public.template_task t
  SET position = ord.rn
  FROM ord
  WHERE t.id = ord.id AND t.section_id = p_section_id;

END;$move$;

CREATE FUNCTION public.move_task_inspection(p_section_id integer, p_id integer, p_newpos integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
AS $move$DECLARE
  v_count  int;
  v_newpos int;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.template_task_inspection
  WHERE section_id = p_section_id;

  IF v_count = 0 THEN
    RETURN;
  END IF;

  v_newpos := GREATEST(1, LEAST(p_newpos, v_count));

  -- 1) Bump temporal
  UPDATE public.template_task_inspection
  SET position = position + 100000
  WHERE section_id = p_section_id;

  -- 2) Reasignar todas en 1..N con la tarea movida en v_newpos
  WITH cur AS (
    SELECT id, position - 100000 AS oldpos
    FROM public.template_task_inspection
    WHERE section_id = p_section_id
  ),
  ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY oldpos) AS rn
    FROM cur
    WHERE id <> p_id
  ),
  final AS (
    SELECT id,
           CASE WHEN rn >= v_newpos THEN rn + 1 ELSE rn END AS final_pos
    FROM ordered
    UNION ALL
    SELECT p_id AS id, v_newpos AS final_pos
  )
  UPDATE public.template_task_inspection t
  SET position = f.final_pos
  FROM final f
  WHERE t.id = f.id
    AND t.section_id = p_section_id;

  -- 3) Normaliza el orden final
  WITH ord AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) rn
    FROM public.template_task_inspection
    WHERE section_id = p_section_id
  )
  UPDATE public.template_task_inspection t
  SET position = ord.rn
  FROM ord
  WHERE t.id = ord.id
    AND t.section_id = p_section_id;
END;$move$;

COMMENT ON COLUMN public.entregas_logistica_legacy.local_datetime IS
    'FECHA+HORA literales del Sheet. Zona horaria desconocida; no afirma UTC ni finalizacion.';

COMMENT ON COLUMN public.entregas_logistica_legacy.correo IS
    'Correo declarado legacy; no acredita identidad Firebase ni ownership.';

COMMENT ON COLUMN public.entregas_logistica_legacy.legacy_image_count IS
    'Contador declarado legacy; no equivale a PHOTO UPLOADED ni acredita archivos individuales.';

COMMENT ON COLUMN public.entregas_logistica_legacy.drive_folder_id IS
    'ID extraido de la URL historica, sin consultar existencia, permisos ni contenido en Drive.';

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

-- SYSTEM metadata only: these seven versions are INCLUDED by the baseline,
-- not seven independently executed migration attempts. No application seeds.
INSERT INTO public.logistica_schema_migrations(migration_name,migration_sha256,applied_at,applied_by) VALUES
('20261016_create_logistica_authorized_users.sql','fc648e1e00f21c70bada0d7cdbd08bfcb7b6280e794ae4bbb0b05e3c2eb84844',transaction_timestamp()+interval '0 microseconds',current_user),
('20261016_create_logistica_deliveries.sql','caaf530fba5860f6e7b2e1fe0659d66bef0de1bcebafa35e6241811c31504382',transaction_timestamp()+interval '1 microseconds',current_user),
('20261019_extend_logistica_delivery_evidence.sql','25a31baa36e135424bcef69dc2ef73bec7c64d8c0cc7adcbcb4af7e50cf42f35',transaction_timestamp()+interval '2 microseconds',current_user),
('20261019_add_logistica_delivery_drive_folder.sql','6bc3c84bd0cc830467e7f0d3dc7a72065aa72c0d259d7935663a95684f8e9f25',transaction_timestamp()+interval '3 microseconds',current_user),
('20261020_add_logistica_delivery_completion.sql','9a44b2246d10d84612420f8d2cd15482238e56b4b65b3bbda96cfd5377aea8d0',transaction_timestamp()+interval '4 microseconds',current_user),
('20261021_create_entregas_logistica_legacy.sql','f9e6bf843dd9dd4c8310b1af0e6b6bb6385ab7ea7ebaf6809a229e1952d35bef',transaction_timestamp()+interval '5 microseconds',current_user),
('20261021_create_logistica_legacy_owner_mapping.sql','5a2d62dc71d4ee31daa64a2baa94f2ac84ebe209d9ce19d9c6d2fd3853803505',transaction_timestamp()+interval '6 microseconds',current_user);
COMMENT ON TABLE public.logistica_schema_migrations IS 'Clean baseline includes the seven recorded schema versions; business tables start empty. Do not run incremental migrations again.';

DO $validate$ DECLARE issue text; BEGIN
 WITH RECURSIVE installed_extensions AS (
 SELECT e.oid,e.extname AS name,n.nspname AS schema,e.extversion AS version
 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
), extension_members(classid,objid,extension_oid) AS (
 -- Only extension membership ('e') and internal implementation ('i') are infrastructure.
 -- A normal dependency on an extension type/function does not imply membership.
 SELECT d.classid,d.objid,e.oid FROM pg_depend d JOIN installed_extensions e ON e.oid=d.refobjid
 WHERE d.refclassid='pg_extension'::regclass AND d.deptype='e' AND d.objsubid=0 AND d.refobjsubid=0
 UNION
 SELECT d.classid,d.objid,m.extension_oid FROM extension_members m JOIN pg_depend d
 ON d.refclassid=m.classid AND d.refobjid=m.objid
 WHERE d.deptype='i' AND d.objsubid=0 AND d.refobjsubid=0
), extension_infrastructure AS (
 SELECT 'pg_extension'::regclass::oid AS classid,oid AS objid,oid AS extension_oid FROM installed_extensions
 UNION SELECT classid,objid,extension_oid FROM extension_members
), objects AS (
 SELECT 'pg_class'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.relname::text AS name
 FROM pg_class o JOIN pg_namespace n ON n.oid=o.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_proc'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.proname::text AS name
 FROM pg_proc o JOIN pg_namespace n ON n.oid=o.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_type'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.typname::text AS name
 FROM pg_type o JOIN pg_namespace n ON n.oid=o.typnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_collation'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.collname::text AS name
 FROM pg_collation o JOIN pg_namespace n ON n.oid=o.collnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_conversion'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.conname::text AS name
 FROM pg_conversion o JOIN pg_namespace n ON n.oid=o.connamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_operator'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.oprname::text AS name
 FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_opclass'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.opcname::text AS name
 FROM pg_opclass o JOIN pg_namespace n ON n.oid=o.opcnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL
 SELECT 'pg_opfamily'::regclass::oid AS classid,o.oid AS objid,n.nspname AS schema,o.opfname::text AS name
 FROM pg_opfamily o JOIN pg_namespace n ON n.oid=o.opfnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL SELECT 'pg_trigger'::regclass::oid,t.oid,n.nspname,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_'
 UNION ALL SELECT 'pg_namespace'::regclass::oid,n.oid,n.nspname,n.nspname FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_toast|^pg_temp_' AND n.nspname<>'public'
 UNION ALL SELECT 'pg_event_trigger'::regclass::oid,oid,'',evtname FROM pg_event_trigger
 UNION ALL SELECT 'pg_foreign_server'::regclass::oid,oid,'',srvname FROM pg_foreign_server
 UNION ALL SELECT 'pg_foreign_data_wrapper'::regclass::oid,oid,'',fdwname FROM pg_foreign_data_wrapper
 UNION ALL SELECT 'pg_publication'::regclass::oid,oid,'',pubname FROM pg_publication
 UNION ALL SELECT 'pg_subscription'::regclass::oid,oid,'',subname FROM pg_subscription WHERE subdbid=(SELECT oid FROM pg_database WHERE datname=current_database())
 UNION ALL SELECT 'pg_largeobject_metadata'::regclass::oid,oid,'',oid::text FROM pg_largeobject_metadata
), application_objects AS (
 SELECT o.* FROM objects o WHERE NOT EXISTS(SELECT FROM extension_infrastructure e WHERE e.classid=o.classid AND e.objid=o.objid)
), expected AS (SELECT '{"base":[{"name":"template_section","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"template_id","type":"integer","not_null":true,"serial":false,"default":null,"collation":null},{"name":"title","type":"text","not_null":true,"serial":false,"default":null,"collation":null},{"name":"position","type":"integer","not_null":true,"serial":false,"default":null,"collation":null}],"constraints":[{"name":"template_section_pkey","type":"p","columns":["id"]},{"name":"template_section_template_id_position_key","type":"u","columns":["template_id","position"]}]},{"name":"template_task_inspection","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"section_id","type":"integer","not_null":true,"serial":false,"default":null,"collation":null},{"name":"revision_point","type":"text","not_null":true,"serial":false,"default":null,"collation":null},{"name":"specs","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"suggestions","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"required","type":"boolean","not_null":false,"serial":false,"default":"true","collation":null},{"name":"position","type":"integer","not_null":true,"serial":false,"default":"1","collation":null},{"name":"category","type":"text","not_null":false,"serial":false,"default":"''Mecanica''","collation":null}],"constraints":[{"name":"template_task_inspection_pkey","type":"p","columns":["id"]}]},{"name":"machine_family","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"name","type":"text","not_null":true,"serial":false,"default":null,"collation":null}],"constraints":[{"name":"machine_family_pkey","type":"p","columns":["id"]}]},{"name":"machine_customs","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"custom_title","type":"text","not_null":true,"serial":false,"default":null,"collation":null},{"name":"custom_value","type":"numeric(10,2)","not_null":true,"serial":false,"default":null,"collation":null}],"constraints":[{"name":"machine_customs_pkey","type":"p","columns":["id"]}]},{"name":"inspection_order_task","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"inspection_order_id","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"template_task_inspection_id","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"revision_point","type":"character varying(500)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"specs","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"suggestions","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"status","type":"character varying(50)","not_null":false,"serial":false,"default":"''PENDING''","collation":null},{"name":"started_at","type":"timestamp without time zone","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"finished_at","type":"timestamp without time zone","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"actual_minutes","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"comments","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"section_title","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"position","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null}],"constraints":[{"name":"inspection_order_task_pkey","type":"p","columns":["id"]}]},{"name":"desviaciones_calidad","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"id_actividad","type":"integer","not_null":true,"serial":false,"default":null,"collation":null},{"name":"correo","type":"character varying(120)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"usuario","type":"character varying(120)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"created_at","type":"timestamp without time zone","not_null":true,"serial":false,"default":"now()","collation":null},{"name":"serial_number","type":"character varying(120)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"afected_machine","type":"character varying(200)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"num_revision","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"nombre_tecnico","type":"character varying(120)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"parte_afectada","type":"character varying(200)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"causa_raiz","type":"character varying(200)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"clasificacion_defecto","type":"character varying(120)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"tipo_defectivo","type":"character varying(120)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"clasificacion_defectivo","type":"character varying(200)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"comentarios","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"evidencias","type":"jsonb","not_null":false,"serial":false,"default":"NULL","collation":null}],"constraints":[{"name":"desviaciones_calidad_pkey","type":"p","columns":["id"]}]},{"name":"plantilla_tecnicos","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"estatus","type":"character varying(50)","not_null":true,"serial":false,"default":null,"collation":null},{"name":"sucursal","type":"character varying(50)","not_null":true,"serial":false,"default":null,"collation":null},{"name":"nombre_tecnico","type":"character varying(50)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"correo_tecnico","type":"character varying(70)","not_null":true,"serial":false,"default":null,"collation":null},{"name":"telefono","type":"character varying(20)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"puesto","type":"character varying(50)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"nombre_bonos","type":"character varying(70)","not_null":true,"serial":false,"default":null,"collation":null},{"name":"numero_empleado","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null}],"constraints":[{"name":"plantilla_tecnicos_pkey","type":"p","columns":["id"]}]},{"name":"template_task","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"section_id","type":"integer","not_null":true,"serial":false,"default":null,"collation":null},{"name":"code","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"title","type":"text","not_null":true,"serial":false,"default":null,"collation":null},{"name":"expected_minutes","type":"integer","not_null":true,"serial":false,"default":"0","collation":null},{"name":"required","type":"boolean","not_null":true,"serial":false,"default":"true","collation":null},{"name":"position","type":"integer","not_null":true,"serial":false,"default":null,"collation":null},{"name":"category","type":"character varying(255)","not_null":false,"serial":false,"default":"''Mantenimiento''","collation":null}],"constraints":[{"name":"template_task_pkey","type":"p","columns":["id"]},{"name":"template_task_section_id_position_key","type":"u","columns":["section_id","position"]},{"name":"template_task_section_id_fkey","type":"f","columns":["section_id"],"reference":"template_section","reference_columns":["id"],"update":"a","delete":"c"}]},{"name":"machine_model","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"family_id","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"name","type":"text","not_null":true,"serial":false,"default":null,"collation":null},{"name":"manufacturer","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"bond_value","type":"numeric","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"standard_days","type":"numeric","not_null":false,"serial":false,"default":"NULL","collation":null}],"constraints":[{"name":"machine_model_pkey","type":"p","columns":["id"]},{"name":"machine_model_family_id_name_key","type":"u","columns":["family_id","name"]},{"name":"machine_model_family_id_fkey","type":"f","columns":["family_id"],"reference":"machine_family","reference_columns":["id"],"update":"a","delete":"n"}]},{"name":"maintenance_template","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"name","type":"text","not_null":true,"serial":false,"default":null,"collation":null},{"name":"template_type","type":"text","not_null":true,"serial":false,"default":null,"collation":null},{"name":"model_id","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"version","type":"integer","not_null":true,"serial":false,"default":"1","collation":null},{"name":"is_published","type":"boolean","not_null":true,"serial":false,"default":"false","collation":null},{"name":"created_by","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"created_at","type":"timestamp with time zone","not_null":true,"serial":false,"default":"now()","collation":null},{"name":"updated_at","type":"timestamp with time zone","not_null":true,"serial":false,"default":"now()","collation":null}],"constraints":[{"name":"maintenance_template_pkey","type":"p","columns":["id"]},{"name":"maintenance_template_model_id_fkey","type":"f","columns":["model_id"],"reference":"machine_model","reference_columns":["id"],"update":"a","delete":"n"},{"name":"maintenance_template_template_type_check","type":"c","columns":[],"definition":"CHECK (((template_type = ANY (ARRAY[''MANTENIMIENTO''::text, ''INSTALACION''::text, ''DIAGNOSTICO''::text, ''REPARACION''::text, ''ENSAMBLE''::text, ''INSPECCION''::text]))))"}]},{"name":"work_order","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"template_id","type":"integer","not_null":true,"serial":false,"default":null,"collation":null},{"name":"template_version","type":"integer","not_null":true,"serial":false,"default":null,"collation":null},{"name":"model_id","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"machine_serial","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"customer_name","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"site_address","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"assigned_tech_email","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"status","type":"text","not_null":false,"serial":false,"default":"''OPEN''","collation":null},{"name":"scheduled_at","type":"timestamp with time zone","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"started_at","type":"timestamp with time zone","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"finished_at","type":"timestamp with time zone","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"created_at","type":"timestamp with time zone","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"diagnostic_result","type":"character varying(255)","not_null":false,"serial":false,"default":"NULL::character varying","collation":null},{"name":"tech_support","type":"character varying(255)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"folio_sai","type":"character varying(255)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"initial_status","type":"character varying(255)","not_null":false,"serial":false,"default":"NULL::character varying","collation":null},{"name":"comments","type":"character varying(1000)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"extra_points","type":"numeric","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"id_reserva","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null}],"constraints":[{"name":"work_order_pkey","type":"p","columns":["id"]},{"name":"work_order_model_id_fkey","type":"f","columns":["model_id"],"reference":"machine_model","reference_columns":["id"],"update":"a","delete":"a"},{"name":"work_order_template_id_fkey","type":"f","columns":["template_id"],"reference":"maintenance_template","reference_columns":["id"],"update":"a","delete":"r"}]},{"name":"inspection_order","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"inspection_template_id","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"model_id","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"assigned_tech_email","type":"character varying(255)","not_null":false,"serial":false,"default":"NULL::character varying","collation":null},{"name":"status","type":"character varying(50)","not_null":false,"serial":false,"default":"''PENDING''","collation":null},{"name":"created_at","type":"timestamp without time zone","not_null":false,"serial":false,"default":"now()","collation":null},{"name":"started_at","type":"timestamp without time zone","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"finished_at","type":"timestamp without time zone","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"work_order_id","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"estacion","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"inspection_type","type":"character varying(255)","not_null":false,"serial":false,"default":"NULL::character varying","collation":null},{"name":"evidencias","type":"jsonb","not_null":false,"serial":false,"default":"NULL","collation":null}],"constraints":[{"name":"inspection_order_pkey","type":"p","columns":["id"]},{"name":"inspection_order_inspection_template_id_fkey","type":"f","columns":["inspection_template_id"],"reference":"maintenance_template","reference_columns":["id"],"update":"a","delete":"a"},{"name":"inspection_order_model_id_fkey","type":"f","columns":["model_id"],"reference":"machine_model","reference_columns":["id"],"update":"a","delete":"a"}]},{"name":"work_order_task","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"work_order_id","type":"integer","not_null":true,"serial":false,"default":null,"collation":null},{"name":"section_title","type":"text","not_null":true,"serial":false,"default":null,"collation":null},{"name":"task_title","type":"text","not_null":true,"serial":false,"default":null,"collation":null},{"name":"code","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"expected_minutes","type":"integer","not_null":true,"serial":false,"default":"0","collation":null},{"name":"position","type":"integer","not_null":true,"serial":false,"default":null,"collation":null},{"name":"status","type":"character varying","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"observation","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"actual_minutes","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"photo_url","type":"text","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"started_at","type":"timestamp with time zone","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"finished_at","type":"timestamp with time zone","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"category","type":"character varying(255)","not_null":false,"serial":false,"default":"''Mantenimiento''","collation":null},{"name":"extra_data","type":"jsonb","not_null":false,"serial":false,"default":"''{}''","collation":null}],"constraints":[{"name":"work_order_task_pkey","type":"p","columns":["id"]},{"name":"work_order_task_work_order_id_position_key","type":"u","columns":["work_order_id","position"]},{"name":"work_order_task_work_order_id_fkey","type":"f","columns":["work_order_id"],"reference":"work_order","reference_columns":["id"],"update":"a","delete":"c"}]},{"name":"work_order_customs","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"work_order_id","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"custom_title","type":"character varying(255)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"custom_value","type":"numeric","not_null":false,"serial":false,"default":"NULL","collation":null}],"constraints":[{"name":"work_order_customs_pkey","type":"p","columns":["id"]},{"name":"work_order_customs_work_order_id_fkey","type":"f","columns":["work_order_id"],"reference":"work_order","reference_columns":["id"],"update":"a","delete":"c"}]},{"name":"prod_delayments","columns":[{"name":"id","type":"integer","not_null":true,"serial":true,"default":null,"collation":null},{"name":"id_actividad","type":"integer","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"categoria_retraso","type":"character varying(255)","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"tiempo_retraso","type":"double precision","not_null":false,"serial":false,"default":"NULL","collation":null},{"name":"comments","type":"character varying(1000)","not_null":false,"serial":false,"default":"NULL","collation":null}],"constraints":[{"name":"prod_delayments_pkey","type":"p","columns":["id"]},{"name":"prod_delayments_id_actividad_fkey","type":"f","columns":["id_actividad"],"reference":"work_order_task","reference_columns":["id"],"update":"a","delete":"c"}]}],"indexes":[{"name":"template_section_pkey","table":"template_section","definition":"CREATE UNIQUE INDEX template_section_pkey ON public.template_section USING btree (id)"},{"name":"template_section_template_id_position_key","table":"template_section","definition":"CREATE UNIQUE INDEX template_section_template_id_position_key ON public.template_section USING btree (template_id, position)"},{"name":"idx_section_template","table":"template_section","definition":"CREATE INDEX idx_section_template ON public.template_section USING btree (\"template_id\", \"position\")"},{"name":"template_task_inspection_pkey","table":"template_task_inspection","definition":"CREATE UNIQUE INDEX template_task_inspection_pkey ON public.template_task_inspection USING btree (id)"},{"name":"machine_family_pkey","table":"machine_family","definition":"CREATE UNIQUE INDEX machine_family_pkey ON public.machine_family USING btree (id)"},{"name":"machine_customs_pkey","table":"machine_customs","definition":"CREATE UNIQUE INDEX machine_customs_pkey ON public.machine_customs USING btree (id)"},{"name":"inspection_order_task_pkey","table":"inspection_order_task","definition":"CREATE UNIQUE INDEX inspection_order_task_pkey ON public.inspection_order_task USING btree (id)"},{"name":"desviaciones_calidad_pkey","table":"desviaciones_calidad","definition":"CREATE UNIQUE INDEX desviaciones_calidad_pkey ON public.desviaciones_calidad USING btree (id)"},{"name":"plantilla_tecnicos_pkey","table":"plantilla_tecnicos","definition":"CREATE UNIQUE INDEX plantilla_tecnicos_pkey ON public.plantilla_tecnicos USING btree (id)"},{"name":"template_task_pkey","table":"template_task","definition":"CREATE UNIQUE INDEX template_task_pkey ON public.template_task USING btree (id)"},{"name":"template_task_section_id_position_key","table":"template_task","definition":"CREATE UNIQUE INDEX template_task_section_id_position_key ON public.template_task USING btree (section_id, position)"},{"name":"idx_task_section","table":"template_task","definition":"CREATE INDEX idx_task_section ON public.template_task USING btree (\"section_id\", \"position\")"},{"name":"machine_model_pkey","table":"machine_model","definition":"CREATE UNIQUE INDEX machine_model_pkey ON public.machine_model USING btree (id)"},{"name":"machine_model_family_id_name_key","table":"machine_model","definition":"CREATE UNIQUE INDEX machine_model_family_id_name_key ON public.machine_model USING btree (family_id, name)"},{"name":"maintenance_template_pkey","table":"maintenance_template","definition":"CREATE UNIQUE INDEX maintenance_template_pkey ON public.maintenance_template USING btree (id)"},{"name":"work_order_pkey","table":"work_order","definition":"CREATE UNIQUE INDEX work_order_pkey ON public.work_order USING btree (id)"},{"name":"idx_work_order_diagnostic_result","table":"work_order","definition":"CREATE INDEX idx_work_order_diagnostic_result ON public.work_order USING btree (\"diagnostic_result\")"},{"name":"inspection_order_pkey","table":"inspection_order","definition":"CREATE UNIQUE INDEX inspection_order_pkey ON public.inspection_order USING btree (id)"},{"name":"work_order_task_pkey","table":"work_order_task","definition":"CREATE UNIQUE INDEX work_order_task_pkey ON public.work_order_task USING btree (id)"},{"name":"work_order_task_work_order_id_position_key","table":"work_order_task","definition":"CREATE UNIQUE INDEX work_order_task_work_order_id_position_key ON public.work_order_task USING btree (work_order_id, position)"},{"name":"work_order_customs_pkey","table":"work_order_customs","definition":"CREATE UNIQUE INDEX work_order_customs_pkey ON public.work_order_customs USING btree (id)"},{"name":"prod_delayments_pkey","table":"prod_delayments","definition":"CREATE UNIQUE INDEX prod_delayments_pkey ON public.prod_delayments USING btree (id)"}],"functions":[{"name":"move_section","hash":"7dd00e452902cb5d8d9ce842b99b4d81d8ed67c543bf4c3c79ca88014ccd7cf1"},{"name":"move_task","hash":"fd99cdad139872b29ca99994cce44d3d6d170f0a6ac76012afc34d41895c7b6c"},{"name":"move_task_inspection","hash":"8d65576c4dbf35a4832a265fd4685f9c9e074313577c8a889fef1c513940c950"}],"sequences":[{"name":"template_section_id_seq","table":"template_section","column":"id","type":"integer"},{"name":"template_task_inspection_id_seq","table":"template_task_inspection","column":"id","type":"integer"},{"name":"machine_family_id_seq","table":"machine_family","column":"id","type":"integer"},{"name":"machine_customs_id_seq","table":"machine_customs","column":"id","type":"integer"},{"name":"inspection_order_task_id_seq","table":"inspection_order_task","column":"id","type":"integer"},{"name":"desviaciones_calidad_id_seq","table":"desviaciones_calidad","column":"id","type":"integer"},{"name":"plantilla_tecnicos_id_seq","table":"plantilla_tecnicos","column":"id","type":"integer"},{"name":"logistica_authorized_users_id_seq","table":"logistica_authorized_users","column":"id","type":"bigint"},{"name":"entregas_logistica_legacy_id_seq","table":"entregas_logistica_legacy","column":"id","type":"bigint"},{"name":"template_task_id_seq","table":"template_task","column":"id","type":"integer"},{"name":"machine_model_id_seq","table":"machine_model","column":"id","type":"integer"},{"name":"logistica_deliveries_id_seq","table":"logistica_deliveries","column":"id","type":"bigint"},{"name":"logistica_legacy_owner_mapping_id_seq","table":"logistica_legacy_owner_mapping","column":"id","type":"bigint"},{"name":"maintenance_template_id_seq","table":"maintenance_template","column":"id","type":"integer"},{"name":"logistica_delivery_evidence_id_seq","table":"logistica_delivery_evidence","column":"id","type":"bigint"},{"name":"work_order_id_seq","table":"work_order","column":"id","type":"integer"},{"name":"inspection_order_id_seq","table":"inspection_order","column":"id","type":"integer"},{"name":"work_order_task_id_seq","table":"work_order_task","column":"id","type":"integer"},{"name":"work_order_customs_id_seq","table":"work_order_customs","column":"id","type":"integer"},{"name":"prod_delayments_id_seq","table":"prod_delayments","column":"id","type":"integer"}],"ledger":[{"name":"20261016_create_logistica_authorized_users.sql","sha256":"fc648e1e00f21c70bada0d7cdbd08bfcb7b6280e794ae4bbb0b05e3c2eb84844"},{"name":"20261016_create_logistica_deliveries.sql","sha256":"caaf530fba5860f6e7b2e1fe0659d66bef0de1bcebafa35e6241811c31504382"},{"name":"20261019_extend_logistica_delivery_evidence.sql","sha256":"25a31baa36e135424bcef69dc2ef73bec7c64d8c0cc7adcbcb4af7e50cf42f35"},{"name":"20261019_add_logistica_delivery_drive_folder.sql","sha256":"6bc3c84bd0cc830467e7f0d3dc7a72065aa72c0d259d7935663a95684f8e9f25"},{"name":"20261020_add_logistica_delivery_completion.sql","sha256":"9a44b2246d10d84612420f8d2cd15482238e56b4b65b3bbda96cfd5377aea8d0"},{"name":"20261021_create_entregas_logistica_legacy.sql","sha256":"f9e6bf843dd9dd4c8310b1af0e6b6bb6385ab7ea7ebaf6809a229e1952d35bef"},{"name":"20261021_create_logistica_legacy_owner_mapping.sql","sha256":"5a2d62dc71d4ee31daa64a2baa94f2ac84ebe209d9ce19d9c6d2fd3853803505"}]}'::jsonb AS value),
 expected_objects(catalog,name) AS (VALUES ('pg_class','template_section'),('pg_type','template_section'),('pg_type','_template_section'),('pg_class','template_task_inspection'),('pg_type','template_task_inspection'),('pg_type','_template_task_inspection'),('pg_class','machine_family'),('pg_type','machine_family'),('pg_type','_machine_family'),('pg_class','machine_customs'),('pg_type','machine_customs'),('pg_type','_machine_customs'),('pg_class','inspection_order_task'),('pg_type','inspection_order_task'),('pg_type','_inspection_order_task'),('pg_class','desviaciones_calidad'),('pg_type','desviaciones_calidad'),('pg_type','_desviaciones_calidad'),('pg_class','plantilla_tecnicos'),('pg_type','plantilla_tecnicos'),('pg_type','_plantilla_tecnicos'),('pg_class','logistica_schema_migrations'),('pg_type','logistica_schema_migrations'),('pg_type','_logistica_schema_migrations'),('pg_class','logistica_authorized_users'),('pg_type','logistica_authorized_users'),('pg_type','_logistica_authorized_users'),('pg_class','entregas_logistica_legacy'),('pg_type','entregas_logistica_legacy'),('pg_type','_entregas_logistica_legacy'),('pg_class','template_task'),('pg_type','template_task'),('pg_type','_template_task'),('pg_class','machine_model'),('pg_type','machine_model'),('pg_type','_machine_model'),('pg_class','logistica_deliveries'),('pg_type','logistica_deliveries'),('pg_type','_logistica_deliveries'),('pg_class','logistica_legacy_owner_mapping'),('pg_type','logistica_legacy_owner_mapping'),('pg_type','_logistica_legacy_owner_mapping'),('pg_class','maintenance_template'),('pg_type','maintenance_template'),('pg_type','_maintenance_template'),('pg_class','logistica_delivery_evidence'),('pg_type','logistica_delivery_evidence'),('pg_type','_logistica_delivery_evidence'),('pg_class','work_order'),('pg_type','work_order'),('pg_type','_work_order'),('pg_class','inspection_order'),('pg_type','inspection_order'),('pg_type','_inspection_order'),('pg_class','work_order_task'),('pg_type','work_order_task'),('pg_type','_work_order_task'),('pg_class','work_order_customs'),('pg_type','work_order_customs'),('pg_type','_work_order_customs'),('pg_class','prod_delayments'),('pg_type','prod_delayments'),('pg_type','_prod_delayments'),('pg_class','template_section_id_seq'),('pg_class','template_task_inspection_id_seq'),('pg_class','machine_family_id_seq'),('pg_class','machine_customs_id_seq'),('pg_class','inspection_order_task_id_seq'),('pg_class','desviaciones_calidad_id_seq'),('pg_class','plantilla_tecnicos_id_seq'),('pg_class','logistica_authorized_users_id_seq'),('pg_class','entregas_logistica_legacy_id_seq'),('pg_class','template_task_id_seq'),('pg_class','machine_model_id_seq'),('pg_class','logistica_deliveries_id_seq'),('pg_class','logistica_legacy_owner_mapping_id_seq'),('pg_class','maintenance_template_id_seq'),('pg_class','logistica_delivery_evidence_id_seq'),('pg_class','work_order_id_seq'),('pg_class','inspection_order_id_seq'),('pg_class','work_order_task_id_seq'),('pg_class','work_order_customs_id_seq'),('pg_class','prod_delayments_id_seq'),('pg_class','template_section_pkey'),('pg_class','template_section_template_id_position_key'),('pg_class','template_task_inspection_pkey'),('pg_class','machine_family_pkey'),('pg_class','machine_customs_pkey'),('pg_class','inspection_order_task_pkey'),('pg_class','desviaciones_calidad_pkey'),('pg_class','plantilla_tecnicos_pkey'),('pg_class','logistica_schema_migrations_pkey'),('pg_class','logistica_authorized_users_pkey'),('pg_class','logistica_authorized_users_project_uid_uk'),('pg_class','entregas_logistica_legacy_pkey'),('pg_class','entregas_logistica_legacy_key_uk'),('pg_class','entregas_logistica_legacy_source_uk'),('pg_class','template_task_pkey'),('pg_class','template_task_section_id_position_key'),('pg_class','machine_model_pkey'),('pg_class','machine_model_family_id_name_key'),('pg_class','logistica_deliveries_pkey'),('pg_class','logistica_deliveries_client_request_uk'),('pg_class','logistica_legacy_owner_mapping_pkey'),('pg_class','maintenance_template_pkey'),('pg_class','logistica_delivery_evidence_pkey'),('pg_class','logistica_delivery_evidence_sequence_uk'),('pg_class','logistica_delivery_evidence_client_evidence_uk'),('pg_class','work_order_pkey'),('pg_class','inspection_order_pkey'),('pg_class','work_order_task_pkey'),('pg_class','work_order_task_work_order_id_position_key'),('pg_class','work_order_customs_pkey'),('pg_class','prod_delayments_pkey'),('pg_class','idx_work_order_diagnostic_result'),('pg_class','idx_section_template'),('pg_class','idx_task_section'),('pg_class','logistica_delivery_evidence_signature_uk'),('pg_class','logistica_deliveries_pedido_idx'),('pg_class','logistica_deliveries_created_at_idx'),('pg_class','logistica_deliveries_authorized_user_idx'),('pg_class','logistica_deliveries_status_idx'),('pg_class','logistica_delivery_evidence_delivery_idx'),('pg_class','logistica_delivery_evidence_external_file_uk'),('pg_class','logistica_deliveries_drive_folder_uk'),('pg_class','entregas_logistica_legacy_pedido_idx'),('pg_class','entregas_logistica_legacy_local_datetime_idx'),('pg_class','entregas_logistica_legacy_drive_folder_idx'),('pg_class','entregas_logistica_legacy_batch_idx'),('pg_class','logistica_legacy_owner_mapping_active_uk'),('pg_class','logistica_legacy_owner_mapping_user_idx'),('pg_proc','move_section'),('pg_proc','move_task'),('pg_proc','move_task_inspection'),('pg_proc','protect_logistica_legacy_owner_mapping'),('pg_trigger','logistica_legacy_owner_mapping_row_guard'),('pg_trigger','logistica_legacy_owner_mapping_truncate_guard')),
 expected_tables(name) AS (VALUES ('template_section'),('template_task_inspection'),('machine_family'),('machine_customs'),('inspection_order_task'),('desviaciones_calidad'),('plantilla_tecnicos'),('logistica_schema_migrations'),('logistica_authorized_users'),('entregas_logistica_legacy'),('template_task'),('machine_model'),('logistica_deliveries'),('logistica_legacy_owner_mapping'),('maintenance_template'),('logistica_delivery_evidence'),('work_order'),('inspection_order'),('work_order_task'),('work_order_customs'),('prod_delayments')),
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
 logistics_shape AS (WITH settings AS (SELECT 'public'::text AS ns),
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
      replace(replace(pg_get_triggerdef(t.oid,true),'EXECUTE FUNCTION protect_logistica_legacy_owner_mapping()','EXECUTE FUNCTION public.protect_logistica_legacy_owner_mapping()'),quote_ident(r.ns)||'.','public.')
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
    replace(p.prosrc,chr(13),''),p.prosecdef,p.provolatile,p.proconfig,l.lanname
  ) ORDER BY pg_get_function_identity_arguments(p.oid) COLLATE "C")
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang CROSS JOIN settings s
    WHERE n.nspname=s.ns AND p.proname='protect_logistica_legacy_owner_mapping'),'[]'::jsonb)
) AS shape)
SELECT encode(sha256(convert_to(shape::text,'UTF8')),'hex') AS fingerprint, shape FROM signature),
 issues(reason) AS (
 SELECT 'MISSING_EXTENSION:'||required.name FROM unnest(ARRAY['plpgsql','citext']) required(name) WHERE NOT EXISTS(SELECT FROM installed_extensions e WHERE e.name=required.name)
 UNION ALL SELECT 'UNEXPECTED_OBJECT:'||schema||'.'||name FROM application_objects o WHERE schema<>'public' OR NOT EXISTS(SELECT FROM expected_objects e WHERE e.catalog::regclass=o.classid AND e.name=o.name)
 UNION ALL SELECT 'MISSING_OBJECT:'||e.catalog||':'||e.name FROM expected_objects e WHERE NOT EXISTS(SELECT FROM application_objects o WHERE o.schema='public' AND o.classid=e.catalog::regclass AND o.name=e.name)
 UNION ALL SELECT 'TABLE_NOT_EMPTY_OR_UNSUPPORTED:'||name FROM counts WHERE oid IS NULL OR relkind<>'r' OR relpersistence<>'p' OR relrowsecurity OR relforcerowsecurity OR (name<>'logistica_schema_migrations' AND rows IS DISTINCT FROM 0)
 UNION ALL SELECT 'BASE_COLUMN_DRIFT:'||table_name||'.'||(c->>'name') FROM columns e
 LEFT JOIN pg_attribute a ON a.attrelid=to_regclass('public.'||table_name) AND a.attname=c->>'name' AND NOT a.attisdropped
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attnum IS DISTINCT FROM position::int OR format_type(a.atttypid,a.atttypmod) IS DISTINCT FROM c->>'type'
 OR a.attnotnull IS DISTINCT FROM (c->>'not_null')::boolean OR a.attidentity<>'' OR a.attgenerated<>''
 OR a.attcollation IS DISTINCT FROM (SELECT typcollation FROM pg_type WHERE oid=a.atttypid)
 OR (NOT (c->>'serial')::boolean AND regexp_replace(replace(regexp_replace(coalesce(pg_get_expr(d.adbin,d.adrelid),'NULL'),'::(character varying(?:\([0-9]+\))?|timestamp (?:with|without) time zone|double precision|text|jsonb|integer|numeric|boolean)','', 'g'),'"',''),'[[:space:]]','','g') IS DISTINCT FROM regexp_replace(replace(regexp_replace(coalesce(c->>'default','NULL'),'::(character varying(?:\([0-9]+\))?|timestamp (?:with|without) time zone|double precision|text|jsonb|integer|numeric|boolean)','', 'g'),'"',''),'[[:space:]]','','g'))
 UNION ALL SELECT 'EXTRA_BASE_COLUMNS:'||(t->>'name') FROM base_tables WHERE (SELECT count(*) FROM pg_attribute WHERE attrelid=to_regclass('public.'||(t->>'name')) AND attnum>0 AND NOT attisdropped)<>jsonb_array_length(t->'columns')
 UNION ALL SELECT 'BASE_CONSTRAINT_DRIFT:'||table_name||'.'||(k->>'name') FROM constraints e LEFT JOIN pg_constraint a ON a.conrelid=to_regclass('public.'||table_name) AND a.conname=k->>'name'
 WHERE a.oid IS NULL OR a.contype::text<>k->>'type' OR NOT a.convalidated OR a.condeferrable OR a.condeferred
 OR (k->>'type'<>'c' AND (SELECT jsonb_agg(v.attname::text ORDER BY u.position) FROM unnest(a.conkey) WITH ORDINALITY u(attnum,position) JOIN pg_attribute v ON v.attrelid=a.conrelid AND v.attnum=u.attnum) IS DISTINCT FROM k->'columns')
 OR (k->>'type'='f' AND (a.confrelid IS DISTINCT FROM to_regclass('public.'||(k->>'reference')) OR a.confupdtype::text<>k->>'update' OR a.confdeltype::text<>k->>'delete' OR a.confmatchtype<>'s'
 OR (SELECT jsonb_agg(v.attname::text ORDER BY u.position) FROM unnest(a.confkey) WITH ORDINALITY u(attnum,position) JOIN pg_attribute v ON v.attrelid=a.confrelid AND v.attnum=u.attnum) IS DISTINCT FROM k->'reference_columns'))
 OR (k->>'type'='c' AND regexp_replace(regexp_replace(replace(regexp_replace(coalesce(pg_get_constraintdef(a.oid,true),'NULL'),'::(character varying(?:\([0-9]+\))?|timestamp (?:with|without) time zone|double precision|text|jsonb|integer|numeric|boolean)','', 'g'),'"',''),'[[:space:]]','','g'),'[()]','','g') IS DISTINCT FROM regexp_replace(regexp_replace(replace(regexp_replace(coalesce(k->>'definition','NULL'),'::(character varying(?:\([0-9]+\))?|timestamp (?:with|without) time zone|double precision|text|jsonb|integer|numeric|boolean)','', 'g'),'"',''),'[[:space:]]','','g'),'[()]','','g'))
 UNION ALL SELECT 'EXTRA_BASE_CONSTRAINTS:'||(t->>'name') FROM base_tables WHERE (SELECT count(*) FROM pg_constraint WHERE conrelid=to_regclass('public.'||(t->>'name')))<>jsonb_array_length(t->'constraints')
 UNION ALL SELECT 'BASE_INDEX_DRIFT:'||(i->>'name') FROM indexes LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||(i->>'name')) LEFT JOIN pg_index x ON x.indexrelid=c.oid
 WHERE c.oid IS NULL OR x.indrelid IS DISTINCT FROM to_regclass('public.'||(i->>'table')) OR NOT x.indisvalid OR NOT x.indisready OR regexp_replace(replace(pg_get_indexdef(c.oid),'"',''),'[[:space:]]','','g') IS DISTINCT FROM regexp_replace(replace(i->>'definition','"',''),'[[:space:]]','','g')
 UNION ALL SELECT 'BASE_FUNCTION_DRIFT:'||(f->>'name') FROM functions LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||(f->>'name')||'(integer,integer,integer)')
 WHERE p.oid IS NULL OR p.prokind<>'f' OR p.prorettype<>'void'::regtype OR p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proparallel<>'u' OR p.provolatile<>'v' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[] OR p.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql') OR encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex') IS DISTINCT FROM f->>'hash'
 UNION ALL SELECT 'EXTRA_BASE_FUNCTION_OVERLOAD:'||p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('move_section','move_task','move_task_inspection') AND p.oid IS DISTINCT FROM to_regprocedure('public.'||p.proname||'(integer,integer,integer)')
 UNION ALL SELECT 'SEQUENCE_DRIFT:'||(s->>'name') FROM sequences LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||(s->>'name')) LEFT JOIN pg_sequence q ON q.seqrelid=c.oid
 WHERE c.relkind IS DISTINCT FROM 'S' OR q.seqtypid IS DISTINCT FROM (s->>'type')::regtype OR q.seqstart<>1 OR q.seqincrement<>1 OR q.seqmin<>1 OR q.seqmax<>CASE WHEN s->>'type'='integer' THEN 2147483647::bigint ELSE 9223372036854775807::bigint END OR q.seqcache<>1 OR q.seqcycle
 OR pg_get_serial_sequence('public.'||(s->>'table'),s->>'column') IS DISTINCT FROM 'public.'||(s->>'name')
 OR c.relowner IS DISTINCT FROM (SELECT relowner FROM pg_class WHERE oid=to_regclass('public.'||(s->>'table')))
 OR NOT EXISTS(SELECT FROM pg_depend d JOIN pg_attribute a ON a.attrelid=d.refobjid AND a.attnum=d.refobjsubid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_class'::regclass AND d.refobjid=to_regclass('public.'||(s->>'table')) AND a.attname=s->>'column' AND d.deptype='a')
 OR (SELECT replace(pg_get_expr(d.adbin,d.adrelid),'public.','') FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=to_regclass('public.'||(s->>'table')) AND a.attname=s->>'column') IS DISTINCT FROM format('nextval(%L::regclass)',s->>'name')
 UNION ALL SELECT 'SEQUENCE_NOT_FRESH:'||(s->>'name') FROM sequence_state WHERE last_value::bigint IS DISTINCT FROM 1 OR is_called::boolean IS DISTINCT FROM false
 UNION ALL SELECT 'UNEXPECTED_BASE_TRIGGER:'||tgname FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN (SELECT to_regclass('public.'||(t->>'name')) FROM base_tables)
 UNION ALL SELECT 'LOGISTICA_FINAL_SCHEMA_DRIFT' FROM logistics_shape WHERE fingerprint<>'c7e7d4d23745580b151b7b8876b35023ecc0cd8e908f0f79cb46f2417582bead'
 UNION ALL SELECT 'LEDGER_DRIFT' WHERE (SELECT count(*) FROM ledger)<>7 OR EXISTS(SELECT FROM ledger_expected e FULL JOIN ledger l ON l.migration_name=e.f->>'name' WHERE e.f IS NULL OR l.migration_name IS NULL OR l.migration_sha256 IS DISTINCT FROM e.f->>'sha256' OR l.applied_at IS NULL OR l.applied_by IS NULL)
 UNION ALL SELECT 'LEDGER_ORDER_DRIFT' WHERE EXISTS(SELECT FROM ledger_expected a JOIN ledger x ON x.migration_name=a.f->>'name' JOIN ledger_expected b ON b.position>a.position JOIN ledger y ON y.migration_name=b.f->>'name' WHERE x.applied_at::timestamptz>=y.applied_at::timestamptz)
 UNION ALL SELECT 'UNSUPPORTED_RULE_POLICY_OR_INHERITANCE' WHERE EXISTS(SELECT FROM pg_policy WHERE polrelid IN (SELECT oid FROM counts)) OR EXISTS(SELECT FROM pg_rewrite WHERE ev_class IN (SELECT oid FROM counts)) OR EXISTS(SELECT FROM pg_inherits WHERE inhrelid IN (SELECT oid FROM counts) OR inhparent IN (SELECT oid FROM counts))
)
 SELECT string_agg(reason,', ' ORDER BY reason) INTO issue FROM issues;
 IF issue IS NOT NULL THEN RAISE EXCEPTION 'CALIDAD_BASELINE_INVALID: %',issue; END IF;
END; $validate$;
-- Accept this result only together with the following successful COMMIT.
-- Keeping it inside the transaction prevents success after an aborted COMMIT.
SELECT 'CALIDAD_BASELINE_CREADO' AS "CHECK",'SI' AS "ESTADO";
COMMIT;
