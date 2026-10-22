const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');

// Prueba real de handlers/repositorios contra UN SOLO cliente calidad_test_local.
// Firebase/Drive simulados; sin HTTP ni red externa. Datos bajo ROLLBACK.
test('API10 sobre calidad_test_local: auth, alta, evidencias, cierre e historico', {
  skip: process.env.RUN_CALIDAD_API_TESTS !== '1',
}, async t => {
  const { connectLocal, DESTINATION, sourceState } = await import('../../database/transfer_calidad/local_support.mjs');
  const { inspectSchema, TABLES } = await import('../../database/migrations/prod/logistica_prod_support.js');
  const { snapshotFixture } = await import('../../database/tests/prod/snapshot_fixture.js');
  const { parseSnapshot } = await import('../../database/importers/import_entregas_logistica_prod.js');
  const { reconcileInTransaction } = await import('../../database/importers/apply_entregas_logistica_prod.js');
  const client = await connectLocal(DESTINATION);
  const tables = TABLES.slice(0, 5).map(n => 'public.' + n);
  let before;
  try {
    const schema = await inspectSchema(client);
    assert.equal(schema.stage, 7); assert.equal(schema.drift, false);
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query('LOCK TABLE ' + tables.join(',') + ' IN SHARE ROW EXCLUSIVE MODE');
    before = await sourceState(client, tables);
    for (const value of Object.values(before)) assert.equal(value.count, '0', 'Solo fixtures en destino aislado vacio');
    let savepoint = 0;
    const pool = {
      query: (...args) => client.query(...args),
      async connect() {
        const adapter = new EventEmitter();
        let name;
        adapter.release = () => {};
        adapter.query = async (sql, args) => {
          if (/^BEGIN\b/.test(sql)) { name = 'api_fixture_' + (++savepoint); return client.query('SAVEPOINT ' + name); }
          if (sql === 'COMMIT') { await client.query('RELEASE SAVEPOINT ' + name); return { command: 'COMMIT' }; }
          if (sql === 'ROLLBACK') { await client.query('ROLLBACK TO SAVEPOINT ' + name); await client.query('RELEASE SAVEPOINT ' + name); return { command: 'ROLLBACK' }; }
          return client.query(sql, args);
        };
        return adapter;
      },
    };
    const driveCalls = [], drive = {
      async generateDriveId() { return 'TEST_ONLY_NO_DRIVE_' + randomUUID(); },
      async ensureDeliveryFolder(value) { driveCalls.push(['folder', value.id]); },
      async uploadEvidenceWithId(value) { driveCalls.push(['upload', value.id]); },
    };
    const routerPath = require.resolve('../routes/logisticaDeliveries');
    const authPath = require.resolve('../auth/requireLogisticaFirebaseAuth');
    const allowPath = require.resolve('../auth/requireLogisticaAuthorizedUser');
    const paths = [routerPath, authPath, allowPath], cached = paths.map(p => require.cache[p]);
    const load = Module._load;
    let router;
    paths.forEach(p => { delete require.cache[p]; });
    try {
      Module._load = function (name, parent, isMain) {
        if (name === '../db' && [routerPath, allowPath].includes(parent?.filename)) return pool;
        if (name === '../integrations/logisticaDrive' && parent?.filename === routerPath) return drive;
        if (name === './firebaseLogistica' && parent?.filename === authPath) return {
          EXPECTED_PROJECT: 'logistica-ar', getLogisticaAuth: () => ({ async verifyIdToken(token) {
            if (!['TEST_ONLY_A', 'TEST_ONLY_B', 'TEST_ONLY_UNKNOWN'].includes(token)) throw new Error('TEST_ONLY_INVALID_TOKEN');
            return { aud: 'logistica-ar', uid: token };
          } }),
        };
        return load.call(this, name, parent, isMain);
      };
      router = require(routerPath);
    } finally {
      Module._load = load;
      paths.forEach((p, i) => { if (cached[i]) require.cache[p] = cached[i]; else delete require.cache[p]; });
    }
    async function invoke(path, method, { token = 'TEST_ONLY_A', body, params = {}, query = {}, file } = {}) {
      const route = router.stack.find(l => l.route?.path === path && l.route.methods[method]).route;
      assert.deepEqual(route.stack.slice(0, 2).map(l => l.handle.name), ['requireLogisticaFirebaseAuth', 'requireLogisticaAuthorizedUser']);
      const req = { method: method.toUpperCase(), params, query, body, file,
        headers: token ? { authorization: 'Bearer ' + token } : {}, is: () => true };
      const res = { code: 200, headers: {}, status(n) { this.code = n; return this; },
        json(value) { this.body = value; return this; }, set(k, value) { this.headers[k] = value; return this; } };
      for (const layer of route.stack) {
        // Multipart se prueba con streams en la suite existente. Aqui pasan los
        // bytes por validateEvidenceInput real y todo el repository PostgreSQL.
        if (layer.handle.name === 'parseEvidenceMultipart') continue;
        let next = false;
        await layer.handle(req, res, () => { next = true; });
        if (!next) break;
      }
      return res;
    }
    for (const [id, uid] of [['8000000000000000001', 'TEST_ONLY_A'], ['8000000000000000002', 'TEST_ONLY_B']]) {
      await client.query("INSERT INTO public.logistica_authorized_users(id,firebase_project,firebase_uid,email,display_name) VALUES($1,'logistica-ar',$2,'TEST_ONLY@example.invalid','TEST_ONLY')", [id, uid]);
    }
    let delivery;
    await t.test('auth y allowlist reales con verificador Firebase aislado', async () => {
      for (const token of [null, 'INVALID']) assert.equal((await invoke('/entregas', 'get', { token })).code, 401);
      assert.equal((await invoke('/entregas', 'get', { token: 'TEST_ONLY_UNKNOWN' })).code, 403);
      await client.query("UPDATE public.logistica_authorized_users SET is_active=false WHERE firebase_uid='TEST_ONLY_B'");
      assert.equal((await invoke('/entregas', 'get', { token: 'TEST_ONLY_B' })).code, 403);
      await client.query("UPDATE public.logistica_authorized_users SET is_active=true WHERE firebase_uid='TEST_ONLY_B'");
    });
    await t.test('crear entrega e idempotencia en SQL real', async () => {
      const body = { client_request_id: randomUUID(), pedido: 'TEST_ONLY_REHEARSAL', equipos: 'TEST_ONLY', chofer: 'TEST_ONLY', latitude: 20, longitude: -103 };
      const created = await invoke('/entregas', 'post', { body });
      assert.equal(created.code, 201); assert.equal(created.body.delivery.status, 'PENDING_EVIDENCE');
      delivery = created.body.delivery;
      const replay = await invoke('/entregas', 'post', { body });
      assert.equal(replay.code, 200); assert.equal(replay.body.delivery.id, delivery.id);
      assert.equal((await invoke('/entregas', 'post', { body, token: 'TEST_ONLY_B' })).code, 409);
    });
    await t.test('evidencias PHOTO/SIGNATURE con repository real y Drive aislado', async () => {
      assert.ok(delivery);
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex');
      const params = { id: delivery.id };
      assert.equal((await invoke('/entregas/:id/finalizar', 'post', { params })).code, 409);
      for (const evidence_type of ['PHOTO', 'SIGNATURE']) {
        const input = { params, body: { client_evidence_id: randomUUID(), evidence_type }, file: { fieldname: 'file', mimetype: 'image/png', buffer: png } };
        assert.equal((await invoke('/entregas/:id/evidencias', 'post', { ...input, token: 'TEST_ONLY_B' })).code, 403);
        const result = await invoke('/entregas/:id/evidencias', 'post', input);
        assert.equal(result.code, 201); assert.equal(result.body.evidence.status, 'UPLOADED');
        assert.equal((await invoke('/entregas/:id/evidencias', 'post', input)).code, 200);
      }
      assert.equal(driveCalls.filter(c => c[0] === 'upload').length, 2);
    });
    await t.test('finalizar valida evidencias, ownership e idempotencia', async () => {
      const params = { id: delivery.id };
      assert.equal((await invoke('/entregas/:id/finalizar', 'post', { params, token: 'TEST_ONLY_B' })).code, 403);
      const result = await invoke('/entregas/:id/finalizar', 'post', { params });
      assert.equal(result.code, 200); assert.equal(result.body.delivery.status, 'COMPLETED');
      assert.equal((await invoke('/entregas/:id/finalizar', 'post', { params })).body.idempotent_replay, true);
    });
    await t.test('listado actual filtra COMPLETED por propietario', async () => {
      const a = await invoke('/entregas', 'get'), b = await invoke('/entregas', 'get', { token: 'TEST_ONLY_B' });
      assert.equal(a.code, 200); assert.equal(a.body.items.length, 1); assert.equal(a.body.items[0].photo_count, 1);
      assert.equal(b.body.items.length, 0);
    });
    let legacy;
    await t.test('historico usa solo snapshot fixture conocido y no autoasigna ownership', async () => {
      const fixture = snapshotFixture(), parsed = parseSnapshot(fixture.bytes, fixture.approval);
      assert.equal((await reconcileInTransaction(client, parsed)).inserted, 3);
      legacy = (await client.query('SELECT * FROM public.entregas_logistica_legacy ORDER BY source_row LIMIT 1')).rows[0];
      const result = await invoke('/entregas/historial', 'get');
      assert.equal(result.code, 200); assert.equal(result.body.current.items.length, 1); assert.equal(result.body.legacy.items.length, 0);
      assert.equal((await client.query('SELECT count(*)::int n FROM public.logistica_legacy_owner_mapping')).rows[0].n, 0);
    });
    await t.test('mapping TEST_ONLY manual y revocacion; RECORDED sin timezone ni imagenes inventadas', async () => {
      await client.query(`INSERT INTO public.logistica_legacy_owner_mapping
        (source_snapshot_sha256,source_sheet,legacy_usuario,legacy_correo,authorized_user_id,approval_basis,approved_by)
        VALUES($1,$2,$3,$4,8000000000000000001,'TEST_ONLY: fixture sintetico conocido','TEST_ONLY_AUTOMATED_FIXTURE')`,
      [legacy.source_snapshot_sha256, legacy.source_sheet, legacy.usuario, legacy.correo]);
      const result = await invoke('/entregas/historial', 'get');
      const item = result.body.legacy.items.find(r => r.id === legacy.legacy_key);
      assert.ok(item); assert.equal(item.legacy_record_state, 'RECORDED'); assert.equal(item.status, null);
      assert.equal(item.time_zone, null); assert.equal(item.legacy_image_count, 17); assert.equal(item.photo_count, null);
      assert.equal(item.recorded_local_at, '2025-01-01T13:02:03');
      assert.equal((await invoke('/entregas/historial', 'get', { token: 'TEST_ONLY_B' })).body.legacy.items.length, 0);
      await client.query("UPDATE public.logistica_legacy_owner_mapping SET is_active=false,revoked_at=clock_timestamp(),revoked_by='TEST_ONLY',revocation_reason='TEST_ONLY fixture revocation'");
      assert.equal((await invoke('/entregas/historial', 'get')).body.legacy.items.length, 0);
    });
  } finally {
    await client.query('ROLLBACK');
    try {
      if (before) {
        const after = await sourceState(client, tables);
        for (const table of tables) {
          assert.equal(after[table].count, before[table].count);
          assert.equal(after[table].digest, before[table].digest);
        }
      }
    } finally { await client.end(); }
  }
});
