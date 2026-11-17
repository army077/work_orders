// Offline rendering of the approved export. Never executes the resulting SQL.
import { readFileSync } from 'node:fs';
import { baselineModel,checksCTEs } from './build_clean_baseline.mjs';
import { expressionGuard } from './semantic_expressions.mjs';
import { masters,loadApprovedSource,functionalFindings,sha256 } from './seed_source.mjs';

const lit=value=>"'"+String(value).replaceAll("'","''")+"'";
export const sqlValue=value=>value===null?'NULL':typeof value==='boolean'?String(value):typeof value==='number'?String(value):
 "E'"+value.replaceAll('\\','\\\\').replaceAll("'","''").replaceAll('\r','\\r').replaceAll('\n','\\n').replaceAll('\t','\\t')+"'";
const block=(name,body)=>{
 let tag='$'+name+'_'+sha256(body).slice(0,12)+'$';
 while(body.includes(tag))tag=tag.slice(0,-1)+'_$';
 return 'DO '+tag+'\n'+body+'\n'+tag+';';
};
const functionalReasons=['TEMPLATE_WITHOUT_SECTIONS','SECTION_WITHOUT_TASKS','SECTION_WITHOUT_INSPECTION_POINTS','INSPECTION_TYPE_MISSING','ASSEMBLY_INSPECTION_CONFIG_MISSING','ASSEMBLY_RELEASE_CODE_MISSING','TECHNICIAN_REQUIRED_FIELDS','DUPLICATE_TECHNICIAN_EMAIL','PRODUCTION_OPERATOR_MISSING','QUALITY_INSPECTOR_MISSING','AMBIGUOUS_INSPECTION'];
// The accepted data has blank bonus labels and repeated emails, both allowed by
// the schema. Report them without inventing a new database integrity constraint.
const informationalReasons=['TECHNICIAN_REQUIRED_FIELDS','DUPLICATE_TECHNICIAN_EMAIL'];
// Runtime audit: these inherited configurations limit individual flows, not
// startup or order creation. Integrity errors remain blocking in both artifacts.
export const inheritedWarningReasons=['ASSEMBLY_INSPECTION_CONFIG_MISSING','SECTION_WITHOUT_TASKS','ASSEMBLY_RELEASE_CODE_MISSING'];
export function readySeedFiles({configurationChecks,testPattern,identity,settings}) {
 const source=loadApprovedSource(),model=baselineModel(),allowData=[...masters,'logistica_authorized_users'];
 const exportedSQL=readFileSync(new URL('export_seed_config_artecnologia.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const header=`-- GENERATED OFFLINE by build_seed_support.mjs. PostgreSQL 16 / HeidiSQL.
-- Approved export: artecnologia, ${source.data.source.captured_at}.
-- Source SHA256: ${source.hash}. EXPORT_CONFIG_PROD_RECIBIDO = SI.
-- The legacy JSON status label does not request another export.
-- logistica_authorized_users = ALTA_MANUAL_REQUERIDA; no automatic user.
-- Schema policy: shared checksCTEs + expressionGuard from the approved clean baseline.
`;
 const sequenceChecks=masters.map(name=>`SELECT 'MASTER_SEQUENCE_STATE:${name}' WHERE EXISTS(SELECT 1 FROM sequence_state WHERE s->>'table'=${lit(name)} AND (last_value::bigint IS DISTINCT FROM ${source.maxIds[name]+1} OR is_called::boolean IS DISTINCT FROM false))`).join('\n UNION ALL ');
 const testChecks=allowData.map(name=>`SELECT 'TEST_MARKER:${name}' WHERE EXISTS(SELECT 1 FROM public.${name} a WHERE to_jsonb(a)::text ~* ${lit(testPattern)})`).join('\n UNION ALL ');
 const actualRows=masters.map(name=>`SELECT ${lit(name)}::text AS name,to_jsonb(a)${name==='maintenance_template'?"-ARRAY['created_at','updated_at','created_by']::text[]":''} AS record FROM public.${name} a`).join('\n UNION ALL ');
 const checks=`${checksCTEs(model,{allowData}).replace('issues(reason) AS (','schema_issues(reason) AS (')},
 ${configurationChecks},
 approved_export AS (SELECT ${lit(JSON.stringify(source.tables))}::jsonb AS value),
 expected_master_rows AS (SELECT e.key AS name,r.value AS record FROM approved_export a,LATERAL jsonb_each(a.value) e,LATERAL jsonb_array_elements(e.value) r),
 actual_master_rows AS (${actualRows}),
 master_data_issues(reason) AS (
 SELECT 'MASTER_COUNT:'||e.key FROM approved_export a,LATERAL jsonb_each(a.value) e LEFT JOIN counts c ON c.name=e.key WHERE c.rows IS DISTINCT FROM jsonb_array_length(e.value)::bigint
 UNION ALL SELECT 'MASTER_ROW_MISSING_OR_CHANGED:'||e.name||':'||(e.record->>'id') FROM expected_master_rows e WHERE NOT EXISTS(SELECT 1 FROM actual_master_rows a WHERE a.name=e.name AND a.record=e.record)
 UNION ALL SELECT 'MASTER_ROW_UNAPPROVED:'||a.name||':'||(a.record->>'id') FROM actual_master_rows a WHERE NOT EXISTS(SELECT 1 FROM expected_master_rows e WHERE e.name=a.name AND e.record=a.record)
 UNION ALL ${sequenceChecks}
 UNION ALL ${testChecks}
), functional_issues(reason) AS (
 SELECT reason FROM configuration_issues WHERE reason IN (${functionalReasons.map(lit).join(',')}) AND reason NOT IN (${informationalReasons.map(lit).join(',')})
), seed_issues(reason) AS (
 SELECT reason FROM schema_issues UNION ALL SELECT reason FROM master_data_issues
 UNION ALL SELECT reason FROM configuration_issues WHERE reason NOT IN (${functionalReasons.map(lit).join(',')})
)`;
 const insertion=masters.map(name=>{
  const columns=source.definitions[name].map(c=>c.name);
  return `-- ${name}: ${source.counts[name]} approved rows; original master IDs preserved.
INSERT INTO public.${name} (${columns.map(c=>'"'+c+'"').join(',')}) VALUES
${[...source.tables[name]].sort((a,b)=>a.id-b.id).map(r=>'('+columns.map(c=>sqlValue(r[c])).join(',')+')').join(',\n')};`;
 }).join('\n\n');
 // RESTART is transactional; unlike setval, it rolls back if validation fails.
 const sequences=masters.map(name=>`ALTER SEQUENCE public.${name}_id_seq RESTART WITH ${source.maxIds[name]+1};`).join('\n');
 const seed=header+`-- Fresh baseline only. Never rerun over populated business tables.
-- This reproduces the approved data; functional limitations are reported separately.
BEGIN;
${settings}
SET LOCAL standard_conforming_strings = on;
${identity('calidad')}
LOCK TABLE ${model.tables.map(t=>'public.'+t.name).join(',')} IN ACCESS EXCLUSIVE MODE;
${expressionGuard(model)}
${block('baseline',`DECLARE issue text; BEGIN
 WITH RECURSIVE ${checksCTEs(model)}
 SELECT string_agg(reason,', ' ORDER BY reason) INTO issue FROM issues;
 IF issue IS NOT NULL THEN RAISE EXCEPTION 'SEED_BASELINE_INCOMPATIBLE: %',issue; END IF;
END;`)}

${insertion}

-- Adjust only the seven seeded master sequences, within this transaction.
${sequences}

${block('seed_integrity',`DECLARE issue text; BEGIN
 WITH RECURSIVE ${checks}
 SELECT string_agg(reason,', ' ORDER BY reason) INTO issue FROM seed_issues;
 IF issue IS NOT NULL THEN RAISE EXCEPTION 'SEED_DATA_INVALID: %',issue; END IF;
END;`)}
-- Accept only with the following successful COMMIT. This is not API acceptance.
SELECT 'CALIDAD_SEED_CARGADO' AS "CHECK",'SI' AS "ESTADO",${source.total} AS "FILAS";
COMMIT;
`;
 const findings=functionalFindings(source.tables);
 const warningPolicy=[
  ['ASSEMBLY_INSPECTION_CONFIG_MISSING','BLOQUEADOR_FLUJO_ESPECIFICO',findings.assembly_without_inspection,'Order creation and existing activities continue; POST quality/inspection/request returns 404 for these models.'],
  ['SECTION_WITHOUT_TASKS','ADVERTENCIA_HEREDADA',findings.empty_sections,'Order creation succeeds; empty sections produce no activities or checklist group. Templates 61/69 have no activities at all; their checklist reset returns 404.'],
  ['ASSEMBLY_RELEASE_CODE_MISSING','BLOQUEADOR_FLUJO_ESPECIFICO',findings.assembly_missing_release_codes,'Order creation and existing activities continue; quality release returns 404 and inspection completion 409 if the required release task is absent.'],
 ];
 const validation=header+`-- Initial validation, before business events. Only ERROR findings produce NO-GO.
-- WARNING findings preserve inherited configuration and never repair source data.
-- Logistics authorization blocks Logistics only; it is reported separately.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
${identity('calidad')}
${settings}
SET LOCAL standard_conforming_strings = on;
${expressionGuard(model)}
WITH RECURSIVE ${checks}, inherited_warning_policy(reason,classification,affected,impact) AS (
 VALUES ${warningPolicy.map(([reason,classification,affected,impact])=>'('+[lit(reason),lit(classification),lit(JSON.stringify(affected))+'::jsonb',lit(impact)].join(',')+')').join(',\n ')}
), blocking_issues(reason) AS (
 SELECT reason FROM seed_issues
 UNION ALL SELECT reason FROM functional_issues WHERE reason NOT IN (${inheritedWarningReasons.map(lit).join(',')})
), logistica_auth AS (
 SELECT NOT EXISTS(SELECT 1 FROM public.logistica_authorized_users WHERE firebase_project='logistica-ar' AND is_active=true AND btrim(firebase_uid)<>'') AS pending
), report AS (
 SELECT 0 AS position,'CALIDAD_SCHEMA_VALIDO'::text AS "CHECK",CASE WHEN EXISTS(SELECT 1 FROM schema_issues) THEN 'NO' ELSE 'SI' END AS "ESTADO",'{}'::jsonb AS "DETALLE"
 UNION ALL SELECT 1,'INCIDENCIA_DATOS','ERROR',jsonb_build_object('reason',reason) FROM seed_issues
 UNION ALL SELECT 2,'LIMITACION_FUNCIONAL','ERROR',jsonb_build_object('reason',reason) FROM functional_issues WHERE reason NOT IN (${inheritedWarningReasons.map(lit).join(',')})
 UNION ALL SELECT 2,'ADVERTENCIA_HEREDADA','WARNING',jsonb_build_object('reason',p.reason,'classification',p.classification,'affected_count',jsonb_array_length(p.affected),'affected',p.affected,'impact',p.impact) FROM configuration_issues c JOIN inherited_warning_policy p ON p.reason=c.reason
 UNION ALL SELECT 2,'OBSERVACION_CONFIGURACION','WARNING',jsonb_build_object('reason',reason) FROM configuration_issues WHERE reason IN (${informationalReasons.map(lit).join(',')})
 UNION ALL SELECT 3,'CONFIGURACION_CONTEO','INFO',jsonb_build_object('table',e.key,'expected',jsonb_array_length(e.value),'actual',c.rows) FROM approved_export a,LATERAL jsonb_each(a.value) e LEFT JOIN counts c ON c.name=e.key
 UNION ALL SELECT 4,'CALIDAD_SEED_DATOS_VALIDOS',CASE WHEN EXISTS(SELECT 1 FROM seed_issues) THEN 'NO' ELSE 'SI' END,jsonb_build_object('approved_rows',${source.total},'source_sha256',${lit(source.hash)})
 UNION ALL SELECT 5,'LOGISTICA_AUTH_PENDIENTE',CASE WHEN pending THEN 'SI' ELSE 'NO' END,jsonb_build_object('action',CASE WHEN pending THEN 'ALTA_MANUAL_REQUERIDA' ELSE 'AUTORIZACION_PRESENTE' END,'scope','LOGISTICA','classification','BLOQUEADOR_FLUJO_ESPECIFICO') FROM logistica_auth
 UNION ALL SELECT 6,'CALIDAD_SEED_OPERATIVO_VALIDO',CASE WHEN EXISTS(SELECT 1 FROM blocking_issues) THEN 'NO' ELSE 'SI' END,jsonb_build_object('source_status','EXPORT_CONFIG_PROD_RECIBIDO','transactional_rows',(SELECT sum(rows) FROM counts WHERE name NOT IN (${['logistica_schema_migrations',...allowData].map(lit).join(',')})))
 UNION ALL SELECT 7,'BASELINE_APTO_PARA_DEPLOY',CASE WHEN EXISTS(SELECT 1 FROM blocking_issues) THEN 'NO' ELSE 'SI' END,jsonb_build_object('logistics_authorization','SEPARATE_MANUAL_REQUIREMENT')
) SELECT "CHECK","ESTADO","DETALLE" FROM report ORDER BY position,"CHECK","DETALLE"::text;
ROLLBACK;
`;
 const receipt=JSON.stringify({EXPORT_CONFIG_PROD_RECIBIDO:'SI',source_file:'sources/export_config_prod_20261023.json',source_sha256:source.hash,source:source.data.source,executed_query_file:'export_seed_config_artecnologia.sql',executed_query_sha256:sha256(exportedSQL),query_format:'Normalized transcription of the executed SQL supplied by the user; no SQL executed by Codex',legacy_status_label:source.data.status,legacy_status_is_not_a_blocker:true,counts:source.counts,total_rows:source.total,max_ids:source.maxIds,next_sequence_values:Object.fromEntries(masters.map(n=>[n,source.maxIds[n]+1])),orphans:0,test_fixture_rows:0,excluded_templates:{published:source.data.audit.published_templates,included:source.data.audit.candidate_templates,excluded:source.data.audit.quarantined_or_missing_master_templates,ids:null,names:null,individual_reasons:null,detail:'The export contains no excluded rows or per-template exclusion diagnostics. No IDs or causes inferred; no reincorporation.'},functional_findings:functionalFindings(source.tables),logistica_authorized_users:'ALTA_MANUAL_REQUERIDA'},null,2)+'\n';
 return new Map([['seed_calidad_operativo.sql',seed],['validate_seed_calidad.sql',validation],['export_seed_config_artecnologia.sql',exportedSQL],['15_RECEPCION_EXPORT_CONFIG_PROD.json',receipt]]);
}
