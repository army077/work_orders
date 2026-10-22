// Single inventory: manifest.psql is also consumed by the existing psql scripts.
import { readFileSync } from 'node:fs';
const manifest = readFileSync(new URL('./manifest.psql', import.meta.url), 'utf8');
export function entries(name) {
  const match = manifest.match(new RegExp(String.raw`\\set ${name} '\{([^}]+)\}'`));
  if (!match) throw new Error('MANIFEST_ENTRY_MISSING');
  return Object.freeze(match[1].split(','));
}
export const core = entries('core_tables');
export const historical = entries('historical_tables');
export const logistics = entries('logistics_tables');
export const rootFunctions = entries('root_functions');
