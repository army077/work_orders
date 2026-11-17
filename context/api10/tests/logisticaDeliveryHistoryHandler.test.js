const test = require("node:test");
const assert = require("node:assert/strict");
const { createDeliveryHistoryHandler } = require("../routes/logisticaDeliveryHistory");
const { request, response, fixture, legacy, delivery, mapping, wiredRouter, invoke } = require("./helpers/logisticaDeliveryHistoryFixture");

test("Handler vacío responde 200 con secciones independientes y no-store", async () => {
  const res = response();
  await createDeliveryHistoryHandler({ repository: { async list(input, owner) {
    assert.equal(input.limit, 25); assert.deepEqual(owner, { authorizedUserId: "1" });
    return { current: [], legacy: [] };
  } } })(request(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, current: { items: [], next_cursor: null }, legacy: { items: [], next_cursor: null } });
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("Sin identidad verificada no consulta repositorio", async () => {
  const handler = createDeliveryHistoryHandler({ repository: { list: () => assert.fail("Sin DB") } });
  for (const field of ["auth", "logisticaUser"]) {
    const req = request(); delete req[field]; const res = response();
    await handler(req, res); assert.equal(res.code, 401);
  }
});

test("Body o query inválidos producen 400 antes del listado", async () => {
  const handler = createDeliveryHistoryHandler({ repository: { list: () => assert.fail("Sin DB") } });
  for (const patch of [{ body: { email: "other@example.invalid" } }, { body: [] }, { body: null },
    { query: { authorized_user_id: "2" } }, { query: { legacy_cursor: "bad" } }]) {
    const res = response(); await handler(request(patch), res); assert.equal(res.code, 400);
  }
});

test("Fallo DB o fila inválida produce 500 sin filtrar secretos ni lista vacía", async t => {
  const logs = []; t.mock.method(console, "error", (...args) => logs.push(args));
  for (const list of [async () => { throw new Error("TEST_ONLY_SECRET SQL password"); },
    async () => ({ current: [], legacy: [legacy({ recorded_local_at: "bad" })] })]) {
    const res = response(); await createDeliveryHistoryHandler({ repository: { list } })(request(), res);
    assert.equal(res.code, 500); assert.deepEqual(res.body, { error: "No se pudo consultar el historial" });
  }
  assert.deepEqual(logs, [["Error consultando historial logístico"], ["Error consultando historial logístico"]]);
});

test("Ruta real exige Firebase Bearer y allowlist, sin bypass", async () => {
  const f = fixture(), handlers = wiredRouter(f);
  for (const token of [null, "TEST_ONLY_INVALID"]) assert.equal((await invoke(handlers, { token })).code, 401);
  assert.equal(f.calls.length, 0);
  assert.equal((await invoke(handlers, { token: "TEST_ONLY_UNKNOWN" })).code, 403);
  assert.ok(f.calls.every(c => c.sql.includes("FROM public.logistica_authorized_users")));
});

test("Ruta real resuelve ambos owners server-side y nunca por query/body", async () => {
  const f = fixture({ deliveries: [delivery()], legacyRows: [legacy()], mappings: [mapping()] });
  const handlers = wiredRouter(f);
  const a = await invoke(handlers); assert.equal(a.code, 200);
  assert.equal(a.body.current.items.length, 1); assert.equal(a.body.legacy.items.length, 1);
  const b = await invoke(handlers, { token: "TEST_ONLY_B" }); assert.equal(b.code, 200);
  assert.equal(b.body.current.items.length, 0); assert.equal(b.body.legacy.items.length, 0);
  assert.equal((await invoke(handlers, { query: { email: "test@example.invalid" } })).code, 400);
});

test("GET anterior conserva exactamente contrato y no consulta legacy", async () => {
  const f = fixture({ deliveries: [delivery()], legacyRows: [legacy()], mappings: [mapping()] });
  const res = await invoke(wiredRouter(f, "/entregas"));
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, items: [{ id: "20", pedido: "9999998",
    auth_display_name: "TEST_ONLY_NAME", auth_email: "test@example.invalid",
    created_at: "2026-10-21T17:11:21.545123Z", status: "COMPLETED", photo_count: 0 }], next_cursor: null });
  assert.ok(f.calls.every(c => !c.sql.includes("entregas_logistica_legacy")));
});
