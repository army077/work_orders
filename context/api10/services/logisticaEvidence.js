const {
  EvidenceLeaseLost, evidenceFilename, publicEvidence,
} = require("./logisticaEvidencePolicy");

const pendingResponse = () => ({ status: 202, body: { ok: true, status: "PENDING" } });

function createEvidenceService({ repository, drive }) {
  return async function storeEvidence(input, owner) {
    const reservation = await repository.reserve(input, owner);
    if (reservation.action === "replay") {
      return { status: 200, body: {
        ok: true, idempotent_replay: true, evidence: publicEvidence(reservation.evidence),
      } };
    }
    if (reservation.action === "pending") return pendingResponse();

    const { evidence, token } = reservation;
    try {
      // Generación externa fuera de la transacción. Un candidato descartado no
      // crea ningún objeto en Drive. La DB decide los IDs canónicos bajo lock.
      const folderId = reservation.delivery.drive_folder_id ? null : await drive.generateDriveId();
      const fileId = evidence.external_file_id ? null : await drive.generateDriveId();
      const assigned = await repository.assignDriveIds(input, owner, evidence.id, token, { folderId, fileId });
      const folder = assigned.delivery.drive_folder_id;
      const externalId = assigned.evidence.external_file_id;
      await drive.ensureDeliveryFolder({ id: folder, name: assigned.delivery.pedido });
      await repository.renewLease(input, owner, evidence.id, token);
      await drive.uploadEvidenceWithId({
        id: externalId, parentId: folder,
        name: evidenceFilename(assigned.evidence, input.extension),
        mimeType: input.mime_type, fileSize: input.file_size_bytes,
        sha256: input.sha256, buffer: input.buffer,
      });
      const uploaded = await repository.confirmUploaded(
        input, owner, evidence.id, token,
        `https://drive.google.com/file/d/${encodeURIComponent(externalId)}/view`
      );
      return { status: 201, body: {
        ok: true, idempotent_replay: false, evidence: publicEvidence(uploaded),
      } };
    } catch (err) {
      // Ante timeout/red o COMMIT incierto se conservan los IDs y el intento es
      // recuperable. Si UPLOADED ya se confirmó, releaseLease no lo modifica.
      // No se inventa FAILED ni se regenera el archivo externo.
      try {
        await repository.releaseLease(input, owner, evidence.id, token);
      } catch (_releaseError) {
        // Si DB no está disponible, el lease expirará; nunca se borran referencias.
      }
      if (err instanceof EvidenceLeaseLost) return pendingResponse();
      throw err;
    }
  };
}

module.exports = { createEvidenceService };
