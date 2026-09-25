const express = require("express");
const r = express.Router();
const pool = require("../db");

// VISUALIZACIÓN DE BONOS
r.get("/visualizar", async (req, res) => {
  try {
    const { inicio, fin } = req.query;

    // 🔹 Filtro de fechas con conversión a hora local
    const params = [];
    let fechaFiltro = "";

    if (inicio && fin) {
      params.push(inicio, fin);
      fechaFiltro = `
        AND (wo.finished_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date
            BETWEEN $1::date AND $2::date
      `;
    } else if (inicio) {
      params.push(inicio);
      fechaFiltro = `
        AND (wo.finished_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date >= $1::date
      `;
    } else if (fin) {
      params.push(fin);
      fechaFiltro = `
        AND (wo.finished_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date <= $1::date
      `;
    }

    // ==================== QUERY PRINCIPAL ====================
    const bonosQuery = `
      WITH customs_sum AS (
        SELECT
          work_order_id,
          SUM(custom_value) AS total_custom_value
        FROM public.work_order_customs
        GROUP BY work_order_id
      ),
      time_delay_sum AS (
        SELECT
          wot.work_order_id,
          SUM(pd.tiempo_retraso) AS retraso_total
        FROM public.prod_delayments pd
        LEFT JOIN public.work_order_task wot ON pd.id_actividad = wot.id
        GROUP BY wot.work_order_id
      ),
      dias_laborales_calc AS (
        SELECT
          wo.id AS work_order_id,
          COUNT(*) FILTER (WHERE EXTRACT(ISODOW FROM gs.day) < 6) AS dias_laborales
        FROM public.work_order wo
        JOIN LATERAL generate_series(
          date_trunc('day', wo.created_at),
          date_trunc('day', wo.finished_at),
          '1 day'
        ) AS gs(day) ON TRUE
        WHERE wo.finished_at IS NOT NULL AND wo.created_at IS NOT NULL
        GROUP BY wo.id
      ),
      main_stats AS (
        SELECT
          wo.assigned_tech_email AS correo_tecnico,
          COUNT(DISTINCT wo.id) AS conteo_ordenes,
          COALESCE(SUM(mm.bond_value), 0) AS suma_puntos_maquina,
          COALESCE(SUM(cs.total_custom_value), 0) AS suma_puntos_customs,

          -- 🔹 Suma de puntos extra
          COALESCE(SUM(wo.extra_points), 0) AS suma_puntos_extra,

          -- 🔹 Suma de puntos por eficiencia (solo si eficiencia >= 100%)
          COALESCE(SUM(
            CASE
              WHEN (mm.standard_days >= dl.dias_laborales) THEN
                LEAST(
                  (5 * GREATEST((mm.standard_days - COALESCE(tds.retraso_total, 0) / 7.0), 0)),
                  (mm.bond_value * 0.10)
                )
              ELSE 0
            END
          ), 0) AS suma_puntos_eficiencia

        FROM public.work_order wo
        LEFT JOIN public.machine_model mm ON wo.model_id = mm.id
        LEFT JOIN customs_sum cs ON wo.id = cs.work_order_id
        LEFT JOIN time_delay_sum tds ON wo.id = tds.work_order_id
        LEFT JOIN dias_laborales_calc dl ON wo.id = dl.work_order_id
        WHERE wo.status = 'FINISHED'
          ${fechaFiltro}
        GROUP BY wo.assigned_tech_email
      ),
      secondary_stats AS (
        SELECT
          wo.tech_support AS correo_tecnico,
          FLOOR(SUM(mm.bond_value * 0.5)) AS puntos_secundario,
          COUNT(DISTINCT wo.id) AS equipos_secundarios
        FROM public.work_order wo
        LEFT JOIN public.machine_model mm ON wo.model_id = mm.id
        WHERE wo.tech_support IS NOT NULL
          AND wo.status = 'FINISHED'
          ${fechaFiltro}
        GROUP BY wo.tech_support
      )
      SELECT
	pt.numero_empleado,
        pt.nombre_tecnico,
        pt.correo_tecnico,
        COALESCE(ms.conteo_ordenes, 0) AS conteo_ordenes,
        COALESCE(ms.suma_puntos_maquina, 0) AS suma_puntos_maquina,
        COALESCE(ms.suma_puntos_customs, 0) AS suma_puntos_customs,
        COALESCE(ss.puntos_secundario, 0) AS puntos_secundario,
        COALESCE(ms.suma_puntos_extra, 0) AS puntos_extra,
        COALESCE(ms.suma_puntos_eficiencia, 0) AS puntos_eficiencia,
        COALESCE(ss.equipos_secundarios, 0) AS equipos_secundarios
      FROM public.plantilla_tecnicos pt
      LEFT JOIN main_stats ms ON pt.correo_tecnico = ms.correo_tecnico
      LEFT JOIN secondary_stats ss ON pt.correo_tecnico = ss.correo_tecnico
      WHERE pt.puesto = 'Operador de producción'
      ORDER BY conteo_ordenes DESC;
    `;

    const { rows: resumen } = await pool.query(bonosQuery, params);

    // ==================== DETALLE DE ÓRDENES ====================
    const detalleQuery = `
      WITH customs_sum AS (
        SELECT
          work_order_id,
          SUM(custom_value) AS total_custom_value
        FROM public.work_order_customs
        GROUP BY work_order_id
      )
      SELECT
        wo.id AS work_order_id,
        wo.assigned_tech_email,
        wo.tech_support,
        wo.status,
        wo.finished_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City' AS finished_local,
        wo.machine_serial,
        wo.customer_name,
        wo.site_address,
        mm.name AS modelo_maquina,
        mm.standard_days,
        mm.bond_value AS puntos_maquina,
        COALESCE(cs.total_custom_value, 0) AS puntos_customs,
        FLOOR(CASE WHEN wo.tech_support IS NOT NULL THEN mm.bond_value * 0.5 ELSE 0 END) AS puntos_secundario,
        COALESCE(wo.extra_points, 0) AS puntos_extra
      FROM public.work_order wo
      LEFT JOIN public.machine_model mm ON wo.model_id = mm.id
      LEFT JOIN customs_sum cs ON wo.id = cs.work_order_id
      WHERE wo.status = 'FINISHED'
        ${fechaFiltro}
      ORDER BY finished_local DESC NULLS LAST;
    `;

    const { rows: detalle } = await pool.query(detalleQuery, params);

    // Combinar resumen y detalle
    const resumenConDetalle = resumen.map((tec) => ({
      ...tec,
      detalle_ordenes: detalle.filter(
        (d) =>
          d.assigned_tech_email === tec.correo_tecnico ||
          d.tech_support === tec.correo_tecnico
      ),
    }));

    res.json({
      periodo: { inicio: inicio || null, fin: fin || null },
      total_tecnicos: resumen.length,
      resumen: resumenConDetalle,
    });
  } catch (err) {
    console.error("❌ Error en GET /bonos/visualizar:", err.message);
    res.status(500).json({ error: "Error interno al obtener los bonos" });
  }
});

// 🔹 ENDPOINT: Detalle de órdenes con eficiencia y bonos
r.get("/detalle", async (req, res) => {
  try {
    const { inicio, fin } = req.query;

    // 🔹 Armado de filtro de fechas (usando hora local real)
    const params = [];
    let fechaFiltro = "";

    if (inicio && fin) {
      params.push(inicio, fin);
      fechaFiltro = `
        AND (wo.finished_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date
            BETWEEN $1::date AND $2::date
      `;
    } else if (inicio) {
      params.push(inicio);
      fechaFiltro = `
        AND (wo.finished_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date >= $1::date
      `;
    } else if (fin) {
      params.push(fin);
      fechaFiltro = `
        AND (wo.finished_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City')::date <= $1::date
      `;
    }

    // ==================== QUERY PRINCIPAL SIN ROUND ====================
    const query = `
      WITH customs_sum AS (
        SELECT 
          work_order_id,
          SUM(custom_value) AS total_custom_value
        FROM public.work_order_customs
        GROUP BY work_order_id
      ),
      time_delay_sum AS (
        SELECT
          wot.work_order_id,
          SUM(pd.tiempo_retraso) AS retraso_total
        FROM public.prod_delayments pd
        LEFT JOIN public.work_order_task wot ON pd.id_actividad = wot.id
        GROUP BY wot.work_order_id
      )
      SELECT
        wo.id,
        wo.assigned_tech_email,
        wo.tech_support,
        wo.status,
        wo.created_at,
        wo.finished_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Mexico_City' AS finished_local,
        mt.name AS titulo,
        mm.name AS modelo,
	wo.initial_status as status_inicial,
        mm.bond_value AS bono_equipo,

        -- 🔹 Días estándar (sin redondear)
        mm.standard_days::numeric AS dias_estandar,

        -- 🔹 Días laborales reales
        gs.dias_laborales,

        -- 🔹 Tiempos en horas
        (gs.dias_laborales * 7) AS tiempo_usado,
        GREATEST((gs.dias_laborales * 7) - COALESCE(tds.retraso_total, 0), 0) AS tiempo_necesario,

        -- 🔹 Eficiencia sin redondear
        (mm.standard_days::numeric * 7)
        / NULLIF(
            GREATEST((gs.dias_laborales * 7) - COALESCE(tds.retraso_total/60, 0), 0),
            0
          ) AS eficiencia,

        -- 🔹 Bono secundario
        CASE
          WHEN wo.tech_support IS NOT NULL AND wo.tech_support <> '' THEN FLOOR(mm.bond_value * 0.5)
          ELSE 0
        END AS bono_operador_2,

        -- 🔹 Customs
        COALESCE(cs.total_custom_value, 0) AS suma_puntos_customs,

	COALESCE(wo.extra_points, 0) AS suma_puntos_extra,

        -- 🔹 Puntos por eficiencia (máx 10% del bono)
    	COALESCE(
  		CASE
    			WHEN mm.standard_days > gs.dias_laborales THEN
      				LEAST(
        			(5 * GREATEST((mm.standard_days - COALESCE(tds.retraso_total/60, 0) / 7.0), 0)),
        			(mm.bond_value * 0.10)
     				 )
    			ELSE 0
  		END,
  		0
	) AS suma_puntos_eficiencia
      FROM public.work_order wo
      LEFT JOIN public.maintenance_template mt ON wo.template_id = mt.id
      LEFT JOIN public.machine_model mm ON wo.model_id = mm.id
      LEFT JOIN customs_sum cs ON wo.id = cs.work_order_id
      LEFT JOIN time_delay_sum tds ON wo.id = tds.work_order_id

      -- 🔹 Subconsulta lateral para contar días laborales reales
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE EXTRACT(ISODOW FROM day) < 6) AS dias_laborales
        FROM generate_series(
          date_trunc('day', wo.created_at),
          date_trunc('day', wo.finished_at),
          '1 day'
        ) AS day
      ) gs ON TRUE

      WHERE mt.template_type = 'ENSAMBLE'
        AND wo.created_at IS NOT NULL
        AND wo.finished_at IS NOT NULL
        ${fechaFiltro}
      GROUP BY
        wo.id,
        mt.name,
        mm.name,
        mm.bond_value,
	mm.standard_days,
        cs.total_custom_value,
        tds.retraso_total,
        gs.dias_laborales
      ORDER BY finished_local DESC;
    `;

    const { rows } = await pool.query(query, params);

    // ==================== RESPUESTA JSON ====================
    res.json({
      periodo: { inicio: inicio || null, fin: fin || null },
      total_ordenes: rows.length,
      resultados: rows,
    });

  } catch (err) {
    console.error("❌ Error en GET /bonos/detalle:", err.message);
    res.status(500).json({ error: "Error interno al obtener el detalle de bonos" });
  }
});

//DATOS PARA GOOGLE SHEETS
r.get("/datos_produccion", async (req, res) => {
  try {
    const { inicio, fin } = req.query;

    // ==================== FILTROS OPCIONALES ====================
    const params = [];
    let fechaFiltro = "";

    if (inicio && fin) {
      params.push(inicio, fin);
      fechaFiltro = `AND wo.finished_at BETWEEN $1 AND $2`;
    } else if (inicio) {
      params.push(inicio);
      fechaFiltro = `AND wo.finished_at >= $1`;
    } else if (fin) {
      params.push(fin);
      fechaFiltro = `AND wo.finished_at <= $1`;
    }

    // ==================== QUERY PRINCIPAL ====================
    const query = `
      SELECT
        wo.id AS work_order_id,
        mt."name" AS titulo,
        mf."name" AS familia,
        mm."name" AS modelo,
        pt.nombre_tecnico AS tecnico_asignado,
        wo.assigned_tech_email AS correo_tecnico_asignado,
        wo.created_at,
        wo.finished_at,
        wo.status,
        wo.folio_sai,
        wo.initial_status AS status_inicial,
        wo.machine_serial AS numero_serie,
        wo.extra_points AS bono_extra,
        wo.comments AS comentarios,
        ROUND(mm.bond_value / 2) * 7 AS tiempo_estandar,

        -- ✅ Calcular días laborales en subconsulta lateral independiente
        gs.dias_laborales * 7 AS tiempo_usado,

        COALESCE(SUM(DISTINCT pd.tiempo_retraso/60), 0) AS horas_retraso,
        (gs.dias_laborales * 7) - COALESCE(SUM(DISTINCT pd.tiempo_retraso/60), 0) AS tiempo_necesario,

        ROUND(
          (NULLIF(ROUND(mm.bond_value / 2)::numeric, 0) * 7)
          / NULLIF(
              (
                (gs.dias_laborales * 7)
                - COALESCE(SUM(DISTINCT pd.tiempo_retraso/60), 0)
              )::numeric,
              0
            ),
          2
        ) AS eficiencia,

        FLOOR((DATE_PART('doy', wo.finished_at) - ((EXTRACT(DOW FROM wo.finished_at)::int - 5 + 7) % 7)) / 7) + 1 AS semana,
        EXTRACT(MONTH FROM wo.finished_at) AS mes,
        EXTRACT(YEAR FROM wo.finished_at) AS año,
        mm.bond_value AS puntaje_principal,
        FLOOR((mm.bond_value * 0.5)) AS puntaje_secundario,
        wo.extra_points AS puntaje_extra,

        COALESCE(
          json_agg(
            DISTINCT jsonb_build_object(
              'id', woc.id,
              'titulo', woc.custom_title,
              'valor', woc.custom_value
            )
          ) FILTER (WHERE woc.id IS NOT NULL),
          '[]'
        ) AS customizaciones

      FROM PUBLIC.work_order wo

      -- 🔹 Subconsulta lateral para contar días laborales sin romper agregaciones
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE EXTRACT(ISODOW FROM day) < 6) AS dias_laborales
        FROM generate_series(
          date_trunc('day', wo.created_at),
          date_trunc('day', wo.finished_at),
          '1 day'
        ) AS day
      ) gs ON TRUE

      LEFT JOIN PUBLIC.machine_model mm ON wo.model_id = mm.id
      LEFT JOIN PUBLIC.machine_family mf ON mm.family_id = mf.id
      LEFT JOIN PUBLIC.maintenance_template mt ON wo.template_id = mt.id
      LEFT JOIN PUBLIC.plantilla_tecnicos pt ON wo.assigned_tech_email = pt.correo_tecnico
      LEFT JOIN PUBLIC.work_order_task wot ON wot.work_order_id = wo.id
      LEFT JOIN PUBLIC.prod_delayments pd ON wot.id = pd.id_actividad
      LEFT JOIN PUBLIC.work_order_customs woc ON woc.work_order_id = wo.id

      WHERE mt.template_type = 'ENSAMBLE'
      ${fechaFiltro}

      GROUP BY
        wo.id,
        mt."name",
        mf."name",
        mm."name",
        pt.nombre_tecnico,
        wo.assigned_tech_email,
        wo.created_at,
        wo.finished_at,
        wo.status,
        wo.folio_sai,
        wo.initial_status,
        wo.machine_serial,
        wo.extra_points,
        wo.comments,
        mm.bond_value,
        gs.dias_laborales
      ORDER BY wo.finished_at DESC;
    `;

    // ==================== EJECUCIÓN ====================
    const { rows } = await pool.query(query, params);

    res.json({
      periodo: { inicio: inicio || null, fin: fin || null },
      total_ordenes: rows.length,
      resultados: rows,
    });
  } catch (err) {
    console.error("❌ Error en GET /bonos/eficiencia:", err.message);
    res.status(500).json({ error: "Error interno al obtener la eficiencia de bonos" });
  }
});

module.exports = r;
