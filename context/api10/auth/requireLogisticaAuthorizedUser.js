const pool = require("../db");

// Debe ejecutarse despues de requireLogisticaFirebaseAuth.
// La autorizacion usa solo la identidad verificada (req.auth), nunca datos del cliente.
async function requireLogisticaAuthorizedUser(req, res, next) {
  const firebaseProject = req.auth && req.auth.firebaseProject;
  const uid = req.auth && req.auth.uid;
  if (!firebaseProject || !uid) {
    return res.status(401).json({ error: "No autenticado" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, firebase_uid, email, display_name
         FROM public.logistica_authorized_users
        WHERE firebase_project = $1
          AND firebase_uid = $2
          AND is_active = true
        LIMIT 1`,
      [firebaseProject, uid]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: "Usuario no autorizado" });
    }

    const row = rows[0];
    req.logisticaUser = {
      id: row.id,
      firebaseUid: row.firebase_uid,
      email: row.email,
      displayName: row.display_name,
    };
    return next();
  } catch (err) {
    console.error("Error verificando autorizacion logistica:", err.code || err.message);
    return res.status(500).json({ error: "Error verificando autorizacion" });
  }
}

module.exports = { requireLogisticaAuthorizedUser };
