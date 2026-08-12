const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
let reads = 0;
let writes = 0;
let timers = [];
let logText = "existing\n";
let viewerLogs = 0;
let processLaunches = 0;
const sharedConsole = {
  log() {
    viewerLogs++;
  },
  warn() {
    viewerLogs++;
  },
  error() {
    viewerLogs++;
  },
  info() {
    viewerLogs++;
  },
};

const context = {
  iina: {
    core: {},
    mpv: {},
    event: {},
    overlay: {},
    menu: {},
    input: {},
    ws: {},
    preferences: { get: (key) => (key === "debugLogEnabled" ? true : false) },
    console: sharedConsole,
    file: {
      exists(p) {
        return p === "/data" || String(p).startsWith("/data/");
      },
      read(p) {
        if (p === "/data/debug.log") {
          reads++;
          return logText;
        }
        return "";
      },
      write(p, text) {
        if (p === "/data/debug.log") {
          writes++;
          logText = String(text || "");
        }
      },
    },
    http: {},
    utils: {
      resolvePath: (value) =>
        value === "@data/" ? "/data/" : String(value || ""),
      async exec() {
        processLaunches++;
        return { status: 0, stdout: "", stderr: "" };
      },
    },
    standaloneWindow: {},
  },
  globalThis: { console: { log() {}, warn() {}, error() {} } },
  setTimeout(fn) {
    timers.push(fn);
    return timers.length;
  },
  clearTimeout() {},
  URL,
  console: sharedConsole,
};
context.globalThis = context;
vm.createContext(context);

const source =
  fs.readFileSync(
    path.join(root, "src/main/00_context_state_paths.js"),
    "utf8",
  ) +
  "\nglobalThis.__debugLogTest = { debugLog, flushDebugLogBuffer, ensureDataDirs };";
vm.runInContext(source, context, { filename: "00_context_state_paths.js" });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

context.__debugLogTest.debugLog("first hover log");
context.__debugLogTest.debugLog("second hover log");
context.__debugLogTest.debugLog("third hover log");

assert(viewerLogs === 3, "each log should reach an aliased IINA console once");
assert(reads === 0, "debugLog should not synchronously read debug.log");
assert(writes === 0, "debugLog should not synchronously write debug.log");
const firstDirectoryCheck = context.__debugLogTest.ensureDataDirs();
const secondDirectoryCheck = context.__debugLogTest.ensureDataDirs();
assert(
  firstDirectoryCheck === secondDirectoryCheck,
  "concurrent data-directory checks should share one promise",
);
assert(
  processLaunches === 0,
  "existing data directories should not launch mkdir",
);

context.__debugLogTest.flushDebugLogBuffer();
assert(reads === 1, "first flush should read the previous log once");
assert(writes === 1, "first flush should write the coalesced log once");
assert(
  /first hover log/.test(logText) && /third hover log/.test(logText),
  "flushed log should include buffered lines",
);

context.__debugLogTest.debugLog("fourth hover log");
context.__debugLogTest.flushDebugLogBuffer();
assert(reads === 1, "later flushes should reuse the in-memory log snapshot");
assert(
  writes === 2,
  "later flushes should write only when new lines are pending",
);
assert(
  /fourth hover log/.test(logText),
  "later flush should append pending lines",
);

console.log("debug log performance tests passed");
