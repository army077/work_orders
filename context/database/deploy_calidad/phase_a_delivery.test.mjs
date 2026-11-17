import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { phaseAFiles } from './build_phase_a_delivery.mjs';
import { cleanFiles } from './build_clean_baseline.mjs';
import { testSeedFiles } from './build_test_seed.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url));
test('administrator receives exactly two generated autonomous SQL files',()=>{
 const generated=phaseAFiles();
 assert.deepEqual(readdirSync(new URL('fase_a/',import.meta.url)).sort(),[...generated.keys()].sort());
 for(const [name,sql] of generated) {
  assert.equal(read('fase_a/'+name).toString().replaceAll('\r\n','\n'),sql);
  assert.doesNotMatch(sql,/LOGISTICA_FINAL_SCHEMA_DRIFT|c7e7d4d2|c0ec5fd2|\\i\s/);
  assert.match(sql,/SEMANTIC_EXPRESSION_DRIFT/);assert.match(sql,/TABLE_NOT_EMPTY_OR_UNSUPPORTED/);
  assert.match(sql,/COMMIT;\s*$/);
 }
 assert.equal(generated.get('01_create_calidad.sql'),cleanFiles().get('create_calidad.sql'));
 assert.equal(generated.get('02_seed_calidad_test.sql'),testSeedFiles().get('seed_calidad_test.sql'));
 assert.ok(read('fase_a/01_create_calidad.sql').equals(read('create_calidad.sql')));
 assert.ok(read('fase_a/02_seed_calidad_test.sql').equals(read('seed_calidad_test.sql')));
});
test('standalone validators and selective cleanup remain internal',()=>{
 for(const n of ['validate_create_calidad.sql','validate_seed_calidad_test.sql','cleanup_seed_calidad_test.sql'])assert.ok(read(n).length>0);
 assert.match(read('10_RUNBOOK_CUTOVER_FINAL.md').toString(),/SEED_PRODUCTIVO_REQUIERE_HOTFIX_ANTES_DE_FASE_B=NO/);
});
