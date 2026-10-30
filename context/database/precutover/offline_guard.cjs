// Test preload only. A caught network attempt still fails the offline process.
let attempts = 0;
const denied = () => { attempts++; throw new Error('OFFLINE_NETWORK_FORBIDDEN'); };
require('node:net').Socket.prototype.connect = denied;
require('node:tls').connect = denied;
globalThis.fetch = denied;
process.on('beforeExit', () => { if (attempts) process.exitCode = 1; });
