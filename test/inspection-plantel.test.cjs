'use strict';
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader, dependencyRequire, root } = require('./inspection-support.cjs');
const load = createLoader();
const domain = load('src/features/inspectionPlantel.ts');
const { filterInspectionOrders, fetchInspectionPlantel, createInspectionRefresh, cancellationProposalReady } = domain;
const components = load('src/features/InspectionPlantelControls.tsx');
const React = dependencyRequire('react');
const { renderToStaticMarkup } = dependencyRequire('react-dom/server');
const originalFetch = global.fetch;
beforeEach(() => { global.fetch = () => { throw new Error('Real HTTP forbidden in P2 tests'); }; });
afterEach(() => { global.fetch = originalFetch; });

const row = (id = 7, extra = {}) => ({ inspection_order_id: id, status: 'OPEN', created_at: '2026-11-01T00:00:00Z',
  work_order_id: 99, work_order_id_real: 99, folio_sai: 'SAI-432', customer_name: 'Cliente de prueba',
  machine_serial: 'SERIE-ABC', assigned_tech_email: 'inspector@example.invalid', titulo: 'Revisión de pintura',
  operador_produccion: 'operador@example.invalid', ...extra });
const ids = rows => rows.map(order => order.inspection_order_id);
const html = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const visible = markup => markup.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, ' ');

test('inspection ID search uses alias and exact ID, never generic id or substrings', () => {
  const rows = [row(7, { id: 8 }), row(17, { id: 7 })];
  assert.deepEqual(ids(filterInspectionOrders(rows, { search: ' 7 ', scope: 'inspection' })), [7]);
  assert.deepEqual(ids(filterInspectionOrders(rows, { search: '8', scope: 'inspection' })), []);
});
test('production ID and folio have distinct search scopes', () => {
  const rows = [row(7), row(99, { work_order_id: 7, work_order_id_real: 7, folio_sai: 'SAI-888' })];
  assert.deepEqual(ids(filterInspectionOrders(rows, { search: '7', scope: 'production' })), [99]);
  assert.deepEqual(ids(filterInspectionOrders(rows, { search: 'sai-432', scope: 'folio' })), [7]);
  assert.deepEqual(ids(filterInspectionOrders(rows, { search: '99', scope: 'inspection' })), [99]);
});
test('coincident IDs remain independent records keyed by inspection ID', () => {
  const rows = [row(7, { work_order_id: 7, work_order_id_real: 7 }), row(8, { work_order_id: 7, work_order_id_real: 7 })];
  assert.deepEqual(ids(filterInspectionOrders(rows, { search: '7', scope: 'inspection' })), [7]);
  assert.deepEqual(ids(filterInspectionOrders(rows, { search: '7', scope: 'production' })), [7, 8]);
});
for (const search of ['cliente', 'serie-abc', 'INSPECTOR@example.invalid', 'pintura']) {
  test(`existing text search retained: ${search}`, () => assert.equal(filterInspectionOrders([row()], { search }).length, 1));
}
for (const status of ['OPEN', 'PENDING', 'IN_PROGRESS', 'CLOSED', 'FINISHED']) {
  test(`search combines with ${status}`, () => {
    const rows = [row(7, { status }), row(8, { status })];
    assert.deepEqual(ids(filterInspectionOrders(rows, { search: '7', scope: 'inspection', status })), [7]);
    assert.equal(domain.STATUS_LABELS[status].length > 0, true);
  });
}
test('clearing search preserves state filter and date ordering without mutating input', () => {
  const rows = [row(7), row(8, { created_at: '2026-11-02T00:00:00Z' }), row(9, { status: 'FINISHED' })];
  assert.deepEqual(ids(filterInspectionOrders(rows, { search: '', status: 'OPEN' })), [8, 7]);
  assert.deepEqual(ids(rows), [7, 8, 9]);
});
test('IN_PROGRESS and completed inspection points do not imply LIB001/LIB002 release', () => {
  const order = row(7, { status: 'IN_PROGRESS', tasks: [{ id: 1, status: 'DONE', revision_point: 'Revisar', section_title: 'Inspección de pintura' }] });
  assert.equal(filterInspectionOrders([order], { status: 'IN_PROGRESS' }).length, 1);
  const output = visible(html(components.InspectionPlantelControls, controlsProps()));
  assert.doesNotMatch(output, /Liberación completada|Liberación pendiente/);
});
test('registered requester presentation keeps inspector/operator separate (prepared, not mapped by API10)', () => {
  const output = visible(html(components.InspectionPeople, { order: row(), registeredRequesterEmail: 'solicitante@example.invalid' }));
  for (const value of ['solicitante@example.invalid', 'inspector@example.invalid', 'operador@example.invalid']) assert.ok(output.includes(value));
  assert.match(output, /Solicitante:/); assert.match(output, /Operador de Producción:/); assert.match(output, /Inspector asignado:/);
});
test('missing requester is never inferred from operator/inspector or uncontracted fields', () => {
  const order = row(7, { requester_email: 'UNCONTRACTED@example.invalid' });
  const output = visible(html(components.InspectionPeople, { order }));
  assert.match(output, /Solicitante no registrado/); assert.doesNotMatch(output, /UNCONTRACTED/);
});
test('card identity labels inspection, production and SAI separately', () => {
  const output = visible(html(components.InspectionIdentity, { order: row(7, { id: 1000 }) }));
  assert.match(output, /ID de inspección:.*7/); assert.match(output, /Orden de producción:.*99/);
  assert.match(output, /Folio SAI de producción:.*SAI-432/); assert.doesNotMatch(output, /1000/);
});

function controlsProps(overrides = {}) {
  return { search: '', scope: 'all', status: '', release: '', refreshing: false,
    onSearch() {}, onScope() {}, onStatus() {}, onRelease() {}, onRefresh() {}, ...overrides };
}
function findElement(node, predicate) {
  if (!React.isValidElement(node)) return undefined;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props.children)) {
    const match = findElement(child, predicate); if (match) return match;
  }
}
test('visible controls include search, clear, selectable IN_PROGRESS and manual refresh', () => {
  const output = html(components.InspectionPlantelControls, controlsProps());
  for (const label of ['Buscar inspecciones', 'Buscar por', 'Estado de inspección', 'Liberación actual de Producción', 'Limpiar búsqueda', 'Actualizar inspecciones']) assert.ok(output.includes(label));
  const tree = components.InspectionPlantelControls(controlsProps());
  const option = findElement(tree, element => element.props.value === 'IN_PROGRESS');
  assert.equal(option.props.children, 'En proceso');
});
test('controls dispatch search, clear, scope, state and refresh callbacks', () => {
  const events = [];
  const tree = components.InspectionPlantelControls(controlsProps({ search: '7',
    onSearch: value => events.push(['search', value]), onScope: value => events.push(['scope', value]),
    onStatus: value => events.push(['status', value]), onRelease: value => events.push(['release', value]), onRefresh: () => events.push(['refresh']) }));
  findElement(tree, element => element.props.label === 'Buscar inspecciones').props.onChange({ target: { value: '99' } });
  findElement(tree, element => element.props.children === 'Limpiar búsqueda').props.onClick();
  findElement(tree, element => element.props.label === 'Buscar por').props.onChange({ target: { value: 'production' } });
  findElement(tree, element => element.props.label === 'Estado de inspección').props.onChange({ target: { value: 'IN_PROGRESS' } });
  findElement(tree, element => element.props.label === 'Liberación actual de Producción').props.onChange({ target: { value: 'LIB001:DONE' } });
  findElement(tree, element => element.props.children === 'Actualizar inspecciones').props.onClick();
  assert.deepEqual(events, [['search', '99'], ['search', ''], ['scope', 'production'], ['status', 'IN_PROGRESS'], ['release', 'LIB001:DONE'], ['refresh']]);
});
for (const state of [
  { loading: true, failed: false, total: 0, matched: 0, text: 'Cargando inspecciones' },
  { loading: false, failed: true, total: 0, matched: 0, text: 'No se pudieron actualizar' },
  { loading: false, failed: false, total: 0, matched: 0, text: 'No hay inspecciones registradas' },
  { loading: false, failed: false, total: 2, matched: 0, text: 'No hay inspecciones que coincidan' },
]) test(`list feedback: ${state.text}`, () => assert.ok(visible(html(components.InspectionListFeedback, state)).includes(state.text)));

test('live Plantel renders real aliases, progress and missing requester using a mocked useList', () => {
  const pageLoader = createLoader({ '@refinedev/core': { useList: options => {
    if (options.resource === domain.LEGACY_RELEASE_RESOURCE) {
      assert.equal(options.queryOptions.enabled, false); assert.equal(options.queryOptions.retry, false);
      return { data: undefined, isLoading: false, isFetching: false, error: null, refetch: async () => {} };
    }
    assert.equal(options.resource, domain.LEGACY_INSPECTION_LIST_RESOURCE); assert.equal(options.queryOptions.retry, false);
    return { data: { data: [row(7, { id: 999, tasks: [{ id: 1, status: 'DONE' }] })] },
      isLoading: false, isFetching: false, error: null, refetch: async () => {} };
  } } });
  const page = pageLoader('src/pages/Plantel Inspeccion.tsx').PlantelInspeccion;
  const output = visible(html(page));
  assert.match(output, /Inspección #7/); assert.doesNotMatch(output, /Inspección #999/);
  assert.match(output, /Progreso:.*100/); assert.match(output, /Solicitante no registrado/);
});

const production = (id = 99, status = 'PENDING', code = 'LIB001') => ({ id, tasks: [{ id: id + 1000, work_order_id: id, code, status }] });
const releaseIndex = orders => new Map(orders.map(order => [order.id, order]));
for (const [state, expected] of [['DONE', 'DONE'], ['PENDING', 'PENDING'], ['OPEN', 'PENDING'], ['IN_PROGRESS', 'PENDING'], ['CANCELED', 'UNKNOWN'], ['UNRECOGNIZED', 'UNKNOWN']]) {
  test(`release comes from matching work_order_task code/state ${state}, independently of inspection state`, () => {
    const releases = releaseIndex([production(99, state)]);
    assert.equal(domain.productionReleaseState(row(7, { status: 'FINISHED' }), releases, 'LIB001'), expected);
  });
}
test('release filter combines ID, inspection state and current production release without cross-ID collision', () => {
  const rows = [row(7, { status: 'IN_PROGRESS' }), row(99, { status: 'IN_PROGRESS', work_order_id_real: 7, work_order_id: 7 })];
  const releases = releaseIndex([production(99, 'DONE'), production(7, 'PENDING')]);
  assert.deepEqual(ids(filterInspectionOrders(rows, { status: 'IN_PROGRESS', release: 'LIB001:DONE', releases })), [7]);
  assert.deepEqual(ids(filterInspectionOrders(rows, { search: '99', scope: 'inspection', release: 'LIB001:PENDING', releases })), [99]);
  assert.deepEqual(ids(filterInspectionOrders(rows, { search: '99', scope: 'production', release: 'LIB001:DONE', releases })), [7]);
});
test('LIB001 and LIB002 are separate; completed inspection points never supply release state', () => {
  const releases = releaseIndex([production(99, 'DONE', 'LIB001')]);
  assert.equal(domain.productionReleaseState(row(), releases, 'LIB002'), 'UNKNOWN');
  const order = row(7, { tasks: [{ id: 1, status: 'DONE', code: 'LIB002' }] });
  assert.deepEqual(ids(filterInspectionOrders([order], { release: 'LIB002:DONE', releases })), []);
});
test('missing data never becomes pending; a failed/unloaded read is not a successful unknown result', () => {
  assert.equal(domain.productionReleaseState(row(), undefined, 'LIB001'), undefined);
  assert.deepEqual(ids(filterInspectionOrders([row()], { release: 'LIB001:UNKNOWN' })), []);
  assert.deepEqual(ids(filterInspectionOrders([row()], { release: 'LIB001:UNKNOWN', releases: releaseIndex([]) })), [7]);
});
test('ambiguous duplicate release code is unknown', () => {
  const order = production(); order.tasks.push({ ...order.tasks[0], id: 2000, status: 'DONE' });
  assert.equal(domain.productionReleaseState(row(), releaseIndex([order]), 'LIB001'), 'UNKNOWN');
});
test('release summary explicitly names current production, not historical inspection release', () => {
  const output = visible(html(components.InspectionReleaseSummary, { order: row(), releases: releaseIndex([production(99, 'DONE')]), code: 'LIB001' }));
  assert.match(output, /Liberación actual de Producción.*LIB001.*Completada/);
});
test('release query failure is visible as an error, not empty inspection list', () => {
  const output = visible(html(components.InspectionListFeedback, { loading: false, failed: true, total: 1, matched: 0, releaseFailed: true }));
  assert.match(output, /No se pudieron consultar las liberaciones de Producción/);
  assert.doesNotMatch(output, /No hay inspecciones/);
});
test('release fetch uses the existing read-only bulk API10 contract with no per-card requests', async () => {
  let calls = 0;
  const result = await domain.fetchProductionReleases(async (url, init) => {
    calls++; assert.equal(url, 'https://desarrollotecnologicoar.com/api10/work-orders?include=tasks'); assert.equal(init.method, 'GET');
    return new Response(JSON.stringify([production()]));
  });
  assert.equal(calls, 1); assert.equal(result[0].tasks[0].code, 'LIB001');
});
for (const response of [
  { body: '[]', valid: true }, { body: '{}', valid: false }, { body: 'bad JSON', valid: false },
  { body: '[{"id":99}]', valid: false },
  { body: JSON.stringify([{ id: 99, tasks: [{ id: 1, work_order_id: 7, code: 'LIB001', status: 'DONE' }] }]), valid: false },
]) test(`production release response validation ${response.body}`, async () => {
  const operation = domain.fetchProductionReleases(async () => new Response(response.body));
  if (response.valid) assert.deepEqual(await operation, []); else await assert.rejects(operation);
});
test('production release HTTP/network/timeout errors are not silently pending', async () => {
  await assert.rejects(domain.fetchProductionReleases(async () => new Response('{}', { status: 500 })));
  await assert.rejects(domain.fetchProductionReleases(async () => { throw new Error('offline'); }));
  await assert.rejects(domain.fetchProductionReleases(async () => new Promise(() => {}), 10), /tiempo de espera/);
});
test('new provider alias maps only to the existing GET production endpoint', async () => {
  const calls = [];
  global.fetch = async (url, init) => { calls.push([url, init.method]); return new Response(JSON.stringify([production()])); };
  const provider = load('src/dataProvider.ts').dataProvider;
  const result = await provider.getList({ resource: domain.LEGACY_RELEASE_RESOURCE });
  assert.equal(result.total, 1); assert.deepEqual(calls, [[domain.LEGACY_RELEASE_URL, 'GET']]);
});

test('manual read uses unchanged API10 URL and validates the alias', async () => {
  let calls = 0;
  const data = await fetchInspectionPlantel(async (url, init) => {
    calls++; assert.equal(url, 'https://desarrollotecnologicoar.com/api10/quality/inspection/orders_all?include=tasks');
    assert.equal(init.method, 'GET'); return new Response(JSON.stringify([row(7, { id: 8 })]));
  });
  assert.deepEqual(ids(data), [7]); assert.equal(calls, 1);
});
test('empty API success is an empty list', async () => assert.deepEqual(await fetchInspectionPlantel(async () => new Response('[]')), []));
for (const status of [401, 403, 500]) test(`HTTP ${status} is an error, not empty success`, async () => {
  await assert.rejects(fetchInspectionPlantel(async () => new Response('{}', { status })), error => error.statusCode === status);
});
for (const body of ['', 'bad json', '{}', 'null', '[{"id":7}]', '[{"inspection_order_id":-1}]']) test(`invalid payload ${body} is rejected`, async () => {
  await assert.rejects(fetchInspectionPlantel(async () => new Response(body)));
});
test('duplicate inspection identities are rejected without collapsing distinct records', async () => {
  await assert.rejects(fetchInspectionPlantel(async () => new Response(JSON.stringify([row(), row()]))));
});
test('network failure propagates once, without automatic retries', async () => {
  let calls = 0;
  await assert.rejects(fetchInspectionPlantel(async () => { calls++; throw new Error('offline'); })); assert.equal(calls, 1);
});
test('stalled read times out, aborts GET and never retries', async () => {
  let calls = 0, signal;
  await assert.rejects(fetchInspectionPlantel(async (_url, init) => {
    calls++; signal = init.signal; return new Promise(() => {});
  }, 10), /tiempo de espera/);
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
});
test('timeout also bounds a stalled response body', async () => {
  await assert.rejects(fetchInspectionPlantel(async () => ({ ok: true, json: () => new Promise(() => {}) }), 10), /tiempo de espera/);
});
test('refresh coalesces concurrent clicks, re-reads on the next manual operation', async () => {
  let calls = 0, release;
  const waiting = new Promise(resolve => { release = resolve; });
  const refresh = createInspectionRefresh(async () => { calls++; await waiting; });
  const first = refresh(); const duplicate = refresh(); assert.equal(first, duplicate);
  await Promise.resolve(); assert.equal(calls, 1); release(); await first;
  await refresh(); assert.equal(calls, 2);
});
test('failed refresh clears loading and only retries after an explicit invocation', async () => {
  let calls = 0; const refresh = createInspectionRefresh(async () => { calls++; throw new Error('offline'); });
  await assert.rejects(refresh()); assert.equal(calls, 1); await assert.rejects(refresh()); assert.equal(calls, 2);
});
test('provider handles both inspection resources with mocks, leaves unrelated GET unchanged', async () => {
  const provider = load('src/dataProvider.ts').dataProvider;
  const calls = [];
  global.fetch = async (url, init) => { calls.push([url, init?.method || 'GET']); return new Response(JSON.stringify([row()])); };
  for (const resource of ['inspection', domain.LEGACY_INSPECTION_LIST_RESOURCE]) {
    const result = await provider.getList({ resource }); assert.equal(result.total, 1); assert.deepEqual(ids(result.data), [7]);
  }
  await provider.getList({ resource: 'sections', meta: { queryParams: { template_id: 10 } } });
  assert.match(calls[2][0], /\/api10\/sections\?template_id=10$/);
  assert.ok(calls.every(([, method]) => method === 'GET'));
});

const confirmedCancellation = { permission: 'allowed', cancelableState: true, releaseEffectsConfirmed: true, transitionResultSupported: true };
for (const overrides of [undefined, { permission: 'unconfirmed' }, { permission: 'denied' }, { cancelableState: false }, { releaseEffectsConfirmed: false }, { transitionResultSupported: false }]) {
  test(`inactive cancellation proposal denies missing confirmation: ${JSON.stringify(overrides)}`, () => {
    assert.equal(cancellationProposalReady(overrides ? { ...confirmedCancellation, ...overrides } : undefined), false);
  });
}
test('all confirmations permit only the proposal; even its preview has no executable transition', () => {
  assert.equal(cancellationProposalReady(confirmedCancellation), true);
  const preview = components.InspectionCancellationProposal({ confirmation: confirmedCancellation });
  const button = findElement(preview, element => element.props.disabled === true);
  assert.ok(button); assert.equal(button.props.onClick, undefined);
});
test('existing Cancelar remains in detail, unchanged; proposal is not mounted or wired', () => {
  const page = fs.readFileSync(path.join(root, 'src/pages/Plantel Inspeccion.tsx'), 'utf8');
  assert.equal((page.match(/onClick=\{cancelOrderFunction\(/g) || []).length, 1);
  assert.ok(page.indexOf('onClick={cancelOrderFunction(') > page.indexOf('<Dialog'));
  assert.doesNotMatch(page, /InspectionCancellationProposal/);
  assert.match(page, /insp_cancel/);
});
