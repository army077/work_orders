// Functional frontend tests: real modules, fake HTTP, no API/DB/Firebase access.
import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import axios from 'axios';

mock.method(globalThis, 'fetch', () => assert.fail('Real HTTP forbidden'));
after(() => mock.restoreAll());
const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'https://desarrollotecnologicoar.com/api27';
const compiled = new Map();
function fixture({ fastTimeout = false, env = {} } = {}) {
    const calls = [], timeouts = [], cache = new Map();
    let respond = () => new Response('[]');
    const sandbox = vm.createContext({
        URL, Request, Response, Error, AbortSignal, AbortController, DOMException,
        __env: { VITE_APP_ENV: 'test', VITE_API10_URL: base, VITE_API5_ENABLED: 'false', ...env },
        fetch: (...args) => { calls.push(args); return respond(...args); },
        setTimeout(fn, ms) { timeouts.push(ms); return setTimeout(fn, fastTimeout ? 1 : ms); }, clearTimeout,
    });
    const app = { calls, timeouts, respond(fn) { respond = fn; }, bindings: {} };
    app.load = relative => {
        const filename = path.resolve(root, relative);
        if (cache.has(filename)) return cache.get(filename);
        if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(readFileSync(filename, 'utf8').replaceAll('import.meta.env', '__env'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
        }).outputText);
        const exports = {};
        cache.set(filename, exports);
        const require = name => {
            if (name in app.bindings) return app.bindings[name];
            if (name === 'axios') return { default: axios };
            assert.ok(name.startsWith('.'), 'Unexpected dependency: ' + name);
            return app.load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')));
        };
        vm.runInContext(`(function(exports,require){${compiled.get(filename)}\n})`, sandbox)(exports, require);
        return exports;
    };
    return app;
}
const eq = (field, value) => ({ field, operator: 'eq', value });

for (const [label, args] of [
    ['meta', { meta: { queryParams: { family_id: '8', unrelated: 'ignored' } } }],
    ['Refine eq', { filters: [eq('family_id', 8)] }],
    ['Refine AND', { filters: [{ operator: 'and', value: [eq('family_id', 8)] }] }],
    ['equivalent sources', { filters: [eq('family_id', 8)], meta: { queryParams: { family_id: '8' } } }],
]) test('model family filter uses only its contract: ' + label, async () => {
    const app = fixture();
    app.respond(() => new Response('[{"id":37,"family_id":8}]'));
    const result = await app.load('dataProvider.ts').dataProvider.getList({ resource: 'machine-models', ...args });
    assert.equal(app.calls[0][0], base + '/machine-models?family_id=8');
    assert.equal(result.data[0].family_id, 8);
    assert.equal(result.total, 1);
});
test('models without family filter retain unfiltered URL; other resource queries are not forwarded', async () => {
    const app = fixture(), provider = app.load('dataProvider.ts').dataProvider;
    await provider.getList({ resource: 'machine-models', filters: [eq('name', 'ignored')], meta: { queryParams: { order: 'ignored' } } });
    await provider.getList({ resource: 'templates', filters: [eq('family_id', 8)], meta: { queryParams: { family_id: 8 } } });
    assert.deepEqual(app.calls.map(([url]) => url), [base + '/machine-models', base + '/templates']);
});
test('invalid family IDs reject before HTTP, including ambiguous/coercible values', async () => {
    const app = fixture(), provider = app.load('dataProvider.ts').dataProvider;
    for (const family_id of [undefined, null, '', '01', '1e2', ' 2', '2&x=3', 0, -1, 1.5, NaN, Infinity, 2147483648, true, [8]]) {
        await assert.rejects(provider.getList({ resource: 'machine-models', meta: { queryParams: { family_id } } }), e => e.statusCode === 400);
    }
    assert.equal(app.calls.length, 0);
});
for (const filters of [
    [{ field: 'family_id', operator: 'ne', value: 8 }],
    [{ operator: 'or', value: [eq('family_id', 8), eq('family_id', 9)] }],
    [eq('family_id', 8), eq('family_id', 9)],
]) test('unrepresentable family filter is rejected: ' + JSON.stringify(filters), async () => {
    const app = fixture();
    await assert.rejects(app.load('dataProvider.ts').dataProvider.getList({ resource: 'machine-models', filters }), e => e.statusCode === 400);
    assert.equal(app.calls.length, 0);
});
test('conflicting meta/filter parent IDs never choose one silently', async () => {
    const app = fixture();
    await assert.rejects(app.load('dataProvider.ts').dataProvider.getList({ resource: 'sections', filters: [eq('template_id', 1)], meta: { queryParams: { template_id: 2 } } }), e => e.statusCode === 400);
    assert.equal(app.calls.length, 0);
});

for (const [resource, field] of [['sections', 'template_id'], ['tasks', 'section_id'], ['quality/template_task_inspection', 'section_id']]) {
    test(resource + ': missing/invalid parents never send HTTP', async () => {
        const app = fixture(), provider = app.load('dataProvider.ts').dataProvider;
        for (const value of [undefined, null, '', 'undefined', 'null', '0', '01', '1.0', '1&x=2', -1, 0, 1.5, NaN, Infinity, 2147483648]) {
            await assert.rejects(provider.getList({ resource, filters: [eq(field, value)] }), e => e.statusCode === 400 && e.message.includes(field));
        }
        await assert.rejects(provider.getList({ resource }), e => e.statusCode === 400);
        assert.equal(app.calls.length, 0);
    });
    test(resource + ': valid parent preserves empty arrays and maximum IDs', async () => {
        const app = fixture();
        const result = await app.load('dataProvider.ts').dataProvider.getList({ resource, meta: { queryParams: { [field]: '2147483647' } } });
        assert.equal(result.data.length, 0);
        assert.equal(app.calls[0][0], `${base}/${resource}?${field}=2147483647`);
    });
    test(resource + ': HTTP 400/404 and malformed success are errors, not empty lists', async () => {
        const app = fixture(), provider = app.load('dataProvider.ts').dataProvider;
        for (const code of [400, 404]) {
            app.respond(() => new Response('{"error":"Parent not available"}', { status: code }));
            await assert.rejects(provider.getList({ resource, filters: [eq(field, 7)] }), e => e.statusCode === code && e.message === 'Parent not available');
        }
        app.respond(() => new Response('{"error":"unexpected envelope"}'));
        await assert.rejects(provider.getList({ resource, filters: [eq(field, 7)] }), e => e.statusCode === 502);
    });
}
test('network error and client errors retain bounded retries and never fallback to API10/API5', async () => {
    const app = fixture(), provider = app.load('dataProvider.ts').dataProvider;
    app.respond(() => { throw new Error('offline'); });
    await assert.rejects(provider.getList({ resource: 'machine-models' }), e => e.statusCode === 0);
    const { retryApiQuery } = app.load('services/apiResponse.ts');
    for (const statusCode of [400, 401, 403, 404]) assert.equal(retryApiQuery(0, { statusCode }), false);
    assert.equal(retryApiQuery(0, { statusCode: 0 }), true);
    assert.equal(retryApiQuery(1, { statusCode: 0 }), false);
    assert.equal(app.calls.length, 1);
    assert.ok(app.calls.every(([url]) => url.startsWith(base + '/')));
});

const section = (id = 7, template_id = 11) => ({ id, template_id, title: 'Representative section', position: 1 });
const task = (id = 21, section_id = 7, position = 1) => ({ id, section_id, position, title: 'Normal task', code: 'A01', expected_minutes: 15 });
const point = (id = 221, section_id = 7, position = 1) => ({ id, section_id, position, revision_point: 'Revisar ajuste', specs: 'Según checklist', suggestions: 'Verificar fijación', required: true, category: 'Mecánica' });
const loadItems = (app, type, sections = [section()], signal = new AbortController().signal) => app.load('services/templateDetails.ts').loadTemplateItems(base, 11, type, sections, signal);

test('normal detail preserves task fields and numeric PostgreSQL minute strings', async () => {
    const app = fixture();
    app.respond(() => new Response(JSON.stringify([task(22, 7, 2), { ...task(), expected_minutes: '2.5' }])));
    const result = await loadItems(app, 'ENSAMBLE');
    assert.equal(app.calls[0][0], base + '/tasks?section_id=7');
    assert.deepEqual(Array.from(result[7], t => t.id), [21, 22]);
    assert.equal(result[7][0].expected_minutes, 2.5);
    assert.equal(result[7][0].title, 'Normal task');
});
test('inspection detail uses its own schema, order and endpoint without inventing task fields', async () => {
    const app = fixture();
    app.respond(() => new Response(JSON.stringify([point(222, 7, 2), point()])));
    const result = await loadItems(app, 'INSPECCION');
    assert.equal(app.calls[0][0], base + '/quality/template_task_inspection?section_id=7');
    assert.deepEqual(Array.from(result[7], p => p.id), [221, 222]);
    assert.equal(result[7][0].suggestions, 'Verificar fijación');
    assert.equal(result[7][0].revision_point, 'Revisar ajuste');
    assert.equal('title' in result[7][0], false);
    assert.equal('expected_minutes' in result[7][0], false);
});
test('empty sections/payloads and nullable inspection metadata remain valid empty states', async () => {
    const app = fixture();
    assert.equal(Object.keys(await loadItems(app, 'INSPECCION', [])).length, 0);
    assert.equal(app.calls.length, 0);
    assert.equal((await loadItems(app, 'INSPECCION'))[7].length, 0);
    app.respond(() => new Response(JSON.stringify([{ ...point(), specs: null, suggestions: null, category: null, required: false }])));
    assert.equal((await loadItems(app, 'INSPECCION'))[7][0].required, false);
});
test('all section IDs/associations are validated before any batch request', async () => {
    const app = fixture();
    for (const sections of [[section(), section(undefined, 12)], [section(), section(0)], [section(), section()]]) {
        await assert.rejects(loadItems(app, 'INSPECCION', sections), e => [400, 502].includes(e.statusCode));
    }
    assert.equal(app.calls.length, 0);
});
test('wrong relation, wrong schema and duplicate item IDs cannot become successful detail data', async () => {
    const app = fixture();
    for (const rows of [[point(1, 99)], [task()], [point(), point()], [{ ...point(), suggestions: 123 }], { data: [] }]) {
        app.respond(() => new Response(JSON.stringify(rows)));
        await assert.rejects(loadItems(app, 'INSPECCION'), e => e.statusCode === 502);
    }
});
test('detail HTTP 400/404/network failures propagate instead of becoming empty sections', async () => {
    const app = fixture();
    for (const status of [400, 404]) {
        app.respond(() => new Response('{"error":"No disponible"}', { status }));
        await assert.rejects(loadItems(app, 'INSPECCION'), e => e.statusCode === status);
    }
    app.respond(() => { throw new Error('offline'); });
    await assert.rejects(loadItems(app, 'ENSAMBLE'), e => e.statusCode === 0);
});
test('cancelled batch sends nothing; a hanging network is bounded by the 20-second deadline', async () => {
    const app = fixture({ fastTimeout: true }), controller = new AbortController();
    controller.abort();
    await assert.rejects(loadItems(app, 'INSPECCION', [section()], controller.signal));
    assert.equal(app.calls.length, 0);
    app.respond((url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })));
    await assert.rejects(loadItems(app, 'INSPECCION'), e => e.statusCode === 0 && e.message.includes('tardó demasiado'));
    assert.equal(app.timeouts.at(-1), 20000);
});

// Minimal hook scheduler executes actual drawer effects and cancellation paths.
function drawer(app, { file = 'pages/components/TemplateDetailsDrawer.tsx', refine = {} } = {}) {
    const slots = [], pending = [], queries = [];
    let cursor = 0, expectedHooks;
    const different = (a, b) => !a || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
    const react = {
        useState(initial) {
            const i = cursor++;
            if (!slots[i]) slots[i] = { value: initial };
            return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
        },
        useMemo(fn, deps) {
            const i = cursor++;
            if (different(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() };
            return slots[i].value;
        },
        useEffect(fn, deps) {
            const i = cursor++;
            if (different(slots[i]?.deps, deps)) pending.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
        },
    };
    app.sectionsQuery = { data: { data: [] }, isLoading: false, error: null, isPreviousData: false };
    app.bindings.react = { default: react, ...react };
    app.bindings['react/jsx-runtime'] = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    app.bindings['@refinedev/core'] = { useApiUrl: () => base, useList: options => { queries.push(options); return app.sectionsQuery; }, ...refine };
    const component = app.load(file).default;
    return {
        queries,
        render(template) {
            cursor = 0;
            const tree = component({ template, onClose() {} });
            if (expectedHooks !== undefined) assert.equal(cursor, expectedHooks, 'Hook order must remain stable');
            expectedHooks = cursor;
            pending.splice(0).forEach(effect => effect());
            return tree;
        },
    };
}
function text(tree) {
    if (Array.isArray(tree)) return tree.map(text).join(' ');
    if (tree && typeof tree === 'object') return text(tree.props?.children);
    return typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
const template = (id = 11, template_type = 'INSPECCION') => ({ id, template_type, name: 'Offline template', version: 1, model_id: 1, is_published: true });
const settle = () => new Promise(resolve => setImmediate(resolve));

test('drawer waits for a template, retains hook order and distinguishes invalid selection', async () => {
    const app = fixture(), ui = drawer(app);
    assert.equal(ui.render(null), null);
    assert.equal(ui.queries.at(-1).queryOptions.enabled, false);
    assert.match(text(ui.render(template(0))), /identificador.*no es válido/);
    assert.equal(app.calls.length, 0);
    assert.match(text(ui.render(template())), /no tiene secciones/);
    assert.equal(ui.queries.at(-1).queryOptions.enabled, true);
});
test('drawer renders inspection fields without task minute labels', async () => {
    const app = fixture(), ui = drawer(app), selected = template();
    app.sectionsQuery.data.data = [section()];
    app.respond(() => new Response(JSON.stringify([point()])));
    ui.render(selected); await settle();
    const output = text(ui.render(selected));
    assert.match(output, /Revisar ajuste/);
    assert.match(output, /Según checklist/);
    assert.match(output, /Verificar fijación/);
    assert.match(output, /puntos de inspección/);
    assert.doesNotMatch(output, / min/);
});
test('drawer renders normal task title/code/minutes using the original task endpoint', async () => {
    const app = fixture(), ui = drawer(app), selected = template(11, 'MANTENIMIENTO');
    app.sectionsQuery.data.data = [section()];
    app.respond(() => new Response(JSON.stringify([task()])));
    ui.render(selected); await settle();
    assert.match(text(ui.render(selected)), /Normal task.*A01.*15\s+min/);
    assert.equal(app.calls[0][0], base + '/tasks?section_id=7');
});
test('drawer settles HTTP errors with an error message, never a false empty state', async () => {
    const app = fixture(), ui = drawer(app), selected = template();
    app.sectionsQuery.data.data = [section()];
    app.respond(() => new Response('{"error":"Puntos no disponibles"}', { status: 404 }));
    ui.render(selected); await settle();
    const output = text(ui.render(selected));
    assert.match(output, /Error cargando actividades:.*Puntos no disponibles/);
    assert.doesNotMatch(output, /Sin puntos/);
});
test('drawer does not reuse a stale response when the template changes during loading', async () => {
    const app = fixture(), ui = drawer(app);
    let releaseOld;
    const oldGate = new Promise(resolve => { releaseOld = resolve; });
    app.respond(async url => {
        if (url.endsWith('=7')) { await oldGate; return new Response(JSON.stringify([{ ...point(), revision_point: 'OLD result' }])); }
        return new Response(JSON.stringify([{ ...point(222, 8), revision_point: 'NEW result' }]));
    });
    app.sectionsQuery.data = { data: [section()] };
    ui.render(template());
    app.sectionsQuery.data = { data: [section(8, 12)] };
    ui.render(template(12)); await settle();
    releaseOld(); await settle();
    const output = text(ui.render(template(12)));
    assert.match(output, /NEW result/);
    assert.doesNotMatch(output, /OLD result/);
});

function nodes(tree, type) {
    if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, type));
    if (!tree || typeof tree !== 'object') return [];
    return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
}
test('task builder waits for template type and section membership before enabling child queries', async () => {
    const app = fixture(), queries = [];
    let templates = [], sections = [];
    app.bindings['@dnd-kit/core'] = { useSensor() {}, useSensors() {} };
    app.bindings['@dnd-kit/sortable'] = {};
    app.bindings['@dnd-kit/utilities'] = {};
    app.bindings['@mui/material'] = {};
    app.bindings.xlsx = {};
    const mutation = () => ({ mutate() {} });
    const ui = drawer(app, { file: 'pages/TemplateTasksBuilder.tsx', refine: {
        useCreate: mutation, useUpdate: mutation, useDelete: mutation, useCustomMutation: mutation,
        useList(options) {
            queries.push(options);
            return { data: { data: options.resource === 'templates' ? templates : options.resource === 'sections' ? sections : [] }, isLoading: false };
        },
    } });
    let tree = ui.render();
    assert.equal(queries.findLast(q => q.resource === 'sections').queryOptions.enabled, false);
    nodes(tree, 'select')[0].props.onChange({ target: { value: '11' } });
    tree = ui.render();
    assert.equal(queries.findLast(q => q.resource === 'sections').queryOptions.enabled, false, 'Template data not loaded yet');
    templates = [template(), template(12, 'ENSAMBLE')]; sections = [section()];
    tree = ui.render();
    nodes(tree, 'select')[1].props.onChange({ target: { value: '7' } });
    tree = ui.render();
    assert.equal(queries.at(-1).resource, 'quality/template_task_inspection');
    assert.equal(queries.at(-1).queryOptions.enabled, true);
    nodes(tree, 'select')[0].props.onChange({ target: { value: '12' } });
    ui.render();
    assert.equal(queries.at(-1).queryOptions.enabled, false, 'Previous template section cannot be reused');
    await settle();
});

function builderActions(app, selected = 11) {
    const source = readFileSync(path.join(root, 'pages/TemplateTasksBuilder.tsx'), 'utf8');
    const ast = ts.createSourceFile('builder.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const names = ['clonacionDePlantilla', 'handleFileUpload'], declarations = [];
    function visit(node) {
        if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(ast)))) declarations.push(node.getText(ast));
        ts.forEachChild(node, visit);
    }
    visit(ast);
    const messages = [], loading = [], effects = [];
    const context = vm.createContext({
        exports: {}, API10_URL: base, templateId2: selected, sectionId: 7,
        ...app.load('services/catalogQueries.ts'), ...app.load('services/apiResponse.ts'),
        axios: app.load('services/apiTransport.ts').apiAxios,
        alert: message => messages.push(message), console: { log() {}, error() {} },
        setIsCloning: value => loading.push(value), setClonedTemplate() {}, setClonedSections() {}, setClonedTasks() {}, setSelectedModelId() {},
        refetch() { effects.push('refetch'); }, handleFileDialogClose() { effects.push('close'); },
        XLSX: { read: () => ({ SheetNames: ['sheet'], Sheets: { sheet: {} } }), utils: { sheet_to_json: () => [
            ['punto de revisión', 'nueva especificación', 'sugerencia', 'categoría'], ['Offline point', 'Spec', 'Suggestion', 'Category'],
        ] } },
    });
    vm.runInContext(ts.transpileModule(declarations.join('\n') + '\nexports.actions={' + names.join(',') + '};', {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    return { actions: context.exports.actions, messages, loading, effects };
}
test('clone read rejects a missing template or an invalid section before child requests', async () => {
    const app = fixture();
    await builderActions(app, null).actions.clonacionDePlantilla();
    assert.equal(app.calls.length, 0);
    app.respond(input => new Response(JSON.stringify(input.url.includes('/templates/') ? template() : [section(0)])));
    const ui = builderActions(app);
    await ui.actions.clonacionDePlantilla();
    assert.equal(app.calls.length, 2);
    assert.equal(ui.loading.at(-1), false);
    assert.ok(ui.messages.some(message => /Error al clonar/.test(message)));
});
test('clone read selects inspection points and settles HTTP failure without success', async () => {
    const app = fixture(), ui = builderActions(app);
    app.respond(input => input.url.includes('/templates/') ? new Response(JSON.stringify(template())) :
        input.url.includes('/sections?') ? new Response(JSON.stringify([section()])) : new Response('{"error":"not found"}', { status: 404 }));
    await ui.actions.clonacionDePlantilla();
    assert.ok(app.calls[2][0].url.includes('/quality/template_task_inspection?section_id=7'));
    assert.equal(ui.loading.at(-1), false);
    assert.ok(ui.messages.some(message => /Error al clonar/.test(message)));
});
for (const status of [201, 400]) test('inspection XLSX preserves payload and only reports success for HTTP ' + status, async () => {
    const app = fixture(), ui = builderActions(app);
    app.respond(() => new Response('{}', { status }));
    await ui.actions.handleFileUpload({ target: { files: [{ arrayBuffer: async () => new ArrayBuffer(0) }] } });
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0][0], base + '/quality/template_task_inspection');
    assert.deepEqual(JSON.parse(app.calls[0][1].body), { section_id: 7, revision_point: 'Offline point', specs: 'Spec', suggestions: 'Suggestion', category: 'Category', position: 1 });
    assert.equal(ui.effects.includes('refetch'), status === 201);
    assert.equal(ui.messages.some(message => /correctamente/.test(message)), status === 201);
});

const technician = (id, puesto = 'Operador de producción', estatus = 'Activo') => ({ id, puesto, estatus, nombre_tecnico: 'Offline operator ' + id, correo_tecnico: `operator${id}@example.invalid`, sucursal: 'Offline', telefono: '', nombre_bonos: '' });
test('TEST production roster uses API27 and only active production operators, with no forced count', async () => {
    const app = fixture();
    app.respond(() => new Response(JSON.stringify([technician(1), technician(2, 'Supervisor de calidad'), technician(3, 'Operador de producción', 'Inactivo'), technician(4)])));
    const rows = await app.load('services/productionTechnicians.ts').getProductionTechnicians();
    assert.deepEqual(Array.from(rows, row => row.id), [1, 4]);
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0][0], base + '/quality/inspectors');
    assert.equal(app.calls[0][1].redirect, 'error');
});
test('roster HTTP 400/403/404, malformed rows and network failures never fall back to API5', async () => {
    const app = fixture(), service = app.load('services/productionTechnicians.ts');
    for (const status of [400, 403, 404]) {
        app.respond(() => new Response('{"error":"Roster not available"}', { status }));
        await assert.rejects(service.getProductionTechnicians(), error => error.statusCode === status);
    }
    for (const rows of [{ data: [] }, [{ ...technician(1), correo_tecnico: null }]]) {
        app.respond(() => new Response(JSON.stringify(rows)));
        await assert.rejects(service.getProductionTechnicians(), error => error.statusCode === 502);
    }
    app.respond(() => { throw new Error('offline'); });
    await assert.rejects(service.getProductionTechnicians(), error => error.statusCode === 0);
    assert.ok(app.calls.every(([url]) => url === base + '/quality/inspectors'));
});
test('production keeps its original API5 roster and local remains disconnected from API5', async () => {
    const app = fixture({ env: { VITE_APP_ENV: 'production', VITE_API10_URL: 'https://production.invalid/api10', VITE_API5_ENABLED: 'true', VITE_API5_URL: 'https://production.invalid/api5' } });
    app.respond(() => new Response(JSON.stringify([technician(1, 'Técnico de Campo')])));
    const rows = await app.load('services/productionTechnicians.ts').getProductionTechnicians();
    assert.equal(rows[0].puesto, 'Técnico de Campo');
    assert.equal(app.calls[0][0], 'https://production.invalid/api5/tecnicos');
    const local = fixture({ env: { VITE_APP_ENV: 'local', VITE_API10_URL: 'http://localhost:3010/api10' } });
    assert.equal((await local.load('services/productionTechnicians.ts').getProductionTechnicians()).length, 0);
    assert.equal(local.calls.length, 0);
});

function creationRosterEffect(app, type, isTest = true) {
    const source = readFileSync(path.join(root, 'pages/CreateWorkOrderFromTemplate.tsx'), 'utf8');
    const ast = ts.createSourceFile('creation.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let effect;
    function visit(node) {
        if (!effect && ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') effect = node.arguments[0].getText(ast);
        ts.forEachChild(node, visit);
    }
    visit(ast);
    const state = { loading: false, error: null, rows: [], api5Calls: 0, firebaseReads: 0, assignment: { assigned_tech_email: 'previous@example.invalid', tech_support: 'previous@example.invalid' } };
    const context = vm.createContext({ exports: {}, IS_TEST: isTest, __env: { VITE_APP_ENV: isTest ? 'test' : 'production' }, form: { template_type: type },
        getProductionTechnicians: app.load('services/productionTechnicians.ts').getProductionTechnicians,
        getApi5Technicians: async () => { state.api5Calls++; return [technician(99, 'Técnico de Campo')]; },
        fetchUsuarios: async () => { state.firebaseReads++; },
        setForm: update => { state.assignment = update(state.assignment); },
        setLoadingTechs: value => { state.loading = value; }, setTechsError: value => { state.error = value; }, setTechs: value => { state.rows = value; },
    });
    vm.runInContext(ts.transpileModule(('exports.effect=' + effect + ';').replaceAll('import.meta.env', '__env'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    context.exports.effect();
    return state;
}
for (const type of ['', 'INSTALACION', 'MANTENIMIENTO', 'ENSAMBLE']) test('creation roster chooses a demonstrated source for ' + (type || 'no template'), async () => {
    const app = fixture();
    app.respond(() => new Response(JSON.stringify([technician(1)])));
    const state = creationRosterEffect(app, type);
    await settle();
    assert.equal(state.loading, false);
    assert.equal(state.api5Calls, 0);
    assert.equal(state.firebaseReads, 0);
    assert.equal(state.assignment.assigned_tech_email, '');
    assert.equal(state.assignment.tech_support, '');
    assert.equal(app.calls.length, type === 'ENSAMBLE' ? 1 : 0);
    assert.equal(state.rows.length, type === 'ENSAMBLE' ? 1 : 0);
    assert.equal(!!state.error, !!type && type !== 'ENSAMBLE');
});
test('production creation keeps its prior technician read and Firebase read branch with mocks', async () => {
    const app = fixture();
    const state = creationRosterEffect(app, 'INSTALACION', false);
    await settle();
    assert.equal(state.loading, false);
    assert.equal(state.api5Calls, 1);
    assert.equal(state.firebaseReads, 1);
    assert.equal(state.assignment.assigned_tech_email, 'previous@example.invalid');
    assert.equal(app.calls.length, 0);
});
