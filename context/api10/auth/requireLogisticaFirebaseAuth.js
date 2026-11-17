const { getLogisticaAuth, EXPECTED_PROJECT } = require("./firebaseLogistica");

// Solo autenticación: la identidad sale del token verificado, nunca del body.
async function requireLogisticaFirebaseAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    return res.status(401).json({ error: "Authorization Bearer requerido" });
  }

  let auth;
  try {
    auth = getLogisticaAuth();
  } catch (err) {
    console.error("Configuración Firebase logística inválida:", err.message);
    return res.status(500).json({ error: "Autenticación no configurada" });
  }

  try {
    const decoded = await auth.verifyIdToken(match[1]);
    if (decoded.aud !== EXPECTED_PROJECT) {
      return res.status(401).json({ error: "Token inválido" });
    }
    req.auth = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      firebaseProject: EXPECTED_PROJECT,
    };
    return next();
  } catch (_err) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
}

module.exports = { requireLogisticaFirebaseAuth };
