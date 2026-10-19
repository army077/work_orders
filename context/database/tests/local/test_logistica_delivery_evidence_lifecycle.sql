-- Prueba LOCAL no destructiva; requiere la migracion incremental de evidencias.
-- No conecta con Drive: las referencias externas son metadatos ficticios.
-- Los IDs de filas se calculan y se insertan explicitamente: no se usa nextval.
-- No modifica usuarios ni filas existentes; todos los INSERT terminan en ROLLBACK.

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
    v_pending public.logistica_delivery_evidence%ROWTYPE;
    v_uploaded public.logistica_delivery_evidence%ROWTYPE;
    v_candidate public.logistica_delivery_evidence%ROWTYPE;
    v_case RECORD;
    v_delivery_id BIGINT;
    v_next_evidence_id BIGINT;
    v_request_id UUID;
    v_evidence_uuid UUID;
    v_uploaded_file_id TEXT;
    v_sequence_no INTEGER := 2;
    v_rejected BOOLEAN;
    v_constraint TEXT;
    v_sqlstate TEXT;
    v_column TEXT;
    v_initial_deliveries BIGINT;
    v_initial_evidence BIGINT;
    v_accepted_evidence BIGINT := 1;
    v_pass_count INTEGER := 1;
    v_completed_tests INTEGER[] := ARRAY[1];
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
    SELECT LEAST(COALESCE(min(id), 0), 0) - 1 INTO v_next_evidence_id
    FROM public.logistica_delivery_evidence;

    -- UUIDs de prueba sin extensiones. No se calculan hashes de archivos en DB.
    LOOP
        v_request_id := md5(clock_timestamp()::TEXT || random()::TEXT)::UUID;
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.logistica_deliveries
            WHERE client_request_id = v_request_id
        );
    END LOOP;

    LOOP
        v_evidence_uuid := md5(clock_timestamp()::TEXT || random()::TEXT)::UUID;
        v_uploaded_file_id := 'LOCAL_TEST_' || v_evidence_uuid::TEXT;
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.logistica_delivery_evidence
            WHERE client_evidence_id = v_evidence_uuid
               OR (storage_provider = 'GOOGLE_DRIVE'
                   AND external_file_id = v_uploaded_file_id)
        );
    END LOOP;

    INSERT INTO public.logistica_deliveries (
        id, client_request_id, authorized_user_id, firebase_project, firebase_uid,
        auth_email, auth_display_name, pedido, equipos, chofer, latitude, longitude
    ) VALUES (
        v_delivery_id, v_request_id, v_user.id, v_user.firebase_project,
        v_user.firebase_uid, v_user.email, v_user.display_name,
        'PRUEBA LOCAL CICLO EVIDENCIAS', 'Equipo de prueba local',
        'Chofer de prueba local', 20.0, -103.0
    );

    -- 1. Usa los DEFAULT reales de status y updated_at, sin metadata externa.
    INSERT INTO public.logistica_delivery_evidence (
        id, delivery_id, evidence_type, sequence_no, client_evidence_id
    ) VALUES (
        v_next_evidence_id, v_delivery_id, 'PHOTO', 1, v_evidence_uuid
    ) RETURNING * INTO v_pending;

    IF v_pending.status IS DISTINCT FROM 'PENDING'
        OR v_pending.updated_at IS NULL
        OR v_pending.processing_token IS NOT NULL
        OR v_pending.processing_expires_at IS NOT NULL THEN
        RAISE EXCEPTION 'FAIL: 1. DEFAULT de PENDING/updated_at o reserva incorrectos';
    END IF;
    RAISE NOTICE 'PASS: 1. PENDING valido con DEFAULT y sin metadata externa';
    v_next_evidence_id := v_next_evidence_id - 1;

    v_uploaded := v_pending;
    v_uploaded.status := 'UPLOADED';
    v_uploaded.storage_provider := 'GOOGLE_DRIVE';
    v_uploaded.mime_type := 'image/png';
    v_uploaded.file_size_bytes := 128;
    v_uploaded.sha256 := repeat('a', 64);

    -- Cada variante tiene ID, UUID y secuencia libres salvo el duplicado probado.
    -- Se comprueban SQLSTATE y restriccion exacta para evitar falsos PASS.
    FOR v_case IN
        SELECT * FROM (VALUES
            (2, 1, 'client_evidence_id duplicado rechazado', 'PENDING',
                jsonb_build_object('client_evidence_id', v_pending.client_evidence_id),
                '23505', 'logistica_delivery_evidence_client_evidence_uk', NULL::TEXT),
            (3, 1, 'status invalido rechazado', 'PENDING',
                jsonb_build_object('status', 'INVALID_STATUS'),
                '23514', 'logistica_delivery_evidence_status_chk', NULL::TEXT),
            (4, 1, 'processing_token sin expires rechazado', 'PENDING',
                jsonb_build_object('processing_token', v_request_id),
                '23514', 'logistica_delivery_evidence_processing_pair_chk', NULL::TEXT),
            (5, 1, 'expires sin processing_token rechazado', 'PENDING',
                jsonb_build_object('processing_expires_at', now() + interval '5 minutes'),
                '23514', 'logistica_delivery_evidence_processing_pair_chk', NULL::TEXT),
            (6, 1, 'UPLOADED valido con metadata completa y SHA256 hexadecimal mayusculo', 'UPLOADED',
                jsonb_build_object('external_file_id', v_uploaded_file_id, 'sha256', repeat('A', 64)),
                NULL::TEXT, NULL::TEXT, NULL::TEXT),
            (7, 1, 'UPLOADED con external_file_id NULL rechazado', 'UPLOADED',
                jsonb_build_object('external_file_id', NULL::TEXT),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (7, 2, 'UPLOADED con external_file_id vacio rechazado', 'UPLOADED',
                jsonb_build_object('external_file_id', ''),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (7, 3, 'UPLOADED con external_file_id de espacios rechazado', 'UPLOADED',
                jsonb_build_object('external_file_id', '   '),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (8, 1, 'UPLOADED con MIME NULL rechazado', 'UPLOADED',
                jsonb_build_object('mime_type', NULL::TEXT),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (8, 2, 'UPLOADED con MIME vacio rechazado', 'UPLOADED',
                jsonb_build_object('mime_type', ''),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (8, 3, 'UPLOADED con MIME de espacios rechazado', 'UPLOADED',
                jsonb_build_object('mime_type', '   '),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (9, 1, 'UPLOADED con size NULL rechazado', 'UPLOADED',
                jsonb_build_object('file_size_bytes', NULL::BIGINT),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (9, 2, 'UPLOADED con size 0 rechazado', 'UPLOADED',
                jsonb_build_object('file_size_bytes', 0),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (9, 3, 'UPLOADED con size negativo rechazado', 'UPLOADED',
                jsonb_build_object('file_size_bytes', -1),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (10, 1, 'UPLOADED con SHA256 NULL rechazado', 'UPLOADED',
                jsonb_build_object('sha256', NULL::TEXT),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (10, 2, 'UPLOADED con SHA256 de 63 caracteres rechazado', 'UPLOADED',
                jsonb_build_object('sha256', repeat('a', 63)),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (10, 3, 'UPLOADED con SHA256 de 65 caracteres rechazado', 'UPLOADED',
                jsonb_build_object('sha256', repeat('a', 65)),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (10, 4, 'UPLOADED con SHA256 no hexadecimal rechazado', 'UPLOADED',
                jsonb_build_object('sha256', repeat('g', 64)),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (10, 5, 'UPLOADED con SHA256 vacio rechazado', 'UPLOADED',
                jsonb_build_object('sha256', ''),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (11, 1, 'external_file_id duplicado para GOOGLE_DRIVE rechazado', 'UPLOADED',
                jsonb_build_object('external_file_id', v_uploaded_file_id),
                '23505', 'logistica_delivery_evidence_external_file_uk', NULL::TEXT),
            (12, 1, 'FAILED con metadata externa parcial permitido', 'UPLOADED',
                jsonb_build_object('status', 'FAILED', 'mime_type', NULL::TEXT,
                    'file_size_bytes', NULL::BIGINT, 'sha256', NULL::TEXT),
                NULL::TEXT, NULL::TEXT, NULL::TEXT),
            (13, 1, 'PHOTO sequence 2 permitido junto a sequence 1', 'PENDING',
                jsonb_build_object('sequence_no', 2),
                NULL::TEXT, NULL::TEXT, NULL::TEXT),
            (13, 2, 'PHOTO sequence 1 duplicado rechazado', 'PENDING',
                jsonb_build_object('sequence_no', 1),
                '23505', 'logistica_delivery_evidence_sequence_uk', NULL::TEXT),
            (13, 3, 'PHOTO sequence 2 duplicado rechazado', 'PENDING',
                jsonb_build_object('sequence_no', 2),
                '23505', 'logistica_delivery_evidence_sequence_uk', NULL::TEXT),
            (13, 4, 'PHOTO sequence 0 rechazado', 'PENDING',
                jsonb_build_object('sequence_no', 0),
                '23514', 'logistica_delivery_evidence_sequence_chk', NULL::TEXT),
            (13, 5, 'PHOTO sequence negativo rechazado', 'PENDING',
                jsonb_build_object('sequence_no', -1),
                '23514', 'logistica_delivery_evidence_sequence_chk', NULL::TEXT),
            (13, 6, 'PHOTO sequence 16 permitido sin imponer maximo de 15', 'PENDING',
                jsonb_build_object('sequence_no', 16),
                NULL::TEXT, NULL::TEXT, NULL::TEXT),
            (14, 1, 'primera SIGNATURE permitida', 'PENDING',
                jsonb_build_object('evidence_type', 'SIGNATURE', 'sequence_no', 1),
                NULL::TEXT, NULL::TEXT, NULL::TEXT),
            (14, 2, 'segunda SIGNATURE con otra secuencia rechazada por indice parcial', 'PENDING',
                jsonb_build_object('evidence_type', 'SIGNATURE', 'sequence_no', 2),
                '23505', 'logistica_delivery_evidence_signature_uk', NULL::TEXT),
            (15, 1, 'UPLOADED con storage_provider NULL rechazado', 'UPLOADED',
                jsonb_build_object('storage_provider', NULL::TEXT),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (15, 2, 'UPLOADED con otro storage_provider rechazado', 'UPLOADED',
                jsonb_build_object('storage_provider', 'OTHER_PROVIDER'),
                '23514', 'logistica_delivery_evidence_uploaded_metadata_chk', NULL::TEXT),
            (16, 1, 'PENDING con metadata externa parcial permitido', 'UPLOADED',
                jsonb_build_object('status', 'PENDING', 'mime_type', NULL::TEXT,
                    'file_size_bytes', NULL::BIGINT, 'sha256', NULL::TEXT),
                NULL::TEXT, NULL::TEXT, NULL::TEXT),
            (16, 2, 'PENDING con processing_token y expires permitido', 'PENDING',
                jsonb_build_object('processing_token', v_request_id,
                    'processing_expires_at', now() + interval '5 minutes'),
                NULL::TEXT, NULL::TEXT, NULL::TEXT),
            (17, 1, 'client_evidence_id NULL rechazado', 'PENDING',
                jsonb_build_object('client_evidence_id', NULL::UUID),
                '23502', NULL::TEXT, 'client_evidence_id'),
            (18, 1, 'evidence_type invalido sigue rechazado', 'PENDING',
                jsonb_build_object('evidence_type', 'INVALID_TYPE'),
                '23514', 'logistica_delivery_evidence_type_chk', NULL::TEXT),
            (19, 1, 'delivery_id inexistente sigue rechazado por FK', 'PENDING',
                jsonb_build_object('delivery_id', v_delivery_id - 1),
                '23503', 'logistica_delivery_evidence_delivery_fk', NULL::TEXT)
        ) AS cases(test_no, variant_no, description, base_status, patch,
                   expected_sqlstate, expected_constraint, expected_column)
        ORDER BY test_no, variant_no
    LOOP
        IF v_case.base_status = 'UPLOADED' THEN
            v_candidate := v_uploaded;
        ELSE
            v_candidate := v_pending;
        END IF;

        LOOP
            v_evidence_uuid := md5(clock_timestamp()::TEXT || random()::TEXT)::UUID;
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM public.logistica_delivery_evidence
                WHERE client_evidence_id = v_evidence_uuid
                   OR (storage_provider = 'GOOGLE_DRIVE'
                       AND external_file_id = 'LOCAL_TEST_' || v_evidence_uuid::TEXT)
            ) AND 'LOCAL_TEST_' || v_evidence_uuid::TEXT <> v_uploaded_file_id;
        END LOOP;

        v_candidate.id := v_next_evidence_id;
        v_candidate.client_evidence_id := v_evidence_uuid;
        v_candidate.sequence_no := v_sequence_no;
        IF v_case.base_status = 'UPLOADED' THEN
            v_candidate.external_file_id := 'LOCAL_TEST_' || v_evidence_uuid::TEXT;
        END IF;
        v_candidate := jsonb_populate_record(v_candidate, v_case.patch);
        v_rejected := false;

        BEGIN
            INSERT INTO public.logistica_delivery_evidence SELECT (v_candidate).*;
        EXCEPTION
            WHEN check_violation OR unique_violation
                OR foreign_key_violation OR not_null_violation THEN
                GET STACKED DIAGNOSTICS
                    v_constraint = CONSTRAINT_NAME,
                    v_sqlstate = RETURNED_SQLSTATE,
                    v_column = COLUMN_NAME;
                IF v_sqlstate IS DISTINCT FROM v_case.expected_sqlstate
                    OR (v_case.expected_constraint IS NOT NULL
                        AND v_constraint IS DISTINCT FROM v_case.expected_constraint)
                    OR (v_case.expected_column IS NOT NULL
                        AND v_column IS DISTINCT FROM v_case.expected_column) THEN
                    RAISE EXCEPTION
                        'FAIL: %. %; recibido % (%), columna %; esperado % (%), columna %',
                        v_case.test_no, v_case.description,
                        v_constraint, v_sqlstate, v_column,
                        v_case.expected_constraint, v_case.expected_sqlstate,
                        v_case.expected_column;
                END IF;
                v_rejected := true;
        END;

        IF v_case.expected_sqlstate IS NOT NULL AND NOT v_rejected THEN
            RAISE EXCEPTION 'FAIL: %. %; INSERT aceptado indebidamente',
                v_case.test_no, v_case.description;
        END IF;
        IF NOT v_rejected THEN
            v_accepted_evidence := v_accepted_evidence + 1;
        END IF;
        RAISE NOTICE 'PASS: %.% %',
            v_case.test_no, v_case.variant_no, v_case.description;
        v_pass_count := v_pass_count + 1;
        IF NOT (v_case.test_no = ANY(v_completed_tests)) THEN
            v_completed_tests := array_append(v_completed_tests, v_case.test_no);
        END IF;
        v_next_evidence_id := v_next_evidence_id - 1;
        v_sequence_no := v_sequence_no + 1;
    END LOOP;

    IF v_pass_count <> 37
        OR v_completed_tests IS DISTINCT FROM ARRAY(SELECT generate_series(1, 19)) THEN
        RAISE EXCEPTION
            'FAIL: se esperaban 37 comprobaciones de 19 grupos; completadas %', v_pass_count;
    END IF;
    IF (SELECT count(*) FROM public.logistica_deliveries)
            <> v_initial_deliveries + 1
        OR (SELECT count(*) FROM public.logistica_delivery_evidence)
            <> v_initial_evidence + v_accepted_evidence
        OR (SELECT count(*) FROM public.logistica_delivery_evidence
            WHERE delivery_id = v_delivery_id) <> v_accepted_evidence THEN
        RAISE EXCEPTION 'FAIL: conteos inesperados antes del ROLLBACK';
    END IF;

    RAISE NOTICE 'PASS: 37 comprobaciones de 19 grupos; originales deliveries=%, evidence=%',
        v_initial_deliveries, v_initial_evidence;
    RAISE NOTICE 'Solo se agregaron 1 entrega y % evidencias temporales; el ROLLBACK siguiente las revierte sin avanzar secuencias',
        v_accepted_evidence;
END;
$$;

-- Todas las mutaciones son INSERT de filas nuevas dentro de esta transaccion.
-- ROLLBACK devuelve los conteos originales y libera los bloqueos; no hay COMMIT.
ROLLBACK;
