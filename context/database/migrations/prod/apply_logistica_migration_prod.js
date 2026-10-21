import {
  TARGET_ARGS,options,targetFromOptions,connectProduction,isMain,safeFailure,
  artifacts,inspectSchema,configureMigration,requireNextMigration,invariant,
} from './logistica_prod_support.js';

async function inspectReadOnly(client) {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query('SET LOCAL search_path = pg_catalog');
    return await inspectSchema(client);
  } finally { await client.query('ROLLBACK'); }
}
export async function applyMigration(client,target,name) {
  const files=artifacts(); // Hash de los mismos bytes que se enviaran a PG.
  const file=requireNextMigration(await inspectReadOnly(client),name,files);
  await configureMigration(client,target,file);
  let submitted=false;
  try {
    submitted=true;
    const results=await client.query(file.sql);
    invariant(results.at(-1)?.command==='COMMIT','MIGRATION_COMMIT_NOT_CONFIRMED');
    const after=await inspectReadOnly(client);
    invariant(!after.drift&&after.stage===files.findIndex(f=>f.name===name)+1,
      'POST_MIGRATION_VERIFICATION_FAILED');
    return {migration_name:name,migration_sha256:file.sha256,applied:true};
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    // Una perdida de conexion puede ocurrir despues del COMMIT: no autoreintentar.
    if(submitted&&!error.code) error.code='MIGRATION_OUTCOME_UNCERTAIN';
    throw error;
  }
}
async function main() {
  const opts=options(process.argv.slice(2),[...TARGET_ARGS,'--migration']);
  const target=targetFromOptions(opts);
  invariant(typeof opts['--migration']==='string','MIGRATION_REQUIRED');
  const client=await connectProduction(target);
  try { console.log(JSON.stringify(await applyMigration(client,target,opts['--migration']))); }
  finally { await client.end(); }
}
if(isMain(import.meta.url)) main().catch(safeFailure);
