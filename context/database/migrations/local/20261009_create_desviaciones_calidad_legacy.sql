-- Migración histórica preparada exclusivamente para LOCAL TEST.
-- Destino: artecnologia_test_local.
-- Fuente: Proceso de inspeccion, filas 2-3935 (3,934 registros).
-- Periodo declarado: 2023-06-30 a 2025-12-17.
-- Las filas modernas 3936-4322 quedan fuera de esta importación.
-- Este archivo solo crea la tabla y sus índices; no importa registros.

BEGIN;

DO $$
BEGIN
    IF current_database() <> 'artecnologia_test_local' THEN
        RAISE EXCEPTION
            'Esta migración solo permite la base artecnologia_test_local';
    END IF;
END;
$$;

CREATE TABLE public.desviaciones_calidad_legacy (
    -- Identidad técnica independiente del ID original.
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- Procedencia e importación.
    source_spreadsheet_id TEXT NOT NULL,
    source_tab_gid BIGINT NOT NULL,
    source_sheet TEXT NOT NULL,
    source_row INTEGER NOT NULL,
    source_legacy_id TEXT,
    source_snapshot_sha256 TEXT NOT NULL,
    import_batch_id UUID NOT NULL,
    source_hash TEXT NOT NULL,
    source_hash_version SMALLINT NOT NULL DEFAULT 1,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- El importador debe guardar un objeto con esta estructura:
    -- {
    --   "headers": [24 encabezados originales en orden],
    --   "cells": [24 valores originales en el mismo orden]
    -- }
    -- Debe preservar strings/null, incluidos espacios, ceros iniciales y
    -- la diferencia entre string vacío y null. El hashing usa estos valores
    -- originales antes de cualquier normalización, con serialización
    -- canónica versionada; no debe usar directamente source_payload::text.
    -- source_snapshot_sha256 identifica los bytes de la captura congelada;
    -- source_hash identifica el contenido original de cada fila.
    source_payload JSONB NOT NULL,

    -- Campos originales: sin conversiones ni truncamientos.
    -- El ID legacy se conserva en source_legacy_id y NO es único.
    num_semana_raw TEXT,
    correo TEXT,
    usuario TEXT,
    fecha_raw TEXT,
    hora_raw TEXT,
    numero_serie TEXT,
    equipo_afectado TEXT,
    accesorio TEXT,
    numero_revision_raw TEXT,
    responsable_defecto_incidente TEXT,
    parte_afectada TEXT,
    area_responsable TEXT,
    causa_raiz TEXT,
    clasificacion_defecto_incidente TEXT,
    tipo_defectivo TEXT,
    clasificacion_defectivo TEXT,
    disposicion_defectivo TEXT,
    descripcion TEXT,
    desviacion TEXT,
    folio_desviacion TEXT,
    -- URL de carpeta legacy; no equivale a evidencias del modelo moderno.
    carpeta_drive_url TEXT,
    cant_img_guardadas_raw TEXT,
    version_app TEXT,

    -- Interpretación temporal separada de los originales.
    -- Tras validar fecha y hora, el instante se interpreta mediante:
    -- (fecha_local + hora_local) AT TIME ZONE 'America/Mexico_City'.
    source_timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
    fecha_local DATE,
    hora_local TIME WITHOUT TIME ZONE,
    fecha_hora_normalizada TIMESTAMPTZ,
    -- Describe únicamente la interpretación de fecha/hora.
    normalization_status TEXT NOT NULL DEFAULT 'PENDIENTE',
    -- Los problemas de cualquier campo se registran aquí. Los problemas
    -- ajenos a fecha/hora no cambian por sí solos normalization_status.
    validation_issues JSONB NOT NULL DEFAULT '[]'::jsonb,

    CONSTRAINT dc_legacy_spreadsheet_nonempty
        CHECK (btrim(source_spreadsheet_id) <> ''),

    CONSTRAINT dc_legacy_tab_gid_valid
        CHECK (source_tab_gid >= 0),

    CONSTRAINT dc_legacy_sheet_nonempty
        CHECK (btrim(source_sheet) <> ''),

    CONSTRAINT dc_legacy_source_row_valid
        CHECK (source_row >= 2),

    CONSTRAINT dc_legacy_snapshot_sha256_valid
        CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),

    CONSTRAINT dc_legacy_hash_valid
        CHECK (source_hash ~ '^[0-9a-f]{64}$'),

    CONSTRAINT dc_legacy_hash_version_valid
        CHECK (source_hash_version > 0),

    CONSTRAINT dc_legacy_payload_object
        CHECK (jsonb_typeof(source_payload) = 'object'),

    CONSTRAINT dc_legacy_payload_headers_array
        CHECK (
            CASE
                WHEN jsonb_typeof(source_payload -> 'headers') = 'array'
                THEN jsonb_array_length(source_payload -> 'headers') = 24
                ELSE FALSE
            END
        ),

    CONSTRAINT dc_legacy_payload_cells_array
        CHECK (
            CASE
                WHEN jsonb_typeof(source_payload -> 'cells') = 'array'
                THEN jsonb_array_length(source_payload -> 'cells') = 24
                ELSE FALSE
            END
        ),

    CONSTRAINT dc_legacy_timezone
        CHECK (source_timezone = 'America/Mexico_City'),

    CONSTRAINT dc_legacy_normalization_status
        CHECK (
            normalization_status IN (
                'PENDIENTE',
                'OK',
                'INCOMPLETA',
                'INVALIDA',
                'AMBIGUA'
            )
        ),

    CONSTRAINT dc_legacy_normalized_timestamp_status
        CHECK (
            (normalization_status = 'OK')
            = (fecha_hora_normalizada IS NOT NULL)
        ),

    CONSTRAINT dc_legacy_normalized_components
        CHECK (
            normalization_status <> 'OK'
            OR (
                fecha_local IS NOT NULL
                AND hora_local IS NOT NULL
            )
        ),

    CONSTRAINT dc_legacy_validation_issues_array
        CHECK (jsonb_typeof(validation_issues) = 'array'),

    -- Idempotencia por procedencia; no por ID legacy ni por hash.
    CONSTRAINT dc_legacy_source_position_unique
        UNIQUE (
            source_spreadsheet_id,
            source_tab_gid,
            source_row
        )
);

CREATE INDEX dc_legacy_source_legacy_id_idx
    ON public.desviaciones_calidad_legacy (source_legacy_id)
    WHERE source_legacy_id IS NOT NULL;

CREATE INDEX dc_legacy_fecha_hora_idx
    ON public.desviaciones_calidad_legacy (fecha_hora_normalizada)
    WHERE fecha_hora_normalizada IS NOT NULL;

CREATE INDEX dc_legacy_numero_serie_idx
    ON public.desviaciones_calidad_legacy (numero_serie)
    WHERE numero_serie IS NOT NULL;

CREATE INDEX dc_legacy_source_hash_idx
    ON public.desviaciones_calidad_legacy (
        source_hash_version,
        source_hash
    );

COMMIT;
