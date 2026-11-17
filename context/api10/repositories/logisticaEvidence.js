const { randomUUID } = require("node:crypto");
const {
  EvidenceHttpError, EvidenceLeaseLost, sameEvidenceAttempt, assertMutable, nextEvidenceSequence,
} = require("../services/logisticaEvidencePolicy");

const EVIDENCE_COLUMNS = `id, delivery_id, client_evidence_id, evidence_type, sequence_no,
  status, storage_provider, external_file_id, mime_type, file_size_bytes, sha256,
  processing_token, processing_expires_at`;

function createEvidenceRepository(pool) {
  async function transaction(work) {
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
      // Marcar antes de BEGIN permite descartar conexiones con resultado incierto.
      open = true;
      await query("BEGIN ISOLATION LEVEL READ COMMITTED");
      // Los locks y las sentencias tienen un límite; nunca se espera a Drive aquí.
      await query("SET LOCAL lock_timeout = '5s'");
      await query("SET LOCAL statement_timeout = '10s'");
      const result = await work(query);
      const committed = await query("COMMIT");
      if (committed.command !== "COMMIT") throw new Error("COMMIT_NOT_CONFIRMED");
      open = false;
      return result;
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

  async function lockDelivery(query, deliveryId, owner) {
    const { rows } = await query(
      `SELECT id, pedido, status, drive_folder_id FROM public.logistica_deliveries
       WHERE id = $1::bigint AND authorized_user_id = $2::bigint
         AND firebase_project = $3::text AND firebase_uid = $4::text
       FOR UPDATE`,
      [deliveryId, owner.authorizedUserId, owner.firebaseProject, owner.uid]
    );
    if (!rows[0]) throw new EvidenceHttpError(403, "Entrega no disponible");
    return rows[0];
  }

  async function leasedEvidence(query, deliveryId, evidenceId, token) {
    const { rows } = await query(
      `SELECT ${EVIDENCE_COLUMNS} FROM public.logistica_delivery_evidence
       WHERE id = $1::bigint AND delivery_id = $2::bigint AND status = 'PENDING'
         AND processing_token = $3::uuid AND processing_expires_at > clock_timestamp()`,
      [evidenceId, deliveryId, token]
    );
    if (!rows[0]) throw new EvidenceLeaseLost();
    return rows[0];
  }

  async function reserve(input, owner) {
    return transaction(async query => {
      const delivery = await lockDelivery(query, input.delivery_id, owner);
      const existing = await query(
        `SELECT ${EVIDENCE_COLUMNS},
           (processing_token IS NOT NULL AND processing_expires_at > clock_timestamp()) AS lease_active
         FROM public.logistica_delivery_evidence WHERE client_evidence_id = $1::uuid`,
        [input.client_evidence_id]
      );
      const row = existing.rows[0];
      if (row && !sameEvidenceAttempt(row, input)) {
        // Misma respuesta para UUID de otra entrega/usuario o contenido distinto.
        throw new EvidenceHttpError(409, "client_evidence_id no disponible para estos datos");
      }
      if (row && row.status === "UPLOADED") return { action: "replay", evidence: row };
      assertMutable(delivery);
      if (row && row.lease_active) return { action: "pending" };
      if (row && row.storage_provider && row.storage_provider !== "GOOGLE_DRIVE") {
        throw new EvidenceHttpError(409, "La evidencia no está disponible para este procesamiento");
      }

      const token = randomUUID();
      let evidence;
      if (row) {
        const result = await query(
          `UPDATE public.logistica_delivery_evidence SET status = 'PENDING',
             storage_provider = 'GOOGLE_DRIVE', processing_token = $2::uuid,
             processing_expires_at = clock_timestamp() + interval '5 minutes', updated_at = now()
           WHERE id = $1::bigint RETURNING ${EVIDENCE_COLUMNS}`,
          [row.id, token]
        );
        evidence = result.rows[0];
      } else {
        // Todas las filas operacionales cuentan, incluidas PENDING y FAILED.
        // El lock padre serializa tanto los cupos como la asignación de secuencia.
        const { rows } = await query(
          `SELECT count(*) AS count, COALESCE(max(sequence_no), 0) AS max_sequence
           FROM public.logistica_delivery_evidence WHERE delivery_id = $1::bigint AND evidence_type = $2`,
          [input.delivery_id, input.evidence_type]
        );
        const sequence = nextEvidenceSequence(input.evidence_type, rows[0].count, rows[0].max_sequence);
        const result = await query(
          `INSERT INTO public.logistica_delivery_evidence
             (delivery_id, client_evidence_id, evidence_type, sequence_no, storage_provider,
              mime_type, file_size_bytes, sha256, status, processing_token, processing_expires_at)
           VALUES ($1::bigint, $2::uuid, $3, $4, 'GOOGLE_DRIVE', $5, $6::bigint, $7,
             'PENDING', $8::uuid, clock_timestamp() + interval '5 minutes')
           ON CONFLICT (client_evidence_id) DO NOTHING RETURNING ${EVIDENCE_COLUMNS}`,
          [input.delivery_id, input.client_evidence_id, input.evidence_type, sequence,
            input.mime_type, input.file_size_bytes, input.sha256, token]
        );
        evidence = result.rows[0];
        if (!evidence) throw new EvidenceHttpError(409, "client_evidence_id no disponible para estos datos");
      }
      return { action: "process", delivery, evidence, token };
    });
  }

  async function assignDriveIds(input, owner, evidenceId, token, candidates) {
    return transaction(async query => {
      const delivery = await lockDelivery(query, input.delivery_id, owner);
      assertMutable(delivery);
      const evidence = await leasedEvidence(query, input.delivery_id, evidenceId, token);
      if (!delivery.drive_folder_id) {
        if (!candidates.folderId) throw new Error("MISSING_FOLDER_ID");
        await query(
          `UPDATE public.logistica_deliveries SET drive_folder_id = $2, updated_at = now()
           WHERE id = $1::bigint`, [input.delivery_id, candidates.folderId]
        );
        delivery.drive_folder_id = candidates.folderId;
      }
      if (!evidence.external_file_id && !candidates.fileId) throw new Error("MISSING_FILE_ID");
      const result = await query(
        `UPDATE public.logistica_delivery_evidence
         SET external_file_id = COALESCE(external_file_id, $3), storage_provider = 'GOOGLE_DRIVE',
           processing_expires_at = clock_timestamp() + interval '5 minutes', updated_at = now()
         WHERE id = $1::bigint AND processing_token = $2::uuid
           AND processing_expires_at > clock_timestamp() RETURNING ${EVIDENCE_COLUMNS}`,
        [evidenceId, token, candidates.fileId || null]
      );
      if (!result.rows[0]) throw new EvidenceLeaseLost();
      return { delivery, evidence: result.rows[0] };
    });
  }

  async function renewLease(input, owner, evidenceId, token) {
    return transaction(async query => {
      const delivery = await lockDelivery(query, input.delivery_id, owner);
      assertMutable(delivery);
      const result = await query(
        `UPDATE public.logistica_delivery_evidence
         SET processing_expires_at = clock_timestamp() + interval '5 minutes', updated_at = now()
         WHERE id = $1::bigint AND delivery_id = $2::bigint AND status = 'PENDING'
           AND processing_token = $3::uuid AND processing_expires_at > clock_timestamp()
         RETURNING id`, [evidenceId, input.delivery_id, token]
      );
      if (!result.rows[0]) throw new EvidenceLeaseLost();
    });
  }

  async function confirmUploaded(input, owner, evidenceId, token, externalUrl) {
    return transaction(async query => {
      const delivery = await lockDelivery(query, input.delivery_id, owner);
      assertMutable(delivery);
      const result = await query(
        `UPDATE public.logistica_delivery_evidence SET status = 'UPLOADED', external_url = $4,
           processing_token = NULL, processing_expires_at = NULL, updated_at = now()
         WHERE id = $1::bigint AND delivery_id = $2::bigint AND status = 'PENDING'
           AND processing_token = $3::uuid AND processing_expires_at > clock_timestamp()
         RETURNING ${EVIDENCE_COLUMNS}`, [evidenceId, input.delivery_id, token, externalUrl]
      );
      if (!result.rows[0]) throw new EvidenceLeaseLost();
      return result.rows[0];
    });
  }

  async function releaseLease(input, owner, evidenceId, token) {
    return transaction(async query => {
      await lockDelivery(query, input.delivery_id, owner);
      // Un worker vencido nunca libera el lease adquirido por un retry posterior.
      await query(
        `UPDATE public.logistica_delivery_evidence
         SET processing_token = NULL, processing_expires_at = NULL, updated_at = now()
         WHERE id = $1::bigint AND delivery_id = $2::bigint
           AND processing_token = $3::uuid AND status = 'PENDING'`,
        [evidenceId, input.delivery_id, token]
      );
    });
  }

  return { reserve, assignDriveIds, renewLease, confirmUploaded, releaseLease };
}

module.exports = { createEvidenceRepository };
