// Starts the real server.js and checks that every GET route the POS UI uses
// actually answers.
//
// This exists because /api/users/check used to seed the default admin without
// ever calling res.send(), so it hung until the client gave up. pos.js calls
// it on startup, which made the app look like it could not reach its own
// server even though the port was open.
//
// The server is started with APPDATA pointed at a throwaway directory, so the
// real %APPDATA%\POS databases are never touched.
//
//   node tools/test-api-routes.js

const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const PORT = 18123;
const sandbox = path.join(os.tmpdir(), 'pos-api-test-' + Date.now());

fs.mkdirSync(sandbox, { recursive: true });

const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: Object.assign({}, process.env, { APPDATA: sandbox, PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
});

let serverLog = '';

child.stdout.on('data', (d) => { serverLog += d.toString(); });
child.stderr.on('data', (d) => { serverLog += d.toString(); });

function get(urlPath, timeoutMs) {
    return new Promise((resolve) => {

        const req = http.get(
            { host: '127.0.0.1', port: PORT, path: urlPath, timeout: timeoutMs },
            (res) => {
                let body = '';
                res.on('data', (c) => { body += c; });
                res.on('end', () => resolve({ status: res.statusCode, body: body }));
            }
        );

        req.on('timeout', () => {
            req.destroy();
            resolve({ error: `no response within ${timeoutMs}ms` });
        });

        req.on('error', (err) => resolve({ error: err.message }));

    });
}

function postJson(urlPath, payload, timeoutMs) {
    return new Promise((resolve) => {

        const body = JSON.stringify(payload);

        const req = http.request(
            {
                host: '127.0.0.1',
                port: PORT,
                path: urlPath,
                method: 'POST',
                timeout: timeoutMs,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(body)
                }
            },
            (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => resolve({ status: res.statusCode, body: data }));
            }
        );

        req.on('timeout', () => {
            req.destroy();
            resolve({ error: `no response within ${timeoutMs}ms` });
        });

        req.on('error', (err) => resolve({ error: err.message }));

        req.end(body);

    });
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(maxMs) {
    const started = Date.now();

    while (Date.now() - started < maxMs) {
        const res = await get('/', 1000);

        if (res.status === 200) {
            return true;
        }

        await sleep(250);
    }

    return false;
}

// Everything the POS UI pulls over GET, plus the remaining read-only routes.
// The paths and trailing slashes match exactly what pos.js requests.
const routes = [
    ['/api/users/check/', 'startup: seeds admin then must answer'],
    ['/api/users/all', 'startup: user list'],
    ['/api/users/user/1', 'startup: current user'],
    ['/api/settings/get', 'startup: shop settings'],
    ['/api/inventory/products', 'startup: product list'],
    ['/api/categories/all', 'startup: categories'],
    ['/api/customers/all', 'customers'],
    ['/api/categories/category/', 'category by id (no id)'],
    ['/api/inventory/product/', 'product by id (no id)'],
    ['/api/inventory/', 'inventory index'],
    ['/api/categories/', 'categories index'],
    ['/api/customers/', 'customers index'],
    ['/api/settings/', 'settings index'],
    ['/api/users/', 'users index'],
    ['/api/', 'transactions index'],
    ['/api/all', 'transactions: all'],
    ['/api/on-hold', 'transactions: on hold'],
    ['/api/customer-orders', 'transactions: customer orders'],
    ['/api/by-date', 'transactions: by date']
];

async function main() {

    const up = await waitForServer(25000);

    if (!up) {
        console.log('FAIL  server never came up on port ' + PORT);
        console.log(serverLog);
        child.kill();
        process.exitCode = 1;
        return;
    }

    // /check must seed the admin account exactly once. This has to run before
    // the route sweep below, because the sweep also calls /check.
    const firstCheck = await get('/api/users/check', 6000);
    const secondCheck = await get('/api/users/check', 6000);

    let seededOnce = false;

    try {
        seededOnce = JSON.parse(firstCheck.body).seeded === true
            && JSON.parse(secondCheck.body).seeded === false;
    } catch (err) {
        seededOnce = false;
    }

    console.log(`\n--- API route smoke test (server on :${PORT}, sandboxed APPDATA) ---\n`);

    const results = [];

    for (const [urlPath, label] of routes) {
        const res = await get(urlPath, 6000);
        results.push([urlPath, label, res]);
    }

    let failed = 0;

    results.forEach(([urlPath, label, res]) => {

        if (res.error) {
            failed++;
            console.log(`FAIL  ${urlPath.padEnd(28)} ${label}\n        -> ${res.error}`);
            return;
        }

        if (res.status >= 500) {
            failed++;
            console.log(`FAIL  ${urlPath.padEnd(28)} ${label}\n        -> HTTP ${res.status}`);
            return;
        }

        const preview = (res.body || '').replace(/\s+/g, ' ').slice(0, 60);

        console.log(`PASS  ${urlPath.padEnd(28)} ${('HTTP ' + res.status).padEnd(8)} ${preview}`);
    });

    console.log('');
    console.log(`${seededOnce ? 'PASS' : 'FAIL'}  /api/users/check seeds the admin account once, then seeded:false`);

    if (!seededOnce) failed++;

    // The login call the UI makes immediately after /check.
    const login = await postJson('/api/users/login', { username: 'admin', password: 'admin' }, 6000);

    let loginOk = false;

    try {
        const parsed = JSON.parse(login.body);

        loginOk = !!parsed && parsed._id === 1 && parsed.username === 'admin';
    } catch (err) {
        loginOk = false;
    }

    console.log(`${loginOk ? 'PASS' : 'FAIL'}  POST /api/users/login with admin/admin returns the admin user`);

    if (!loginOk) failed++;

    // A sale must never be lost to an id clash. The same _id is posted twice;
    // the unique index rejects the second insert, so the server has to retry
    // instead of answering 500 like it used to.
    const sale = {
        _id: 1700000000123,
        order: 1700000000123,
        ref_number: '',
        status: 1,
        subtotal: '0.00',
        tax: 0,
        order_type: 1,
        items: [],
        date: '2024-01-01 00:00:00',
        payment_type: 'Cash',
        payment_info: '',
        total: '0.00',
        paid: '0.00',
        change: '0.00',
        till: 'test',
        mac: '00:00:00:00:00:00',
        user: 'admin',
        user_id: 1
    };

    const sale1 = await postJson('/api/new', sale, 8000);
    const sale2 = await postJson('/api/new', sale, 8000);

    const salesOk = sale1.status === 200 && sale2.status === 200;

    console.log(`${salesOk ? 'PASS' : 'FAIL'}  POST /api/new keeps a sale whose _id is taken (got ${sale1.status}, then ${sale2.status})`);

    if (!salesOk) failed++;

    const total = results.length + 3;

    console.log('');
    console.log(failed === 0
        ? `All ${total} API checks passed.`
        : `${failed} of ${total} API checks FAILED.`);

    child.kill();
    process.exitCode = failed === 0 ? 0 : 1;
}

main().then(() => {

    try {
        fs.rmSync(sandbox, { recursive: true, force: true });
    } catch (err) { }

}).catch((err) => {

    console.error(err);
    child.kill();
    process.exitCode = 1;

});