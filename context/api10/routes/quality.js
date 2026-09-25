const express = require("express");
const r = express.Router();
const pool = require("../db");

// post de tareas template
r.post("/template_task_inspection", async (req, res) => {
  try {
    const {
      section_id,
      revision_point,
      specs,
      suggestions,
      required,
      position,
      category
    } = req.body;

    if (!section_id || !revision_point) {
      return res.status(400).json({ error: "Faltan campos obligatorios (section_id, revision_point)" });
    }

    const query = `
      INSERT INTO template_task_inspection
        (section_id, revision_point, specs, suggestions, required, position, category)
      VALUES ($1, $2, $3, $4, COALESCE($5, TRUE), COALESCE($6, 1), COALESCE($7, 'Mecánica'))
      RETURNING *;
    `;

    const values = [
      section_id,
      revision_point,
      specs ?? "",
      suggestions ?? 0,
      required,
      position,
      category
    ];

    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error al crear tarea de inspección:", error);
    res.status(500).json({ error: "Error al crear la tarea de inspección" });
  }
});

// get de tareas de template
r.get('/template_task_inspection', async (req, res) => {
  const section_id = Number(req.query.section_id);
  const { rows } = await pool.query(
    `SELECT * FROM template_task_inspection WHERE section_id=$1 ORDER BY position`, [section_id]
  );
  res.json(rows);
});

//REORDENAR INTERACTIVAMENTE
r.patch("/reorder", async (req, res) => {
  let { section_id, items } = req.body; // items: [{ id, position }, ...]
  const client = await pool.connect();

  try {
    const sectionId = Number(section_id);
    if (!Number.isFinite(sectionId)) {
      return res.status(400).json({ error: "section_id inválido" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items vacío" });
    }

    items = items.map(({ id, position }) => ({
      id: Number(id),
      position: Number(position),
    }));
    if (items.some((x) => !Number.isFinite(x.id) || !Number.isFinite(x.position))) {
      return res.status(400).json({ error: "items debe contener números" });
    }

    await client.query("BEGIN");

    if (items.length === 1) {
      const { id, position } = items[0];
      await client.query(`SELECT move_task_inspection($1,$2,$3)`, [sectionId, id, position]);
    } else {
      // varios movimientos: aplicarlos en orden ascendente de posición objetivo
      const ordered = items.slice().sort((a, b) => a.position - b.position);
      for (const { id, position } of ordered) {
        await client.query(`SELECT move_task_inspection($1,$2,$3)`, [sectionId, id, position]);
      }
    }

    await client.query("COMMIT");

    const { rows } = await client.query(
      `SELECT * FROM template_task_inspection
       WHERE section_id = $1
       ORDER BY position`,
      [sectionId]
    );
    res.json(rows);
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("inspection_task/reorder failed:", e);
    res.status(500).json({ error: "reorder failed", detail: String(e?.message || e) });
  } finally {
    client.release();
  }
});

//UPDATE DE LOS DATOS
r.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

  const { revision_point, specs, suggestions, category } = req.body;

  try {
    const { rows } = await pool.query(
      `
      UPDATE template_task_inspection
      SET
        revision_point = COALESCE($1, revision_point),
        specs = COALESCE($2, specs),
        suggestions = COALESCE($3, suggestions),
        category = $4
      WHERE id = $5
      RETURNING *
      `,
      [
        revision_point ?? null,
        specs ?? null,
        suggestions ?? null,
        category,
        id,
      ]
    );

    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error("inspection tasks update failed:", e);
    res.status(500).json({ error: "inspection tasks update failed", detail: String(e?.message || e) });
  }
});

//BORRAS LAS TAREAS DE INSPECCION 
r.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { rowCount } = await pool.query(
    "DELETE FROM template_task_inspection WHERE id=$1",
    [id]
  );
  if (!rowCount) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

// CREAR inspection_order + inspection_order_task
r.post('/inspection/request', async (req, res) => {
  const {
    work_order_id,
    estacion,
    inspection_type,
    comments
  } = req.body;

  

  const nowMX = new Date().toLocaleString("sv-SE", {
    timeZone: "America/Mexico_City"
  });

  const client = await pool.connect();

  try {
    // ❗ 0) VALIDAR si ya existe una inspection_order pendiente

    const { rows: existingInspections } = await client.query(
      `SELECT *
       FROM inspection_order
       WHERE work_order_id = $1
         AND status IN ('PENDING', 'IN_PROGRESS')
         AND inspection_type = $2
       LIMIT 1`,
      [work_order_id, inspection_type]
    );

    if (existingInspections.length > 0) {
      console.log("⚠️ Ya existe una inspección pendiente para esta orden en esta sección:", existingInspections[0]);

      return res.status(409).json({
        error: "inspection_order already exists",
        inspection_order: existingInspections[0],
        message: "Esta orden y esta sección ya tienen una inspección activa."
      });
    }

    await client.query("BEGIN");

    // 1) work_order
    const { rows: woRows } = await client.query(
      `SELECT * FROM work_order WHERE id = $1`,
      [work_order_id]
    );

    if (!woRows.length) {
      console.log("❌ ERROR: No existe work_order con ese ID");
      return res.status(404).json({ error: "work_order not found" });
    }

    const wo = woRows[0];

    // 2) plantilla INSPECCION
    const { rows: tplRows } = await client.query(
      `SELECT * FROM maintenance_template WHERE model_id = $1 AND template_type = 'INSPECCION'`,
      [wo.model_id]
    );

    if (!tplRows.length) {
      return res.status(404).json({ error: "maintenance_template (INSPECCION) not found" });
    }

    const mainTemplate = tplRows[0];
    const inspectionTemplate = tplRows[0];

    // 3) Crear inspection_order
    const { rows: orderRows } = await client.query(
      `INSERT INTO inspection_order (
        inspection_template_id,
        model_id,
        work_order_id,
        estacion,
        status,
        created_at,
        inspection_type
      )
      VALUES ($1,$2,$3,$4,'PENDING',$5,$6)
      RETURNING *`,
      [
        inspectionTemplate.id,
        mainTemplate.model_id,
        work_order_id,
        estacion,
        nowMX,
        inspection_type
      ]
    );

    const inspectionOrder = orderRows[0];
    // 4) SECCIONES
    const { rows: sections } = await client.query(
      `SELECT * FROM template_section WHERE template_id = $1 ORDER BY position`,
      [inspectionTemplate.id]
    );

    let pos = 1;

    // 5) Insertar tareas
    for (const section of sections) {

        // Saltar secciones que no correspondan
      if (section.title !== inspection_type) continue;

      const { rows: tasks } = await client.query(
        `SELECT * FROM template_task_inspection WHERE section_id = $1 ORDER BY position`,
        [section.id]
      );

      for (const t of tasks) {
        await client.query(
          `INSERT INTO inspection_order_task (
            inspection_order_id,
            template_task_inspection_id,
            revision_point,
            specs,
            suggestions,
            position,
            status,
            section_title
          )
          VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7)`,
          [
            inspectionOrder.id,
            t.id,
            t.revision_point,
            t.specs,
            t.suggestions,
            pos++,
            section.title
          ]
        );
      }
    }

    await client.query("COMMIT");

    res.status(201).json({
      inspection_order: inspectionOrder,
      message: "Inspection order created successfully"
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.log("🔥 ERROR EN TRY/CATCH:", err.message);
    res.status(500).json({ error: "Failed to create inspection order" });
  } finally {
    client.release();
  }
});

// GET ─ obtener órdenes disponibles o asignadas al usuario
r.get('/inspection/orders', async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT
          io.*,
          mt.name AS titulo
        FROM inspection_order io
        LEFT JOIN maintenance_template mt
          ON io.inspection_template_id = mt.id
        WHERE
         (
           io.assigned_tech_email IS NULL
           OR TRIM(io.assigned_tech_email) = ''
           OR LOWER(TRIM(io.assigned_tech_email)) = LOWER(TRIM($1))
         )
          AND io.status IS DISTINCT FROM 'FINISHED'
        ORDER BY io.created_at ASC`,
      [email]
    );

    res.json(rows);

  } catch (err) {
    console.error("❌ Error fetching inspection orders:", err);
    res.status(500).json({ error: "Failed fetching inspection orders" });
  }
});

// GET de todas las ordenes de trabajo e inspección y tasks
r.get("/inspection/orders_all", async (req, res) => {
  try {
    const { include } = req.query;

    // 1) Obtener todas las inspection_orders con alias limpios
    const { rows: inspectionOrders } = await pool.query(
      `SELECT
          io.id AS inspection_order_id,
          io.inspection_template_id,
          io.model_id,
          io.assigned_tech_email,
          io.status,
          io.created_at,
          io.started_at,
          io.finished_at,
          io.work_order_id,
          io.estacion,
          io.evidencias,
          io.inspection_type,

          wo.id AS work_order_id_real,
          wo.template_id,
          wo.template_version,
          wo.machine_serial,
          wo.customer_name,
          wo.site_address,
          wo.scheduled_at,
          wo.diagnostic_result,
          wo.tech_support,
          wo.folio_sai,
          wo.initial_status,
          wo.comments,
          wo.extra_points,
          wo.assigned_tech_email AS operador_produccion,

          mm.name AS equipo,
          mt.name AS titulo

       FROM inspection_order io
       LEFT JOIN maintenance_template mt
          ON io.inspection_template_id = mt.id
       LEFT JOIN work_order wo 
          ON io.work_order_id = wo.id
       LEFT JOIN machine_model mm 
          ON io.model_id = mm.id
       ORDER BY io.created_at ASC`
    );

    // Si no pidieron tasks → retornar solo esto
    if (include !== "tasks" && include !== "all") {
      return res.json(inspectionOrders);
    }

    // 2) Adjuntar tasks correctamente usando el ID correcto
    for (const io of inspectionOrders) {
      const { rows: tasks } = await pool.query(
        `SELECT 
           iot.*,
           tti.category
         FROM inspection_order_task iot
         LEFT JOIN template_task_inspection tti 
           ON iot.template_task_inspection_id = tti.id
         WHERE iot.inspection_order_id = $1
         ORDER BY iot.position`,
        [io.inspection_order_id]  // <── ID correcto, alias limpio
      );

      io.tasks = tasks;
    }

    res.json(inspectionOrders);

  } catch (err) {
    console.error("❌ Error fetching inspection_orders_all:", err);
    res.status(500).json({ error: "Failed fetching inspection orders" });
  }
});

// PUT ─ autoasignarse una inspection order
// PUT ─ Autoasignarse una inspection order
r.put("/inspection/orders/:id/assign", async (req, res) => {
  const { id } = req.params;
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }

  try {
    const { rows: existing } = await pool.query(
      `SELECT assigned_tech_email
         FROM inspection_order
        WHERE id = $1`,
      [id]
    );

    if (!existing.length) {
      return res.status(404).json({ error: "inspection_order not found" });
    }

    // Si ya está asignada y es DE OTRO técnico
    if (
      existing[0].assigned_tech_email &&
      existing[0].assigned_tech_email !== email
    ) {
      return res.status(409).json({
        error: "already assigned",
        message: "Esta inspección ya fue tomada por otro técnico.",
      });
    }

    const { rows: updated } = await pool.query(
      `UPDATE inspection_order
         SET assigned_tech_email = $1,
         status = 'IN_PROGRESS'
       WHERE id = $2
       RETURNING *`,
      [email, id]
    );

    return res.json({
      message: "Inspection order assigned successfully",
      inspection_order: updated[0],
    });
  } catch (err) {
    console.error("❌ Error assigning inspection order:", err);
    return res.status(500).json({ error: "Failed to assign inspection order" });
  }
});

//asignar inspector manualmente 
// POST ─ asignar inspector manualmente desde panel web
r.post("/inspection/assign_inspector", async (req, res) => {
  const { id, assigned_tech_email } = req.body;

  if (!id || !assigned_tech_email) {
    return res.status(400).json({ error: "Missing id or email" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE inspection_order
         SET assigned_tech_email = $1
       WHERE id = $2
       RETURNING *`,
      [assigned_tech_email, id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "inspection order not found" });
    }

    return res.json({
      message: "Inspector asignado correctamente",
      inspection_order: rows[0],
    });
  } catch (err) {
    console.error("❌ Error assigning inspector:", err);
    return res.status(500).json({ error: "Server error assigning inspector" });
  }
});


r.get('/:id/inspection_tasks', async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    'SELECT iot.*, tti.category FROM inspection_order_task iot LEFT JOIN template_task_inspection tti ON iot.template_task_inspection_id = tti.id WHERE iot.inspection_order_id=$1 ORDER BY position', [id]
  );
  res.json(rows);
});

r.get('/inspectors', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * 
       FROM plantilla_tecnicos 
       WHERE puesto = 'Operador de producción' 
       OR puesto = 'Supervisor de calidad'`
    );

    res.json(rows);

  } catch (err) {
    console.error("❌ Error fetching inspectors:", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message
    });
  }
});

// GET una inspección por ID
r.get('/inspection/orders/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query(
      `
      SELECT 
        io.*,
        wo.*,
        mm.name AS model_name,
        wo.assigned_tech_email AS operador_produccion
      FROM PUBLIC.inspection_order io
      LEFT JOIN PUBLIC.work_order wo 
        ON io.work_order_id = wo.id
      LEFT JOIN PUBLIC.machine_model mm 
        ON io.model_id = mm.id
      WHERE io.id = $1
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: "Inspection order not found",
        id
      });
    }

    res.json(rows[0]);

  } catch (err) {
    console.error("❌ Error fetching inspection order:", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message
    });
  }
});

// POST DE DESVIACIONES
r.post('/desviaciones', async (req, res) => {
  const {
    id_actividad,
    correo,
    usuario,
    serial_number,
    afected_machine,
    num_revision,
    nombre_tecnico,
    parte_afectada,
    causa_raiz,
    clasificacion_defecto,
    tipo_defectivo,
    clasificacion_defectivo,
    comentarios,
    evidencias
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO desviaciones_calidad (
        id_actividad,
        correo,
        usuario,
        created_at,
        serial_number,
        afected_machine,
        num_revision,
        nombre_tecnico,
        parte_afectada,
        causa_raiz,
        clasificacion_defecto,
        tipo_defectivo,
        clasificacion_defectivo,
        comentarios,
        evidencias
      ) VALUES (
        $1,$2,$3, NOW(), $4,$5,$6,$7,$8,$9,$10,$11,$12,$13, $14
      ) RETURNING *`,
      [
        id_actividad,
        correo,
        usuario,
        serial_number,
        afected_machine,
        num_revision,
        nombre_tecnico,
        parte_afectada,
        causa_raiz,
        clasificacion_defecto,
        tipo_defectivo,
        clasificacion_defectivo,
        comentarios,
        JSON.stringify(evidencias)
      ]
    );

    res.json({
      success: true,
      message: "Desviación registrada correctamente.",
      data: result.rows[0]
    });

  } catch (err) {
    console.error("❌ Error al guardar desviación:", err);
    res.status(500).json({ error: "Error al guardar la desviación" });
  }
});
// GET DESVIACIONES POR PUNTO DE REVISIÓN
// GET /api10/calidad/desviaciones/:idActividad
r.get('/desviaciones/:idActividad', async (req, res) => {
  const { idActividad } = req.params;

  try {
    const result = await pool.query(
      `SELECT *
       FROM desviaciones_calidad
       WHERE id_actividad = $1
       ORDER BY created_at DESC`,
      [idActividad]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("❌ Error al obtener desviaciones:", err);
    res.status(500).json({ error: "Error al consultar desviaciones" });
  }
});

// GET TODAS LAS DESVIACIONES
r.get('/desviaciones/', async (req, res) => {

  try {
    const result = await pool.query(
      `SELECT dc.*, io.work_order_id FROM PUBLIC.desviaciones_calidad dc
       LEFT JOIN inspection_order_task iot ON dc.id_actividad = iot.id
       LEFT JOIN inspection_order io ON iot.inspection_order_id = io.id
       ORDER BY created_at ASC`
       );

    res.json(result.rows);

  } catch (err) {
    console.error("❌ Error al obtener desviaciones:", err);
    res.status(500).json({ error: "Error al consultar desviaciones" });
  }
});



// PUT DE AVANCE PRODUCCIÓN
r.put("/:id/stavance", async (req, res) => {
  const id = Number(req.params.id);
  const { status, started_at, finished_at, actual_minutes } = req.body;

  if (!id || !status) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE inspection_order_task
       SET status = $1,
           started_at = COALESCE($2, started_at),
           finished_at = COALESCE($3, finished_at),
           actual_minutes = COALESCE($4, actual_minutes)
       WHERE id = $5
       RETURNING *`,
      [status, started_at, finished_at, actual_minutes, id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Tarea no encontrada" });
    }

    res.json({ message: "Tarea actualizada", task: rows[0] });
  } catch (err) {
    console.error("❌ Error actualizando tarea:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

r.put("/liberar_orden/:id", async (req, res) => {
  const work_order_id = Number(req.params.id);

  // Extraemos correctamente el body
  const { section_title, started_at, finished_at, actual_minutes } = req.body;

  if (!work_order_id || !section_title) {
    return res.status(400).json({ error: "Falta la sección o el ID" });
  }

  // Según la sección, elegimos el código correcto
  let codigoLiberacion = null;

  if (section_title === "Inspección de ensamble") {
    codigoLiberacion = "LIB001";
  } else if (section_title === "Inspección de pintura") {
    codigoLiberacion = "LIB002"; // ejemplo, cámbialo al que necesites
  } else {
    return res.status(400).json({ error: "Sección no válida" });
  }

  try {
    const { rows } = await pool.query(
      `
      UPDATE work_order_task
      SET 
        status = 'DONE',
        started_at = COALESCE($1, started_at),
        finished_at = COALESCE($2, finished_at),
        actual_minutes = COALESCE($3, actual_minutes)
      WHERE work_order_id = $4 
        AND code = $5
      RETURNING *;
      `,
      [started_at, finished_at, actual_minutes, work_order_id, codigoLiberacion]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Tarea no encontrada" });
    }

    res.json({
      message: "Tarea liberada correctamente",
      task: rows[0],
    });
  } catch (err) {
    console.error("❌ Error actualizando tarea:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

r.put("/:id/restart_stavance", async (req, res) => {
  const inspectionOrderId = Number(req.params.id);
  const { work_order_id } = req.body; // <-- viene del frontend

  if (!inspectionOrderId) {
    return res.status(400).json({ error: "Falta inspection_order_id" });
  }

  if (!work_order_id) {
    return res.status(400).json({ error: "Falta work_order_id en el body" });
  }

  try {
    // 1️⃣ Reiniciar tareas de inspección
    await pool.query(
      `UPDATE inspection_order_task
       SET status = 'PENDING',
           started_at = NULL,
           finished_at = NULL,
           actual_minutes = 0
       WHERE inspection_order_id = $1`,
      [inspectionOrderId]
    );

    // 2️⃣ Reiniciar tareas de producción LIB001 y LIB002
    await pool.query(
      `UPDATE work_order_task
       SET status = 'PENDING',
           started_at = NULL,
           finished_at = NULL,
           actual_minutes = 0
       WHERE work_order_id = $1
         AND code IN ('LIB001', 'LIB002')`,
      [work_order_id]
    );

    res.json({ 
      message: "Actividades de inspección y producción reiniciadas correctamente" 
    });

  } catch (err) {
    console.error("❌ Error reseteando tareas:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

r.put("/:id/insp_end", async (req, res) => {
  const id = Number(req.params.id);
  const {started_at} = req.body;
  if (!id) {
    return res.status(400).json({ error: "Falta ID" });
  }

  const nowMX = new Date().toLocaleString("sv-SE", { timeZone: "America/Mexico_City" });
  try {
    const { rows } = await pool.query(
      `UPDATE inspection_order
       SET status = 'FINISHED',
       started_at = $3,
       finished_at = $2
       WHERE id=$1
       RETURNING *`,
      [id, nowMX, started_at]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    res.json({ message: "Orden finalizada exitosamente!", task: rows[0] });
  } catch (err) {
    console.error("❌ Error actualizando tareas:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});
// CANCELA LA ORDEN DE INSPECCION
r.put("/:id/insp_cancel", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "Falta ID" });
  }
  const nowMX = new Date().toLocaleString("sv-SE", { timeZone: "America/Mexico_City" });
  try {
    const { rows } = await pool.query(
      `UPDATE inspection_order
       SET status = 'CANCELED',
       finished_at = $2
       WHERE id=$1
       RETURNING *`,
      [id, nowMX]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    res.json({ message: "Orden cancelada exitosamente!", task: rows[0] });
  } catch (err) {
    console.error("❌ Error actualizando tareas:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});
// AGREGA FOTOS A LA INSPECTION ORDER
r.put("/inspection/orders/:id/add_evidence", async (req, res) => {
  const { id } = req.params;
  const { nuevas_fotos } = req.body; // array de strings (URLs)

  if (!Array.isArray(nuevas_fotos)) {
    return res.status(400).json({ error: "nuevas_fotos debe ser un arreglo" });
  }

  try {
    const query = `
      UPDATE inspection_order
      SET evidencias = 
          COALESCE(evidencias, '[]'::jsonb) || to_jsonb($1::text[])
      WHERE id = $2
      RETURNING id, evidencias;
    `;

    const result = await pool.query(query, [nuevas_fotos, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    res.json({
      message: "Evidencias agregadas correctamente",
      evidencias: result.rows[0].evidencias,
    });

  } catch (err) {
    console.error("❌ Error agregando evidencias:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});


module.exports = r;
