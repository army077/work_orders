// Administrative preparation, Node 18 compatible. Importing performs no I/O.
// Never imports server.js or a DB module. Never writes credentials or files.
const fs = require('node:fs');
const path = require('node:path');
const { createPrivateKey } = require('node:crypto');

const present = value => typeof value === 'string' && value.trim() !== '';
function readObject(file, readFile) {
  if (!present(file) || !path.isAbsolute(file)) throw new Error('INVALID_CONFIG');
  const value = JSON.parse(readFile(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CONFIG');
  return value;
}

function checkLocalConfiguration({ env = process.env, readFile = fs.readFileSync,
  parsePrivateKey = createPrivateKey } = {}) {
  const pg = env.APP_ENV === 'production' && env.PGDATABASE === 'calidad'
    && ['PGHOST', 'PGUSER', 'PGPASSWORD'].every(name => present(env[name]))
    && /^[0-9]+$/.test(env.PGPORT || '') && Number(env.PGPORT) >= 1 && Number(env.PGPORT) <= 65535;
  let firebase = false, drive = false;
  try {
    const account = readObject(env.GOOGLE_APPLICATION_CREDENTIALS, readFile);
    firebase = env.FIREBASE_LOGISTICA_PROJECT_ID === 'logistica-ar'
      && account.type === 'service_account' && present(account.project_id)
      && present(account.client_email) && present(account.private_key);
    if (firebase) parsePrivateKey(account.private_key);
  } catch (_error) { firebase = false; }
  try {
    const credentials = readObject(env.LOGISTICA_DRIVE_OAUTH_CREDENTIALS_PATH, readFile);
    const token = readObject(env.LOGISTICA_DRIVE_TOKEN_PATH, readFile);
    const oauth = credentials.installed || credentials.web;
    drive = !!oauth && present(oauth.client_id) && present(oauth.client_secret)
      && present(token.refresh_token) && present(env.LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID)
      && /^[A-Za-z0-9_-]+$/.test(env.LOGISTICA_DRIVE_PEDIDOS_FOLDER_ID.trim());
  } catch (_error) { drive = false; }
  return { PG_CONFIG_LOCAL_OK: !!pg, FIREBASE_CONFIG_LOCAL_OK: !!firebase,
    DRIVE_LOCAL_CONFIG_OK: !!drive };
}

async function checkDriveReadOnly({ getClient, getRootFolderId }) {
  try {
    const { data } = await getClient().files.get({
      fileId: getRootFolderId(),
      fields: 'mimeType,trashed,capabilities(canAddChildren)',
      supportsAllDrives: true,
    }, { timeout: 45000, retry: false });
    return !!data && data.mimeType === 'application/vnd.google-apps.folder'
      && data.trashed === false && data.capabilities?.canAddChildren === true;
  } catch (_error) { return false; }
}

async function main(args, { env = process.env, output = console.log,
  load = require, inspectLocal = checkLocalConfiguration } = {}) {
  const local = args.length === 1 && args[0] === '--local-config';
  const drive = args.length === 3 && args[0] === '--drive-readonly'
    && args[1] === '--api-dir' && path.isAbsolute(args[2]);
  if (!local && !drive) { output('PREFLIGHT_ARGS_OK = NO'); return 1; }
  const flags = inspectLocal({ env });
  if (local) {
    for (const [name, value] of Object.entries(flags)) output(`${name} = ${value ? 'SI' : 'NO'}`);
    return Object.values(flags).every(Boolean) ? 0 : 1;
  }
  let ok = false;
  if (flags.DRIVE_LOCAL_CONFIG_OK) {
    try {
      const integration = load(path.join(args[2], 'integrations', 'logisticaDrive.js'));
      ok = await checkDriveReadOnly({ getClient: integration.getLogisticaDriveClient,
        getRootFolderId: integration.getPedidosFolderId });
    } catch (_error) { /* Never disclose provider errors, paths, IDs or tokens. */ }
  }
  output(`DRIVE_CONFIG_OK = ${ok ? 'SI' : 'NO'}`);
  return ok ? 0 : 1;
}

module.exports = { checkLocalConfiguration, checkDriveReadOnly, main };
if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
    console.log('PREFLIGHT_CONFIG_OK = NO'); process.exitCode = 1;
  });
}
