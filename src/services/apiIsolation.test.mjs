// Real TypeScript modules, installed Axios fetch adapter, fake HTTP and SDKs only.
import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import axios from 'axios';

// Fail immediately if an adapter ever bypasses the per-fixture HTTP mock.
mock.method(globalThis, 'fetch', () => assert.fail('Real HTTP is forbidden in offline tests'));
after(() => mock.restoreAll());

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'https://desarrollotecnologicoar.com/api27';
const defaults = { VITE_APP_ENV: 'test', VITE_API10_URL: base, VITE_API5_ENABLED: 'false' };
const compile = source => ts.transpileModule(source.replaceAll('import.meta.env', '__env'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(overrides = {}) {
    const calls = [];
    const modules = new Map();
    let respond = () => new Response('[]');
    const sandbox = vm.createContext({
        __env: { ...defaults, ...overrides }, URL, Request, Response, AbortSignal, Error,
        fetch: async (...args) => { calls.push(args); return respond(...args); },
    });
    function load(relative) {
        const filename = path.resolve(root, relative);
        if (modules.has(filename)) return modules.get(filename);
        const exports = {};
        modules.set(filename, exports);
        const require = name => {
            if (name === 'axios') return { default: axios };
            assert.ok(name.startsWith('.'), 'Unexpected dependency: ' + name);
            return load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')));
        };
        const source = compile(readFileSync(filename, 'utf8'));
        vm.runInContext(`(function(exports, require) { ${source}\n})`, sandbox)(exports, require);
        return exports;
    }
    return { load, calls, respond(fn) { respond = fn; } };
}

test('TEST accepts exactly API27 with API5 explicitly disabled', () => {
    const app = fixture();
    const config = app.load('config/api.ts');
    assert.equal(config.API10_URL, base);
    assert.equal(config.IS_TEST, true);
    assert.equal(config.API5_ENABLED, false);
    assert.equal(app.calls.length, 0);
});

const invalidBases = [
    undefined, '', base + '/', base + '?q=1', base + '#x', base + '/tasks',
    base.replace('/api27', '/api10'), base.replace('/api27', '/api5'),
    base.replace('https:', 'http:'), base.replace('.com', '.invalid'),
    base.replace('.com', '.com:443'), base.replace('.com', '.com:8443'),
    base.replace('https://', 'https://user:pass@'), base + '@evil.invalid',
    ' ' + base, base + ' ', base + '/../api10', 'not-a-url',
];
for (const [index, url] of invalidBases.entries()) {
    test(`invalid TEST configuration ${index + 1} stops provider initialization without HTTP`, () => {
        const app = fixture({ VITE_API10_URL: url });
        assert.throws(() => app.load('dataProvider.ts'), /TEST_API27_CONFIG/);
        assert.equal(app.calls.length, 0);
    });
}
for (const enabled of [undefined, '', 'true', 'False', '0']) {
    test(`TEST fails closed when API5 flag is ${String(enabled)}`, () => {
        const app = fixture({ VITE_API5_ENABLED: enabled });
        assert.throws(() => app.load('dataProvider.ts'), /TEST_API27_CONFIG/);
        assert.equal(app.calls.length, 0);
    });
}
for (const env of ['', undefined, 'staging', 'TEST']) {
    test(`invalid application environment ${String(env)} makes no requests`, () => {
        const app = fixture({ VITE_APP_ENV: env });
        assert.throws(() => app.load('dataProvider.ts'), /VITE_APP_ENV/);
        assert.equal(app.calls.length, 0);
    });
}

for (const [env, url] of [['local', 'http://localhost:3010/api10'], ['production', 'https://production.invalid/api10']]) {
    test(`${env} keeps existing base URL, custom URLs and transport behavior`, async () => {
        const app = fixture({ VITE_APP_ENV: env, VITE_API10_URL: url });
        const config = app.load('config/api.ts');
        const transport = app.load('services/apiTransport.ts');
        const provider = app.load('dataProvider.ts').dataProvider;
        assert.equal(config.API10_URL, url);
        assert.equal(config.IS_TEST, false);
        assert.equal(transport.apiAxios, axios);
        await provider.custom({ url: 'https://other.invalid/tasks', method: 'get' });
        assert.equal(app.calls[0][0], 'https://other.invalid/tasks');
        assert.equal(app.calls[0][1].redirect, undefined);
        await provider.custom({ url: '/tasks', method: 'get' });
        assert.equal(app.calls[1][0], url + '/tasks');
    });
}
test('local still forbids another main API and ignores the API5 enable switch', () => {
    assert.throws(() => fixture({ VITE_APP_ENV: 'local' }).load('config/api.ts'), /local solo permite/);
    const config = fixture({ VITE_APP_ENV: 'local', VITE_API10_URL: 'http://localhost:3010/api10', VITE_API5_ENABLED: 'true' }).load('config/api.ts');
    assert.equal(config.API5_ENABLED, false);
    assert.throws(() => config.assertApi5WriteEnabled('/agregar_tecnico'), /entorno local/);
});
test('production preserves enabled API5 URL normalization and validation', async () => {
    const app = fixture({ VITE_APP_ENV: 'production', VITE_API10_URL: 'http://production.invalid/api10', VITE_API5_ENABLED: 'true', VITE_API5_URL: 'https://production.invalid/api5///' });
    const config = app.load('config/api.ts');
    assert.equal(config.API5_ENABLED, true);
    await app.load('services/api5.ts').addApi5Technician({ name: 'offline fixture' });
    assert.equal(app.calls[0][0], 'https://production.invalid/api5/agregar_tecnico');
    assert.equal(app.calls[0][1].method, 'POST');
    assert.throws(() => fixture({ VITE_APP_ENV: 'production', VITE_API5_ENABLED: 'true' }).load('config/api.ts'), /VITE_API5_URL/);
});

const forbidden = [
    'https://desarrollotecnologicoar.com/api10/tasks',
    'https://desarrollotecnologicoar.com/api5/tecnicos',
    'https://other.invalid/api27/tasks', 'http://desarrollotecnologicoar.com/api27/tasks',
    '//other.invalid/api27', '//desarrollotecnologicoar.com/api10',
    base.replace('.com', '.com:443') + '/tasks', base.replace('.com', '.com:8443') + '/tasks',
    base.replace('https://', 'https://user:pass@') + '/tasks',
    base + 'evil/tasks', base + '/../api10', base + '/./tasks',
    base + '/%2e%2e/api10', base + '/%252e%252e/api10', base + '/%2F..%2Fapi10',
    base + '/%5c..%5capi10', base + '/tasks//other.invalid', base + '/tasks;../api10',
    base + '/tasks#ignored', base + '\\..\\api10', base + '/tasks\n',
    base + '/https://other.invalid/tasks', '/../../api10', '/%2e%2e/api10',
    '/%252fapi10', '/tasks/%zz', 'javascript:alert(1)', '', undefined,
];
for (const [index, url] of forbidden.entries()) {
    test(`provider custom rejects forbidden destination ${index + 1} before fetch`, async () => {
        const app = fixture();
        const provider = app.load('dataProvider.ts').dataProvider;
        await assert.rejects(provider.custom({ url, method: 'post', values: {} }), /TEST_API27_DESTINATION/);
        assert.equal(app.calls.length, 0);
    });
}
test('relative and authorized absolute custom URLs preserve query/body contracts', async () => {
    const app = fixture();
    const provider = app.load('dataProvider.ts').dataProvider;
    for (const url of ['/tasks?section_id=7', 'tasks?section_id=7', base + '/tasks?section_id=7']) {
        await provider.custom({ url, method: 'put', values: { title: 'offline' } });
        const [actual, init] = app.calls.at(-1);
        assert.equal(actual, base + '/tasks?section_id=7');
        assert.equal(init.method, 'PUT');
        assert.equal(init.body, JSON.stringify({ title: 'offline' }));
        assert.equal(init.redirect, 'error');
    }
});
test('non-custom provider operations cannot escape using manipulated resources or IDs', async () => {
    const app = fixture();
    const provider = app.load('dataProvider.ts').dataProvider;
    for (const operation of ['getList', 'getOne', 'create', 'update', 'deleteOne']) {
        await assert.rejects(provider[operation]({ resource: '../api10', id: 7, variables: {} }), /TEST_API27_DESTINATION/);
    }
    await assert.rejects(provider.getOne({ resource: 'tasks', id: '../../api10' }), /TEST_API27_DESTINATION/);
    assert.equal(app.calls.length, 0);
});

test('direct fetch and Axios reject API10/API5/external destinations before dispatch', async () => {
    const app = fixture();
    const transport = app.load('services/apiTransport.ts');
    for (const url of forbidden.filter(url => typeof url === 'string')) {
        assert.throws(() => transport.apiFetch(url), /TEST_API27_DESTINATION/);
        await assert.rejects(transport.apiAxios.get(url), /TEST_API27_DESTINATION/);
    }
    assert.equal(app.calls.length, 0);
});
test('installed Axios fetch adapter preserves params, JSON payloads, data and HTTP errors', async () => {
    const app = fixture();
    const { apiAxios } = app.load('services/apiTransport.ts');
    app.respond(() => new Response('{"id":7}', { headers: { 'Content-Type': 'application/json' } }));
    const response = await apiAxios.post(base + '/tasks', { title: 'offline' }, { params: { section_id: 7 } });
    assert.equal(response.data.id, 7);
    assert.equal(app.calls.length, 1);
    const [request, init] = app.calls[0];
    assert.equal(request.url, base + '/tasks?section_id=7');
    assert.equal(request.method, 'POST');
    assert.equal(await request.text(), '{"title":"offline"}');
    assert.equal(request.redirect, 'error');
    assert.equal(init.redirect, 'error');
    app.respond(() => new Response('{"error":"denied"}', { status: 403 }));
    await assert.rejects(apiAxios.get(base + '/tasks'), error => error.response.status === 403);
});
test('fetch and Axios force redirect:error even if callers request follow', async () => {
    const app = fixture();
    const { apiAxios, apiFetch } = app.load('services/apiTransport.ts');
    app.respond((input, init) => {
        assert.equal(init.redirect, 'error');
        if (typeof input !== 'string') assert.equal(input.redirect, 'error');
        // Simulate browser rejection of a redirect to API10, without following it.
        throw new TypeError('redirect disallowed');
    });
    await assert.rejects(apiFetch(base + '/tasks', { redirect: 'follow' }));
    await assert.rejects(apiAxios.get(base + '/tasks', { fetchOptions: { redirect: 'follow' }, adapter: 'xhr' }));
    assert.equal(app.calls.length, 2);
});
test('API5 reads, registrations and notifications are all blocked in TEST', async () => {
    const app = fixture({ VITE_API5_URL: 'https://production.invalid/api5' });
    const service = app.load('services/api5.ts');
    assert.equal((await service.getApi5Technicians()).length, 0);
    await assert.rejects(service.addApi5Technician({}), /TEST_API27_API5/);
    await assert.rejects(service.sendApi5Notification({}), /TEST_API27_API5/);
    assert.equal(app.calls.length, 0);
});

// Execute the real nested page handlers independently with every effect instrumented.
// This also exercises their guard before confirmation, SDK imports or credential use.
function technicianActions(isTest) {
    const source = readFileSync(path.join(root, 'pages/CreateWorkOrderFromTemplate.tsx'), 'utf8');
    const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const names = ['guardarTecnico', 'handleAddOperador', 'fetchUsuarios', 'handleOpenDialogNewTec'];
    const declarations = [];
    function visit(node) {
        if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(ast)))) declarations.push(node.getText(ast));
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.equal(declarations.length, names.length);
    const effects = [];
    const messages = [];
    const effect = name => () => { effects.push(name); return {}; };
    const sandbox = vm.createContext({
        exports: {}, IS_TEST: isTest, TEST_EXTERNAL_ADMIN_MESSAGE: 'Administración externa deshabilitada en TEST',
        API5_ENABLED: true, // Deliberately available: the page guard must be independent.
        newTecForm: { nombre_tecnico: 'offline fixture', correo_tecnico: 'fixture@example.invalid' },
        contraseña: 'offline-placeholder',
        alert: message => messages.push(message), confirm: effect('confirm'),
        addApi5Technician: effect('API5'), setOpenDialogNewTec: effect('dialog'),
        setTechs() {}, setForm() {}, setNewTec() {}, setManualEmail() {}, setOperadores() {},
        fetch: async () => { effects.push('Firebase HTTP'); return new Response('{}'); },
        console: { log() {}, error() {} },
        require(name) {
            effects.push('import:' + name);
            if (name === 'firebase/firestore') return { collection: effect('collection'), addDoc: effect('Firestore write'), getDocs: () => ({ docs: [] }) };
            if (name === '../firebase/firebase-config') return { db: {} };
            throw new Error('Unexpected SDK: ' + name);
        },
    });
    vm.runInContext(compile(declarations.join('\n') + '\nexports.actions = {' + names.join(',') + '};'), sandbox);
    return { actions: sandbox.exports.actions, effects, messages };
}
test('TEST technician handlers execute no API5/Firebase/Firestore effects, even with API5 available', async () => {
    const app = technicianActions(true);
    assert.equal(await app.actions.guardarTecnico(), false);
    await app.actions.handleAddOperador();
    await app.actions.fetchUsuarios();
    app.actions.handleOpenDialogNewTec();
    assert.deepEqual(app.effects, []);
    assert.equal(app.messages.length, 3);
    assert.ok(app.messages.every(message => /deshabilitada en TEST/.test(message)));
});
test('production operator handler still loads Firebase and performs its existing effects with mocks', async () => {
    const app = technicianActions(false);
    await app.actions.handleAddOperador();
    assert.ok(app.effects.includes('import:../firebase/firebase-config'));
    assert.ok(app.effects.includes('Firebase HTTP'));
    assert.ok(app.effects.includes('Firestore write'));
});

test('all current page HTTP consumers use the guarded transport; Firebase has no static page import', () => {
    function files(dir) {
        return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
    }
    for (const filename of files(root).filter(file => /\.tsx?$/.test(file))) {
        const source = readFileSync(filename, 'utf8');
        const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
        const imports = new Map();
        for (const node of ast.statements.filter(ts.isImportDeclaration)) {
            const from = node.moduleSpecifier.text;
            if (from === 'axios') assert.equal(filename, path.join(root, 'services/apiTransport.ts'));
            if (filename.includes(path.sep + 'pages' + path.sep)) assert.ok(!/firebase/.test(from), 'Static Firebase page import');
            const bindings = node.importClause?.namedBindings;
            if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) imports.set(item.name.text, from);
        }
        function visit(node) {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
                const rawAllowed = ['services/apiTransport.ts', 'services/api5.ts'].some(file => filename === path.join(root, file));
                assert.ok(rawAllowed || imports.get('fetch')?.endsWith('/apiTransport'), 'Unguarded fetch in ' + filename);
            }
            ts.forEachChild(node, visit);
        }
        visit(ast);
        assert.ok(!/\b(?:XMLHttpRequest|WebSocket|sendBeacon)\b/.test(source), 'Unreviewed network transport in ' + filename);
    }
});
