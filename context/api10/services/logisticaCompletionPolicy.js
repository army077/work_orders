class CompletionHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validCoordinates(latitude, longitude) {
  return typeof latitude === "number" && Number.isFinite(latitude)
    && typeof longitude === "number" && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function normalizeCompletionInput(deliveryId, body = {}) {
  if (typeof deliveryId !== "string" || !/^[1-9][0-9]{0,18}$/.test(deliveryId)
    || BigInt(deliveryId) > 9223372036854775807n) {
    throw new CompletionHttpError(400, "ID de entrega inválido");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some(key => !["latitude", "longitude"].includes(key))) {
    throw new CompletionHttpError(400, "Solo se admite un objeto JSON con latitude y longitude");
  }
  const hasLatitude = Object.hasOwn(body, "latitude");
  const hasLongitude = Object.hasOwn(body, "longitude");
  if (hasLatitude !== hasLongitude) {
    throw new CompletionHttpError(400, "latitude y longitude deben enviarse juntas");
  }
  if (hasLatitude && !validCoordinates(body.latitude, body.longitude)) {
    throw new CompletionHttpError(400, "Coordenadas inválidas");
  }
  return {
    deliveryId,
    coordinates: hasLatitude ? { latitude: body.latitude, longitude: body.longitude } : null,
  };
}

function assertCompletionEvidence(counts) {
  if (Number(counts.photo_uploaded) < 1 || Number(counts.signature_uploaded) !== 1
    || Number(counts.pending) !== 0 || Number(counts.failed) !== 0) {
    throw new CompletionHttpError(409, "La entrega requiere fotos y una firma subidas, sin evidencias pendientes o fallidas");
  }
}

function resolveCompletionCoordinates(requestCoordinates, delivery) {
  if (requestCoordinates) return requestCoordinates;
  if (delivery.latitude == null || delivery.longitude == null
    || !validCoordinates(Number(delivery.latitude), Number(delivery.longitude))) {
    throw new CompletionHttpError(409, "Se requiere GPS para finalizar la entrega");
  }
  // pg devuelve NUMERIC como string: conservar la precisión original al copiar.
  return { latitude: delivery.latitude, longitude: delivery.longitude };
}

function assertCompletionReplay(coordinates, delivery) {
  // La comparación NUMERIC se resuelve en PostgreSQL bajo el lock de entrega.
  if (coordinates && delivery.same_completion_coordinates !== true) {
    throw new CompletionHttpError(409, "La entrega ya fue finalizada con otro GPS");
  }
}

module.exports = {
  CompletionHttpError, normalizeCompletionInput, assertCompletionEvidence,
  resolveCompletionCoordinates, assertCompletionReplay,
};
