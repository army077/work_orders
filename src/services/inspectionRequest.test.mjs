// Frontend and local contract checks: fake HTTP, fake SQL, no API or DB connections.
import test, { after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import axios from 'axios';

mock.method(globalThis, 'fetch', () => assert.fail('Real HTTP forbidden'));
after(() => mock.restoreAll());
const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'https://test.invalid/configured-service';
const type = 'Inspección de ensamble';
const inspection = (patch = {}) => ({ id: 98, work_order_id: 41, inspection_type: type, status: 'PENDING', estacion: null, ...patch });
const summary = (patch = {}) => ({ inspection_order_id: 98, work_order_id: 41, inspection_type: type, status: 'PENDING', ...patch });
const compiled = new Map();

function fixture(env = {}) {
    const calls = [], cache = new Map();
    let respond = () => Response.json({ inspection_order: inspection() }, { status: 201 });
    const app = { calls, bindings: {}, refreshes: 0, queries: [] };
    app.onRefetch = async () => ({ isError: false });
    app.query = { data: { data: [] }, isLoading: false, isFetching: false, isError: false,
        refetch: async () => { app.refreshes++; return app.onRefetch(); } };
    app.respond = fn => { respond = fn; };
    const sandbox = vm.createContext({
        URL, Request, Response, Error, AbortSignal,
        __env: { VITE_APP_ENV: 'production', VITE_API10_URL: base, VITE_API5_ENABLED: 'false', ...env },
        fetch: async (...args) => { calls.push(args); return respond(...args); },
    });
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
    app.service = () => app.load('services/inspectionRequest.ts');
    return app;
}

test('request sends exactly order ID and assembly type, omitting station and template', async () => {
    const app = fixture();
    const result = await app.service().requestAssemblyInspection(41);
    assert.equal(result.id, 98);
    assert.equal(app.calls.length, 1);
    const [url, init] = app.calls[0];
    assert.equal(url, base + '/quality/inspection/request');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), { work_order_id: 41, inspection_type: type });
    assert.ok(init.signal instanceof AbortSignal);
});

test('TEST request retains API27 destination and redirect protection', async () => {
    const testBase = 'https://desarrollotecnologicoar.com/api27';
    const app = fixture({ VITE_APP_ENV: 'test', VITE_API10_URL: testBase });
    await app.service().requestAssemblyInspection(41);
    assert.equal(app.calls[0][0], testBase + '/quality/inspection/request');
    assert.equal(app.calls[0][1].redirect, 'error');
});

test('invalid order IDs never send a request', async () => {
    const app = fixture();
    for (const id of [undefined, null, 0, -1, NaN, Infinity, 1.5, 2147483648]) {
        await assert.rejects(app.service().requestAssemblyInspection(id));
    }
    assert.equal(app.calls.length, 0);
});

for (const [status, detail, expected] of [
    [404, 'No existe una plantilla de INSPECCION publicada', /plantilla de inspección compatible/],
    [409, 'inspection_order already exists', /inspección activa/],
    [409, 'Configuración ambigua: más de una plantilla', /configuración ambigua/],
    [422, 'No se encontraron tareas de inspección', /puntos de inspección válidos/],
    [403, 'Acceso denegado', /Acceso denegado/],
    [500, 'Error en servidor', /Error en servidor/],
]) test('HTTP ' + status + ': ' + detail + ' propagates without retry', async () => {
    const app = fixture();
    app.respond(() => Response.json({ error: detail }, { status }));
    await assert.rejects(app.service().requestAssemblyInspection(41), e => {
        assert.equal(e.statusCode, status);
        assert.match(e.message, expected);
        assert.ok(e.message.includes(detail));
        return true;
    });
    assert.equal(app.calls.length, 1);
});

test('network, timeout and malformed success responses never confirm creation or retry POST', async () => {
    for (const respond of [
        () => { throw new Error('offline'); },
        () => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; },
        () => Response.json({ inspection_order: inspection({ work_order_id: 42 }) }, { status: 201 }),
        () => Response.json({ inspection_order: inspection({ inspection_type: 'Inspección de pintura' }) }, { status: 201 }),
        () => Response.json({ inspection_order: inspection({ id: null }) }, { status: 201 }),
        () => Response.json({ inspection_order: inspection({ status: 'FINISHED' }) }, { status: 201 }),
        () => Response.json({ inspection_order: inspection() }),
    ]) {
        const app = fixture(); app.respond(respond);
        await assert.rejects(app.service().requestAssemblyInspection(41));
        assert.equal(app.calls.length, 1);
    }
});

function control(app) {
    const slots = [];
    let cursor = 0;
    app.bindings.react = {
        useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
        useState(initial) {
            const i = cursor++; slots[i] ??= { value: initial };
            return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
        },
    };
    app.bindings['react/jsx-runtime'] = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    app.bindings['@mui/material'] = new Proxy({}, { get: (_, name) => name });
    app.bindings['@refinedev/core'] = { useList: options => { app.queries.push(options); return app.query; } };
    const component = app.load('pages/components/ProductionInspectionRequest.tsx').default;
    return { render(props = { workOrderId: 41 }) { cursor = 0; return component(props); } };
}
function nodes(tree, type) {
    if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, type));
    if (!tree || typeof tree !== 'object') return [];
    return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
}
function text(tree) {
    if (Array.isArray(tree)) return tree.map(text).join(' ');
    return tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
const requestButton = tree => nodes(tree, 'Button')[0];

test('double click creates once, confirms only after HTTP success, and refreshes the Quality resource', async () => {
    const app = fixture(), ui = control(app);
    let resolve;
    app.respond(() => new Promise(done => { resolve = done; }));
    const submit = requestButton(ui.render()).props.onClick;
    const first = submit(), second = submit();
    assert.equal(app.calls.length, 1);
    assert.equal(requestButton(ui.render()).props.disabled, true);
    assert.equal(nodes(ui.render(), 'Alert').length, 0);
    resolve(Response.json({ inspection_order: inspection() }, { status: 201 }));
    await Promise.all([first, second]);
    assert.match(text(ui.render()), /Inspección de ensamble #98 solicitada para la orden #41/);
    assert.equal(app.refreshes, 1);
    assert.equal(app.queries.at(-1).resource, 'quality/inspection/orders_all?include=tasks');
    assert.equal(requestButton(ui.render()).props.disabled, true, 'Confirmed creation remains protected even before the list catches up');
    await requestButton(ui.render()).props.onClick();
    assert.equal(app.calls.length, 1);
});

for (const status of ['PENDING', 'IN_PROGRESS']) test('existing ' + status + ' assembly inspection prevents another POST', async () => {
    const app = fixture(); app.query.data.data = [summary({ status })];
    const ui = control(app);
    assert.equal(requestButton(ui.render()).props.disabled, true);
    assert.match(text(ui.render()), /inspección de ensamble activa #\s*98/);
    await requestButton(ui.render()).props.onClick();
    assert.equal(app.calls.length, 0);
});

test('other orders, other types and terminal inspections do not block the selected order', async () => {
    const app = fixture();
    app.query.data.data = [summary({ work_order_id: 42 }), summary({ inspection_type: 'Inspección de pintura' }),
        summary({ status: 'FINISHED' }), summary({ status: 'CANCELED' }),
        summary({ work_order_id: null, inspection_type: null, status: null })];
    const ui = control(app);
    assert.equal(requestButton(ui.render()).props.disabled, false);
    await requestButton(ui.render()).props.onClick();
    assert.equal(JSON.parse(app.calls[0][1].body).work_order_id, 41);
});

for (const query of [
    { isLoading: true }, { isFetching: true }, { isError: true }, { data: undefined },
    { data: { data: {} } }, { data: { data: [null] } }, { data: { data: [{ id: 98 }] } },
]) test('unverified inspection list prevents POST: ' + JSON.stringify(query), async () => {
    const app = fixture(); Object.assign(app.query, query);
    const ui = control(app);
    assert.equal(requestButton(ui.render()).props.disabled, true);
    await requestButton(ui.render()).props.onClick();
    assert.equal(app.calls.length, 0);
});

test('parent disable prevents overlapping submission while production is saving', async () => {
    const app = fixture(), ui = control(app);
    const tree = ui.render({ workOrderId: 41, disabled: true });
    assert.equal(requestButton(tree).props.disabled, true);
    await requestButton(tree).props.onClick();
    assert.equal(app.calls.length, 0);
});

test('409 refresh discovers the active inspection and never reports creation success', async () => {
    const app = fixture(), ui = control(app);
    app.respond(() => Response.json({ error: 'inspection_order already exists' }, { status: 409 }));
    app.onRefetch = async () => { app.query.data.data = [summary()]; return { isError: false }; };
    await requestButton(ui.render()).props.onClick();
    assert.match(text(ui.render()), /Existe una inspección activa/);
    assert.match(text(ui.render()), /inspección de ensamble activa #\s*98/);
    assert.doesNotMatch(text(ui.render()), /solicitada para la orden/);
    assert.equal(requestButton(ui.render()).props.disabled, true);
    assert.equal(app.calls.length, 1);
});

test('saved inspection stays protected when refresh fails, with a separate warning', async () => {
    const app = fixture(), ui = control(app);
    app.onRefetch = async () => ({ isError: true, error: new Error('read failed') });
    await requestButton(ui.render()).props.onClick();
    assert.match(text(ui.render()), /Inspección #98 solicitada.*No se pudo actualizar/);
    assert.equal(nodes(ui.render(), 'Alert').at(-1).props.severity, 'warning');
    assert.equal(requestButton(ui.render()).props.disabled, true);
    assert.equal(app.calls.length, 1);
});

// Read-only execution of the actual local handlers, with every SQL call replaced.
const { prepareValue } = createRequire(import.meta.url)('pg/lib/utils.js');
const qualitySource = readFileSync(new URL('../../context/api10/routes/quality.js', import.meta.url), 'utf8');
function localContract(options = {}) {
    const calls = [], routes = new Map();
    let released = 0;
    const client = {
        release() { released++; },
        async query(sql, values = []) {
            const query = sql.replace(/\s+/g, ' ').trim(); calls.push({ query, values });
            if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(query)) return { rows: [] };
            if (query.startsWith('SELECT * FROM work_order ')) return { rows: options.noOrder ? [] : [{ id: 41, model_id: 11 }] };
            if (query.startsWith('SELECT * FROM inspection_order ')) return { rows: options.active ? [inspection()] : [] };
            if (query.startsWith('SELECT mt.*')) return { rows: options.templates ?? [{ id: 22, model_id: 11 }] };
            if (query.startsWith('INSERT INTO inspection_order (')) return { rows: [inspection({ estacion: prepareValue(values[3]) })] };
            if (query.startsWith('SELECT * FROM template_section ')) return { rows: [{ id: 23, title: type }] };
            if (query.startsWith('SELECT * FROM template_task_inspection ')) return { rows: options.points ?? [{ id: 24 }] };
            if (query.startsWith('INSERT INTO inspection_order_task ')) return { rows: [] };
            if (query.startsWith('SELECT work_order_id, inspection_type')) return { rows: [{ work_order_id: 41, inspection_type: type }] };
            if (query.startsWith('SELECT status FROM ')) return { rows: [{ status: 'DONE' }] };
            if (query.startsWith('UPDATE work_order_task ')) return { rows: [{ id: 701, status: 'DONE' }] };
            if (query.startsWith('WITH clock AS ')) return { rows: [inspection({ status: 'FINISHED' })] };
            assert.fail('Unexpected SQL: ' + query);
        },
    };
    const router = {};
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) router[method] = (route, handler) => routes.set(method + ' ' + route, handler);
    const sandbox = vm.createContext({ module: { exports: {} }, console: { log() {}, error() {} },
        require(name) {
            if (name === 'express') return { Router: () => router };
            if (name === '../db') return { connect: async () => client };
            assert.fail('Unexpected backend dependency: ' + name);
        } });
    vm.runInContext(qualitySource, sandbox);
    return { calls, get released() { return released; }, async invoke(route, body = {}, params = {}) {
        const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await routes.get(route)({ body, params }, response);
        return response;
    } };
}

for (const body of [{ work_order_id: 41, inspection_type: type }, { work_order_id: 41, inspection_type: type, estacion: null }]) {
    test('actual local request accepts station ' + ('estacion' in body ? 'null' : 'omitted') + ' and pg prepares SQL NULL', async () => {
        const api = localContract();
        const response = await api.invoke('post /inspection/request', body);
        assert.equal(response.code, 201);
        assert.equal(response.body.inspection_order.estacion, null);
        const insert = api.calls.find(call => call.query.startsWith('INSERT INTO inspection_order ('));
        assert.equal(insert.values[3], body.estacion);
        assert.equal(prepareValue(insert.values[3]), null);
        assert.ok(api.calls.some(call => call.query === 'COMMIT'));
        assert.equal(api.released, 1);
    });
}

test('local route forwards zero and negative station integers without a positivity check', async () => {
    for (const estacion of [0, -1, 42]) {
        const api = localContract();
        const response = await api.invoke('post /inspection/request', { work_order_id: 41, inspection_type: type, estacion });
        assert.equal(response.code, 201);
        assert.equal(api.calls.find(call => call.query.startsWith('INSERT INTO inspection_order (')).values[3], estacion);
    }
    const schema = readFileSync(new URL('../../context/database/create tables.sql', import.meta.url), 'utf8');
    const table = schema.slice(schema.indexOf('CREATE TABLE "inspection_order"'), schema.indexOf('CREATE TABLE "inspection_order_task"'));
    assert.match(table, /"estacion" INTEGER NULL DEFAULT NULL/);
    assert.doesNotMatch(table, /CHECK|FOREIGN KEY \("estacion"\)/);
});

for (const [options, status] of [[{ noOrder: true }, 404], [{ active: true }, 409], [{ templates: [] }, 404],
    [{ templates: [{ id: 22 }, { id: 23 }] }, 409], [{ points: [] }, 422]]) {
    test('local contract retains dependent validation HTTP ' + status + ': ' + JSON.stringify(options), async () => {
        const api = localContract(options);
        const response = await api.invoke('post /inspection/request', { work_order_id: 41, inspection_type: type });
        assert.equal(response.code, status);
        assert.ok(api.calls.some(call => call.query === 'ROLLBACK'));
        assert.equal(api.calls.some(call => call.query === 'COMMIT'), false);
    });
}

test('actual release and finish handlers succeed without reading or requiring station', async () => {
    for (const [route, params, body] of [
        ['put /liberar_orden/:id', { id: '41' }, { inspection_order_id: 98, section_title: type, finished_at: '2026-11-05T12:00:00Z' }],
        ['put /:id/insp_end', { id: '98' }, {}],
    ]) {
        const api = localContract();
        const response = await api.invoke(route, body, params);
        assert.equal(response.code, 200);
        assert.equal(api.calls.some(call => /estacion/.test(call.query)), false);
        assert.ok(api.calls.some(call => call.query === 'COMMIT'));
    }
});
