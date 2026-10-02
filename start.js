const setupEvents = require('./installers/setupEvents');
if (setupEvents.handleSquirrelEvent()) {
    return;
}

const server = require('./server');
const {app, BrowserWindow, ipcMain, screen} = require('electron');
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

app.on('ready', createWindow);

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
