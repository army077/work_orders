const express = require("express");
const r = express.Router();
const pool = require("../db");

r.post('/', async (req, res) => {
  const { template_id, title, position } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO template_section(template_id, title, position)
     VALUES ($1,$2,$3) RETURNING *`, [template_id, title, position]
  );
  res.status(201).json(rows[0]);
});

r.get('/', async (req, res) => {
  const template_id = Number(req.query.template_id);
  const { rows } = await pool.query(
    `SELECT * FROM template_section WHERE template_id=$1 ORDER BY position`, [template_id]
  );
  res.json(rows);
});

/**
 * UPDATE (PUT/PATCH /sections/:id)
 * Body: { title?: string, position?: number }
 * Nota: 'position' se recomienda modificar con /reorder,
 * pero lo dejamos opcional por si quieres cambiarlo de forma aislada.
 */
r.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { title, position } = req.body ?? {};

  // Validaciones básicas
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "id inválido" });
  }
  if (title == null && position == null) {
    return res.status(400).json({ error: "Nada para actualizar" });
  }

  // Construimos SET dinámico
  const sets = [];
  const params = [];
  let p = 1;

  if (title != null) {
    sets.push(`title = $${p++}`);
    params.push(title);
  }
  if (position != null) {
    sets.push(`position = $${p++}`);
    params.push(position);
  }

  params.push(id);

  try {
    const { rows } = await pool.query(
      `UPDATE template_section
       SET ${sets.join(", ")}
       WHERE id = $${p}
       RETURNING *`,
      params
    );

    if (!rows.length) {
      return res.status(404).json({ error: "section not found" });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error("sections update failed:", e);
    res.status(500).json({ error: "update failed" });
  }
});
// Delete
r.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);

  // Validación básica
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "id inválido" });
  }

  try {
    const { rows } = await pool.query(
      `DELETE FROM template_section
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "section not found" });
    }

    res.json({
      message: "section deleted",
      section: rows[0],
    });
  } catch (e) {
    console.error("sections delete failed:", e);
    res.status(500).json({ error: "delete failed" });
  }
});

// routes/sections.js
r.patch("/reorder", async (req, res) => {
  let { template_id, items } = req.body; // items: [{ id, position }, ...]
  const client = await pool.connect();

  try {
    const templateId = Number(template_id);
    if (!Number.isFinite(templateId)) {
      return res.status(400).json({ error: "template_id inválido" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items vacío" });
    }

    // normaliza types
    items = items.map(({ id, position }) => ({
      id: Number(id),
      position: Number(position),
    }));
    if (items.some((x) => !Number.isFinite(x.id) || !Number.isFinite(x.position))) {
      return res.status(400).json({ error: "items debe contener números" });
    }

    await client.query("BEGIN");

    if (items.length === 1) {
      const { id, position } = items[0];
      await client.query(`SELECT move_section($1,$2,$3)`, [templateId, id, position]);
    } else {
      // Cuando llegan varios objetivos, llámalos en orden de position asc.
      // move_section es idempotente y reacomoda 1..N en cada llamada,
      // así que hacerlos en orden produce el estado final deseado.
      const ordered = items.slice().sort((a, b) => a.position - b.position);
      for (const { id, position } of ordered) {
        await client.query(`SELECT move_section($1,$2,$3)`, [templateId, id, position]);
      }
    }

    await client.query("COMMIT");

    const { rows } = await client.query(
      `SELECT * FROM template_section
       WHERE template_id = $1
       ORDER BY position`,
      [templateId]
    );
    res.json(rows);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("sections/reorder failed:", e);
    res.status(500).json({ error: "reorder failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
});


module.exports = r;
