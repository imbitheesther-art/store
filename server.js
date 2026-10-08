let express = require("express"),
  http = require("http"),
  app = require("express")(),
  server = http.createServer(app),
  bodyParser = require("body-parser");

// ---------------------------------------------------------------------------
// nedb@1.8 calls util.isDate() / util.isRegExp(), which Node removed in v22+.
// Without this shim every database write throws "util.isDate is not a function"
// when the server is run on a modern Node runtime.
//
// This shim MUST run before ./api/* is required: those modules autoload their
// nedb datastores at require time.
// ---------------------------------------------------------------------------
const util = require("util");

if (typeof util.isDate !== "function") {
  util.isDate = function (value) {
    return Object.prototype.toString.call(value) === "[object Date]";
  };
}

if (typeof util.isRegExp !== "function") {
  util.isRegExp = function (value) {
    return Object.prototype.toString.call(value) === "[object RegExp]";
  };
}

const PORT = process.env.PORT || 8001;

// All data folders (uploads + NeDB databases) are created by api/dbpath.js,
// which every api/*.js also uses - so the folder always exists before any
// datastore with `autoload: true` is required below. That ordering is what
// fixes `ENOENT ... /POS/server/databases/inventory.db` on fresh installs.
const dbpath = require("./api/dbpath");

dbpath.ensureDir(dbpath.baseDir());

console.log("Server started");
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.all("/*", function (req, res, next) {

  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-type,Accept,X-Access-Token,X-Key"
  );
  if (req.method == "OPTIONS") {
    res.status(200).end();
  } else {
    next();
  }
});

app.get("/", function (req, res) {
  res.send("POS Server Online.");
});

app.use("/api/inventory", require("./api/inventory"));
app.use("/api/customers", require("./api/customers"));
app.use("/api/categories", require("./api/categories"));
app.use("/api/settings", require("./api/settings"));
app.use("/api/users", require("./api/users"));
app.use("/api", require("./api/transactions"));

// A port conflict (another POS/server instance already bound to 8001) arrives
// as an async 'error' event. Without a handler it becomes an uncaught
// exception and takes the whole Electron app down with it - the window opens,
// then everything silently stops working.
server.on("error", function (err) {
  if (err.code === "EADDRINUSE") {
    console.log(
      `Port ${PORT} is already in use - another POS server instance is running. The UI can still use it.`
    );
  } else {
    console.error(`POS server error: ${err.message}`);
  }
});

server.listen(PORT, () => console.log(`Listening on PORT ${PORT}`));

// start.js uses this to report whether the API actually came up.
module.exports = server;
