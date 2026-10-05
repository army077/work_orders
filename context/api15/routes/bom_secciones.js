const express = require("express");
const router = express.Router();
const pool = require("../db");

/* =========================
   GET - Lista de secciones por versión
========================= */
router.get("/:versionId", async (req, res) => {
  const versionId = Number(req.params.versionId);
  if (!Number.isFinite(versionId))
    return res.status(400).json({ error: "ID inválido" });

  try {
    const { rows } = await pool.query(
      `SELECT 
         id, 
         bom_version_id, 
         nombre, 
         descripcion, 
         orden, 
         fecha_creacion
       FROM bom_catalogo.bom_seccion
       WHERE bom_version_id = $1
       ORDER BY orden ASC, id ASC;`,
      [versionId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error al obtener secciones del BOM:", err);
    res.status(500).json({ error: "Error interno al consultar las secciones." });
  }
});

/* ====== CREAR SECCIÓN ====== */
/*
router.post("/", async (req, res) => {
  const { bom_version_id, nombre, descripcion, orden } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO bom_catalogo.bom_seccion (bom_version_id, nombre, descripcion, orden)
       VALUES ($1, $2, $3, COALESCE($4, 0)) RETURNING *`,
      [bom_version_id, nombre, descripcion, orden]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("Error creando sección:", err);
    res.status(500).json({ error: "Error al crear sección" });
  }
});
*/

/* ====== CREAR SECCIÓN ====== */
router.post("/", async (req, res) => {
  const { bom_version_id, nombre, descripcion } = req.body;

  try {
    // Obtener el siguiente número de orden dentro de esa versión
    const { rows: maxRows } = await pool.query(
      `SELECT COALESCE(MAX(orden), -1) + 1 AS siguiente_orden
       FROM bom_catalogo.bom_seccion
       WHERE bom_version_id = $1`,
      [bom_version_id]
    );

    const siguienteOrden = maxRows[0]?.siguiente_orden || 0;

    // Insertar con el orden correcto
    const { rows } = await pool.query(
      `INSERT INTO bom_catalogo.bom_seccion (bom_version_id, nombre, descripcion, orden)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [bom_version_id, nombre, descripcion || null, siguienteOrden]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Error creando sección:", err);
    res.status(500).json({ error: "Error al crear sección" });
  }
});

/* ====== LEER TODAS ====== */
router.get("/:bom_version_id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM bom_catalogo.bom_seccion
       WHERE bom_version_id = $1
       ORDER BY orden, id`,
      [req.params.bom_version_id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo secciones:", err);
    res.status(500).json({ error: "Error al obtener secciones" });
  }
});

/* ====== EDITAR ====== */
router.put("/:id", async (req, res) => {
  const { nombre, descripcion, orden } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE bom_catalogo.bom_seccion
       SET nombre = $1, descripcion = $2, orden = COALESCE($3, orden)
       WHERE id = $4 RETURNING *`,
      [nombre, descripcion, orden, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error("Error editando sección:", err);
    res.status(500).json({ error: "Error al editar sección" });
  }
});

/* ====== ELIMINAR ====== */
router.delete("/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE bom_catalogo.bom_linea SET seccion_id = NULL WHERE seccion_id = $1`,
      [req.params.id]
    );
    await client.query(
      `DELETE FROM bom_catalogo.bom_seccion WHERE id = $1`,
      [req.params.id]
    );
    await client.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error eliminando sección:", err);
    res.status(500).json({ error: "Error al eliminar sección" });
  } finally {
    client.release();
  }
});

/* ====== ASIGNAR PIEZAS A SECCIÓN ====== */
/*
router.put("/:id/asignar-lineas", async (req, res) => {
  const { lineas_ids } = req.body;
  if (!Array.isArray(lineas_ids) || lineas_ids.length === 0)
    return res.status(400).json({ error: "Lista vacía" });

  try {
    await pool.query(
      `UPDATE bom_catalogo.bom_linea
       SET seccion_id = $1
       WHERE id = ANY($2::int[])`,
      [req.params.id, lineas_ids]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Error asignando líneas:", err);
    res.status(500).json({ error: "Error al asignar líneas a sección" });
  }
});
*/

/* ====== ASIGNAR PIEZAS A SECCIÓN ====== */
router.put("/:id/asignar-lineas", async (req, res) => {
  const { lineas_ids } = req.body;
  const seccionId = req.params.id;

  if (!Array.isArray(lineas_ids) || lineas_ids.length === 0)
    return res.status(400).json({ error: "Lista vacía" });

  try {
    // 1️⃣ Obtener el nombre de la sección
    const { rows } = await pool.query(
      `SELECT nombre FROM bom_catalogo.bom_seccion WHERE id = $1`,
      [seccionId]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Sección no encontrada" });

    const seccionNombre = rows[0].nombre;

    // 2️⃣ Actualizar seccion_id y seccion (nombre)
    await pool.query(
      `UPDATE bom_catalogo.bom_linea
       SET seccion_id = $1, seccion = $2
       WHERE id = ANY($3::int[])`,
      [seccionId, seccionNombre, lineas_ids]
    );

    res.json({ success: true, seccion_id: seccionId, seccion: seccionNombre });
  } catch (err) {
    console.error("Error asignando líneas:", err);
    res.status(500).json({ error: "Error al asignar líneas a sección" });
  }
});

module.exports = router;
