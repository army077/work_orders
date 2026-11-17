-- Archivo historico independiente. No autentica identidades ni representa
-- estados, finalizacion o evidencias del flujo operacional.
-- Fuente congelada: Sistema Rastreabilidad.xlsx / Entregas / filas 2..1003.
-- SHA256: affe04cfa5199fbc24ceb45c6a5b2524ec3786c88b4fdc87dc12d3c42b0e1fd5
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

    -- Celdas A:T: tipo, valor, texto visible, formato, formula y hyperlink.
    -- No se ejecutan formulas ni se descarga el destino de los hyperlinks.
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

COMMENT ON COLUMN public.entregas_logistica_legacy.local_datetime IS
    'FECHA+HORA literales del Sheet. Zona horaria desconocida; no afirma UTC ni finalizacion.';
COMMENT ON COLUMN public.entregas_logistica_legacy.correo IS
    'Correo declarado legacy; no acredita identidad Firebase ni ownership.';
COMMENT ON COLUMN public.entregas_logistica_legacy.legacy_image_count IS
    'Contador declarado legacy; no equivale a PHOTO UPLOADED ni acredita archivos individuales.';
COMMENT ON COLUMN public.entregas_logistica_legacy.drive_folder_id IS
    'ID extraido de la URL historica, sin consultar existencia, permisos ni contenido en Drive.';

CREATE INDEX entregas_logistica_legacy_pedido_idx
    ON public.entregas_logistica_legacy (pedido);
CREATE INDEX entregas_logistica_legacy_local_datetime_idx
    ON public.entregas_logistica_legacy (local_datetime);
CREATE INDEX entregas_logistica_legacy_drive_folder_idx
    ON public.entregas_logistica_legacy (drive_folder_id);
CREATE INDEX entregas_logistica_legacy_batch_idx
    ON public.entregas_logistica_legacy (import_batch_id);
COMMIT;
