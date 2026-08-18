const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const launches = [];
const pending = [];
let active = 0;
let maxActive = 0;

const context = {
  iina: {
    core: {},
    mpv: {},
    event: {},
    overlay: {},
    menu: {},
    input: {},
    ws: {},
    preferences: { get() {} },
    console: { log() {}, warn() {}, error() {}, info() {} },
    file: {},
    http: {},
    utils: {
      exec(command) {
        launches.push(command);
        active++;
        maxActive = Math.max(maxActive, active);
        return new Promise((resolve, reject) => {
          pending.push({
            command,
            resolve(value) {
              active--;
              resolve(value);
            },
            reject(error) {
              active--;
              reject(error);
            },
          });
        });
      },
    },
    standaloneWindow: {},
  },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  URL,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(
    path.join(root, "src/main/00_context_state_paths.js"),
    "utf8",
  ) +
    "\nthis.__processQueue = { execExternalProcess, interactive: EXTERNAL_PROCESS_PRIORITY_INTERACTIVE };",
  context,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  const queue = context.__processQueue;
  const first = queue.execExternalProcess("first", []);
  await flushAsyncWork();
  const low = queue.execExternalProcess("low", []);
  const high = queue.execExternalProcess(
    "high",
    [],
    undefined,
    undefined,
    undefined,
    queue.interactive,
  );
  await flushAsyncWork();
  assert(
    launches.join(",") === "first" && maxActive === 1,
    "external processes should never overlap",
  );

  pending.find((job) => job.command === "first").resolve({ status: 0 });
  await first;
  await flushAsyncWork();
  assert(
    launches.join(",") === "first,high",
    "queued interactive work should run before lower-priority maintenance",
  );

  pending.find((job) => job.command === "high").resolve({ status: 0 });
  await high;
  await flushAsyncWork();
  assert(
    launches.join(",") === "first,high,low" && maxActive === 1,
    "the next process should start only after the active process exits",
  );

  pending.find((job) => job.command === "low").reject(new Error("fixture"));
  try {
    await low;
  } catch (_) {}
  const afterFailure = queue.execExternalProcess("after-failure", []);
  await flushAsyncWork();
  assert(
    launches.join(",") === "first,high,low,after-failure",
    "a failed process should release the serialized process lane",
  );
  pending.find((job) => job.command === "after-failure").resolve({ status: 0 });
  await afterFailure;
  assert(maxActive === 1, "the process lane should remain serialized");

  console.log("external process queue tests passed");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
