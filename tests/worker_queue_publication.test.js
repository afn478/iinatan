const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const writes = [];
const removals = [];
let nextIntervalId = 1;
let activeInterval = null;
let intervalStarts = 0;
let intervalClears = 0;
const context = {
  workerQueueDir() {
    return "/worker/queue";
  },
  pathJoin(...parts) {
    return parts.join("/");
  },
  file: {
    write(filePath, value) {
      writes.push([filePath, String(value)]);
    },
  },
  safeDelete(filePath) {
    removals.push(filePath);
  },
  prefNumber() {
    return 2;
  },
  setInterval(callback, ms) {
    intervalStarts++;
    activeInterval = { id: nextIntervalId++, callback, ms };
    return activeInterval.id;
  },
  clearInterval(id) {
    if (activeInterval && activeInterval.id === id) activeInterval = null;
    intervalClears++;
  },
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(
    path.join(root, "src/main/30_backend_import_worker_lookup.js"),
    "utf8",
  ),
  context,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

context.publishWorkerRequest("request-1", {
  requestId: "request-1",
  text: "辞書",
});
assert(
  writes[0][0].endsWith("request-1.request") &&
    writes[1][0].endsWith("request-1.json"),
  "worker request body must be complete before its marker is published",
);
assert(
  JSON.parse(writes[0][1]).requestId === "request-1" &&
    writes[1][1] === "committed\n",
  "worker marker publication should not expose partial JSON",
);

context.cleanupWorkerRequest("request-1");
assert(
  removals.some((filePath) => filePath.endsWith("request-1.request")) &&
    removals.some((filePath) => filePath.endsWith("request-1.json")),
  "worker request cleanup should remove its body and marker",
);

context.file.write = function write(filePath) {
  if (filePath.endsWith(".json")) throw new Error("marker write failed");
};
let failed = false;
try {
  context.publishWorkerRequest("request-2", { requestId: "request-2" });
} catch (_) {
  failed = true;
}
assert(failed, "marker publication failures should propagate");
assert(
  removals.some((filePath) => filePath.endsWith("request-2.request")),
  "failed marker publication should remove the unpublished body",
);

async function testSharedDirectWorkerPolling() {
  const waits = [];
  for (let index = 0; index < 1000; index++)
    waits.push(context.waitForDirectWorkerPoll());
  assert(
    intervalStarts === 1 && activeInterval && activeInterval.ms === 2,
    "concurrent direct-worker waits should share the configured fast interval",
  );
  activeInterval.callback();
  await Promise.all(waits);
  assert(
    intervalClears === 0 && activeInterval,
    "the shared interval should stay active while continuations can requeue",
  );
  activeInterval.callback();
  assert(
    intervalClears === 1 && activeInterval === null,
    "an idle direct-worker interval should stop itself on its main-queue tick",
  );
}

testSharedDirectWorkerPolling()
  .then(() => console.log("worker queue publication tests passed"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
