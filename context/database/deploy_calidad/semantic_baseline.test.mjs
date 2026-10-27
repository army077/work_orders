// Pure JS and file inspection only. No SQL engines, sockets or DB connections.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { baselineModel,cleanFiles,checksCTEs,splitSQL } from './build_clean_baseline.mjs';
import { canonicalExpression,expressionInputs,expressionGuard } from './semantic_expressions.mjs';
import { seedFiles } from './build_seed_support.mjs';
const model=baselineModel(),ast=canonicalExpression;

for(const [source,rendering] of [
 ["CHECK (status IN ('PHOTO', 'SIGNATURE'))",'(("status" = ANY (ARRAY[\'PHOTO\'::text, \'SIGNATURE\'::text])))'],
 ['CHECK (latitude BETWEEN -90 AND 90)',"((latitude >= '-90'::double precision) AND (latitude <= '90'::double precision))"],
 ["CHECK (btrim(firebase_uid) <> '')",'((pg_catalog.btrim("firebase_uid")) <> \'\'::text)'],
 ['a AND (b AND c)','((a AND b) AND c)'],
 ['nextval(\'seq\'::regclass)','pg_catalog.nextval(\'public.seq\'::pg_catalog.regclass)'],
 ["'{}'", "'{}'::jsonb"],
 ["'Mantenimiento'", "'Mantenimiento'::character varying(255)"],
 ['NULL','NULL::numeric(10,2)'],
 ["CHECK ((token IS NULL) = (expires IS NULL))",'((token IS NULL) = (expires IS NULL))'],
])test('equivalent expression rendering: '+source,()=>assert.deepEqual(ast(source),ast(rendering)));

for(const [a,b] of [
 ['a AND (b OR c)','(a AND b) OR c'],
 ["btrim(uid) <> ''","btrim(uid) = ''"],
 ["uid = 'a b'","uid = 'ab'"],
 ["uid = 'Foo'","uid = 'foo'"],
 ["uid ~ '^[A-Z]+$'","uid ~ '^[a-z]+$'"],
 ['x IS NOT NULL','x IS NULL'],
 ['x >= 1','x > 1'],
 ["state IN ('A','B')","state IN ('A','C')"],
 ['is_active','NOT is_active'],
 ["'true'::text",'true'],
 ['a OR b','a AND b'],
 ['source_row >= 2','source_row >= 2::boolean::integer'],
 ['value > 1.5','value > 1.5::integer'],
 ["value > '1.5'::numeric","value > '1.5'::integer"],
 ["'Mantenimiento'", "'Mantenimiento'::character varying(3)"],
])test('real expression drift blocks: '+a,()=>assert.notDeepEqual(ast(a),ast(b)));

test('literal comments and parentheses remain data; foreign qualification fails closed',()=>{
 assert.deepEqual(ast("'a -- b (c)'::text"),['string','a -- b (c)']);
 assert.throws(()=>ast('evil.btrim(uid)'),/UNSUPPORTED/);
 assert.throws(()=>ast('uid + 1'),/UNSUPPORTED/);
 assert.throws(()=>ast('(uid'),/UNBALANCED/);
});
test('all DDL expressions are represented, including serial defaults and inline ledger CHECK',()=>{
 const inputs=expressionInputs(model);
 assert.equal(inputs.filter(i=>i.kind==='predicate').length,48);
 assert.equal(inputs.filter(i=>i.kind==='check').length,35);
 for(const t of model.tables)for(const c of t.columns)assert.ok(inputs.some(i=>i.key==='DEFAULT:'+t.name+'.'+c.name));
 assert.ok(inputs.some(i=>i.name==='logistica_schema_migrations_migration_sha256_check'));
 assert.ok(inputs.some(i=>i.name==='logistica_legacy_owner_mapping_revocation_chk'));
});
test('semantic policy covers every table/index and preserves blocking catalogs',()=>{
 const sql=checksCTEs(model);
 const expected=JSON.parse(sql.match(/expected AS \(SELECT '((?:''|[^'])*)'::jsonb AS value/)[1].replaceAll("''", "'"));
 assert.equal(expected.base.length,21);assert.equal(expected.indexes.length,48);assert.equal(expected.sequences.length,20);
 assert.equal(expected.triggers.length,2);
 for(const name of ['INDEX_CATALOG_DRIFT','TRIGGER_DRIFT','MAPPING_FUNCTION_DRIFT','EXPRESSION_DEPENDENCY_DRIFT','EXPRESSION_OPERATOR_DRIFT','BASE_CONSTRAINT_DRIFT','BASE_COLUMN_DRIFT','SEQUENCE_DRIFT','TABLE_NOT_EMPTY_OR_UNSUPPORTED','UNSUPPORTED_RULE_POLICY_OR_INHERITANCE'])assert.ok(sql.includes(name));
 for(const column of ['indkey','indclass','indcollation','indoption','indnkeyatts','indnullsnotdistinct','tgtype','tgenabled','tgfoid','tgqual','tgargs','proretset','prosecdef','proisstrict','proleakproof','proparallel','proconfig'])assert.ok(sql.includes(column));
 assert.doesNotMatch(sql,/LOGISTICA_FINAL_SCHEMA_DRIFT|pg_get_indexdef|pg_get_triggerdef/);
});
test('expression evaluator is an anonymous read-only guard and remains before COMMIT',()=>{
 const guard=expressionGuard(model);
 assert.doesNotMatch(guard,/\b(?:INSERT|DELETE|UPDATE|CREATE|ALTER|TRUNCATE|EXECUTE)\b/);
 assert.match(guard,/RAISE EXCEPTION 'SEMANTIC_EXPRESSION_DRIFT/);
 for(const [name,sql] of cleanFiles()) {
  assert.ok(sql.includes(guard),name);
  assert.doesNotMatch(sql,/c7e7d4d2|c0ec5fd2|LOGISTICA_FINAL_SCHEMA_DRIFT/);
  assert.ok(splitSQL(sql).some(q=>q.startsWith('DO $semantic_expressions$')));
  if(name==='create_calidad.sql')assert.ok(sql.indexOf(guard)<sql.lastIndexOf('COMMIT;'));
 }
 assert.ok(seedFiles().get('validate_seed_calidad.sql').includes(guard));
});
test('frozen future productive seed remains byte-for-byte intact and reproducible',()=>{
 const bytes=readFileSync(new URL('seed_calidad_operativo.sql',import.meta.url));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),'e2e8ff8c05ba485ad56ab889c095485efac15df612b32e862f4c1d18d6b04da8');
 assert.equal(seedFiles().get('seed_calidad_operativo.sql'),bytes.toString().replaceAll('\r\n','\n'));
});
