const test = require("node:test");
const assert = require("node:assert/strict");
const { createDeliveryHistoryRepository } = require("../repositories/logisticaDeliveryHistory");
const { normalizeDeliveryHistoryQuery, deliveryHistoryPage } = require("../services/logisticaDeliveryHistoryPolicy");
const { fixture, mapping, legacy, delivery } = require("./helpers/logisticaDeliveryHistoryFixture");

async function page(f, query = {}, authorizedUserId = "1") {
  const input = normalizeDeliveryHistoryQuery(query);
  return deliveryHistoryPage(await createDeliveryHistoryRepository(f.pool).list(input, { authorizedUserId }), input);
}

test("Sin mapping, incluso email igual a allowlist, legacy invisible", async () => {
  const f = fixture({ legacyRows: [legacy()] });
  assert.deepEqual((await page(f)).legacy, { items: [], next_cursor: null });
});

test("Mapping activo propio exacto hace visible legacy sin multiplicar filas", async () => {
  const f = fixture({ legacyRows: [legacy()], mappings: [mapping(), mapping()] });
  assert.equal((await page(f)).legacy.items.length, 1);
});

test("Mapping revocado o de otro propietario no autoriza", async () => {
  for (const patch of [{ is_active: false }, { authorized_user_id: "2" }]) {
    const f = fixture({ legacyRows: [legacy()], mappings: [mapping(patch)] });
    assert.deepEqual((await page(f)).legacy.items, []);
  }
});

for (const [field, value] of [["source_snapshot_sha256", "f".repeat(64)],
  ["source_sheet", "entregas"], ["legacy_usuario", "test_only_legacy"],
  ["legacy_usuario", "TEST_ONLY_LÉGACY"], ["legacy_usuario", "TEST_ONLY_LEGACY "],
  ["legacy_correo", "TEST@example.invalid"], ["legacy_correo", " test@example.invalid"]]) {
  test("Identidad exacta obligatoria: " + field + "=" + value, async () => {
    const f = fixture({ legacyRows: [legacy()], mappings: [mapping({ [field]: value })] });
    assert.deepEqual((await page(f)).legacy.items, []);
  });
}

test("CURRENT mantiene ownership y COMPLETED; PHOTO UPLOADED excluye firma/pending", async () => {
  const f = fixture({ deliveries: [delivery(), delivery({ id: "21", authorized_user_id: "2" }),
    delivery({ id: "22", status: "PENDING_EVIDENCE" }), delivery({ id: "23", status: "FAILED" })],
  evidences: [{ delivery_id: "20", evidence_type: "PHOTO", status: "UPLOADED" },
    { delivery_id: "20", evidence_type: "PHOTO", status: "UPLOADED" },
    { delivery_id: "20", evidence_type: "SIGNATURE", status: "UPLOADED" },
    { delivery_id: "20", evidence_type: "PHOTO", status: "PENDING" }] });
  const result = await page(f);
  assert.deepEqual(result.current.items.map(r => [r.id, r.photo_count, r.status]), [["20", 2, "COMPLETED"]]);
});

test("Búsqueda substring literal en ambas fuentes siempre preserva ownership", async () => {
  const pedido = "%_' OR 1=1 --";
  const f = fixture({ deliveries: [delivery({ pedido }), delivery({ id: "21", pedido, authorized_user_id: "2" })],
    legacyRows: [legacy({ pedido }), legacy({ legacy_key: "b".repeat(64), pedido: "normal" })], mappings: [mapping()] });
  const result = await page(f, { pedido });
  assert.equal(result.current.items.length, 1);
  assert.equal(result.legacy.items.length, 1);
  assert.ok(f.calls.every(c => !c.sql.includes(pedido)));
});

test("Ambos cursores avanzan por empates sin duplicados ni cronología mezclada", async () => {
  const f = fixture({ deliveries: ["9007199254740993", "9007199254740992", "9"].map(id => delivery({ id })),
    legacyRows: ["a", "b", "c"].map(k => legacy({ legacy_key: k.repeat(64) })), mappings: [mapping()] });
  const current = [], historical = [];
  let query = { limit: "1" };
  for (let i = 0; i < 3; i++) {
    const result = await page(f, query);
    current.push(result.current.items[0].id); historical.push(result.legacy.items[0].id);
    query = { limit: "1", current_cursor: result.current.next_cursor, legacy_cursor: result.legacy.next_cursor };
    if (i === 2) assert.deepEqual([query.current_cursor, query.legacy_cursor], [null, null]);
  }
  assert.deepEqual(current, ["9007199254740993", "9007199254740992", "9"]);
  assert.deepEqual(historical, ["c", "b", "a"].map(c => c.repeat(64)));
});

test("Paginación legacy conserva NULL temporal y microsegundos sin omitir filas", async () => {
  const f = fixture({ mappings: [mapping()], legacyRows: [
    legacy({ legacy_key: "a".repeat(64), recorded_local_at: null }),
    legacy({ legacy_key: "b".repeat(64), recorded_local_at: null }),
    legacy({ legacy_key: "c".repeat(64), recorded_local_at: "2024-01-01T00:00:00.000002" }),
    legacy({ legacy_key: "d".repeat(64), recorded_local_at: "2024-01-01T00:00:00.000001" }),
  ] });
  const ids = [];
  let cursor;
  do {
    const result = await page(f, { limit: "1", ...(cursor ? { legacy_cursor: cursor } : {}) });
    ids.push(...result.legacy.items.map(r => r.id)); cursor = result.legacy.next_cursor;
    assert.ok(ids.length <= 4);
  } while (cursor);
  assert.deepEqual(ids, ["b", "a", "c", "d"].map(c => c.repeat(64)));
});

test("Revocar entre páginas oculta filas restantes aun con cursor válido", async () => {
  const m = mapping();
  const f = fixture({ mappings: [m], legacyRows: [legacy(), legacy({ legacy_key: "b".repeat(64) })] });
  const first = await page(f, { limit: "1" });
  m.is_active = false;
  assert.deepEqual((await page(f, { limit: "1", legacy_cursor: first.legacy.next_cursor })).legacy.items, []);
});

test("GET no cambia fixtures y solo ejecuta SELECT parametrizados", async () => {
  const data = { deliveries: [delivery()], legacyRows: [legacy()], mappings: [mapping()] };
  const before = structuredClone(data), f = fixture(data);
  await page(f);
  assert.deepEqual(data, before);
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|nextval)\b/i);
});
