const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const APP_NAME = "logistica-ar";
const EXPECTED_PROJECT = "logistica-ar";

function getLogisticaProjectId() {
  const projectId = process.env.FIREBASE_LOGISTICA_PROJECT_ID;
  if (!projectId) {
    throw new Error("Falta FIREBASE_LOGISTICA_PROJECT_ID");
  }
  if (projectId !== EXPECTED_PROJECT) {
    throw new Error(`FIREBASE_LOGISTICA_PROJECT_ID debe ser '${EXPECTED_PROJECT}'`);
  }
  return projectId;
}

// Inicialización perezosa: credenciales vía Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS).
function getLogisticaAuth() {
  const projectId = getLogisticaProjectId();
  const existing = getApps().find((a) => a.name === APP_NAME);
  const app = existing || initializeApp({ credential: applicationDefault(), projectId }, APP_NAME);
  return getAuth(app);
}

module.exports = { getLogisticaAuth, getLogisticaProjectId, EXPECTED_PROJECT };
