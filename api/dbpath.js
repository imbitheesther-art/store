// Single source of truth for where the till keeps its data.
//
// Every api/*.js used to build its NeDB filename from raw
// `process.env.APPDATA + "/POS/server/databases/..."`. On a freshly installed
// machine that folder does not exist yet, and NeDB with `autoload: true`
// throws `ENOENT: no such file or directory, open .../inventory.db` as an
// uncaught exception - the server dies and the POS can never save anything.
//
// Requiring this module resolves the base folder the same way everywhere and
// creates `uploads` + `server/databases` up front, so no datastore can ever
// point at a missing directory, even when APPDATA is unset (packaged Electron
// launched without the variable, `npm start` from a bare shell, ...).
const fs = require("fs");
const os = require("os");
const nodePath = require("path");

function baseDir() {
  // Prefer the real Windows roaming folder. When APPDATA is missing fall back
  // to Electron's appData path, then to ~/AppData/Roaming, then to the home
  // directory - never to the literal string "undefined/...".
  let roaming = process.env.APPDATA;

  if (!roaming) {
    try {
      const electron = require("electron");
      const app = electron && electron.app;
      if (app && typeof app.getPath === "function") {
        roaming = nodePath.dirname(app.getPath("userData"));
      }
    } catch (err) { /* plain node - use the fallbacks below */ }
  }

  if (!roaming) {
    const home = os.homedir();
    const winRoaming = nodePath.join(home, "AppData", "Roaming");
    try {
      if (fs.existsSync(winRoaming)) roaming = winRoaming;
    } catch (err) { /* ignore - fall through to home */ }
    if (!roaming) roaming = home;
  }

  return nodePath.join(roaming, "POS");
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`Could not create ${dir}: ${err.message}`);
  }
  return dir;
}

// Absolute path of a NeDB file, creating its folder first.
function dbFile(name) {
  const dir = ensureDir(nodePath.join(baseDir(), "server", "databases"));
  return nodePath.join(dir, name);
}

// Absolute path of the uploads folder, creating it first.
function uploadsDir() {
  return ensureDir(nodePath.join(baseDir(), "uploads"));
}

// Create both folders immediately so `require("./api/inventory")` and friends
// (which autoload their datastores at require time) can never hit ENOENT.
ensureDir(nodePath.join(baseDir(), "server", "databases"));
ensureDir(nodePath.join(baseDir(), "uploads"));

// ---------------------------------------------------------------------------
// Remove orphaned NeDB compaction temp files (the `*.db~` scratch files).
//
// NeDB compacts a datastore by copying every record into `<file>.db~` and then
// renaming that over `<file>.db`. If the app is killed / crashes / loses power
// between those two steps, the `.db~` file is left behind. The real `.db` is
// still the good copy, but the next compaction collides with the stale scratch
// file (a `rename` EPERM) which can wedge the whole server - the UI then "opens
// but shows no data and stops responding".
//
// No compaction is ever in progress at startup, so any `*.db~` present here is
// guaranteed to be leftover garbage and is safe to delete. This runs before any
// Datastore is constructed (server.js requires this module first, and only
// after start.js has taken the single-instance lock), so we never delete a file
// another live process is still writing.
// ---------------------------------------------------------------------------
function cleanupStaleTempFiles() {
  const dir = nodePath.join(baseDir(), "server", "databases");
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    return; // folder missing / unreadable - nothing to clean
  }
  entries.forEach(function (name) {
    if (!/\.db~$/.test(name)) return;
    try {
      fs.unlinkSync(nodePath.join(dir, name));
    } catch (err) {
      // Best-effort: another handle may briefly hold it. Ignore and move on;
      // a fresh start with the single-instance lock will not have this issue.
    }
  });
}

cleanupStaleTempFiles();

module.exports = { baseDir, dbFile, uploadsDir, ensureDir };
