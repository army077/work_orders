const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCompletionInput, assertCompletionEvidence, resolveCompletionCoordinates,
} = require("../services/logisticaCompletionPolicy");

const invalid = err => err.status === 400;
const conflict = err => err.status === 409;

test("Finalización acepta JSON omitido o vacío y GPS cero o límites inclusivos", () => {
  assert.deepEqual(normalizeCompletionInput("1"), { deliveryId: "1", coordinates: null });
  assert.equal(normalizeCompletionInput("1", {}).coordinates, null);
  for (const [latitude, longitude] of [[0, 0], [-90, -180], [90, 180]]) {
    assert.deepEqual(normalizeCompletionInput("1", { latitude, longitude }).coordinates, { latitude, longitude });
  }
});

for (const [description, body] of [
  ["solo latitude", { latitude: 20 }],
  ["solo longitude", { longitude: -103 }],
  ["latitude string", { latitude: "20", longitude: -103 }],
  ["longitude string", { latitude: 20, longitude: "-103" }],
  ["latitude fuera de rango", { latitude: 90.001, longitude: 0 }],
  ["longitude fuera de rango", { latitude: 0, longitude: -180.001 }],
  ["latitude NaN", { latitude: NaN, longitude: 0 }],
  ["longitude NaN", { latitude: 0, longitude: NaN }],
  ["latitude infinita", { latitude: Infinity, longitude: 0 }],
  ["longitude infinita", { latitude: 0, longitude: -Infinity }],
  ["GPS null explícito", { latitude: null, longitude: null }],
  ["GPS booleano", { latitude: true, longitude: false }],
  ["GPS con arrays", { latitude: [20], longitude: [-103] }],
  ["identidad del cliente", { authorized_user_id: "TEST_ONLY_OTHER_USER" }],
  ["body null", null], ["body array", []], ["body string", "GPS"],
]) {
  test(`Finalización rechaza ${description} con 400`, () => {
    assert.throws(() => normalizeCompletionInput("1", body), invalid);
  });
}

test("Finalización rechaza ID inválido antes de usar PostgreSQL", () => {
  for (const id of ["0", "-1", "01", "1.5", "9223372036854775808", "1 OR true", undefined]) {
    assert.throws(() => normalizeCompletionInput(id), invalid);
  }
});

test("Evidencia mínima valida PHOTO y SIGNATURE por estado, con exactamente una firma", () => {
  assert.doesNotThrow(() => assertCompletionEvidence({ photo_uploaded: "2", signature_uploaded: "1", pending: "0", failed: "0" }));
  for (const patch of [{ photo_uploaded: 0 }, { signature_uploaded: 0 }, { signature_uploaded: 2 }, { pending: 1 }, { failed: 1 }]) {
    assert.throws(() => assertCompletionEvidence({ photo_uploaded: 1, signature_uploaded: 1, pending: 0, failed: 0, ...patch }), conflict);
  }
});

test("GPS original NUMERIC se copia sin perder precisión y el request tiene prioridad", () => {
  const original = { latitude: "20.1234567890123456789", longitude: "-103.1234567890123456789" };
  assert.deepEqual(resolveCompletionCoordinates(null, original), original);
  const gps = { latitude: 0, longitude: 0 };
  assert.deepEqual(resolveCompletionCoordinates(gps, original), gps);
  assert.deepEqual(original, { latitude: "20.1234567890123456789", longitude: "-103.1234567890123456789" });
  for (const delivery of [{}, { latitude: null, longitude: null }, { latitude: 20, longitude: null }]) {
    assert.throws(() => resolveCompletionCoordinates(null, delivery), conflict);
  }
});
