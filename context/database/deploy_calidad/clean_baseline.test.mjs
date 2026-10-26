import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { baselineModel,cleanFiles,splitSQL } from './build_clean_baseline.mjs';
import { core,logistics,rootFunctions } from '../transfer_calidad/manifest.mjs';
import { artifacts,states,verifyLedger } from '../migrations/prod/logistica_prod_support.js';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8').replaceAll('\r\n','\n');
const model=baselineModel(),files=cleanFiles();
const create=read('create_calidad.sql'),validate=read('validate_create_calidad.sql');
const top=sql=>splitSQL(sql).map(s=>s.replace(/^(?:\s*--[^\n]*(?:\n|$))*/,'').trim());
test('clean SQL artifacts reproduce authoritative source definitions offline',()=>{
  for(const [name,sql] of files)assert.equal(read(name),sql,name);
});
test('SQL splitting respects function bodies, strings and nested column expressions',()=>{
  assert.equal(splitSQL("DO $$ BEGIN RAISE EXCEPTION 'a;b'; END; $$; SELECT ';';").length,2);
  assert.deepEqual(splitSQL("CHECK (a IN ('x,y','z')), n numeric(10,2), t text",','),["CHECK (a IN ('x,y','z'))",'n numeric(10,2)','t text']);
});
test('database/version guard and extension prerequisites precede all application DDL',()=>{
  const queries=top(create),guard=queries.find(s=>s.startsWith('DO $identity$'));
  assert.match(guard,/current_database\(\) IS DISTINCT FROM 'calidad' THEN RAISE EXCEPTION/);
  assert.match(guard,/server_version_num[\s\S]+POSTGRESQL_16_REQUIRED/);
  assert.ok(create.indexOf('APPLICATION_OBJECTS_ALREADY_PRESENT')<create.indexOf('CREATE TABLE'));
  assert.ok(create.indexOf('PLPGSQL_AND_CITEXT_EXTENSIONS_REQUIRED')<create.indexOf('CREATE TABLE'));
  assert.doesNotMatch(create,/CREATE\s+EXTENSION|CREATE\s+(?:TYPE|FUNCTION)\s+(?:public\.)?citext/i);
  assert.match(create,/d\.deptype='e'/);assert.match(create,/d\.deptype='i'/);
  assert.doesNotMatch(create,/IF NOT EXISTS/i);
});
test('one transaction validates all objects and emptiness before commit, without destructive commands',()=>{
  const queries=top(create);
  assert.equal(queries[0],'BEGIN');
  assert.equal(queries.filter(s=>s==='COMMIT').length,1);
  assert.equal(queries.filter(s=>s==='BEGIN').length,1);
  assert.equal(queries.at(-1),'COMMIT');
  assert.match(queries.at(-2),/^SELECT 'CALIDAD_BASELINE_CREADO'/);
  assert.ok(queries.findIndex(s=>s.startsWith('DO $validate$'))<queries.indexOf('COMMIT'));
  assert.doesNotMatch(create,/\bDROP\b/i);
  assert.ok(queries.every(s=>! /^(DELETE|TRUNCATE|UPDATE|COPY|MERGE|CALL)\b/i.test(s)));
  assert.doesNotMatch(create,/\b(?:TEST_LOCAL|workorders_test)\b/);
  // DELETE/TRUNCATE appear only as FK actions/audit trigger events, never calls.
  assert.match(create,/BEFORE INSERT OR UPDATE OR DELETE/);
  assert.match(create,/BEFORE TRUNCATE/);
});
test('all runtime and operational table names are covered, with no unmounted local history tables',()=>{
  const expected=[...core,...logistics].map(n=>n.slice(7)).sort();
  assert.deepEqual(model.tables.map(t=>t.name).sort(),expected);
  assert.equal(model.tables.length,21);
  const sources=['routes','repositories','auth'].flatMap(dir=>readdirSync(new URL('../../api10/'+dir+'/',import.meta.url))
    .filter(name=>name.endsWith('.js')).map(name=>read('../../api10/'+dir+'/'+name)));
  for(const source of sources) {
    for(const [,table,columns] of source.matchAll(/INSERT INTO\s+(?:public\.)?(\w+)\s*\(([^)]+)\)/gi)) {
      const definition=model.tables.find(t=>t.name===table);
      assert.ok(definition,table);
      for(const column of columns.split(',').map(c=>c.trim()))assert.ok(definition.columns.some(c=>c.name===column),table+'.'+column);
    }
  }
  for(const name of ['desviaciones_calidad_legacy','liberaciones_empaque_legacy','procesos_liberacion_legacy','preembarque_legacy'])assert.ok(!model.tables.some(t=>t.name===name));
});
test('foreign keys reference an already created table and existing target columns',()=>{
  const seen=new Map();let checked=0;
  for(const table of model.tables) {
    for(const fk of table.constraints.filter(c=>c.type==='f')) {
      assert.ok(seen.has(fk.reference),table.name+' -> '+fk.reference);
      for(const column of fk.columns)assert.ok(table.columns.some(c=>c.name===column));
      for(const column of fk.reference_columns)assert.ok(seen.get(fk.reference).columns.some(c=>c.name===column));
      checked++;
    }
    seen.set(table.name,table);
  }
  assert.equal(checked,13);
});
test('twenty SERIAL/BIGSERIAL definitions give fresh owned sequences with no business inserts',()=>{
  assert.equal(model.sequences.length,20);
  assert.equal(model.sequences.filter(s=>s.type==='integer').length,15);
  assert.equal(model.sequences.filter(s=>s.type==='bigint').length,5);
  const inserts=top(create).filter(s=>/^INSERT\b/.test(s));
  assert.equal(inserts.length,1);
  assert.match(inserts[0],/^INSERT INTO public\.logistica_schema_migrations\(/);
  assert.doesNotMatch(create,/SELECT\s+(?:setval|nextval)\s*\(/i);
  assert.match(validate,/SEQUENCE_NOT_FRESH/);assert.match(validate,/pg_get_serial_sequence/);
});
test('final Logistics column layout equals the prepared seventh schema state',()=>{
  const expected=states().at(-1);
  const defaultValue=value=>(value??'NULL').replace(/::(?:text|jsonb|character varying)/g,'').replace(/\s+/g,'').replace(/^(TRUE|FALSE)$/i,s=>s.toLowerCase()).replace(/^current_user$/i,'CURRENT_USER');
  for(const [name,columns] of Object.entries(expected.columns)) {
    const actual=model.tables.find(t=>t.name===name);
    assert.deepEqual(actual.columns.map(c=>[c.name,c.type,c.not_null]),columns.map(c=>c.slice(0,3)),name);
    for(const [i,column] of actual.columns.entries()) {
      const wanted=columns[i];
      const actualDefault=column.serial?`nextval('${name}_${column.name}_seq'::regclass)`:column.default;
      assert.equal(defaultValue(actualDefault),defaultValue(wanted[3]),name+'.'+column.name+' default');
      const collation=column.collation?'"'+column.collation+'"':column.type==='text'?'"default"':'-';
      assert.equal(collation,wanted[6],name+'.'+column.name+' collation');
      assert.equal(wanted[4],'');assert.equal(wanted[5],'');
    }
  }
  assert.ok(validate.includes(expected.fingerprint));
  assert.match(validate,/SET LOCAL search_path = pg_catalog, public/);
  assert.ok(validate.includes("replace(pg_get_triggerdef(t.oid,true),'EXECUTE FUNCTION protect_logistica_legacy_owner_mapping()','EXECUTE FUNCTION public.protect_logistica_legacy_owner_mapping()')"));
});
test('each original Logistics ADD constraint/column and index is present in the single final schema',()=>{
  for(const file of artifacts()) {
    const body=file.sql.split('-- BEGIN LOGISTICA DDL')[1].split('-- END LOGISTICA DDL')[0];
    for(const [,name] of body.matchAll(/(?:CONSTRAINT|CREATE (?:UNIQUE )?INDEX)\s+(\w+)/g))assert.ok(create.includes(name),file.name+':'+name);
  }
  assert.equal(model.indexes.length+model.tables.flatMap(t=>t.constraints.filter(c=>['p','u'].includes(c.type))).length,48);
  assert.doesNotMatch(create,/ALTER TABLE/);
});
test('mapping function and audit triggers retain their original PROD bodies',()=>{
  const last=artifacts().at(-1).sql.replaceAll('\r\n','\n');
  const body=sql=>sql.match(/CREATE FUNCTION public\.protect_logistica_legacy_owner_mapping\(\)[\s\S]+?AS \$\$([\s\S]+?)\$\$/)[1];
  assert.equal(body(create),body(last));
  assert.equal(model.aux.filter(s=>s.startsWith('CREATE TRIGGER')).length,2);
  for(const f of rootFunctions)assert.ok(model.functions.some(fn=>fn.name===f));
  assert.equal(model.functions.length+model.aux.filter(s=>s.startsWith('CREATE FUNCTION')).length,4);
});
test('system ledger records seven included versions without application seeds or migration execution',()=>{
  const ledger=model.files.map(f=>({migration_name:f.name,migration_sha256:f.sha256}));
  assert.equal(verifyLedger(ledger),7);
  for(const file of artifacts()) {
    assert.equal(model.files.find(f=>f.name===file.name).sha256,createHash('sha256').update(file.sql).digest('hex'));
    assert.ok(create.includes(file.sha256));
  }
  assert.match(create,/not seven independently executed migration attempts/);
  assert.doesNotMatch(create,/\\i\b|apply_logistica_migration_prod|configureMigration/);
});
test('standalone validator is READ ONLY, guarded, rollback-only and never evaluates nextval/default functions',()=>{
  const queries=top(validate);
  assert.equal(queries[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.match(queries[1],/DATABASE_MUST_BE_CALIDAD/);
  assert.equal(queries.at(-1),'ROLLBACK');
  assert.ok(queries.every(s=>/^(BEGIN\b|SET LOCAL\b|DO \$identity\$|WITH RECURSIVE\b|ROLLBACK\b)/.test(s)));
  assert.ok(!queries.some(s=>/^(CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|COPY|COMMIT)\b/i.test(s)));
  assert.doesNotMatch(validate,/SELECT\s+(?:setval|nextval|pg_advisory_xact_lock)\s*\(/i);
  assert.match(validate,/'CALIDAD_SCHEMA_VALIDO',CASE WHEN EXISTS\(SELECT FROM issues\) THEN 'NO' ELSE 'SI' END/);
  for(const check of ['BASE_COLUMN_DRIFT','BASE_CONSTRAINT_DRIFT','BASE_INDEX_DRIFT','BASE_FUNCTION_DRIFT','SEQUENCE_DRIFT','LOGISTICA_FINAL_SCHEMA_DRIFT','LEDGER_DRIFT','TABLE_NOT_EMPTY_OR_UNSUPPORTED','UNEXPECTED_OBJECT','MISSING_OBJECT'])assert.ok(validate.includes(check));
});
