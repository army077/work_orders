const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createCompletionRepository } = require("../repositories/logisticaCompletion");

const owner = { authorizedUserId: "2", firebaseProject: "TEST_ONLY_PROJECT", uid: "TEST_ONLY_USER" };
const input = { deliveryId: "1", coordinates: null };
const baseDelivery = { id: "1", status: "PENDING_EVIDENCE", latitude: "20.123", longitude: "-103.123",
  completion_latitude: null, completion_longitude: null, completed_at: null };
const ready = { photo_uploaded: "1", signature_uploaded: "1", pending: "0", failed: "0" };
const completionTime = new Date("2026-10-20T12:00:00Z");

// Doble sin pg, red, env ni DB: prueba decisiones y contrato SQL, no locks reales.
function fixture({ delivery = baseDelivery, counts = ready, commitError, commitCommand = "COMMIT", updateError,
  rollbackError, connectionLoss = false, coordinatesMatch } = {}) {
  let persisted = delivery ? { ...delivery } : null;
  let inTransaction = false;
  let locked = false;
  let discarded;
  let released = false;
  const calls = [];
  const client = new EventEmitter();
  client.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("BEGIN")) { inTransaction = true; return { command: "BEGIN" }; }
    if (sql.startsWith("SET LOCAL")) return { command: "SET" };
    if (sql === "COMMIT") {
      if (commitError) throw commitError;
      inTransaction = false;
      return { command: commitCommand };
    }
    if (sql === "ROLLBACK") {
      inTransaction = false;
      if (rollbackError) throw rollbackError;
      return { command: "ROLLBACK" };
    }
    assert.equal(inTransaction, true);
    if (/SELECT[\s\S]*FROM public\.logistica_deliveries/.test(sql)) {
      assert.match(sql, /FOR UPDATE/);
      assert.match(sql, /authorized_user_id = \$2::bigint[\s\S]*firebase_project = \$3::text AND firebase_uid = \$4::text/);
      assert.deepEqual(params.slice(0, 4), ["1", owner.authorizedUserId, owner.firebaseProject, owner.uid]);
      assert.match(sql, /completion_latitude = \$5::numeric AND completion_longitude = \$6::numeric/);
      locked = true;
      if (connectionLoss) client.emit("error", new Error("TEST_ONLY_CONNECTION_LOST"));
      return { rows: persisted ? [{ ...persisted, same_completion_coordinates: coordinatesMatch
        ?? (Number(persisted.completion_latitude) === params[4]
          && Number(persisted.completion_longitude) === params[5]) }] : [] };
    }
    if (/FROM public\.logistica_delivery_evidence/.test(sql)) {
      assert.equal(locked, true, "evidencias se consultan después del lock padre");
      assert.deepEqual(params, ["1"]);
      assert.match(sql, /evidence_type = 'PHOTO' AND status = 'UPLOADED'/);
      assert.match(sql, /evidence_type = 'SIGNATURE' AND status = 'UPLOADED'/);
      assert.match(sql, /WHERE status = 'PENDING'/);
      assert.match(sql, /WHERE status = 'FAILED'/);
      return { rows: [{ ...counts }] };
    }
    if (/UPDATE public\.logistica_deliveries/.test(sql)) {
      assert.equal(locked, true);
      assert.doesNotMatch(sql, /(?:SET|,)\s*(?:latitude|longitude)\s*=/);
      assert.match(sql, /completion_latitude = \$2::numeric/);
      assert.match(sql, /completion_longitude = \$3::numeric/);
      assert.match(sql, /completed_at = now\(\), updated_at = now\(\)/);
      assert.match(sql, /WHERE id = \$1::bigint AND status = 'PENDING_EVIDENCE'/);
      if (updateError) throw updateError;
      persisted = { ...persisted, status: "COMPLETED", completion_latitude: params[1],
        completion_longitude: params[2], completed_at: completionTime };
      return { rows: [{ id: persisted.id, status: persisted.status, completed_at: persisted.completed_at }] };
    }
    assert.fail(`Consulta inesperada: ${sql}`);
  };
  client.release = err => { released = true; discarded = err; };
  const repo = createCompletionRepository({ connect: async () => client });
  return { repo, calls, get persisted() { return persisted; }, get discarded() { return discarded; }, done() {
    assert.equal(released, true);
    if (!connectionLoss) assert.equal(inTransaction, false);
    assert.equal(client.listenerCount("error"), 0);
  } };
}

for (const [description, patch] of [
  ["sin PHOTO", { photo_uploaded: "0" }],
  ["sin SIGNATURE", { signature_uploaded: "0" }],
  ["dos SIGNATURE", { signature_uploaded: "2" }],
  ["evidencia PENDING además de las UPLOADED", { pending: "1" }],
  ["evidencia FAILED además de las UPLOADED", { failed: "1" }],
]) {
  test(`Finalización ${description} devuelve 409 y revierte sin UPDATE`, async () => {
    const f = fixture({ counts: { ...ready, ...patch } });
    await assert.rejects(f.repo.finalize(input, owner), err => err.status === 409);
    assert.equal(f.calls.some(c => /UPDATE public/.test(c.sql)), false);
    assert.equal(f.calls.at(-1).sql, "ROLLBACK"); f.done();
  });
}

test("PHOTO + SIGNATURE UPLOADED completa bajo lock; copia GPS original sin modificarlo", async () => {
  const f = fixture();
  const result = await f.repo.finalize(input, owner);
  assert.equal(result.idempotentReplay, false);
  assert.deepEqual(result.delivery, { id: "1", status: "COMPLETED", completed_at: completionTime });
  assert.equal(f.persisted.completion_latitude, baseDelivery.latitude);
  assert.equal(f.persisted.completion_longitude, baseDelivery.longitude);
  assert.equal(f.persisted.latitude, baseDelivery.latitude);
  assert.equal(f.persisted.longitude, baseDelivery.longitude);
  assert.equal(f.calls.filter(c => c.sql.startsWith("BEGIN")).length, 1);
  assert.ok(f.calls.findIndex(c => c.sql.includes("FOR UPDATE")) < f.calls.findIndex(c => c.sql.includes("FROM public.logistica_delivery_evidence")));
  assert.equal(f.calls.at(-1).sql, "COMMIT"); f.done();
});

test("GPS request se guarda como completion GPS y conserva originales", async () => {
  const f = fixture();
  await f.repo.finalize({ ...input, coordinates: { latitude: 0, longitude: 0 } }, owner);
  assert.equal(f.persisted.completion_latitude, 0);
  assert.equal(f.persisted.completion_longitude, 0);
  assert.equal(f.persisted.latitude, baseDelivery.latitude);
  assert.equal(f.persisted.longitude, baseDelivery.longitude); f.done();
});

test("Sin GPS en ningún lado devuelve 409 sin UPDATE", async () => {
  const f = fixture({ delivery: { ...baseDelivery, latitude: null, longitude: null } });
  await assert.rejects(f.repo.finalize(input, owner), err => err.status === 409);
  assert.equal(f.calls.some(c => /UPDATE public/.test(c.sql)), false); f.done();
});

test("GPS request permite completar una entrega sin GPS original", async () => {
  const f = fixture({ delivery: { ...baseDelivery, latitude: null, longitude: null } });
  await f.repo.finalize({ ...input, coordinates: { latitude: 20, longitude: -103 } }, owner);
  assert.equal(f.persisted.completion_latitude, 20);
  assert.equal(f.persisted.latitude, null); f.done();
});

test("Segundo finalize sin GPS hace replay y no cambia completed_at ni consulta evidencias", async () => {
  const f = fixture();
  const first = await f.repo.finalize(input, owner);
  const writes = f.calls.filter(c => /UPDATE public/.test(c.sql)).length;
  const evidenceQueries = f.calls.filter(c => c.sql.includes("FROM public.logistica_delivery_evidence")).length;
  const second = await f.repo.finalize(input, owner);
  assert.equal(first.idempotentReplay, false);
  assert.equal(second.idempotentReplay, true);
  assert.equal(second.delivery.completed_at, first.delivery.completed_at);
  assert.equal(f.calls.filter(c => /UPDATE public/.test(c.sql)).length, writes);
  assert.equal(f.calls.filter(c => c.sql.includes("FROM public.logistica_delivery_evidence")).length, evidenceQueries);
  f.done();
});

test("Replay compara contra completion GPS, incluso si difiere del GPS original", async () => {
  const f = fixture({ delivery: { ...baseDelivery, status: "COMPLETED", completion_latitude: "0.000", completion_longitude: "0", completed_at: completionTime } });
  const result = await f.repo.finalize({ ...input, coordinates: { latitude: 0, longitude: 0 } }, owner);
  assert.equal(result.idempotentReplay, true);
  assert.deepEqual(f.calls.find(c => c.sql.includes("FOR UPDATE")).params.slice(4), [0, 0]);
  assert.equal(f.calls.some(c => /UPDATE public/.test(c.sql)), false); f.done();
});

test("Replay respeta comparación NUMERIC de PostgreSQL sin redondear GPS persistido", async () => {
  const f = fixture({ delivery: { ...baseDelivery, status: "COMPLETED",
    completion_latitude: "20.1234567890123456789", completion_longitude: "-103",
    completed_at: completionTime }, coordinatesMatch: false });
  await assert.rejects(f.repo.finalize({ ...input, coordinates: {
    latitude: Number("20.1234567890123456789"), longitude: -103,
  } }, owner), err => err.status === 409);
  assert.equal(f.calls.some(c => /UPDATE public/.test(c.sql)), false); f.done();
});

test("Replay con GPS distinto devuelve 409 y no sobrescribe finalización", async () => {
  const f = fixture();
  await f.repo.finalize(input, owner);
  const completed = { ...f.persisted };
  for (const gps of [{ latitude: 21, longitude: -103.123 }, { latitude: 20.123, longitude: -104 }]) {
    await assert.rejects(f.repo.finalize({ ...input, coordinates: gps }, owner), err => err.status === 409);
    assert.deepEqual(f.persisted, completed);
  }
  assert.equal(f.calls.filter(c => /UPDATE public/.test(c.sql)).length, 1); f.done();
});

test("Entrega ausente o ajena usa el mismo 403 genérico sin consultar evidencias", async () => {
  const f = fixture({ delivery: null });
  await assert.rejects(f.repo.finalize(input, owner), err => err.status === 403 && err.message === "Entrega no disponible");
  assert.equal(f.calls.some(c => c.sql.includes("logistica_delivery_evidence")), false);
  assert.equal(f.calls.some(c => /UPDATE public/.test(c.sql)), false); f.done();
});

test("Otros estados no finalizables devuelven 409 antes de consultar evidencias", async () => {
  const f = fixture({ delivery: { ...baseDelivery, status: "FAILED" } });
  await assert.rejects(f.repo.finalize(input, owner), err => err.status === 409);
  assert.equal(f.calls.some(c => c.sql.includes("logistica_delivery_evidence")), false); f.done();
});

test("Error de UPDATE provoca ROLLBACK y conserva el error", async () => {
  const failure = new Error("TEST_ONLY_UPDATE_FAILURE");
  const f = fixture({ updateError: failure });
  await assert.rejects(f.repo.finalize(input, owner), err => err === failure);
  assert.equal(f.calls.at(-1).sql, "ROLLBACK"); f.done();
});

test("COMMIT fallido o no confirmado nunca devuelve éxito", async () => {
  for (const config of [{ commitError: new Error("TEST_ONLY_COMMIT_FAILURE") }, { commitCommand: "ROLLBACK" }]) {
    const f = fixture(config);
    await assert.rejects(f.repo.finalize(input, owner));
    assert.equal(f.calls.at(-1).sql, "ROLLBACK"); f.done();
  }
});

test("Fallo de ROLLBACK descarta cliente; error de conexión no permite continuar", async () => {
  const rollbackError = new Error("TEST_ONLY_ROLLBACK_FAILURE");
  const f = fixture({ delivery: null, rollbackError });
  await assert.rejects(f.repo.finalize(input, owner), err => err.status === 403);
  assert.equal(f.discarded, rollbackError); f.done();
  const lost = fixture({ connectionLoss: true });
  await assert.rejects(lost.repo.finalize(input, owner), /TEST_ONLY_CONNECTION_LOST/);
  assert.ok(lost.discarded);
  assert.equal(lost.calls.some(c => c.sql.includes("FROM public.logistica_delivery_evidence")), false);
  lost.done();
});
