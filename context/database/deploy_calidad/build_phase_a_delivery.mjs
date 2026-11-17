// Only these two autonomous SQL files are handed to the administrator in phase A.
// Sources remain the existing generators; no hand-edited delivery copies.
import { mkdirSync,writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { cleanFiles } from './build_clean_baseline.mjs';
import { testSeedFiles } from './build_test_seed.mjs';
export function phaseAFiles() {
 return new Map([
  ['01_create_calidad.sql',cleanFiles().get('create_calidad.sql')],
  ['02_seed_calidad_test.sql',testSeedFiles().get('seed_calidad_test.sql')],
 ]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 mkdirSync(new URL('fase_a/',import.meta.url),{recursive:true});
 for(const [name,sql] of phaseAFiles())writeFileSync(new URL('fase_a/'+name,import.meta.url),sql);
}
