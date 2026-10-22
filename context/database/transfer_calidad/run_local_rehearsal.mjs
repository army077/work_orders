// Unica ruta: loopback:5432, workorders_test, dos DBs LOCAL fijas. No crea DBs.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join, basename } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { core, historical, parseSnapshot, compareSnapshots } from './compare_snapshots.mjs';
import { prepareDumpArgs } from './prepare_dump_args.mjs';
import { SOURCE, DESTINATION, assertLocalConfig, connectLocal, sourceState, readJsonLines } from './local_support.mjs';
import { sequenceSafety } from './sequence_safety.mjs';
import { applyLocalLogistica } from './apply_local_logistica.mjs';
import { invariant, TABLES, sha256 } from '../migrations/prod/logistica_prod_support.js';

assertLocalConfig();
const resume = process.argv[2] === '--resume-validated-local';
const sourceOnly = process.argv[2] === '--audit-source-only';
invariant(process.argv.length === 3 && (process.argv[2] === '--execute-local' || resume || sourceOnly), 'EXPLICIT_LOCAL_REHEARSAL_FLAG_REQUIRED');
const directory = fileURLToPath(new URL('.', import.meta.url));
const evidence = join(directory, 'evidence.local', new Date().toISOString().replaceAll(/[:.]/g, '-'));
mkdirSync(evidence, { recursive: true });
const save = (name, value) => writeFileSync(join(evidence, name), JSON.stringify(value, null, 2) + '\n');
const bin = process.env.CALIDAD_PG_BIN || 'C:/Program Files/PostgreSQL/16/bin';
const suffix = process.platform === 'win32' ? '.exe' : '';
const nativeEnv = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP,
  TMP: process.env.TMP, PGPASSWORD: process.env.PGPASSWORD, PGSSLMODE: 'disable', PGCONNECT_TIMEOUT: '5' };
const conn = ['--host=127.0.0.1', '--port=5432', '--username=workorders_test', '--no-password'];
let nativeIndex = 0;
function native(name, args) {
  const result = spawnSync(join(bin, name + suffix), args, { env: nativeEnv, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  const index = ++nativeIndex;
  writeFileSync(join(evidence, `${index}-${name}.stderr.txt`), result.stderr || '');
  if (result.error) throw result.error;
  invariant(result.status === 0, 'NATIVE_COMMAND_FAILED_' + basename(name).toUpperCase());
  return result.stdout;
}
function capture(database, filename, script = 'snapshot.sql') {
  native('psql', [...conn, '--dbname=' + database, '-X', '-q', '-t', '-A',
    '-v', 'transfer_mode=local_rehearsal', '-v', 'expected_database=' + database,
    '-v', 'expected_user=workorders_test', '-v', 'expected_server_address=127.0.0.1',
    '-v', 'expected_server_port=5432', '--output=' + join(evidence, filename), '-f', join(directory, script)]);
}
let source, destination;
try {
  source = await connectLocal(SOURCE);
  const db = (await source.query('SELECT pg_get_userbyid(datdba) owner FROM pg_database WHERE datname=$1', [DESTINATION])).rows[0];
  if (!sourceOnly) {
    invariant(db, 'LOCAL_DESTINATION_MISSING_ADMIN_CREATION_REQUIRED');
    invariant(db.owner === 'workorders_test', 'LOCAL_DESTINATION_OWNER_REQUIRED');
    destination = await connectLocal(DESTINATION);
  }
  for (const name of ['psql', 'pg_dump', 'pg_restore']) invariant(/16\./.test(native(name, ['--version'])), 'PG16_CLIENT_REQUIRED');
  const names = [...core, ...historical];
  const protectedNames = [...names, ...TABLES.map(t => 'public.' + t)];
  const present = [];
  for (const name of names) if ((await source.query('SELECT to_regclass($1) oid', [name])).rows[0].oid) present.push(name);
  const locked = [];
  for (const name of protectedNames) if ((await source.query('SELECT to_regclass($1) oid', [name])).rows[0].oid) locked.push(name);
  // SHARE congela filas del inventario LOCAL mientras pg_dump lee. Nunca DDL/DML en origen.
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  await source.query("SET LOCAL lock_timeout='5s'");
  await source.query('LOCK TABLE ' + locked.join(',') + ' IN SHARE MODE');
  await source.query('SET LOCAL search_path=pg_catalog');
  const before = await sourceState(source, protectedNames);
  save('source-before.json', before);
  capture(SOURCE, 'source.jsonl');
  capture(SOURCE, 'dependencies.jsonl', 'dependencies.sql');
  const snapshot = readFileSync(join(evidence, 'source.jsonl'), 'utf8');
  const sourceRows = [...parseSnapshot(snapshot, SOURCE).values()];
  invariant(sourceRows.filter(r => r.kind === 'function').every(r => !/SECURITY DEFINER/.test(r.definition)), 'LOCAL_OWNER_REMAP_REQUIRES_SECURITY_REVIEW');
  const dependencies = readJsonLines(join(evidence, 'dependencies.jsonl'));
  for (const row of dependencies.filter(r => r.kind === 'fk_dependency'))
    invariant(!row.child_selected || row.parent_selected, 'EXTERNAL_FK_REQUIRES_REVIEW');
  const functions = sourceRows.filter(r => r.kind === 'function').map(r => r.name.replace(/^public\./, '').replaceAll(' ', ''));
  for (const row of dependencies.filter(r => r.kind === 'object_dependency' && r.routine_definition))
    invariant(row.schema === 'public' && functions.includes(row.identity.replace(/^public\./, '').replaceAll(' ', '')), 'AUXILIARY_ROUTINE_REQUIRES_REVIEW');
  const types = (await source.query("SELECT DISTINCT n.nspname FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE a.attrelid=ANY($1::regclass[]) AND a.attnum>0 AND NOT a.attisdropped AND n.nspname<>'pg_catalog'", [present])).rows;
  invariant(types.length === 0, 'AUXILIARY_TYPE_REQUIRES_REVIEW');
  const safeSource = await sequenceSafety(source, present);
  save('source-sequence-safety.json', safeSource);
  invariant(safeSource.safe && safeSource.checked_consumers > 0, 'SOURCE_SEQUENCE_COLLISION_RISK_NO_REPAIR');
  const plan = prepareDumpArgs(snapshot, { mode: 'local_rehearsal', approvedHistorical: present.filter(t => historical.includes(t)) });
  save('dump-args.json', plan);
  if (!sourceOnly) capture(DESTINATION, 'destination-preflight.jsonl', 'preflight_empty.sql');
  const empty = sourceOnly || readJsonLines(join(evidence, 'destination-preflight.jsonl')).find(r => r.kind === 'empty_preflight').empty;
  invariant(empty || resume, 'DESTINATION_NOT_EMPTY_USE_VALIDATED_RESUME');
  if (empty) {
    const projectDump = join(evidence, 'project.dump'), catalogDump = join(evidence, 'catalog.dump');
    native('pg_dump', [...conn, ...plan.argv, '--file=' + projectDump]);
    native('pg_dump', [...conn, '--dbname=' + SOURCE, '--format=custom', '--schema-only', '--file=' + catalogDump]);
    const toc = native('pg_restore', ['--list', catalogDump]);
    writeFileSync(join(evidence, 'catalog.list'), toc);
    const functionEntries = toc.split(/\r?\n/).filter(line => {
      const m = line.match(/^\d+; \d+ \d+ FUNCTION public (.+\)) /);
      return m && functions.includes(m[1].replaceAll(' ', ''));
    });
    invariant(functionEntries.length === functions.length, 'FUNCTION_TOC_REVIEW_REQUIRED');
    const functionList = join(evidence, 'functions.approved.list');
    writeFileSync(functionList, functionEntries.join('\n') + '\n');
    const projectToc = native('pg_restore', ['--list', projectDump]);
    writeFileSync(join(evidence, 'project.list'), projectToc);
    const dataTables = [...projectToc.matchAll(/^\d+; \d+ \d+ TABLE DATA public ([a-z_][a-z0-9_]*) /gm)].map(m => 'public.' + m[1]).sort();
    invariant(isDeepStrictEqual(dataTables, [...present].sort()), 'UNEXPECTED_DUMP_DATA_SCOPE');
    save('archive-hashes.json', { project: sha256(readFileSync(projectDump)), catalog: sha256(readFileSync(catalogDump)) });
    const restore = [...conn, '--dbname=' + DESTINATION, '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction'];
    if (!sourceOnly) {
      native('pg_restore', [...restore, '--schema-only', '--use-list=' + functionList, catalogDump]);
      for (const section of ['pre-data', 'data', 'post-data']) native('pg_restore', [...restore, '--section=' + section, projectDump]);
    }
  }
  if (!sourceOnly) {
  capture(DESTINATION, 'destination-base.jsonl');
  const baseline = compareSnapshots(snapshot, readFileSync(join(evidence, 'destination-base.jsonl'), 'utf8'), { mode: 'local_rehearsal' });
  save('baseline-comparison.json', baseline);
  invariant(baseline.equivalent && baseline.warnings.length === 0, 'BASELINE_MISMATCH_NO_DATA_REPAIR');
  await destination.query('SET search_path=pg_catalog');
  const safeDestination = await sequenceSafety(destination, present);
  save('destination-sequence-safety.json', safeDestination);
  invariant(safeDestination.safe && safeDestination.checked_consumers === safeSource.checked_consumers, 'DESTINATION_SEQUENCE_COLLISION_RISK');
  const migrations = await applyLocalLogistica(destination);
  save('logistica-stages.json', migrations);
  invariant(migrations.stage === 7 && !migrations.drift, 'FINAL_LOGISTICA_SCHEMA_MISMATCH');
  const after = await sourceState(source, protectedNames);
  save('source-after.json', after);
  invariant(isDeepStrictEqual(before, after), 'SOURCE_CHANGED_DURING_REHEARSAL');
  save('result.json', { pass: true, source: SOURCE, destination: DESTINATION,
    transferred_tables: present, baseline, sequence_consumers: safeDestination.checked_consumers,
    migrations, source_unchanged: true, production_connections: 0 });
  console.log(JSON.stringify({ pass: true, evidence: resolve(evidence), tables: present.length, stage: migrations.stage }));
  } else {
    const after = await sourceState(source, protectedNames);
    invariant(isDeepStrictEqual(before, after), 'SOURCE_CHANGED_DURING_AUDIT');
    save('source-after.json', after);
    save('source-audit.json', { pass: true, source: SOURCE, exported_tables: present,
      source_unchanged: true, destination_exists: Boolean(db), transfer_completed: false, production_connections: 0 });
    console.log(JSON.stringify({ source_audit: true, transfer_completed: false, evidence: resolve(evidence), tables: present.length }));
  }
} catch (error) {
  save('failure.json', { code: error.code || 'REHEARSAL_FAILED', message: error.message });
  console.error(JSON.stringify({ pass: false, code: error.code || 'REHEARSAL_FAILED', evidence: resolve(evidence) }));
  process.exitCode = 1;
} finally {
  if (source) { await source.query('ROLLBACK').catch(() => {}); await source.end(); }
  if (destination) await destination.end();
}
