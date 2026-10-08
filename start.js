// ---------------------------------------------------------------------------
// Self-healing launch guard.
//
// VS Code's integrated terminal (and some CI shells) export
// ELECTRON_RUN_AS_NODE=1. When that variable is present Electron starts as a
// plain Node process instead of an app: require('electron') resolves to the
// npm package's path string (or fails outright in a packaged build), so
// destructuring { app, BrowserWindow } yields undefined, electron-context-menu
// throws "Not running in an Electron environment!" and the process dies
// before a window is ever created - which looks exactly like "the app opens
// but never connects / never asks for a password".
//
// Detect that mode and re-exec ourselves once with the variable removed.
// ---------------------------------------------------------------------------
(function relaunchIfRunningAsNode() {
    let electronModule;
    try { electronModule = require('electron'); } catch (err) { electronModule = null; }

    // A working API object means we are inside a real Electron app (the
    // storage tests stub `electron` with such an object) - never relaunch then.
    const electronLooksUsable = !!electronModule && typeof electronModule === 'object';
    const runningAsNode = !electronLooksUsable &&
        (typeof electronModule === 'string' || !!process.env.ELECTRON_RUN_AS_NODE);
    if (!runningAsNode) return;

    const env = Object.assign({}, process.env);
    delete env.ELECTRON_RUN_AS_NODE;

    // Drop our own entry point from the argument list before re-launching.
    let args = process.argv.slice(2);
    if (args.length && (args[0] === __filename || args[0] === '.' || /[\\\/]start\.js$/.test(args[0]))) {
        args = args.slice(1);
    }

    const executable = typeof electronModule === 'string' ? electronModule : process.execPath;
    const result = require('child_process').spawnSync(
        executable,
        [__filename].concat(args),
        { stdio: 'inherit', env: env, cwd: process.cwd() }
    );

    process.exit(result.status === null ? 1 : result.status);
})();

const setupEvents = require('./installers/setupEvents');
if (setupEvents.handleSquirrelEvent()) {
    return;
}

// The API server is required before the window exists. If it throws (bad
// syntax, missing module, ...) the whole main process used to die silently:
// no window, no API, and the app looked like it "could not connect". Load it
// defensively so the UI always opens and can tell the user what went wrong.
let server = null;
let serverError = null;

try {
    server = require('./server');
} catch (err) {
    serverError = err;
    console.error('The POS API server failed to start:', err && err.message ? err.message : err);
}
const {app, BrowserWindow, ipcMain, screen, dialog} = require('electron');
const path = require('path');
const fs = require('fs');
const contextMenu = require('electron-context-menu');

let mainWindow;

function createWindow() {
    var primaryDisplay = screen.getPrimaryDisplay();
    var screenDimensions = primaryDisplay.workAreaSize;
    mainWindow = new BrowserWindow({
        width: screenDimensions.width,
        height: screenDimensions.height,
        frame: false,
        minWidth: 1200,
        minHeight: 750,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
    });

    mainWindow.maximize();
    mainWindow.show();

    // Load the POS interface. loadFile() builds a properly escaped file:// URL
    // for us; hand-building one leaves the Windows backslash path in the host
    // part of the URL.
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.on('ready', () => {
    createWindow();

    // Surface API startup failures instead of leaving a UI that can never
    // reach the server (the "not connecting / can't create anything" symptom).
    if (serverError) {
        dialog.showErrorBox(
            'POS server failed to start',
            'The local POS server could not start, so products, users and sales cannot be saved.\n\n' +
            (serverError && serverError.message ? serverError.message : String(serverError)) +
            '\n\nReinstall the app or check that port 8001 is not blocked.'
        );
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

ipcMain.on('app-quit', (evt, arg) => {
    app.quit();
});

ipcMain.on('app-data-path', (event) => {
    event.returnValue = app.getPath('appData');
});

// ---------------------------------------------------------------------------
// Persistent key/value store for the renderer.
//
// This replaces electron-store@5, which cannot run in a renderer process on
// Electron >= 14: it resolves its directory via `electron.app || electron.remote.app`
// and both are undefined there, so `new Store()` threw while pos.js was still
// being parsed. That single throw killed the whole UI bundle, so no API call
// ever ran and the app looked like it "could not connect to the server".
//
// The file and layout are identical to electron-store's
// (%APPDATA%\POS\config.json), so settings, the remembered till config and a
// logged-in user survive the switch untouched.
// ---------------------------------------------------------------------------
function storageFilePath() {
    return path.join(app.getPath('userData'), 'config.json');
}

function readStorage() {
    try {
        const parsed = JSON.parse(fs.readFileSync(storageFilePath(), 'utf8'));

        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (err) {
        // Missing, empty or corrupt file - treat it as an empty store.
        return {};
    }
}

function writeStorage(data) {
    try {
        fs.writeFileSync(storageFilePath(), JSON.stringify(data, null, '\t'), 'utf8');

        return true;
    } catch (err) {
        console.error('Could not write the settings store:', err.message);

        return false;
    }
}

ipcMain.on('storage-get', (event, key) => {
    event.returnValue = readStorage()[key];
});

ipcMain.on('storage-set', (event, key, value) => {
    const data = readStorage();
    data[key] = value;
    writeStorage(data);
    event.returnValue = true;
});

ipcMain.on('storage-delete', (event, key) => {
    const data = readStorage();
    delete data[key];
    writeStorage(data);
    event.returnValue = true;
});

// Prints receipt HTML straight to the default (POS receipt) printer without
// showing the Windows print dialog, which is what a till actually needs.
// Returns { ok: bool, error?: string } synchronously.
ipcMain.on('print-receipt', (event, html) => {

    const fs = require('fs');
    const os = require('os');
    const nodePath = require('path');

    const stamp = Date.now();
    const tempFile = nodePath.join(os.tmpdir(), `pos-receipt-${stamp}.html`);

    let win = null;
    let settled = false;

    const finish = (result) => {
        if (settled) return;
        settled = true;

        try {
            if (win && !win.isDestroyed()) win.destroy();
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (err) { }

        event.returnValue = result;
    };

    try {
        fs.writeFileSync(tempFile, html, 'utf8');
    } catch (err) {
        return finish({ ok: false, error: `Could not create the print file: ${err.message}` });
    }

    win = new BrowserWindow({
        show: false,
        width: 400,
        height: 700,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            javascript: false
        }
    });

    win.webContents.on('did-finish-load', () => {
        win.webContents.print(
            {
                silent: true,
                printBackground: true,
                margins: { marginType: 'none' }
            },
            (success, failureReason) => {
                if (success) {
                    finish({ ok: true });
                } else {
                    finish({
                        ok: false,
                        error: failureReason && failureReason !== 'cancelled'
                            ? failureReason
                            : 'No receipt printer available. Check that a printer is installed and set as default.'
                    });
                }
            }
        );
    });

    win.webContents.on('did-fail-load', (e, errorCode, errorDescription) => {
        finish({ ok: false, error: `Could not render the receipt: ${errorDescription}` });
    });

    win.loadFile(tempFile);

    // Never hang the UI if the printer driver never answers.
    setTimeout(() => {
        finish({ ok: false, error: 'Printing timed out. Check the receipt printer.' });
    }, 20000);

});

ipcMain.on('app-reload', (event, arg) => {
    mainWindow.reload();
});

contextMenu({
    prepend: (params, browserWindow) => [
        {
            label: 'DevTools',
            click(item, focusedWindow) {
                focusedWindow.toggleDevTools();
            }
        },
        {
            label: "Reload",
            click() {
                mainWindow.reload();
            }
        }
    ],
});
