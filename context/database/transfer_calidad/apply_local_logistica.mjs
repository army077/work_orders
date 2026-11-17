// Harness exclusivo de ensayo. Nunca modifica SQL PROD ni suplanta current_database().
import assert from 'node:assert/strict';
import { artifacts, inspectSchema, requireNextMigration, invariant } from '../migrations/prod/logistica_prod_support.js';
import { assertLocalConfig, DESTINATION } from './local_support.mjs';
import { createHash } from 'node:crypto';

export async function applyLocalLogistica(client) {
  assertLocalConfig();
  const { rows: [id] } = await client.query("SELECT current_database() db,current_user username,session_user session_user,"
    + "host(inet_server_addr()) address,inet_server_port() port,current_setting('server_version_num')::int version");
  invariant(id.db === DESTINATION && id.username === 'workorders_test' && id.session_user === id.username
    && id.address === '127.0.0.1' && id.port === 5432 && Math.floor(id.version / 10000) === 16, 'LOCAL_DESTINATION_REQUIRED');
  const files = artifacts(), records = [];
  for (const file of files) {
    // Los siete artefactos completos deben rechazar la base local antes del DDL.
    try {
      await assert.rejects(() => client.query(file.sql), e => e.code === 'P0001' && e.message === 'PROD_IDENTITY_OR_APPROVAL_REQUIRED');
    } finally { await client.query('ROLLBACK'); }
  }
  let state = await inspectSchema(client);
  invariant(!state.drift, 'LOCAL_SCHEMA_DRIFT');
  for (let i = state.stage; i < files.length; i++) {
    const file = requireNextMigration(state, files[i].name, files);
    const start = file.sql.indexOf('SELECT pg_advisory_xact_lock(');
    invariant(start > file.sql.indexOf('$guard$;'), 'PROD_ARTIFACT_LAYOUT_CHANGED');
    // Mismo DDL, locks, dos guards de forma, guard de ledger e INSERT del artefacto.
    // La identidad PROD se prueba arriba; aqui se sustituye SOLO por una identidad
    // LOCAL fija en memoria. No se cambia el archivo fuente ni el runner PROD.
    const submitted = `BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $local_guard$ BEGIN
  IF current_database() IS DISTINCT FROM 'calidad_test_local'
    OR current_user IS DISTINCT FROM 'workorders_test' OR current_user IS DISTINCT FROM session_user
    OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
    OR inet_server_port() IS DISTINCT FROM 5432
    OR current_setting('server_version_num')::int / 10000 <> 16
  THEN RAISE EXCEPTION 'LOCAL_DESTINATION_REQUIRED'; END IF;
END $local_guard$;
` + file.sql.slice(start);
    // El ledger LOCAL referencia el artefacto fuente para verificar su linaje.
    // No declara que se hayan ejecutado los bytes completos PROD; se registran
    // separadamente fuente y bytes efectivamente enviados en el reporte LOCAL.
    await client.query("SELECT set_config('logistica.migration_sha256',$1,false)", [file.sha256]);
    try {
      const result = await client.query(submitted);
      invariant(result.at(-1).command === 'COMMIT', 'LOCAL_COMMIT_NOT_CONFIRMED');
      state = await inspectSchema(client);
      invariant(!state.drift && state.stage === i + 1, 'LOCAL_STAGE_MISMATCH');
      records.push({ name: file.name, source_sha256: file.sha256,
        submitted_sha256: createHash('sha256').update(Buffer.from(submitted)).digest('hex'),
        production_sql_executed: false, stage: state.stage, fingerprint: state.fingerprint });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
  return { stage: state.stage, drift: state.drift, fingerprint: state.fingerprint, ledger: state.ledger, records };
}
