// routes/machineFamilies.js
const express = require("express");
const r = express.Router();
const pool = require("../db");

// LIST all
r.get("/", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name FROM machine_family ORDER BY name ASC`
  );
  res.json(rows);
});

// GET one
r.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(`SELECT id, name FROM machine_family WHERE id=$1`, [id]);
  if (!rows.length) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

// CREATE
r.post("/", async (req, res) => {
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO machine_family(name) VALUES ($1) RETURNING *`,
      [name.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "create failed", detail: String(e?.message || e) });
  }
});

// UPDATE
r.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  try {
    const { rows } = await pool.query(
      `UPDATE machine_family SET name=$1 WHERE id=$2 RETURNING *`,
      [name.trim(), id]
    );
    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "update failed", detail: String(e?.message || e) });
  }
});

// DELETE
r.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { rowCount } = await pool.query(`DELETE FROM machine_family WHERE id=$1`, [id]);
  if (!rowCount) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

module.exports = r;
