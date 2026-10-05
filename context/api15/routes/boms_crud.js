const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ===========================================================
   🧩 1. CREAR NUEVA VERSIÓN DE BOM
   =========================================================== */
router.post("/version", async (req, res) => {
  const { producto_padre_id, version, mes_modificacion, estado, creado_por } =
    req.body;

  try {
    const result = await pool.query(
      `INSERT INTO bom_catalogo.bom_version
        (producto_padre_id, version, mes_modificacion, estado, creado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [producto_padre_id, version, mes_modificacion, estado, creado_por]
    );

    res.json({
      success: true,
      message: "Versión de BOM creada correctamente",
      bom_version_id: result.rows[0].id,
    });
  } catch (err) {
    console.error("Error creando versión BOM:", err);
    res.status(500).json({ error: "Error creando versión de BOM" });
  }
});

/* ===========================================================
   🧩 2. AGREGAR PIEZAS A UNA VERSIÓN EXISTENTE
   =========================================================== */
router.post("/lineas", async (req, res) => {
  const { bom_version_id, producto_hijo_ids, notas } = req.body;

  if (!bom_version_id || !producto_hijo_ids?.length)
    return res
      .status(400)
      .json({ error: "Se requiere versión y lista de producto_hijo_ids" });

  try {
    const values = producto_hijo_ids.map(
      (id) => `(${bom_version_id}, ${id}, 1, 0, '${notas || "Componente"}')`
    );
    const query = `
      INSERT INTO bom_catalogo.bom_linea 
      (bom_version_id, producto_hijo_id, cantidad, scrap_factor, notas)
      VALUES ${values.join(", ")}
      RETURNING *;
    `;
    const result = await pool.query(query);
    res.json({
      success: true,
      message: "Componentes agregados al BOM",
      lineas_insertadas: result.rowCount,
    });
  } catch (err) {
    console.error("Error agregando líneas:", err);
    res.status(500).json({ error: "Error agregando componentes al BOM" });
  }
});

/* ===========================================================
   🧩 3. EDITAR UNA LÍNEA DE BOM
   =========================================================== */
router.put("/linea/:id", async (req, res) => {
  const { cantidad, scrap_factor, notas } = req.body;
  try {
    const result = await pool.query(
      `UPDATE bom_catalogo.bom_linea
       SET cantidad = $1, scrap_factor = $2, notas = $3
       WHERE id = $4 RETURNING *`,
      [cantidad, scrap_factor, notas, req.params.id]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Línea no encontrada" });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("Error editando línea:", err);
    res.status(500).json({ error: "Error editando línea del BOM" });
  }
});

/* ===========================================================
   🧩 4. VER LISTA DE VERSIONES DE UN PRODUCTO
   =========================================================== */
router.get("/versiones/:producto_padre_id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM bom_catalogo.bom_version
       WHERE producto_padre_id = $1
       ORDER BY fecha_creacion DESC`,
      [req.params.producto_padre_id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo versiones:", err);
    res.status(500).json({ error: "Error obteniendo versiones del producto" });
  }
});

/* ===========================================================
   🧩 5. VER DETALLE DE UNA VERSIÓN DE BOM
   =========================================================== */
router.get("/version/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT bl.*, p.sku, p.nombre, p.imagen_url
       FROM bom_catalogo.bom_linea bl
       JOIN bom_catalogo.productos p ON p.id = bl.producto_hijo_id
       WHERE bl.bom_version_id = $1
       ORDER BY bl.id`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo detalle BOM:", err);
    res.status(500).json({ error: "Error obteniendo detalle de BOM" });
  }
});

/* ===========================================================
   🧩 6. ELIMINAR UNA VERSIÓN DE BOM (y sus líneas)
   =========================================================== */
router.delete("/version/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM bom_catalogo.bom_linea WHERE bom_version_id = $1",
      [req.params.id]
    );
    await client.query(
      "DELETE FROM bom_catalogo.bom_version WHERE id = $1",
      [req.params.id]
    );
    await client.query("COMMIT");
    res.json({ success: true, message: "BOM eliminado correctamente" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error eliminando BOM:", err);
    res.status(500).json({ error: "Error eliminando BOM" });
  } finally {
    client.release();
  }
});

module.exports = router;
