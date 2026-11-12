'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const dependencies = process.env.LEGACY_P2_DEPENDENCIES || path.join(root, 'node_modules');
const stage = process.env.LEGACY_P2_STAGE;
if (!stage) throw new Error('Set LEGACY_P2_STAGE to an isolated output directory');
const requireDependency = createRequire(path.join(dependencies, '__p2_check.cjs'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
for (const name of Object.keys({ ...lock.packages[''].dependencies, ...lock.packages[''].devDependencies })) {
  const actual = JSON.parse(fs.readFileSync(path.join(dependencies, name, 'package.json'), 'utf8')).version;
  const expected = lock.packages[`node_modules/${name}`].version;
  if (actual !== expected) throw new Error(`Dependency mismatch: ${name}: ${actual} != ${expected}`);
}

function typecheck(baseline) {
  const ts = requireDependency('typescript');
  const config = ts.readConfigFile(path.join(root, 'tsconfig.app.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const options = { ...parsed.options, incremental: false, noEmit: true, typeRoots: [path.join(dependencies, '@types')] };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile;
  const originals = new Map();
  if (baseline) {
    originals.set(path.join(root, 'src/pages/Plantel Inspeccion.tsx'), path.join(stage, 'Plantel.original.tsx'));
    originals.set(path.join(root, 'src/dataProvider.ts'), path.join(stage, 'dataProvider.original.ts'));
  }
  const overridden = new Set();
  host.readFile = filename => {
    const saved = originals.get(path.resolve(filename));
    if (saved) overridden.add(path.resolve(filename));
    return originalRead(saved || filename);
  };
  const dependencyFile = path.resolve(dependencies, '..', '__p2_check.ts');
  host.resolveModuleNames = (names, containing) => names.map(name => {
    const local = ts.resolveModuleName(name, containing, options, host).resolvedModule;
    if (local || name.startsWith('.') || path.isAbsolute(name)) return local;
    return ts.resolveModuleName(name, dependencyFile, options, host).resolvedModule;
  });
  host.resolveTypeReferenceDirectives = (names, containing) => names.map(value => {
    const name = typeof value === 'string' ? value : value.fileName;
    return ts.resolveTypeReferenceDirective(name, containing, options, host).resolvedTypeReferenceDirective
      || ts.resolveTypeReferenceDirective(name, dependencyFile, options, host).resolvedTypeReferenceDirective;
  });
  let fileNames = parsed.fileNames;
  if (baseline) {
    const initial = JSON.parse(fs.readFileSync(path.join(stage, 'baseline.json'), 'utf8').replace(/^\uFEFF/, ''));
    fileNames = fileNames.filter(file => Object.hasOwn(initial, path.relative(root, file).replaceAll('\\', '/')));
  }
  const program = ts.createProgram(fileNames, options, host);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(diagnostic => ({
    file: diagnostic.file ? path.relative(root, diagnostic.file.fileName).replaceAll('\\', '/') : '',
    line: diagnostic.file && diagnostic.start != null ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1 : 0,
    code: diagnostic.code, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
  const output = path.join(stage, baseline ? 'types.before.json' : 'types.after.json');
  if (baseline && overridden.size !== 2) throw new Error('Baseline source overrides were not both applied');
  fs.writeFileSync(output, JSON.stringify(diagnostics, null, 2));
  console.log(JSON.stringify({ mode: baseline ? 'baseline-types' : 'types', diagnostics: diagnostics.length, output }));
  if (!baseline) {
    const old = JSON.parse(fs.readFileSync(path.join(stage, 'types.before.json'), 'utf8'));
    const key = item => JSON.stringify([item.file, item.code, item.message]);
    const counts = new Map(); for (const item of old) counts.set(key(item), (counts.get(key(item)) || 0) + 1);
    const introduced = [];
    for (const item of diagnostics) {
      const count = counts.get(key(item)) || 0;
      if (count) counts.set(key(item), count - 1); else introduced.push(item);
    }
    console.log(JSON.stringify({ introduced }));
    if (introduced.length) process.exitCode = 1;
  }
}

async function build() {
  const buildRoot = path.join(stage, 'isolated-build');
  fs.mkdirSync(buildRoot, { recursive: true });
  // Only source and reviewed build inputs; no .env, backend, credentials or scripts.
  for (const file of ['src', 'public', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json']) {
    const source = path.join(root, file);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(buildRoot, file), { recursive: true });
  }
  const modules = path.join(buildRoot, 'node_modules');
  if (!fs.existsSync(modules)) fs.symlinkSync(dependencies, modules, 'junction');
  const vite = await import(pathToFileURL(path.join(dependencies, 'vite/dist/node/index.js')).href);
  await vite.build({ root: buildRoot, configFile: path.join(buildRoot, 'vite.config.ts'),
    cacheDir: path.join(buildRoot, '.vite'), build: { outDir: path.join(buildRoot, 'dist'), emptyOutDir: false }, logLevel: 'warn' });
  console.log(JSON.stringify({ build: 'passed', output: path.join(buildRoot, 'dist') }));
}

const mode = process.argv[2];
if (mode === 'baseline-types' || mode === 'types') typecheck(mode === 'baseline-types');
else if (mode === 'build') build().catch(error => { console.error(error.message); process.exitCode = 1; });
else throw new Error('Usage: node tools/check-inspection-p2.cjs baseline-types|types|build');
