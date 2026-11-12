'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const dependencyRoot = process.env.LEGACY_P2_DEPENDENCIES || path.join(root, 'node_modules');
const dependencyRequire = createRequire(path.join(dependencyRoot, '__p2_tests.cjs'));
const ts = dependencyRequire('typescript');

// Compile only trusted local source in memory. No install, server or browser.
function createLoader(mocks = {}) {
  const cache = new Map();
  function load(filename) {
    const absolute = path.resolve(root, filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const source = fs.readFileSync(absolute, 'utf8');
    const compiled = ts.transpileModule(source, { fileName: absolute, compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    } }).outputText;
    const mod = { exports: {} };
    cache.set(absolute, mod);
    const requireModule = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('.')) {
        const base = path.resolve(path.dirname(absolute), name);
        const candidate = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file));
        if (!candidate) throw new Error(`Unresolved local import: ${name}`);
        return load(candidate);
      }
      return dependencyRequire(name);
    };
    new Function('require', 'module', 'exports', compiled)(requireModule, mod, mod.exports);
    return mod.exports;
  }
  return load;
}

module.exports = { root, dependencyRoot, dependencyRequire, createLoader };
