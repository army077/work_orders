const assert = require("node:assert/strict");

function delivery(patch = {}) {
  return {
    id: "20", authorized_user_id: "1", pedido: "9999998",
    auth_display_name: "TEST_ONLY_NAME", auth_email: "test@example.invalid",
    created_at: "2026-10-21T17:11:21.545123Z", status: "COMPLETED",
    ...patch,
  };
}

// Isolated SQL-contract double, following the existing repository tests.
// It checks required predicates/parameters and exercises pages over fixtures;
// it does not claim to execute SQL or prove a PostgreSQL query plan.
function fixture({ deliveries = [], evidences = [], users = [
  { id: "1", firebase_uid: "TEST_ONLY_A", firebase_project: "logistica-ar", is_active: true },
  { id: "2", firebase_uid: "TEST_ONLY_B", firebase_project: "logistica-ar", is_active: true },
] } = {}) {
  const calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("FROM public.logistica_authorized_users")) {
      assert.match(sql, /firebase_project = \$1[\s\S]*firebase_uid = \$2[\s\S]*is_active = true/);
      return { rows: users.filter(user => user.firebase_project === params[0]
        && user.firebase_uid === params[1] && user.is_active) };
    }
    assert.equal(params.length, 5);
    assert.match(sql, /WHERE d\.authorized_user_id = \$1::bigint\s+AND d\.status = 'COMPLETED'/);
    assert.match(sql, /strpos\(d\.pedido, \$2::text\) > 0/);
    assert.match(sql, /\(d\.created_at, d\.id\) < \(\$3::timestamptz, \$4::bigint\)/);
    assert.match(sql, /ORDER BY d\.created_at DESC, d\.id DESC\s+LIMIT \$5::integer/);
    assert.match(sql, /p\.id::text AS id/);
    assert.match(sql, /to_char\(p\.created_at AT TIME ZONE 'UTC',\s+'YYYY-MM-DD"T"HH24:MI:SS\.US"Z"'\)/);
    assert.match(sql, /SELECT count\(\*\) FROM public\.logistica_delivery_evidence e\s+WHERE e\.delivery_id = p\.id\s+AND e\.evidence_type = 'PHOTO' AND e\.status = 'UPLOADED'/);
    assert.match(sql, /ORDER BY p\.created_at DESC, p\.id DESC\s*$/);
    assert.doesNotMatch(sql, /\bOFFSET\b|\bJOIN\b|\b(?:INSERT|UPDATE|DELETE)\b/i);
    const [ownerId, pedido, timestamp, id, fetchCount] = params;
    assert.equal(typeof ownerId, "string");
    assert.equal(Number.isInteger(fetchCount), true);
    const rows = deliveries.filter(row => row.authorized_user_id === ownerId
      && row.status === "COMPLETED"
      && (pedido === null || row.pedido.includes(pedido))
      && (timestamp === null || row.created_at < timestamp
        || (row.created_at === timestamp && BigInt(row.id) < BigInt(id))))
      .sort((a, b) => a.created_at === b.created_at
        ? (BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0)
        : (a.created_at > b.created_at ? -1 : 1))
      .slice(0, fetchCount)
      .map(row => ({
        ...row,
        photo_count: String(evidences.filter(evidence => evidence.delivery_id === row.id
          && evidence.evidence_type === "PHOTO" && evidence.status === "UPLOADED").length),
      }));
    return { rows };
  } };
  return { pool, calls };
}

module.exports = { delivery, fixture };
