-- Extension incremental preparada exclusivamente para LOCAL TEST.
-- Requiere 20261016_create_logistica_deliveries.sql; no integra Google Drive.
-- La evidencia se identifica por un UUID estable suministrado por el cliente.
-- No genera UUIDs ni hace backfill silencioso de evidencias preexistentes.

BEGIN;

DO $$
BEGIN
    IF current_database() <> 'artecnologia_test_local' THEN
        RAISE EXCEPTION
            'Esta migracion solo permite la base artecnologia_test_local';
    END IF;
END;
$$;

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
COMMIT;
