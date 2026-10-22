// Genera argumentos JSON desde una captura terminada. No ejecuta ningun proceso.
// No autoriza las dependencias: el operador debe revisarlas antes de usar los argumentos.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseSnapshot, core } from './compare_snapshots.mjs';

export function prepareDumpArgs(bytes, { mode = 'production', approvedHistorical = [] } = {}) {
  if (!['production', 'local_rehearsal'].includes(mode)) throw new Error('UNAPPROVED_MODE');
  const database = mode === 'production' ? 'artecnologia' : 'artecnologia_test_local';
  const rows = [...parseSnapshot(bytes, database).values()];
  const historical = rows.find(r => r.kind === 'scope').tables.filter(t => t.present && !core.includes(t.name)).map(t => t.name).sort();
  if (JSON.stringify(historical) !== JSON.stringify([...approvedHistorical].sort())) throw new Error('HISTORICAL_APPROVAL_REQUIRED');
  const names = rows.filter(r => ['table', 'sequence'].includes(r.kind)).map(r => r.name).sort();
  // El alcance conocido usa identificadores public/minusculas. Otros requieren revision.
  for (const name of names) if (!/^public\.[a-z_][a-z0-9_]*$/.test(name)) throw new Error('REVIEW_IDENTIFIER:' + name);
  return {
    ready_to_execute: false,
    reason: 'Falta cerrar dependencias, permisos, snapshot de corte y aprobar listas TOC.',
    tables_and_sequences: names,
    argv: ['--format=custom', '--strict-names', '--no-large-objects', '--dbname=' + database,
      ...names.map(name => '--table=' + name.split('.').map(s => '"' + s + '"').join('.'))],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length < 3 || process.argv.length > 4) throw new Error('USAGE: node prepare_dump_args.mjs origen.jsonl [--approved-historical=public.tabla,...]');
    const option = process.argv[3];
    if (option && !option.startsWith('--approved-historical=')) throw new Error('UNKNOWN_ARGUMENT');
    const approvedHistorical = option ? option.slice('--approved-historical='.length).split(',') : [];
    console.log(JSON.stringify(prepareDumpArgs(readFileSync(process.argv[2], 'utf8'), { approvedHistorical }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
