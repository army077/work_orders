const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { createDeliveryListHandler } = require("../routes/logisticaDeliveryList");
const { delivery, fixture } = require("./helpers/logisticaDeliveryListFixture");

function request(patch = {}) {
  return {
    headers: {}, query: {}, auth: { uid: "TEST_ONLY_A", firebaseProject: "logistica-ar" },
    logisticaUser: { id: "1" }, ...patch,
  };
}

function response() {
  return {
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("Handler vacío devuelve 200, items=[], next_cursor=null y no-store", async () => {
  const res = response();
  await createDeliveryListHandler({ repository: { list: async (input, owner) => {
    assert.deepEqual(input, { limit: 25, pedido: null, cursor: null });
    assert.deepEqual(owner, { authorizedUserId: "1" });
    return [];
  } } })(request(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, items: [], next_cursor: null });
  assert.equal(res.headers["Cache-Control"], "no-store");
});

test("Handler serializa ID y timestamp ISO y no expone campos privados", async () => {
  const res = response();
  await createDeliveryListHandler({ repository: { list: async () => [delivery({
    id: 9007199254740993n, created_at: new Date("2026-10-21T17:11:21.545Z"),
    auth_email: null, auth_display_name: null, photo_count: "1",
    processing_token: "TEST_ONLY_SECRET", external_url: "TEST_ONLY_URL",
    drive_folder_id: "TEST_ONLY_DRIVE", firebase_uid: "TEST_ONLY_UID",
    latitude: "20", completion_latitude: "21", bytes: "TEST_ONLY_BYTES",
  })] } })(request(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.items, [{
    id: "9007199254740993", pedido: "9999998", auth_email: null, auth_display_name: null,
    created_at: "2026-10-21T17:11:21.545000Z", status: "COMPLETED", photo_count: 1,
  }]);
  assert.equal(res.body.next_cursor, null);
  assert.doesNotThrow(() => JSON.stringify(res.body));
});

test("Validación de query y body rechaza ownership antes del repositorio", async () => {
  const handler = createDeliveryListHandler({ repository: {
    list: async () => assert.fail("No debe consultar entregas"),
  } });
  for (const query of [
    { authorized_user_id: "2" }, { firebase_uid: "TEST_ONLY_B" },
    { email: "other@example.invalid" }, { propietario: "2" },
    { limit: "0" }, { limit: "101" }, { limit: "texto" },
    { cursor: "invalido" }, { pedido: ["1", "2"] },
  ]) {
    const res = response();
    await handler(request({ query }), res);
    assert.equal(res.code, 400);
  }
  for (const body of [
    { authorized_user_id: "2" }, { firebase_uid: "TEST_ONLY_B" },
    { email: "other@example.invalid" }, { propietario: "2" }, [], null, "body",
  ]) {
    const res = response();
    await handler(request({ body }), res);
    assert.equal(res.code, 400);
  }
});

test("Handler sin contexto autenticado no consulta entregas", async () => {
  const handler = createDeliveryListHandler({ repository: {
    list: async () => assert.fail("No debe consultar entregas"),
  } });
  for (const key of ["auth", "logisticaUser"]) {
    const req = request();
    delete req[key];
    const res = response();
    await handler(req, res);
    assert.equal(res.code, 401);
  }
});

test("Errores DB no exponen SQL, credenciales ni tokens en respuesta/log", async t => {
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const res = response();
  await createDeliveryListHandler({ repository: { list: async () => {
    throw new Error("SELECT TEST_ONLY_PASSWORD Bearer TEST_ONLY_TOKEN");
  } } })(request(), res);
  assert.equal(res.code, 500);
  assert.deepEqual(res.body, { error: "No se pudieron consultar las entregas" });
  assert.deepEqual(logs, [["Error consultando entregas logísticas"]]);
});

// Load the real router and both real auth middlewares with isolated dependencies.
// No server, socket, environment, DB connection or Firebase credentials are used.
function wiredRouter(f) {
  const routerPath = require.resolve("../routes/logisticaDeliveries");
  const authPath = require.resolve("../auth/requireLogisticaFirebaseAuth");
  const allowlistPath = require.resolve("../auth/requireLogisticaAuthorizedUser");
  const paths = [routerPath, authPath, allowlistPath];
  const cached = paths.map(path => require.cache[path]);
  const originalLoad = Module._load;
  for (const path of paths) delete require.cache[path];
  try {
    Module._load = function (name, parent, isMain) {
      if (name === "../db" && [routerPath, allowlistPath].includes(parent?.filename)) return f.pool;
      if (name === "./firebaseLogistica" && parent?.filename === authPath) {
        return {
          EXPECTED_PROJECT: "logistica-ar",
          getLogisticaAuth: () => ({ async verifyIdToken(token) {
            if (!["TEST_ONLY_A", "TEST_ONLY_B", "TEST_ONLY_INACTIVE", "TEST_ONLY_UNKNOWN"].includes(token)) {
              throw new Error("TEST_ONLY_INVALID_TOKEN");
            }
            return { aud: "logistica-ar", uid: token };
          } }),
        };
      }
      return originalLoad.call(this, name, parent, isMain);
    };
    const router = require(routerPath);
    const route = router.stack.find(layer => layer.route?.path === "/entregas" && layer.route.methods.get);
    assert.ok(route, "GET debe estar registrado en el router operacional");
    assert.deepEqual(route.route.stack.slice(0, 2).map(layer => layer.handle.name),
      ["requireLogisticaFirebaseAuth", "requireLogisticaAuthorizedUser"]);
    return route.route.stack.map(layer => layer.handle);
  } finally {
    Module._load = originalLoad;
    paths.forEach((path, index) => {
      if (cached[index]) require.cache[path] = cached[index];
      else delete require.cache[path];
    });
  }
}

async function invoke(handlers, { token = "TEST_ONLY_A", query = {}, body } = {}) {
  const req = { method: "GET", headers: token ? { authorization: "Bearer " + token } : {}, query, body };
  const res = response();
  for (const handler of handlers) {
    let nextCalled = false;
    await handler(req, res, () => { nextCalled = true; });
    if (!nextCalled) break;
  }
  return res;
}

test("GET real mantiene sin token e inválido en 401 antes de consultar DB", async () => {
  const f = fixture();
  const handlers = wiredRouter(f);
  for (const token of [null, "TEST_ONLY_INVALID"]) {
    const res = await invoke(handlers, { token });
    assert.equal(res.code, 401);
  }
  assert.equal(f.calls.length, 0);
});

test("GET real mantiene allowlist ausente/inactiva en 403", async () => {
  const f = fixture({ users: [{
    id: "3", firebase_uid: "TEST_ONLY_INACTIVE", firebase_project: "logistica-ar", is_active: false,
  }] });
  const handlers = wiredRouter(f);
  for (const token of ["TEST_ONLY_INACTIVE", "TEST_ONLY_UNKNOWN"]) {
    const res = await invoke(handlers, { token });
    assert.equal(res.code, 403);
    assert.deepEqual(res.body, { error: "Usuario no autorizado" });
  }
  assert.equal(f.calls.every(call => call.sql.includes("logistica_authorized_users")), true);
});

test("GET real resuelve propietario desde Firebase + allowlist y separa A/B", async () => {
  const f = fixture({ deliveries: [
    delivery({ id: "1", authorized_user_id: "1", pedido: "000123" }),
    delivery({ id: "2", authorized_user_id: "2", pedido: "000123" }),
    delivery({ id: "3", authorized_user_id: "1", status: "PENDING_EVIDENCE", pedido: "000123" }),
    delivery({ id: "4", authorized_user_id: "1", status: "FAILED", pedido: "000123" }),
  ] });
  const handlers = wiredRouter(f);
  for (const [token, expectedId] of [["TEST_ONLY_A", "1"], ["TEST_ONLY_B", "2"]]) {
    const res = await invoke(handlers, { token, query: { pedido: "001" } });
    assert.equal(res.code, 200);
    assert.deepEqual(res.body.items.map(item => item.id), [expectedId]);
    assert.equal(res.body.next_cursor, null);
    assert.equal(f.calls.at(-1).params[0], expectedId);
  }
});

test("GET real rechaza ownership falsificado sin ejecutar listado", async () => {
  const f = fixture();
  const handlers = wiredRouter(f);
  for (const patch of [
    { query: { authorized_user_id: "2" } },
    { query: { firebase_uid: "TEST_ONLY_B" } },
    { body: { propietario: "2" } },
    { body: { email: "other@example.invalid" } },
  ]) {
    assert.equal((await invoke(handlers, patch)).code, 400);
  }
  assert.equal(f.calls.every(call => call.sql.includes("logistica_authorized_users")), true);
});
