const {
  CompletionHttpError, assertCompletionEvidence, resolveCompletionCoordinates,
  assertCompletionReplay,
} = require("../services/logisticaCompletionPolicy");

function createCompletionRepository(pool) {
  async function finalize(input, owner) {
    const client = await pool.connect();
    let open = false;
    let connectionError;
    let discard;
    const onError = err => { connectionError = err; discard = err; };
    client.on("error", onError);
    const query = async (...args) => {
      if (connectionError) throw connectionError;
      const result = await client.query(...args);
      if (connectionError) throw connectionError;
      return result;
    };
    try {
      open = true;
      await query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await query("SET LOCAL lock_timeout = '5s'");
      await query("SET LOCAL statement_timeout = '10s'");
      // El mismo lock padre que usa el protocolo de reservas de evidencias.
      const locked = await query(
        `SELECT id, status, latitude, longitude,
           completion_latitude, completion_longitude, completed_at,
           (completion_latitude = $5::numeric AND completion_longitude = $6::numeric)
             AS same_completion_coordinates
         FROM public.logistica_deliveries
         WHERE id = $1::bigint AND authorized_user_id = $2::bigint
           AND firebase_project = $3::text AND firebase_uid = $4::text
         FOR UPDATE`,
        [input.deliveryId, owner.authorizedUserId, owner.firebaseProject, owner.uid,
          input.coordinates?.latitude ?? null, input.coordinates?.longitude ?? null]
      );
      let delivery = locked.rows[0];
      if (!delivery) throw new CompletionHttpError(403, "Entrega no disponible");

      const idempotentReplay = delivery.status === "COMPLETED";
      if (idempotentReplay) {
        assertCompletionReplay(input.coordinates, delivery);
      } else {
        if (delivery.status !== "PENDING_EVIDENCE") {
          throw new CompletionHttpError(409, "La entrega no se puede finalizar en su estado actual");
        }
        const evidence = await query(
          `SELECT
             count(*) FILTER (WHERE evidence_type = 'PHOTO' AND status = 'UPLOADED') AS photo_uploaded,
             count(*) FILTER (WHERE evidence_type = 'SIGNATURE' AND status = 'UPLOADED') AS signature_uploaded,
             count(*) FILTER (WHERE status = 'PENDING') AS pending,
             count(*) FILTER (WHERE status = 'FAILED') AS failed
           FROM public.logistica_delivery_evidence WHERE delivery_id = $1::bigint`,
          [input.deliveryId]
        );
        assertCompletionEvidence(evidence.rows[0]);
        const gps = resolveCompletionCoordinates(input.coordinates, delivery);
        const updated = await query(
          `UPDATE public.logistica_deliveries
           SET status = 'COMPLETED', completion_latitude = $2::numeric,
               completion_longitude = $3::numeric, completed_at = now(), updated_at = now()
           WHERE id = $1::bigint AND status = 'PENDING_EVIDENCE'
           RETURNING id, status, completed_at`,
          [input.deliveryId, gps.latitude, gps.longitude]
        );
        delivery = updated.rows[0];
        if (!delivery) throw new Error("COMPLETION_UPDATE_NOT_CONFIRMED");
      }
      const committed = await query("COMMIT");
      if (committed.command !== "COMMIT") throw new Error("COMMIT_NOT_CONFIRMED");
      open = false;
      return { delivery, idempotentReplay };
    } catch (err) {
      if (open) {
        try { await query("ROLLBACK"); } catch (rollbackError) { discard = rollbackError; }
      }
      throw err;
    } finally {
      client.removeListener("error", onError);
      client.release(discard);
    }
  }
  return { finalize };
}

module.exports = { createCompletionRepository };
