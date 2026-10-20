-- Prueba LOCAL no destructiva; requiere la migracion de drive_folder_id.
-- Referencias ficticias: no conecta con Drive ni utiliza credenciales OAuth.
-- IDs explicitos para no avanzar secuencias; todos los INSERT se revierten.

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
    v_case RECORD;
    v_delivery_id BIGINT;
    v_request_id UUID;
    v_folder_a TEXT;
    v_folder_b TEXT;
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
    LIMIT 1
    FOR KEY SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'Precondicion incumplida: se necesita un usuario activo de logistica-ar';
    END IF;

    LOCK TABLE public.logistica_deliveries, public.logistica_delivery_evidence
        IN SHARE ROW EXCLUSIVE MODE;

    SELECT count(*) INTO v_initial_deliveries FROM public.logistica_deliveries;
    SELECT count(*) INTO v_initial_evidence FROM public.logistica_delivery_evidence;
    SELECT LEAST(COALESCE(min(id), 0), 0) - 1 INTO v_delivery_id
    FROM public.logistica_deliveries;

    LOOP
        v_folder_a := 'LOCAL_TEST_' || md5(clock_timestamp()::TEXT || random()::TEXT);
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.logistica_deliveries WHERE drive_folder_id = v_folder_a
        );
    END LOOP;
    LOOP
        v_folder_b := 'LOCAL_TEST_' || md5(clock_timestamp()::TEXT || random()::TEXT);
        EXIT WHEN v_folder_b <> v_folder_a AND NOT EXISTS (
            SELECT 1 FROM public.logistica_deliveries WHERE drive_folder_id = v_folder_b
        );
    END LOOP;

    FOR v_case IN
        SELECT * FROM (VALUES
            (1, 'drive_folder_id NULL permitido', NULL::TEXT, NULL::TEXT, NULL::TEXT),
            (2, 'drive_folder_id valido permitido', v_folder_a, NULL::TEXT, NULL::TEXT),
            (3, 'drive_folder_id vacio rechazado', '',
                '23514', 'logistica_deliveries_drive_folder_chk'),
            (4, 'drive_folder_id de espacios rechazado', '   ',
                '23514', 'logistica_deliveries_drive_folder_chk'),
            (5, 'mismo drive_folder_id en dos entregas rechazado', v_folder_a,
                '23505', 'logistica_deliveries_drive_folder_uk'),
            (6, 'dos drive_folder_id diferentes permitidos', v_folder_b, NULL::TEXT, NULL::TEXT),
            (7, 'dos entregas con drive_folder_id NULL permitidas', NULL::TEXT, NULL::TEXT, NULL::TEXT)
        ) AS cases(test_no, description, folder_id, expected_sqlstate, expected_constraint)
        ORDER BY test_no
    LOOP
        LOOP
            v_request_id := md5(clock_timestamp()::TEXT || random()::TEXT)::UUID;
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM public.logistica_deliveries WHERE client_request_id = v_request_id
            );
        END LOOP;
        v_rejected := false;
        BEGIN
            INSERT INTO public.logistica_deliveries (
                id, client_request_id, authorized_user_id, firebase_project, firebase_uid,
                auth_email, auth_display_name, pedido, equipos, chofer, drive_folder_id
            ) VALUES (
                v_delivery_id, v_request_id, v_user.id, v_user.firebase_project, v_user.firebase_uid,
                v_user.email, v_user.display_name, 'PRUEBA LOCAL CARPETA DRIVE',
                'Equipo de prueba local', 'Chofer de prueba local', v_case.folder_id
            );
        EXCEPTION
            WHEN check_violation OR unique_violation THEN
                GET STACKED DIAGNOSTICS
                    v_constraint = CONSTRAINT_NAME,
                    v_sqlstate = RETURNED_SQLSTATE;
                IF v_case.expected_sqlstate IS NULL
                    OR v_sqlstate IS DISTINCT FROM v_case.expected_sqlstate
                    OR v_constraint IS DISTINCT FROM v_case.expected_constraint THEN
                    RAISE EXCEPTION
                        'FAIL: %. %; recibido % (%), esperado % (%)',
                        v_case.test_no, v_case.description, v_constraint, v_sqlstate,
                        v_case.expected_constraint, v_case.expected_sqlstate;
                END IF;
                v_rejected := true;
        END;
        IF v_case.expected_sqlstate IS NOT NULL AND NOT v_rejected THEN
            RAISE EXCEPTION 'FAIL: %. %; INSERT aceptado indebidamente',
                v_case.test_no, v_case.description;
        END IF;
        RAISE NOTICE 'PASS: %. %', v_case.test_no, v_case.description;
        v_pass_count := v_pass_count + 1;
        v_delivery_id := v_delivery_id - 1;
    END LOOP;

    IF v_pass_count <> 7
        OR (SELECT count(*) FROM public.logistica_deliveries) <> v_initial_deliveries + 4
        OR (SELECT count(*) FROM public.logistica_delivery_evidence) <> v_initial_evidence
        OR (SELECT count(*) FROM public.logistica_deliveries WHERE drive_folder_id = v_folder_a) <> 1
        OR (SELECT count(*) FROM public.logistica_deliveries WHERE drive_folder_id = v_folder_b) <> 1 THEN
        RAISE EXCEPTION 'FAIL: cobertura o conteos inesperados antes del ROLLBACK';
    END IF;
    RAISE NOTICE 'PASS: 7/7 pruebas; el ROLLBACK revierte 4 entregas sin avanzar secuencias';
END;
$$;

ROLLBACK;
