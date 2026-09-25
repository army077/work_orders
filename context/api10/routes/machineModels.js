	// routes/machineModels.js
const express = require("express");
const r = express.Router();
const pool = require("../db");

// LIST (opcional: ?family_id=)
r.get("/", async (req, res) => {
  const familyId = req.query.family_id ? Number(req.query.family_id) : null;
  const params = [];
  let where = "";
  if (Number.isFinite(familyId)) { where = "WHERE m.family_id=$1"; params.push(familyId); }

  const { rows } = await pool.query(
    `
    SELECT m.id, m.name, m.manufacturer, m.family_id, m.bond_value, f.name AS family_name, m.standard_days
    FROM machine_model m
    LEFT JOIN machine_family f ON f.id = m.family_id
    ${where}
    ORDER BY m.name ASC
    `,
    params
  );
  res.json(rows);
});

// GET one
r.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `
    SELECT m.id, m.name, m.manufacturer, m.family_id, f.name, m.standard_days AS family_name
    FROM machine_model m
    LEFT JOIN machine_family f ON f.id = m.family_id
    WHERE m.id=$1
    `,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

// CREATE
r.post("/", async (req, res) => {
  const { name, family_id, manufacturer, bond_value, standard_days } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const famId = family_id === null || family_id === undefined ? null : Number(family_id);
  try {
    const { rows } = await pool.query(
      `
      INSERT INTO machine_model (name, family_id, manufacturer, bond_value, standard_days)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
      `,
      [name.trim(), famId, manufacturer ?? null, bond_value, standard_days ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (String(e?.message).includes("unique")) {
      return res.status(409).json({ error: "duplicate", detail: "name must be unique per family_id" });
    }
    res.status(500).json({ error: "create failed", detail: String(e?.message || e) });
  }
});

// UPDATE
r.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, family_id, manufacturer, bond_value } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const famId = family_id === null || family_id === undefined ? null : Number(family_id);

  try {
    const { rows } = await pool.query(
      `
      UPDATE machine_model
      SET name=$1, family_id=$2, manufacturer=$3, bond_value=$4, standard_days=$5
      WHERE id=$6 RETURNING *
      `,
      [name.trim(), famId, manufacturer ?? null,bond_value ,standard_days, id]
    );
    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (e) {
    if (String(e?.message).includes("unique")) {
      return res.status(409).json({ error: "duplicate", detail: "name must be unique per family_id" });
    }
    res.status(500).json({ error: "update failed", detail: String(e?.message || e) });
  }
});

// DELETE
r.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { rowCount } = await pool.query(`DELETE FROM machine_model WHERE id=$1`, [id]);
  if (!rowCount) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

module.exports = r;
