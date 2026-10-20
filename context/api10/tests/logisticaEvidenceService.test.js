const test = require("node:test");
const assert = require("node:assert/strict");
const { createEvidenceService } = require("../services/logisticaEvidence");
const { EvidenceLeaseLost } = require("../services/logisticaEvidencePolicy");

const UUID = "00000000-0000-4000-8000-000000000001";
const input = { delivery_id: "1", client_evidence_id: UUID, evidence_type: "PHOTO", extension: "png",
  mime_type: "image/png", file_size_bytes: 4, sha256: "a".repeat(64), buffer: Buffer.from("test") };
const owner = { authorizedUserId: "2", firebaseProject: "TEST_ONLY_PROJECT", uid: "TEST_ONLY_USER" };
const evidence = { ...input, id: "10", sequence_no: 1, status: "PENDING", external_file_id: null };
const delivery = { id: "1", pedido: "TEST_ONLY_PEDIDO", drive_folder_id: null };
const noCalls = new Proxy({}, { get() { return () => assert.fail("No debe procesar Drive en este caso"); } });

test("Replay responde 200 incluso fuera de fase mutable; no toca Drive ni expone el token", async () => {
  const service = createEvidenceService({ repository: { reserve: async () => ({ action: "replay",
    evidence: { ...evidence, status: "UPLOADED", processing_token: UUID } }) }, drive: noCalls });
  const result = await service(input, owner);
  assert.equal(result.status, 200); assert.equal(result.body.idempotent_replay, true);
  assert.equal(result.body.evidence.processing_token, undefined);
  assert.equal(result.body.evidence.buffer, undefined);
});

test("Lease activo responde 202 genérico sin información de evidencia/identidad", async () => {
  const service = createEvidenceService({ repository: { reserve: async () => ({ action: "pending" }) }, drive: noCalls });
  assert.deepEqual(await service(input, owner), { status: 202, body: { ok: true, status: "PENDING" } });
});

function processingFixture({ savedIds = false, uploadError, leaseLost = false } = {}) {
  const calls = [];
  const savedDelivery = { ...delivery, drive_folder_id: savedIds ? "TEST_ONLY_FOLDER" : null };
  const savedEvidence = { ...evidence, external_file_id: savedIds ? "TEST_ONLY_FILE" : null };
  let persisted = savedIds;
  const repository = {
    reserve: async () => ({ action: "process", evidence: savedEvidence, delivery: savedDelivery, token: UUID }),
    async assignDriveIds(payload, identity, id, token, ids) {
      calls.push("assignDriveIds");
      assert.equal(identity, owner); assert.equal(token, UUID);
      if (savedIds) assert.deepEqual(ids, { folderId: null, fileId: null });
      else assert.deepEqual(ids, { folderId: "TEST_ONLY_FOLDER", fileId: "TEST_ONLY_FILE" });
      persisted = true;
      return { delivery: { ...savedDelivery, drive_folder_id: "TEST_ONLY_FOLDER" },
        evidence: { ...savedEvidence, external_file_id: "TEST_ONLY_FILE" } };
    },
    async renewLease() { calls.push("renewLease"); if (leaseLost) throw new EvidenceLeaseLost(); },
    async confirmUploaded(payload, identity, id, token, url) {
      calls.push("confirmUploaded"); assert.equal(token, UUID);
      assert.equal(url, "https://drive.google.com/file/d/TEST_ONLY_FILE/view");
      return { ...savedEvidence, status: "UPLOADED" };
    },
    async releaseLease(payload, identity, id, token) {
      calls.push("releaseLease"); assert.equal(id, "10"); assert.equal(token, UUID);
    },
  };
  const drive = {
    async generateDriveId() {
      assert.equal(savedIds, false); calls.push("generateDriveId");
      return calls.filter(call => call === "generateDriveId").length === 1 ? "TEST_ONLY_FOLDER" : "TEST_ONLY_FILE";
    },
    async ensureDeliveryFolder(args) {
      assert.equal(persisted, true); calls.push("ensureDeliveryFolder");
      assert.deepEqual(args, { id: "TEST_ONLY_FOLDER", name: "TEST_ONLY_PEDIDO" });
    },
    async uploadEvidenceWithId(args) {
      assert.equal(persisted, true); calls.push("uploadEvidenceWithId");
      assert.equal(args.id, "TEST_ONLY_FILE"); assert.equal(args.parentId, "TEST_ONLY_FOLDER");
      assert.equal(args.name, `entrega-1_photo_1_${UUID}.png`);
      if (uploadError) throw uploadError;
    },
  };
  return { service: createEvidenceService({ repository, drive }), calls };
}

test("Subida nueva responde 201 después de persistir IDs y confirmar metadata", async () => {
  const f = processingFixture(); const result = await f.service(input, owner);
  assert.equal(result.status, 201); assert.equal(result.body.idempotent_replay, false);
  assert.equal(result.body.evidence.status, "UPLOADED");
  assert.deepEqual(f.calls, ["generateDriveId", "generateDriveId", "assignDriveIds", "ensureDeliveryFolder",
    "renewLease", "uploadEvidenceWithId", "confirmUploaded"]);
});

test("Retry con IDs reservados no pide IDs nuevos", async () => {
  const f = processingFixture({ savedIds: true });
  assert.equal((await f.service(input, owner)).status, 201);
  assert.equal(f.calls.includes("generateDriveId"), false);
});

test("Timeout ambiguo libera token y conserva PENDING recuperable; no confirma ni marca FAILED", async () => {
  const error = Object.assign(new Error("TEST_ONLY_TIMEOUT"), { code: "ETIMEDOUT" });
  const f = processingFixture({ savedIds: true, uploadError: error });
  await assert.rejects(f.service(input, owner), err => err === error);
  assert.equal(f.calls.includes("confirmUploaded"), false);
  assert.equal(f.calls.at(-1), "releaseLease");
  assert.equal(f.calls.includes("generateDriveId"), false);
});

test("Lease perdido detiene upload y devuelve 202; no sobrescribe al nuevo worker", async () => {
  const f = processingFixture({ savedIds: true, leaseLost: true });
  assert.equal((await f.service(input, owner)).status, 202);
  assert.equal(f.calls.includes("uploadEvidenceWithId"), false);
  assert.equal(f.calls.at(-1), "releaseLease");
});
