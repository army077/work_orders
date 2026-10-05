// routes/bom.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// Obtener información general de una versión de BOM
router.get("/version-info/:id", async (req, res) => {
  const versionId = Number(req.params.id);
  if (!Number.isFinite(versionId)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    const query = `
      SELECT 
        bv.id,
        bv.version,
        bv.mes_modificacion,
        bv.estado,
        bv.creado_por,
        u.nombre_usuario AS creado_por_nombre,
        p.id AS producto_id,
        p.nombre AS producto_nombre,
        p.modelo AS producto_modelo,
        p.marca AS producto_marca
      FROM bom_catalogo.bom_version bv
      LEFT JOIN bom_catalogo.usuarios_roles u ON u.id_usuario = bv.creado_por
      LEFT JOIN bom_catalogo.productos p ON p.id = bv.producto_padre_id
      WHERE bv.id = $1
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [versionId]);
    if (rows.length === 0)
      return res.status(404).json({ error: "Versión de BOM no encontrada" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Error obteniendo versión BOM:", err);
    res.status(500).json({ error: "Error obteniendo datos del BOM" });
  }
});

// Lista de versiones por producto
router.get("/versiones/:producto_id", async (req, res) => {
  try {
    const { producto_id } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM bom_catalogo.bom_version 
       WHERE producto_padre_id = $1 ORDER BY version DESC`,
      [producto_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error listando versiones" });
  }
});

// Detalle de una versión
router.get("/version/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT bl.*, p.sku, p.nombre, p.marca, p.modelo 
       FROM bom_catalogo.bom_linea bl
       JOIN bom_catalogo.productos p ON p.id = bl.producto_hijo_id
       WHERE bl.bom_version_id = $1
       ORDER BY p.nombre`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo detalle de versión" });
  }
});

// Crear nueva versión
router.post("/version", async (req, res) => {
  try {
    const { producto_padre_id, version, mes_modificacion, estado, creado_por } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO bom_catalogo.bom_version
       (producto_padre_id, version, mes_modificacion, estado, creado_por)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [producto_padre_id, version, mes_modificacion, estado, creado_por]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error creando versión" });
  }
});

// Agregar línea a un BOM
router.post("/linea", async (req, res) => {
  try {
    const { bom_version_id, producto_hijo_id, cantidad, scrap_factor, notas } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO bom_catalogo.bom_linea
       (bom_version_id, producto_hijo_id, cantidad, scrap_factor, notas)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [bom_version_id, producto_hijo_id, cantidad, scrap_factor, notas]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error agregando línea" });
  }
});

module.exports = router;
