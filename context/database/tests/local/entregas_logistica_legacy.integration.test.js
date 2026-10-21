import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOURCE, loadRecords, sha256 } from '../../importers/import_entregas_logistica_legacy.js';
import { connectLocal, applyRecords, TABLE } from '../../importers/apply_entregas_logistica_legacy_local.js';

// Efectos persistentes deliberados SOLO con esta habilitacion explicita.
// PowerShell: $env:RUN_ENTREGAS_LEGACY_LOCAL_TESTS='1'
// node --env-file=context/api10/.env.local --test --test-isolation=none context/database/tests/local/entregas_logistica_legacy.integration.test.js
test('integracion PostgreSQL LOCAL exclusiva del archivo legacy', {
  skip: process.env.RUN_ENTREGAS_LEGACY_LOCAL_TESTS !== '1',
}, async (t) => {
  const input = process.env.ENTREGAS_LEGACY_XLSX
    || 'C:\\Proyectos\\matar_sheets\\Sistema Rastreabilidad.xlsx';
  const { records } = loadRecords(input);
  const client = await connectLocal();
  const sqlCalls = [];
  const observed = { query(sql, params) { sqlCalls.push(sql); return client.query(sql, params); } };
  let first, second, saved;
  try {
    await t.test('crea solamente la tabla historica cuando no existe', async () => {
      const exists = (await observed.query("SELECT to_regclass('" + TABLE + "')::text AS name")).rows[0].name;
      if (!exists) {
        const migration = readFileSync(
          new URL('../../migrations/local/20261021_create_entregas_logistica_legacy.sql', import.meta.url),
          'utf8',
        );
        await observed.query(migration);
      }
      assert.ok((await observed.query("SELECT to_regclass('" + TABLE + "') AS name")).rows[0].name);
    });
    await t.test('primera carga completa; reejecuciones solo reconocen filas exactas', async () => {
      const before = (await observed.query('SELECT count(*)::int AS n FROM ' + TABLE)).rows[0].n;
      assert.ok(before === 0 || before === 1002);
      first = await applyRecords(observed, records);
      assert.equal(first.inserted, before === 0 ? 1002 : 0);
      assert.equal(first.matched, before);
      assert.equal(first.sourceTotal, 1002);
    });
    let importedBefore;
    await t.test('segunda ejecucion 0 inserts, 1002 coincidencias; batch/fecha intactos', async () => {
      importedBefore = (await observed.query(
        'SELECT id::text, import_batch_id, imported_at::text FROM ' + TABLE + ' ORDER BY source_row',
      )).rows;
      second = await applyRecords(observed, records);
      assert.equal(second.inserted, 0); assert.equal(second.matched, 1002);
      const importedAfter = (await observed.query(
        'SELECT id::text, import_batch_id, imported_at::text FROM ' + TABLE + ' ORDER BY source_row',
      )).rows;
      assert.deepEqual(importedAfter, importedBefore);
    });
    await t.test('total, claves y carpetas: 1002 filas; sin nulos ni duplicados', async () => {
      const r = (await observed.query('SELECT count(*)::int AS total, '
        + '(count(*)-count(DISTINCT legacy_key))::int AS duplicate_keys, '
        + '(count(*)-count(DISTINCT drive_folder_id))::int AS duplicate_folders, '
        + 'count(*) FILTER (WHERE drive_folder_id IS NULL)::int AS null_folders, '
        + 'count(local_datetime)::int AS normalized_dates FROM ' + TABLE)).rows[0];
      assert.deepEqual(r, {
        total: 1002, duplicate_keys: 0, duplicate_folders: 0, null_folders: 0, normalized_dates: 1002,
      });
      console.log('LOCAL_DB_SUMMARY=' + JSON.stringify(r));
    });
    await t.test('1002 pedidos y todos los campos coinciden con el snapshot', async () => {
      saved = (await observed.query("SELECT to_jsonb(t)-'id'-'import_batch_id'-'imported_at' AS record "
        + 'FROM ' + TABLE + ' t ORDER BY source_row')).rows.map((r) => r.record);
      assert.deepEqual(saved, records);
      assert.ok(saved.every((r) => typeof r.pedido === 'string'));
    });
    await t.test('filas 128, 10, 831, 5 y 32 preservadas en PostgreSQL', () => {
      const by = new Map(saved.map((r) => [r.source_row, r]));
      assert.equal(by.get(128).local_datetime, '2023-12-04T10:29:47');
      assert.equal(by.get(128).hora_raw, '10:29:47 a.m.');
      assert.equal(by.get(10).legacy_image_count, 17);
      assert.equal(by.get(831).raw_payload.cells.I.v, 506760);
      assert.equal(by.get(831).observaciones, '506760');
      assert.equal(by.get(5).latitude, 20.5804224);
      assert.match(by.get(5).ubicacion, /20\.586051/);
      assert.match(by.get(32).ubicacion, /undefined,\+undefined/);
    });
    await t.test('timestamp sin zona, sin SQL sobre tablas operativas y XLSX intacto', async () => {
      const type = (await observed.query("SELECT data_type FROM information_schema.columns "
        + "WHERE table_schema='public' AND table_name='entregas_logistica_legacy' "
        + "AND column_name='local_datetime'")).rows[0].data_type;
      assert.equal(type, 'timestamp without time zone');
      assert.ok(sqlCalls.every((s) =>
        !/\b(logistica_deliveries|logistica_delivery_evidence|logistica_authorized_users)\b/.test(s)));
      assert.equal(sha256(readFileSync(input)), SOURCE.sha256);
      console.log('LOCAL_IMPORT_RUNS=' + JSON.stringify({ first, second }));
    });
  } finally {
    // Tambien cierra una posible transaccion DDL fallida, sin cambios operacionales.
    try { await client.query('ROLLBACK'); } finally { await client.end(); }
  }
});
