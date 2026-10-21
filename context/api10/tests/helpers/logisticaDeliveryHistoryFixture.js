const assert = require("node:assert/strict");
const Module = require("node:module");
const { fixture: currentFixture, delivery } = require("./logisticaDeliveryListFixture");

function legacy(patch = {}) {
  return {
    legacy_key: "a".repeat(64), source_snapshot_sha256: "e".repeat(64),
    source_sheet: "Entregas", usuario: "TEST_ONLY_LEGACY", correo: "test@example.invalid",
    pedido: "000123", recorded_local_at: "2023-12-04T10:29:47.000000", legacy_image_count: 17,
    ...patch,
  };
}

function mapping(patch = {}) {
  return {
    source_snapshot_sha256: "e".repeat(64), source_sheet: "Entregas",
    legacy_usuario: "TEST_ONLY_LEGACY", legacy_correo: "test@example.invalid",
    authorized_user_id: "1", is_active: true, ...patch,
  };
}

// SQL contract double, not a SQL engine. Real SQL runs in the gated LOCAL test.
function fixture({ legacyRows = [], mappings = [], ...currentOptions } = {}) {
  const current = currentFixture(currentOptions);
  const calls = [];
  const dateKey = value => value === null ? null : value.slice(0, 19) + "."
    + (value.split(".")[1] || "").padEnd(6, "0");
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    if (!sql.includes("FROM public.entregas_logistica_legacy")) return current.pool.query(sql, params);
    assert.match(sql, /WHERE EXISTS \([\s\S]*m\.is_active = true AND m\.authorized_user_id = \$1::bigint/);
    for (const [a, b] of [["source_snapshot_sha256", "source_snapshot_sha256"],
      ["source_sheet", "source_sheet"], ["legacy_usuario", "usuario"], ["legacy_correo", "correo"]]) {
      assert.ok(sql.includes('m.' + a + ' = l.' + b + ' COLLATE "C"'));
    }
    assert.match(sql, /strpos\(l\.pedido, \$2::text\) > 0/);
    assert.match(sql, /ORDER BY l\.local_datetime DESC, l\.legacy_key COLLATE "C" DESC/);
    assert.match(sql, /LIMIT \$6::integer/);
    assert.match(sql, /to_char\(l\.local_datetime, 'YYYY-MM-DD"T"HH24:MI:SS\.US'\)/);
    assert.doesNotMatch(sql, /AT TIME ZONE|\b(?:INSERT|UPDATE|DELETE|OFFSET)\b|\blower\(|\btrim\(/i);
    const [owner, pedido, hasCursor, time, key, limit] = params;
    const rows = legacyRows.filter(row => mappings.some(m => m.is_active
      && m.authorized_user_id === owner && m.source_snapshot_sha256 === row.source_snapshot_sha256
      && m.source_sheet === row.source_sheet && m.legacy_usuario === row.usuario
      && m.legacy_correo === row.correo)
      && (pedido === null || row.pedido?.includes(pedido))
      && (!hasCursor || (time === null
        ? row.recorded_local_at !== null || row.legacy_key < key
        : row.recorded_local_at !== null && (dateKey(row.recorded_local_at) < dateKey(time)
          || (dateKey(row.recorded_local_at) === dateKey(time) && row.legacy_key < key)))))
      .sort((a, b) => {
        const ad = dateKey(a.recorded_local_at), bd = dateKey(b.recorded_local_at);
        if (ad !== bd) return ad === null ? -1 : bd === null ? 1 : ad > bd ? -1 : 1;
        return a.legacy_key > b.legacy_key ? -1 : a.legacy_key < b.legacy_key ? 1 : 0;
      }).slice(0, limit);
    return { rows };
  } };
  return { pool, calls };
}

function request(patch = {}) {
  return { headers: {}, query: {}, auth: { uid: "TEST_ONLY_A", firebaseProject: "logistica-ar" },
    logisticaUser: { id: "1" }, ...patch };
}

function response() {
  return {
    headers: {}, set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; },
  };
}

function wiredRouter(f, path = "/entregas/historial") {
  const routerPath = require.resolve("../../routes/logisticaDeliveries");
  const authPath = require.resolve("../../auth/requireLogisticaFirebaseAuth");
  const allowlistPath = require.resolve("../../auth/requireLogisticaAuthorizedUser");
  const paths = [routerPath, authPath, allowlistPath];
  const cached = paths.map(p => require.cache[p]), load = Module._load;
  paths.forEach(p => { delete require.cache[p]; });
  try {
    Module._load = function (name, parent, isMain) {
      if (name === "../db" && [routerPath, allowlistPath].includes(parent?.filename)) return f.pool;
      if (name === "./firebaseLogistica" && parent?.filename === authPath) {
        return { EXPECTED_PROJECT: "logistica-ar", getLogisticaAuth: () => ({
          async verifyIdToken(token) {
            if (!["TEST_ONLY_A", "TEST_ONLY_B", "TEST_ONLY_UNKNOWN"].includes(token)) {
              throw new Error("TEST_ONLY_INVALID");
            }
            return { aud: "logistica-ar", uid: token };
          },
        }) };
      }
      return load.call(this, name, parent, isMain);
    };
    const route = require(routerPath).stack.find(layer => layer.route?.path === path && layer.route.methods.get);
    assert.ok(route);
    assert.deepEqual(route.route.stack.slice(0, 2).map(l => l.handle.name),
      ["requireLogisticaFirebaseAuth", "requireLogisticaAuthorizedUser"]);
    return route.route.stack.map(l => l.handle);
  } finally {
    Module._load = load;
    paths.forEach((p, i) => { if (cached[i]) require.cache[p] = cached[i]; else delete require.cache[p]; });
  }
}

async function invoke(handlers, { token = "TEST_ONLY_A", query = {}, body } = {}) {
  const req = { method: "GET", headers: token ? { authorization: "Bearer " + token } : {}, query, body };
  const res = response();
  for (const handler of handlers) {
    let next = false;
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return res;
}

module.exports = { legacy, mapping, delivery, fixture, request, response, wiredRouter, invoke };
