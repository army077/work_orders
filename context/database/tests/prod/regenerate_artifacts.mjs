// Solo regeneracion offline de artefactos NO aplicados. No conecta a PostgreSQL.
import { writeFileSync } from 'node:fs';
import { NAMES, states, sha256 } from '../../migrations/prod/logistica_prod_support.js';
import { renderMigration } from './artifact_blueprint.js';

if (process.argv.length !== 3 || process.argv[2] !== '--write-unapplied-artifacts') {
  throw new Error('Requiere --write-unapplied-artifacts; nunca reescribir SQL ya aplicado');
}
const previous = [], expected = states();
for (const [i, name] of NAMES.entries()) {
  const sql = renderMigration(name, i, expected, previous);
  const bytes = Buffer.from(sql, 'utf8'); // Los mismos bytes que ejecuta el runner.
  writeFileSync(new URL('../../migrations/prod/' + name, import.meta.url), bytes);
  previous.push({ name, sha256: sha256(bytes) });
}
console.log(JSON.stringify(previous, null, 2));
