// Dependency-injected orchestration. This module cannot open a connection.
export async function withExportedSnapshot(client, operation) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const identity=(await client.query("SELECT current_database() AS database,current_setting('server_version_num')::int AS version_num")).rows[0];
    if(identity.database!=='artecnologia'||Math.floor(identity.version_num/10000)!==16) throw new Error('SOURCE_IDENTITY_MISMATCH');
    const exported=(await client.query('SELECT pg_export_snapshot() AS snapshot_id,transaction_timestamp()::text AS started_at')).rows[0];
    if(!/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$/.test(exported.snapshot_id)) throw new Error('SNAPSHOT_ID_INVALID');
    return await operation({snapshot_id:exported.snapshot_id,started_at:exported.started_at,strategy:'SNAPSHOT_CON_DELTA'});
  } finally { await client.query('ROLLBACK'); }
}
