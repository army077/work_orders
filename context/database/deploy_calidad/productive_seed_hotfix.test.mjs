// File contracts and JavaScript only: no SQL engine, DB driver or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { baselineModel,checksCTEs,splitSQL } from './build_clean_baseline.mjs';
import { expressionGuard } from './semantic_expressions.mjs';
import { seedFiles } from './build_seed_support.mjs';
import { masters,loadApprovedSource,functionalFindings,testMarker,sha256 } from './seed_source.mjs';

const read=n=>readFileSync(new URL(n,import.meta.url),'utf8').replaceAll('\r\n','\n');
const model=baselineModel(),source=loadApprovedSource(),files=seedFiles();
const seed=files.get('seed_calidad_operativo.sql'),validator=files.get('validate_seed_calidad.sql');
const statements=splitSQL(seed).map(s=>s.replace(/^(?:\s*--[^\n]*(?:\n|$))*/,'').trim());
const expectedNext={machine_family:9,machine_model:52,maintenance_template:131,template_section:406,template_task:1251,template_task_inspection:223,plantilla_tecnicos:131};

test('hotfix preserves every pre-hotfix INSERT and sequence restart byte',()=>{
 const dataStatements=statements.filter(s=>/^(INSERT INTO|ALTER SEQUENCE)/.test(s));
 // Captured from the existing seed before changing its guards, LF normalized.
 assert.equal(sha256(dataStatements.join('\n')),'5bce97174a21e85673c75399fc64630511a98fed60f6e4771acc150710389b3f');
 assert.equal(read('seed_calidad_operativo.sql'),seed);
 assert.equal(read('validate_seed_calidad.sql'),validator);
});

test('shared semantic expression and catalog guards precede the first production write',()=>{
 const firstWrite=seed.indexOf('INSERT INTO public.');
 for(const guard of [expressionGuard(model),checksCTEs(model)]) {
  assert.ok(seed.includes(guard));
  assert.ok(seed.indexOf(guard)<firstWrite);
 }
 assert.ok(seed.indexOf('LOCK TABLE')<seed.indexOf(expressionGuard(model)));
 assert.ok(seed.indexOf('SEED_BASELINE_INCOMPATIBLE')<firstWrite);
 assert.doesNotMatch(seed,/LOGISTICA_FINAL_SCHEMA_DRIFT|pg_get_indexdef|pg_get_triggerdef|c7e7d4d2|c0ec5fd2/);
 assert.doesNotMatch(read('render_seed.mjs'),/frozenProductionSeedChecks|frozen_productive_seed_checks/);
 assert.equal(existsSync(new URL('frozen_productive_seed_checks.mjs',import.meta.url)),false);
});

test('seed postcondition and validator share the complete integrity CTEs',()=>{
 const start=seed.indexOf(' WITH RECURSIVE ',seed.indexOf('DO $seed_integrity_'))+' WITH RECURSIVE '.length;
 const end=seed.indexOf('\n SELECT string_agg(reason,',start);
 const shared=seed.slice(start,end);
 assert.ok(shared.startsWith('installed_extensions AS ('),shared.slice(0,70));
 assert.ok(validator.includes('WITH RECURSIVE '+shared+', inherited_warning_policy'));
 assert.ok(shared.includes(checksCTEs(model,{allowData:[...masters,'logistica_authorized_users']}).replace('issues(reason) AS (','schema_issues(reason) AS (')));
 for(const error of ['BASE_COLUMN_DRIFT','BASE_CONSTRAINT_DRIFT','INDEX_CATALOG_DRIFT','SEQUENCE_DRIFT','BASE_FUNCTION_DRIFT','MAPPING_FUNCTION_DRIFT','TRIGGER_DRIFT','UNSUPPORTED_RULE_POLICY_OR_INHERITANCE','TABLE_NOT_EMPTY_OR_UNSUPPORTED','MASTER_COUNT:','MASTER_ROW_MISSING_OR_CHANGED:','MASTER_ROW_UNAPPROVED:','MASTER_SEQUENCE_STATE:','TEST_MARKER:'])assert.ok(shared.includes(error),error);
 assert.ok(validator.includes(expressionGuard(model)));
 assert.ok(seed.indexOf('SEED_DATA_INVALID')>seed.lastIndexOf('ALTER SEQUENCE'));
 assert.ok(seed.indexOf('SEED_DATA_INVALID')<seed.lastIndexOf('COMMIT;'));
});

test('approved graph has 1139 original rows, zero orphans and zero TEST/FIXTURE',()=>{
 assert.deepEqual(source.counts,{machine_family:8,machine_model:37,maintenance_template:51,template_section:155,template_task:869,template_task_inspection:2,plantilla_tecnicos:17});
 assert.equal(source.total,1139);
 let orphans=0,markers=0;
 for(const [child,key,parent] of [['machine_model','family_id','machine_family'],['maintenance_template','model_id','machine_model'],['template_section','template_id','maintenance_template'],['template_task','section_id','template_section'],['template_task_inspection','section_id','template_section']]) {
  const ids=new Set(source.tables[parent].map(r=>r.id));
  orphans+=source.tables[child].filter(r=>!ids.has(r[key])).length;
 }
 for(const rows of Object.values(source.tables))markers+=rows.filter(r=>testMarker.test(JSON.stringify(r))).length;
 assert.equal(orphans,0);assert.equal(markers,0);
});

test('exact seven next values use transactional RESTART after inserts',()=>{
 const restarts=statements.filter(s=>s.startsWith('ALTER SEQUENCE'));
 assert.deepEqual(restarts,masters.map(n=>`ALTER SEQUENCE public.${n}_id_seq RESTART WITH ${expectedNext[n]}`));
 assert.deepEqual(Object.fromEntries(masters.map(n=>[n,source.maxIds[n]+1])),expectedNext);
 assert.doesNotMatch(seed,/SELECT\s+(?:setval|nextval)\s*\(/i);
});

test('only seven masters are written; histories, events and authorization stay empty',()=>{
 assert.deepEqual(statements.filter(s=>s.startsWith('INSERT INTO')).map(s=>s.match(/^INSERT INTO public\.(\w+)/)[1]),masters);
 assert.equal(statements[0],'BEGIN');assert.equal(statements.at(-1),'COMMIT');
 assert.ok(statements.every(s=>! /^(?:UPDATE|DELETE|DROP|TRUNCATE|CREATE|COPY|MERGE)\b/.test(s)));
 assert.ok(checksCTEs(model).includes("name<>'logistica_schema_migrations'"));
 for(const name of model.tables.map(t=>t.name).filter(n=>!masters.includes(n)&&n!=='logistica_schema_migrations')) {
  assert.ok(!statements.some(s=>s.startsWith('INSERT INTO public.'+name+' ')),name);
 }
});

test('inherited 39/5/9 remain WARNING, absent Logistics user is a separate gate',()=>{
 const findings=functionalFindings(source.tables);
 assert.deepEqual([findings.assembly_without_inspection.length,findings.empty_sections.length,findings.assembly_missing_release_codes.length],[39,5,9]);
 assert.match(validator,/'ADVERTENCIA_HEREDADA','WARNING'/);
 assert.match(validator,/'CALIDAD_SEED_OPERATIVO_VALIDO',CASE WHEN EXISTS\(SELECT 1 FROM blocking_issues\) THEN 'NO' ELSE 'SI' END/);
 const gate=validator.slice(validator.indexOf('blocking_issues(reason) AS ('),validator.indexOf('), logistica_auth AS ('));
 assert.doesNotMatch(gate,/LOGISTICA|authorization|pending/);
 assert.match(gate,/SELECT reason FROM seed_issues/);
 assert.match(validator,/'INCIDENCIA_DATOS','ERROR'/);
});

test('current runbook stages API27 before any possible API10 promotion',()=>{
 const doc=read('10_RUNBOOK_CUTOVER_FINAL.md');
 assert.match(doc,/SEED_PRODUCTIVO_REQUIERE_HOTFIX_ANTES_DE_FASE_B=NO/);
 for(const text of ['APP_ENV=production','PGDATABASE=calidad','FIREBASE_LOGISTICA_PROJECT_ID=logistica-ar','GOOGLE_APPLICATION_CREDENTIALS','LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH','LOGISTICA_DRIVE_TOKEN_PATH','/api27/health','Samsung E2E'])assert.ok(doc.includes(text),text);
 assert.match(read('13_SEED_OPERATIVO.md'),/Firebase válido por sí solo NO basta/);
});
