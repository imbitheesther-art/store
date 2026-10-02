let express = require("express"),
  http = require("http"),
  app = require("express")(),
  server = http.createServer(app),
  bodyParser = require("body-parser"),
  fs = require("fs"),
  os = require("os"),
  nodePath = require("path");

// ---------------------------------------------------------------------------
// nedb@1.8 calls util.isDate() / util.isRegExp(), which Node removed in v22+.
// Without this shim every database write throws "util.isDate is not a function"
// when the server is run on a modern Node runtime.
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

// On a freshly installed machine these folders do not exist yet, and multer
// will not create its destination directory on its own.
const APP_DATA_DIR = nodePath.join(process.env.APPDATA || os.homedir(), "POS");

["uploads", nodePath.join("server", "databases")].forEach(function (folder) {
  const target = nodePath.join(APP_DATA_DIR, folder);

  try {
    fs.mkdirSync(target, { recursive: true });
  } catch (err) {
    console.error(`Could not create ${target}: ${err.message}`);
  }
});

console.log("Server started");
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.all("/*", function(req, res, next) {
 
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

app.get("/", function(req, res) {
  res.send("POS Server Online.");
});

app.use("/api/inventory", require("./api/inventory"));
app.use("/api/customers", require("./api/customers"));
app.use("/api/categories", require("./api/categories"));
app.use("/api/settings", require("./api/settings"));
app.use("/api/users", require("./api/users"));
app.use("/api", require("./api/transactions"));

server.listen(PORT, () => console.log(`Listening on PORT ${PORT}`));
