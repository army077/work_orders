const test = require("node:test");
const assert = require("node:assert/strict");
const { createDeliveryListRepository } = require("../repositories/logisticaDeliveryList");
const { normalizeDeliveryListQuery, deliveryListPage } = require("../services/logisticaDeliveryListPolicy");
const { delivery, fixture } = require("./helpers/logisticaDeliveryListFixture");

async function page(f, query = {}, authorizedUserId = "1") {
  const input = normalizeDeliveryListQuery(query);
  const rows = await createDeliveryListRepository(f.pool).list(input, { authorizedUserId });
  return deliveryListPage(rows, input.limit);
}

test("Listado vacío consulta una vez con ownership, sin OFFSET y limit default + 1", async () => {
  const f = fixture();
  assert.deepEqual(await page(f), { ok: true, items: [], next_cursor: null });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].params, ["1", null, null, null, 26]);
});

test("Solo devuelve COMPLETED y excluye PENDING_EVIDENCE y FAILED", async () => {
  const f = fixture({ deliveries: [
    delivery({ id: "1", status: "PENDING_EVIDENCE" }),
    delivery({ id: "2", status: "FAILED" }),
    delivery({ id: "3", status: "COMPLETED" }),
  ] });
  assert.deepEqual((await page(f)).items.map(row => row.id), ["3"]);
});

test("Usuario A nunca ve registros de B y B nunca ve los de A", async () => {
  const f = fixture({ deliveries: [
    delivery({ id: "1", authorized_user_id: "1" }),
    delivery({ id: "2", authorized_user_id: "2" }),
    delivery({ id: "3", authorized_user_id: "1" }),
  ] });
  assert.deepEqual((await page(f, {}, "1")).items.map(row => row.id), ["3", "1"]);
  assert.deepEqual((await page(f, {}, "2")).items.map(row => row.id), ["2"]);
  assert.deepEqual((await page(f, {}, "3")).items, []);
});

test("photo_count solo cuenta PHOTO UPLOADED sin duplicar entregas", async () => {
  const f = fixture({
    deliveries: [delivery(), delivery({ id: "21" })],
    evidences: [
      { delivery_id: "20", evidence_type: "PHOTO", status: "UPLOADED" },
      { delivery_id: "20", evidence_type: "PHOTO", status: "UPLOADED" },
      { delivery_id: "20", evidence_type: "SIGNATURE", status: "UPLOADED" },
      { delivery_id: "20", evidence_type: "PHOTO", status: "PENDING" },
      { delivery_id: "20", evidence_type: "PHOTO", status: "FAILED" },
      { delivery_id: "999", evidence_type: "PHOTO", status: "UPLOADED" },
    ],
  });
  assert.deepEqual((await page(f)).items.map(row => [row.id, row.photo_count]), [
    ["21", 0], ["20", 2],
  ]);
});

test("Orden es created_at DESC y desempate BIGINT numérico DESC", async () => {
  const f = fixture({ deliveries: [
    delivery({ id: "9" }), delivery({ id: "10" }),
    delivery({ id: "9007199254740992" }), delivery({ id: "9007199254740993" }),
    delivery({ id: "1", created_at: "2026-10-21T17:11:21.545124Z" }),
    delivery({ id: "99", created_at: "2026-10-21T17:11:21.545122Z" }),
  ] });
  assert.deepEqual((await page(f)).items.map(row => row.id), [
    "1", "9007199254740993", "9007199254740992", "10", "9", "99",
  ]);
});

test("limit 1 y 100 solicitan exactamente limit + 1", async () => {
  const f = fixture({ deliveries: [delivery()] });
  for (const limit of ["1", "100"]) {
    const result = await page(f, { limit });
    assert.equal(result.items.length, 1);
    assert.equal(result.next_cursor, null);
    assert.equal(f.calls.at(-1).params[4], Number(limit) + 1);
  }
});

test("Default 25 devuelve cursor únicamente cuando existe una fila adicional", async () => {
  const f = fixture({ deliveries: Array.from({ length: 26 }, (_, index) =>
    delivery({ id: String(index + 1) })) });
  const first = await page(f);
  assert.equal(first.items.length, 25);
  assert.equal(typeof first.next_cursor, "string");
  const second = await page(f, { cursor: first.next_cursor });
  assert.deepEqual(second.items.map(row => row.id), ["1"]);
  assert.equal(second.next_cursor, null);
});

test("Páginas no repiten ni omiten registros con microsegundos y BIGINT cercanos", async () => {
  const f = fixture({ deliveries: [
    delivery({ id: "50", created_at: "2026-10-21T17:11:21.545003Z" }),
    delivery({ id: "9007199254740993", created_at: "2026-10-21T17:11:21.545002Z" }),
    delivery({ id: "9007199254740992", created_at: "2026-10-21T17:11:21.545002Z" }),
    delivery({ id: "30", created_at: "2026-10-21T17:11:21.545001Z" }),
    delivery({ id: "20", created_at: "2026-10-21T17:11:21.545000Z" }),
  ] });
  const ids = [];
  let cursor;
  let pages = 0;
  do {
    const result = await page(f, { limit: "2", ...(cursor ? { cursor } : {}) });
    ids.push(...result.items.map(row => row.id));
    cursor = result.next_cursor;
    assert.ok(++pages <= 3, "La paginación debe avanzar");
  } while (cursor);
  assert.deepEqual(ids, ["50", "9007199254740993", "9007199254740992", "30", "20"]);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(f.calls[1].params[2], "2026-10-21T17:11:21.545002Z");
});

test("Búsqueda es literal, parametrizada y sigue restringida por usuario/estado", async () => {
  const needle = "%_' OR 1=1 --";
  const f = fixture({ deliveries: [
    delivery({ id: "1", pedido: "antes" + needle + "después" }),
    delivery({ id: "2", pedido: "antes" + needle, authorized_user_id: "2" }),
    delivery({ id: "3", pedido: needle, status: "PENDING_EVIDENCE" }),
    delivery({ id: "4", pedido: needle, status: "FAILED" }),
    delivery({ id: "5", pedido: "pedido-normal" }),
  ] });
  const result = await page(f, { pedido: needle });
  assert.deepEqual(result.items.map(row => row.id), ["1"]);
  assert.equal(f.calls[0].params[1], needle);
  assert.equal(f.calls[0].sql.includes(needle), false);
  assert.deepEqual((await page(f, { pedido: "sin coincidencias" })).items, []);
});

test("Cursor y búsqueda juntos nunca eliminan el filtro por propietario", async () => {
  const f = fixture({ deliveries: [
    delivery({ id: "3", pedido: "000123" }),
    delivery({ id: "2", pedido: "000123", authorized_user_id: "2" }),
    delivery({ id: "1", pedido: "000123" }),
  ] });
  const first = await page(f, { limit: "1", pedido: "001" });
  assert.deepEqual(first.items.map(row => row.id), ["3"]);
  const second = await page(f, { limit: "1", pedido: "001", cursor: first.next_cursor });
  assert.deepEqual(second.items.map(row => row.id), ["1"]);
  assert.equal(second.next_cursor, null);
});
