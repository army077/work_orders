const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createEvidenceRepository } = require("../repositories/logisticaEvidence");
const { EvidenceLeaseLost } = require("../services/logisticaEvidencePolicy");

const UUID = "00000000-0000-4000-8000-000000000001";
const owner = { authorizedUserId: "2", firebaseProject: "TEST_ONLY_PROJECT", uid: "TEST_ONLY_USER" };
const input = { delivery_id: "1", client_evidence_id: UUID, evidence_type: "PHOTO",
  sha256: "a".repeat(64), file_size_bytes: 50, mime_type: "image/png" };
const delivery = { id: "1", pedido: "TEST_ONLY_PEDIDO", status: "PENDING_EVIDENCE", drive_folder_id: null };
const evidence = { ...input, id: "10", sequence_no: 1, status: "PENDING", storage_provider: "GOOGLE_DRIVE",
  processing_token: UUID, external_file_id: null, lease_active: false };

// Doble SQL programado, sin pg, conexiones, env ni DB. Solo verifica el contrato
// de consultas y resultados; no pretende demostrar locks reales de PostgreSQL.
function fixture(steps) {
  const calls = [];
  const client = new EventEmitter();
  let inTransaction = false;
  let released = false;
  client.query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.startsWith("BEGIN")) { inTransaction = true; return { command: "BEGIN" }; }
    if (sql === "COMMIT" || sql === "ROLLBACK") { inTransaction = false; return { command: sql }; }
    if (sql.startsWith("SET LOCAL")) return { command: "SET" };
    assert.equal(inTransaction, true);
    const step = steps.shift();
    assert.ok(step, `Consulta inesperada: ${sql}`);
    assert.match(sql, step.match);
    if (step.check) step.check(sql, params);
    if (step.error) throw step.error;
    return { rows: step.rows || [] };
  };
  client.release = () => { released = true; };
  const repo = createEvidenceRepository({ connect: async () => client });
  return { repo, calls, done() {
    assert.equal(steps.length, 0); assert.equal(released, true); assert.equal(inTransaction, false);
    assert.equal(client.listenerCount("error"), 0);
  } };
}

const lock = (row = delivery) => ({ match: /FROM public\.logistica_deliveries[\s\S]*FOR UPDATE/, rows: row ? [{ ...row }] : [],
  check(sql, params) {
    assert.match(sql, /authorized_user_id = \$2[\s\S]*firebase_project = \$3[\s\S]*firebase_uid = \$4/);
    assert.deepEqual(params, ["1", owner.authorizedUserId, owner.firebaseProject, owner.uid]);
  } });
const existing = row => ({ match: /WHERE client_evidence_id = \$1::uuid/, rows: row ? [{ ...row }] : [] });

test("Propiedad se comprueba bajo lock antes de consultar UUID; misma respuesta para entrega ajena o ausente", async () => {
  const f = fixture([lock(null)]);
  await assert.rejects(f.repo.reserve(input, owner), err => err.status === 403 && err.message === "Entrega no disponible");
  assert.equal(f.calls.at(-1).sql, "ROLLBACK"); f.done();
});

test("Retry UPLOADED permite replay después de perder mutabilidad sin modificar fila", async () => {
  const f = fixture([lock({ ...delivery, status: "COMPLETED" }), existing({ ...evidence, status: "UPLOADED" })]);
  assert.equal((await f.repo.reserve(input, owner)).action, "replay");
  assert.equal(f.calls.some(call => /INSERT|UPDATE public/.test(call.sql)), false); f.done();
});

test("Mismo UUID con contenido/tipo/entrega diferente: 409 genérico sin datos ajenos", async () => {
  for (const patch of [{ sha256: "b".repeat(64) }, { evidence_type: "SIGNATURE" }, { delivery_id: "999" },
    { file_size_bytes: "51" }, { mime_type: "image/jpeg" }]) {
    const f = fixture([lock(), existing({ ...evidence, ...patch })]);
    await assert.rejects(f.repo.reserve(input, owner), err => err.status === 409
      && err.message === "client_evidence_id no disponible para estos datos");
    f.done();
  }
});

test("Lease activo devuelve PENDING sin readquirirlo; usa reloj de DB", async () => {
  const f = fixture([lock(), existing({ ...evidence, lease_active: true })]);
  assert.deepEqual(await f.repo.reserve(input, owner), { action: "pending" });
  assert.ok(f.calls.some(call => call.sql.includes("processing_expires_at > clock_timestamp()")));
  f.done();
});

test("Lease expirado adquiere token nuevo, conserva external_file_id y renueva cinco minutos", async () => {
  const saved = { ...evidence, external_file_id: "TEST_ONLY_SAVED_FILE" };
  const f = fixture([lock(), existing(saved), {
    match: /UPDATE public\.logistica_delivery_evidence SET status = 'PENDING'/, rows: [saved],
    check(sql, params) {
      assert.notEqual(params[1], UUID);
      assert.match(params[1], /^[a-f0-9-]{36}$/);
      assert.match(sql, /clock_timestamp\(\) \+ interval '5 minutes'/);
      assert.doesNotMatch(sql, /SET external_file_id/);
    },
  }]);
  assert.equal((await f.repo.reserve(input, owner)).evidence.external_file_id, saved.external_file_id); f.done();
});

test("Nuevos retries pendientes no se permiten cuando la entrega no es mutable", async () => {
  for (const row of [null, evidence]) {
    const f = fixture([lock({ ...delivery, status: "COMPLETED" }), existing(row)]);
    await assert.rejects(f.repo.reserve(input, owner), err => err.status === 409); f.done();
  }
});

test("Reserva PHOTO número 15 bajo lock sin excluir PENDING/FAILED; no persiste bytes", async () => {
  const f = fixture([lock(), existing(null), {
    match: /count\(\*\).*max\(sequence_no\)/, rows: [{ count: "14", max_sequence: 14 }],
    check(sql) { assert.doesNotMatch(sql, /status\s*=/); },
  }, {
    match: /INSERT INTO public\.logistica_delivery_evidence/, rows: [{ ...evidence, sequence_no: 15 }],
    check(sql, params) {
      assert.equal(params[3], 15);
      assert.deepEqual(params.slice(0, 7), ["1", UUID, "PHOTO", 15, "image/png", 50, input.sha256]);
      assert.match(sql, /ON CONFLICT \(client_evidence_id\) DO NOTHING/);
      assert.doesNotMatch(sql, /buffer|base64|original_filename/i);
    },
  }]);
  assert.equal((await f.repo.reserve(input, owner)).evidence.sequence_no, 15); f.done();
});

test("Rechaza foto 16 y segunda firma antes de INSERT", async () => {
  for (const [type, count] of [["PHOTO", 15], ["SIGNATURE", 1]]) {
    const f = fixture([lock(), existing(null), { match: /count\(\*\)/, rows: [{ count, max_sequence: count }] }]);
    await assert.rejects(f.repo.reserve({ ...input, evidence_type: type }, owner), err => err.status === 409); f.done();
  }
});

test("Carrera global del mismo UUID en entregas distintas resuelve ON CONFLICT a 409", async () => {
  const f = fixture([lock(), existing(null), { match: /count\(\*\)/, rows: [{ count: 0, max_sequence: 0 }] },
    { match: /INSERT[\s\S]*ON CONFLICT \(client_evidence_id\) DO NOTHING/, rows: [] }]);
  await assert.rejects(f.repo.reserve(input, owner), err => err.status === 409); f.done();
});

test("Persistencia de IDs conserva la carpeta canónica de una reserva concurrente", async () => {
  const f = fixture([lock({ ...delivery, drive_folder_id: "TEST_ONLY_CANONICAL_FOLDER" }), {
    match: /SELECT[\s\S]*processing_token = \$3::uuid AND processing_expires_at > clock_timestamp\(\)/,
    rows: [evidence],
  }, {
    match: /SET external_file_id = COALESCE\(external_file_id, \$3\)/,
    rows: [{ ...evidence, external_file_id: "TEST_ONLY_FILE" }],
    check(sql, params) { assert.deepEqual(params, ["10", UUID, "TEST_ONLY_FILE"]); },
  }]);
  const assigned = await f.repo.assignDriveIds(input, owner, "10", UUID,
    { folderId: "TEST_ONLY_UNUSED_FOLDER", fileId: "TEST_ONLY_FILE" });
  assert.equal(assigned.delivery.drive_folder_id, "TEST_ONLY_CANONICAL_FOLDER"); f.done();
});

test("Carpeta y external_file_id quedan persistidos juntos antes del IO externo", async () => {
  const f = fixture([lock(), { match: /SELECT[\s\S]*processing_token = \$3/, rows: [evidence] }, {
    match: /UPDATE public\.logistica_deliveries SET drive_folder_id = \$2/,
    check(sql, params) { assert.deepEqual(params, ["1", "TEST_ONLY_FOLDER"]); },
  }, { match: /SET external_file_id = COALESCE/, rows: [{ ...evidence, external_file_id: "TEST_ONLY_FILE" }] }]);
  const result = await f.repo.assignDriveIds(input, owner, "10", UUID,
    { folderId: "TEST_ONLY_FOLDER", fileId: "TEST_ONLY_FILE" });
  assert.equal(result.delivery.drive_folder_id, "TEST_ONLY_FOLDER");
  assert.equal(f.calls.at(-1).sql, "COMMIT"); f.done();
});

test("Worker vencido no puede renovar ni confirmar con un token viejo", async () => {
  for (const method of ["renewLease", "confirmUploaded"]) {
    const f = fixture([lock(), {
      match: /UPDATE public\.logistica_delivery_evidence/, rows: [],
      check(sql, params) {
        assert.match(sql, /processing_token = \$3::uuid AND processing_expires_at > clock_timestamp\(\)/);
        assert.equal(params[2], UUID);
      },
    }]);
    await assert.rejects(f.repo[method](input, owner, "10", UUID, "TEST_ONLY_REFERENCE"), EvidenceLeaseLost); f.done();
  }
});

test("Liberar lease solo afecta al token actual; conserva referencias y PENDING", async () => {
  const f = fixture([lock(), {
    match: /UPDATE public\.logistica_delivery_evidence/,
    check(sql, params) {
      assert.match(sql, /processing_token = NULL, processing_expires_at = NULL/);
      assert.match(sql, /processing_token = \$3::uuid AND status = 'PENDING'/);
      assert.doesNotMatch(sql, /FAILED|external_file_id =|drive_folder_id =/);
      assert.deepEqual(params, ["10", "1", UUID]);
    },
  }]);
  await f.repo.releaseLease(input, owner, "10", UUID); f.done();
});
