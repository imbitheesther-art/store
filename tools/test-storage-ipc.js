// Exercises the main-process storage handlers that replaced electron-store.
//
// start.js is loaded for real, but with `electron`, `./server` and
// `electron-context-menu` stubbed so no window opens and no port is bound.
// The handlers are then driven exactly as pos.js drives them over IPC.
//
//   node tools/test-storage-ipc.js

const os = require('os');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// --- sandbox "userData" directory -----------------------------------------
const userDataDir = path.join(os.tmpdir(), 'pos-storage-test-' + Date.now());

fs.mkdirSync(userDataDir, { recursive: true });

const configFile = path.join(userDataDir, 'config.json');

// --- stubs ----------------------------------------------------------------
const handlers = {};

const electronStub = {
    app: {
        getPath: (name) => (name === 'appData' ? path.dirname(userDataDir) : userDataDir),
        on: () => { },
        quit: () => { },
        whenReady: () => Promise.resolve(),
        isReady: () => true
    },
    BrowserWindow: function () {
        this.loadFile = () => { };
        this.webContents = { on: () => { }, print: () => { } };
        this.on = () => { };
        this.maximize = () => { };
        this.show = () => { };
        this.reload = () => { };
    },
    ipcMain: {
        on: (channel, fn) => { handlers[channel] = fn; }
    },
    screen: {
        getPrimaryDisplay: () => ({ workAreaSize: { width: 1280, height: 800 } })
    }
};

const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {

    if (request === 'electron') {
        return electronStub;
    }

    // Keep the real HTTP server (and therefore a bound port) out of the test.
    if (request === './server') {
        return { listen: () => { } };
    }

    if (request === './installers/setupEvents') {
        return { handleSquirrelEvent: () => false };
    }

    if (request === 'electron-context-menu') {
        return () => { };
    }

    return originalLoad.apply(this, arguments);

};

// --- load the real main process file --------------------------------------
require(path.join(__dirname, '..', 'start.js'));

// --- helpers --------------------------------------------------------------
const out = [];

function check(label, fn) {
    try {
        fn();
        out.push([true, label, '']);
    } catch (err) {
        out.push([false, label, err.message]);
    }
}

function invoke(channel, ...args) {
    const event = { returnValue: undefined };

    handlers[channel](event, ...args);

    return event.returnValue;
}

function assertEqual(actual, expected, what) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);

    if (a !== e) {
        throw new Error(`${what}: expected ${e}, got ${a}`);
    }
}

// --- tests ----------------------------------------------------------------
check('registers storage-get / storage-set / storage-delete', () => {
    ['storage-get', 'storage-set', 'storage-delete'].forEach(channel => {
        if (typeof handlers[channel] !== 'function') {
            throw new Error(`${channel} is not registered`);
        }
    });
});

check('missing key reads back as undefined', () => {
    assertEqual(invoke('storage-get', 'auth'), undefined, 'auth');
});

check('set then get round-trips an object', () => {
    invoke('storage-set', 'settings', { store: 'Duka', symbol: 'KSh ', percentage: '16' });

    assertEqual(invoke('storage-get', 'settings'), { store: 'Duka', symbol: 'KSh ', percentage: '16' }, 'settings');
});

check('writes a single JSON object keyed by name (electron-store layout)', () => {
    const raw = fs.readFileSync(configFile, 'utf8');
    const parsed = JSON.parse(raw);

    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('config.json is not a plain object');
    }

    if (!parsed.settings || parsed.settings.store !== 'Duka') {
        throw new Error('settings were not persisted under the "settings" key');
    }
});

check('delete removes the key but leaves the others alone', () => {
    invoke('storage-set', 'auth', { auth: true });
    invoke('storage-delete', 'auth');

    assertEqual(invoke('storage-get', 'auth'), undefined, 'auth');
    assertEqual(invoke('storage-get', 'settings').store, 'Duka', 'settings kept');
});

check('reads a config.json written by the old electron-store build', () => {
    fs.writeFileSync(configFile, JSON.stringify({
        auth: { auth: true },
        user: { _id: 'u1', username: 'cashier' },
        settings: { app: 'Point of Sale', till: 3 }
    }, null, '\t'), 'utf8');

    assertEqual(invoke('storage-get', 'user'), { _id: 'u1', username: 'cashier' }, 'user');
    assertEqual(invoke('storage-get', 'settings').till, 3, 'settings.till');
});

check('a corrupt config.json degrades to empty instead of throwing', () => {
    fs.writeFileSync(configFile, '{ this is not json', 'utf8');

    assertEqual(invoke('storage-get', 'settings'), undefined, 'settings');

    // And a write repairs the file.
    invoke('storage-set', 'auth', { auth: true });

    assertEqual(invoke('storage-get', 'auth'), { auth: true }, 'auth after repair');
});

// --- report ---------------------------------------------------------------
console.log('\n--- main-process storage (electron-store replacement) ---\n');

let failed = 0;

out.forEach(([ok, label, detail]) => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  -> ' + detail : ''}`);
});

console.log('');

try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
} catch (err) { }

console.log(failed === 0
    ? `All ${out.length} storage checks passed.`
    : `${failed} of ${out.length} storage checks FAILED.`);

process.exit(failed === 0 ? 0 : 1);