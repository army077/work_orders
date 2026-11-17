-- READ ONLY. Bind $1 = the exact approved REAL Firebase UID used for login.
-- Reports only SI/NO; never returns UID, email, display_name, IDs or other users.
-- Execute statements sequentially on ONE connection; bind only the SELECT.
-- Do not send this entire multi-statement script as one prepared query.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL statement_timeout = '10s';
DO $identity$ BEGIN
 IF current_database() IS DISTINCT FROM 'calidad' THEN
  RAISE EXCEPTION 'DATABASE_MUST_BE_CALIDAD';
 END IF;
 IF current_setting('server_version_num')::int / 10000 <> 16 THEN
  RAISE EXCEPTION 'POSTGRESQL_16_REQUIRED';
 END IF;
END; $identity$;
SELECT 'LOGISTICA_AUTH_ACTIVA' AS "CHECK",
 CASE WHEN EXISTS (
  SELECT 1 FROM public.logistica_authorized_users
  WHERE firebase_project = 'logistica-ar'
    AND firebase_uid = $1::text
    AND is_active = true
 ) THEN 'SI' ELSE 'NO' END AS "ESTADO";
ROLLBACK;
