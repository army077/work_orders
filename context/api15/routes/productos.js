// routes/productos.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        p.*, 
        u.clave AS unidad_clave,
        u.descripcion AS unidad_nombre
      FROM bom_catalogo.productos p
      LEFT JOIN bom_catalogo.unidades_medida u 
        ON u.id = p.unidad_medida_id
      ORDER BY p.nombre
    `);

    res.json(rows);
  } catch (err) {
    console.error("Error listando productos:", err);
    res.status(500).json({ error: "Error listando productos" });
  }
});

/*
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM bom_catalogo.productos WHERE id = $1`,
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error obteniendo producto" });
  }
});
*/

/* ====== OBTENER POR ID ====== */
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, u.clave AS unidad_clave, u.descripcion AS unidad_descripcion
      FROM bom_catalogo.productos p
      LEFT JOIN bom_catalogo.unidades_medida u ON p.unidad_medida_id = u.id
      WHERE p.id = $1
    `, [req.params.id]);
    if (rows.length === 0)
      return res.status(404).json({ error: "Producto no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Error al obtener producto:", err);
    res.status(500).json({ error: "Error al obtener producto" });
  }
});

// Lista solo productos tipo "maquina_final"
router.get("/tipo/maquinas", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, u.clave AS unidad
      FROM bom_catalogo.productos p
      LEFT JOIN bom_catalogo.unidades_medida u ON u.id = p.unidad_medida_id
      WHERE p.tipo = 'maquina_final'
      ORDER BY p.nombre;
    `);
    res.json(rows);
  } catch (err) {
    console.error("Error listando máquinas:", err);
    res.status(500).json({ error: "Error listando máquinas" });
  }
});

/*
router.post("/", async (req, res) => {
  try {
    const { sku, nombre, tipo, marca, modelo, unidad_medida_id } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO bom_catalogo.productos
      (sku, nombre, tipo, marca, modelo, unidad_medida_id)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [sku, nombre, tipo, marca, modelo, unidad_medida_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error creando producto" });
  }
});
*/

/* ====== CREAR ====== */
router.post("/", async (req, res) => {
  const { sku, nombre, tipo, marca, modelo, unidad_medida_id } = req.body;
  try {
    const { rows } = await pool.query(`
      INSERT INTO bom_catalogo.productos (sku, nombre, tipo, marca, modelo, unidad_medida_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (sku) DO NOTHING
      RETURNING *;
    `, [sku, nombre, tipo, marca, modelo, unidad_medida_id]);
    if (rows.length === 0)
      return res.json({ message: "El SKU ya existe (no insertado)" });
    res.json(rows[0]);
  } catch (err) {
    console.error("Error al crear producto:", err);
    res.status(500).json({ error: "Error al crear producto" });
  }
});

/*
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, marca, modelo, activo } = req.body;
    const { rows } = await pool.query(
      `UPDATE bom_catalogo.productos
       SET nombre=$1, marca=$2, modelo=$3, activo=$4, fecha_modificacion=NOW()
       WHERE id=$5 RETURNING *`,
      [nombre, marca, modelo, activo, id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Error actualizando producto" });
  }
});
*/

/* ====== ACTUALIZAR ====== */
router.put("/:id", async (req, res) => {
  const { sku, nombre, tipo, marca, modelo, unidad_medida_id, activo } = req.body;
  try {
    const { rowCount } = await pool.query(`
      UPDATE bom_catalogo.productos
      SET sku = $1, nombre = $2, tipo = $3, marca = $4, modelo = $5, unidad_medida_id = $6,
          activo = $7, fecha_modificacion = NOW()
      WHERE id = $8
    `, [sku, nombre, tipo, marca, modelo, unidad_medida_id, activo, req.params.id]);
    if (rowCount === 0)
      return res.status(404).json({ error: "Producto no encontrado" });
    res.json({ success: true });
  } catch (err) {
    console.error("Error al actualizar producto:", err);
    res.status(500).json({ error: "Error al actualizar producto" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(`DELETE FROM bom_catalogo.productos WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error eliminando producto" });
  }
});

module.exports = router;
