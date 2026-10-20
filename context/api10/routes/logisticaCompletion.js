const {
  CompletionHttpError, normalizeCompletionInput,
} = require("../services/logisticaCompletionPolicy");

function createCompletionHandler({ repository }) {
  return async (req, res) => {
    try {
      if (!req.auth || !req.logisticaUser) {
        return res.status(401).json({ error: "No autenticado" });
      }
      // El body JSON es opcional; un Content-Type explícito debe ser JSON.
      if (req.headers["content-type"] && !req.is("application/json")) {
        throw new CompletionHttpError(400, "Se requiere un cuerpo application/json");
      }
      const input = normalizeCompletionInput(req.params.id, req.body);
      const result = await repository.finalize(input, {
        authorizedUserId: req.logisticaUser.id,
        firebaseProject: req.auth.firebaseProject,
        uid: req.auth.uid,
      });
      return res.status(200).json({
        ok: true,
        idempotent_replay: result.idempotentReplay,
        delivery: {
          id: result.delivery.id,
          status: result.delivery.status,
          completed_at: result.delivery.completed_at,
        },
      });
    } catch (err) {
      if (err instanceof CompletionHttpError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("Error finalizando entrega logística");
      return res.status(500).json({ error: "No se pudo finalizar la entrega" });
    }
  };
}

module.exports = { createCompletionHandler };
