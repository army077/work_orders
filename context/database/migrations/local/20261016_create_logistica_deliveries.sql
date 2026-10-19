-- Modelo operacional de Entregas, preparado exclusivamente para LOCAL TEST.
-- Destino: artecnologia_test_local. No ejecutar en otras bases.
-- Requiere public.logistica_authorized_users.
-- pedido es una referencia de negocio, sin equivalencia asumida con IDs internos.
-- Las evidencias solo contienen metadatos y referencias a almacenamiento externo.
-- updated_at sera responsabilidad de API10; no se crean triggers.
-- La migracion historica del flujo legacy se mantendra separada.

BEGIN;

DO $$
BEGIN
    IF current_database() <> 'artecnologia_test_local' THEN
        RAISE EXCEPTION
            'Esta migracion solo permite la base artecnologia_test_local';
    END IF;
END;
$$;

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
        CHECK (status IN ('PENDING_EVIDENCE', 'COMPLETED', 'FAILED'))
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
        UNIQUE (delivery_id, evidence_type, sequence_no)
);

-- Una sola firma por entrega, independientemente de su numero de secuencia.
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

COMMIT;
