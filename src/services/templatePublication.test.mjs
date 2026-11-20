// Real frontend modules, simulated HTTP and React hooks. No API/DB connections.
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
const template = (patch = {}) => ({ id: 123, name: 'Inspección ShopPro1325', template_type: 'INSPECCION',
    model_id: 1, version: 1, is_published: false, ...patch });
const sections = () => [{ id: 21, template_id: 123, title: 'Inspección de ensamble', position: 1 },
    { id: 22, template_id: 123, title: 'Inspección de pintura', position: 2 }];
const point = (patch = {}) => ({ id: 31, section_id: 21, revision_point: 'Verificación visual del ensamble.',
    specs: 'Nueva especificación', suggestions: 'Nueva sugerencia', required: true, position: 1, category: 'Mecánica', ...patch });

function fixture(env = {}) {
    const calls = [], cache = new Map();
    const app = { calls, bindings: {}, current: template(), sections: sections(), points: [point()],
        refreshes: 0, confirmations: [], confirm: true, mutations: [], creates: [] };
    app.onRefetch = async () => ({ isError: false });
    app.query = { data: { data: [template()] }, isLoading: false,
        refetch: async () => { app.refreshes++; return app.onRefetch(); } };
    app.respond = (url, init) => {
        if (url === `${base}/templates/123` && !init?.method) return Response.json(app.current);
        if (url === `${base}/machine-models/1`) return Response.json({ id: 1, name: 'Shop Pro' });
        if (url === `${base}/sections?template_id=123`) return Response.json(app.sections);
        if (url === `${base}/quality/template_task_inspection?section_id=21`) return Response.json(app.points);
        if (url === `${base}/quality/template_task_inspection?section_id=22`) return Response.json([]);
        if (url === `${base}/templates/123/publish` && init.method === 'POST') return Response.json(template({ version: 2, is_published: true }));
        assert.fail('Unexpected HTTP: ' + url);
    };
    const sandbox = vm.createContext({
        URL, Request, Response, Error, AbortSignal, AbortController, DOMException, setTimeout, clearTimeout,
        __env: { VITE_APP_ENV: 'test', VITE_API10_URL: base, VITE_API5_ENABLED: 'false', ...env },
        fetch: async (...args) => { calls.push(args); return app.respond(...args); },
        window: { confirm: message => { app.confirmations.push(message); return app.confirm; } },
        alert: () => {}, console,
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
            if (name.endsWith('.css')) return {};
            if (name === 'axios') return { default: axios };
            assert.ok(name.startsWith('.'), 'Unexpected dependency: ' + name);
            const target = path.resolve(path.dirname(filename), name);
            return app.load(path.relative(root, /\.tsx?$/.test(target) ? target : target + '.ts'));
        };
        vm.runInContext(`(function(exports,require){${compiled.get(filename)}\n})`, sandbox)(exports, require);
        return exports;
    };
    app.service = () => app.load('services/templatePublication.ts');
    return app;
}
const posts = app => app.calls.filter(([, init]) => init?.method === 'POST');

test('fresh preflight and exact configured POST; response confirms real ID, flag and incremented version', async () => {
    const app = fixture(), service = app.service();
    const review = await service.prepareTemplatePublication(123);
    assert.equal(posts(app).length, 0);
    assert.equal(review.modelName, 'Shop Pro');
    assert.equal(review.points[22].length, 0, 'Unused painting section may be empty');
    const result = await service.publishReviewedTemplate(review, 21, true);
    assert.equal(result.id, 123);
    assert.equal(result.is_published, true);
    assert.equal(result.version, 2);
    assert.equal(posts(app).length, 1);
    const [url, init] = posts(app)[0];
    assert.equal(url, base + '/templates/123/publish');
    assert.deepEqual(JSON.parse(init.body), {});
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.ok(app.calls.every(([url]) => url.startsWith(base + '/')));
    assert.equal(app.calls.filter(([url]) => url.endsWith('/templates/123')).length, 2, 'Review is re-read before POST');
});

test('invalid IDs and unsafe TEST configuration cannot send HTTP', async () => {
    const app = fixture();
    for (const id of [null, 0, -1, 1.5, NaN, Infinity, 2147483648, '1&x=2']) {
        await assert.rejects(app.service().prepareTemplatePublication(id));
    }
    assert.equal(app.calls.length, 0);
    const unsafe = fixture({ VITE_API10_URL: 'https://desarrollotecnologicoar.com/api10' });
    assert.throws(() => unsafe.service(), /TEST_API27_CONFIG/);
    assert.equal(unsafe.calls.length, 0);
});

test('section selection, saved points and explicit default-text approval are required', async () => {
    const app = fixture(), service = app.service(), review = await service.prepareTemplatePublication(123);
    assert.throws(() => service.validatePublicationReview(review, null, true), /Selecciona la sección/);
    assert.throws(() => service.validatePublicationReview(review, 999, true), /Selecciona la sección/);
    assert.throws(() => service.validatePublicationReview(review, 22, true), /no tiene puntos/);
    assert.throws(() => service.validatePublicationReview(review, 21, false), /predeterminados/);
    assert.equal(service.defaultInspectionTexts(review).length, 2);
    await assert.rejects(service.publishReviewedTemplate(review, 21, false), /predeterminados/);
    assert.equal(posts(app).length, 0);
});

test('optional specs/suggestions may be null; no technical inspection criteria are invented', async () => {
    const app = fixture(); app.points = [point({ specs: null, suggestions: null, required: null, category: null })];
    const review = await app.service().prepareTemplatePublication(123);
    app.service().validatePublicationReview(review, 21, false);
    assert.equal(app.service().defaultInspectionTexts(review).length, 0);
});

test('defaults in any populated section require review because publication affects the whole template', async () => {
    const app = fixture(), original = app.respond;
    app.points = [point({ specs: null, suggestions: null })];
    app.respond = (url, init) => url.endsWith('section_id=22')
        ? Response.json([point({ id: 32, section_id: 22 })]) : original(url, init);
    const review = await app.service().prepareTemplatePublication(123);
    assert.throws(() => app.service().validatePublicationReview(review, 21, false), /predeterminados/);
});

for (const [label, alter] of [
    ['missing model', app => { app.current.model_id = null; }],
    ['blank required point', app => { app.points[0].revision_point = ' '; }],
    ['wrong point section', app => { app.points[0].section_id = 22; }],
    ['missing required position', app => { delete app.points[0].position; }],
    ['wrong template section', app => { app.sections[0].template_id = 456; }],
    ['wrong model response', app => { const old = app.respond; app.respond = (url, init) => url.endsWith('/machine-models/1') ? Response.json({ id: 2, name: 'Other' }) : old(url, init); }],
]) test(label + ' fails closed before POST', async () => {
    const app = fixture(); alter(app);
    await assert.rejects(app.service().prepareTemplatePublication(123));
    assert.equal(posts(app).length, 0);
});

test('duplicate section title is ambiguous for the exact-title request contract', async () => {
    const app = fixture(); app.sections[1].title = app.sections[0].title;
    const review = await app.service().prepareTemplatePublication(123);
    assert.throws(() => app.service().validatePublicationReview(review, 21, true), /duplicado/);
});

test('changed content or a template already published by another user invalidates an old review', async () => {
    for (const change of [app => { app.points[0].specs = 'Changed'; }, app => { app.current.is_published = true; },
        app => { app.sections[0].title += ' '; }, app => { app.current.model_id = 2; }]) {
        const app = fixture(), service = app.service(), review = await service.prepareTemplatePublication(123);
        change(app);
        await assert.rejects(service.publishReviewedTemplate(review, 21, true));
        assert.equal(posts(app).length, 0);
    }
});

for (const code of [401, 403, 404, 409, 422, 500]) test('POST HTTP ' + code + ' remains an error without retry', async () => {
    const app = fixture(), service = app.service(), review = await service.prepareTemplatePublication(123), old = app.respond;
    app.respond = (url, init) => init?.method === 'POST' ? Response.json({ error: 'Rejected by server' }, { status: code }) : old(url, init);
    await assert.rejects(service.publishReviewedTemplate(review, 21, true), e => e.statusCode === code && service.publicationErrorMessage(e).includes('Rejected by server'));
    assert.equal(posts(app).length, 1);
});

test('network failure and malformed or unconfirmed POST responses never count as publication', async () => {
    for (const respond of [
        () => { throw new Error('offline'); },
        () => new Response('invalid json'),
        () => Response.json(template({ is_published: true, version: 2 }), { status: 201 }),
        ...[{ id: 124 }, { is_published: false }, { version: 1 }, { model_id: 2 }, { template_type: 'ENSAMBLE' }]
            .map(patch => () => Response.json(template({ version: 2, is_published: true, ...patch }))),
    ]) {
        const app = fixture(), service = app.service(), review = await service.prepareTemplatePublication(123), old = app.respond;
        app.respond = (url, init) => init?.method === 'POST' ? respond() : old(url, init);
        await assert.rejects(service.publishReviewedTemplate(review, 21, true));
        assert.equal(posts(app).length, 1);
    }
});

function nodes(tree, type) {
    if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, type));
    if (!tree || typeof tree !== 'object') return [];
    return [...(tree.type === type ? [tree] : []), ...nodes(tree.props?.children, type)];
}
function text(tree) {
    if (Array.isArray(tree)) return tree.map(text).join(' ');
    return tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
}
function control(app, page = false) {
    const slots = []; let cursor = 0;
    const hooks = {
        useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i]; },
        useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value,
            value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
        useMemo(fn) { return fn(); },
    };
    app.bindings.react = { default: hooks, ...hooks };
    app.bindings['react/jsx-runtime'] = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    app.bindings['@mui/material'] = new Proxy({}, { get: (_, name) => name });
    app.bindings['@refinedev/core'] = {
        useList: ({ resource }) => resource === 'templates' ? app.query : { data: { data: [{ id: 1, name: 'Shop Pro' }] }, isLoading: false },
        useDataProvider: () => () => ({}),
        useCreate: () => ({ mutate: (...args) => app.creates.push(args), isLoading: false }),
        useCustomMutation: () => ({ mutateAsync: async (...args) => { app.mutations.push(args); },
            mutate: (...args) => app.mutations.push(args), isLoading: false }),
    };
    for (const module of ['react-icons/bs', 'react-icons/fa', 'react-icons/md']) app.bindings[module] = new Proxy({}, { get: (_, name) => name });
    app.bindings['./components/TemplateDetailsDrawer'] = { default: 'TemplateDetailsDrawer' };
    app.bindings['./components/TemplatePublishButton'] = { default: 'TemplatePublishButton' };
    const component = app.load(page ? 'pages/Templates.tsx' : 'pages/components/TemplatePublishButton.tsx').default;
    app.published = [];
    return { render() { cursor = 0; return component(page ? {} : { templateId: 123, onPublished: async t => {
        app.published.push(t); await app.query.refetch();
    } }); } };
}
const button = (tree, label) => nodes(tree, 'button').find(node => text(node).trim() === label);
async function reviewReady(app, ui) {
    await button(ui.render(), 'Publicar').props.onClick();
    nodes(ui.render(), 'select')[0].props.onChange({ target: { value: '21' } });
    nodes(ui.render(), 'input').find(n => n.props.type === 'checkbox')?.props.onChange({ target: { checked: true } });
}

test('UI requires selected section and review, confirms name/ID, locks double click and refreshes only confirmed success', async () => {
    const app = fixture(), ui = control(app);
    await button(ui.render(), 'Publicar').props.onClick();
    assert.equal(button(ui.render(), 'Confirmar publicación').props.disabled, true);
    nodes(ui.render(), 'select')[0].props.onChange({ target: { value: '21' } });
    assert.equal(button(ui.render(), 'Confirmar publicación').props.disabled, true);
    nodes(ui.render(), 'input')[0].props.onChange({ target: { checked: true } });
    assert.equal(button(ui.render(), 'Confirmar publicación').props.disabled, false);
    let resolve; const old = app.respond;
    app.respond = (url, init) => init?.method === 'POST' ? new Promise(done => { resolve = done; }) : old(url, init);
    const submit = button(ui.render(), 'Confirmar publicación').props.onClick;
    const first = submit(), second = submit();
    assert.equal(button(ui.render(), 'Publicando…').props.disabled, true);
    while (!resolve) await new Promise(done => setImmediate(done));
    assert.equal(posts(app).length, 1);
    assert.equal(app.published.length, 0);
    resolve(Response.json(template({ version: 2, is_published: true })));
    await Promise.all([first, second]);
    assert.equal(app.confirmations.length, 1);
    assert.match(app.confirmations[0], /ShopPro1325.*ID 123/s);
    assert.match(app.confirmations[0], /Inspección de ensamble/);
    assert.equal(app.published.length, 1);
    assert.equal(app.refreshes, 1);
    assert.match(text(ui.render()), /Publicado · v\s*2/);
    await submit();
    assert.equal(posts(app).length, 1);
});

test('cancel confirmation or close review sends no POST', async () => {
    const app = fixture(), ui = control(app); app.confirm = false;
    await reviewReady(app, ui);
    await button(ui.render(), 'Confirmar publicación').props.onClick();
    assert.equal(posts(app).length, 0);
    button(ui.render(), 'Cancelar').props.onClick();
    assert.equal(nodes(ui.render(), 'Dialog')[0].props.open, false);
});

test('UI HTTP failure never marks published and forces a new read before retry', async () => {
    const app = fixture(), ui = control(app), old = app.respond;
    app.respond = (url, init) => init?.method === 'POST' ? Response.json({ error: 'Acceso denegado' }, { status: 403 }) : old(url, init);
    await reviewReady(app, ui);
    await button(ui.render(), 'Confirmar publicación').props.onClick();
    assert.match(text(ui.render()), /No tienes autorización.*Acceso denegado/);
    assert.equal(app.published.length, 0);
    assert.equal(app.refreshes, 0);
    assert.equal(nodes(ui.render(), 'Dialog')[0].props.open, false);
    const reads = app.calls.length;
    await button(ui.render(), 'Publicar').props.onClick();
    assert.ok(app.calls.length > reads);
    assert.equal(posts(app).length, 1, 'Reopening never automatically repeats the POST');
});

test('confirmed publication stays protected if list refresh fails', async () => {
    const app = fixture(), ui = control(app);
    app.onRefetch = async () => { throw new Error('offline'); };
    await reviewReady(app, ui);
    await button(ui.render(), 'Confirmar publicación').props.onClick();
    assert.match(text(ui.render()), /Publicación confirmada.*No se pudo actualizar la lista/);
    assert.match(text(ui.render()), /Publicado · v\s*2/);
    assert.equal(button(ui.render(), 'Publicar'), undefined);
});

test('lost POST response followed by a fresh GET of published template does not republish', async () => {
    const app = fixture(), ui = control(app), old = app.respond;
    app.respond = (url, init) => {
        if (init?.method === 'POST') { app.current = template({ version: 2, is_published: true }); throw new Error('lost response'); }
        return old(url, init);
    };
    await reviewReady(app, ui);
    await button(ui.render(), 'Confirmar publicación').props.onClick();
    assert.equal(app.published.length, 0);
    await button(ui.render(), 'Publicar').props.onClick();
    assert.match(text(ui.render()), /Publicado · v\s*2/);
    assert.equal(posts(app).length, 1);
});

test('non-inspection drafts retain simple publication without inspection-specific requirements', async () => {
    const app = fixture(); app.current = template({ template_type: 'ENSAMBLE' });
    const service = app.service(), review = await service.prepareTemplatePublication(123), old = app.respond;
    app.respond = (url, init) => init?.method === 'POST'
        ? Response.json(template({ template_type: 'ENSAMBLE', version: 2, is_published: true })) : old(url, init);
    await service.publishReviewedTemplate(review, null, false);
    assert.equal(app.calls.filter(([url]) => url.includes('/sections') || url.includes('/machine-models')).length, 0);
});

test('Templates wires real row ID, refreshes list and open detail only after confirmed publication', async () => {
    const app = fixture(), ui = control(app, true);
    nodes(ui.render(), 'button').find(n => n.props.title === 'Ver detalles').props.onClick();
    const publish = nodes(ui.render(), 'TemplatePublishButton')[0];
    assert.equal(publish.props.templateId, 123);
    await publish.props.onPublished(template({ version: 2, is_published: true }));
    assert.equal(app.refreshes, 1);
    assert.equal(nodes(ui.render(), 'TemplateDetailsDrawer')[0].props.template.is_published, true);
    assert.equal(nodes(ui.render(), 'TemplateDetailsDrawer')[0].props.template.version, 2);
    app.onRefetch = async () => ({ isError: true, error: new Error('Refresh failed') });
    await assert.rejects(publish.props.onPublished(template({ version: 2, is_published: true })), /Refresh failed/);
});

test('existing creation and name editing keep their payloads and refresh behavior', async () => {
    const app = fixture(), ui = control(app, true);
    nodes(ui.render(), 'input').find(n => n.props.placeholder?.startsWith('Ej.')).props.onChange({ target: { value: 'Nueva inspección' } });
    nodes(ui.render(), 'select')[0].props.onChange({ target: { value: 'INSPECCION' } });
    nodes(ui.render(), 'select')[1].props.onChange({ target: { value: '1' } });
    button(ui.render(), 'Crear plantilla').props.onClick();
    assert.deepEqual(JSON.parse(JSON.stringify(app.creates[0][0])), { resource: 'templates', values: { name: 'Nueva inspección', template_type: 'INSPECCION', model_id: 1 } });
    await app.creates[0][1].onSuccess({ data: { id: 321 } });
    assert.deepEqual(app.creates.slice(1).map(([args]) => [args.resource, args.values.template_id, args.values.title]),
        [['sections', 321, 'Inspección de ensamble'], ['sections', 321, 'Inspección de pintura']]);
    assert.equal(app.mutations.length, 0, 'Inspection creation does not publish');
    nodes(ui.render(), 'button').find(n => n.props.title === 'Editar nombre').props.onClick();
    nodes(ui.render(), 'input').find(n => n.props.autoFocus).props.onChange({ target: { value: 'Nombre revisado' } });
    await nodes(ui.render(), 'button').find(n => n.props.title === 'Guardar cambios').props.onClick();
    const edit = app.mutations[0][0];
    assert.equal(edit.url, '/templates/123');
    assert.equal(edit.method, 'put');
    assert.equal(edit.values.name, 'Nombre revisado');
    assert.equal(app.refreshes, 2);
    assert.equal(app.calls.length, 0, 'Creation/edit regression uses fake providers only');
});
