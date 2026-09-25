const express = require("express");
const r = express.Router();
const pool = require("../db");

// GET /work-orders
// Lista todas las órdenes de trabajo (con filtros opcionales)
r.get('/', async (req, res) => {
  try {
    const { include } = req.query; // "tasks", "totals", "all"
    const { status, cliente } = req.query; // ejemplo de filtros opcionales

    // 1) Cabeceras
    let query = `SELECT * FROM work_order WHERE 1=1`;
    const params = [];
    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    if (cliente) {
      params.push(cliente);
      query += ` AND cliente = $${params.length}`;
    }
    query += ` ORDER BY created_at DESC`;

    const { rows: workOrders } = await pool.query(query, params);

    // 2) Si pidieron include=tasks o all → adjuntar checklist
    if (include === 'tasks' || include === 'all') {
      for (const wo of workOrders) {
        const { rows: tasks } = await pool.query(
          `SELECT *
             FROM work_order_task
            WHERE work_order_id = $1
            ORDER BY position`,
          [wo.id]
        );
        wo.tasks = tasks;
      }
    }

    // 3) Si pidieron include=totals o all → adjuntar totales
    if (include === 'totals' || include === 'all') {
      for (const wo of workOrders) {
        const { rows: bySection } = await pool.query(
          `SELECT
             section_title,
             SUM(expected_minutes) AS expected_minutes,
             SUM(COALESCE(actual_minutes,0)) AS actual_minutes
           FROM work_order_task
           WHERE work_order_id = $1
           GROUP BY section_title
           ORDER BY MIN(position)`,
          [wo.id]
        );
        const { rows: overallRows } = await pool.query(
          `SELECT
             SUM(expected_minutes) AS expected_minutes,
             SUM(COALESCE(actual_minutes,0)) AS actual_minutes
           FROM work_order_task
           WHERE work_order_id = $1`,
          [wo.id]
        );
        wo.totals = {
          bySection,
          overall: overallRows[0] || { expected_minutes: 0, actual_minutes: 0 },
        };
      }
    }

    res.json(workOrders);
  } catch (e) {
    console.error('GET /work-orders failed:', e);
    res.status(500).json({ error: 'failed to fetch work orders' });
  }
});

// 1) Crear work order materializando la plantilla (snapshot)
// 1) Crear work order materializando la plantilla (snapshot)
r.post('/from-template', async (req, res) => {
  const {
    id_reserva,
    template_id,
    machine_serial,
    customer_name,
    site_address,
    assigned_tech_email,
    scheduled_at,
    tech_support,
    folio_sai,
    initial_status, // <- nombre correcto de la columna
    comments,
  } = req.body;


  const nowMX = new Date().toLocaleString("sv-SE", { timeZone: "America/Mexico_City" });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: trows } = await client.query(
      'SELECT * FROM maintenance_template WHERE id = $1',
      [template_id]
    );
    if (!trows.length) return res.status(404).json({ error: 'template not found' });
    const tpl = trows[0];

    // CORRECCIÓN: 12 columnas -> 12 placeholders ($1..$12) y 12 valores en el array
    const { rows: wrows } = await client.query(
      `INSERT INTO work_order (
         template_id,
         template_version,
         model_id,
         machine_serial,
         customer_name,
         site_address,
         assigned_tech_email,
         scheduled_at,
         tech_support,
         folio_sai,
         initial_status,
         comments,
         id_reserva, 
	 created_at 
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, $13, $14)
       RETURNING *`,
      [
        tpl.id,
        tpl.version,
        tpl.model_id,
        machine_serial,
        customer_name,
        site_address,
        assigned_tech_email,
        scheduled_at,
        tech_support,
        folio_sai,
        initial_status,
        comments,
        id_reserva,
	nowMX,
      ]
    );
    const wo = wrows[0];

    // Materializar secciones y tareas
    const { rows: sections } = await client.query(
      'SELECT * FROM template_section WHERE template_id = $1 ORDER BY position',
      [template_id]
    );

    let pos = 1;
    for (const s of sections) {
      const { rows: tasks } = await client.query(
        'SELECT * FROM template_task WHERE section_id = $1 ORDER BY position',
        [s.id]
      );
      for (const t of tasks) {
        await client.query(
          `INSERT INTO work_order_task (
             work_order_id,
             section_title,
             task_title,
             code,
             expected_minutes,
             position,
	     category
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [wo.id, s.title, t.title, t.code, t.expected_minutes, pos++, t.category]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(wo);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error creando la WO:", e.message, e.stack);
    res.status(500).json({ error: 'create from template failed :(' });
  } finally {
    client.release();
  }
});
// eliminar una orden de trabajo
r.delete("/delete/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    const { rowCount } = await pool.query(
      "DELETE FROM work_order WHERE id = $1",
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: "Orden de trabajo no encontrada" });
    }

    res.json({ success: true, message: `Orden de trabajo #${id} eliminada` });
  } catch (e) {
    console.error("DELETE /work_orders/delete/:id error:", e);
    res.status(500).json({ error: "Error interno al eliminar la orden" });
  }
});

// GET /work-orders/:id
// Devuelve la orden; si pasas ?include=tasks o ?include=all también regresa el checklist.
// Si pasas ?include=totals o ?include=all, devuelve totales por sección y globales.
r.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const include = String(req.query.include || '').toLowerCase();

  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  try {
    // 1) Cabecera de la orden
    const { rows: woRows } = await pool.query(
      `SELECT *
       FROM work_order
       WHERE id = $1`,
      [id]
    );
    if (woRows.length === 0) {
      return res.status(404).json({ error: 'not found' });
    }
    const wo = woRows[0];

    const payload = { ...wo };

    // 2) Checklist (opcional)
    if (include === 'tasks' || include === 'all') {
      const { rows: tasks } = await pool.query(
        `SELECT *
         FROM work_order_task
         WHERE work_order_id = $1
         ORDER BY position`,
        [id]
      );
      payload.tasks = tasks;
    }

    // 3) Totales (opcional)
    if (include === 'totals' || include === 'all') {
      const { rows: bySection } = await pool.query(
        `SELECT
           section_title,
           SUM(expected_minutes) AS expected_minutes,
           SUM(COALESCE(actual_minutes,0)) AS actual_minutes
         FROM work_order_task
         WHERE work_order_id = $1
         GROUP BY section_title
         ORDER BY MIN(position)`,
        [id]
      );

      const { rows: overallRows } = await pool.query(
        `SELECT
           SUM(expected_minutes) AS expected_minutes,
           SUM(COALESCE(actual_minutes,0)) AS actual_minutes
         FROM work_order_task
         WHERE work_order_id = $1`,
        [id]
      );

      payload.totals = {
        bySection,
        overall: overallRows[0] || { expected_minutes: 0, actual_minutes: 0 },
      };
    }

    res.json(payload);
  } catch (e) {
    console.error('GET /work-orders/:id failed:', e);
    res.status(500).json({ error: 'failed to fetch work order' });
  }
});

// 2) Obtener checklist de la orden (para la app del técnico)
r.get('/:id/tasks', async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    'SELECT * FROM work_order_task WHERE work_order_id=$1 ORDER BY position', [id]
  );
  res.json(rows);
});

/**
 * GET /work-orders/tech/:email/orders?include=tasks|totals|all
 * Devuelve TODAS las órdenes asignadas a ese técnico (por email).
 * Opcionalmente incluye checklist (tasks) y/o totales.
 *
 * Ejemplos:
 *  /work-orders/tech/ivan.arteaga%40asiarobotica.com/orders
 *  /work-orders/tech/ivan.arteaga%40asiarobotica.com/orders?include=all
 */
r.get("/tech/:email/orders", async (req, res) => {
  // Nota: Express ya decodifica %40 -> @ en req.params
  const emailRaw = String(req.params.email || "").trim();
  const include = String(req.query.include || "").toLowerCase();

  if (!emailRaw || !emailRaw.includes("@")) {
    return res.status(400).json({ error: "invalid email" });
  }

  try {
    // 1) Trae órdenes del técnico
    // 1) Trae órdenes del técnico (con nombre de modelo y familia)
    const { rows: orders } = await pool.query(
     `
      SELECT
        o.*,
        m.name          AS model_name,
        m.manufacturer  AS model_manufacturer,
        m.family_id     AS model_family_id,
        f.name          AS model_family_name,
        t.name          AS template_title
      FROM work_order o
      LEFT JOIN machine_model   m ON m.id = o.model_id
      LEFT JOIN machine_family  f ON f.id = m.family_id
      LEFT JOIN maintenance_template t ON t.id = o.template_id
      WHERE LOWER(o.assigned_tech_email) = LOWER($1)
      ORDER BY o.scheduled_at NULLS LAST, o.created_at DESC
      `,
      [emailRaw]
    );

    if (orders.length === 0) {
      // mejor 200 con [] para listas
      return res.json([]);
    }

    // Si no pidieron nada extra, regresamos tal cual
    if (include !== "tasks" && include !== "totals" && include !== "all") {
      return res.json(orders);
    }

    const ids = orders.map(o => o.id);

    // 2) Si piden tasks (checklist)
    let tasksByOrder = {};
    if (include === "tasks" || include === "all") {
      const { rows: tasks } = await pool.query(
        `SELECT *
           FROM work_order_task
          WHERE work_order_id = ANY($1::int[])
          ORDER BY work_order_id, position`,
        [ids]
      );
      tasksByOrder = tasks.reduce((acc, t) => {
        (acc[t.work_order_id] ||= []).push(t);
        return acc;
      }, {});
    }

    // 3) Si piden totals (por sección y global)
    let totalsByOrder = {};
    if (include === "totals" || include === "all") {
      // por sección
      const { rows: secRows } = await pool.query(
        `SELECT work_order_id,
                section_title,
                SUM(expected_minutes) AS expected_minutes,
                SUM(COALESCE(actual_minutes,0)) AS actual_minutes
           FROM work_order_task
          WHERE work_order_id = ANY($1::int[])
          GROUP BY work_order_id, section_title
          ORDER BY work_order_id, MIN(position)`,
        [ids]
      );

      // global
      const { rows: overallRows } = await pool.query(
        `SELECT work_order_id,
                SUM(expected_minutes) AS expected_minutes,
                SUM(COALESCE(actual_minutes,0)) AS actual_minutes
           FROM work_order_task
          WHERE work_order_id = ANY($1::int[])
          GROUP BY work_order_id`,
        [ids]
      );

      const bySectionMap = secRows.reduce((acc, r) => {
        (acc[r.work_order_id] ||= []).push({
          section_title: r.section_title,
          expected_minutes: Number(r.expected_minutes) || 0,
          actual_minutes: Number(r.actual_minutes) || 0,
        });
        return acc;
      }, {});

      const overallMap = overallRows.reduce((acc, r) => {
        acc[r.work_order_id] = {
          expected_minutes: Number(r.expected_minutes) || 0,
          actual_minutes: Number(r.actual_minutes) || 0,
        };
        return acc;
      }, {});

      totalsByOrder = ids.reduce((acc, id) => {
        acc[id] = {
          bySection: bySectionMap[id] || [],
          overall: overallMap[id] || { expected_minutes: 0, actual_minutes: 0 },
        };
        return acc;
      }, {});
    }

    // 4) Ensambla respuesta
    const payload = orders.map(o => ({
      ...o,
      ...(tasksByOrder[o.id] ? { tasks: tasksByOrder[o.id] } : {}),
      ...(totalsByOrder[o.id] ? { totals: totalsByOrder[o.id] } : {}),
    }));

    res.json(payload);
  } catch (e) {
    console.error("GET /work-orders/tech/:email/orders failed:", e);
    res.status(500).json({ error: "failed to fetch work orders" });
  }
});

/**
 * GET /work-orders/tech_reservaid/:email/:id_reserva/orders?include=tasks|totals|all
 * Devuelve las órdenes asignadas a ese técnico (por email) y vinculadas a una reserva específica.
 * Opcionalmente incluye checklist (tasks) y/o totales.
 *
 * Ejemplos:
 *  /work-orders/tech_reservaid/ivan.arteaga%40asiarobotica.com/2555/orders
 *  /work-orders/tech_reservaid/ivan.arteaga%40asiarobotica.com/2555/orders?include=all
 */
r.get("/tech_reservaid/:email/:id_reserva/orders", async (req, res) => {
  const emailRaw = String(req.params.email || "").trim();
  const idReserva = Number(req.params.id_reserva);
  const include = String(req.query.include || "").toLowerCase();

  if (!emailRaw || !emailRaw.includes("@")) {
    return res.status(400).json({ error: "invalid email" });
  }
  if (!idReserva || isNaN(idReserva)) {
    return res.status(400).json({ error: "invalid id_reserva" });
  }

  try {
    // 1) Trae órdenes filtradas por técnico y reserva
    const { rows: orders } = await pool.query(
      `
      SELECT
        o.*,
        m.name          AS model_name,
        m.manufacturer  AS model_manufacturer,
        m.family_id     AS model_family_id,
        f.name          AS model_family_name,
        t.name          AS template_title
      FROM work_order o
      LEFT JOIN machine_model   m ON m.id = o.model_id
      LEFT JOIN machine_family  f ON f.id = m.family_id
      LEFT JOIN maintenance_template t ON t.id = o.template_id
      WHERE LOWER(o.assigned_tech_email) = LOWER($1)
        AND o.id_reserva = $2
      ORDER BY o.scheduled_at NULLS LAST, o.created_at DESC
      `,
      [emailRaw, idReserva]
    );

    if (orders.length === 0) {
      return res.json([]);
    }

    // Si no piden nada extra
    if (include !== "tasks" && include !== "totals" && include !== "all") {
      return res.json(orders);
    }

    const ids = orders.map(o => o.id);

    // 2) Si piden tasks (checklist)
    let tasksByOrder = {};
    if (include === "tasks" || include === "all") {
      const { rows: tasks } = await pool.query(
        `SELECT *
           FROM work_order_task
          WHERE work_order_id = ANY($1::int[])
          ORDER BY work_order_id, position`,
        [ids]
      );
      tasksByOrder = tasks.reduce((acc, t) => {
        (acc[t.work_order_id] ||= []).push(t);
        return acc;
      }, {});
    }

    // 3) Si piden totals
    let totalsByOrder = {};
    if (include === "totals" || include === "all") {
      const { rows: secRows } = await pool.query(
        `SELECT work_order_id,
                section_title,
                SUM(expected_minutes) AS expected_minutes,
                SUM(COALESCE(actual_minutes,0)) AS actual_minutes
           FROM work_order_task
          WHERE work_order_id = ANY($1::int[])
          GROUP BY work_order_id, section_title
          ORDER BY work_order_id, MIN(position)`,
        [ids]
      );

      const { rows: overallRows } = await pool.query(
        `SELECT work_order_id,
                SUM(expected_minutes) AS expected_minutes,
                SUM(COALESCE(actual_minutes,0)) AS actual_minutes
           FROM work_order_task
          WHERE work_order_id = ANY($1::int[])
          GROUP BY work_order_id`,
        [ids]
      );

      const bySectionMap = secRows.reduce((acc, r) => {
        (acc[r.work_order_id] ||= []).push({
          section_title: r.section_title,
          expected_minutes: Number(r.expected_minutes) || 0,
          actual_minutes: Number(r.actual_minutes) || 0,
        });
        return acc;
      }, {});

      const overallMap = overallRows.reduce((acc, r) => {
        acc[r.work_order_id] = {
          expected_minutes: Number(r.expected_minutes) || 0,
          actual_minutes: Number(r.actual_minutes) || 0,
        };
        return acc;
      }, {});

      totalsByOrder = ids.reduce((acc, id) => {
        acc[id] = {
          bySection: bySectionMap[id] || [],
          overall: overallMap[id] || { expected_minutes: 0, actual_minutes: 0 },
        };
        return acc;
      }, {});
    }

    // 4) Ensambla respuesta final
    const payload = orders.map(o => ({
      ...o,
      ...(tasksByOrder[o.id] ? { tasks: tasksByOrder[o.id] } : {}),
      ...(totalsByOrder[o.id] ? { totals: totalsByOrder[o.id] } : {}),
    }));

    res.json(payload);
  } catch (e) {
    console.error("GET /work-orders/tech_reservaid/:email/:id_reserva/orders failed:", e);
    res.status(500).json({ error: "failed to fetch work orders by reserva" });
  }
});

// 3) Actualizar ítem (estatus, observación, tiempo real, foto)
/*
r.put('/tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { status, observation, actual_minutes, photo_url } = req.body;
  const { rows } = await pool.query(
    `UPDATE work_order_task
     SET status = COALESCE($1, status),
         observation = COALESCE($2, observation),
         actual_minutes = COALESCE($3, actual_minutes),
         photo_url = COALESCE($4, photo_url)
     WHERE id=$5 RETURNING *`,
    [status, observation, actual_minutes, photo_url, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'not found' });
  res.json(rows[0]);
});
*/

// 3) Actualizar ítem (estatus, observación, tiempo real, foto, extra_data)
r.put('/tasks/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { status, observation, actual_minutes, photo_url, extra_data } = req.body;

  try {
    const { rows } = await pool.query(
      `UPDATE work_order_task
       SET 
         status = COALESCE($1, status),
         observation = COALESCE($2, observation),
         actual_minutes = COALESCE($3, actual_minutes),
         photo_url = COALESCE($4, photo_url),
         extra_data = COALESCE($5::jsonb, extra_data)
       WHERE id = $6
       RETURNING *`,
      [status, observation, actual_minutes, photo_url, extra_data, id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('❌ Error al actualizar tarea:', error);
    res.status(500).json({ error: 'internal_error', details: error.message });
  }
});

r.put('/diagnostic-result/:id', async (req, res) => {
  const id = Number(req.params.id);
  const raw = req.body?.diagnostic_result;
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });

  const value = typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : null;
  const allowed = new Set(['NORMAL','AJUSTE','REFACCION','EXTENDER_SERVICIO','ESCALAR','CRITICO']);
  if (value && !allowed.has(value)) {
    return res.status(400).json({ error: 'invalid diagnostic_result', allowed: [...allowed] });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE work_order
         SET diagnostic_result = COALESCE($1, diagnostic_result),
             status            = 'DONE',
             finished_at       = NOW()
       WHERE id = $2
       RETURNING *`,
      [value, id]
    );

    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('PUT /work-orders/diagnostic-result/:id failed:', e);
    res.status(500).json({ error: 'internal error' });
  }
});


r.put("/edit_prod/:id", async (req, res) => {
  const id = Number(req.params.id);

  // Extraemos solo los campos que quieres actualizar
  const {
    tech_support,
    scheduled_at,
    folio_sai,
    comments,
    initial_status,
    machine_serial,
    assigned_tech_email
  } = req.body;

  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "invalid id" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE work_order
       SET tech_support   = COALESCE($1, tech_support),
           scheduled_at   = COALESCE($2, scheduled_at),
           folio_sai      = COALESCE($3, folio_sai),
           comments       = COALESCE($4, comments),
           initial_status = COALESCE($5, initial_status),
           machine_serial = COALESCE($6, machine_serial),
           assigned_tech_email = COALESCE($7, assigned_tech_email)
       WHERE id = $8
       RETURNING *`,
      [
        tech_support,
        scheduled_at,
        folio_sai,
        comments,
        initial_status,
        machine_serial,
	assigned_tech_email,
        id,
      ]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "work_order not found" });
    }

    res.json(rows[0]);
  } catch (e) {
    console.error("PUT /edit_prod failed:", e);
    res.status(500).json({ error: "internal error" });
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
      `UPDATE work_order_task
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

r.put("/:id/restart_stavance", async (req, res) => {
  const id = Number(req.params.id);
  

  if (!id) {
    return res.status(400).json({ error: "Falta ID" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE work_order_task
       SET status = 'PENDIENTE',
           started_at = NULL,
           finished_at = NULL,
           actual_minutes = 0
       WHERE work_order_id = $1
       RETURNING *`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    res.json({ message: "Actividades limpias", task: rows[0] });
  } catch (err) {
    console.error("❌ Error actualizando tareas:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

r.put("/:id/prod_end", async (req, res) => {
  const id = Number(req.params.id);


  if (!id) {
    return res.status(400).json({ error: "Falta ID" });
  }


  const nowMX = new Date().toLocaleString("sv-SE", { timeZone: "America/Mexico_City" });


  try {
    const { rows } = await pool.query(
      `UPDATE work_order
       SET status = 'FINISHED',
       diagnostic_result = 'SUCCESSFUL',
       finished_at = $2
       WHERE id=$1
       RETURNING *`,
      [id, nowMX]
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

// 🔹 PUT /api10/agregar_puntos_extra
r.put("/agregar_puntos_extra", async (req, res) => {
  try {
    const { work_order_id, extra_points } = req.body;

    if (!work_order_id || isNaN(extra_points)) {
      return res.status(400).json({ error: "Parámetros inválidos" });
    }

    const updateQuery = `
      UPDATE PUBLIC.work_order
      SET extra_points = $1
      WHERE id = $2
      RETURNING id, extra_points;
    `;

    const { rows } = await pool.query(updateQuery, [extra_points, work_order_id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "No se encontró la orden especificada" });
    }

    res.json({
      message: "✅ Puntos extra actualizados correctamente",
      result: rows[0],
    });
  } catch (err) {
    console.error("❌ Error en PUT /agregar_puntos_extra:", err.message);
    res.status(500).json({ error: "Error interno al actualizar los puntos extra" });
  }
});
module.exports = r;
