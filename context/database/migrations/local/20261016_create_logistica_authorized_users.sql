-- Migracion preparada exclusivamente para LOCAL TEST.
-- Destino: artecnologia_test_local.
-- Allowlist de autorizacion para el futuro modulo de Entregas (Firebase logistica-ar).
-- La identidad autorizada es firebase_project + firebase_uid (el email es solo informativo).
-- Sin FKs y sin insertar usuarios.

BEGIN;

DO $$
BEGIN
    IF current_database() <> 'artecnologia_test_local' THEN
        RAISE EXCEPTION
            'Esta migracion solo permite la base artecnologia_test_local';
    END IF;
END $$;

CREATE TABLE public.logistica_authorized_users (
    id BIGSERIAL PRIMARY KEY,
    firebase_project TEXT NOT NULL,
    firebase_uid TEXT NOT NULL,
    email TEXT,
    display_name TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT logistica_authorized_users_project_chk
        CHECK (firebase_project = 'logistica-ar'),
    CONSTRAINT logistica_authorized_users_uid_chk
        CHECK (btrim(firebase_uid) <> ''),
    CONSTRAINT logistica_authorized_users_project_uid_uk
        UNIQUE (firebase_project, firebase_uid)
);

COMMIT;
