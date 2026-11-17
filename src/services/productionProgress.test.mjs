// Actual frontend modules and event handlers; HTTP is simulated throughout.
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
const base = 'https://test.invalid/configured-api';
const compiled = new Map();
const task = (patch = {}) => ({ id: 701, work_order_id: 41, code: 'ENS001', task_title: 'Montar equipo',
    section_title: 'Ensamble', position: 1, status: 'PENDIENTE', started_at: null, finished_at: null, actual_minutes: null, ...patch });
const template = { id: 11, template_type: 'ENSAMBLE', name: 'Ensamble de prueba' };
const technician = { id: 9, nombre_tecnico: 'Operador de prueba', correo_tecnico: 'operator@test.invalid', estatus: 'Activo',
    puesto: 'Operador de producción', sucursal: 'Prueba' };
const order = (tasks = [task()]) => ({ id: 41, template_id: 11, status: 'OPEN', assigned_tech_email: technician.correo_tecnico, tasks });

function fixture(env = {}) {
    const calls = [], cache = new Map();
    const app = { calls, bindings: {}, orders: [order()], refreshes: 0, refreshError: false };
    let respond = (url, init) => {
        if (url.endsWith('/quality/inspectors')) return Response.json([technician]);
        if (url.includes('/customs/')) return Response.json([]);
        if (init?.method === 'PUT') {
            const updated = { ...app.orders[0].tasks[0], ...JSON.parse(init.body) };
            app.orders[0] = { ...app.orders[0], tasks: [updated] };
            return Response.json({ task: updated });
        }
        return Response.json(app.orders[0]);
    };
    app.respond = fn => { respond = fn; };
    const sandbox = vm.createContext({
        URL, Request, Response, Error, AbortSignal, AbortController, DOMException,
        __env: { VITE_APP_ENV: 'production', VITE_API10_URL: base, VITE_API5_ENABLED: 'false', ...env },
        console: { log() {}, error() {} },
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
    app.service = () => app.load('services/productionProgress.ts');
    return app;
}

test('DONE uses the materialized task ID, configured API and explicit-zone dates; omitted minutes stay unchanged', async () => {
    const app = fixture();
    const result = await app.service().completeProductionTask(order(), 701, 'ENSAMBLE');
    assert.equal(result.id, 701);
    assert.equal(app.calls.length, 1);
    const [url, init] = app.calls[0], body = JSON.parse(init.body);
    assert.equal(url, base + '/work-orders/701/stavance');
    assert.equal(init.method, 'PUT');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(Object.keys(body).sort(), ['finished_at', 'started_at', 'status']);
    assert.equal(body.status, 'DONE');
    assert.match(body.finished_at, /T.*Z$/);
    assert.equal(body.started_at, body.finished_at);
    assert.ok(init.signal instanceof AbortSignal);
});

test('existing start is preserved, and explicit zero or positive integer minutes are sent', async () => {
    for (const minutes of [0, 17]) {
        const app = fixture();
        await app.service().completeProductionTask(order([task({ started_at: '2026-11-01T08:00:00-06:00' })]), 701, 'ENSAMBLE', minutes);
        const body = JSON.parse(app.calls[0][1].body);
        assert.equal('started_at' in body, false);
        assert.equal(body.actual_minutes, minutes);
    }
});

test('TEST progress uses API27 with redirect protection and never falls back to API10', async () => {
    const testBase = 'https://desarrollotecnologicoar.com/api27';
    const app = fixture({ VITE_APP_ENV: 'test', VITE_API10_URL: testBase });
    await app.service().completeProductionTask(order(), 701, 'ENSAMBLE');
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0][0], testBase + '/work-orders/701/stavance');
    assert.equal(app.calls[0][1].redirect, 'error');
});

for (const [label, selectedOrder, id, type, minutes] of [
    ['LIB001', order([task({ code: 'LIB001' })]), 701, 'ENSAMBLE'],
    ['LIB002 normalized', order([task({ code: ' lib002 ' })]), 701, 'ENSAMBLE'],
    ['already DONE', order([task({ status: 'DONE' })]), 701, 'ENSAMBLE'],
    ['another order', order([task({ work_order_id: 42 })]), 701, 'ENSAMBLE'],
    ['template task ID', order(), 91, 'ENSAMBLE'],
    ['inspection template', order(), 701, 'INSPECCION'],
    ['missing task list', { id: 41 }, 701, 'ENSAMBLE'],
    ['invalid ID', order(), 0, 'ENSAMBLE'],
    ['negative minutes', order(), 701, 'ENSAMBLE', -1],
    ['fractional minutes', order(), 701, 'ENSAMBLE', 1.5],
    ['nonfinite minutes', order(), 701, 'ENSAMBLE', NaN],
    ['integer overflow', order(), 701, 'ENSAMBLE', 2147483648],
]) test(label + ' is rejected before HTTP', async () => {
    const app = fixture();
    await assert.rejects(app.service().completeProductionTask(selectedOrder, id, type, minutes));
    assert.equal(app.calls.length, 0);
});

for (const status of [400, 401, 403, 404, 409, 422, 500]) test('HTTP ' + status + ' remains a failure with backend detail and no retry', async () => {
    const app = fixture();
    app.respond(() => Response.json({ error: 'Operación rechazada' }, { status }));
    await assert.rejects(app.service().completeProductionTask(order(), 701, 'ENSAMBLE'), e =>
        e.statusCode === status && app.service().productionErrorMessage(e) === 'Operación rechazada');
    assert.equal(app.calls.length, 1);
});

test('network failure and mismatched success bodies never confirm completion', async () => {
    for (const respond of [() => { throw new Error('offline'); },
        () => Response.json({ task: task({ id: 702, status: 'DONE' }) }),
        () => Response.json({ task: task({ work_order_id: 42, status: 'DONE' }) }),
        () => Response.json({ task: task() })]) {
        const app = fixture();
        app.respond(respond);
        await assert.rejects(app.service().completeProductionTask(order(), 701, 'ENSAMBLE'));
        assert.equal(app.calls.length, 1);
    }
});

// Minimal hook scheduler, following the existing frontend test suites.
function panel(app) {
    const slots = [], pending = [];
    let cursor = 0;
    const react = {
        useState(initial) {
            const i = cursor++;
            slots[i] ??= { value: initial };
            return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
        },
        useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
        useMemo(fn) { cursor++; return fn(); },
        useEffect(fn) { const i = cursor++; if (!slots[i]) { slots[i] = {}; pending.push(fn); } },
    };
    app.bindings.react = { default: react, ...react };
    app.bindings['react/jsx-runtime'] = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    app.bindings['@mui/material'] = new Proxy({}, { get: (_, name) => name });
    for (const name of ['react-icons/md', 'react-icons/fa6', 'react-icons/io5', 'react-icons/bs']) app.bindings[name] = {};
    for (const name of ['@mui/icons-material/LocalAtmOutlined', './Bonds', './ProductionHistory']) app.bindings[name] = { default: 'OtherPanel' };
    app.bindings['./components/ProductionInspectionRequest'] = { default: 'InspectionRequestControl' };
    app.bindings['../services/productionTechnicians'] = { getProductionTechnicians: async () => [technician] };
    app.bindings['@refinedev/core'] = {
        useCustom: () => ({ data: { data: app.orders }, refetch: async () => {
            app.refreshes++;
            return { isError: app.refreshError, error: app.refreshError ? new Error('refresh failed') : null };
        } }),
        useList: ({ resource }) => ({ data: { data: resource === 'templates' ? [template] : [] } }),
    };
    const component = app.load('pages/Plantel Producción.tsx').default;
    return { render() { cursor = 0; const tree = component(); pending.splice(0).forEach(fn => fn()); return tree; } };
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
const button = (tree, label) => nodes(tree, 'Button').find(node => text(node) === label);
const settle = () => new Promise(resolve => setImmediate(resolve));
async function openPanel(app) {
    const ui = panel(app);
    ui.render(); await settle();
    nodes(ui.render(), 'Card').find(node => node.props.onClick).props.onClick();
    await settle();
    return ui;
}

test('panel shows real task IDs, excludes releases, handles DONE without a date, and binds inspection to the selected order', async () => {
    const app = fixture();
    app.orders = [order([task(), task({ id: 702, code: 'LIB001' }), task({ id: 703, code: 'LIB002' }), task({ id: 704, status: 'DONE' })])];
    const ui = await openPanel(app), tree = ui.render();
    assert.equal(nodes(tree, 'Button').filter(node => text(node) === 'Marcar como completada').length, 1);
    assert.equal(nodes(tree, 'ListItemText').find(node => node.props.secondary.includes('Tarea #701')).props.primary, 'Montar equipo');
    assert.ok(nodes(tree, 'ListItemText').some(node => node.props.secondary.includes('Sin fecha registrada')));
    assert.equal(nodes(tree, 'InspectionRequestControl')[0].props.workOrderId, 41);
    assert.equal(app.calls.some(([, init]) => init?.method === 'POST'), false);
});

test('double click sends one PUT, disables actions during saving and refreshes detail and list after confirmation', async () => {
    const app = fixture(), ui = await openPanel(app);
    button(ui.render(), 'Marcar como completada').props.onClick();
    let release;
    app.respond((url, init) => init?.method === 'PUT'
        ? new Promise(resolve => { release = () => {
            const updated = task({ ...JSON.parse(init.body) }); app.orders = [order([updated])]; resolve(Response.json({ task: updated }));
        }; }) : Response.json(app.orders[0]));
    const confirm = button(ui.render(), 'Confirmar actividad completada').props.onClick;
    const first = confirm(), second = confirm();
    assert.equal(button(ui.render(), 'Guardando…').props.disabled, true);
    assert.equal(app.calls.filter(([, init]) => init?.method === 'PUT').length, 1);
    release(); await Promise.all([first, second]);
    const tree = ui.render();
    assert.equal(app.refreshes, 1);
    assert.equal(app.calls.filter(([url]) => url.includes('?include=tasks')).length, 2);
    assert.match(text(tree), /Actividad completada y datos actualizados/);
    assert.equal(button(tree, 'Marcar como completada'), undefined);
});

test('backend error is visible without success or refresh; the completion dialog stays available', async () => {
    const app = fixture(), ui = await openPanel(app);
    button(ui.render(), 'Marcar como completada').props.onClick();
    app.respond(() => Response.json({ error: 'Sin autorización para esta actividad' }, { status: 403 }));
    await button(ui.render(), 'Confirmar actividad completada').props.onClick();
    assert.match(text(ui.render()), /Sin autorización para esta actividad/);
    assert.doesNotMatch(text(ui.render()), /Actividad completada y datos actualizados/);
    assert.equal(app.refreshes, 0);
    assert.equal(button(ui.render(), 'Confirmar actividad completada').props.disabled, false);
});

test('invalid minutes in the confirmation dialog show validation without sending PUT', async () => {
    const app = fixture(), ui = await openPanel(app);
    button(ui.render(), 'Marcar como completada').props.onClick();
    nodes(ui.render(), 'TextField').find(node => node.props.label === 'Minutos reales (opcional)').props.onChange({ target: { value: '-2' } });
    await button(ui.render(), 'Confirmar actividad completada').props.onClick();
    assert.match(text(ui.render()), /Los minutos deben ser un entero/);
    assert.equal(app.calls.filter(([, init]) => init?.method === 'PUT').length, 0);
});

test('refresh failure preserves confirmed DONE and warns without inviting another completion', async () => {
    const app = fixture(), ui = await openPanel(app);
    button(ui.render(), 'Marcar como completada').props.onClick();
    app.refreshError = true;
    app.respond((url, init) => init?.method === 'PUT'
        ? Response.json({ task: task({ status: 'DONE' }) }) : Response.json({ error: 'No disponible' }, { status: 503 }));
    await button(ui.render(), 'Confirmar actividad completada').props.onClick();
    assert.match(text(ui.render()), /Actividad guardada.*No se pudieron actualizar/);
    assert.equal(button(ui.render(), 'Marcar como completada'), undefined);
});

test('failed order read displays its error without exposing previous order actions', async () => {
    const app = fixture(), ui = await openPanel(app);
    nodes(ui.render(), 'Dialog').find(node => node.props.open).props.onClose();
    app.respond(url => url.includes('/customs/') ? Response.json([]) : Response.json({ error: 'Orden no disponible' }, { status: 404 }));
    nodes(ui.render(), 'Card').find(node => node.props.onClick).props.onClick(); await settle();
    assert.match(text(ui.render()), /Orden no disponible/);
    assert.equal(button(ui.render(), 'Marcar como completada'), undefined);
});
