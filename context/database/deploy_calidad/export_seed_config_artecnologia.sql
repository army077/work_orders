-- EXPORTACION CONFIGURACION API10
-- PostgreSQL 16 / HeidiSQL; base requerida: artecnologia; SOLO LECTURA.
-- Transcripcion con formato normalizado del query ejecutado aportado por el usuario.
-- Se conserva la etiqueta heredada; no significa que falte otro export.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';
SET LOCAL timezone = 'UTC';
WITH environment_check AS (
 SELECT current_database() AS database_name,
 current_setting('server_version_num')::int / 10000 AS major_version,
 current_setting('transaction_read_only') AS read_only_mode
), raw_published AS (
 SELECT t.id,t.name,t.template_type,t.model_id,t.version,t.is_published FROM public.maintenance_template t WHERE t.is_published=true
), candidates AS (
 SELECT t.* FROM raw_published t
 JOIN public.machine_model m ON m.id=t.model_id JOIN public.machine_family f ON f.id=m.family_id
 WHERE to_jsonb(t)::text !~* '(^|[^[:alnum:]])(TEST([_ -]LOCAL)?|FIXTURE)([^[:alnum:]]|$)' AND to_jsonb(m)::text !~* '(^|[^[:alnum:]])(TEST([_ -]LOCAL)?|FIXTURE)([^[:alnum:]]|$)' AND to_jsonb(f)::text !~* '(^|[^[:alnum:]])(TEST([_ -]LOCAL)?|FIXTURE)([^[:alnum:]]|$)'
 AND NOT EXISTS(SELECT 1 FROM public.template_section s WHERE s.template_id=t.id AND to_jsonb(s)::text ~* '(^|[^[:alnum:]])(TEST([_ -]LOCAL)?|FIXTURE)([^[:alnum:]]|$)')
 AND NOT EXISTS(SELECT 1 FROM public.template_task a JOIN public.template_section s ON s.id=a.section_id WHERE s.template_id=t.id AND to_jsonb(a)::text ~* '(^|[^[:alnum:]])(TEST([_ -]LOCAL)?|FIXTURE)([^[:alnum:]]|$)')
 AND NOT EXISTS(SELECT 1 FROM public.template_task_inspection a JOIN public.template_section s ON s.id=a.section_id WHERE s.template_id=t.id AND to_jsonb(a)::text ~* '(^|[^[:alnum:]])(TEST([_ -]LOCAL)?|FIXTURE)([^[:alnum:]]|$)')
), sections AS (SELECT s.id,s.template_id,s.title,s.position FROM public.template_section s JOIN candidates t ON t.id=s.template_id),
 models AS (SELECT m.id,m.family_id,m.name,m.manufacturer,m.bond_value,m.standard_days FROM public.machine_model m WHERE EXISTS(SELECT 1 FROM candidates t WHERE t.model_id=m.id)),
 families AS (SELECT f.id,f.name FROM public.machine_family f WHERE EXISTS(SELECT 1 FROM models m WHERE m.family_id=f.id)),
 tasks AS (SELECT a.id,a.section_id,a.code,a.title,a.expected_minutes,a.required,a.position,a.category FROM public.template_task a JOIN sections s ON s.id=a.section_id JOIN candidates t ON t.id=s.template_id WHERE t.template_type<>'INSPECCION'),
 inspection_points AS (SELECT a.id,a.section_id,a.revision_point,a.specs,a.suggestions,a.required,a.position,a.category FROM public.template_task_inspection a JOIN sections s ON s.id=a.section_id JOIN candidates t ON t.id=s.template_id WHERE t.template_type='INSPECCION'),
 technicians AS (
 SELECT a.id,a.estatus,a.sucursal,a.nombre_tecnico,a.correo_tecnico,a.telefono,a.puesto,a.nombre_bonos,a.numero_empleado
 FROM public.plantilla_tecnicos a
 WHERE lower(a.estatus)='activo' AND a.puesto IN ('Operador de producción','Supervisor de calidad')
 AND to_jsonb(a)::text !~* '(^|[^[:alnum:]])(TEST([_ -]LOCAL)?|FIXTURE)([^[:alnum:]]|$)'
), technician_status_profile AS (
 SELECT estatus,puesto,count(*) AS rows FROM public.plantilla_tecnicos a
 WHERE puesto IN ('Operador de producción','Supervisor de calidad') AND to_jsonb(a)::text !~* '(^|[^[:alnum:]])(TEST([_ -]LOCAL)?|FIXTURE)([^[:alnum:]]|$)'
 GROUP BY estatus,puesto
), mixed_tasks AS (
 SELECT count(*) AS rows FROM public.template_task a JOIN sections s ON s.id=a.section_id JOIN candidates t ON t.id=s.template_id WHERE t.template_type='INSPECCION'
), mixed_inspection_points AS (
 SELECT count(*) AS rows FROM public.template_task_inspection a JOIN sections s ON s.id=a.section_id JOIN candidates t ON t.id=s.template_id WHERE t.template_type<>'INSPECCION'
)
SELECT jsonb_build_object(
 'status','PENDIENTE_EXPORT_CONFIG_PROD',
 'source',jsonb_build_object('database',current_database(),'postgresql',current_setting('server_version'),'captured_at',transaction_timestamp(),'read_only',current_setting('transaction_read_only')),
 'selection',jsonb_build_object('templates','is_published=true; complete dependency closure; explicit test markers quarantined','technicians','lower(estatus)=activo per frontend selector; API10 production/quality roles only; explicit test markers excluded; review source identities'),
 'audit',jsonb_build_object('published_templates',(SELECT count(*) FROM raw_published),'candidate_templates',(SELECT count(*) FROM candidates),'quarantined_or_missing_master_templates',(SELECT count(*) FROM raw_published)-(SELECT count(*) FROM candidates),'tasks_on_inspection_template',(SELECT rows FROM mixed_tasks),'inspection_points_on_task_template',(SELECT rows FROM mixed_inspection_points),'technician_status_profile',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY estatus,puesto) FROM technician_status_profile p),'[]'::jsonb)),
 'tables',jsonb_build_object(
 'machine_family',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM families f),'[]'::jsonb),
 'machine_model',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM models m),'[]'::jsonb),
 'maintenance_template',coalesce((SELECT jsonb_agg(to_jsonb(t)-'created_at'-'updated_at'-'created_by' ORDER BY id) FROM candidates t),'[]'::jsonb),
 'template_section',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY template_id,position,id) FROM sections s),'[]'::jsonb),
 'template_task',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY section_id,position,id) FROM tasks a),'[]'::jsonb),
 'template_task_inspection',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY section_id,position,id) FROM inspection_points a),'[]'::jsonb),
 'plantilla_tecnicos',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM technicians a),'[]'::jsonb)),
 'logistica_authorized_users','ALTA_MANUAL_REQUERIDA'
) AS "EXPORT_CONFIG_JSON"
FROM environment_check ec
WHERE ec.database_name = 'artecnologia'
 AND ec.major_version = 16
 AND ec.read_only_mode = 'on';
ROLLBACK;
