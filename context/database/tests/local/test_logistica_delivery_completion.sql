-- Preparada, NO ejecutar hasta aplicar la migracion incremental de finalizacion.
-- Solo filas temporales e IDs explicitos; no avanza secuencias ni consulta Drive.
BEGIN;

DO $$
BEGIN
    IF current_database() <> 'artecnologia_test_local' THEN
        RAISE EXCEPTION 'Esta prueba solo permite la base artecnologia_test_local';
    END IF;
END;
$$;

DO $$
DECLARE
    v_user public.logistica_authorized_users%ROWTYPE;
    v_original public.logistica_deliveries%ROWTYPE;
    v_candidate public.logistica_deliveries%ROWTYPE;
    v_updated public.logistica_deliveries%ROWTYPE;
    v_delivery_id BIGINT;
    v_request_id UUID;
    v_initial_deliveries BIGINT;
    v_initial_evidence BIGINT;
    v_case RECORD;
    v_constraint TEXT;
    v_rejected BOOLEAN;
    v_pass_count INTEGER := 0;
BEGIN
    SELECT * INTO v_user
    FROM public.logistica_authorized_users
    WHERE firebase_project = 'logistica-ar' AND is_active = true
    ORDER BY id LIMIT 1 FOR KEY SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Precondicion: se necesita un usuario activo de logistica-ar';
    END IF;

    LOCK TABLE public.logistica_deliveries IN SHARE ROW EXCLUSIVE MODE;
    SELECT count(*) INTO v_initial_deliveries FROM public.logistica_deliveries;
    SELECT count(*) INTO v_initial_evidence FROM public.logistica_delivery_evidence;
    SELECT LEAST(COALESCE(min(id), 0), 0) - 1 INTO v_delivery_id
    FROM public.logistica_deliveries;
    LOOP
        v_request_id := md5(clock_timestamp()::TEXT || random()::TEXT)::UUID;
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.logistica_deliveries WHERE client_request_id = v_request_id
        );
    END LOOP;

    INSERT INTO public.logistica_deliveries (
        id, client_request_id, authorized_user_id, firebase_project, firebase_uid,
        pedido, equipos, chofer, latitude, longitude
    ) VALUES (
        v_delivery_id, v_request_id, v_user.id, v_user.firebase_project, v_user.firebase_uid,
        'PRUEBA LOCAL FINALIZACION', 'Equipo de prueba local', 'Chofer de prueba local',
        20.1234567890123456789, -103.1234567890123456789
    ) RETURNING * INTO v_original;

    IF v_original.completion_latitude IS NOT NULL
        OR v_original.completion_longitude IS NOT NULL
        OR v_original.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL: DEFAULT de finalizacion debe ser NULL';
    END IF;

    -- Cada variante parte de la fila original y modifica solo campos nuevos/status.
    -- Los negativos verifican el nombre exacto del CHECK, sin falsos positivos.
    FOR v_case IN
        SELECT * FROM (VALUES
            (1, 'PENDING sin GPS final permitido', '{}'::JSONB, NULL::TEXT),
            (2, 'completion_latitude sola rechazada',
                jsonb_build_object('completion_latitude', 20),
                'logistica_deliveries_completion_pair_chk'),
            (3, 'completion_longitude sola rechazada',
                jsonb_build_object('completion_longitude', -103),
                'logistica_deliveries_completion_pair_chk'),
            (4, 'latitud mayor a 90 rechazada',
                jsonb_build_object('completion_latitude', 90.001, 'completion_longitude', 0),
                'logistica_deliveries_completion_latitude_chk'),
            (5, 'latitud menor a -90 rechazada',
                jsonb_build_object('completion_latitude', -90.001, 'completion_longitude', 0),
                'logistica_deliveries_completion_latitude_chk'),
            (6, 'longitud mayor a 180 rechazada',
                jsonb_build_object('completion_latitude', 0, 'completion_longitude', 180.001),
                'logistica_deliveries_completion_longitude_chk'),
            (7, 'longitud menor a -180 rechazada',
                jsonb_build_object('completion_latitude', 0, 'completion_longitude', -180.001),
                'logistica_deliveries_completion_longitude_chk'),
            (8, 'COMPLETED sin GPS ni fecha rechazado',
                jsonb_build_object('status', 'COMPLETED'),
                'logistica_deliveries_completed_metadata_chk'),
            (9, 'COMPLETED con GPS sin fecha rechazado',
                jsonb_build_object('status', 'COMPLETED', 'completion_latitude', 20, 'completion_longitude', -103),
                'logistica_deliveries_completed_metadata_chk'),
            (10, 'COMPLETED con fecha sin GPS rechazado',
                jsonb_build_object('status', 'COMPLETED', 'completed_at', now()),
                'logistica_deliveries_completed_metadata_chk'),
            (11, 'COMPLETED con GPS y fecha permitido',
                jsonb_build_object('status', 'COMPLETED', 'completion_latitude', 21,
                    'completion_longitude', -104, 'completed_at', now()), NULL::TEXT),
            (12, 'limites negativos inclusivos permitidos',
                jsonb_build_object('status', 'COMPLETED', 'completion_latitude', -90,
                    'completion_longitude', -180, 'completed_at', now()), NULL::TEXT),
            (13, 'limites positivos inclusivos permitidos',
                jsonb_build_object('status', 'COMPLETED', 'completion_latitude', 90,
                    'completion_longitude', 180, 'completed_at', now()), NULL::TEXT),
            (14, 'GPS cero permitido',
                jsonb_build_object('status', 'COMPLETED', 'completion_latitude', 0,
                    'completion_longitude', 0, 'completed_at', now()), NULL::TEXT),
            (15, 'NaN latitud rechazada',
                jsonb_build_object('completion_latitude', 'NaN', 'completion_longitude', 0),
                'logistica_deliveries_completion_latitude_chk'),
            (16, 'NaN longitud rechazada',
                jsonb_build_object('completion_latitude', 0, 'completion_longitude', 'NaN'),
                'logistica_deliveries_completion_longitude_chk'),
            (17, 'infinito latitud rechazado',
                jsonb_build_object('completion_latitude', 'Infinity', 'completion_longitude', 0),
                'logistica_deliveries_completion_latitude_chk'),
            (18, 'infinito longitud rechazado',
                jsonb_build_object('completion_latitude', 0, 'completion_longitude', '-Infinity'),
                'logistica_deliveries_completion_longitude_chk'),
            (19, 'copiar GPS original exacto permitido',
                jsonb_build_object('status', 'COMPLETED', 'completion_latitude', v_original.latitude,
                    'completion_longitude', v_original.longitude, 'completed_at', now()), NULL::TEXT)
        ) AS cases(test_no, description, patch, expected_constraint)
        ORDER BY test_no
    LOOP
        v_candidate := jsonb_populate_record(v_original, v_case.patch);
        v_rejected := false;
        BEGIN
            UPDATE public.logistica_deliveries
            SET status = v_candidate.status,
                completion_latitude = v_candidate.completion_latitude,
                completion_longitude = v_candidate.completion_longitude,
                completed_at = v_candidate.completed_at
            WHERE id = v_delivery_id AND client_request_id = v_request_id
            RETURNING * INTO v_updated;
        EXCEPTION WHEN check_violation THEN
            GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
            IF v_constraint IS DISTINCT FROM v_case.expected_constraint THEN
                RAISE EXCEPTION 'FAIL: %. %; CHECK recibido %, esperado %',
                    v_case.test_no, v_case.description, v_constraint, v_case.expected_constraint;
            END IF;
            v_rejected := true;
        END;
        IF v_case.expected_constraint IS NOT NULL AND NOT v_rejected THEN
            RAISE EXCEPTION 'FAIL: %. % aceptado indebidamente', v_case.test_no, v_case.description;
        END IF;
        IF NOT v_rejected THEN
            IF v_updated.latitude IS DISTINCT FROM v_original.latitude
                OR v_updated.longitude IS DISTINCT FROM v_original.longitude THEN
                RAISE EXCEPTION 'FAIL: coordenadas originales modificadas';
            END IF;
            IF v_case.test_no = 19 AND (
                v_updated.completion_latitude IS DISTINCT FROM v_original.latitude
                OR v_updated.completion_longitude IS DISTINCT FROM v_original.longitude
            ) THEN
                RAISE EXCEPTION 'FAIL: GPS original no copiado exactamente';
            END IF;
        END IF;
        v_pass_count := v_pass_count + 1;
        RAISE NOTICE 'PASS: %. %', v_case.test_no, v_case.description;
    END LOOP;

    IF v_pass_count <> 19
        OR (SELECT count(*) FROM public.logistica_deliveries) <> v_initial_deliveries + 1
        OR (SELECT count(*) FROM public.logistica_delivery_evidence) <> v_initial_evidence THEN
        RAISE EXCEPTION 'FAIL: casos o conteos inesperados antes de ROLLBACK';
    END IF;
    RAISE NOTICE 'PASS: 19 variantes y DEFAULT; ROLLBACK elimina la unica entrega de prueba';
END;
$$;

ROLLBACK;
