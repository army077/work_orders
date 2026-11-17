// Offline comparison of shareable TSV reports. No database/configuration required.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateRestore } from './08_operar.mjs';
export function compareFiles(source,destination,snapshot,rowBaseline,rowDestination,archiveSequences) {
  if(snapshot && (!rowBaseline||!rowDestination||!archiveSequences)) throw new Error('ROW_AND_SEQUENCE_CAPTURES_REQUIRED');
  return validateRestore(readFileSync(source,'utf8'),readFileSync(destination,'utf8'),
    snapshot?{snapshot:JSON.parse(readFileSync(snapshot,'utf8')),rowBaseline:readFileSync(rowBaseline,'utf8'),
      rowDestination:readFileSync(rowDestination,'utf8'),archiveSequences:JSON.parse(readFileSync(archiveSequences,'utf8'))}:undefined);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(process.argv.length!==4 && process.argv.length!==8) throw new Error('REPORTS_AND_SNAPSHOT_WITH_ROW_SEQUENCE_CAPTURES_REQUIRED');
    const result=compareFiles(...process.argv.slice(2));
    console.log(JSON.stringify(result,null,2));
    if(result.RESTORE_VALIDADO!=='SI') process.exitCode=1;
  } catch {
    console.error('RESTORE_VALIDADO = NO; captura incompleta, no apta o incompatible.');
    process.exitCode=1;
  }
}
