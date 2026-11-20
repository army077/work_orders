// Same TypeScript/VM and hook simulation used by the existing frontend suites.
// No HTTP or database connection: every request fails unless explicitly mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import axios from 'axios';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'https://desarrollotecnologicoar.com/api27';
const compiled = new Map();
function fixture(type = 'Inspección de ensamble') {
  const calls = [], cache = new Map(), slots = [], alerts = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const i = cursor++; slots[i] ??= { value: initial };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }];
    },
    useMemo(fn) { return fn(); },
    useEffect() {},
  };
  const app = { calls, alerts, queries: [],
    order: { id: 98, inspection_order_id: 98, work_order_id: 41, inspection_type: type,
      equipo: 'Equipo simulado', status: 'PENDING', created_at: '2026-11-13T12:00:00Z',
      estacion: null, assigned_tech_email: null,
      tasks: [{ id: 501, status: 'PENDING', revision_point: 'Punto simulado', section_title: type }] },
  };
  app.respond = () => assert.fail('Unconfigured mock request');
  const query = () => ({ data: { data: [app.order] }, isLoading: false, refetch: async () => query() });
  const bindings = {
    react: { default: hooks, ...hooks },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@mui/material': new Proxy({}, { get: (_, name) => name === 'useMediaQuery' ? () => false
      : name === 'useTheme' ? () => ({ breakpoints: { down: () => '(max-width:899.95px)' } }) : name }),
    '@mui/icons-material/Close': { default: 'CloseIcon' },
    '@refinedev/core': { useList: args => {
      if (args.resource === 'inspection-production-releases') {
        assert.equal(args.queryOptions.enabled, false);
        return { refetch: async () => ({}) };
      }
      app.queries.push(args); return query();
    } },
    './inspection-list.css': {},
    './inspection-detail.css': {},
    'react-icons/fa6': {}, 'react-icons/md': {},
    axios: { default: axios },
  };
  const sandbox = vm.createContext({ URL, Request, Response, Headers, Error, AbortSignal, AbortController, setTimeout, clearTimeout,
    __env: { VITE_APP_ENV: 'test', VITE_API10_URL: base, VITE_API5_ENABLED: 'false' },
    console: { log() {}, error() {} }, alert: text => alerts.push(text), window: { confirm: () => true },
    fetch: async (url, init) => {
      assert.ok(url.startsWith(base + '/'), 'Only mocked API27 is allowed');
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer MOCK_ONLY_ID_TOKEN');
      calls.push([url, init]); return app.respond(url, init);
    },
  });
  app.load = relative => {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename);
    if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(
      readFileSync(filename, 'utf8').replaceAll('import.meta.env', '__env'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText);
    const exports = {}; cache.set(filename, exports);
    const require = name => {
      if (name in bindings) return bindings[name];
      assert.ok(name.startsWith('.'), 'Unexpected dependency: ' + name);
      const target = path.resolve(path.dirname(filename), name);
      const resolved = ['.ts', '.tsx'].map(ext => target + ext).find(existsSync);
      assert.ok(resolved, 'Missing local test dependency: ' + name);
      return app.load(path.relative(root, resolved));
    };
    vm.runInContext(`(function(exports,require){${compiled.get(filename)}\n})`, sandbox)(exports, require);
    return exports;
  };
  app.panel = () => {
    const component = app.load('pages/Plantel Inspeccion.tsx').PlantelInspeccion;
    return { render() { cursor = 0; return component(); } };
  };
  // Exercise unchanged business callbacks with the optional session adapter enabled
  // only in this isolated test fixture, never in the application entry point.
  app.load('services/apiTransport.ts').setApi27TokenProvider(async () => 'MOCK_ONLY_ID_TOKEN');
  return app;
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
const button = (ui, label) => nodes(ui.render(), 'Button').find(node => text(node).includes(label));
function open(app) {
  const ui = app.panel(); nodes(ui.render(), 'Button').find(node => node.props['data-open-inspection'] === app.order.inspection_order_id).props.onClick(); return ui;
}

test('simulated order: real dataProvider creates and lists using API27, preserving payload and states', async () => {
  const app = fixture(), provider = app.load('dataProvider.ts').dataProvider;
  const payload = { template_id: 19, machine_serial: 'SIMULADA-SIN-RED', assigned_tech_email: 'operator@example.invalid' };
  app.respond = (url, init) => init?.method === 'POST'
    ? Response.json({ id: 41, ...JSON.parse(init.body), status: 'OPEN' }, { status: 201 })
    : Response.json([{ id: 41, ...payload, status: 'OPEN' }]);
  const created = await provider.create({ resource: 'work-orders', variables: { fromTemplate: true, payload } });
  const list = await provider.getList({ resource: 'work-orders' });
  assert.equal(created.data.id, 41);
  assert.equal(list.data[0].status, 'OPEN');
  assert.equal(app.calls[0][0], base + '/work-orders/from-template');
  assert.deepEqual(JSON.parse(app.calls[0][1].body), payload);
  assert.equal(app.calls[1][0], base + '/work-orders');
  assert.ok(app.calls.every(([, init]) => init.redirect === 'error'));
});

for (const [type, code] of [['Inspección de ensamble', 'LIB001'], ['Inspección de pintura', 'LIB002']]) {
  test(`simulated ${code}: assignment, point DONE, independent release and FINISHED through actual panel callbacks`, async () => {
    const app = fixture(type), ui = open(app);
    assert.ok(nodes(ui.render(), 'ListItemText').length > 0, 'Inspection points are rendered');
    assert.ok(app.queries.every(q => q.resource === 'quality/inspection/orders_all?include=tasks'));
    assert.equal(button(ui, 'Liberar sección').props.disabled, true);
    app.respond = (url, init) => {
      if (url.endsWith('/desviaciones/501')) return Response.json([]);
      if (url.endsWith('/assign_inspector')) {
        assert.deepEqual(JSON.parse(init.body), { id: 98, assigned_tech_email: 'miguel.casillas@asiarobotica.com' });
        app.order = { ...app.order, assigned_tech_email: 'miguel.casillas@asiarobotica.com' };
      } else if (url.endsWith('/501/stavance')) {
        assert.equal(JSON.parse(init.body).status, 'DONE');
        app.order = { ...app.order, tasks: app.order.tasks.map(t => ({ ...t, status: 'DONE' })) };
      } else if (url.endsWith('/liberar_orden/41')) {
        const body = JSON.parse(init.body);
        assert.equal(body.inspection_order_id, 98); assert.equal(body.section_title, type);
        // No dependency on the other release code is introduced by this client.
      } else if (url.endsWith('/98/insp_end')) app.order = { ...app.order, status: 'FINISHED' };
      else assert.fail('Unexpected mock URL: ' + url);
      return Response.json({});
    };
    const select = nodes(ui.render(), 'Box').find(n => n.props.component === 'select');
    await select.props.onChange({ target: { value: 'miguel.casillas@asiarobotica.com' } });
    assert.match(text(ui.render()), /miguel.casillas@asiarobotica.com/);
    nodes(ui.render(), 'ListItem').find(n => n.props.onClick).props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    const complete = button(ui, 'completado');
    assert.ok(complete, 'Existing point completion button');
    await complete.props.onClick();
    assert.equal(button(ui, 'Liberar sección').props.disabled, false);
    await button(ui, 'Liberar sección').props.onClick();
    assert.match(text(ui.render()), /Sección liberada correctamente/);
    await button(ui, 'Finalizar inspección').props.onClick();
    assert.ok(nodes(ui.render(), 'Chip').some(n => n.props.label === 'FINISHED'));
    assert.equal(button(ui, 'Finalizar inspección').props.disabled, true);
    assert.equal(app.calls.filter(([, init]) => init?.method).length, 4);
    assert.ok(app.calls.every(([, init]) => init.redirect === 'error'));
  });
}

for (const status of [401, 403]) test(`panel preserves backend ${status} denial of sensitive writes`, async () => {
  const app = fixture(); app.order.tasks[0].status = 'DONE';
  const ui = open(app);
  app.respond = () => Response.json({ error: 'Autorización requerida' }, { status });
  await button(ui, 'Liberar sección').props.onClick();
  assert.match(text(ui.render()), /Autorización requerida/);
  assert.doesNotMatch(text(ui.render()), /Sección liberada correctamente/);
  assert.equal(app.order.status, 'PENDING');
});
