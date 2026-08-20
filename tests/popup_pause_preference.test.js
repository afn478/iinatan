const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const files = [
  "src/main/00_context_state_paths.js",
  "src/main/15_profile_settings.js",
  "src/main/20_dictionary_manifest.js",
  "src/main/50_overlay_bridge_pause.js",
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function manifestWithPopupPause(value) {
  return JSON.stringify({
    dictionaries: {},
    disabled: {},
    activeProfileId: "default",
    profiles: {
      default: {
        id: "default",
        name: "Default",
        dictionaryOrder: [],
        disabled: {},
        preferences: { pauseWhilePopupVisible: value },
      },
    },
  });
}

const storage = Object.create(null);
const preferenceValues = {
  debugLogEnabled: false,
  debugLogVerbose: false,
  pauseWhilePopupVisible: true,
};
let paused = false;
const pauseWrites = [];
const mpvCommands = [];
let nextTimerId = 1;
const timers = new Map();

function setFakeTimeout(fn, ms) {
  const id = nextTimerId++;
  timers.set(id, { fn, ms });
  return id;
}

function clearFakeTimeout(id) {
  timers.delete(id);
}

function setFakeInterval(fn, ms) {
  const id = nextTimerId++;
  timers.set(id, { fn, ms, repeating: true });
  return id;
}

function clearFakeInterval(id) {
  timers.delete(id);
}

function runTimers() {
  const pending = Array.from(timers.entries());
  pending.forEach(([id, timer]) => {
    if (timers.has(id)) timer.fn();
  });
}

function pendingTimerCount() {
  return timers.size;
}

const context = {
  iina: {
    core: {
      status: { paused: false },
      pause() {
        paused = true;
        context.iina.core.status.paused = true;
        pauseWrites.push(true);
      },
      resume() {
        paused = false;
        context.iina.core.status.paused = false;
        pauseWrites.push(false);
      },
      osd() {},
    },
    mpv: {
      getFlag(name) {
        if (name === "pause") return paused;
        return false;
      },
      set(name, value) {
        if (name === "pause") {
          paused = !!value;
          context.iina.core.status.paused = paused;
          pauseWrites.push(!!value);
        }
      },
      command(name, args) {
        mpvCommands.push({ name, args });
      },
    },
    event: {},
    overlay: {},
    menu: {},
    input: {},
    ws: {},
    preferences: {
      get(key) {
        return preferenceValues[key];
      },
      set(key, value) {
        preferenceValues[key] = value;
      },
      sync() {},
    },
    console: { log() {}, warn() {}, error() {}, info() {} },
    file: {
      exists(p) {
        return Object.prototype.hasOwnProperty.call(storage, p);
      },
      read(p) {
        return storage[p] || "";
      },
      write(p, value) {
        storage[p] = String(value);
      },
      list() {
        return [];
      },
    },
    http: {},
    utils: {
      resolvePath(value) {
        if (value === "@data/") return "/data";
        return "/plugin";
      },
      open() {},
    },
    standaloneWindow: {},
  },
  globalThis: null,
  Date,
  setTimeout: setFakeTimeout,
  clearTimeout: clearFakeTimeout,
  setInterval: setFakeInterval,
  clearInterval: clearFakeInterval,
  URL,
  console: { log() {}, warn() {}, error() {}, info() {} },
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(
  files
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n") + "\nenabled = true;",
  context,
);

let firedOneShots = 0;
for (let index = 0; index < 1000; index++)
  context.scheduleOneShot(() => firedOneShots++, 2);
assert(pendingTimerCount() === 1000, "stress timers should all be scheduled");
runTimers();
assert(
  firedOneShots === 1000 && pendingTimerCount() === 0,
  "fired one-shot timers should remove their native IINA timer entries",
);
const cancelledOneShot = context.scheduleOneShot(() => firedOneShots++, 2);
context.cancelOneShot(cancelledOneShot);
runTimers();
assert(
  firedOneShots === 1000 && pendingTimerCount() === 0,
  "cancelled one-shot timers should self-remove without running callbacks",
);
let recurringTicks = 0;
const recurringTask = context.scheduleRepeating(() => recurringTicks++, 2);
runTimers();
assert(
  recurringTicks === 1 && pendingTimerCount() === 1,
  "repeating work should retain one shared native interval",
);
context.cancelRepeating(recurringTask);
assert(
  pendingTimerCount() === 2,
  "cancelling repeating work should not mutate IINA's native timer registry from the caller queue",
);
runTimers();
assert(
  recurringTicks === 1 && pendingTimerCount() === 0,
  "a cancelled repeating task should self-remove on its timer callback without another tick",
);

const mainRuntimeSources = [
  "src/main/30_backend_import_worker_lookup.js",
  "src/main/60_overlay_lifecycle_toggle.js",
]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");
assert(
  !/\b(?:setInterval|clearInterval)\s*\(/.test(mainRuntimeSources),
  "main-plugin consumers must use the queue-safe repeating-task wrapper",
);
const timerRuntimeSource = fs.readFileSync(
  path.join(root, "src/main/00_context_state_paths.js"),
  "utf8",
);
const repeatingHelperSource = timerRuntimeSource.slice(
  timerRuntimeSource.indexOf("function scheduleRepeating"),
  timerRuntimeSource.indexOf("function sleep"),
);
assert(
  (repeatingHelperSource.match(/\bsetInterval\s*\(/g) || []).length === 1 &&
    (repeatingHelperSource.match(/\bclearInterval\s*\(/g) || []).length === 1 &&
    /scheduleOneShot\(\(\) => clearInterval\(nativeId\), 0\)/.test(
      repeatingHelperSource,
    ),
  "the sole native interval cancellation must be deferred through a main-queue one-shot",
);

function showPopup(seq, popupSessionId) {
  context.handleLookupPopupVisibility({
    visible: true,
    seq,
    popupSessionId: popupSessionId || "test-session",
  });
}

function hidePopup(seq, popupSessionId) {
  context.handleLookupPopupVisibility({
    visible: false,
    seq,
    popupSessionId: popupSessionId || "test-session",
  });
}

function resetCase(initialPaused) {
  context.resetLookupPopupPause();
  timers.clear();
  pauseWrites.length = 0;
  mpvCommands.length = 0;
  paused = !!initialPaused;
  context.iina.core.status.paused = paused;
}

resetCase(false);
assert(
  context.handleControllerSubtitleSeek({ direction: -1 }) === true &&
    context.handleControllerSubtitleSeek({ direction: 1 }) === true &&
    mpvCommands.length === 2 &&
    mpvCommands[0].name === "sub-seek" &&
    mpvCommands[0].args[0] === "-1" &&
    mpvCommands[1].args[0] === "1",
  "Controller subtitle navigation should invoke mpv sub-seek directly",
);
assert(
  context.handleControllerSubtitleSeek({ direction: 0 }) === false &&
    mpvCommands.length === 2,
  "Invalid controller subtitle directions should be rejected",
);
resetCase(true);
assert(
  context.handleControllerResumePlayback() === true &&
    paused === false &&
    pauseWrites[pauseWrites.length - 1] === false,
  "Circle resume should clear a manual pause when no popup is open",
);

storage["/data/manifest.json"] = manifestWithPopupPause(false);
preferenceValues.pauseWhilePopupVisible = true;
resetCase(false);
showPopup(1);
assert(
  pauseWrites.length === 0,
  "Active profile false should prevent popup pause even when plugin preference is true",
);

storage["/data/manifest.json"] = manifestWithPopupPause("false");
preferenceValues.pauseWhilePopupVisible = true;
resetCase(false);
showPopup(2);
assert(
  pauseWrites.length === 0,
  "String false in the active profile should be treated as disabled",
);

storage["/data/manifest.json"] = manifestWithPopupPause(true);
preferenceValues.pauseWhilePopupVisible = false;
resetCase(false);
showPopup(3);
assert(
  pauseWrites.length === 1 && pauseWrites[0] === true,
  "Active profile true should allow popup pause even when plugin preference is stale false",
);

context.handleLookupPopupVisibility({
  visible: false,
  seq: 8,
  popupSessionId: "before-resize",
});
resetCase(false);
context.handleLookupPopupOverlayReady({
  ready: true,
  popupSessionId: "after-resize",
});
showPopup(1, "after-resize");
assert(
  pauseWrites.length === 1 && pauseWrites[0] === true,
  "Fresh overlay sessions should reset popup visibility sequence after resize/reload",
);

resetCase(false);
showPopup(1, "resume-basic");
hidePopup(2, "resume-basic");
assert(
  paused === true,
  "Popup hide should debounce resume instead of resuming synchronously",
);
assert(
  pendingTimerCount() === 1,
  "Popup hide should schedule one resume timer",
);
runTimers();
assert(
  paused === false,
  "Playback should resume when a popup hidden event follows a plugin-owned pause",
);
assert(
  pauseWrites.length === 2 &&
    pauseWrites[0] === true &&
    pauseWrites[1] === false,
  "Plugin-owned popup pause should write pause=true then pause=false",
);

resetCase(true);
showPopup(1, "already-paused");
hidePopup(2, "already-paused");
runTimers();
assert(
  paused === true,
  "Playback that was already paused before popup show must stay paused after hide",
);
assert(
  pauseWrites.length === 0,
  "Already-paused playback should not be touched by popup pause handling",
);

resetCase(false);
showPopup(1, "duplicate-show");
showPopup(1, "duplicate-show");
hidePopup(2, "duplicate-show");
runTimers();
assert(
  paused === false,
  "Duplicate visible events must not clear plugin-owned resume state",
);
assert(
  pauseWrites.length === 2 &&
    pauseWrites[0] === true &&
    pauseWrites[1] === false,
  "Duplicate visible events should not add extra pause writes",
);

resetCase(false);
showPopup(1, "stale-hide");
hidePopup(2, "stale-hide");
showPopup(3, "stale-hide");
hidePopup(2, "stale-hide");
runTimers();
assert(
  paused === true,
  "A stale lower-sequence hide after a newer show must not resume playback",
);
assert(
  pauseWrites.length === 1 && pauseWrites[0] === true,
  "Stale hide should not write pause=false",
);
hidePopup(4, "stale-hide");
runTimers();
assert(paused === false, "The current popup hide should still resume playback");

resetCase(false);
showPopup(1, "cancel-resume");
hidePopup(2, "cancel-resume");
assert(
  pendingTimerCount() === 1,
  "Hidden popup should schedule resume before a new popup appears",
);
showPopup(3, "cancel-resume");
assert(
  pendingTimerCount() === 1,
  "A cancelled resume should remain only until its main-queue callback removes it",
);
runTimers();
assert(
  paused === true && pendingTimerCount() === 0,
  "Cancelled resume must self-remove and keep playback paused while the new popup is visible",
);
hidePopup(4, "cancel-resume");
runTimers();
assert(
  paused === false,
  "Playback should resume after the replacement popup hides",
);

console.log("popup pause preference tests passed");
