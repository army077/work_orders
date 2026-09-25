const express = require("express");
const r = express.Router();
const pool = require("../db");

// Lista de plantillas
r.get('/', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT t.*, mm.name AS model_name
     FROM maintenance_template t
     LEFT JOIN machine_model mm ON mm.id = t.model_id
     ORDER BY t.updated_at DESC`
  );
  res.json(rows);
});
// Traer plantilla por id
r.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const { rows } = await pool.query(
    `SELECT t.*, mm.name AS model_name
     FROM maintenance_template t
     LEFT JOIN machine_model mm ON mm.id = t.model_id
     WHERE t.id = $1`,
    [id]
  );

  if (!rows.length) return res.status(404).json({ error: "Plantilla no encontrada" });

  res.json(rows[0]); // Solo una plantilla
});


// Crear plantilla
r.post('/', async (req, res) => {
  const { name, template_type, model_id } = req.body;

      if (!name || !template_type || !model_id) {
      return res.status(400).json({ error: "Faltan campos requeridos" });
    }

    // 👉 Validación de unicidad solo para INSPECCION
    if (template_type === 'INSPECCION') {
      const existing = await pool.query(
        `SELECT id 
         FROM maintenance_template 
         WHERE template_type = 'INSPECCION' AND model_id = $1
         LIMIT 1`,
        [model_id]
      );

      if (existing.rowCount > 0) {
        return res.status(409).json({
          error: "Ya existe una plantilla de INSPECCIÓN para este modelo",
        });
      }
    }
  const { rows } = await pool.query(
    `INSERT INTO maintenance_template(name, template_type, model_id)
     VALUES ($1,$2,$3) RETURNING *`,
    [name, template_type, model_id]
  );
  res.status(201).json(rows[0]);
});

// Borrar plantilla
r.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const { rows, rowCount } = await pool.query(
      `DELETE FROM maintenance_template
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Registro no encontrado' });
    }

    res.status(200).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando plantilla' });
  }
});


// Publicar (incrementa versión y marca published)
r.post('/:id/publish', async (req, res) => {
  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cur } = await client.query(
      'SELECT version FROM maintenance_template WHERE id=$1 FOR UPDATE', [id]
    );
    if (!cur.length) return res.status(404).json({ error: 'not found' });
    const next = cur[0].version + 1;
    const { rows } = await client.query(
      `UPDATE maintenance_template
       SET version=$1, is_published=true, updated_at=NOW()
       WHERE id=$2 RETURNING *`, [next, id]
    );
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'publish failed' });
  } finally { client.release(); }
});


// ACTUALIZAR EL NOMBRE DE LA PLANTILLA
r.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;

  if (!id || !name || !name.trim()) {
    return res.status(400).json({ error: "Faltan campos obligatorios (id o name)" });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE maintenance_template
       SET name = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [name.trim(), id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Plantilla no encontrada" });
    }

    console.log(`✅ Plantilla ${id} actualizada: ${name}`);
    res.json({
      message: "Plantilla actualizada correctamente",
      template: rows[0],
    });
  } catch (err) {
    console.error("❌ Error al actualizar plantilla:", err);
    res.status(500).json({ error: "Error en el servidor" });
  }
});

module.exports = r;
