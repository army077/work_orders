// Offline authoring only: no database driver, connection, or SQL execution.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readySeedFiles } from './render_seed.mjs';

export const masters=['machine_family','machine_model','maintenance_template','template_section','template_task','template_task_inspection','plantilla_tecnicos'];
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const identity=database=>`DO $identity$ BEGIN
 IF current_database() IS DISTINCT FROM '${database}' THEN RAISE EXCEPTION 'DATABASE_MUST_BE_${database.toUpperCase()}'; END IF;
 IF current_setting('server_version_num')::int / 10000 <> 16 THEN RAISE EXCEPTION 'POSTGRESQL_16_REQUIRED'; END IF;
END; $identity$;`;
const settings=`SET LOCAL search_path = pg_catalog, public;
SET LOCAL row_security = off;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '5s';
SET LOCAL timezone = 'UTC';`;

// Shared relational checks are also exercised with synthetic in-memory VALUES.
// No real technician identity is invented. Source rows still require review.
export const configurationChecks=`configuration_issues(reason) AS (
 SELECT 'MASTER_EMPTY:'||name FROM counts WHERE name IN (${masters.map(literal).join(',')}) AND rows=0
 UNION ALL SELECT 'MODEL_FAMILY_ORPHAN' WHERE EXISTS(SELECT 1 FROM public.machine_model m LEFT JOIN public.machine_family f ON f.id=m.family_id WHERE f.id IS NULL)
 UNION ALL SELECT 'TEMPLATE_MODEL_ORPHAN' WHERE EXISTS(SELECT 1 FROM public.maintenance_template t LEFT JOIN public.machine_model m ON m.id=t.model_id WHERE m.id IS NULL)
 UNION ALL SELECT 'SECTION_TEMPLATE_ORPHAN' WHERE EXISTS(SELECT 1 FROM public.template_section s LEFT JOIN public.maintenance_template t ON t.id=s.template_id WHERE t.id IS NULL)
 UNION ALL SELECT 'TASK_SECTION_ORPHAN' WHERE EXISTS(SELECT 1 FROM public.template_task t LEFT JOIN public.template_section s ON s.id=t.section_id WHERE s.id IS NULL)
 UNION ALL SELECT 'INSPECTION_POINT_SECTION_ORPHAN' WHERE EXISTS(SELECT 1 FROM public.template_task_inspection t LEFT JOIN public.template_section s ON s.id=t.section_id WHERE s.id IS NULL)
 UNION ALL SELECT 'UNPUBLISHED_TEMPLATE' WHERE EXISTS(SELECT 1 FROM public.maintenance_template WHERE is_published IS DISTINCT FROM true)
 UNION ALL SELECT 'EMPTY_FAMILY_NAME' WHERE EXISTS(SELECT 1 FROM public.machine_family WHERE btrim(name)='')
 UNION ALL SELECT 'EMPTY_MODEL_NAME' WHERE EXISTS(SELECT 1 FROM public.machine_model WHERE btrim(name)='')
 UNION ALL SELECT 'EMPTY_TEMPLATE_NAME' WHERE EXISTS(SELECT 1 FROM public.maintenance_template WHERE btrim(name)='')
 UNION ALL SELECT 'EMPTY_SECTION_TITLE' WHERE EXISTS(SELECT 1 FROM public.template_section WHERE btrim(title)='')
 UNION ALL SELECT 'EMPTY_TASK_TITLE' WHERE EXISTS(SELECT 1 FROM public.template_task WHERE btrim(title)='')
 UNION ALL SELECT 'EMPTY_INSPECTION_POINT' WHERE EXISTS(SELECT 1 FROM public.template_task_inspection WHERE btrim(revision_point)='')
 UNION ALL SELECT 'TEMPLATE_WITHOUT_SECTIONS' WHERE EXISTS(SELECT 1 FROM public.maintenance_template t WHERE NOT EXISTS(SELECT 1 FROM public.template_section s WHERE s.template_id=t.id))
 UNION ALL SELECT 'SECTION_WITHOUT_TASKS' WHERE EXISTS(SELECT 1 FROM public.template_section s JOIN public.maintenance_template t ON t.id=s.template_id WHERE t.template_type<>'INSPECCION' AND NOT EXISTS(SELECT 1 FROM public.template_task a WHERE a.section_id=s.id))
 UNION ALL SELECT 'SECTION_WITHOUT_INSPECTION_POINTS' WHERE EXISTS(SELECT 1 FROM public.template_section s JOIN public.maintenance_template t ON t.id=s.template_id WHERE t.template_type='INSPECCION' AND NOT EXISTS(SELECT 1 FROM public.template_task_inspection a WHERE a.section_id=s.id))
 UNION ALL SELECT 'TASK_ON_INSPECTION_TEMPLATE' WHERE EXISTS(SELECT 1 FROM public.template_task a JOIN public.template_section s ON s.id=a.section_id JOIN public.maintenance_template t ON t.id=s.template_id WHERE t.template_type='INSPECCION')
 UNION ALL SELECT 'INSPECTION_POINT_ON_TASK_TEMPLATE' WHERE EXISTS(SELECT 1 FROM public.template_task_inspection a JOIN public.template_section s ON s.id=a.section_id JOIN public.maintenance_template t ON t.id=s.template_id WHERE t.template_type<>'INSPECCION')
 UNION ALL SELECT 'AMBIGUOUS_INSPECTION' WHERE EXISTS(SELECT t.model_id,s.title FROM public.maintenance_template t JOIN public.template_section s ON s.template_id=t.id WHERE t.template_type='INSPECCION' AND t.is_published=true GROUP BY t.model_id,s.title HAVING count(*)>1)
 UNION ALL SELECT 'INSPECTION_TYPE_MISSING' WHERE EXISTS(SELECT 1 FROM public.maintenance_template t CROSS JOIN (SELECT 'Inspección de ensamble' AS title UNION ALL SELECT 'Inspección de pintura') required WHERE t.template_type='INSPECCION' AND NOT EXISTS(SELECT 1 FROM public.template_section s WHERE s.template_id=t.id AND s.title=required.title))
 UNION ALL SELECT 'ASSEMBLY_INSPECTION_CONFIG_MISSING' WHERE EXISTS(SELECT 1 FROM public.maintenance_template t WHERE t.template_type='ENSAMBLE' AND NOT EXISTS(SELECT 1 FROM public.maintenance_template i WHERE i.model_id=t.model_id AND i.template_type='INSPECCION' AND i.is_published=true))
 UNION ALL SELECT 'ASSEMBLY_RELEASE_CODE_MISSING' WHERE EXISTS(SELECT 1 FROM public.maintenance_template t CROSS JOIN (SELECT 'LIB001' AS code UNION ALL SELECT 'LIB002') required WHERE t.template_type='ENSAMBLE' AND NOT EXISTS(SELECT 1 FROM public.template_section s JOIN public.template_task a ON a.section_id=s.id WHERE s.template_id=t.id AND a.code=required.code))
 UNION ALL SELECT 'INVALID_SECTION_POSITION' WHERE EXISTS(SELECT 1 FROM public.template_section WHERE position<1)
 UNION ALL SELECT 'INVALID_TASK_POSITION' WHERE EXISTS(SELECT 1 FROM public.template_task WHERE position<1 OR expected_minutes<0)
 UNION ALL SELECT 'INVALID_INSPECTION_POSITION' WHERE EXISTS(SELECT 1 FROM public.template_task_inspection WHERE position<1)
 UNION ALL SELECT 'DUPLICATE_INSPECTION_POSITION' WHERE EXISTS(SELECT section_id,position FROM public.template_task_inspection GROUP BY section_id,position HAVING count(*)>1)
 UNION ALL SELECT 'TECHNICIAN_REQUIRED_FIELDS' WHERE EXISTS(SELECT 1 FROM public.plantilla_tecnicos WHERE btrim(correo_tecnico)='' OR btrim(estatus)='' OR btrim(sucursal)='' OR btrim(nombre_bonos)='')
 UNION ALL SELECT 'DUPLICATE_TECHNICIAN_EMAIL' WHERE EXISTS(SELECT lower(btrim(correo_tecnico)) FROM public.plantilla_tecnicos GROUP BY lower(btrim(correo_tecnico)) HAVING count(*)>1)
 UNION ALL SELECT 'PRODUCTION_OPERATOR_MISSING' WHERE NOT EXISTS(SELECT 1 FROM public.plantilla_tecnicos WHERE puesto='Operador de producción')
 UNION ALL SELECT 'QUALITY_INSPECTOR_MISSING' WHERE NOT EXISTS(SELECT 1 FROM public.plantilla_tecnicos WHERE puesto IN ('Operador de producción','Supervisor de calidad'))
)`;
// These are explicit markers, not a claim that arbitrary test data can be
// recognized automatically. Ambiguous names/statuses require source review.
export const testPattern='(^|[^[:alnum:]])(TEST([_ -]LOCAL)?|FIXTURE)([^[:alnum:]]|$)';

export function seedFiles() {
 return readySeedFiles({configurationChecks,testPattern,identity,settings});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 for(const [name,sql] of seedFiles())writeFileSync(new URL(name,import.meta.url),sql);
}
