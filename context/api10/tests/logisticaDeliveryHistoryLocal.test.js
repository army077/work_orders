const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, randomInt, createHash } = require("node:crypto");
const { Client } = require("pg");
const { createDeliveryHistoryRepository } = require("../repositories/logisticaDeliveryHistory");
const { createDeliveryHistoryHandler } = require("../routes/logisticaDeliveryHistory");
const { createDeliveryListRepository } = require("../repositories/logisticaDeliveryList");
const { createDeliveryListHandler } = require("../routes/logisticaDeliveryList");
const { request, response } = require("./helpers/logisticaDeliveryHistoryFixture");

// Real LOCAL PostgreSQL + real handlers; no Firebase authentication is simulated
// as an E2E result. No HTTP/Drive/Firebase calls. Every fixture is rolled back.
// Run from context/api10:
// node --env-file=.env.local --test --test-isolation=none tests/logisticaDeliveryHistoryLocal.test.js
// with RUN_LOGISTICA_DELIVERY_HISTORY_LOCAL_TESTS=1.
const TABLES = ["logistica_deliveries", "logistica_delivery_evidence",
  "entregas_logistica_legacy", "logistica_authorized_users", "logistica_legacy_owner_mapping"];
const hash = value => createHash("sha256").update(value).digest("hex");

async function state(client) {
  const result = {};
  for (const table of TABLES) {
    const rows = (await client.query("SELECT to_jsonb(t)::text AS data FROM public." + table + " t ORDER BY id")).rows;
    const sequence = (await client.query("SELECT last_value::text, is_called FROM public." + table + "_id_seq")).rows[0];
    result[table] = { count: rows.length, digest: hash(JSON.stringify(rows)), sequence };
  }
  return result;
}

test("Historial PostgreSQL LOCAL real: fixtures ficticios y rollback total", {
  skip: process.env.RUN_LOGISTICA_DELIVERY_HISTORY_LOCAL_TESTS !== "1",
}, async t => {
  assert.equal(process.env.APP_ENV, "local");
  assert.ok(["localhost", "127.0.0.1", "::1"].includes(process.env.PGHOST));
  assert.equal(process.env.PGPORT, "5432");
  assert.equal(process.env.PGDATABASE, "artecnologia_test_local");
  assert.equal(process.env.PGUSER, "workorders_test");
  assert.ok(process.env.PGPASSWORD);
  const client = new Client({ host: "127.0.0.1", port: 5432, database: "artecnologia_test_local",
    user: "workorders_test", password: process.env.PGPASSWORD, ssl: false, connectionTimeoutMillis: 5000 });
  let open = false;
  try {
    await client.connect();
    assert.deepEqual((await client.query("SELECT current_database() db,current_user role,"
      + "host(inet_server_addr()) host,inet_server_port() port")).rows[0], {
      db: "artecnologia_test_local", role: "workorders_test", host: "127.0.0.1", port: 5432,
    });
    await client.query("BEGIN"); open = true;
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("LOCK TABLE " + TABLES.map(n => "public." + n).join(",") + " IN SHARE ROW EXCLUSIVE MODE");
    const before = await state(client);
    assert.equal(before.logistica_legacy_owner_mapping.count, 0, "No fixtures con mappings reales existentes");
    const scope = randomUUID(), snapshot = "e".repeat(64);
    const base = 8000000000000000000n + BigInt(randomInt(1000000)) * 100n;
    const id = n => String(base + BigInt(n));
    for (const table of TABLES) {
      assert.equal((await client.query("SELECT count(*)::int n FROM public." + table
        + " WHERE id BETWEEN $1::bigint AND $2::bigint", [id(0), id(99)])).rows[0].n, 0);
    }
    const email = "test-only-history-" + scope + "@example.invalid", name = "TEST_ONLY_HISTORY_" + scope;
    for (const n of [1, 2]) {
      await client.query("INSERT INTO public.logistica_authorized_users "
        + "(id,firebase_project,firebase_uid,email,display_name) VALUES ($1,'logistica-ar',$2,$3,$4)",
      [id(n), "TEST_ONLY_HISTORY_" + scope + n, email, name]);
    }
    for (const [n, owner, status] of [[3, 1, "COMPLETED"], [4, 1, "COMPLETED"],
      [5, 2, "COMPLETED"], [6, 1, "PENDING_EVIDENCE"], [7, 1, "FAILED"]]) {
      await client.query("INSERT INTO public.logistica_deliveries "
        + "(id,client_request_id,authorized_user_id,firebase_project,firebase_uid,pedido,equipos,chofer,"
        + "auth_email,auth_display_name,status,created_at,completed_at,completion_latitude,completion_longitude) "
        + "VALUES($1,$2,$3,'logistica-ar',$4,$5,'TEST_ONLY_EQUIPO','TEST_ONLY_CHOFER',$6,$7,$8,"
        + "'2026-10-21T18:26:59.463123Z',CASE WHEN $8='COMPLETED' THEN '2026-10-21T18:27:00Z'::timestamptz END,"
        + "CASE WHEN $8='COMPLETED' THEN 20 END,CASE WHEN $8='COMPLETED' THEN -103 END)",
      [id(n), randomUUID(), id(owner), "TEST_ONLY_HISTORY_" + scope + owner,
        "TEST_ONLY_HISTORY_" + scope + "_%_12345", email, name, status]);
    }
    for (const [n, type, status, sequence] of [[10, "PHOTO", "UPLOADED", 1], [11, "PHOTO", "UPLOADED", 2],
      [12, "SIGNATURE", "UPLOADED", 1], [13, "PHOTO", "PENDING", 3], [14, "PHOTO", "FAILED", 4]]) {
      await client.query("INSERT INTO public.logistica_delivery_evidence "
        + "(id,delivery_id,client_evidence_id,evidence_type,sequence_no,status,storage_provider,"
        + "external_file_id,mime_type,file_size_bytes,sha256) VALUES($1,$2,$3,$4,$5,$6,'GOOGLE_DRIVE',$7,$8,1,$9)",
      [id(n), id(4), randomUUID(), type, sequence, status, "TEST_ONLY_NO_DRIVE_" + scope + n,
        type === "PHOTO" ? "image/jpeg" : "image/png", "a".repeat(64)]);
    }
    const legacyKeys = [hash(scope + ":legacy1"), hash(scope + ":legacy2")].sort().reverse();
    for (const [i, key] of legacyKeys.entries()) {
      await client.query("INSERT INTO public.entregas_logistica_legacy "
        + "(id,source_snapshot_sha256,source_sheet,source_row,legacy_key,content_hash,usuario,correo,pedido,"
        + "local_datetime,legacy_image_count,raw_payload,import_batch_id) "
        + "VALUES($1,$2,'Entregas',$3,$4,$5,$6,$7,$8,'2023-12-04T10:29:47',$9,$10,$11)",
      [id(20 + i), snapshot, i + 2, key, hash(scope + ":content" + i), name, email,
        "TEST_ONLY_HISTORY_" + scope + "_%_12345", i ? 17 : 15, JSON.stringify({ test_only: true }), scope]);
    }

    const readPool = { query(sql, params) {
      assert.match(sql.trim(), /^(SELECT|WITH)\b/);
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|nextval)\b/i);
      return client.query(sql, params);
    } };
    const history = createDeliveryHistoryHandler({ repository: createDeliveryHistoryRepository(readPool) });
    const old = createDeliveryListHandler({ repository: createDeliveryListRepository(readPool) });
    async function get(query = {}, owner = id(1), handler = history) {
      const res = response();
      // Synthetic authenticated context for handler/repository tests only.
      await handler(request({ query, logisticaUser: { id: owner } }), res);
      assert.equal(res.code, 200);
      return res.body;
    }
    async function addMapping(patch = {}) {
      const record = { id: id(30), source_snapshot_sha256: snapshot, source_sheet: "Entregas",
        legacy_usuario: name, legacy_correo: email, authorized_user_id: id(1),
        approval_basis: "TEST ONLY: aprobacion ficticia de fixtures sinteticos, ROLLBACK obligatorio.",
        approved_by: "TEST_ONLY_HISTORY_REVIEWER", ...patch };
      const keys = Object.keys(record);
      await client.query("INSERT INTO public.logistica_legacy_owner_mapping (" + keys.join(",")
        + ") VALUES (" + keys.map((_, i) => "$" + (i + 1)).join(",") + ")", Object.values(record));
    }
    async function revoke() {
      await client.query("UPDATE public.logistica_legacy_owner_mapping SET is_active=false,"
        + "revoked_at=clock_timestamp(),revoked_by='TEST_ONLY_HISTORY_REVIEWER',"
        + "revocation_reason='TEST ONLY: revocacion de fixture temporal' WHERE id=$1", [id(30)]);
    }
    async function check(name, fn) {
      await t.test(name, async () => {
        await client.query("SAVEPOINT history_case");
        try { await fn(); }
        finally { await client.query("ROLLBACK TO SAVEPOINT history_case"); await client.query("RELEASE SAVEPOINT history_case"); }
      });
    }

    await check("Sin mapping, correo legacy igual a allowlist no concede ownership", async () => {
      const body = await get(); assert.deepEqual(body.legacy.items, []);
    });
    await addMapping();
    await check("Mapping exacto activo publica dos legacy y contrato fiel", async () => {
      const items = (await get()).legacy.items;
      assert.deepEqual(items.map(r => r.id), legacyKeys);
      assert.deepEqual(items.map(r => r.legacy_image_count), [15, 17]);
      for (const r of items) {
        assert.equal(r.source, "LEGACY"); assert.equal(r.status, null);
        assert.equal(r.legacy_record_state, "RECORDED"); assert.equal(r.created_at, null);
        assert.equal(r.recorded_local_at, "2023-12-04T10:29:47"); assert.equal(r.time_zone, null);
        assert.equal(r.photo_count, null); assert.equal(r.display_name, name); assert.equal(r.email, email);
      }
    });
    await check("Revocar mapping oculta legacy inmediatamente", async () => {
      const first = await get({ limit: "1" }); await revoke();
      assert.deepEqual((await get({ limit: "1", legacy_cursor: first.legacy.next_cursor })).legacy.items, []);
    });
    await check("Mapping a otro usuario no es visible para usuario original", async () => {
      await revoke(); await addMapping({ id: id(31), authorized_user_id: id(2) });
      assert.deepEqual((await get()).legacy.items, []);
      assert.equal((await get({}, id(2))).legacy.items.length, 2);
    });
    for (const [column, value] of [["source_snapshot_sha256", "f".repeat(64)], ["source_sheet", "entregas"],
      ["legacy_usuario", name.toLowerCase()], ["legacy_usuario", name + " "],
      ["legacy_correo", email.toUpperCase()], ["legacy_correo", " " + email]]) {
      await check("PostgreSQL exige coincidencia exacta " + column + " / " + (value === value.trim() ? "case/scope" : "espacios"), async () => {
        await revoke(); await addMapping({ id: id(31), [column]: value });
        assert.deepEqual((await get()).legacy.items, []);
      });
    }
    await check("CURRENT solo propietario y COMPLETED con conteo PHOTO UPLOADED", async () => {
      const items = (await get()).current.items;
      assert.deepEqual(items.map(r => r.id), [id(4), id(3)]);
      assert.deepEqual(items.map(r => r.photo_count), [2, 0]);
      for (const r of items) {
        assert.equal(r.source, "CURRENT"); assert.equal(r.status, "COMPLETED");
        assert.equal(r.created_at, "2026-10-21T18:26:59.463123Z"); assert.equal(r.time_zone, "UTC");
        assert.equal(r.recorded_local_at, null); assert.equal(r.legacy_record_state, null);
        assert.equal(r.legacy_image_count, null);
      }
      assert.deepEqual((await get({}, id(2))).current.items.map(r => r.id), [id(5)]);
    });
    await check("Búsqueda literal de %_12345 funciona en ambas fuentes", async () => {
      const body = await get({ pedido: "%_12345" });
      assert.equal(body.current.items.length, 2); assert.equal(body.legacy.items.length, 2);
    });
    await check("Ambas secciones sin coincidencias son 200 vacío", async () => {
      assert.deepEqual(await get({ pedido: "TEST_ONLY_NO_MATCH_" + scope }), { ok: true,
        current: { items: [], next_cursor: null }, legacy: { items: [], next_cursor: null } });
    });
    await check("Cursores reales independientes no repiten empates", async () => {
      const first = await get({ limit: "1" });
      assert.equal(first.current.items.length, 1); assert.equal(first.legacy.items.length, 1);
      assert.ok(first.current.next_cursor); assert.ok(first.legacy.next_cursor);
      const next = await get({ limit: "1", current_cursor: first.current.next_cursor, legacy_cursor: first.legacy.next_cursor });
      assert.deepEqual([first.current.items[0].id, next.current.items[0].id], [id(4), id(3)]);
      assert.deepEqual([first.legacy.items[0].id, next.legacy.items[0].id], legacyKeys);
      assert.equal(next.current.next_cursor, null); assert.equal(next.legacy.next_cursor, null);
    });
    await check("Legacy NULL temporal y fracción conservan paginación real", async () => {
      await client.query("UPDATE public.entregas_logistica_legacy SET local_datetime=NULL WHERE id=$1", [id(20)]);
      await client.query("UPDATE public.entregas_logistica_legacy SET local_datetime='2023-12-04T10:29:47.123456' WHERE id=$1", [id(21)]);
      const first = await get({ limit: "1" });
      assert.equal(first.legacy.items[0].recorded_local_at, null);
      const next = await get({ limit: "1", legacy_cursor: first.legacy.next_cursor });
      assert.equal(next.legacy.items[0].recorded_local_at, "2023-12-04T10:29:47.123456");
      assert.equal(next.legacy.next_cursor, null);
    });
    await check("GET existente mantiene solo los siete campos anteriores", async () => {
      const body = await get({}, id(1), old);
      assert.deepEqual(Object.keys(body).sort(), ["items", "next_cursor", "ok"]);
      assert.deepEqual(Object.keys(body.items[0]).sort(), ["auth_display_name", "auth_email", "created_at", "id", "pedido", "photo_count", "status"]);
    });
    await check("GET no altera ninguna fila, estado, ID Drive, mapping ni secuencia", async () => {
      const seeded = await state(client);
      await get(); await get({ limit: "1" }); await get({ pedido: "%_12345" });
      assert.deepEqual(await state(client), seeded);
    });
    await client.query("ROLLBACK"); open = false;
    await t.test("Cleanup total: cero mappings/fixtures; datos y secuencias originales idénticos", async () => {
      assert.deepEqual(await state(client), before);
      console.log("HISTORY_LOCAL_FIXTURES=0 MAPPINGS=0 ORIGINAL_TABLES_AND_SEQUENCES_UNCHANGED=true");
    });
  } finally {
    if (open) { try { await client.query("ROLLBACK"); } catch { /* Connection close also rolls back. */ } }
    await client.end();
  }
});
