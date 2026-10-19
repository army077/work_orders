-- Prueba LOCAL no destructiva. No ejecutar en produccion.
-- Requiere las migraciones de usuarios autorizados y Entregas ya aplicadas.
-- Los IDs se calculan y se insertan explicitamente: no se avanza ningun BIGSERIAL.
-- No modifica usuarios existentes. Todos los INSERT se revierten al finalizar.

BEGIN;

DO $$
BEGIN
    IF current_database() <> 'artecnologia_test_local' THEN
        RAISE EXCEPTION
            'Esta prueba solo permite la base artecnologia_test_local';
    END IF;
END;
$$;

DO $$
DECLARE
    v_user public.logistica_authorized_users%ROWTYPE;
    v_valid public.logistica_deliveries%ROWTYPE;
    v_candidate public.logistica_deliveries%ROWTYPE;
    v_case RECORD;
    v_missing_user_id BIGINT;
    v_delivery_id BIGINT;
    v_evidence_id BIGINT;
    v_other_request_id UUID;
    v_sequence_no INTEGER;
    v_rejected BOOLEAN;
    v_constraint TEXT;
    v_sqlstate TEXT;
    v_pass_count INTEGER := 0;
    v_initial_deliveries BIGINT;
    v_initial_evidence BIGINT;
BEGIN
    SELECT * INTO v_user
    FROM public.logistica_authorized_users
    WHERE firebase_project = 'logistica-ar'
      AND is_active = true
    ORDER BY id
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Precondicion incumplida: se necesita un usuario activo de logistica-ar';
    END IF;

    -- Estabiliza los IDs calculados y los conteos frente a otras escrituras.
    -- Estos bloqueos se liberan con el ROLLBACK final (o al abortar la sesion).
    LOCK TABLE public.logistica_deliveries, public.logistica_delivery_evidence
        IN SHARE ROW EXCLUSIVE MODE;

    SELECT count(*) INTO v_initial_deliveries
    FROM public.logistica_deliveries;

    SELECT count(*) INTO v_initial_evidence
    FROM public.logistica_delivery_evidence;

    SELECT LEAST(COALESCE(min(id), 0), 0) - 1 INTO v_delivery_id
    FROM public.logistica_deliveries;

    SELECT LEAST(COALESCE(min(id), 0), 0) - 1 INTO v_evidence_id
    FROM public.logistica_delivery_evidence;

    SELECT LEAST(COALESCE(min(id), 0), 0) - 1 INTO v_missing_user_id
    FROM public.logistica_authorized_users;

    -- UUIDs locales de prueba, sin requerir extensiones PostgreSQL.
    LOOP
        v_valid.client_request_id :=
            md5(clock_timestamp()::TEXT || random()::TEXT)::UUID;
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.logistica_deliveries
            WHERE client_request_id = v_valid.client_request_id
        );
    END LOOP;

    LOOP
        v_other_request_id :=
            md5(clock_timestamp()::TEXT || random()::TEXT)::UUID;
        EXIT WHEN v_other_request_id <> v_valid.client_request_id
            AND NOT EXISTS (
                SELECT 1 FROM public.logistica_deliveries
                WHERE client_request_id = v_other_request_id
            );
    END LOOP;

    v_valid.id := v_delivery_id;
    v_valid.authorized_user_id := v_user.id;
    v_valid.firebase_project := v_user.firebase_project;
    v_valid.firebase_uid := v_user.firebase_uid;
    v_valid.auth_email := v_user.email;
    v_valid.auth_display_name := v_user.display_name;
    v_valid.pedido := 'PRUEBA LOCAL RESTRICCIONES';
    v_valid.equipos := 'Equipo de prueba local';
    v_valid.chofer := 'Chofer de prueba local';
    v_valid.status := 'PENDING_EVIDENCE';
    v_valid.created_at := now();
    v_valid.updated_at := now();

    -- 1: la entrega valida permite ambas coordenadas NULL.
    INSERT INTO public.logistica_deliveries SELECT (v_valid).*;
    RAISE NOTICE 'PASS: 1. entrega valida -> INSERT permitido';
    v_pass_count := v_pass_count + 1;

    -- Cada INSERT esperado como invalido usa un ID libre y un UUID distinto.
    -- Se verifica tanto el SQLSTATE como el nombre exacto de la restriccion.
    FOR v_case IN
        SELECT * FROM (VALUES
            (2, 'pedido vacio rechazado',
                jsonb_build_object('pedido', '   '),
                '23514', 'logistica_deliveries_pedido_chk'),
            (3, 'equipos vacio rechazado',
                jsonb_build_object('equipos', '   '),
                '23514', 'logistica_deliveries_equipos_chk'),
            (4, 'chofer vacio rechazado',
                jsonb_build_object('chofer', '   '),
                '23514', 'logistica_deliveries_chofer_chk'),
            (5, 'solo latitude rechazado',
                jsonb_build_object('latitude', 19.4326),
                '23514', 'logistica_deliveries_coordinates_chk'),
            (6, 'solo longitude rechazado',
                jsonb_build_object('longitude', -99.1332),
                '23514', 'logistica_deliveries_coordinates_chk'),
            (7, 'latitude > 90 rechazado',
                jsonb_build_object('latitude', 91, 'longitude', 0),
                '23514', 'logistica_deliveries_latitude_chk'),
            (8, 'longitude > 180 rechazado',
                jsonb_build_object('latitude', 0, 'longitude', 181),
                '23514', 'logistica_deliveries_longitude_chk'),
            (9, 'authorized_user_id inexistente rechazado por FK',
                jsonb_build_object('authorized_user_id', v_missing_user_id),
                '23503', 'logistica_deliveries_authorized_user_fk'),
            (10, 'firebase_project distinto de logistica-ar rechazado',
                jsonb_build_object('firebase_project', 'proyecto-invalido'),
                '23514', 'logistica_deliveries_project_chk'),
            (11, 'client_request_id duplicado rechazado',
                jsonb_build_object('client_request_id', v_valid.client_request_id),
                '23505', 'logistica_deliveries_client_request_uk'),
            (12, 'status no permitido rechazado',
                jsonb_build_object('status', 'INVALID_STATUS'),
                '23514', 'logistica_deliveries_status_chk')
        ) AS cases(test_no, description, patch, expected_sqlstate, expected_constraint)
        ORDER BY test_no
    LOOP
        v_candidate := v_valid;
        v_candidate.id := v_delivery_id - 1;
        v_candidate.client_request_id := v_other_request_id;
        v_candidate := jsonb_populate_record(v_candidate, v_case.patch);
        v_rejected := false;

        BEGIN
            INSERT INTO public.logistica_deliveries SELECT (v_candidate).*;
        EXCEPTION
            WHEN check_violation OR foreign_key_violation OR unique_violation THEN
                GET STACKED DIAGNOSTICS
                    v_constraint = CONSTRAINT_NAME,
                    v_sqlstate = RETURNED_SQLSTATE;
                IF v_sqlstate <> v_case.expected_sqlstate
                    OR v_constraint IS DISTINCT FROM v_case.expected_constraint THEN
                    RAISE EXCEPTION
                        'FAIL: %. %; restriccion inesperada: % (%), esperada: % (%)',
                        v_case.test_no, v_case.description,
                        v_constraint, v_sqlstate,
                        v_case.expected_constraint, v_case.expected_sqlstate;
                END IF;
                v_rejected := true;
        END;

        -- Fuera del EXCEPTION para no confundir una aceptacion con un rechazo.
        IF NOT v_rejected THEN
            RAISE EXCEPTION 'FAIL: %. %; INSERT aceptado indebidamente',
                v_case.test_no, v_case.description;
        END IF;
        RAISE NOTICE 'PASS: %. %', v_case.test_no, v_case.description;
        v_pass_count := v_pass_count + 1;
    END LOOP;

    FOR v_case IN
        SELECT * FROM (VALUES
            (13, 'PHOTO sequence 1 permitido', 'PHOTO', ARRAY[1],
                NULL::TEXT, NULL::TEXT),
            (14, 'PHOTO sequence 2 permitido', 'PHOTO', ARRAY[2],
                NULL::TEXT, NULL::TEXT),
            (15, 'PHOTO sequence 1 duplicado rechazado', 'PHOTO', ARRAY[1],
                '23505', 'logistica_delivery_evidence_sequence_uk'),
            (16, 'SIGNATURE sequence 1 permitido', 'SIGNATURE', ARRAY[1],
                NULL::TEXT, NULL::TEXT),
            (17, 'segunda SIGNATURE con otra secuencia rechazada por indice parcial',
                'SIGNATURE', ARRAY[2],
                '23505', 'logistica_delivery_evidence_signature_uk'),
            (18, 'evidence_type invalido rechazado', 'INVALID_TYPE', ARRAY[1],
                '23514', 'logistica_delivery_evidence_type_chk'),
            (19, 'sequence_no <= 0 rechazado (0 y -1)', 'PHOTO', ARRAY[0, -1],
                '23514', 'logistica_delivery_evidence_sequence_chk')
        ) AS cases(test_no, description, evidence_type, sequences,
                   expected_sqlstate, expected_constraint)
        ORDER BY test_no
    LOOP
        FOREACH v_sequence_no IN ARRAY v_case.sequences
        LOOP
            v_rejected := false;
            BEGIN
                INSERT INTO public.logistica_delivery_evidence
                    (id, delivery_id, evidence_type, sequence_no)
                VALUES
                    (v_evidence_id, v_delivery_id, v_case.evidence_type, v_sequence_no);
            EXCEPTION
                WHEN check_violation OR foreign_key_violation OR unique_violation THEN
                    GET STACKED DIAGNOSTICS
                        v_constraint = CONSTRAINT_NAME,
                        v_sqlstate = RETURNED_SQLSTATE;
                    IF v_case.expected_sqlstate IS NULL
                        OR v_sqlstate <> v_case.expected_sqlstate
                        OR v_constraint IS DISTINCT FROM v_case.expected_constraint THEN
                        RAISE EXCEPTION
                            'FAIL: %. %; restriccion inesperada: % (%)',
                            v_case.test_no, v_case.description,
                            v_constraint, v_sqlstate;
                    END IF;
                    v_rejected := true;
            END;

            IF v_case.expected_sqlstate IS NOT NULL AND NOT v_rejected THEN
                RAISE EXCEPTION 'FAIL: %. %; INSERT aceptado indebidamente',
                    v_case.test_no, v_case.description;
            END IF;
            v_evidence_id := v_evidence_id - 1;
        END LOOP;
        RAISE NOTICE 'PASS: %. %', v_case.test_no, v_case.description;
        v_pass_count := v_pass_count + 1;
    END LOOP;

    IF v_pass_count <> 19 THEN
        RAISE EXCEPTION 'FAIL: se esperaban 19 pruebas, se completaron %', v_pass_count;
    END IF;

    -- Solo deben sobrevivir dentro de la transaccion los cuatro INSERT validos:
    -- una entrega, dos PHOTO y una SIGNATURE. Los rechazos usan subtransacciones.
    IF (SELECT count(*) FROM public.logistica_deliveries)
            <> v_initial_deliveries + 1
        OR (SELECT count(*) FROM public.logistica_delivery_evidence)
            <> v_initial_evidence + 3 THEN
        RAISE EXCEPTION
            'FAIL: conteos inesperados antes de ROLLBACK; algun rechazo dejo filas';
    END IF;
    RAISE NOTICE 'PASS: 19/19 pruebas completadas; se revierten los INSERT con ROLLBACK';
END;
$$;

-- Obligatorio: revierte todas las filas de prueba; no se ejecuta COMMIT.
ROLLBACK;
