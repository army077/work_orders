-- Referencia canonica de la carpeta operacional de cada entrega, solo LOCAL.
-- No crea carpetas ni guarda nombres, URLs o credenciales de Google Drive.

BEGIN;

DO $$
BEGIN
    IF current_database() <> 'artecnologia_test_local' THEN
        RAISE EXCEPTION
            'Esta migracion solo permite la base artecnologia_test_local';
    END IF;
END;
$$;

ALTER TABLE public.logistica_deliveries
    ADD COLUMN drive_folder_id TEXT,
    ADD CONSTRAINT logistica_deliveries_drive_folder_chk
        CHECK (drive_folder_id IS NULL OR btrim(drive_folder_id) <> '');

CREATE UNIQUE INDEX logistica_deliveries_drive_folder_uk
    ON public.logistica_deliveries (drive_folder_id)
    WHERE drive_folder_id IS NOT NULL;

COMMIT;
