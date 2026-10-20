const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { parseEvidenceMultipart } = require("../routes/logisticaEvidence");
const { PHOTO_MAX_BYTES } = require("../services/logisticaEvidencePolicy");

// Solo el parser en memoria. No se importa server, pg ni Firebase y no se invoca
// el handler HTTP del endpoint ni se abre ningún puerto.
async function parse(parts, contentType = "multipart/form-data; boundary=TEST_ONLY_BOUNDARY") {
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--TEST_ONLY_BOUNDARY\r\nContent-Disposition: form-data; name="${part.name}"${part.file ? '; filename="test.png"' : ''}\r\n${part.file ? 'Content-Type: image/png\r\n' : ''}\r\n`));
    chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from("--TEST_ONLY_BOUNDARY--\r\n"));
  const bytes = Buffer.concat(chunks);
  const req = Readable.from([bytes]);
  req.method = "POST";
  req.headers = { "content-type": contentType, "content-length": String(bytes.length) };
  req.is = type => type === "multipart/form-data" && contentType.startsWith(type);
  return new Promise(resolve => {
    const res = { status(code) { this.code = code; return this; },
      json(body) { resolve({ status: this.code, body }); } };
    parseEvidenceMultipart(req, res, () => resolve({ status: 200, req }));
  });
}

const fields = [
  { name: "client_evidence_id", value: "00000000-0000-4000-8000-000000000001" },
  { name: "evidence_type", value: "PHOTO" },
];
const file = { name: "file", file: true, value: Buffer.from("TEST_ONLY_BYTES") };

test("Multipart admite un archivo y exactamente dos campos en cualquier orden, en memoria", async () => {
  for (const parts of [[...fields, file], [file, ...fields]]) {
    const result = await parse(parts);
    assert.equal(result.status, 200);
    assert.deepEqual(result.req.file.buffer, file.value);
    assert.equal(result.req.file.path, undefined);
  }
});

test("Multipart rechaza archivo extra, campo extra, archivo con otro nombre y field muy grande", async () => {
  for (const parts of [[...fields, file, file], [...fields, { name: "status", value: "UPLOADED" }, file],
    [...fields, { ...file, name: "other" }], [{ name: "client_evidence_id", value: "x".repeat(81) }, fields[1], file]]) {
    const result = await parse(parts);
    assert.equal(result.status, 400);
    assert.equal(JSON.stringify(result.body).includes("test.png"), false);
  }
});

test("Parser permite 10 MiB exactos y rechaza un byte adicional", async () => {
  assert.equal((await parse([...fields, { ...file, value: Buffer.alloc(PHOTO_MAX_BYTES) }])).status, 200);
  assert.equal((await parse([...fields, { ...file, value: Buffer.alloc(PHOTO_MAX_BYTES + 1) }])).status, 400);
});

test("No admite JSON ni multipart sin boundary", async () => {
  assert.equal((await parse([], "application/json")).status, 400);
  assert.equal((await parse([], "multipart/form-data")).status, 400);
});
