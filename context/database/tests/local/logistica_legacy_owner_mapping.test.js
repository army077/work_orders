import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Habilitacion explicita: RUN_LOGISTICA_LEGACY_OWNER_MAPPING_LOCAL_TESTS=1.
// Sin Firebase, Workspace, HTTP ni importadores. Fixtures ficticios con IDs
// negativos explicitos: no avanzan secuencias. Todos terminan en ROLLBACK.
const require = createRequire(new URL('../../../api10/package.json', import.meta.url));
const { Client } = require('pg');
const TABLE = 'public.logistica_legacy_owner_mapping';
const PROTECTED = [
  'entregas_logistica_legacy', 'logistica_deliveries',
  'logistica_delivery_evidence', 'logistica_authorized_users',
];
const sha = (data) => createHash('sha256').update(data).digest('hex');
async function protectedState(client) {
  const result = {};
  for (const table of PROTECTED) {
    const rows = (await client.query(
      'SELECT to_jsonb(t)::text AS data FROM public.' + table + ' t ORDER BY id',
    )).rows;
    result[table] = { rows: rows.length, sha256: sha(JSON.stringify(rows)) };
  }
  return result;
}

test('mapping legacy LOCAL: infraestructura vacia y aprobacion auditable', {
  skip: process.env.RUN_LOGISTICA_LEGACY_OWNER_MAPPING_LOCAL_TESTS !== '1',
}, async (t) => {
  assert.equal(process.env.APP_ENV, 'local');
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.PGHOST));
  assert.equal(process.env.PGPORT, '5432');
  assert.equal(process.env.PGDATABASE, 'artecnologia_test_local');
  assert.equal(process.env.PGUSER, 'workorders_test');
  assert.ok(process.env.PGPASSWORD);
  const client = new Client({
    host: '127.0.0.1', port: 5432, database: 'artecnologia_test_local',
    user: 'workorders_test', password: process.env.PGPASSWORD,
    ssl: false, connectionTimeoutMillis: 5000,
  });
  let open = false;
  try {
    await client.connect();
    assert.deepEqual((await client.query(
      'SELECT current_database() db,current_user role,host(inet_server_addr()) host,inet_server_port() port',
    )).rows[0], {
      db: 'artecnologia_test_local', role: 'workorders_test', host: '127.0.0.1', port: 5432,
    });
    const before = await protectedState(client);
    const exists = (await client.query("SELECT to_regclass('" + TABLE + "') AS name")).rows[0].name;
    if (!exists) {
      await client.query(readFileSync(new URL(
        '../../migrations/local/20261021_create_logistica_legacy_owner_mapping.sql',
        import.meta.url,
      ), 'utf8'));
    }
    const count = async (where = '', params = []) => Number((await client.query(
      'SELECT count(*)::int n FROM ' + TABLE + (where ? ' WHERE ' + where : ''), params,
    )).rows[0].n);
    await t.test('01 tabla vacia inmediatamente despues de migrar', async () => {
      assert.equal(await count(), 0);
    });
    assert.equal(await count(), 0, 'No ejecutar fixtures si existen mappings reales');
    await client.query('BEGIN');
    open = true;
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query('LOCK TABLE ' + TABLE
      + ', public.logistica_authorized_users, public.entregas_logistica_legacy'
      + ' IN SHARE ROW EXCLUSIVE MODE');
    const userA = (await client.query(
      'SELECT (LEAST(COALESCE(min(id),0),0)-1)::text id FROM public.logistica_authorized_users',
    )).rows[0].id;
    const userB = String(BigInt(userA) - 1n), missingUser = String(BigInt(userA) - 2n);
    const legacyId = (await client.query(
      'SELECT (LEAST(COALESCE(min(id),0),0)-1)::text id FROM public.entregas_logistica_legacy',
    )).rows[0].id;
    const scope = randomUUID();
    const email = 'test-only-owner-' + scope + '@example.invalid';
    for (const [id, suffix] of [[userA, 'A'], [userB, 'B']]) {
      await client.query('INSERT INTO public.logistica_authorized_users '
        + '(id,firebase_project,firebase_uid,email,display_name) VALUES($1,$2,$3,$4,$5)', [
        id, 'logistica-ar', 'TEST_ONLY_MAPPING_' + scope + suffix,
        suffix === 'A' ? email : 'test-only-other-' + scope + '@example.invalid',
        'TEST ONLY OWNER ' + suffix,
      ]);
    }
    // Solo una fila legacy FICTICIA temporal, nunca una de las nueve identidades.
    await client.query('INSERT INTO public.entregas_logistica_legacy '
      + '(id,source_snapshot_sha256,source_sheet,source_row,legacy_key,content_hash,'
      + 'usuario,correo,raw_payload,import_batch_id) VALUES($1,$2,$3,2,$4,$5,$6,$7,$8,$9)', [
      legacyId, 'e'.repeat(64), 'Entregas', sha(scope + ':legacy'), sha(scope + ':content'),
      '__TEST_ONLY_PERSON__', email, JSON.stringify({ test_only: true }), scope,
    ]);
    let nextId = -1;
    async function insert(patch = {}) {
      const record = {
        id: nextId--, source_snapshot_sha256: 'e'.repeat(64),
        source_sheet: '__TEST_ONLY_SCOPE_' + scope,
        legacy_usuario: '__TEST_ONLY_PERSON__', legacy_correo: email,
        authorized_user_id: userA,
        approval_basis: 'TEST ONLY: aprobacion ficticia para probar restricciones; ROLLBACK.',
        approved_by: 'TEST_ONLY_REVIEWER', ...patch,
      };
      const keys = Object.keys(record);
      return (await client.query('INSERT INTO ' + TABLE + ' AS m (' + keys.join(',')
        + ') VALUES (' + keys.map((_, i) => '$' + (i + 1)).join(',')
        + ') RETURNING to_jsonb(m) AS record', Object.values(record))).rows[0].record;
    }
    async function revoke(id, patch = {}) {
      const values = {
        is_active: false, revoked_by: 'TEST_ONLY_REVOKER',
        revocation_reason: 'TEST ONLY: revocacion explicita ficticia.', ...patch,
      };
      const keys = Object.keys(values);
      const stamp = Object.hasOwn(values, 'revoked_at') ? '' : 'revoked_at=clock_timestamp(),';
      return (await client.query('UPDATE ' + TABLE + ' AS m SET ' + stamp
        + keys.map((k, i) => k + '=$' + (i + 1)).join(',') + ' WHERE id=$'
        + (keys.length + 1) + ' RETURNING to_jsonb(m) AS record',
      [...Object.values(values), id])).rows[0].record;
    }
    async function rejects(work, code, constraint) {
      await client.query('SAVEPOINT expected_failure');
      let failure;
      try { await work(); } catch (error) { failure = error; }
      finally {
        await client.query('ROLLBACK TO SAVEPOINT expected_failure');
        await client.query('RELEASE SAVEPOINT expected_failure');
      }
      assert.ok(failure, 'La operacion debio ser rechazada');
      assert.equal(failure.code, code);
      if (constraint) assert.equal(failure.constraint, constraint);
    }
    async function check(name, work) {
      await t.test(name, async () => {
        await client.query('SAVEPOINT mapping_case');
        try { await work(); }
        finally {
          await client.query('ROLLBACK TO SAVEPOINT mapping_case');
          await client.query('RELEASE SAVEPOINT mapping_case');
        }
      });
    }
    await check('02 FK valida hacia allowlist con ON DELETE RESTRICT', async () => {
      const row = await insert();
      assert.equal(String(row.authorized_user_id), userA);
      const fk = (await client.query("SELECT confrelid::regclass::text target,confdeltype "
        + "FROM pg_constraint WHERE conrelid='" + TABLE + "'::regclass AND contype='f'")).rows;
      assert.equal(fk.length, 1);
      assert.ok(['logistica_authorized_users', 'public.logistica_authorized_users'].includes(fk[0].target));
      assert.equal(fk[0].confdeltype, 'r');
    });
    await check('03 authorized_user_id inexistente falla', async () => {
      await rejects(() => insert({ authorized_user_id: missingUser }), '23503',
        'logistica_legacy_owner_mapping_user_fk');
    });
    await check('04 primer mapping activo exacto funciona', async () => {
      const row = await insert();
      assert.equal(row.is_active, true);
      assert.equal(row.revoked_at, null);
      assert.equal(row.revoked_by, null);
      assert.equal(await count('is_active'), 1);
    });
    await check('05 segundo mapping activo exacto falla para otro destino', async () => {
      await insert();
      await rejects(() => insert({ authorized_user_id: userB }), '23505',
        'logistica_legacy_owner_mapping_active_uk');
    });
    await check('06 otro snapshot u otra hoja respeta el scope', async () => {
      await insert();
      await insert({ source_snapshot_sha256: 'f'.repeat(64) });
      await insert({ source_sheet: '__TEST_ONLY_OTHER_SHEET__' });
      assert.equal(await count('is_active'), 3);
    });
    await check('07 mismo destino recibe varias identidades distintas', async () => {
      await insert();
      await insert({ legacy_usuario: '__TEST_ONLY_OTHER_PERSON__' });
      assert.equal(await count('authorized_user_id=$1', [userA]), 2);
    });
    await check('08 nombres parecidos, mayusculas y acentos no se fusionan', async () => {
      for (const name of ['TEST_ONLY_Jose', 'TEST_ONLY_jose', 'TEST_ONLY_José']) {
        await insert({ legacy_usuario: name });
      }
      assert.equal(await count('is_active'), 3);
    });
    await check('09 mismo nombre y dos correos permanecen independientes', async () => {
      await insert();
      await insert({ legacy_correo: 'test-only-other@example.invalid' });
      assert.equal(await count('is_active'), 2);
    });
    await check('10 email exacto en legacy y allowlist NO crea mapping', async () => {
      const matches = (await client.query('SELECT count(*)::int n '
        + 'FROM public.entregas_logistica_legacy l '
        + 'JOIN public.logistica_authorized_users a ON a.email=l.correo '
        + 'WHERE l.id=$1 AND a.id=$2', [legacyId, userA])).rows[0].n;
      assert.equal(matches, 1);
      assert.equal(await count(), 0);
    });
    await check('11 revocacion conserva asignacion y aprobacion originales', async () => {
      const original = await insert(), revoked = await revoke(original.id);
      for (const key of ['id', 'source_snapshot_sha256', 'source_sheet', 'legacy_usuario',
        'legacy_correo', 'authorized_user_id', 'approval_basis', 'approved_by',
        'approved_at', 'created_at']) assert.deepEqual(revoked[key], original[key]);
      assert.equal(revoked.is_active, false);
      assert.ok(revoked.revoked_at);
      assert.equal(revoked.revoked_by, 'TEST_ONLY_REVOKER');
      assert.equal(revoked.revocation_reason, 'TEST ONLY: revocacion explicita ficticia.');
      assert.equal(await count(), 1);
    });
    await check('12 mapping revocado deja de contar como activo', async () => {
      const row = await insert(); await revoke(row.id);
      assert.equal(await count('is_active'), 0);
      assert.equal(await count('NOT is_active'), 1);
    });
    await check('13 revocar y aprobar otro destino conserva ambas filas', async () => {
      const original = await insert(); await revoke(original.id);
      const replacement = await insert({ authorized_user_id: userB });
      assert.equal(String(replacement.authorized_user_id), userB);
      assert.equal(await count(), 2);
      assert.equal(await count('is_active'), 1);
    });
    await check('14 approval_basis vacio, whitespace o NULL se rechaza', async () => {
      await rejects(() => insert({ approval_basis: null }), '23502');
      for (const basis of ['', '   ', '\t\n ']) {
        await rejects(() => insert({ approval_basis: basis }), '23514',
          'logistica_legacy_owner_mapping_basis_chk');
      }
    });
    await check('15 approved_by vacio o NULL se rechaza', async () => {
      await rejects(() => insert({ approved_by: null }), '23502');
      for (const approver of ['', '  ', '\t\n ']) {
        await rejects(() => insert({ approved_by: approver }), '23514',
          'logistica_legacy_owner_mapping_approver_chk');
      }
    });
    await check('16 revocacion requiere auditoria completa y fecha coherente', async () => {
      const row = await insert();
      for (const patch of [
        { revoked_by: null }, { revoked_by: ' ' }, { revocation_reason: null },
        { revocation_reason: '\t ' }, { revoked_at: null },
        { revoked_at: '2000-01-01T00:00:00Z' }, { revoked_at: '2100-01-01T00:00:00Z' },
        { revoked_at: 'infinity' },
      ]) {
        await rejects(() => revoke(row.id, patch), '23514',
          'logistica_legacy_owner_mapping_revocation_chk');
      }
      await rejects(() => client.query('UPDATE ' + TABLE
        + ' SET revoked_by=$1 WHERE id=$2', ['TEST_ONLY_REVOKER', row.id]), '23514');
    });
    await check('18 ninguna fila legacy genera mappings iniciales', async () => {
      assert.equal((await client.query(
        'SELECT count(*)::int n FROM public.entregas_logistica_legacy',
      )).rows[0].n, before.entregas_logistica_legacy.rows + 1);
      assert.equal(await count(), 0);
    });
    await check('19 fundamentos literales basados solo en identidad actual se rechazan', async () => {
      for (const basis of ['mismo correo', 'MISMO NOMBRE.', 'Firebase encontró el email',
        'Workspace tiene actualmente esa dirección']) {
        await rejects(() => insert({ approval_basis: basis }), '23514',
          'logistica_legacy_owner_mapping_weak_basis_chk');
      }
    });
    await check('20 no sobrescribir destino, identidad ni aprobacion', async () => {
      const row = await insert();
      for (const [column, value] of Object.entries({
        id: -999999999, source_snapshot_sha256: 'f'.repeat(64),
        source_sheet: 'TEST_ONLY_CHANGED', legacy_usuario: 'TEST_ONLY_CHANGED',
        legacy_correo: 'test-only-changed@example.invalid', authorized_user_id: userB,
        approval_basis: 'TEST ONLY: otro fundamento', approved_by: 'TEST_ONLY_CHANGED',
        approved_at: '2000-01-01T00:00:00Z', created_at: '2000-01-01T00:00:00Z',
      })) {
        await rejects(() => client.query('UPDATE ' + TABLE + ' SET ' + column
          + '=$1 WHERE id=$2', [value, row.id]), '23514',
        'logistica_legacy_owner_mapping_approval_guard');
      }
      await rejects(() => revoke(row.id, { authorized_user_id: userB }), '23514',
        'logistica_legacy_owner_mapping_approval_guard');
    });
    await check('21 revocado no se reactiva ni se edita su auditoria', async () => {
      const row = await insert(); await revoke(row.id);
      await rejects(() => client.query('UPDATE ' + TABLE
        + ' SET is_active=true,revoked_at=NULL,revoked_by=NULL,revocation_reason=NULL WHERE id=$1',
      [row.id]), '23514', 'logistica_legacy_owner_mapping_revoked_guard');
      await rejects(() => client.query('UPDATE ' + TABLE + ' SET revoked_by=$1 WHERE id=$2',
        ['TEST_ONLY_CHANGED', row.id]), '23514', 'logistica_legacy_owner_mapping_revoked_guard');
    });
    await check('22 DELETE no elimina historial activo ni revocado', async () => {
      const row = await insert();
      await rejects(() => client.query('DELETE FROM ' + TABLE + ' WHERE id=$1', [row.id]),
        '23514', 'logistica_legacy_owner_mapping_history_guard');
      await revoke(row.id);
      await rejects(() => client.query('DELETE FROM ' + TABLE + ' WHERE id=$1', [row.id]),
        '23514', 'logistica_legacy_owner_mapping_history_guard');
      assert.equal(await count(), 1);
    });
    await check('23 TRUNCATE no elimina auditoria', async () => {
      await insert();
      await rejects(() => client.query('TRUNCATE ' + TABLE), '23514',
        'logistica_legacy_owner_mapping_history_guard');
      assert.equal(await count(), 1);
    });
    await check('24 no insertar una aprobacion ya revocada', async () => {
      await rejects(() => insert({ is_active: false }), '23514',
        'logistica_legacy_owner_mapping_initial_guard');
    });
    await check('25 identidad exacta conserva espacios sin normalizar', async () => {
      await insert();
      await insert({ legacy_usuario: '__TEST_ONLY_PERSON__ ' });
      await insert({ legacy_correo: ' ' + email });
      assert.equal(await count('is_active'), 3);
    });
    await check('26 FK impide borrar usuario temporal referenciado', async () => {
      await insert();
      await rejects(() => client.query('DELETE FROM public.logistica_authorized_users WHERE id=$1',
        [userA]), '23503', 'logistica_legacy_owner_mapping_user_fk');
    });
    await check('27 updated_at no se edita solo; aprobacion futura se rechaza', async () => {
      const row = await insert();
      await rejects(() => client.query('UPDATE ' + TABLE
        + ' SET updated_at=clock_timestamp() WHERE id=$1', [row.id]), '23514',
      'logistica_legacy_owner_mapping_transition_guard');
      await rejects(() => insert({ legacy_usuario: 'TEST_ONLY_FUTURE',
        approved_at: '2100-01-01T00:00:00Z' }), '23514',
      'logistica_legacy_owner_mapping_time_chk');
    });
    await client.query('ROLLBACK');
    open = false;
    await t.test('17 rollback conserva cuatro tablas protegidas y cero mappings', async () => {
      assert.deepEqual(await protectedState(client), before);
      assert.equal(await count(), 0);
      console.log('PROTECTED_TABLES_UNCHANGED=true');
      console.log('INITIAL_AND_FINAL_MAPPINGS=0');
    });
  } finally {
    if (open) {
      try { await client.query('ROLLBACK'); } catch { /* Cerrar conexion revierte fixtures. */ }
    }
    await client.end();
  }
});
