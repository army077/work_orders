// Offline comparison of shareable TSV reports. No database/configuration required.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateRestore } from './08_operar.mjs';
export function compareFiles(source,destination) {
  return validateRestore(readFileSync(source,'utf8'),readFileSync(destination,'utf8'));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(process.argv.length!==4) throw new Error('TWO_REPORTS_REQUIRED');
    const result=compareFiles(process.argv[2],process.argv[3]);
    console.log(JSON.stringify(result,null,2));
    if(result.RESTORE_VALIDADO!=='SI') process.exitCode=1;
  } catch {
    console.error('RESTORE_VALIDADO = NO; captura incompleta, no apta o incompatible.');
    process.exitCode=1;
  }
}
