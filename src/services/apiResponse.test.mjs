// Frontend regression tests with a fake fetch; no API or database access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(apiUrl = 'https://test.invalid/api27') {
    const calls = [];
    let respond = () => new Response('[]');
    const modules = {};
    const sandbox = vm.createContext({
        exports: {}, require: name => {
            if (name === './config/api' || name === '../config/api') return {
                API10_URL: apiUrl,
                assertTestApiUrl: url => url,
                resolveCustomApiUrl: url => url.startsWith('http') ? url : apiUrl + url,
            };
            if (name === './apiTransport') return { apiFetch: (...args) => sandbox.fetch(...args) };
            if (name === './services/apiResponse') return modules.response;
            throw new Error(name);
        },
        fetch: async (...args) => { calls.push(args); return respond(...args); },
        AbortSignal, Error, Response, URL,
    });
    const compile = relative => '(function () {\n' + ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText + '\n})();';
    vm.runInContext(compile('./apiResponse.ts'), sandbox);
    modules.response = sandbox.exports;
    sandbox.exports = {};
    vm.runInContext(compile('../dataProvider.ts'), sandbox);
    return { ...modules.response, provider: sandbox.exports.dataProvider, calls, respond(fn) { respond = fn; } };
}

for (const resource of ['sections', 'tasks', 'quality/template_task_inspection']) {
    test(`${resource}: HTTP 400 rejects with message/status, never as list data and never retries`, async () => {
        const app = load();
        app.respond(() => new Response(JSON.stringify({ error: 'parent_id obligatorio' }), { status: 400 }));
        await assert.rejects(app.provider.getList({ resource }), error => {
            assert.equal(error.statusCode, 400);
            assert.equal(error.message, 'parent_id obligatorio');
            assert.equal(app.retryApiQuery(0, error), false);
            return true;
        });
        assert.equal(app.calls.length, 1);
        assert.ok(app.calls[0][1].signal instanceof AbortSignal);
    });
}
test('valid parent query preserves successful rows', async () => {
    const app = load();
    app.respond(() => new Response('[{"id":12,"title":"TEST"}]'));
    const result = await app.provider.getList({ resource: 'sections', meta: { queryParams: { template_id: '7' } } });
    assert.equal(result.data[0].id, 12);
    assert.equal(result.total, 1);
    assert.equal(app.calls[0][0], 'https://test.invalid/api27/sections?template_id=7');
});
for (const operation of ['create', 'update', 'getOne', 'custom', 'deleteOne']) {
    test(`${operation}: backend errors cannot trigger success handling`, async () => {
        const app = load();
        app.respond(() => new Response('{"error":"Request rejected"}', { status: 409 }));
        await assert.rejects(app.provider[operation]({ resource: 'tasks', id: 12, variables: {}, url: '/tasks', method: 'get' }), e => e.statusCode === 409);
    });
}
test('timeout/network failure settles and transient retry is bounded', async () => {
    const app = load();
    app.respond(() => { const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; });
    await assert.rejects(app.fetchApi('https://test.invalid'), e => e.statusCode === 0 && e.message.includes('tardó demasiado'));
    assert.equal(app.retryApiQuery(0, { statusCode: 503 }), true);
    assert.equal(app.retryApiQuery(1, { statusCode: 503 }), false);
});
test('204 DELETE succeeds without requiring a JSON body', async () => {
    const app = load();
    app.respond(() => new Response(null, { status: 204 }));
    assert.equal((await app.provider.deleteOne({ resource: 'tasks', id: 12 })).data, null);
});
test('API URLs come from configuration, including bases unrelated to API27', async () => {
    const url = 'https://test.invalid/configured-service';
    const app = load(url);
    await app.provider.getList({ resource: 'sections', meta: { queryParams: { template_id: '7' } } });
    assert.equal(app.provider.getApiUrl(), url);
    assert.equal(app.calls[0][0], url + '/sections?template_id=7');
});
