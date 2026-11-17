const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createLogisticaDriveStorage } = require("../integrations/logisticaDrive");

const FOLDER = "TEST_ONLY_FOLDER";
const ROOT = "TEST_ONLY_ROOT";
const FILE = "TEST_ONLY_FILE";
const buffer = Buffer.from("TEST_ONLY_FILE_BYTES");
const sha256 = createHash("sha256").update(buffer).digest("hex");
const md5 = createHash("md5").update(buffer).digest("hex");
const upload = { id: FILE, parentId: FOLDER, name: "test.png", mimeType: "image/png",
  fileSize: buffer.length, sha256, buffer };
const metadata = { id: FILE, parents: [FOLDER], mimeType: "image/png", size: String(buffer.length),
  sha256Checksum: sha256, md5Checksum: md5, trashed: false };
const notFound = () => Object.assign(new Error("TEST_ONLY_NOT_FOUND"), { response: { status: 404 } });
const conflict = () => Object.assign(new Error("TEST_ONLY_CONFLICT"), { response: { status: 409 } });

function storage(handlers) {
  const calls = [];
  const files = {};
  for (const method of ["get", "create", "generateIds"]) {
    files[method] = async (params, options) => {
      calls.push({ method, params, options });
      assert.equal(options.timeout, 45000); assert.equal(options.retry, false);
      assert.ok(handlers[method], `Llamada inesperada al doble de Drive: ${method}`);
      return { data: await handlers[method](params) };
    };
  }
  return { drive: createLogisticaDriveStorage({ getClient: () => ({ files }), getRootFolderId: () => ROOT }), calls };
}

test("Genera IDs de Drive solo del servidor; consulta por ID, nunca por nombre", async () => {
  const f = storage({ generateIds(params) {
    assert.deepEqual(params, { count: 1, space: "drive", type: "files" }); return { ids: [FILE] };
  } });
  assert.equal(await f.drive.generateDriveId(), FILE);
});

test("Carpeta existente se valida y reutiliza sin crear objetos", async () => {
  const f = storage({ get(params) {
    assert.equal(params.fileId, FOLDER);
    return { id: FOLDER, parents: [ROOT], mimeType: "application/vnd.google-apps.folder", trashed: false };
  } });
  await f.drive.ensureDeliveryFolder({ id: FOLDER, name: "TEST_ONLY_PEDIDO" });
  assert.deepEqual(f.calls.map(c => c.method), ["get"]);
});

test("Creación de carpeta usa exactamente ID persistido, pedido visible y raíz configurada", async () => {
  const f = storage({ get() { throw notFound(); }, create(params) {
    assert.deepEqual(params.requestBody, {
      id: FOLDER, name: "TEST_ONLY_PEDIDO", parents: [ROOT], mimeType: "application/vnd.google-apps.folder",
    });
    assert.equal(params.media, undefined);
    return params.requestBody;
  } });
  await f.drive.ensureDeliveryFolder({ id: FOLDER, name: "TEST_ONLY_PEDIDO" });
});

test("No reutiliza carpeta en otra raíz, archivo común ni objeto en papelera", async () => {
  for (const patch of [{ parents: ["TEST_ONLY_OTHER_ROOT"] }, { mimeType: "image/png" }, { trashed: true }]) {
    const f = storage({ get: () => ({ id: FOLDER, parents: [ROOT], mimeType: "application/vnd.google-apps.folder", ...patch }) });
    await assert.rejects(f.drive.ensureDeliveryFolder({ id: FOLDER, name: "TEST_ONLY_PEDIDO" }), /DRIVE_METADATA_MISMATCH/);
    assert.equal(f.calls.length, 1);
  }
});

test("Upload usa ID persistido y stream de bytes; no crea un ID alternativo", async () => {
  const f = storage({ get() { throw notFound(); }, async create(params) {
    assert.deepEqual(params.requestBody, { id: FILE, name: upload.name, parents: [FOLDER], mimeType: "image/png" });
    assert.equal(params.media.mimeType, "image/png");
    const chunks = [];
    for await (const chunk of params.media.body) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), buffer);
    return metadata;
  } });
  await f.drive.uploadEvidenceWithId(upload);
  assert.deepEqual(f.calls.map(c => c.method), ["get", "create"]);
});

test("Archivo confirmado se recupera por ID y no se vuelve a subir", async () => {
  const f = storage({ get: () => metadata });
  await f.drive.uploadEvidenceWithId(upload);
  assert.deepEqual(f.calls.map(c => c.method), ["get"]);
});

test("409 requiere nueva consulta y verifica metadata/checksums antes de aceptar", async () => {
  let gets = 0;
  const f = storage({ get() { if (!gets++) throw notFound(); return metadata; }, create() { throw conflict(); } });
  await f.drive.uploadEvidenceWithId(upload);
  assert.deepEqual(f.calls.map(c => c.method), ["get", "create", "get"]);
  for (const patch of [{ id: "TEST_ONLY_OTHER_ID" }, { parents: [ROOT] }, { mimeType: "image/jpeg" },
    { size: "999" }, { size: undefined }, { sha256Checksum: "b".repeat(64) }, { md5Checksum: "c".repeat(32) }]) {
    let attempts = 0;
    const bad = storage({ get() { if (!attempts++) throw notFound(); return { ...metadata, ...patch }; },
      create() { throw conflict(); } });
    await assert.rejects(bad.drive.uploadEvidenceWithId(upload), /DRIVE_METADATA_MISMATCH/);
    assert.equal(bad.calls.filter(c => c.method === "create").length, 1);
  }
});

test("No asume hash de Drive disponible; usa MD5 adicional cuando falta SHA256", async () => {
  const f = storage({ get: () => ({ ...metadata, sha256Checksum: undefined }) });
  await f.drive.uploadEvidenceWithId(upload);
  const bad = storage({ get: () => ({ ...metadata, sha256Checksum: undefined, md5Checksum: "0".repeat(32) }) });
  await assert.rejects(bad.drive.uploadEvidenceWithId(upload), /DRIVE_METADATA_MISMATCH/);
});

test("Timeout no genera otro ID ni implica éxito; 403 no se trata como 404", async () => {
  const timeout = Object.assign(new Error("TEST_ONLY_TIMEOUT"), { code: "ETIMEDOUT" });
  const f = storage({ get() { throw notFound(); }, create() { throw timeout; } });
  await assert.rejects(f.drive.uploadEvidenceWithId(upload), err => err === timeout);
  assert.deepEqual(f.calls.map(c => c.method), ["get", "create"]);
  const forbidden = storage({ get() { throw Object.assign(new Error("TEST_ONLY_DENIED"), { code: 403 }); } });
  await assert.rejects(forbidden.drive.getDriveFile(FILE));
  assert.deepEqual(forbidden.calls.map(c => c.method), ["get"]);
});
