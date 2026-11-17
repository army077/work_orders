// Real compiled V2 in headless Chrome. API27 responses are intercepted mocks;
// every other external request is blocked. No business request leaves Chrome.
import assert from 'node:assert/strict';
import { readFile, stat, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../dist/v2/', import.meta.url));
const base = '/work-orders-v2/';
const api = 'https://desarrollotecnologicoar.com/api27';
const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert.ok(existsSync(chromePath), 'Set CHROME_PATH to the installed Chrome executable');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = [], mocked = [], blocked = [], errors = [], resources = [];
const routes = ['families', 'models', 'templates', 'sections-builder', 'tasks-builder',
  'create-work-order', 'work-orders', 'run-work-order/41', 'plantel-produccion', 'plantel-inspeccion'];
const order = { id: 41, template_id: 19, model_id: 11, status: 'OPEN', tasks: [],
  machine_serial: 'SIMULADA-SIN-RED', customer_name: 'Orden simulada',
  created_at: '2026-11-13T12:00:00Z', scheduled_at: null };
const inspection = { id: 98, inspection_order_id: 98, work_order_id: 41, equipo: 'Equipo simulado',
  inspection_type: 'Inspección de ensamble', status: 'PENDING', created_at: order.created_at,
  estacion: null, assigned_tech_email: null, tasks: [] };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (!pathname.startsWith(base)) { res.writeHead(404).end(); return; }
    const relative = pathname.slice(base.length);
    const target = path.resolve(root, relative || 'index.html');
    assert.ok(target.startsWith(path.resolve(root) + path.sep));
    const isRoute = routes.includes(relative);
    const file = isRoute ? path.join(root, 'index.html') : target;
    assert.ok((await stat(file)).isFile());
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
      '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' }[path.extname(file)] ?? 'text/html; charset=utf-8';
    resources.push(pathname);
    res.setHeader('Content-Type', mime); res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), 'work-orders-v2-browser-'));
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions',
  '--no-first-run', '--no-default-browser-check', '--host-resolver-rules=MAP * 0.0.0.0,EXCLUDE 127.0.0.1',
  'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.resume();
let ws;
try {
  let debugPort;
  for (let i = 0; i < 100; i++) {
    try { debugPort = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; }
    catch { await pause(100); }
  }
  assert.ok(debugPort, 'Headless Chrome did not start');
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (waiter) { clearTimeout(waiter.timer); pending.delete(message.id); message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result); }
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    } else if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      (async () => {
        if (request.url.startsWith(origin + base)) { await send('Fetch.continueRequest', { requestId }); return; }
        if (request.url.startsWith(api + '/')) {
          assert.ok(['GET', 'OPTIONS'].includes(request.method), 'Route smoke must never submit a mutation');
          mocked.push(request.url);
          const pathname = new URL(request.url).pathname.slice('/api27'.length);
          let body = [];
          if (pathname === '/work-orders') body = [order];
          if (pathname === '/work-orders/41') body = order;
          if (pathname === '/quality/inspection/orders_all') body = [inspection];
          await send('Fetch.fulfillRequest', { requestId, responseCode: request.method === 'OPTIONS' ? 204 : 200,
            responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' },
              { name: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' }, { name: 'Access-Control-Allow-Headers', value: '*' }],
            body: request.method === 'OPTIONS' ? '' : Buffer.from(JSON.stringify(body)).toString('base64') });
        } else {
          blocked.push(request.url);
          if (/\/api(?:10|5)(?:\/|$)/.test(request.url)) errors.push('Legacy API request attempted');
          await send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
        }
      })().catch(error => { errors.push(error.message); void send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); });
    }
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result?.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await pause(100); }
    throw new Error('UI timeout: ' + expression);
  };
  for (const route of routes) {
    await send('Page.navigate', { url: origin + base + route });
    await waitFor(`location.pathname===${JSON.stringify(base + route)} && document.querySelector('main')?.children.length>0`);
    await waitFor(`Array.from(document.querySelectorAll('img')).every(img=>img.complete&&img.naturalWidth>0)`);
    assert.ok(await evaluate(`Array.from(document.querySelectorAll('a[href]')).every(a=>new URL(a.href).pathname.startsWith(${JSON.stringify(base)}))`), 'Internal link outside V2');
    assert.ok(await evaluate(`document.querySelector('main').textContent.length>0`));
    if (route === 'work-orders') await waitFor(`document.querySelector('main').textContent.includes('SIMULADA-SIN-RED')`);
    if (route === 'plantel-inspeccion') await waitFor(`document.querySelector('main').textContent.includes('Equipo simulado')`);
    results.push('direct:' + route);
    await send('Page.reload', { ignoreCache: true });
    await waitFor(`document.querySelector('main')?.children.length>0 && location.pathname===${JSON.stringify(base + route)}`);
    results.push('reload:' + route);
  }
  await evaluate(`document.querySelector('a[href="${base}work-orders"]').click()`);
  await waitFor(`location.pathname===${JSON.stringify(base + 'work-orders')} && document.querySelector('main').textContent.includes('SIMULADA-SIN-RED')`);
  await evaluate(`document.querySelector('main a').click()`);
  await waitFor(`location.pathname===${JSON.stringify(base + 'run-work-order/41')}`);
  results.push('navigation:list-to-order');
  await send('Page.navigate', { url: origin + base });
  await waitFor(`location.pathname===${JSON.stringify(base + 'templates')} && document.querySelector('main')?.children.length>0`);
  results.push('navigation:root-redirect');
  await pause(300);
  assert.deepEqual(errors, [], 'Browser runtime errors');
  assert.ok(resources.some(url => url.endsWith('/AR LOGO.png')));
  assert.ok(resources.some(url => url.includes('/assets/') && url.endsWith('.js')));
  console.log(JSON.stringify({ passed: results.length, results, apiRequestsMocked: mocked.length,
    externalRequestsBlocked: blocked.length, businessRequestsDispatched: 0, runtimeErrors: errors,
    scope: 'Compiled V2, local SPA rewrite simulation, mocked API27; not deployed-server verification' }, null, 2));
  await send('Browser.close').catch(() => {});
} finally {
  ws?.close(); chrome.kill(); await new Promise(resolve => server.close(resolve));
}
