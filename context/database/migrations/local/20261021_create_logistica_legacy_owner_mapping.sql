-- Infraestructura LOCAL exclusivamente. No contiene INSERT ni concilia personas.
-- Una cuenta Workspace puede haber sido renombrada, reutilizada o reasignada.
-- Email/nombre actuales, aliases y Firebase UID no prueban autoria historica.
-- Cada fila futura requiere aprobacion humana explicita y documentada.
BEGIN;

DO $$
BEGIN
    IF current_database() <> 'artecnologia_test_local'
       OR current_user <> 'workorders_test'
       OR inet_server_addr() IS NULL
       OR host(inet_server_addr()) NOT IN ('127.0.0.1', '::1')
       OR inet_server_port() <> 5432 THEN
        RAISE EXCEPTION 'Solo se permite PostgreSQL LOCAL TEST autorizado';
    END IF;
END;
$$;

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

COMMIT;
