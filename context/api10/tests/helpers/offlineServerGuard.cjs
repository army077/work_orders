// Preload only for the isolated HTTP startup smoke test. No outbound connections.
if (process.env.APP_ENV !== 'test' || process.env.PGDATABASE !== 'artecnologia_test'
  || process.env.PGHOST !== '127.0.0.1') throw new Error('OFFLINE_TEST_ENV_REQUIRED');
require('node:net').Socket.prototype.connect = function () { throw new Error('OUTBOUND_NETWORK_FORBIDDEN'); };
