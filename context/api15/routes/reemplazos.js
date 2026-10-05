// routes/reemplazos.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/:producto_id", async (req, res) => {
  try {
    const { producto_id } = req.params;
    const { rows } = await pool.query(
      `SELECT r.*, p2.sku AS sku_nuevo, p2.nombre AS nombre_nuevo
       FROM bom_catalogo.reemplazos r
       JOIN bom_catalogo.productos p2 ON p2.id = r.producto_id_nuevo
       WHERE r.producto_id_antiguo = $1`,
      [producto_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo reemplazos" });
  }
});

module.exports = router;
