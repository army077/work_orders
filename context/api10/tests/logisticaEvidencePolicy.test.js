const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  PHOTO_MAX_BYTES, SIGNATURE_MAX_BYTES, validateEvidenceInput, sameEvidenceAttempt,
  nextEvidenceSequence, normalizeDeliveryId, evidenceFilename, publicEvidence,
} = require("../services/logisticaEvidencePolicy");

const UUID = "00000000-0000-4000-8000-000000000001";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082", "hex");
const JPEG = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex");
const WEBP = Buffer.from("524946461600000057454250565038200a00000000000000000000000000", "hex");
const input = (type = "PHOTO") => ({ client_evidence_id: UUID, evidence_type: type });
const file = (buffer = PNG, mimetype = "image/png") => ({ fieldname: "file", buffer, mimetype, size: 999999, originalname: "ignorado.exe" });
const invalid = err => err.status === 400;

test("UUID obligatorio/canónico y campos reservados rechazados", async () => {
  for (const uuid of [undefined, "no-uuid", [UUID], `${UUID} `]) {
    await assert.rejects(validateEvidenceInput("1", { ...input(), client_evidence_id: uuid }, file()), invalid);
  }
  for (const field of ["firebase_uid", "authorized_user_id", "sequence_no", "drive_folder_id",
    "external_file_id", "storage_provider", "sha256", "mime_type", "file_size_bytes", "status"]) {
    await assert.rejects(validateEvidenceInput("1", { ...input(), [field]: "no confiable" }, file()), invalid);
  }
  await assert.rejects(validateEvidenceInput("1", { ...input(), evidence_type: ["PHOTO"] }, file()), invalid);
  for (const id of ["0", "-1", "1.5", "01", "9223372036854775808", "1 OR true"]) {
    assert.throws(() => normalizeDeliveryId(id), invalid);
  }
  assert.equal(normalizeDeliveryId("9223372036854775807"), "9223372036854775807");
});

test("PHOTO detecta JPEG, PNG y WEBP por bytes; acepta aliases MIME del mismo formato", async () => {
  for (const [buffer, declared, expected] of [[PNG, "IMAGE/X-PNG; charset=binary", "image/png"],
    [JPEG, "image/pjpeg", "image/jpeg"], [WEBP, "image/webp", "image/webp"]]) {
    const result = await validateEvidenceInput("1", input(), file(buffer, declared));
    assert.equal(result.mime_type, expected);
    assert.equal(result.file_size_bytes, buffer.length);
  }
});

test("Rechaza MIME falsificado, formato no admitido, bytes no reconocibles y archivo faltante", async () => {
  for (const candidate of [file(PNG, "image/jpeg"), file(Buffer.from("GIF89a000000000000"), "image/png"),
    file(Buffer.from("texto sin imagen")), file(Buffer.from("89504e470d0a1a0a", "hex")),
    file(Buffer.alloc(0)), undefined, { ...file(), fieldname: "otro" }]) {
    await assert.rejects(validateEvidenceInput("1", input(), candidate), invalid);
  }
});

test("SIGNATURE solo admite PNG", async () => {
  assert.equal((await validateEvidenceInput("1", input("SIGNATURE"), file())).mime_type, "image/png");
  for (const [buffer, mime] of [[JPEG, "image/jpeg"], [WEBP, "image/webp"]]) {
    await assert.rejects(validateEvidenceInput("1", input("SIGNATURE"), file(buffer, mime)), invalid);
  }
});

test("Límites inclusivos: PHOTO 10 MiB y SIGNATURE 2 MiB calculados desde buffer.length", async () => {
  for (const [type, max] of [["PHOTO", PHOTO_MAX_BYTES], ["SIGNATURE", SIGNATURE_MAX_BYTES]]) {
    const atLimit = Buffer.alloc(max); PNG.copy(atLimit);
    assert.equal((await validateEvidenceInput("1", input(type), file(atLimit))).file_size_bytes, max);
    await assert.rejects(validateEvidenceInput("1", input(type), file(Buffer.alloc(max + 1))), invalid);
  }
});

test("SHA256 estable; retry compara entrega, tipo, bytes, tamaño y MIME normalizado", async () => {
  const validated = await validateEvidenceInput("1", input(), file());
  assert.equal(validated.sha256, createHash("sha256").update(PNG).digest("hex"));
  assert.equal((await validateEvidenceInput("1", input(), file(Buffer.from(PNG)))).sha256, validated.sha256);
  const row = { ...validated, delivery_id: 1, file_size_bytes: String(PNG.length), mime_type: "image/x-png" };
  assert.equal(sameEvidenceAttempt(row, validated), true);
  for (const patch of [{ delivery_id: "2" }, { evidence_type: "SIGNATURE" }, { sha256: "f".repeat(64) },
    { file_size_bytes: PNG.length + 1 }, { mime_type: "image/jpeg" }, { sha256: null }]) {
    assert.equal(sameEvidenceAttempt({ ...row, ...patch }, validated), false);
  }
});

test("Cupos y secuencias: 15 fotos registradas y una firma", () => {
  assert.equal(nextEvidenceSequence("PHOTO", "14", 14), 15);
  assert.throws(() => nextEvidenceSequence("PHOTO", 15, 15), err => err.status === 409);
  assert.throws(() => nextEvidenceSequence("PHOTO", 16, 20), err => err.status === 409);
  assert.equal(nextEvidenceSequence("SIGNATURE", 0, 0), 1);
  assert.throws(() => nextEvidenceSequence("SIGNATURE", 1, 1), err => err.status === 409);
});

test("Nombres desde servidor y respuesta pública sin identidad, referencias ni lease", () => {
  const row = { id: "10", delivery_id: "1", client_evidence_id: UUID, evidence_type: "PHOTO", sequence_no: 2,
    status: "UPLOADED", processing_token: UUID, firebase_uid: "TEST_ONLY", external_file_id: "TEST_ONLY_FILE" };
  assert.equal(evidenceFilename(row, "jpg"), `entrega-1_photo_2_${UUID}.jpg`);
  assert.equal(evidenceFilename({ ...row, evidence_type: "SIGNATURE" }, "png"), `entrega-1_signature_${UUID}.png`);
  assert.deepEqual(Object.keys(publicEvidence(row)), ["id", "client_evidence_id", "evidence_type", "sequence_no", "status"]);
});
