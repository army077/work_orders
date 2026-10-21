const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DeliveryListHttpError, normalizeDeliveryListQuery, encodeDeliveryListCursor,
  decodeDeliveryListCursor, deliveryListPage,
} = require("../services/logisticaDeliveryListPolicy");
const { delivery } = require("./helpers/logisticaDeliveryListFixture");

const badRequest = error => error instanceof DeliveryListHttpError && error.status === 400;
const rawCursor = value => Buffer.from(JSON.stringify(value)).toString("base64url");

test("Listado usa limit 25 por defecto y permite límites 1 y 100", () => {
  assert.deepEqual(normalizeDeliveryListQuery(), { limit: 25, pedido: null, cursor: null });
  for (const limit of ["1", "25", "100"]) {
    assert.equal(normalizeDeliveryListQuery({ limit }).limit, Number(limit));
  }
});

for (const limit of ["0", "101", "-1", "texto", "1.5", "1e2", " 25", "", "01", ["1", "2"], 25, {}]) {
  test("Listado rechaza limit inválido " + JSON.stringify(limit), () => {
    assert.throws(() => normalizeDeliveryListQuery({ limit }), badRequest);
  });
}

test("Búsqueda conserva substring literal, espacios, ceros y caracteres SQL", () => {
  for (const pedido of ["000123", "%_\\", " TEST ", "' OR 1=1 --"]) {
    assert.equal(normalizeDeliveryListQuery({ pedido }).pedido, pedido);
  }
  assert.equal(normalizeDeliveryListQuery({ pedido: "" }).pedido, null);
  assert.equal(normalizeDeliveryListQuery({ pedido: "x".repeat(200) }).pedido.length, 200);
});

test("Listado rechaza búsqueda de tipo/longitud inválidos y NUL", () => {
  for (const pedido of [1, null, {}, ["1"], "x".repeat(201), "a\u0000b"]) {
    assert.throws(() => normalizeDeliveryListQuery({ pedido }), badRequest);
  }
});

test("Query no admite ownership, estado ni parámetros ajenos", () => {
  for (const key of ["firebase_uid", "email", "authorized_user_id", "propietario", "status", "offset"]) {
    assert.throws(() => normalizeDeliveryListQuery({ [key]: "TEST_ONLY_FORGED" }), badRequest);
  }
  for (const query of [null, [], "limit=1"]) {
    assert.throws(() => normalizeDeliveryListQuery(query), badRequest);
  }
});

test("Cursor opaco conserva los microsegundos y BIGINT máximo sin redondear", () => {
  const row = { created_at: "2026-10-21T17:11:21.545123Z", id: "9223372036854775807" };
  const cursor = encodeDeliveryListCursor(row);
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeDeliveryListCursor(cursor), { createdAt: row.created_at, id: row.id });
  assert.deepEqual(normalizeDeliveryListQuery({ cursor }).cursor,
    { createdAt: row.created_at, id: row.id });
});

test("Cursor inválido, calendario inexistente o ID fuera de rango devuelven 400", () => {
  const base = { created_at: "2026-10-21T17:11:21.545123Z", id: "20" };
  const invalid = [
    "", "a", "!@", "=", "x".repeat(513), [], {}, 1,
    Buffer.from("{incompleto").toString("base64url"),
    rawCursor(null), rawCursor([]), rawCursor({}), rawCursor({ ...base, extra: true }),
    rawCursor({ ...base, id: "0" }), rawCursor({ ...base, id: "9223372036854775808" }),
    rawCursor({ ...base, id: 20 }), rawCursor({ ...base, id: "1 OR 1=1" }),
    rawCursor({ ...base, created_at: "2026-02-30T17:11:21.545123Z" }),
    rawCursor({ ...base, created_at: "2026-10-21T25:11:21.545123Z" }),
    rawCursor({ ...base, created_at: "2026-10-21T17:11:21.5451234Z" }),
    rawCursor({ ...base, created_at: "2026-10-21T17:11:21.545+00:00" }),
  ];
  for (const cursor of invalid) {
    assert.throws(() => normalizeDeliveryListQuery({ cursor }), badRequest, JSON.stringify(cursor));
  }
});

test("Página vacía tiene contrato explícito y sin cursor", () => {
  assert.deepEqual(deliveryListPage([], 25), { ok: true, items: [], next_cursor: null });
});

test("Respuesta convierte BIGINT a string, respeta null y expone solo siete campos", () => {
  const item = deliveryListPage([delivery({
    id: 9223372036854775807n, auth_display_name: null, auth_email: null,
    photo_count: "1", firebase_uid: "TEST_ONLY_PRIVATE", drive_folder_id: "TEST_ONLY_PRIVATE",
    latitude: 20, external_url: "TEST_ONLY_PRIVATE", bytes: "TEST_ONLY_PRIVATE",
  })], 25).items[0];
  assert.deepEqual(item, {
    id: "9223372036854775807", pedido: "9999998",
    auth_display_name: null, auth_email: null,
    created_at: "2026-10-21T17:11:21.545123Z", status: "COMPLETED", photo_count: 1,
  });
  assert.doesNotThrow(() => JSON.stringify(item));
});

test("Cursor siguiente corresponde al último incluido, nunca a la fila extra", () => {
  const page = deliveryListPage([
    delivery({ id: "30", photo_count: "0" }),
    delivery({ id: "20", photo_count: "0" }),
    delivery({ id: "10", photo_count: "0" }),
  ], 2);
  assert.deepEqual(page.items.map(row => row.id), ["30", "20"]);
  assert.equal(decodeDeliveryListCursor(page.next_cursor).id, "20");
  assert.equal(deliveryListPage([delivery({ photo_count: "0" })], 1).next_cursor, null);
});

test("Datos internos inválidos fallan cerrados en vez de publicar resultados incorrectos", () => {
  for (const patch of [
    { status: "PENDING_EVIDENCE" }, { status: "FAILED" },
    { id: Number.MAX_SAFE_INTEGER + 1 }, { created_at: "invalido" },
    { photo_count: "-1" }, { photo_count: "1.5" }, { photo_count: null },
  ]) {
    assert.throws(() => deliveryListPage([delivery({ photo_count: "0", ...patch })], 25));
  }
});
