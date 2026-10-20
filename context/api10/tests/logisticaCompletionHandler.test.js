const test = require("node:test");
const assert = require("node:assert/strict");
const { createCompletionHandler } = require("../routes/logisticaCompletion");
const { CompletionHttpError } = require("../services/logisticaCompletionPolicy");

function request(body) {
  return { params: { id: "1" }, headers: {}, body,
    auth: { uid: "TEST_ONLY_VERIFIED_UID", firebaseProject: "TEST_ONLY_PROJECT" },
    logisticaUser: { id: "2" }, is: type => type === "application/json" };
}
function response() {
  return { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test("Handler usa solo identidad autenticada y devuelve exclusivamente campos públicos", async () => {
  const res = response();
  const handler = createCompletionHandler({ repository: { finalize: async (input, owner) => {
    assert.deepEqual(input, { deliveryId: "1", coordinates: null });
    assert.deepEqual(owner, { authorizedUserId: "2", firebaseProject: "TEST_ONLY_PROJECT", uid: "TEST_ONLY_VERIFIED_UID" });
    return { idempotentReplay: false, delivery: { id: "1", status: "COMPLETED", completed_at: "TEST_ONLY_TIME",
      firebase_uid: "TEST_ONLY_SECRET", processing_token: "TEST_ONLY_SECRET", drive_folder_id: "TEST_ONLY_SECRET",
      latitude: 20, completion_latitude: 21 } };
  } } });
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.body, { ok: true, idempotent_replay: false,
    delivery: { id: "1", status: "COMPLETED", completed_at: "TEST_ONLY_TIME" } });
});

test("Handler devuelve replay true con HTTP 200", async () => {
  const res = response();
  await createCompletionHandler({ repository: { finalize: async () => ({ idempotentReplay: true,
    delivery: { id: "1", status: "COMPLETED", completed_at: "TEST_ONLY_TIME" } }) } })(request({}), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.idempotent_replay, true);
});

test("JSON inválido o identidad enviada en body se rechazan antes del repositorio", async () => {
  const handler = createCompletionHandler({ repository: { finalize: async () => assert.fail("No debe consultar DB") } });
  for (const body of [{ latitude: 20 }, { longitude: -103 }, { latitude: "20", longitude: -103 },
    { firebase_uid: "TEST_ONLY_FORGED_UID" }, { latitude: 100, longitude: 0 }, null]) {
    const res = response(); await handler(request(body), res); assert.equal(res.code, 400);
  }
});

test("Handler rechaza Content-Type no JSON y permite body omitido", async () => {
  const req = request(); req.headers["content-type"] = "text/plain"; req.is = () => false;
  const res = response();
  await createCompletionHandler({ repository: { finalize: async () => assert.fail("No debe consultar DB") } })(req, res);
  assert.equal(res.code, 400);
});

test("Handler sin identidad devuelve 401 antes del repositorio", async () => {
  for (const field of ["auth", "logisticaUser"]) {
    const req = request(); delete req[field]; const res = response();
    await createCompletionHandler({ repository: { finalize: async () => assert.fail("No debe consultar DB") } })(req, res);
    assert.deepEqual(res.body, { error: "No autenticado" }); assert.equal(res.code, 401);
  }
});

test("Handler conserva 403 genérico y conflictos 409 sin metadata", async () => {
  for (const [code, message] of [[403, "Entrega no disponible"], [409, "Se requiere GPS para finalizar la entrega"]]) {
    const res = response();
    await createCompletionHandler({ repository: { finalize: async () => { throw new CompletionHttpError(code, message); } } })(request(), res);
    assert.equal(res.code, code); assert.deepEqual(res.body, { error: message });
  }
});

test("Error inesperado de DB se responde y registra sin detalles sensibles", async t => {
  const messages = [];
  t.mock.method(console, "error", (...args) => messages.push(args));
  const res = response();
  await createCompletionHandler({ repository: { finalize: async () => { throw new Error("TEST_ONLY_PRIVATE_DETAILS"); } } })(request(), res);
  assert.equal(res.code, 500);
  assert.deepEqual(res.body, { error: "No se pudo finalizar la entrega" });
  assert.deepEqual(messages, [["Error finalizando entrega logística"]]);
});
