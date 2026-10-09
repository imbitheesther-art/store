// Connects to the running source app via Chrome DevTools Protocol and asserts
// that the redesigned Transactions/POS markup actually rendered.
//
// Run AFTER starting the app with --remote-debugging-port=9333:
//   node tools\dom-check.js
const http = require('http');
const WebSocket = require('ws');

const DEBUG = 'http://127.0.0.1:9333';

function getJson(urlPath) {
    return new Promise((resolve) => {
        const req = http.get(urlPath, { timeout: 2000 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
            });
        });
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.on('error', () => resolve(null));
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findPage() {
    for (let i = 0; i < 40; i++) {
        const targets = await getJson(DEBUG + '/json');
        if (Array.isArray(targets)) {
            const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
            if (page) return page;
        }
        await sleep(500);
    }
    return null;
}

async function main() {

    const page = await findPage();
    if (!page) {
        console.log('FAIL  no CDP page target on port 9333 (app not up yet?)');
        process.exit(1);
    }

    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
    let nextId = 0;
    const pending = {};

    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id && pending[msg.id]) {
            pending[msg.id](msg.result);
            delete pending[msg.id];
        }
    });

    function send(method, params) {
        return new Promise((resolve) => {
            const id = ++nextId;
            pending[id] = resolve;
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    const expression = `JSON.stringify({
        pay_methods:   !!document.getElementById('pay_methods'),
        chart_payments:!!document.getElementById('chart_payments'),
        chart_products:!!document.getElementById('chart_products'),
        tx_stats:      !!document.querySelector('.row.tx-stats'),
        stat_values:   document.querySelectorAll('.stat-value').length,
        cart_wrap:     !!document.querySelector('#card-box .cart-wrap'),
        pos_head:      !!document.querySelector('#card-box .pos-head'),
        pos_actions:   !!document.querySelector('#card-box .pos-actions'),
        pos_totals:    !!document.querySelector('#card-box .pos-totals'),
        product_sales: !!document.getElementById('product_sales'),
        counter:       !!document.getElementById('counter'),
        totals_div:    !!document.getElementById('totals'),
        ready:         document.readyState
    })`;

    const res = await send('Runtime.evaluate', { expression, returnByValue: true });
    ws.close();

    let dom = null;
    try { dom = JSON.parse(res.result.value); } catch (e) { /* fall through */ }

    if (!dom) {
        console.log('FAIL  could not evaluate DOM: ' + JSON.stringify(res));
        process.exit(1);
    }

    const mustHave = ['pay_methods', 'chart_payments', 'chart_products', 'tx_stats',
                      'cart_wrap', 'pos_head', 'pos_actions', 'pos_totals'];
    const mustNotHave = ['product_sales', 'counter', 'totals_div'];

    let failures = 0;
    const pass = (m) => console.log('PASS  ' + m);
    const fail = (m) => { failures++; console.log('FAIL  ' + m); };

    mustHave.forEach((k) => (dom[k] ? pass('present: ' + k) : fail('missing: ' + k)));
    mustNotHave.forEach((k) => (!dom[k] ? pass('absent: ' + k) : fail('still present: ' + k)));
    (dom.stat_values >= 4 ? pass : fail)('.stat-value elements = ' + dom.stat_values);
    (dom.ready === 'complete' || dom.ready === 'interactive' ? pass : fail)('readyState=' + dom.ready);

    console.log(failures === 0
        ? 'ALL DOM CHECKS PASSED'
        : failures + ' DOM CHECK(S) FAILED');
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.log('FAIL  ' + e.message); process.exit(1); });