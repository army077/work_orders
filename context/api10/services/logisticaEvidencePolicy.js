const { createHash } = require("node:crypto");

const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME_FORMATS = new Map([
  ["image/jpeg", "image/jpeg"], ["image/jpg", "image/jpeg"],
  ["image/pjpeg", "image/jpeg"], ["image/png", "image/png"],
  ["image/x-png", "image/png"], ["image/webp", "image/webp"],
]);
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

class EvidenceHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

class EvidenceLeaseLost extends Error {}

function normalizeMime(value) {
  if (typeof value !== "string") return null;
  return MIME_FORMATS.get(value.split(";", 1)[0].trim().toLowerCase()) || null;
}

function normalizeDeliveryId(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)
    || BigInt(value) > 9223372036854775807n) {
    throw new EvidenceHttpError(400, "ID de entrega inválido");
  }
  return value;
}

let fileTypeModule;
async function validateEvidenceInput(deliveryId, body, file) {
  const id = normalizeDeliveryId(deliveryId);
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some(key => !["client_evidence_id", "evidence_type"].includes(key))) {
    throw new EvidenceHttpError(400, "Solo se admiten client_evidence_id y evidence_type");
  }
  if (typeof body.client_evidence_id !== "string" || !UUID_PATTERN.test(body.client_evidence_id)) {
    throw new EvidenceHttpError(400, "client_evidence_id debe ser un UUID canónico");
  }
  if (!["PHOTO", "SIGNATURE"].includes(body.evidence_type)) {
    throw new EvidenceHttpError(400, "evidence_type debe ser PHOTO o SIGNATURE");
  }
  if (!file || file.fieldname !== "file" || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw new EvidenceHttpError(400, "Se requiere un archivo no vacío en file");
  }
  const size = file.buffer.length;
  const max = body.evidence_type === "PHOTO" ? PHOTO_MAX_BYTES : SIGNATURE_MAX_BYTES;
  if (size > max) {
    throw new EvidenceHttpError(400, body.evidence_type === "PHOTO"
      ? "PHOTO admite hasta 10 MB" : "SIGNATURE admite hasta 2 MB");
  }

  // Keep unsupported ASF/ZIP parsers unreachable on the Node 18 file-type branch.
  // This is only a prefilter: actual MIME detection below remains mandatory.
  const buffer = file.buffer;
  const imagePrefix = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    || buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!imagePrefix) throw new EvidenceHttpError(400, "Formato no permitido para este tipo de evidencia");
  // Importación ESM aislada; nunca lee un archivo ni utiliza su nombre/extensión.
  fileTypeModule ||= import("file-type");
  const { fileTypeFromBuffer } = await fileTypeModule;
  let detected;
  try {
    detected = await fileTypeFromBuffer(file.buffer);
  } catch (_err) {
    throw new EvidenceHttpError(400, "No se pudo reconocer el formato del archivo");
  }
  const mime = normalizeMime(detected && detected.mime);
  if (!mime || (body.evidence_type === "SIGNATURE" && mime !== "image/png")) {
    throw new EvidenceHttpError(400, "Formato no permitido para este tipo de evidencia");
  }
  if (normalizeMime(file.mimetype) !== mime) {
    throw new EvidenceHttpError(400, "El MIME declarado no corresponde al formato detectado");
  }
  return {
    delivery_id: id,
    client_evidence_id: body.client_evidence_id.toLowerCase(),
    evidence_type: body.evidence_type,
    mime_type: mime,
    file_size_bytes: size,
    sha256: createHash("sha256").update(file.buffer).digest("hex"),
    extension: EXTENSIONS[mime],
    buffer: file.buffer,
  };
}

function sameEvidenceAttempt(row, input) {
  return String(row.delivery_id) === input.delivery_id
    && row.evidence_type === input.evidence_type
    && typeof row.sha256 === "string" && row.sha256.toLowerCase() === input.sha256
    && String(row.file_size_bytes) === String(input.file_size_bytes)
    && normalizeMime(row.mime_type) === input.mime_type;
}

function assertMutable(delivery) {
  if (delivery.status !== "PENDING_EVIDENCE") {
    throw new EvidenceHttpError(409, "La entrega ya no admite evidencias");
  }
}

function nextEvidenceSequence(type, count, maxSequence) {
  if (type === "PHOTO" && Number(count) >= 15) {
    throw new EvidenceHttpError(409, "La entrega ya tiene el máximo de 15 fotos registradas");
  }
  if (type === "SIGNATURE" && Number(count) >= 1) {
    throw new EvidenceHttpError(409, "La entrega ya tiene una firma registrada");
  }
  return Number(maxSequence) + 1;
}

function publicEvidence(row) {
  return {
    id: row.id,
    client_evidence_id: row.client_evidence_id,
    evidence_type: row.evidence_type,
    sequence_no: row.sequence_no,
    status: row.status,
  };
}

function evidenceFilename(row, extension) {
  const stem = `entrega-${row.delivery_id}_${row.evidence_type.toLowerCase()}`;
  return row.evidence_type === "PHOTO"
    ? `${stem}_${row.sequence_no}_${row.client_evidence_id}.${extension}`
    : `${stem}_${row.client_evidence_id}.png`;
}

module.exports = {
  PHOTO_MAX_BYTES, SIGNATURE_MAX_BYTES, EvidenceHttpError, EvidenceLeaseLost,
  normalizeMime, normalizeDeliveryId, validateEvidenceInput, sameEvidenceAttempt,
  assertMutable, nextEvidenceSequence, publicEvidence, evidenceFilename,
};
