// Offline lockfile audit. No imports of API10, pg, Firebase or Drive.
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const TARGET = '18.19.1';
function dependencyPath(packages, from, name) {
  let base = from;
  while (true) {
    const key = (base ? base + '/' : '') + 'node_modules/' + name;
    if (packages[key]) return key;
    const index = base.lastIndexOf('/node_modules/');
    if (index >= 0) base = base.slice(0, index);
    else if (base) base = '';
    else return null;
  }
}
function audit(lock) {
  const packages = lock.packages;
  if (!packages?.['']) throw new Error('LOCK_PACKAGES_REQUIRED');
  const rootEngine = packages[''].engines?.node;
  const rootCompatible = !rootEngine || !!semver.validRange(rootEngine) && semver.satisfies(TARGET, rootEngine);
  const reached = new Map(), pending = [{ key: '', optional: false }], missing = [];
  while (pending.length) {
    const { key, optional } = pending.shift();
    if (reached.has(key) && (!reached.get(key) || optional)) continue;
    reached.set(key, optional);
    const item = packages[key];
    for (const name of new Set([...Object.keys(item.dependencies || {}), ...Object.keys(item.optionalDependencies || {}), ...Object.keys(item.peerDependencies || {})])) {
      const nextOptional = optional || Object.hasOwn(item.optionalDependencies || {}, name) || !!item.peerDependenciesMeta?.[name]?.optional;
      const child = dependencyPath(packages, key, name);
      if (child) pending.push({ key: child, optional: nextOptional });
      else if (!nextOptional) missing.push({ parent: key || 'ROOT', name });
    }
  }
  const rows = Object.entries(packages).filter(([key]) => key).map(([key, item]) => {
    const parents = Object.entries(packages).filter(([parent, value]) =>
      [...Object.keys(value.dependencies || {}), ...Object.keys(value.optionalDependencies || {}), ...Object.keys(value.peerDependencies || {})]
        .some(name => dependencyPath(packages, parent, name) === key)).map(([parent]) => parent || 'ROOT');
    const engine = item.engines?.node || null;
    return { path: key, name: key.split('node_modules/').at(-1), version: item.version, engine,
      classification: reached.has(key) ? reached.get(key) ? 'optional-runtime' : 'runtime' : item.dev ? 'dev' : 'unclassified',
      direct: Object.keys(packages[''].dependencies || {}).some(name => dependencyPath(packages, '', name) === key),
      parents, compatible: !engine || !!semver.validRange(engine) && semver.satisfies(TARGET, engine) };
  });
  const incompatible = rows.filter(row => row.classification !== 'dev' && !row.compatible);
  const unclassified = rows.filter(row => row.classification === 'unclassified');
  return { target: TARGET, root_engine: rootEngine || null, root_compatible: rootCompatible,
    packages: rows.length, runtime: rows.filter(r => r.classification === 'runtime').length,
    optional_runtime: rows.filter(r => r.classification === 'optional-runtime').length,
    dev: rows.filter(r => r.classification === 'dev').length, missing, incompatible, unclassified,
    compatible: rootCompatible && incompatible.length === 0 && missing.length === 0 && unclassified.length === 0, rows };
}
module.exports = { TARGET, audit, dependencyPath };
if (require.main === module) {
  const args = process.argv.slice(2);
  const result = audit(JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8')));
  const output = JSON.stringify(result, null, 2) + '\n';
  if (args[0] === '--output' && args.length === 2) fs.writeFileSync(args[1], output);
  else if (args.length) throw new Error('INVALID_ARGUMENTS');
  else console.log(JSON.stringify({ ...result, rows: undefined }, null, 2));
  if (!result.compatible) process.exitCode = 1;
}
