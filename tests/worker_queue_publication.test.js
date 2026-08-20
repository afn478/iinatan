const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const writes = [];
const removals = [];
const controllerSeeks = [];
const controllerDismissals = [];
let nextIntervalId = 1;
let activeInterval = null;
let intervalStarts = 0;
let intervalClears = 0;
const context = {
  nativeBitmapOcrWindowMain: true,
  nativeControllerNeedsNeutral: false,
  nativeControllerShoulderState: { left: false, right: false },
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
  scheduleRepeating(callback, ms) {
    intervalStarts++;
    activeInterval = { id: nextIntervalId++, callback, ms };
    return activeInterval;
  },
  cancelRepeating(task) {
    if (activeInterval === task) activeInterval = null;
    intervalClears++;
  },
  postToOverlay(name) {
    if (name === "controller-dismiss") controllerDismissals.push(name);
  },
  finishLookupPopupPause() {},
  handleControllerSubtitleSeek(payload) {
    controllerSeeks.push(Number(payload && payload.direction));
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

const normalizedController = context.normalizeNativeControllerState({
  protocol: 1,
  sequence: 3,
  source: "native-hid",
  connected: true,
  id: "DualSense",
  buttons: { primary: true, back: "true" },
  axes: { leftY: 3, rightX: -4, rightY: "invalid" },
});
assert(
  normalizedController.buttons.primary === true &&
    normalizedController.buttons.back === false &&
    normalizedController.axes.leftY === 1 &&
    normalizedController.axes.rightX === -1 &&
    normalizedController.axes.rightY === 0,
  "native controller snapshots should validate buttons and clamp axes",
);
context.handleNativeControllerShoulders({
  connected: true,
  buttons: { leftShoulder: true },
});
context.handleNativeControllerShoulders({
  connected: true,
  buttons: { leftShoulder: true },
});
context.handleNativeControllerShoulders({ connected: true, buttons: {} });
context.handleNativeControllerShoulders({
  connected: true,
  buttons: { rightShoulder: true },
});
assert(
  JSON.stringify(controllerSeeks) === JSON.stringify([-1, 1]) &&
    controllerDismissals.length === 2,
  "native shoulders should dismiss once and seek once per press edge",
);

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
