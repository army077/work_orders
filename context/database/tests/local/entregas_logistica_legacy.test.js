import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCE, loadRecords, parseSnapshot, legacyKey, contentHash, localDatetime, summarize,
} from '../../importers/import_entregas_logistica_legacy.js';
import {
  DB, SQL, COLUMNS, applyRecords, guardEnvironment, classifyRecords,
} from '../../importers/apply_entregas_logistica_legacy_local.js';

const INPUT = process.env.ENTREGAS_LEGACY_XLSX
  || 'C:\\Proyectos\\matar_sheets\\Sistema Rastreabilidad.xlsx';
const { records } = loadRecords(INPUT);
const row = (n) => records.find((r) => r.source_row === n);
const clone = (v) => structuredClone(v);
const warning = (n, code) => row(n).warnings.some((w) => w.code === code);

test('snapshot autorizado, solo filas 2..1003 y claves unicas', () => {
  assert.equal(records.length, 1002);
  assert.deepEqual(records.map((r) => r.source_row),
    Array.from({ length: 1002 }, (_, i) => i + 2));
  assert.equal(new Set(records.map((r) => r.legacy_key)).size, 1002);
  assert.ok(records.every((r) => r.source_snapshot_sha256 === SOURCE.sha256
    && r.source_sheet === 'Entregas'));
  assert.throws(() => parseSnapshot(Buffer.from('NOT_AUTHORIZED')), {
    code: 'UNAUTHORIZED_SNAPSHOT',
  });
});

test('clave de procedencia determinista, separada del contenido y del negocio', () => {
  assert.equal(row(2).legacy_key, legacyKey(SOURCE.sha256, 'Entregas', 2));
  assert.notEqual(row(2).legacy_key, legacyKey(SOURCE.sha256, 'Entregas', 3));
  assert.notEqual(row(2).legacy_key, legacyKey(SOURCE.sha256, 'entregas', 2));
  assert.notEqual(row(2).legacy_key, legacyKey('f'.repeat(64), 'Entregas', 2));
  assert.ok(records.every((r) => !('client_request_id' in r)
    && !('authorized_user_id' in r) && !('firebase_uid' in r) && !('status' in r)));
});

test('content_hash canonico de celdas originales, sensible a cambios', () => {
  const payload = clone(row(831).raw_payload);
  payload.cells = Object.fromEntries(Object.entries(payload.cells).reverse());
  assert.equal(contentHash(payload), row(831).content_hash);
  payload.cells.I.v = '506760';
  assert.notEqual(contentHash(payload), row(831).content_hash);
  assert.equal(row(831).raw_payload.cells.I.t, 'n');
  assert.equal(row(831).raw_payload.cells.I.v, 506760);
});

test('1002 pedidos textuales, preserva 0, 1 y valores largos sin deduplicar', () => {
  assert.ok(records.every((r) => typeof r.pedido === 'string'
    && r.pedido === String(r.raw_payload.cells.F.v)));
  assert.equal(records.filter((r) => r.pedido === '0').length, 42);
  assert.equal(records.filter((r) => r.pedido === '1').length, 4);
  assert.equal(row(565).pedido, '707957407564');
  assert.equal(row(524).pedido, '4500453922');
});

test('1002 datetime locales sin Z/offset; normaliza hora textual de fila 128', () => {
  assert.ok(records.every((r) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(r.local_datetime)));
  assert.equal(row(128).hora_raw, '10:29:47 a.m.');
  assert.equal(row(128).local_datetime, '2023-12-04T10:29:47');
  assert.equal(row(2).fecha_raw, '8/29/23');
  assert.equal(row(2).local_datetime, '2023-08-29T11:05:10');
  assert.equal(summarize(records).timezone, null);
});

test('normalizacion temporal independiente de la zona del host', () => {
  const previous = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/Mexico_City', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      assert.equal(localDatetime(row(128).raw_payload.cells.D, row(128).raw_payload.cells.E),
        '2023-12-04T10:29:47');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test('NULLs, false, espacios y metadatos se preservan', () => {
  assert.equal(records.filter((r) => r.observaciones === null).length, 130);
  assert.equal(records.filter((r) => r.ticket === null).length, 858);
  assert.equal(records.filter((r) => r.informacion_correcta === false).length, 860);
  assert.equal(records.filter((r) => r.actualizado_zoho === null).length, 723);
  assert.equal(records.filter((r) => r.comentarios === null).length, 972);
  assert.equal(row(1003).observaciones, 'se entrega completo ');
  assert.equal(row(2).raw_payload.cells.O.f,
    '"https://www.google.com.mx/maps/search/"&K2&",+"&L2');
});

test('1002 IDs de carpeta, sin inferir evidencias ni photo_count', () => {
  assert.equal(new Set(records.map((r) => r.drive_folder_id)).size, 1002);
  assert.ok(records.every((r) => r.drive_folder_id
    && r.drive_folder_url.endsWith('/' + r.drive_folder_id)
    && r.raw_payload.cells.N.hyperlink.target === r.drive_folder_url
    && !('photo_count' in r)));
});

test('anomalias filas 10, 831, 5 y 32 se preservan y reportan', () => {
  assert.equal(row(10).legacy_image_count, 17);
  assert.ok(warning(10, 'REPORTED_IMAGE_COUNT_ABOVE_15'));
  assert.equal(row(831).observaciones, '506760');
  assert.ok(warning(831, 'NUMERIC_OBSERVATION'));
  assert.equal(row(5).latitude, 20.5804224);
  assert.equal(row(5).longitude, -103.4285376);
  assert.match(row(5).ubicacion, /20\.586051/);
  assert.ok(warning(5, 'LOCATION_COORDINATES_MISMATCH'));
  assert.match(row(32).ubicacion, /undefined,\+undefined/);
  assert.equal(row(32).latitude, 20.720584);
  assert.ok(warning(32, 'LOCATION_URL_UNPARSEABLE'));
  assert.equal(summarize(records).anomalies.ORDER_ZERO_OR_ONE.length, 46);
});

test('guardas rechazan configuracion de produccion antes de conectar', () => {
  const env = {
    APP_ENV: 'local', PGHOST: DB.host, PGPORT: '5432',
    PGDATABASE: DB.database, PGUSER: DB.user, PGPASSWORD: 'TEST_ONLY_NOT_A_PASSWORD',
  };
  assert.doesNotThrow(() => guardEnvironment(env));
  for (const patch of [
    { APP_ENV: 'production' }, { PGHOST: 'example.invalid' },
    { PGDATABASE: 'artecnologia' }, { PGPORT: '5433' }, { PGUSER: 'postgres' },
  ]) {
    assert.throws(() => guardEnvironment({ ...env, ...patch }),
      { code: 'LOCAL_ENVIRONMENT_REQUIRED' });
  }
});

function fakeClient(initial = [], options = {}) {
  let saved = clone(initial), snapshot;
  const calls = [];
  return {
    calls, get saved() { return saved; },
    async query(sql, params = []) {
      calls.push(sql);
      if (sql === SQL.identity) return { rows: [{
        db: DB.database, role: DB.user, host: DB.host, port: DB.port,
      }] };
      if (sql.startsWith('BEGIN')) { snapshot = clone(saved); return { command: 'BEGIN' }; }
      if (sql.startsWith('SET LOCAL') || sql === SQL.lock) return {};
      if (sql === SQL.schema) return { rows: [{
        relkind: 'r', relrowsecurity: false, relhasrules: false,
        triggers: Boolean(options.triggers), fks: false, inheritance: false,
      }] };
      if (sql === SQL.records) return { rows: clone(saved).map((record) => ({ record })) };
      if (sql === SQL.total) return { rows: [{ n: saved.length }] };
      if (sql === SQL.insert) {
        const record = Object.fromEntries(COLUMNS.filter((c) => c !== 'import_batch_id')
          .map((c) => [c, ['raw_payload', 'warnings'].includes(c)
            ? JSON.parse(params[COLUMNS.indexOf(c)]) : params[COLUMNS.indexOf(c)]]));
        saved.push(record);
        return { rowCount: 1, rows: [{ legacy_key: record.legacy_key }] };
      }
      if (sql === 'ROLLBACK') {
        if (snapshot) saved = snapshot;
        snapshot = undefined; return { command: 'ROLLBACK' };
      }
      if (sql === 'COMMIT') {
        snapshot = undefined;
        if (options.failCommit) {
          options.failCommit = false;
          throw Object.assign(new Error('TEST_ONLY_SOCKET_LOST'), { code: 'ECONNRESET' });
        }
        return { command: 'COMMIT' };
      }
      assert.fail('SQL no autorizado por el doble: ' + sql);
    },
  };
}

test('aplicacion transaccional: 1002 inserts, despues 0 inserts/1002 coincidencias', async () => {
  const client = fakeClient();
  const first = await applyRecords(client, records);
  assert.equal(first.inserted, 1002);
  assert.equal(first.matched, 0);
  const second = await applyRecords(client, records);
  assert.equal(second.inserted, 0);
  assert.equal(second.matched, 1002);
  assert.equal(second.importBatchId, null);
  assert.equal(client.saved.length, 1002);
  assert.equal(client.calls.filter((s) => s === SQL.insert).length, 1002);
  assert.ok(client.calls.includes(SQL.lock));
  assert.ok(client.calls.every((s) =>
    !/\b(logistica_deliveries|logistica_delivery_evidence|logistica_authorized_users)\b/.test(s)));
  assert.ok(client.calls.every((s) => !/^\s*(UPDATE|DELETE|TRUNCATE)/i.test(s)));
});

test('misma legacy_key con content_hash distinto aborta antes de insertar', async () => {
  const changed = clone(row(831)); changed.content_hash = 'f'.repeat(64);
  const client = fakeClient([changed]);
  await assert.rejects(applyRecords(client, records),
    (e) => e.code === 'LEGACY_CONTENT_CONFLICT' && e.sourceRow === 831);
  assert.equal(client.calls.at(-1), 'ROLLBACK');
  assert.equal(client.calls.includes(SQL.insert), false);
  assert.deepEqual(client.saved, [changed]);
});

test('hash igual pero datos persistidos alterados tampoco se sobrescriben', async () => {
  const changed = { ...clone(row(128)), pedido: 'TEST_ONLY_CHANGED' };
  assert.throws(() => classifyRecords(records, [changed]), { code: 'LEGACY_ROW_CONFLICT' });
});

test('registros modificados en memoria se rechazan antes de cualquier SQL', async () => {
  const changed = clone(records); changed[0].pedido = 'TEST_ONLY_CHANGED';
  const client = fakeClient();
  await assert.rejects(applyRecords(client, changed),
    { code: 'RECORD_CHANGED_AFTER_NORMALIZATION' });
  assert.equal(client.calls.length, 0);
});

test('triggers imprevistos bloquean importacion para proteger tablas ajenas', async () => {
  const client = fakeClient([], { triggers: true });
  await assert.rejects(applyRecords(client, records), { code: 'UNSAFE_LEGACY_SCHEMA' });
  assert.equal(client.calls.includes(SQL.insert), false);
  assert.equal(client.calls.at(-1), 'ROLLBACK');
});

test('COMMIT ambiguo permite resolver por replay sin duplicar ni sobrescribir', async () => {
  const client = fakeClient([], { failCommit: true });
  await assert.rejects(applyRecords(client, records), { code: 'LEGACY_COMMIT_UNCERTAIN' });
  const replay = await applyRecords(client, records);
  assert.equal(replay.inserted, 0);
  assert.equal(replay.matched, 1002);
  assert.equal(client.saved.length, 1002);
});
