// Fresh-install simulation: empty APPDATA folder (no POS subfolder at all),
// server must create everything itself and answer /api/users/check.
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const PORT = 18234;
const sandbox = path.join(os.tmpdir(), 'pos-fresh-' + Date.now());
fs.mkdirSync(sandbox, { recursive: true });

const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: Object.assign({}, process.env, { APPDATA: sandbox, PORT: String(PORT) }),
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
child.stdout.on('data', d => { log += d; });
child.stderr.on('data', d => { log += d; });

function get(p) {
  return new Promise(resolve => {
    http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 5000 }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    }).on('error', e => resolve({ error: e.message }))
      .on('timeout', function () { this.destroy(); resolve({ error: 'timeout' }); });
  });
}

(async () => {
  const t0 = Date.now();
  let rootRes = null;
  while (Date.now() - t0 < 15000) {
    rootRes = await get('/');
    if (rootRes.status === 200) break;
    await new Promise(r => setTimeout(r, 400));
  }
  console.log('ROOT:', JSON.stringify(rootRes));
  const check = await get('/api/users/check');
  console.log('CHECK:', check.status, (check.body || '').slice(0, 80));
  const inv = await get('/api/inventory/products');
  console.log('PRODUCTS:', inv.status, (inv.body || '').slice(0, 40));
  try {
    const files = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f); else files.push(f.slice(sandbox.length));
      }
    })(sandbox);
    console.log('CREATED FILES:', JSON.stringify(files));
  } catch (e) { console.log('WALK ERR', e.message); }
  const ok = rootRes && rootRes.status === 200 && check.status === 200 && inv.status === 200;
  console.log(ok ? 'FRESH-INSTALL TEST PASSED' : 'FRESH-INSTALL TEST FAILED');
  console.log('--- server log ---\n' + log);
  child.kill();
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (e) {}
  process.exit(ok ? 0 : 1);
})();
