const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ====== LISTAR TODAS ====== */
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM bom_catalogo.unidades_medida ORDER BY id ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error al listar unidades:", err);
    res.status(500).json({ error: "Error al listar unidades" });
  }
});

/* ====== OBTENER POR ID ====== */
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM bom_catalogo.unidades_medida WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Unidad no encontrada" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Error al obtener unidad:", err);
    res.status(500).json({ error: "Error al obtener unidad" });
  }
});

/* ====== CREAR ====== */
router.post("/", async (req, res) => {
  const { clave, descripcion } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO bom_catalogo.unidades_medida (clave, descripcion)
       VALUES ($1, $2)
       ON CONFLICT (clave) DO NOTHING
       RETURNING *`,
      [clave, descripcion]
    );
    if (rows.length === 0)
      return res.json({ message: "La unidad ya existe (no insertada)" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Error al crear unidad:", err);
    res.status(500).json({ error: "Error al crear unidad" });
  }
});

/* ====== ACTUALIZAR ====== */
router.put("/:id", async (req, res) => {
  const { clave, descripcion } = req.body;
  try {
    const { rowCount } = await pool.query(
      `UPDATE bom_catalogo.unidades_medida
       SET clave = $1, descripcion = $2, fecha_modificacion = NOW()
       WHERE id = $3`,
      [clave, descripcion, req.params.id]
    );
    if (rowCount === 0)
      return res.status(404).json({ error: "Unidad no encontrada" });
    res.json({ success: true });
  } catch (err) {
    console.error("Error al actualizar unidad:", err);
    res.status(500).json({ error: "Error al actualizar unidad" });
  }
});

/* ====== ELIMINAR ====== */
router.delete("/:id", async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM bom_catalogo.unidades_medida WHERE id = $1`,
      [req.params.id]
    );
    if (rowCount === 0)
      return res.status(404).json({ error: "Unidad no encontrada" });
    res.json({ success: true });
  } catch (err) {
    console.error("Error al eliminar unidad:", err);
    res.status(500).json({ error: "Error al eliminar unidad" });
  }
});

module.exports = router;
