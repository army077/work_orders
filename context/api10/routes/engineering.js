const express = require("express");

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function id(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new RequestError(400, "ID invalido");
  }
  return Number(value);
}

function text(value, label, max, optional = false) {
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || (!optional && !value.trim()) || value.trim().length > max) {
    throw new RequestError(400, `${label}: valor requerido o longitud invalida (maximo ${max})`);
  }
  return value.trim();
}

function pdfUrl(value) {
  const link = text(value, "Enlace del PDF", 2048);
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new RequestError(400, "El enlace debe ser una URL HTTP o HTTPS valida");
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new RequestError(400, "El enlace debe usar HTTP o HTTPS, sin credenciales");
  }
  if (url.href.length > 2048) throw new RequestError(400, "El enlace del PDF es demasiado largo");
  return url.href;
}

async function event(client, { machineId, documentId = null, versionId = null, action, actor, reason = "", before = null, after = null }) {
  await client.query(
    `INSERT INTO engineering_document_event
     (maquina_id, document_id, version_id, action, actor, reason, before_data, after_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [machineId, documentId, versionId, action, actor, reason,
      before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)]
  );
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function machine(client, machineId) {
  const { rows } = await client.query("SELECT * FROM maquinas_normalizado WHERE id=$1 FOR UPDATE", [machineId]);
  if (!rows.length) throw new RequestError(404, "Maquina no encontrada");
  return rows[0];
}

async function document(client, documentId) {
  const { rows } = await client.query("SELECT * FROM engineering_document WHERE id=$1 FOR UPDATE", [documentId]);
  if (!rows.length) throw new RequestError(404, "Documento no encontrado");
  return rows[0];
}

async function documentContext(client, documentId) {
  // All writers lock machine, then document, then version to avoid deadlocks.
  const { rows } = await client.query("SELECT maquina_id FROM engineering_document WHERE id=$1", [documentId]);
  if (!rows.length) throw new RequestError(404, "Documento no encontrado");
  const machineRow = await machine(client, rows[0].maquina_id);
  const doc = await document(client, documentId);
  return { machineRow, doc };
}

function requireActive(machineRow) {
  if (!machineRow.is_active) throw new RequestError(409, "La maquina esta inactiva");
}

function requireFresh(row, updatedAt) {
  if (typeof updatedAt !== "string" || new Date(updatedAt).getTime() !== new Date(row.updated_at).getTime()) {
    throw new RequestError(409, "El registro cambio. Recarga antes de guardar o cambiar su estado");
  }
}

function createEngineeringRouter(pool) {
  const r = express.Router();
  const route = (handler) => async (req, res, next) => {
    try { await handler(req, res); } catch (error) { next(error); }
  };
  r.use((req, _res, next) => {
    if (["POST", "PUT"].includes(req.method) &&
        (!req.body || typeof req.body !== "object" || Array.isArray(req.body))) {
      return next(new RequestError(400, "Se requiere un objeto JSON"));
    }
    next();
  });

  r.get("/machines", route(async (_req, res) => {
    const { rows } = await pool.query("SELECT * FROM maquinas_normalizado ORDER BY name, id");
    res.json(rows);
  }));

  r.post("/machines", route(async (req, res) => {
    const name = text(req.body.name, "Nombre", 200);
    const description = text(req.body.description, "Descripcion", 2000, true);
    const actor = text(req.body.actor, "Responsable", 200);
    const result = await transaction(pool, async (client) => {
      const { rows } = await client.query(
        "INSERT INTO maquinas_normalizado(name, description) VALUES ($1,$2) RETURNING *", [name, description]
      );
      await event(client, { machineId: rows[0].id, action: "MAQUINA_CREADA", actor, after: rows[0] });
      return rows[0];
    });
    res.status(201).json(result);
  }));

  r.put("/machines/:id", route(async (req, res) => {
    const machineId = id(req.params.id);
    const name = text(req.body.name, "Nombre", 200);
    const description = text(req.body.description, "Descripcion", 2000, true);
    const actor = text(req.body.actor, "Responsable", 200);
    if (typeof req.body.is_active !== "boolean") throw new RequestError(400, "is_active debe ser booleano");
    const result = await transaction(pool, async (client) => {
      const before = await machine(client, machineId);
      requireFresh(before, req.body.updated_at);
      if (!req.body.is_active) {
        const { rows } = await client.query(
          `SELECT v.id FROM engineering_document_version v
           JOIN engineering_document d ON d.id=v.document_id
           WHERE d.maquina_id=$1 AND v.status='VIGENTE' LIMIT 1`, [machineId]
        );
        if (rows.length) throw new RequestError(409, "Retira el manual vigente antes de desactivar la maquina");
      }
      const { rows } = await client.query(
        `UPDATE maquinas_normalizado SET name=$1, description=$2, is_active=$3,
         updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
         WHERE id=$4 RETURNING *`, [name, description, req.body.is_active, machineId]
      );
      await event(client, { machineId, action: "MAQUINA_ACTUALIZADA", actor, before, after: rows[0] });
      return rows[0];
    });
    res.json(result);
  }));

  r.get("/machines/:id/events", route(async (req, res) => {
    const machineId = id(req.params.id);
    const found = await pool.query("SELECT id FROM maquinas_normalizado WHERE id=$1", [machineId]);
    if (!found.rows.length) throw new RequestError(404, "Maquina no encontrada");
    const { rows } = await pool.query(
      "SELECT * FROM engineering_document_event WHERE maquina_id=$1 ORDER BY id DESC", [machineId]
    );
    res.json(rows);
  }));

  r.get("/documents", route(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT d.*, m.name AS machine_name, m.is_active AS machine_active,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'revision',v.revision,'status',v.status)
           ORDER BY v.revision DESC) FROM engineering_document_version v WHERE v.document_id=d.id), '[]'::jsonb) AS versions
       FROM engineering_document d JOIN maquinas_normalizado m ON m.id=d.maquina_id
       ORDER BY d.updated_at DESC, d.id DESC`
    );
    res.json(rows);
  }));

  r.post("/documents", route(async (req, res) => {
    const machineId = id(req.body.maquina_id);
    const code = text(req.body.code, "Codigo", 80);
    const title = text(req.body.title, "Titulo", 250);
    const actor = text(req.body.actor, "Responsable", 200);
    const result = await transaction(pool, async (client) => {
      requireActive(await machine(client, machineId));
      const { rows } = await client.query(
        `INSERT INTO engineering_document(maquina_id, code, title, created_by)
         VALUES ($1,$2,$3,$4) RETURNING *`, [machineId, code, title, actor]
      );
      await event(client, { machineId, documentId: rows[0].id, action: "DOCUMENTO_CREADO", actor, after: rows[0] });
      return rows[0];
    });
    res.status(201).json(result);
  }));

  r.get("/documents/:id", route(async (req, res) => {
    const documentId = id(req.params.id);
    // One statement gives a consistent snapshot during concurrent publication.
    const { rows } = await pool.query(
      `SELECT d.*, m.name AS machine_name, m.is_active AS machine_active,
         COALESCE((SELECT jsonb_agg(v ORDER BY v.revision DESC)
           FROM engineering_document_version v WHERE v.document_id=d.id), '[]'::jsonb) AS versions,
         COALESCE((SELECT jsonb_agg(e ORDER BY e.id DESC)
           FROM engineering_document_event e WHERE e.document_id=d.id), '[]'::jsonb) AS events
       FROM engineering_document d JOIN maquinas_normalizado m ON m.id=d.maquina_id WHERE d.id=$1`,
      [documentId]
    );
    if (!rows.length) throw new RequestError(404, "Documento no encontrado");
    res.json(rows[0]);
  }));

  r.put("/documents/:id", route(async (req, res) => {
    const documentId = id(req.params.id);
    const code = text(req.body.code, "Codigo", 80);
    const title = text(req.body.title, "Titulo", 250);
    const actor = text(req.body.actor, "Responsable", 200);
    const result = await transaction(pool, async (client) => {
      const { doc: before } = await documentContext(client, documentId);
      requireFresh(before, req.body.updated_at);
      const { rows } = await client.query(
        `UPDATE engineering_document SET code=$1, title=$2,
         updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') WHERE id=$3 RETURNING *`,
        [code, title, documentId]
      );
      await event(client, { machineId: before.maquina_id, documentId, action: "DOCUMENTO_ACTUALIZADO", actor, before, after: rows[0] });
      return rows[0];
    });
    res.json(result);
  }));

  r.post("/documents/:id/versions", route(async (req, res) => {
    const documentId = id(req.params.id);
    const url = pdfUrl(req.body.pdf_url);
    const summary = text(req.body.change_summary, "Resumen de cambios", 4000);
    const actor = text(req.body.actor, "Responsable", 200);
    const result = await transaction(pool, async (client) => {
      const { machineRow, doc } = await documentContext(client, documentId);
      requireActive(machineRow);
      const { rows } = await client.query(
        `INSERT INTO engineering_document_version(document_id, revision, pdf_url, change_summary, created_by)
         SELECT $1, COALESCE(MAX(revision),0)+1, $2, $3, $4
         FROM engineering_document_version WHERE document_id=$1 RETURNING *`,
        [documentId, url, summary, actor]
      );
      await client.query(
        "UPDATE engineering_document SET updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') WHERE id=$1", [documentId]
      );
      await event(client, { machineId: doc.maquina_id, documentId, versionId: rows[0].id, action: "VERSION_CREADA", actor, after: rows[0] });
      return rows[0];
    });
    res.status(201).json(result);
  }));

  async function versionContext(client, versionId) {
    const { rows: refs } = await client.query("SELECT document_id FROM engineering_document_version WHERE id=$1", [versionId]);
    if (!refs.length) throw new RequestError(404, "Version no encontrada");
    const { machineRow, doc } = await documentContext(client, refs[0].document_id);
    const { rows } = await client.query("SELECT * FROM engineering_document_version WHERE id=$1 FOR UPDATE", [versionId]);
    return { doc, machineRow, version: rows[0] };
  }

  r.put("/versions/:id", route(async (req, res) => {
    const versionId = id(req.params.id);
    const url = pdfUrl(req.body.pdf_url);
    const summary = text(req.body.change_summary, "Resumen de cambios", 4000);
    const actor = text(req.body.actor, "Responsable", 200);
    const result = await transaction(pool, async (client) => {
      const { doc, machineRow, version } = await versionContext(client, versionId);
      requireActive(machineRow);
      requireFresh(version, req.body.updated_at);
      if (version.status !== "BORRADOR") throw new RequestError(409, "Solo se puede editar un borrador. Crea una nueva revision");
      const { rows } = await client.query(
        `UPDATE engineering_document_version SET pdf_url=$1, change_summary=$2,
         updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
         WHERE id=$3 RETURNING *`, [url, summary, versionId]
      );
      await client.query(
        "UPDATE engineering_document SET updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') WHERE id=$1", [doc.id]
      );
      await event(client, { machineId: doc.maquina_id, documentId: doc.id, versionId, action: "BORRADOR_ACTUALIZADO", actor, before: version, after: rows[0] });
      return rows[0];
    });
    res.json(result);
  }));

  r.post("/versions/:id/publish", route(async (req, res) => {
    const versionId = id(req.params.id);
    const actor = text(req.body.actor, "Responsable", 200);
    const result = await transaction(pool, async (client) => {
      const { doc, machineRow, version } = await versionContext(client, versionId);
      requireActive(machineRow);
      requireFresh(version, req.body.updated_at);
      if (version.status !== "BORRADOR") throw new RequestError(409, "Solo se puede publicar un borrador");
      const { rows: previous } = await client.query(
        "SELECT * FROM engineering_document_version WHERE document_id=$1 AND status='VIGENTE' FOR UPDATE", [doc.id]
      );
      const { rows: newer } = await client.query(
        "SELECT id FROM engineering_document_version WHERE document_id=$1 AND published_at IS NOT NULL AND revision>$2 LIMIT 1",
        [doc.id, version.revision]
      );
      if (newer.length) {
        throw new RequestError(409, "Ya se publico una revision posterior. Crea una nueva revision");
      }
      const { rows: obsolete } = await client.query(
        `UPDATE engineering_document_version SET status='OBSOLETO',
         updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
         WHERE document_id=$1 AND status='VIGENTE' RETURNING *`, [doc.id]
      );
      for (const old of obsolete) {
        await event(client, { machineId: doc.maquina_id, documentId: doc.id, versionId: old.id,
          action: "VERSION_OBSOLETA", actor, reason: `Sustituida por revision ${version.revision}`, before: previous[0], after: old });
      }
      const { rows } = await client.query(
        `UPDATE engineering_document_version SET status='VIGENTE', published_by=$1, published_at=clock_timestamp(),
         updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') WHERE id=$2 RETURNING *`, [actor, versionId]
      );
      await client.query(
        "UPDATE engineering_document SET updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') WHERE id=$1", [doc.id]
      );
      await event(client, { machineId: doc.maquina_id, documentId: doc.id, versionId,
        action: "VERSION_PUBLICADA", actor, before: version, after: rows[0] });
      return rows[0];
    });
    res.json(result);
  }));

  r.post("/versions/:id/retire", route(async (req, res) => {
    const versionId = id(req.params.id);
    const actor = text(req.body.actor, "Responsable", 200);
    const reason = text(req.body.reason, "Motivo de baja", 2000);
    const result = await transaction(pool, async (client) => {
      const { doc, version } = await versionContext(client, versionId);
      requireFresh(version, req.body.updated_at);
      if (version.status === "RETIRADO") throw new RequestError(409, "La version ya esta retirada");
      const { rows } = await client.query(
        `UPDATE engineering_document_version SET status='RETIRADO', retired_by=$1, retired_at=clock_timestamp(),
         retirement_reason=$2, updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond')
         WHERE id=$3 RETURNING *`, [actor, reason, versionId]
      );
      await client.query(
        "UPDATE engineering_document SET updated_at=GREATEST(clock_timestamp(), updated_at + interval '1 millisecond') WHERE id=$1", [doc.id]
      );
      await event(client, { machineId: doc.maquina_id, documentId: doc.id, versionId,
        action: "VERSION_RETIRADA", actor, reason, before: version, after: rows[0] });
      return rows[0];
    });
    res.json(result);
  }));

  r.use((error, _req, res, _next) => {
    if (error instanceof RequestError) return res.status(error.status).json({ error: error.message });
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe ese nombre/codigo, un manual para esta maquina o una revision vigente" });
    if (["23503", "23514", "22003"].includes(error.code)) return res.status(400).json({ error: "Los datos no cumplen las restricciones del catalogo documental" });
    console.error("API10 documentacion de Ingenieria:", error);
    res.status(500).json({ error: "No se pudo completar la operacion documental" });
  });
  return r;
}

module.exports = { createEngineeringRouter };
