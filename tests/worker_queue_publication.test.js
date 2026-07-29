const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const writes = [];
const removals = [];
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

console.log("worker queue publication tests passed");
