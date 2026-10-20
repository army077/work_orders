const fs = require("node:fs");
const path = require("node:path");

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

module.exports = { getLogisticaDriveClient, getPedidosFolderId };
