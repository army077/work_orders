-- Migración histórica preparada exclusivamente para LOCAL TEST.
-- Destino: artecnologia_test_local.
-- Fuente: Procesos de liberacion (gid 464343719), filas 2-1015
-- (1014 registros). Incluye las filas anómalas 832, 833 y 834.
-- La fila 1016 es una prueba posterior y queda fuera; la fila 1017 está
-- vacía y es la frontera física. Ese corte pertenece al importer/dry-run,
-- no al esquema.
-- Es un histórico independiente: no se relaciona con inspection_order,
-- work_order ni tablas modernas, y no se deduplica ninguna fila.
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

CREATE TABLE public.procesos_liberacion_legacy (
    -- Identidad técnica independiente del correlativo original.
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
    --   "headers": [17 encabezados originales A:Q en orden],
    --   "cells": [17 valores originales A:Q en el mismo orden]
    -- }
    -- Debe preservar strings/null, incluidos espacios, NBSP, CR/LF y la
    -- diferencia entre string vacío y null. El hashing usa estos valores
    -- originales antes de cualquier normalización, con serialización
    -- canónica versionada; no debe usar directamente source_payload::text.
    -- source_snapshot_sha256 identifica los bytes de la captura congelada;
    -- source_hash identifica el contenido original de cada fila.
    source_payload JSONB NOT NULL,

    -- Campos originales A:Q: sin conversiones, limpieza ni truncamientos.
    -- A (#) se conserva en source_legacy_id y NO es único por contrato.
    -- B (Num de semana) es una fórmula WEEKNUM(E); se guarda su valor visible.
    num_semana_raw TEXT,
    correo TEXT,
    usuario TEXT,
    fecha_raw TEXT,
    hora_raw TEXT,
    numero_serie TEXT,
    equipo_afectado TEXT,
    accesorio TEXT,
    operador_responsable TEXT,
    estacion_raw TEXT,
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

    CONSTRAINT pl_legacy_spreadsheet_nonempty
        CHECK (btrim(source_spreadsheet_id) <> ''),

    CONSTRAINT pl_legacy_tab_gid_valid
        CHECK (source_tab_gid >= 0),

    CONSTRAINT pl_legacy_sheet_nonempty
        CHECK (btrim(source_sheet) <> ''),

    CONSTRAINT pl_legacy_source_row_valid
        CHECK (source_row >= 2),

    CONSTRAINT pl_legacy_snapshot_sha256_valid
        CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),

    CONSTRAINT pl_legacy_hash_valid
        CHECK (source_hash ~ '^[0-9a-f]{64}$'),

    CONSTRAINT pl_legacy_hash_version_valid
        CHECK (source_hash_version > 0),

    CONSTRAINT pl_legacy_payload_object
        CHECK (jsonb_typeof(source_payload) = 'object'),

    CONSTRAINT pl_legacy_payload_headers_array
        CHECK (
            CASE
                WHEN jsonb_typeof(source_payload -> 'headers') = 'array'
                THEN jsonb_array_length(source_payload -> 'headers') = 17
                ELSE FALSE
            END
        ),

    CONSTRAINT pl_legacy_payload_cells_array
        CHECK (
            CASE
                WHEN jsonb_typeof(source_payload -> 'cells') = 'array'
                THEN jsonb_array_length(source_payload -> 'cells') = 17
                ELSE FALSE
            END
        ),

    CONSTRAINT pl_legacy_timezone
        CHECK (source_timezone = 'America/Mexico_City'),

    CONSTRAINT pl_legacy_normalization_status
        CHECK (
            normalization_status IN (
                'PENDIENTE',
                'OK',
                'INCOMPLETA',
                'INVALIDA',
                'AMBIGUA'
            )
        ),

    CONSTRAINT pl_legacy_normalized_timestamp_status
        CHECK (
            (normalization_status = 'OK')
            = (fecha_hora_normalizada IS NOT NULL)
        ),

    CONSTRAINT pl_legacy_normalized_components
        CHECK (
            normalization_status <> 'OK'
            OR (
                fecha_local IS NOT NULL
                AND hora_local IS NOT NULL
            )
        ),

    CONSTRAINT pl_legacy_validation_issues_array
        CHECK (jsonb_typeof(validation_issues) = 'array'),

    -- Idempotencia por procedencia; no por correlativo, serie, Drive,
    -- folio ni hash.
    CONSTRAINT pl_legacy_source_position_unique
        UNIQUE (
            source_spreadsheet_id,
            source_tab_gid,
            source_row
        )
);

CREATE INDEX pl_legacy_source_legacy_id_idx
    ON public.procesos_liberacion_legacy (source_legacy_id)
    WHERE source_legacy_id IS NOT NULL;

CREATE INDEX pl_legacy_fecha_hora_idx
    ON public.procesos_liberacion_legacy (fecha_hora_normalizada)
    WHERE fecha_hora_normalizada IS NOT NULL;

CREATE INDEX pl_legacy_numero_serie_idx
    ON public.procesos_liberacion_legacy (numero_serie)
    WHERE numero_serie IS NOT NULL;

CREATE INDEX pl_legacy_source_hash_idx
    ON public.procesos_liberacion_legacy (
        source_hash_version,
        source_hash
    );

COMMIT;
