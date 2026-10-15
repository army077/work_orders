-- Migracion historica preparada exclusivamente para LOCAL TEST.
-- Destino: artecnologia_test_local.
-- Fuente legacy: "Sistema Rastreabilidad.xlsx", hoja Pre-Embarque
-- (gid 808292040, zona horaria America/Mexico_City).
-- Snapshot SHA-256: affe04cfa5199fbc24ceb45c6a5b2524ec3786c88b4fdc87dc12d3c42b0e1fd5
--
-- 1. Es una fuente historica legacy independiente.
-- 2. No existe una relacion historica demostrada con work_order,
--    machine_model ni inspection_order; por eso no hay FKs.
-- 3. Existen dos layouts reales:
--    LEGACY_V1 = filas operativas hasta 455 (A:Q sin serie_modulo_generador).
--    LEGACY_V2 = filas operativas desde 456 (N = serie_modulo_generador).
--    Los encabezados N:Q no sirven para interpretar todo el historico.
-- 4. semana_raw se preserva tal cual aunque contenga errores historicos
--    (desde la fila 975 es WEEKNUM sobre la HORA); no es dato confiable.
-- Este archivo solo crea la tabla e indices; no importa registros.

BEGIN;

DO $$
BEGIN
    IF current_database() <> 'artecnologia_test_local' THEN
        RAISE EXCEPTION
            'Esta migracion solo permite la base artecnologia_test_local';
    END IF;
END;
$$;

CREATE TABLE public.preembarque_legacy (
    id BIGSERIAL PRIMARY KEY,

    -- Procedencia.
    source_sheet TEXT NOT NULL,
    source_tab_gid BIGINT NOT NULL,
    source_row INTEGER NOT NULL,
    source_layout TEXT NOT NULL,

    -- Valores originales, sin normalizacion destructiva.
    correlativo_raw TEXT,
    semana_raw TEXT,
    usuario_raw TEXT,
    fecha_raw TEXT,
    hora_raw TEXT,
    cliente_raw TEXT,
    pedido_raw TEXT,
    serie_origen_raw TEXT,
    serie_asignada_raw TEXT,
    equipo_raw TEXT,
    accesorio_raw TEXT,
    descripcion_raw TEXT,
    desviacion_raw TEXT,
    -- Solo existe en LEGACY_V2.
    serie_modulo_generador_raw TEXT,
    carpeta_drive_raw TEXT,
    cantidad_imagenes_raw TEXT,
    version_app_raw TEXT,
    -- Solo LEGACY_V1 (columna Q), derivado o vacio.
    anio_raw TEXT,

    -- Valores derivados (America/Mexico_City); NULL si no son interpretables.
    fecha_local DATE,
    hora_local TIME,
    captured_at_local TIMESTAMP WITHOUT TIME ZONE,
    captured_at_utc TIMESTAMPTZ,

    -- Metadatos XLSX forenses de las celdas A:Q (address, t, v, w, z, f,
    -- hyperlink); complementa, no sustituye, los campos _raw.
    source_cells_meta JSONB NOT NULL DEFAULT '{}'::jsonb,

    record_status TEXT NOT NULL DEFAULT 'OK',
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,

    source_snapshot_sha256 TEXT NOT NULL,
    import_batch_id UUID NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT preembarque_legacy_source_layout_chk
        CHECK (source_layout IN ('LEGACY_V1', 'LEGACY_V2')),
    CONSTRAINT preembarque_legacy_source_row_chk
        CHECK (source_row >= 2),
    CONSTRAINT preembarque_legacy_record_status_chk
        CHECK (record_status IN ('OK', 'INCOMPLETA', 'INVALIDA', 'AMBIGUA')),
    CONSTRAINT preembarque_legacy_layout_row_chk
        CHECK (
            (source_layout = 'LEGACY_V1' AND source_row <= 455)
            OR (source_layout = 'LEGACY_V2' AND source_row >= 456)
        ),
    CONSTRAINT preembarque_legacy_cells_meta_object_chk
        CHECK (jsonb_typeof(source_cells_meta) = 'object'),
    CONSTRAINT preembarque_legacy_warnings_array_chk
        CHECK (jsonb_typeof(warnings) = 'array'),
    CONSTRAINT preembarque_legacy_snapshot_sha256_chk
        CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
    -- Idempotencia por procedencia; correlativo, pedido, series y Drive
    -- no son claves.
    CONSTRAINT preembarque_legacy_source_uk
        UNIQUE (
            source_sheet,
            source_tab_gid,
            source_row,
            source_snapshot_sha256
        )
);

COMMENT ON TABLE public.preembarque_legacy IS
    'Historico legacy de Pre-Embarque (hoja gid 808292040). Sin FK moderna demostrada; dos layouts (LEGACY_V1 <=455, LEGACY_V2 >=456).';
COMMENT ON COLUMN public.preembarque_legacy.source_layout IS
    'LEGACY_V1 = layout anterior a fila 456; LEGACY_V2 = layout desde fila 456 (con serie_modulo_generador).';
COMMENT ON COLUMN public.preembarque_legacy.semana_raw IS
    'Se preserva tal cual; desde la fila 975 es WEEKNUM sobre la hora, no confiable.';

CREATE INDEX preembarque_legacy_captured_at_utc_idx
    ON public.preembarque_legacy (captured_at_utc);
CREATE INDEX preembarque_legacy_pedido_raw_idx
    ON public.preembarque_legacy (pedido_raw);
CREATE INDEX preembarque_legacy_serie_origen_raw_idx
    ON public.preembarque_legacy (serie_origen_raw);
CREATE INDEX preembarque_legacy_serie_asignada_raw_idx
    ON public.preembarque_legacy (serie_asignada_raw);
CREATE INDEX preembarque_legacy_import_batch_id_idx
    ON public.preembarque_legacy (import_batch_id);

COMMIT;
