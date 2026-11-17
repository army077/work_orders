-- MANUAL, PARAMETERIZED. Preparation only; Codex has not executed this SQL.
-- Bind $1 = approved REAL Firebase UID, $2 = approved email or NULL,
-- $3 = approved display_name or NULL. Never paste literal placeholders into HeidiSQL.
-- A client must support parameter binding and stop on the first error.
-- Execute statements sequentially on ONE connection; bind only the INSERT.
-- Do not send this entire multi-statement script as one prepared query.
-- Do not silently replace/reactivate an existing membership; review duplicates.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
DO $identity$ BEGIN
 IF current_database() IS DISTINCT FROM 'calidad' THEN
  RAISE EXCEPTION 'DATABASE_MUST_BE_CALIDAD';
 END IF;
 IF current_setting('server_version_num')::int / 10000 <> 16 THEN
  RAISE EXCEPTION 'POSTGRESQL_16_REQUIRED';
 END IF;
END; $identity$;
-- NOT NULL and the approved UID CHECK reject NULL/blank values.
-- Preserve the exact verified UID; never generate or infer one from an email.
INSERT INTO public.logistica_authorized_users
 (firebase_project, firebase_uid, email, display_name, is_active)
VALUES ('logistica-ar', $1::text, $2::text, $3::text, true)
RETURNING 'LOGISTICA_USUARIO_REGISTRADO'::text AS "CHECK", 'SI'::text AS "ESTADO";
-- Accept only with an actual successful COMMIT, then run the read-only check.
COMMIT;
