// Firebase sessions and all HTTP are mocks; no SDK initialization or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { inspect } from 'node:util';
import ts from 'typescript';
import axios from 'axios';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'https://desarrollotecnologicoar.com/api27';
const mockToken = 'MOCK_ONLY_FIREBASE_ID_TOKEN';
const project = 'mock-confirmed-project';
const compiled = new Map();
function fixture(env = {}) {
    const calls = [], logs = [], cache = new Map();
    const app = { calls, logs, respond: () => Response.json({ ok: true }) };
    const sandbox = vm.createContext({ URL, Request, Response, Headers, Error, AbortSignal,
        __env: { VITE_APP_ENV: 'test', VITE_API10_URL: base, VITE_API5_ENABLED: 'false', ...env },
        console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
        fetch: async (...args) => { calls.push(args); return app.respond(...args); },
    });
    app.load = relative => {
        const filename = path.resolve(root, relative);
        if (cache.has(filename)) return cache.get(filename);
        if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(readFileSync(filename, 'utf8').replaceAll('import.meta.env', '__env'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText);
        const exports = {}; cache.set(filename, exports);
        const require = name => {
            if (name === 'axios') return { default: axios };
            assert.ok(name.startsWith('.'), 'Unexpected dependency: ' + name);
            return app.load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')));
        };
        vm.runInContext(`(function(exports,require){${compiled.get(filename)}\n})`, sandbox)(exports, require);
        return exports;
    };
    app.auth = app.load('services/api27Auth.ts');
    app.transport = app.load('services/apiTransport.ts');
    app.session = { app: { options: { projectId: project } }, authStateReady: async () => {},
        currentUser: { getIdToken: async () => mockToken } };
    app.configure = () => app.transport.setApi27TokenProvider(app.auth.createFirebaseIdTokenProvider(app.session, project));
    return app;
}
async function rejected(promise) {
    try { await promise; } catch (error) { return error; }
    assert.fail('Expected rejection');
}
function safe(app, error) {
    assert.equal(app.logs.length, 0, 'Auth/transport must not log credentials');
    assert.ok(!inspect(error, { depth: 8 }).includes(mockToken), 'A page may safely log this error');
    assert.ok(!JSON.stringify(error).includes(mockToken));
    assert.equal(error.cause, undefined);
}

test('unconfigured V2 keeps existing transport and does not initialize Firebase or add Authorization', async () => {
    const app = fixture();
    await app.transport.apiFetch(base + '/work-orders');
    await app.transport.apiAxios.get(base + '/quality/inspection/orders_all');
    assert.equal(new Headers(app.calls[0][1]?.headers).get('Authorization'), null);
    assert.equal(app.calls[1][0].headers.get('Authorization'), null);
    assert.equal(app.logs.length, 0);
});

test('confirmed mock session: Fetch attaches ID token centrally and preserves payload, headers and redirect isolation', async () => {
    const app = fixture(); app.configure();
    const headers = { 'Content-Type': 'application/json', Authorization: 'old-value' };
    const body = JSON.stringify({ inspection_order_id: 98, section_title: 'Inspección de pintura' });
    await app.transport.apiFetch(base + '/quality/liberar_orden/41', { method: 'PUT', headers, body, redirect: 'follow' });
    const [url, init] = app.calls[0];
    assert.equal(url, base + '/quality/liberar_orden/41');
    assert.equal(init.headers.get('Authorization'), 'Bearer ' + mockToken);
    assert.equal(init.headers.get('Content-Type'), 'application/json');
    assert.equal(init.body, body); assert.equal(init.method, 'PUT'); assert.equal(init.redirect, 'error');
    assert.equal(headers.Authorization, 'old-value'); assert.equal(app.logs.length, 0);
});

test('confirmed mock session: installed Axios adapter receives same ID token and unchanged JSON/params', async () => {
    const app = fixture(); app.configure();
    await app.transport.apiAxios.put(base + '/work-orders/701/stavance', { status: 'DONE' }, { params: { check: 1 }, auth: { username: 'mock', password: 'unused' } });
    const [request, init] = app.calls[0];
    assert.equal(request.url, base + '/work-orders/701/stavance?check=1');
    assert.equal(request.headers.get('Authorization'), 'Bearer ' + mockToken);
    assert.equal(await request.json().then(body => body.status), 'DONE');
    assert.equal(request.redirect, 'error'); assert.equal(init.redirect, 'error');
    assert.equal(app.logs.length, 0);
});

test('waits for Firebase session restoration before consulting currentUser', async () => {
    const app = fixture(); let ready;
    app.session.currentUser = null;
    app.session.authStateReady = () => new Promise(resolve => { ready = resolve; });
    app.configure();
    const pending = app.transport.apiFetch(base + '/work-orders');
    assert.equal(app.calls.length, 0);
    app.session.currentUser = { getIdToken: async () => mockToken }; ready();
    await pending;
    assert.equal(app.calls.length, 1);
});

test('expired token refreshed by SDK: each request obtains current ID token without app caching or forced retry', async () => {
    const app = fixture(); let tokens = 0;
    app.session.currentUser.getIdToken = async (...args) => { assert.equal(args.length, 0); return mockToken + ++tokens; };
    app.configure();
    await app.transport.apiFetch(base + '/work-orders');
    await app.transport.apiAxios.get(base + '/quality/inspection/orders_all');
    assert.equal(tokens, 2);
    assert.equal(app.calls[0][1].headers.get('Authorization'), 'Bearer ' + mockToken + '1');
    assert.equal(app.calls[1][0].headers.get('Authorization'), 'Bearer ' + mockToken + '2');
});

for (const scenario of ['no-user', 'no-token', 'invalid-token', 'expired-session', 'restoration-error', 'signout-during-refresh']) {
    test(`configured ${scenario}: both transports fail closed without HTTP or credential-bearing errors`, async () => {
        const app = fixture();
        if (scenario === 'no-user') app.session.currentUser = null;
        if (scenario === 'no-token') app.session.currentUser.getIdToken = async () => '';
        if (scenario === 'invalid-token') app.session.currentUser.getIdToken = async () => mockToken + '\r\n';
        if (scenario === 'expired-session') app.session.currentUser.getIdToken = async () => { throw new Error('auth/user-token-expired ' + mockToken); };
        if (scenario === 'restoration-error') app.session.authStateReady = async () => { throw new Error(mockToken); };
        if (scenario === 'signout-during-refresh') app.session.currentUser.getIdToken = async () => { app.session.currentUser = null; return mockToken; };
        app.configure();
        for (const promise of [app.transport.apiFetch(base + '/work-orders'), app.transport.apiAxios.get(base + '/work-orders')]) {
            const error = await rejected(promise);
            assert.equal(error.statusCode, 401); safe(app, error);
        }
        assert.equal(app.calls.length, 0);
    });
}

test('unknown or mismatched project cannot configure a session; no automatic reuse of either known project', () => {
    const app = fixture();
    for (const expected of ['', 'another-project', 'ordentrabajoar', 'logistica-ar']) {
        assert.throws(() => app.auth.createFirebaseIdTokenProvider(app.session, expected), error => error.statusCode === 401);
    }
    assert.equal(app.calls.length, 0); assert.equal(app.logs.length, 0);
});

test('invalid provider output never downgrades to an anonymous request', async () => {
    const app = fixture(); app.transport.setApi27TokenProvider(async () => undefined);
    assert.equal((await rejected(app.transport.apiFetch(base + '/work-orders'))).statusCode, 401);
    assert.equal((await rejected(app.transport.apiAxios.get(base + '/work-orders'))).statusCode, 401);
    assert.equal(app.calls.length, 0);
});

test('missing session stays 401 through fetchApi and bounded retry policy', async () => {
    const app = fixture(); app.session.currentUser = null; app.configure();
    const service = app.load('services/apiResponse.ts');
    const error = await rejected(service.fetchApi(base + '/work-orders'));
    assert.equal(error.statusCode, 401); assert.equal(service.retryApiQuery(0, error), false);
    assert.equal(app.calls.length, 0);
});

for (const status of [401, 403]) test(`HTTP ${status}: preserve denial, no refresh/replay, no Axios credentials in logged error`, async () => {
    const app = fixture(); let tokens = 0;
    app.session.currentUser.getIdToken = async () => { tokens++; return mockToken; }; app.configure();
    app.respond = () => Response.json({ error: 'Autorización requerida' }, { status });
    const service = app.load('services/apiResponse.ts');
    const fetchError = await rejected(service.fetchApi(base + '/quality/liberar_orden/41', { method: 'PUT' }));
    const axiosError = await rejected(app.transport.apiAxios.put(base + '/work-orders/701/stavance', { status: 'DONE' }));
    assert.equal(fetchError.statusCode, status); assert.equal(axiosError.response.status, status);
    assert.equal(service.retryApiQuery(0, fetchError), false);
    assert.equal(tokens, 2); assert.equal(app.calls.length, 2);
    safe(app, fetchError); safe(app, axiosError);
});

test('network errors containing credentials are sanitized in both transports', async () => {
    const app = fixture(); app.configure();
    app.respond = () => { throw new Error(mockToken); };
    safe(app, await rejected(app.transport.apiFetch(base + '/work-orders')));
    safe(app, await rejected(app.transport.apiAxios.get(base + '/work-orders')));
});

test('authenticated fetchApi keeps timeout classification without exposing the original credential-bearing error', async () => {
    const app = fixture(); app.configure();
    app.respond = () => { const error = new Error(mockToken); error.name = 'TimeoutError'; throw error; };
    const error = await rejected(app.load('services/apiResponse.ts').fetchApi(base + '/work-orders'));
    assert.match(error.message, /tardó demasiado/); safe(app, error);
});

test('forbidden destinations are rejected before asking for any ID token', async () => {
    const app = fixture(); let tokens = 0;
    app.transport.setApi27TokenProvider(async () => { tokens++; return mockToken; });
    for (const url of ['https://desarrollotecnologicoar.com/api10/work-orders', base + '/../api10', 'https://other.invalid/api27']) {
        assert.throws(() => app.transport.apiFetch(url), /TEST_API27_DESTINATION/);
        await assert.rejects(app.transport.apiAxios.get(url), /TEST_API27_DESTINATION/);
    }
    assert.equal(tokens, 0); assert.equal(app.calls.length, 0);
});

for (const env of ['local', 'production']) test(`${env} cannot opt into API27 auth or alter its existing client`, () => {
    const app = fixture({ VITE_APP_ENV: env, VITE_API10_URL: env === 'local' ? 'http://localhost:3010/api10' : 'https://production.invalid/api10' });
    assert.throws(() => app.transport.setApi27TokenProvider(async () => mockToken));
    assert.equal(app.transport.apiAxios, axios); assert.equal(app.calls.length, 0);
});
