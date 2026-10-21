const {
  DeliveryListHttpError, normalizeDeliveryListQuery, deliveryListPage,
} = require("../services/logisticaDeliveryListPolicy");

function createDeliveryListHandler({ repository }) {
  return async (req, res) => {
    try {
      if (!req.auth || !req.logisticaUser) {
        return res.status(401).json({ error: "No autenticado" });
      }
      if (req.body !== undefined && (!req.body || typeof req.body !== "object"
        || Array.isArray(req.body) || Object.keys(req.body).length !== 0)) {
        throw new DeliveryListHttpError(400, "Esta consulta no admite body");
      }
      const input = normalizeDeliveryListQuery(req.query);
      const rows = await repository.list(input, {
        authorizedUserId: req.logisticaUser.id,
      });
      res.set("Cache-Control", "no-store");
      return res.status(200).json(deliveryListPage(rows, input.limit));
    } catch (err) {
      if (err instanceof DeliveryListHttpError) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error("Error consultando entregas logísticas");
      return res.status(500).json({ error: "No se pudieron consultar las entregas" });
    }
  };
}

module.exports = { createDeliveryListHandler };
