import {
  TARGET_ARGS,TABLES,options,targetFromOptions,connectProduction,isMain,safeFailure,
  identitySql,matchesTarget,inspectSchema,schemaState,
} from './logistica_prod_support.js';

// Esta funcion solo usa catalogos/SELECT dentro de una transaccion READ ONLY.
export async function readOnlyPreflight(client,target) {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query('SET LOCAL search_path = pg_catalog');
    await client.query("SET LOCAL statement_timeout = '15s'");
    const identity=(await client.query(identitySql)).rows[0];
    const actual=await schemaState(client);
    const counts={};
    for(const name of TABLES) {
      // No ejecutar vistas ni objetos desconocidos que puedan contener funciones.
      if(actual.shape.tables[name]?.kind==='r') {
        counts[name]=(await client.query('SELECT count(*)::text AS n FROM public.'+name)).rows[0].n;
      }
    }
    let state, conflict=null;
    try { state=await inspectSchema(client); }
    catch(error) { conflict=/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'SCHEMA_INSPECTION_FAILED'; }
    return {
      database_correct:matchesTarget(identity,target), current_user:identity.username,
      postgresql_version:identity.version,
      tables:TABLES.filter(n=>actual.shape.tables[n]!==null), counts,
      evidence_rows:counts.logistica_delivery_evidence??null,
      column_conflicts:state?.conflictingColumns??null, schema_drift:state?.drift??true,
      migration_conflict:conflict, migrations:state?.ledger??[],
      next_migration_index:state?.stage??null,
      go:matchesTarget(identity,target)&&Boolean(state)&&!state.drift,
    };
  } finally { await client.query('ROLLBACK'); }
}
async function main() {
  const target=targetFromOptions(options(process.argv.slice(2),TARGET_ARGS));
  const client=await connectProduction(target);
  try {
    const report=await readOnlyPreflight(client,target);
    console.log(JSON.stringify(report,null,2));
    if(!report.go) process.exitCode=1;
  } finally { await client.end(); }
}
if(isMain(import.meta.url)) main().catch(safeFailure);
