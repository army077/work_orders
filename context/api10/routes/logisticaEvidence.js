const multer = require("multer");
const {
  PHOTO_MAX_BYTES, EvidenceHttpError, validateEvidenceInput,
} = require("../services/logisticaEvidencePolicy");
const { createEvidenceService } = require("../services/logisticaEvidence");

const parseFile = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1, fields: 2, fieldNameSize: 64, fieldSize: 80, headerPairs: 20,
    fieldNestingDepth: 0, fieldArrayIndexLimit: 0,
    // Busboy emite limit al alcanzar el valor; la política aplica el máximo inclusivo.
    fileSize: PHOTO_MAX_BYTES + 1,
    // Los tres campos válidos no deben activar partsLimit al cerrar el tercero.
    parts: 4,
  },
}).single("file");

function parseEvidenceMultipart(req, res, next) {
  if (!req.is("multipart/form-data")) {
    return res.status(400).json({ error: "Se requiere multipart/form-data" });
  }
  parseFile(req, res, err => {
    if (err || (req.file && req.file.buffer.length > PHOTO_MAX_BYTES)) {
      // Multer puede incluir filenames y campos arbitrarios en el error original.
      return res.status(400).json({ error: "Multipart inválido: un archivo de hasta 10 MB y dos campos" });
    }
    return next();
  });
}

function createEvidenceHandler(dependencies) {
  const storeEvidence = createEvidenceService(dependencies);
  return async (req, res) => {
    try {
      if (!req.auth || !req.logisticaUser) {
        return res.status(401).json({ error: "No autenticado" });
      }
      const input = await validateEvidenceInput(req.params.id, req.body, req.file);
      const result = await storeEvidence(input, {
        authorizedUserId: req.logisticaUser.id,
        firebaseProject: req.auth.firebaseProject,
        uid: req.auth.uid,
      });
      return res.status(result.status).json(result.body);
    } catch (err) {
      if (err instanceof EvidenceHttpError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("Error procesando evidencia logística");
      return res.status(500).json({ error: "No se pudo procesar la evidencia; reintente con el mismo UUID y archivo" });
    }
  };
}

module.exports = { parseEvidenceMultipart, createEvidenceHandler };
