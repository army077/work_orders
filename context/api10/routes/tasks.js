const express = require("express");
const r = express.Router();
const pool = require("../db");

r.get('/', async (req, res) => {
  const section_id = Number(req.query.section_id);
  const { rows } = await pool.query(
    `SELECT * FROM template_task WHERE section_id=$1 ORDER BY position`, [section_id]
  );
  res.json(rows);
});

// DELETE TASK

// DELETE
r.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { rowCount } = await pool.query(
    "DELETE FROM template_task WHERE id=$1",
    [id]
  );
  if (!rowCount) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

r.post('/', async (req, res) => {
  const { section_id, title, code, expected_minutes, position, category } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO template_task(section_id,title,code,expected_minutes,position,category)
     VALUES ($1,$2,$3,$4,$5, $6) RETURNING *`,
    [section_id, title, code, expected_minutes ?? 0, position, category]
  );
  res.status(201).json(rows[0]);
});

// PUT /tasks/:id  → actualizar título / código / minutos esperados
r.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

  const { title, code, expected_minutes, category } = req.body;

  try {
    const { rows } = await pool.query(
      `
      UPDATE template_task
      SET
        title = COALESCE($1, title),
        code = COALESCE($2, code),
        expected_minutes = COALESCE($3, expected_minutes),
        category = $4
      WHERE id = $5
      RETURNING *
      `,
      [
        title ?? null,
        code ?? null,
        (expected_minutes ?? expected_minutes === 0) ? Number(expected_minutes) : null,
	category,
        id,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error("tasks update failed:", e);
    res.status(500).json({ error: "update failed", detail: String(e?.message || e) });
  }
});

r.patch("/reorder", async (req, res) => {
  let { section_id, items } = req.body; // items: [{ id, position }, ...]
  const client = await pool.connect();

  try {
    const sectionId = Number(section_id);
    if (!Number.isFinite(sectionId)) {
      return res.status(400).json({ error: "section_id inválido" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items vacío" });
    }

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
      await client.query(`SELECT move_task($1,$2,$3)`, [sectionId, id, position]);
    } else {
      // varios movimientos: aplicarlos en orden ascendente de posición objetivo
      const ordered = items.slice().sort((a, b) => a.position - b.position);
      for (const { id, position } of ordered) {
        await client.query(`SELECT move_task($1,$2,$3)`, [sectionId, id, position]);
      }
    }

    await client.query("COMMIT");

    const { rows } = await client.query(
      `SELECT * FROM template_task
       WHERE section_id = $1
       ORDER BY position`,
      [sectionId]
    );
    res.json(rows);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("tasks/reorder failed:", e);
    res.status(500).json({ error: "reorder failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
});

module.exports = r;
