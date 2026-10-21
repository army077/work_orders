const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DeliveryHistoryHttpError, normalizeDeliveryHistoryQuery, deliveryHistoryPage,
} = require("../services/logisticaDeliveryHistoryPolicy");
const { legacy, delivery } = require("./helpers/logisticaDeliveryHistoryFixture");
const input = query => normalizeDeliveryHistoryQuery(query);
const page = (rows, query) => deliveryHistoryPage(rows, input(query));
const bad = e => e instanceof DeliveryHistoryHttpError && e.status === 400;
const cursor = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");

test("Historial limit compartido default 25 y extremos 1/100", () => {
  assert.deepEqual(input(), { limit: 25, pedido: null, currentCursor: null, legacyCursor: null });
  for (const limit of ["1", "100"]) assert.equal(input({ limit }).limit, Number(limit));
});

for (const limit of ["0", "101", "-1", "1.5", "abc", "01", "", 1, ["1"], null]) {
  test("Historial rechaza limit " + JSON.stringify(limit), () => {
    assert.throws(() => input({ limit }), bad);
  });
}

test("Búsqueda conserva texto literal y rechaza tipos, NUL y longitud inválida", () => {
  for (const pedido of ["0", "1", "%_\\", " 001 ", "' OR 1=1 --", "x".repeat(200)]) {
    assert.equal(input({ pedido }).pedido, pedido);
  }
  for (const pedido of [null, 1, [], {}, "x".repeat(201), "a\0b"]) {
    assert.throws(() => input({ pedido }), bad);
  }
});

test("Rechaza ownership/estado/query ajenos al contrato", () => {
  for (const key of ["authorized_user_id", "email", "uid", "status", "cursor", "offset"]) {
    assert.throws(() => input({ [key]: "2" }), bad);
  }
  for (const query of [null, [], "query"]) assert.throws(() => input(query), bad);
});

test("CURRENT publica contrato explícito sin perder BIGINT/microsegundos", () => {
  const item = page({ current: [delivery({ id: "9007199254740993", photo_count: "2" })], legacy: [] }).current.items[0];
  assert.deepEqual(item, {
    source: "CURRENT", id: "9007199254740993", pedido: "9999998", display_name: "TEST_ONLY_NAME",
    email: "test@example.invalid", status: "COMPLETED", legacy_record_state: null,
    created_at: "2026-10-21T17:11:21.545123Z", recorded_local_at: null, time_zone: "UTC",
    photo_count: 2, legacy_image_count: null,
  });
});

test("LEGACY es RECORDED, no convierte fecha, contador 17 no es photo_count", () => {
  const item = page({ current: [], legacy: [legacy({ status: "COMPLETED", photo_count: 999,
    firebase_uid: "TEST_ONLY_PRIVATE", drive_folder_id: "TEST_ONLY_PRIVATE" })] }).legacy.items[0];
  assert.deepEqual(item, {
    source: "LEGACY", id: "a".repeat(64), pedido: "000123", display_name: "TEST_ONLY_LEGACY",
    email: "test@example.invalid", status: null, legacy_record_state: "RECORDED", created_at: null,
    recorded_local_at: "2023-12-04T10:29:47", time_zone: null, photo_count: null, legacy_image_count: 17,
  });
});

test("LEGACY fecha independiente de TZ del host y conserva microsegundos y NULL", () => {
  const previous = process.env.TZ;
  try {
    for (const tz of ["UTC", "America/Mexico_City", "Asia/Tokyo"]) {
      process.env.TZ = tz;
      for (const date of [null, "2024-02-29T10:29:47.123456", "2023-12-04T10:29:47"]) {
        const item = page({ current: [], legacy: [legacy({ recorded_local_at: date,
          pedido: null, usuario: null, correo: null, legacy_image_count: null })] }).legacy.items[0];
        assert.equal(item.recorded_local_at, date);
        assert.equal(item.time_zone, null);
      }
    }
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test("Rechaza fechas legacy con zona, Date, calendario inválido o campos dañados", () => {
  for (const date of [undefined, new Date(), "2023-12-04T10:29:47Z", "2023-12-04T10:29:47-06:00",
    "2023-02-29T10:29:47", "0000-01-01T00:00:00", "2024-13-01T00:00:00", "2024-01-01T24:00:00"]) {
    assert.throws(() => page({ current: [], legacy: [legacy({ recorded_local_at: date })] }));
  }
  for (const patch of [{ legacy_key: "bad" }, { usuario: {} }, { correo: 1 }, { pedido: 2 },
    { legacy_image_count: "15" }, { legacy_image_count: NaN }]) {
    assert.throws(() => page({ current: [], legacy: [legacy(patch)] }));
  }
  assert.throws(() => page({ current: [delivery({ status: "PENDING_EVIDENCE", photo_count: "0" })], legacy: [] }));
});

test("Cursores independientes son versionados, ligados a sección y búsqueda", () => {
  const first = page({ current: [delivery({ photo_count: "0" }), delivery({ photo_count: "0" })],
    legacy: [legacy(), legacy({ legacy_key: "b".repeat(64) })] }, { limit: "1", pedido: "123" });
  const parsed = input({ limit: "1", pedido: "123", current_cursor: first.current.next_cursor,
    legacy_cursor: first.legacy.next_cursor });
  assert.deepEqual(parsed.currentCursor, { createdAt: "2026-10-21T17:11:21.545123Z", id: "20" });
  assert.deepEqual(parsed.legacyCursor, { localDatetime: "2023-12-04T10:29:47", id: "a".repeat(64) });
  assert.throws(() => input({ pedido: "123", current_cursor: first.legacy.next_cursor }), bad);
  assert.throws(() => input({ pedido: "123", legacy_cursor: first.current.next_cursor }), bad);
  assert.throws(() => input({ legacy_cursor: first.legacy.next_cursor }), bad);
});

test("Cursores corruptos o modificados fallan 400", () => {
  const base = { v: 1, source: "LEGACY", pedido: null,
    key: { id: "a".repeat(64), local_datetime: "2023-12-04T10:29:47" } };
  const values = ["", "a", "=", "!", "x".repeat(2049), null, [], 3,
    cursor(null), cursor([]), cursor({}), cursor({ ...base, v: 2 }),
    cursor({ ...base, extra: true }), cursor({ ...base, key: { ...base.key, id: "26" } }),
    cursor({ ...base, key: { ...base.key, local_datetime: "2023-12-04T10:29:47Z" } })];
  for (const legacy_cursor of values) assert.throws(() => input({ legacy_cursor }), bad);
});

test("Dos secciones vacías conservan contrato sin cursores", () => {
  assert.deepEqual(page({ current: [], legacy: [] }), { ok: true,
    current: { items: [], next_cursor: null }, legacy: { items: [], next_cursor: null } });
});
