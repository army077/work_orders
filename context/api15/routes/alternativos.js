// routes/alternativos.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/:producto_id", async (req, res) => {
  try {
    const { producto_id } = req.params;
    const { rows } = await pool.query(
      `SELECT a.*, p2.sku AS sku_alternativo, p2.nombre AS nombre_alternativo
       FROM bom_catalogo.alternativos a
       JOIN bom_catalogo.productos p2 ON p2.id = a.producto_id_alternativo
       WHERE a.producto_id_principal = $1
       ORDER BY prioridad`,
      [producto_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo alternativos" });
  }
});

module.exports = router;
