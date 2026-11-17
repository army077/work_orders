import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../dist/v2/', import.meta.url));
const base = '/work-orders-v2/';
const html = await readFile(path.join(root, 'index.html'), 'utf8');
assert.ok(!html.includes('%BASE_URL%'));
const resources = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]).filter(url => !url.startsWith('https:'));
for (const resource of resources) {
  assert.ok(resource.startsWith(base), 'Resource outside V2: ' + resource);
  const file = await stat(path.join(root, decodeURIComponent(resource.slice(base.length))));
  assert.ok(file.isFile());
}
await stat(path.join(root, 'AR LOGO.png'));
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(new URL(manifest.start_url, 'https://host.invalid' + base + 'manifest.json').pathname, base);
for (const icon of manifest.icons) await stat(path.join(root, icon.src));
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(filename);
    else {
      assert.ok(!/^\.env|\.map$|\.(?:sql|pem|key|p12|pfx)$|credentials|service.?account/i.test(entry.name), 'Private/source file in build');
      const bytes = await readFile(filename);
      files.push({ file: path.relative(root, filename).replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      if (/\.(?:js|html|json|css)$/.test(entry.name)) {
        const content = bytes.toString('utf8');
        assert.ok(!/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|"private_key"\s*:|"client_secret"\s*:|postgres(?:ql)?:\/\//i.test(content), 'Secret material in build');
        assert.ok(!/https?:\/\/[^\s"'`]+\/api(?:10|5)(?:[\/"'?\s]|$)/.test(content), 'Legacy API URL in build');
      }
    }
  }
}
await walk(root);
const bundle = (await Promise.all(files.filter(f => f.file.endsWith('.js')).map(f => readFile(path.join(root, f.file), 'utf8')))).join('\n');
assert.ok(bundle.includes('https://desarrollotecnologicoar.com/api27'));
assert.ok(bundle.includes(base));
assert.ok(bundle.includes('AR LOGO.png'));
assert.ok(!bundle.includes('ordentrabajoar.firebaseapp.com'), 'Disabled Firebase code included');
console.log(JSON.stringify({ build: root, base, api: 'https://desarrollotecnologicoar.com/api27', resourcesChecked: resources.length, files }, null, 2));
