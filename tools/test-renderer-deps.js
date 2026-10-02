// Regression guard for the renderer bundle.
//
// The installed app could not talk to its server because `new Store()`
// (electron-store@5) threw while pos.js was being parsed: electron-store
// resolves its directory from `electron.app || electron.remote.app`, and in a
// renderer process on Electron >= 14 both of those are undefined. The throw
// aborted renderer.js, so no jQuery handler and no AJAX call ever ran.
//
// This test loads every module the renderer chain pulls in, inside a
// simulated Electron 22 renderer, and fails if any of them throws or if the
// app source reintroduces a dependency on the removed `remote` module.
//
//   node tools/test-renderer-deps.js

const path = require('path');
const fs = require('fs');
const Module = require('module');

const root = path.join(__dirname, '..');

// --- minimal renderer globals ---------------------------------------------
// index.html injects jQuery into window before loading this bundle, so the
// bundle is expected to find a global `$`.
function chainable() {
    return new Proxy(function () { }, {
        get: (target, prop) => (prop === 'length' ? 0 : chainable()),
        apply: () => chainable()
    });
}

function makeElement() {
    return {
        style: {},
        dataset: {},
        classList: { add: () => { }, remove: () => { }, contains: () => false },
        setAttribute: () => { },
        getAttribute: () => null,
        appendChild: () => { },
        removeChild: () => { },
        addEventListener: () => { },
        removeEventListener: () => { },
        insertBefore: () => { },
        querySelector: () => null,
        querySelectorAll: () => [],
        getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }),
        innerHTML: '',
        textContent: '',
        outerHTML: ''
    };
}

global.window = global.window || global;
global.location = global.location || {
    href: 'file:///D:/POS/store/index.html',
    protocol: 'file:',
    origin: 'null',
    assign: () => { },
    replace: () => { }
};
global.navigator = global.navigator || { userAgent: 'test', platform: 'Win32' };
global.$ = global.$ || chainable();
global.jQuery = global.jQuery || global.$;
global.getComputedStyle = global.getComputedStyle || (() => ({ getPropertyValue: () => '' }));
global.requestAnimationFrame = global.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
global.cancelAnimationFrame = global.cancelAnimationFrame || (() => { });
global.document = global.document || {
    createElement: makeElement,
    createElementNS: makeElement,
    createTextNode: () => ({}),
    addEventListener: () => { },
    removeEventListener: () => { },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    getElementsByTagName: () => [makeElement()],
    head: makeElement(),
    body: makeElement(),
    documentElement: makeElement()
};

// documentElement/body must be real objects for libraries that read inline
// styles (sweetalert2 and html2canvas both probe for CSS properties).
global.document.documentElement = global.document.documentElement || makeElement();
global.document.body = global.document.body || makeElement();

// --- what require('electron') looks like in a renderer on Electron 22 ------
const rendererElectron = {
    ipcRenderer: { sendSync: () => '', send: () => { }, on: () => { } },
    contextBridge: {},
    webFrame: {},
    app: undefined,
    remote: undefined
};

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {

    if (request === 'electron') {
        return rendererElectron;
    }

    return originalLoad.apply(this, arguments);

};

let results = [];

function check(label, fn) {
    try {
        fn();
        results.push([true, label, '']);
    } catch (err) {
        results.push([false, label, err.message]);
    }
}

// --- every third-party module the renderer bundle requires -----------------
[
    'moment',
    'sweetalert2',
    'jsbarcode',
    'btoa',
    'jspdf',
    'html2canvas',
    'print-js',
    'macaddress'
].forEach(name => {
    check(`require('${name}')`, () => require(name));
});

// --- the app's own renderer modules ---------------------------------------
check('assets/js/receipt.js exports buildReceipt()', () => {
    const receipt = require(path.join(root, 'assets', 'js', 'receipt.js'));

    if (typeof receipt.buildReceipt !== 'function') {
        throw new Error('buildReceipt is not exported');
    }
});

check('assets/js/product-filter.js loads', () => {
    require(path.join(root, 'assets', 'js', 'product-filter.js'));
});

// --- static guards on the source ------------------------------------------
const posSource = fs.readFileSync(path.join(root, 'assets', 'js', 'pos.js'), 'utf8');

// Strip comments so the explanatory notes about electron-store do not trip
// the checks below.
const posCode = posSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

check("pos.js does not require('electron-store')", () => {
    if (/require\s*\(\s*['"]electron-store['"]\s*\)/.test(posCode)) {
        throw new Error('electron-store cannot run in an Electron 22 renderer');
    }
});

check('pos.js does not use the removed `remote` module', () => {
    if (/electron\s*\.\s*remote/.test(posCode)) {
        throw new Error('electron.remote was removed in Electron 14');
    }
});

check('pos.js routes storage through the main process', () => {
    if (!/sendSync\s*\(\s*['"]storage-get['"]/.test(posCode)) {
        throw new Error("expected ipcRenderer.sendSync('storage-get', ...)");
    }
});

check('pos.js has no left-over `new Store()`', () => {
    if (/new\s+Store\s*\(/.test(posCode)) {
        throw new Error('new Store() is still present');
    }
});

// --- report ---------------------------------------------------------------
console.log('\n--- renderer bundle load test (simulated Electron 22 renderer) ---\n');

let failed = 0;

results.forEach(([ok, label, detail]) => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
});

console.log('');
console.log(failed === 0
    ? `All ${results.length} renderer checks passed.`
    : `${failed} of ${results.length} renderer checks FAILED.`);

process.exit(failed === 0 ? 0 : 1);