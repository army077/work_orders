const {
  DeliveryHistoryHttpError, normalizeDeliveryHistoryQuery, deliveryHistoryPage,
} = require("../services/logisticaDeliveryHistoryPolicy");

function createDeliveryHistoryHandler({ repository }) {
  return async (req, res) => {
    try {
      if (!req.auth || !req.logisticaUser) {
        return res.status(401).json({ error: "No autenticado" });
      }
      if (req.body !== undefined && (!req.body || typeof req.body !== "object"
        || Array.isArray(req.body) || Object.keys(req.body).length !== 0)) {
        throw new DeliveryHistoryHttpError(400, "Esta consulta no admite body");
      }
      const input = normalizeDeliveryHistoryQuery(req.query);
      const rows = await repository.list(input, { authorizedUserId: req.logisticaUser.id });
      res.set("Cache-Control", "no-store");
      return res.status(200).json(deliveryHistoryPage(rows, input));
    } catch (err) {
      if (err instanceof DeliveryHistoryHttpError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("Error consultando historial logístico");
      return res.status(500).json({ error: "No se pudo consultar el historial" });
    }
  };
}

module.exports = { createDeliveryHistoryHandler };
