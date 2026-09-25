const express = require("express");
const r = express.Router();
const pool = require("../db");

/* 
 Tabla: work_order_customs
 Campos: id (serial PK), work_order_id (int FK), custom_title (varchar)
*/

/* ========== CREATE ========== */
r.post("/custom_wo", async (req, res) => {
  try {
    const { work_order_id, custom_title, custom_value } = req.body;
    if (!work_order_id || !custom_title) {
      return res.status(400).json({ error: "work_order_id y custom_title son requeridos" });
    }

    const { rows } = await pool.query(
      `INSERT INTO work_order_customs (work_order_id, custom_title, custom_value)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [work_order_id, custom_title, custom_value]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Error en POST /customs:", err);
    res.status(500).json({ error: "Error creando customización" });
  }
});

/* ========== READ (ALL) ========== */
r.get("/custom_wo", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM work_order_customs ORDER BY id DESC");
    res.json(rows);
  } catch (err) {
    console.error("Error en GET /customs:", err);
    res.status(500).json({ error: "Error obteniendo customizaciones" });
  }
});

/* ========== READ (ONE) ========== */
r.get("/custom_wo/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query("SELECT * FROM work_order_customs WHERE id = $1", [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Customización no encontrada" });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error("Error en GET /customs/:id:", err);
    res.status(500).json({ error: "Error obteniendo customización" });
  }
});

/* ========== READ by work_order_id ========== */
r.get("/workorder/:work_order_id", async (req, res) => {
  try {
    const { work_order_id } = req.params;
    const { rows } = await pool.query(
      "SELECT * FROM work_order_customs WHERE work_order_id = $1 ORDER BY id DESC",
      [work_order_id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error en GET /customs/workorder/:work_order_id:", err);
    res.status(500).json({ error: "Error obteniendo customizaciones por work_order_id" });
  }
});

/* ========== UPDATE ========== */
r.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { work_order_id, custom_title } = req.body;

    const { rows } = await pool.query(
      `UPDATE work_order_customs
       SET work_order_id = $1, custom_title = $2
       WHERE id = $3
       RETURNING *`,
      [work_order_id, custom_title, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Customización no encontrada" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error en PUT /customs/:id:", err);
    res.status(500).json({ error: "Error actualizando customización" });
  }
});

/* ========== DELETE ========== */
r.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { rowCount } = await pool.query("DELETE FROM work_order_customs WHERE id = $1", [id]);

    if (rowCount === 0) {
      return res.status(404).json({ error: "Customización no encontrada" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error en DELETE /customs/:id:", err);
    res.status(500).json({ error: "Error eliminando customización" });
  }
});

/* =========================================================
   📦 GET /api10/prod-delayments
   Trae todos los retrasos o filtra por id_actividad
   ========================================================= */
r.get("/retrasos", async (req, res) => {
  const { id_actividad } = req.query;

  try {
    let query = "SELECT * FROM prod_delayments ORDER BY id DESC";
    let params = [];

    if (id_actividad) {
      query = "SELECT * FROM prod_delayments WHERE id_actividad = $1 ORDER BY id DESC";
      params = [id_actividad];
    }

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("❌ Error al obtener los retrasos:", err);
    res.status(500).json({ error: "Error al obtener los retrasos" });
  }
});

/* =========================================================
   ➕ POST /api10/prod-delayments
   Crea un nuevo registro de retraso
   ========================================================= */
r.post("/retrasos", async (req, res) => {
  const { id_actividad, categoria_retraso, tiempo_retraso, comments } = req.body;

  // Validaciones básicas
  if (!id_actividad || !categoria_retraso || tiempo_retraso == null) {
    return res.status(400).json({
      error: "Faltan campos obligatorios: id_actividad, categoria_retraso o tiempo_retraso",
    });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO prod_delayments 
       (id_actividad, categoria_retraso, tiempo_retraso, comments) 
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id_actividad, categoria_retraso, tiempo_retraso, comments || null]
    );

    res.status(201).json({
      message: "Retraso registrado correctamente",
      delayment: rows[0],
    });
  } catch (err) {
    console.error("❌ Error al insertar retraso:", err);
    res.status(500).json({ error: "Error al registrar el retraso" });
  }
});

/* ============================
   📘 GET: Todos los registros
============================ */
r.get("/template_custom", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM machine_customs ORDER BY id ASC"
    );
    res.json(rows);
  } catch (err) {
    console.error("❌ Error al obtener machine_customs:", err.message);
    res.status(500).json({ error: "Error al obtener machine_customs" });
  }
});

/* ============================
   📘 GET: Uno por ID
============================ */
r.get("/:id/template_custom", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id))
    return res.status(400).json({ error: "ID inválido" });

  try {
    const { rows } = await pool.query(
      "SELECT * FROM machine_customs WHERE id = $1",
      [id]
    );
    if (rows.length === 0)
      return res.status(404).json({ error: "Registro no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error al obtener machine_customs por ID:", err.message);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

/* ============================
   🟢 POST: Crear registro
============================ */
r.post("/template_custom", async (req, res) => {
  const { custom_title, custom_value } = req.body;

  if (!custom_title || custom_value == null)
    return res
      .status(400)
      .json({ error: "custom_title y custom_value son requeridos" });

  try {
    const { rows } = await pool.query(
      `INSERT INTO machine_customs (custom_title, custom_value)
       VALUES ($1, $2)
       RETURNING *`,
      [custom_title, custom_value]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("❌ Error al crear machine_custom:", err.message);
    res.status(500).json({ error: "Error al crear machine_custom" });
  }
});

/* ============================
   🟡 PUT: Actualizar por ID
============================ */
r.put("/:id/template_custom", async (req, res) => {
  const id = Number(req.params.id);
  const { custom_title, custom_value } = req.body;

  if (!Number.isFinite(id))
    return res.status(400).json({ error: "ID inválido" });

  try {
    const { rows } = await pool.query(
      `UPDATE machine_customs
       SET custom_title = COALESCE($1, custom_title),
           custom_value = COALESCE($2, custom_value)
       WHERE id = $3
       RETURNING *`,
      [custom_title, custom_value, id]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Registro no encontrado" });

    res.json(rows[0]);
  } catch (err) {
    console.error("❌ Error al actualizar machine_custom:", err.message);
    res.status(500).json({ error: "Error al actualizar machine_custom" });
  }
});

/* ============================
   🔴 DELETE: Eliminar por ID
============================ */
r.delete("/:id/template_custom", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isFinite(id))
    return res.status(400).json({ error: "ID inválido" });

  try {
    const { rowCount } = await pool.query(
      "DELETE FROM machine_customs WHERE id = $1",
      [id]
    );
    if (rowCount === 0)
      return res.status(404).json({ error: "Registro no encontrado" });

    res.json({ message: "Registro eliminado correctamente" });
  } catch (err) {
    console.error("❌ Error al eliminar machine_custom:", err.message);
    res.status(500).json({ error: "Error al eliminar machine_custom" });
  }
});

module.exports = r;

