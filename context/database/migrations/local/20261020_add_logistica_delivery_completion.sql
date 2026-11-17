-- Incremental exclusivamente LOCAL. Preparada para aplicar por separado.
-- El GPS original conserva la identidad del payload de creación.
BEGIN;

DO $$
BEGIN
    IF current_database() <> 'artecnologia_test_local' THEN
        RAISE EXCEPTION 'Esta migracion solo permite la base artecnologia_test_local';
    END IF;
END;
$$;

ALTER TABLE public.logistica_deliveries
    ADD COLUMN completion_latitude NUMERIC NULL,
    ADD COLUMN completion_longitude NUMERIC NULL,
    ADD COLUMN completed_at TIMESTAMPTZ NULL,
    ADD CONSTRAINT logistica_deliveries_completion_pair_chk
        CHECK ((completion_latitude IS NULL) = (completion_longitude IS NULL)),
    ADD CONSTRAINT logistica_deliveries_completion_latitude_chk
        CHECK (completion_latitude BETWEEN -90 AND 90),
    ADD CONSTRAINT logistica_deliveries_completion_longitude_chk
        CHECK (completion_longitude BETWEEN -180 AND 180),
    ADD CONSTRAINT logistica_deliveries_completed_metadata_chk
        CHECK (status <> 'COMPLETED' OR (
            completed_at IS NOT NULL
            AND completion_latitude IS NOT NULL
            AND completion_longitude IS NOT NULL
        ));

COMMIT;
