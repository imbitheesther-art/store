// Live end-to-end smoke test for the real Electron app (start.js).
//
// Launches the app with remote debugging enabled and verifies:
//   1. the local API server answers on port 8001
//   2. the renderer bundle actually booted (storage/auth globals exist)
//   3. the password screen is SHOWN when nobody is logged in
//   4. logging in as admin/admin stores the session and reloads into the POS
//   5. a product can be created and deleted through the live API
//
// Any %APPDATA%\POS\config.json written by this test is removed at the end so
// the next real launch asks for a password again.
//
// Run with: node tools\e2e-app-check.js

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const API = 'http://localhost:8001';
const DEBUG_PORT = 9333;
const CONFIG_FILES = [
    path.join(process.env.APPDATA, 'POS', 'config.json'),      // packaged app
    path.join(process.env.APPDATA, 'Electron', 'config.json')   // `npm run electron` dev run
];
const clearConfig = () => CONFIG_FILES.forEach((f) => { try { fs.unlinkSync(f); } catch (e) { /* gone */ } });

let failures = 0;
const pass = (m) => console.log('PASS  ' + m);
const fail = (m) => { failures++; console.log('FAIL  ' + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, url, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, { method, timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('request timeout')));
        if (body !== undefined) {
            req.setHeader('Content-Type', 'application/json');
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// --- minimal Chrome DevTools Protocol client -------------------------------
function cdp(ws) {
    let nextId = 0;
    const pending = new Map();

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }
        if (msg.id && pending.has(msg.id)) {
            const entry = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? entry.reject(new Error(JSON.stringify(msg.error))) : entry.resolve(msg.result);
        }
    });

    return {
        send(method, params) {
            return new Promise((resolve, reject) => {
                const id = ++nextId;
                pending.set(id, { resolve, reject });
                ws.send(JSON.stringify({ id, method, params: params || {} }));
                setTimeout(() => {
                    if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' timed out')); }
                }, 10000);
            });
        },
        async evaluate(expression) {
            const r = await this.send('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: true
            });
            if (r.exceptionDetails) {
                throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
            }
            return r.result && r.result.value;
        }
    };
}

async function findPage() {
    for (let i = 0; i < 60; i++) {
        try {
            const list = JSON.parse(await request('GET', `http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.body));
            const page = list.find((t) => t.type === 'page');
            if (page) return page;
        } catch (e) { /* app not up yet */ }
        await sleep(500);
    }
    throw new Error('the Electron window never appeared');
}

async function connect() {
    const target = await findPage();
    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });
    return { ws, client: cdp(ws) };
}

async function waitFor(client, expression, label, attempts) {
    for (let i = 0; i < (attempts || 20); i++) {
        try {
            if (await client.evaluate(expression)) return true;
        } catch (e) { /* page may be mid-reload */ }
        await sleep(500);
    }
    fail(label);
    return false;
}

(async function main() {
    console.log('--- live Electron app check ---');

    // Fresh state: no saved session, otherwise the login screen is skipped.
    clearConfig();

    const electronCmd = path.join(ROOT, 'node_modules', '.bin', 'electron.cmd');
    // VS Code shells export ELECTRON_RUN_AS_NODE=1, which would make Electron
    // boot as plain Node (start.js relaunches itself, but strip it up front).
    const env = Object.assign({}, process.env);
    delete env.ELECTRON_RUN_AS_NODE;
    const electron = spawn(
        process.platform === 'win32' ? 'cmd' : 'electron',
        process.platform === 'win32'
            ? ['/c', electronCmd, 'start.js', `--remote-debugging-port=${DEBUG_PORT}`]
            : [electronCmd, 'start.js', `--remote-debugging-port=${DEBUG_PORT}`],
        { cwd: ROOT, detached: true, stdio: 'ignore', env: env }
    );

    let conn = null;
    let loginSeen = false;

    try {
        await sleep(2000);

        // 1. API server inside the app process (it may need a moment to bind).
        let apiUp = false;
        for (let attempt = 0; attempt < 15 && !apiUp; attempt++) {
            try {
                const root = await request('GET', API + '/');
                if (root.body.indexOf('POS Server Online') >= 0) {
                    apiUp = true;
                    pass('API server is up on port 8001');
                } else {
                    fail('unexpected API response: ' + root.body);
                    apiUp = true;
                }
            } catch (e) {
                await sleep(1000);
            }
        }
        if (!apiUp) fail('API server unreachable on port 8001 after 15s');

        // 2./3. Renderer booted and login screen visible.
        conn = await connect();
        if (await waitFor(conn.client, "document.readyState === 'complete' && !!(document.querySelector('#reportrange span') || {}).textContent", 'renderer bundle never booted', 30)) {
            pass('renderer bundle booted (pos.js populated the date range)');
        }

        // NOTE: pos.js runs inside require()'s module scope, so its `auth`/
        // `storage` globals are invisible to DevTools. Ask the main process
        // over IPC and inspect the DOM instead.
        const state = await conn.client.evaluate(`JSON.stringify({
            auth: require('electron').ipcRenderer.sendSync('storage-get', 'auth'),
            loginForm: !!document.querySelector('#account'),
            loadingShown: (function () {
                var el = document.querySelector('#loading');
                return !!el && getComputedStyle(el).display !== 'none';
            })(),
            loggedin: (document.querySelector('#loggedin-user') || {}).textContent || ''
        })`).then(JSON.parse);

        if (state.auth === undefined && state.loginForm && state.loadingShown) {
            loginSeen = true;
            pass('password screen is shown when nobody is logged in');
        } else {
            fail('login screen not shown -> ' + JSON.stringify(state));
        }

        // 4. Log in through the real login form.
        if (loginSeen) {
            await conn.client.evaluate(`(function () {
                var f = document.querySelector('#account');
                f.querySelector('[name=username]').value = 'admin';
                f.querySelector('[name=password]').value = 'admin';
                f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                return true;
            })()`);
            conn.ws.close();
            await sleep(4000);

            conn = await connect();
            if (await waitFor(conn.client, "!!require('electron').ipcRenderer.sendSync('storage-get', 'auth')", 'session was not stored after login', 20)) {
                pass('login stored the session');
            }

            const after = await conn.client.evaluate(`JSON.stringify({
                auth: require('electron').ipcRenderer.sendSync('storage-get', 'auth'),
                loginForm: !!document.querySelector('#account'),
                loggedin: (document.querySelector('#loggedin-user') || {}).textContent || ''
            })`).then(JSON.parse);

            (!after.loginForm && after.auth)
                ? pass('app reloaded into the POS, logged in as ' + after.loggedin)
                : fail('still on the login screen after login -> ' + JSON.stringify(after));

            const written = CONFIG_FILES.filter((f) => fs.existsSync(f));
            written.length
                ? pass('session config written to ' + written[0])
                : fail('no config.json was written');
        }

        // 5. Create + delete a product through the live API.
        try {
            const created = JSON.parse((await request('POST', API + '/api/inventory/product', {
                id: '', name: '__e2e_test_product__', price: '100', category: 'test',
                quantity: '1', stock: '', img: ''
            })).body);
            if (created && created._id) {
                pass('created product _id=' + created._id + ' via POST /api/inventory/product');
                const removed = await request('DELETE', API + '/api/inventory/product/' + created._id);
                (removed.status === 200)
                    ? pass('cleaned up the test product')
                    : fail('could not delete the test product: HTTP ' + removed.status);
            } else {
                fail('product create returned no _id: ' + JSON.stringify(created));
            }
        } catch (e) {
            fail('product create/delete failed: ' + e.message);
        }

    } catch (e) {
        fail('unexpected error: ' + (e && e.stack ? e.stack : e));
    } finally {
        if (conn) { try { conn.ws.close(); } catch (e) { } }
        try { spawnSync('taskkill', ['/pid', String(electron.pid), '/t', '/f']); } catch (e) { }
        // Leave the machine asking for a password on the next launch.
        clearConfig();
    }

    console.log(failures === 0 ? '\nALL LIVE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
})();
