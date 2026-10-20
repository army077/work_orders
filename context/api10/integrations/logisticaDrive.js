const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { createHash } = require("node:crypto");

let driveClient;

function configurationError(message) {
  const error = new Error(message);
  error.code = "LOGISTICA_DRIVE_CONFIG_ERROR";
  return error;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw configurationError(`Falta ${name}`);
  }
  return value.trim();
}

function readConfiguration(name) {
  const filePath = requiredEnvironment(name);
  if (!path.isAbsolute(filePath)) {
    throw configurationError(`${name} debe ser una ruta absoluta`);
  }
  try {
    const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("INVALID_JSON_OBJECT");
    }
    return parsed;
  } catch (_err) {
    // No propagar mensajes del sistema, contenido JSON, rutas ni causas.
    throw configurationError(`No se pudo cargar el JSON de ${name}`);
  }
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function getPedidosFolderId() {
  const folderId = requiredEnvironment("LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID");
  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) {
    throw configurationError("LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID debe contener un ID de Drive");
  }
  return folderId;
}

function getLogisticaDriveClient() {
  if (driveClient) return driveClient;

  // Todo se carga al primer uso, sin ADC ni credenciales de Firebase.
  getPedidosFolderId();
  const credentials = readConfiguration("LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH");
  const token = readConfiguration("LOGISTICA_DRIVE_TOKEN_PATH");
  const oauth = credentials.installed || credentials.web;
  if (!oauth || !isNonEmptyString(oauth.client_id) || !isNonEmptyString(oauth.client_secret)) {
    throw configurationError("El JSON de Drive debe contener un cliente OAuth installed o web valido");
  }
  if (!isNonEmptyString(token.refresh_token)) {
    throw configurationError("El token OAuth de Drive debe contener refresh_token");
  }

  try {
    const { google } = require("googleapis");
    const auth = new google.auth.OAuth2(oauth.client_id, oauth.client_secret);
    // Flujo solo de refresh: no depende de access_token/expiry_date guardados.
    auth.setCredentials({ refresh_token: token.refresh_token });
    // Construir el cliente no autentica ni ejecuta peticiones a Drive.
    driveClient = google.drive({ version: "v3", auth });
    return driveClient;
  } catch (_err) {
    throw configurationError("No se pudo inicializar el cliente OAuth de Drive");
  }
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const FILE_FIELDS = "id,parents,mimeType,size,trashed,sha256Checksum,md5Checksum";
// Una petición tiene un plazo menor al lease. No hay retries ocultos de streams.
const REQUEST_OPTIONS = { timeout: 45000, retry: false };

function driveStatus(error) {
  return Number(error && ((error.response && error.response.status) || error.code));
}

function assertDriveId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("INVALID_SERVER_DRIVE_ID");
  }
}

function assertDriveMetadata(file, { id, parentId, mimeType, fileSize, sha256, md5 }) {
  if (!file || file.id !== id || file.trashed === true || file.mimeType !== mimeType
    || !Array.isArray(file.parents) || file.parents.length !== 1 || file.parents[0] !== parentId
    || (fileSize !== undefined && String(file.size) !== String(fileSize))
    || (sha256 && file.sha256Checksum && file.sha256Checksum.toLowerCase() !== sha256.toLowerCase())
    || (md5 && file.md5Checksum && file.md5Checksum.toLowerCase() !== md5.toLowerCase())) {
    // No propagar metadata externa, IDs reales ni mensajes de Gaxios.
    throw new Error("DRIVE_METADATA_MISMATCH");
  }
  return file;
}

// Las dependencias se resuelven al llamar cada helper. Importar este módulo no
// lee credenciales, no autentica y no realiza llamadas externas.
function createLogisticaDriveStorage({
  getClient = getLogisticaDriveClient, getRootFolderId = getPedidosFolderId,
} = {}) {
  async function generateDriveId() {
    const { data } = await getClient().files.generateIds(
      { count: 1, space: "drive", type: "files" }, REQUEST_OPTIONS
    );
    const id = data && data.ids && data.ids[0];
    assertDriveId(id);
    return id;
  }

  async function getDriveFile(id) {
    assertDriveId(id);
    try {
      const { data } = await getClient().files.get(
        { fileId: id, fields: FILE_FIELDS, supportsAllDrives: true }, REQUEST_OPTIONS
      );
      return data;
    } catch (err) {
      if (driveStatus(err) === 404) return null;
      throw err;
    }
  }

  async function createOrRecover(expected, requestBody, media) {
    assertDriveId(expected.id);
    assertDriveId(expected.parentId);
    const existing = await getDriveFile(expected.id);
    if (existing) return assertDriveMetadata(existing, expected);
    let file;
    try {
      const { data } = await getClient().files.create({
        requestBody, ...(media ? { media } : {}),
        fields: FILE_FIELDS, supportsAllDrives: true,
      }, REQUEST_OPTIONS);
      file = data;
    } catch (err) {
      if (driveStatus(err) !== 409) throw err;
      // El ID ya existe: un 409 por sí solo no prueba la subida.
      file = await getDriveFile(expected.id);
    }
    return assertDriveMetadata(file, expected);
  }

  async function ensureDeliveryFolder({ id, name }) {
    const parentId = getRootFolderId();
    return createOrRecover({ id, parentId, mimeType: FOLDER_MIME }, {
      id, name, parents: [parentId], mimeType: FOLDER_MIME,
    });
  }

  async function uploadEvidenceWithId({ id, parentId, name, mimeType, fileSize, sha256, buffer }) {
    if (!Buffer.isBuffer(buffer) || buffer.length !== fileSize
      || createHash("sha256").update(buffer).digest("hex") !== sha256) {
      throw new Error("EVIDENCE_BUFFER_MISMATCH");
    }
    const md5 = createHash("md5").update(buffer).digest("hex");
    return createOrRecover({ id, parentId, mimeType, fileSize, sha256, md5 }, {
      id, name, parents: [parentId], mimeType,
    }, { mimeType, body: Readable.from([buffer]) });
  }

  return { generateDriveId, getDriveFile, ensureDeliveryFolder, uploadEvidenceWithId };
}

module.exports = {
  getLogisticaDriveClient, getPedidosFolderId, createLogisticaDriveStorage,
  ...createLogisticaDriveStorage(),
};
