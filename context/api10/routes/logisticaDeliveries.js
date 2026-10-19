const express = require("express");
const pool = require("../db");
const { requireLogisticaFirebaseAuth } = require("../auth/requireLogisticaFirebaseAuth");
const { requireLogisticaAuthorizedUser } = require("../auth/requireLogisticaAuthorizedUser");

const router = express.Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class PayloadValidationError extends Error {}

function normalizeString(value, field, required = false) {
  if (!required && (value === undefined || value === null)) return null;
  if (typeof value !== "string") {
    throw new PayloadValidationError(`${field} debe ser un string`);
  }
  const normalized = value.trim();
  if (normalized.includes("\u0000")) {
    throw new PayloadValidationError(`${field} contiene caracteres no admitidos`);
  }
  if (required && normalized.length === 0) {
    throw new PayloadValidationError(`${field} es obligatorio`);
  }
  return normalized || null;
}

function normalizePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PayloadValidationError("Se requiere un objeto JSON");
  }

  const clientRequestId = normalizeString(body.client_request_id, "client_request_id", true);
  if (!UUID_PATTERN.test(clientRequestId)) {
    throw new PayloadValidationError("client_request_id debe ser un UUID en formato canónico");
  }

  const latitude = body.latitude ?? null;
  const longitude = body.longitude ?? null;
  if ((latitude === null) !== (longitude === null)) {
    throw new PayloadValidationError("latitude y longitude deben enviarse juntas");
  }
  if (latitude !== null && (
    typeof latitude !== "number" || !Number.isFinite(latitude)
    || typeof longitude !== "number" || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  )) {
    throw new PayloadValidationError("Coordenadas inválidas");
  }

  // Lista explícita: ningún campo de identidad, estado o fecha procede del body.
  return {
    client_request_id: clientRequestId.toLowerCase(),
    pedido: normalizeString(body.pedido, "pedido", true),
    equipos: normalizeString(body.equipos, "equipos", true),
    chofer: normalizeString(body.chofer, "chofer", true),
    observaciones: normalizeString(body.observaciones, "observaciones"),
    instalara: normalizeString(body.instalara, "instalara"),
    latitude,
    longitude,
    app_version: normalizeString(body.app_version, "app_version"),
  };
}

function publicDelivery(row) {
  return {
    id: row.id,
    client_request_id: row.client_request_id,
    pedido: row.pedido,
    status: row.status,
    created_at: row.created_at,
  };
}

router.post(
  "/entregas",
  requireLogisticaFirebaseAuth,
  requireLogisticaAuthorizedUser,
  async (req, res) => {
    let client;
    let transactionOpen = false;
    let releaseError;
    let connectionError;
    const onClientError = (err) => {
      connectionError = err;
      releaseError = err;
    };
    const query = async (...args) => {
      if (connectionError) throw connectionError;
      const result = await client.query(...args);
      if (connectionError) throw connectionError;
      return result;
    };

    try {
      if (!req.is("application/json")) {
        throw new PayloadValidationError("Se requiere un cuerpo application/json");
      }
      const payload = normalizePayload(req.body);
      const immutableValues = [
        payload.client_request_id,
        req.logisticaUser.id,
        req.auth.firebaseProject,
        req.auth.uid,
        payload.pedido,
        payload.equipos,
        payload.chofer,
        payload.observaciones,
        payload.instalara,
        payload.latitude,
        payload.longitude,
        payload.app_version,
      ];

      client = await pool.connect();
      client.on("error", onClientError);
      await query("BEGIN ISOLATION LEVEL READ COMMITTED");
      transactionOpen = true;

      // status, created_at y updated_at quedan a cargo de los DEFAULT de la tabla.
      const inserted = await query(
        `INSERT INTO public.logistica_deliveries (
           client_request_id, authorized_user_id, firebase_project, firebase_uid,
           pedido, equipos, chofer, observaciones, instalara,
           latitude, longitude, app_version, auth_email, auth_display_name
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (client_request_id) DO NOTHING
         RETURNING id, client_request_id, pedido, status, created_at`,
        [
          ...immutableValues,
          req.logisticaUser.email || req.auth.email || null,
          req.logisticaUser.displayName || req.auth.name || null,
        ]
      );

      let delivery = inserted.rows[0];
      const idempotentReplay = !delivery;

      if (idempotentReplay) {
        // Otra creación concurrente termina antes de resolver ON CONFLICT.
        // Una sentencia separada en READ COMMITTED ve esa fila ya confirmada.
        // FOR SHARE mantiene estable el registro hasta terminar la transacción.
        const existing = await query(
          `SELECT id, client_request_id, pedido, status, created_at,
             (authorized_user_id = $2::bigint
               AND firebase_project = $3::text
               AND firebase_uid = $4::text) AS same_owner,
             (pedido IS NOT DISTINCT FROM $5::text
               AND equipos IS NOT DISTINCT FROM $6::text
               AND chofer IS NOT DISTINCT FROM $7::text
               AND observaciones IS NOT DISTINCT FROM $8::text
               AND instalara IS NOT DISTINCT FROM $9::text
               AND latitude IS NOT DISTINCT FROM $10::numeric
               AND longitude IS NOT DISTINCT FROM $11::numeric
               AND app_version IS NOT DISTINCT FROM $12::text) AS same_payload
           FROM public.logistica_deliveries
           WHERE client_request_id = $1::uuid
           FOR SHARE`,
          immutableValues
        );

        delivery = existing.rows[0];
        if (!delivery) {
          // Una eliminación concurrente no puede convertirse en un éxito ficticio.
          throw new Error("DELIVERY_MISSING_AFTER_CONFLICT");
        }
        if (delivery.same_owner !== true || delivery.same_payload !== true) {
          await query("ROLLBACK");
          transactionOpen = false;
          return res.status(409).json({
            error: delivery.same_owner === true
              ? "client_request_id ya fue utilizado con otros datos"
              : "client_request_id no disponible",
          });
        }
      }

      const committed = await query("COMMIT");
      if (committed.command !== "COMMIT") throw new Error("COMMIT_NOT_CONFIRMED");
      transactionOpen = false;
      return res.status(idempotentReplay ? 200 : 201).json({
        ok: true,
        idempotent_replay: idempotentReplay,
        delivery: publicDelivery(delivery),
      });
    } catch (err) {
      if (transactionOpen) {
        try {
          await query("ROLLBACK");
        } catch (rollbackError) {
          releaseError = rollbackError;
          console.error("No se pudo confirmar ROLLBACK de entrega logística");
        }
      }
      if (err instanceof PayloadValidationError) {
        return res.status(400).json({ error: err.message });
      }
      console.error("Error creando entrega logística:", err.code || "INTERNAL_ERROR");
      return res.status(500).json({ error: "No se pudo procesar la entrega" });
    } finally {
      // Un cliente cuya recuperación falló no debe volver utilizable al pool.
      if (client) {
        client.removeListener("error", onClientError);
        client.release(releaseError);
      }
    }
  }
);

module.exports = router;
