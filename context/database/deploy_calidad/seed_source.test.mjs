import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadApprovedSource,validateExport,parseExport,functionalFindings,approvedSourceHash,sha256 } from './seed_source.mjs';
import { splitSQL } from './build_clean_baseline.mjs';
import { sqlValue } from './render_seed.mjs';

const source=loadApprovedSource();
test('accepted production bytes, source metadata and real counts match the supplied export',()=>{
 assert.equal(source.hash,approvedSourceHash);assert.equal(source.total,1139);
 assert.deepEqual(source.counts,{machine_family:8,machine_model:37,maintenance_template:51,template_section:155,template_task:869,template_task_inspection:2,plantilla_tecnicos:17});
 assert.equal(source.data.status,'PENDIENTE_EXPORT_CONFIG_PROD');
 assert.doesNotThrow(()=>validateExport(source.data));
});
test('JSON parser rejects duplicate keys instead of silently overwriting approved data',()=>{
 assert.throws(()=>parseExport('{"id":1,"id":2}'),/DUPLICATE_JSON_KEY/);
 assert.throws(()=>parseExport('{"id":1'),SyntaxError);
 assert.deepEqual(parseExport('{"value":"{\\\"id\\\":1}","array":[{"id":1},{"id":2}]}'),{value:'{"id":1}',array:[{id:1},{id:2}]});
});
for(const [name,change,reason] of [
 ['wrong source',d=>d.source.database='calidad',/SOURCE_DATABASE/],
 ['non-read-only source',d=>d.source.read_only='off',/SOURCE_ENVIRONMENT/],
 ['event scope injection',d=>d.tables.work_order=[],/MASTER_SCOPE/],
 ['duplicate ID',d=>d.tables.machine_family.push({...d.tables.machine_family[0]}),/DUPLICATE_ID/],
 ['family orphan',d=>d.tables.machine_model[0].family_id=99999,/ORPHAN/],
 ['model orphan',d=>d.tables.maintenance_template[0].model_id=99999,/ORPHAN/],
 ['template orphan',d=>d.tables.template_section[0].template_id=99999,/ORPHAN/],
 ['task orphan',d=>d.tables.template_task[0].section_id=99999,/ORPHAN/],
 ['inspection point orphan',d=>d.tables.template_task_inspection[0].section_id=99999,/ORPHAN/],
 ['test row',d=>d.tables.machine_family[0].name='TEST_LOCAL',/TEST_MARKER/],
 ['fixture row',d=>d.tables.template_task[0].title='FIXTURE',/TEST_MARKER/],
 ['inactive technician',d=>d.tables.plantilla_tecnicos[0].estatus='Inactivo',/TECHNICIAN_SELECTION/],
 ['unapproved technician role',d=>d.tables.plantilla_tecnicos[0].puesto='Other role',/TECHNICIAN_SELECTION/],
 ['truncated candidate count',d=>d.audit.candidate_templates=50,/CANDIDATE_COUNT/],
 ['unknown event column',d=>d.tables.template_task[0].work_order_id=4,/ROW_COLUMNS/],
 ['invalid column type',d=>d.tables.template_task[0].expected_minutes='8',/INTEGER_VALUE/],
 ['text exceeding baseline width',d=>d.tables.plantilla_tecnicos[0].telefono='0'.repeat(21),/TEXT_LENGTH/],
])test(`source validation rejects ${name} without changing the original export`,()=>{
 const copy=structuredClone(source.data);change(copy);assert.throws(()=>validateExport(copy),reason);
});
test('preserved master rows and original IDs are represented exactly once by generated inserts',()=>{
 const sql=readFileSync(new URL('seed_calidad_operativo.sql',import.meta.url),'utf8');
 const statements=splitSQL(sql).map(s=>s.replace(/^(?:\s*--[^\n]*(?:\n|$))*/,'').trim()).filter(s=>s.startsWith('INSERT INTO'));
 assert.equal(statements.length,7);let total=0;
 for(const [i,name] of Object.keys(source.counts).entries()) {
  const statement=statements[i],names=source.definitions[name].map(c=>c.name);
  const rows=splitSQL(statement.slice(statement.indexOf(' VALUES\n')+8),',');
  assert.equal(rows.length,source.counts[name]);total+=rows.length;
  for(const [j,row] of [...source.tables[name]].sort((a,b)=>a.id-b.id).entries())assert.equal(rows[j],'('+names.map(c=>sqlValue(row[c])).join(',')+')');
  assert.ok(sql.includes('ALTER SEQUENCE public.'+name+'_id_seq RESTART WITH '+(source.maxIds[name]+1)+';'));
 }
 assert.equal(total,1139);
});
test('SQL literals preserve apostrophes, backslashes and newlines as data',()=>{
 assert.equal(sqlValue("a'b\\c\nd"),"E'a''b\\\\c\\nd'");
 assert.equal(sqlValue(null),'NULL');assert.equal(sqlValue(false),'false');
});
test('functional limitations are exposed instead of fabricating missing source configuration',()=>{
 const f=functionalFindings(source.tables);
 assert.equal(f.assembly_without_inspection.length,39);
 assert.equal(f.empty_sections.length,5);assert.equal(f.assembly_missing_release_codes.length,9);
 assert.deepEqual(f.duplicate_technician_email_ids,[[63,101]]);
 assert.equal(f.technicians_blank_bonus_name.length,9);
 const receipt=JSON.parse(readFileSync(new URL('15_RECEPCION_EXPORT_CONFIG_PROD.json',import.meta.url),'utf8'));
 assert.equal(receipt.EXPORT_CONFIG_PROD_RECIBIDO,'SI');assert.equal(receipt.excluded_templates.excluded,3);
 assert.equal(receipt.excluded_templates.ids,null);assert.equal(receipt.excluded_templates.names,null);
 assert.equal(receipt.executed_query_sha256,sha256(readFileSync(new URL('export_seed_config_artecnologia.sql',import.meta.url))));
});
