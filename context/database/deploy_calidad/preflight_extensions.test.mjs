import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureOptions, catalogs, dependency, citextFixture, evaluateDestination } from './preflight_fixture.mjs';

const preflights=['01_preflight_artecnologia.sql','02_preflight_calidad.sql','03_validar_post_restore_calidad.sql'];
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8').replace(/--[^\n]*/g,'').replace(/\s+/g,' ');
const summary=report=>report.find(row=>row.check==='DESTINO_VACIO_Y_APTO');
function assertBlocked(fixture,catalog,oid) {
  const report=evaluateDestination(fixture);
  assert.equal(summary(report).status,'NO');
  assert.ok(summary(report).detail.unexpected_application_objects>0);
  assert.ok(report.some(row=>row.check==='OBJETO_INESPERADO'&&row.status==='NO'&&
    row.detail.classid===catalogs[catalog]&&row.detail.objid===oid));
}

test('catalog-proven citext members and internal _citext array do not cause NO-GO',fixtureOptions,()=>{
  const fixture=citextFixture(), report=evaluateDestination(fixture), result=summary(report);
  assert.equal(result.status,'SI');
  assert.equal(result.detail.application_objects,0);
  assert.equal(result.detail.unexpected_application_objects,0);
  assert.equal(result.detail.unexpected_objects,0);
  assert.equal(result.detail.extension_objects,fixture.pg_extension.length+fixture.pg_type.length+fixture.pg_proc.length);
  assert.equal(report.filter(row=>row.check==='OBJETO_INESPERADO').length,0);
  assert.ok(report.some(row=>row.check==='EXTENSION_INFRA'&&row.detail.name==='_citext'&&row.detail.extension==='citext'));
});
test('all installed extensions report name/schema/version as INFO infrastructure',fixtureOptions,()=>{
  const report=evaluateDestination(citextFixture());
  const extensions=report.filter(row=>row.detail.kind==='extension');
  assert.deepEqual(extensions.map(row=>row.detail).sort((a,b)=>a.name.localeCompare(b.name)),[
    {kind:'extension',name:'citext',schema:'public',version:'1.6'},
    {kind:'extension',name:'plpgsql',schema:'pg_catalog',version:'1.0'},
  ]);
  assert.ok(extensions.every(row=>row.check==='EXTENSION_INFRA'&&row.status==='INFO'));
});
for(const [kind,relkind] of [['table','r'],['sequence','S'],['view','v'],['materialized view','m']]) {
  test(`unexpected application ${kind} causes NO-GO even with an OID shared by an extension type`,fixtureOptions,()=>{
    const fixture=citextFixture();
    fixture.pg_class.push([100,'partially_restored_project_object',11,relkind]);
    fixture.pg_depend.push(dependency('pg_class',100,'pg_type',100,'n'));
    assertBlocked(fixture,'pg_class',100);
  });
}
test('own function using citext causes NO-GO, even with an extension-like function name',fixtureOptions,()=>{
  const fixture=citextFixture();
  fixture.pg_proc.push([120,'citext_custom_application_function',11]);
  fixture.pg_depend.push(dependency('pg_proc',120,'pg_type',100,'n'));
  assertBlocked(fixture,'pg_proc',120);
});
test('own trigger using an extension function still causes NO-GO',fixtureOptions,()=>{
  const fixture=citextFixture();
  fixture.pg_class.push([200,'extension_table',11,'r']);
  fixture.pg_depend.push(dependency('pg_class',200,'pg_extension',900,'e'));
  fixture.pg_trigger.push([300,'custom_trigger',200,0]);
  fixture.pg_depend.push(dependency('pg_trigger',300,'pg_proc',110,'n'));
  assertBlocked(fixture,'pg_trigger',300);
});
test('own type and its array remain application objects despite extension-like names',fixtureOptions,()=>{
  const fixture=citextFixture();
  fixture.pg_type.push([120,'citext_application_type',11],[121,'_citext_application_type',11]);
  fixture.pg_depend.push(dependency('pg_type',120,'pg_type',100,'n'),dependency('pg_type',121,'pg_type',120,'i'));
  assertBlocked(fixture,'pg_type',120);
  assertBlocked(fixture,'pg_type',121);
});
test('existing migration ledger is detected and independently blocks even if extension-owned',fixtureOptions,()=>{
  for(const extensionOwned of [false,true]) {
    const fixture=citextFixture();
    fixture.pg_class.push([200,'logistica_schema_migrations',11,'r']);
    if(extensionOwned) fixture.pg_depend.push(dependency('pg_class',200,'pg_extension',900,'e'));
    const report=evaluateDestination(fixture);
    assert.equal(report.find(row=>row.check==='LEDGER').status,'NO');
    assert.equal(summary(report).status,'NO');
    assert.equal(summary(report).detail.application_objects,extensionOwned?0:1);
  }
});
for(const [type,refCatalog,refOid,refSubId] of [
  ['n','pg_type',100,0],['a','pg_type',100,0],['x','pg_extension',900,0],
  ['e','pg_extension',999,0],['e','pg_type',900,0],['i','pg_type',100,1],
]) {
  test(`dependency ${type} on ${refCatalog}/${refOid}/${refSubId} does not prove installed extension membership`,fixtureOptions,()=>{
    const fixture=citextFixture();
    fixture.pg_proc.push([120,'custom_function',11]);
    fixture.pg_depend.push(dependency('pg_proc',120,refCatalog,refOid,type,refSubId));
    assertBlocked(fixture,'pg_proc',120);
  });
}
test('classification follows catalog membership rather than citext names/schema or a fixed count',fixtureOptions,()=>{
  const fixture=citextFixture();
  fixture.pg_namespace[0][1]='extension_schema';
  fixture.pg_extension[0][1]='other_extension';
  fixture.pg_type[0][1]='other_type';
  fixture.pg_proc.push([120,'another_extension_routine',11]);
  fixture.pg_depend.push(dependency('pg_proc',120,'pg_extension',900,'e'));
  const report=evaluateDestination(fixture);
  assert.equal(summary(report).status,'SI');
  assert.equal(summary(report).detail.extension_objects,fixture.pg_extension.length+fixture.pg_type.length+fixture.pg_proc.length);
  assert.ok(report.some(row=>row.detail.name==='other_extension'&&row.detail.schema==='extension_schema'));
});
test('empty catalogs still return SI and computed zero counters',fixtureOptions,()=>{
  const fixture=citextFixture();
  for(const name of Object.keys(fixture)) if(name!=='pg_namespace') fixture[name]=[];
  assert.deepEqual(summary(evaluateDestination(fixture)),{check:'DESTINO_VACIO_Y_APTO',status:'SI',
    detail:{unexpected_objects:0,unexpected_application_objects:0,application_objects:0,extension_objects:0}});
});
test('origin/restore use the same catalog proof while retaining unsupported application dependency blockers',()=>{
  const classifier=sql=>sql.split('WITH RECURSIVE ')[1].split('), extension_infrastructure AS (')[0];
  for(const name of [preflights[0],preflights[2]]) {
    const sql=read(name);
    assert.equal(classifier(sql),classifier(read(preflights[1])));
    assert.match(sql,/EXISTS\(SELECT FROM extension_infrastructure e WHERE e\.classid=c\.classid AND e\.objid=c\.objid\) OR/);
    assert.match(sql,/SELECT detail FROM dependency_issues/);
    assert.match(sql,/'DEPENDENCIA','REVISAR',jsonb_build_object\('reason',detail\) FROM issues/);
    assert.match(sql,/CASE WHEN EXISTS\(SELECT FROM issues\) THEN '(?:REVISAR|NO)' ELSE 'SI' END/);
    assert.ok(sql.includes("'EXTENSION_INFRA','INFO', jsonb_build_object('kind','extension','name',name,'schema',schema,'version',version) FROM installed_extensions"));
  }
});
