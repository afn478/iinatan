/**
 * iinatan for IINA 1.6.0+
 *
 * v1.2.4 architecture:
 * - No Yomitan browser-extension API dependency.
 * - No local HTTP server.
 * - Uses Manhhao/hoshidicts through a persistent filesystem-backed native worker.
 * - The worker keeps DictionaryQuery + Lookup in memory and accepts one lookup request file at a time.
 */

const { core, mpv, event, overlay, menu, input, ws, preferences, console, file, http, utils, standaloneWindow } = iina;

const VERSION = "1.6.0";
const RECOMMENDED_JITENDEX_URL = "https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip";

let enabled = false;
let initialized = false;
let pollTimer = null;
let activeSubtitlePollMs = 0;
let lastSubtitle = null;
let nativeSubVisibilityBeforeEnable = null;
let requestSerial = 0;
let lookupInFlight = Object.create(null);
let lookupCache = Object.create(null);
let statusTimer = null;
let workerStartInFlight = null;
let activeWorkerFingerprint = null;
let activeWorkerReady = null;
let lookupBackendReadyForNativeHide = false;
let subtitleLineSerial = 0;
let currentSubtitleLineId = 0;
let hoverLookupInFlight = false;
let pendingHoverLookup = null;
let hoverLookupSequence = 0;
let hoverLookupActiveKey = "";
let lastShortcutToggleAt = 0;
let shortcutRegistered = false;
let lookupPopupPauseActive = false;
let lookupPopupPauseShouldResume = false;
let lookupPopupPauseResumeTimer = null;
let lookupPopupWatchdogTimer = null;
let lookupPopupLastHeartbeatAt = 0;
let lookupPopupLastSeq = 0;
let lookupPopupSessionId = "";
let overlayBridgeStarted = false;
let overlayBridgePort = 19741;
let dictionaryManagerInitialized = false;
let dictionaryManagerActionInFlight = false;
let debugLogSnapshot = null;
let debugLogPending = "";
let debugLogFlushTimer = null;
const DEBUG_LOG_MAX_BYTES = 1000000;
const DEBUG_LOG_FLUSH_DELAY_MS = 750;

function pref(key, fallback) {
  const value = preferences.get(key);
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}
function preferenceValueToBool(value, fallback) {
  if (value === undefined || value === null || value === "") return !!fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return !!fallback;
    if (["true", "1", "yes", "on"].indexOf(normalized) >= 0) return true;
    if (["false", "0", "no", "off"].indexOf(normalized) >= 0) return false;
  }
  return !!value;
}
function prefBool(key, fallback) {
  return preferenceValueToBool(pref(key, fallback), fallback);
}
function prefNumber(key, fallback) {
  const value = Number(pref(key, fallback));
  return Number.isFinite(value) ? value : fallback;
}
function compactError(error) {
  const msg = error && error.message ? String(error.message) : String(error || "Unknown error");
  return msg.replace(/\s+/g, " ").slice(0, 1200);
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function showOSD(message) { try { core.osd(String(message || "")); } catch (_) {} }
function notify(message, kind, ttlMs) {
  const text = String(message || "");
  try { console.log(text); } catch (_) {}
  showOSD(text);
  try { setOverlayStatus(text, kind || "info", ttlMs || 12000); } catch (_) {}
}
function alert(message) { notify(message, "info", 14000); }
function logEnabled() {
  try { return prefBool("debugLogEnabled", true); } catch (_) { return true; }
}
function verboseLogEnabled() {
  try { return prefBool("debugLogVerbose", false); } catch (_) { return false; }
}
function formatDebugMessage(message, level) {
  return "[iinatan " + VERSION + "]" + (level ? "[" + level + "] " : " ") + String(message || "");
}
function emitToIinaLogViewer(message, level) {
  const formatted = formatDebugMessage(message, level || "debug");
  try {
    const logger = iina && iina.console ? iina.console : null;
    if (logger) {
      if (level === "error" && typeof logger.error === "function") logger.error(formatted);
      else if (level === "warn" && typeof logger.warn === "function") logger.warn(formatted);
      else if (typeof logger.log === "function") logger.log(formatted);
      else if (typeof logger.info === "function") logger.info(formatted);
    }
  } catch (_) {}
  try {
    const gconsole = globalThis && globalThis.console ? globalThis.console : null;
    if (gconsole) {
      if (level === "error" && typeof gconsole.error === "function") gconsole.error(formatted);
      else if (level === "warn" && typeof gconsole.warn === "function") gconsole.warn(formatted);
      else if (typeof gconsole.log === "function") gconsole.log(formatted);
    }
  } catch (_) {}
  try {
    if (typeof console !== "undefined") {
      if (level === "error" && typeof console.error === "function") console.error(formatted);
      else if (level === "warn" && typeof console.warn === "function") console.warn(formatted);
      else if (typeof console.log === "function") console.log(formatted);
    }
  } catch (_) {}
}
function debugLog(message, level) {
  if (!logEnabled()) return;
  const lvl = level || "debug";
  emitToIinaLogViewer(message, lvl);
  try {
    const line = (new Date()).toISOString() + " [main][" + lvl + "] " + String(message || "") + "\n";
    debugLogPending = trimDebugLogText(debugLogPending + line);
    scheduleDebugLogFlush();
  } catch (_) {}
}
function debugVerbose(message) {
  if (verboseLogEnabled()) debugLog(message, "verbose");
}
function debugWarn(message) { debugLog(message, "warn"); }
function debugError(message) { debugLog(message, "error"); }
function trimDebugLogText(text) {
  return String(text || "").slice(-DEBUG_LOG_MAX_BYTES);
}
function flushDebugLogBuffer() {
  if (debugLogFlushTimer !== null) {
    clearTimeout(debugLogFlushTimer);
    debugLogFlushTimer = null;
  }
  if (!debugLogPending) return;
  try {
    const p = dataPath("debug.log");
    if (debugLogSnapshot === null) {
      let prev = "";
      try { if (file.exists(p)) prev = String(file.read(p) || ""); } catch (_) {}
      debugLogSnapshot = trimDebugLogText(prev);
    }
    const nextSnapshot = trimDebugLogText(debugLogSnapshot + debugLogPending);
    file.write(p, nextSnapshot);
    debugLogSnapshot = nextSnapshot;
    debugLogPending = "";
  } catch (_) {
    debugLogPending = trimDebugLogText(debugLogPending);
  }
}
function scheduleDebugLogFlush() {
  if (debugLogFlushTimer !== null) return;
  debugLogFlushTimer = setTimeout(flushDebugLogBuffer, DEBUG_LOG_FLUSH_DELAY_MS);
}
function postToOverlay(name, data) {
  try { overlay.postMessage(name, data || {}); } catch (error) { try { debugLog("overlay.postMessage failed for " + name + ": " + compactError(error)); } catch (_) {} console.warn("overlay.postMessage failed: " + compactError(error)); }
}
function setOverlayStatus(message, kind, ttlMs) {
  if (statusTimer !== null) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  postToOverlay("status", { message: message || "", kind: kind || "info" });
  if (message && ttlMs && ttlMs > 0) {
    statusTimer = setTimeout(() => {
      statusTimer = null;
      postToOverlay("status", { message: "", kind: "info" });
    }, ttlMs);
  }
}
let taskStatusSerial = 0;
let activeOverlayTaskPayload = null;
function ensureTaskOverlayVisible() {
  try { initializeOverlay(); } catch (_) {}
  try { overlay.setOpacity(1); overlay.show(); } catch (_) {}
}
function postOverlayTask(payload) {
  if (!payload) return;
  ensureTaskOverlayVisible();
  postToOverlay("task-status", payload);
}
function replayActiveOverlayTask() {
  if (activeOverlayTaskPayload) {
    debugVerbose("replaying active task id=" + String(activeOverlayTaskPayload.id || ""));
    postOverlayTask(activeOverlayTaskPayload);
  }
}
function startOverlayTask(kind, title, message) {
  const id = String(kind || "task") + "-" + String(Date.now()) + "-" + String(++taskStatusSerial);
  const payload = {
    active: true,
    id,
    kind: kind || "task",
    title: title || "Working…",
    message: message || "",
    detail: "",
    startedAt: Date.now(),
    updatedAt: Date.now(),
    progress: null
  };
  activeOverlayTaskPayload = payload;
  debugLog("task start id=" + id + " title=" + payload.title + " message=" + payload.message);
  postOverlayTask(payload);
  setOverlayStatus(payload.title + (payload.message ? ": " + payload.message : ""), "info");
  showOSD(payload.title);
  return id;
}
function updateOverlayTask(id, patch) {
  if (!id) return;
  const payload = Object.assign({}, activeOverlayTaskPayload && activeOverlayTaskPayload.id === id ? activeOverlayTaskPayload : {}, { active: true, id, updatedAt: Date.now() }, patch || {});
  activeOverlayTaskPayload = payload;
  debugVerbose("task update id=" + id + " message=" + String(payload.message || "") + " detail=" + String(payload.detail || "").slice(0, 120));
  postOverlayTask(payload);
  if (payload.message) setOverlayStatus(payload.title ? (payload.title + ": " + payload.message) : payload.message, payload.kind === "error" ? "error" : "info");
}
function finishOverlayTask(id, ok, message, detail) {
  if (!id) return;
  const payload = Object.assign({}, activeOverlayTaskPayload && activeOverlayTaskPayload.id === id ? activeOverlayTaskPayload : {}, {
    active: false,
    id,
    success: !!ok,
    message: message || (ok ? "Done." : "Failed."),
    detail: detail || "",
    updatedAt: Date.now(),
    ttlMs: ok ? 6500 : 0
  });
  activeOverlayTaskPayload = ok ? null : payload;
  debugLog("task finish id=" + id + " ok=" + String(!!ok) + " message=" + payload.message);
  postOverlayTask(payload);
  setOverlayStatus(payload.message, ok ? "info" : "error", ok ? 6500 : 12000);
  showOSD(payload.message);
}
function recentNonEmptyLine(text) {
  const lines = String(text || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}
function pathJoin() {
  return Array.prototype.slice.call(arguments)
    .filter(part => part !== null && part !== undefined && String(part).length)
    .map((part, index) => {
      const s = String(part);
      if (index === 0) return s.replace(/\/+$/, "");
      return s.replace(/^\/+|\/+$/g, "");
    })
    .join("/");
}
let cachedDataRoot = null;
let cachedPluginRoot = null;
function dataRoot() {
  if (cachedDataRoot) return cachedDataRoot;
  const resolved = utils.resolvePath("@data/");
  if (!resolved || String(resolved).charAt(0) !== "/") {
    throw new Error("Could not resolve @data/ to an absolute plugin data directory; got: " + String(resolved));
  }
  cachedDataRoot = String(resolved).replace(/\/+$/, "");
  return cachedDataRoot;
}
function parentDir(path) {
  const s = String(path || "").replace(/\/+$/, "");
  const idx = s.lastIndexOf("/");
  return idx > 0 ? s.slice(0, idx) : "";
}
function isPluginRoot(path) {
  try { return !!path && file.exists(pathJoin(path, "Info.json")) && file.exists(pathJoin(path, "main.js")); } catch (_) { return false; }
}
function normalizeFileUrlPath(path) {
  let s = String(path || "");
  if (s.indexOf("file://") === 0) s = s.replace(/^file:\/\//, "");
  try { s = decodeURIComponent(s); } catch (_) {}
  return s;
}
function pluginRootFromStack() {
  try {
    const stack = String((new Error()).stack || "");
    const match = stack.match(/(?:file:\/\/)?(\/[^)\n]+\/main\.js)(?::\d+)?/);
    if (match && match[1]) return parentDir(normalizeFileUrlPath(match[1]));
  } catch (_) {}
  return "";
}
function pluginRoot() {
  if (cachedPluginRoot) return cachedPluginRoot;
  const candidates = [];
  try { candidates.push(utils.resolvePath(".")); } catch (_) {}
  try { candidates.push(utils.resolvePath("./")); } catch (_) {}
  candidates.push(pluginRootFromStack());
  for (const candidate of candidates) {
    const root = String(candidate || "").replace(/\/+$/, "");
    if (root && root.charAt(0) === "/" && isPluginRoot(root)) {
      cachedPluginRoot = root;
      return cachedPluginRoot;
    }
  }
  throw new Error("Could not locate the iinatan plugin folder.");
}
function dataPath() { return pathJoin.apply(null, [dataRoot()].concat(Array.prototype.slice.call(arguments))); }
function bundledBinPath() { return pathJoin(pluginRoot(), "bin", "iina-hoshi-dicts"); }
function binPath() { return pathJoin(dataRoot(), "bin", "iina-hoshi-dicts"); }
function dictRoot() { return pathJoin(dataRoot(), "dictionaries"); }
function downloadRoot() { return pathJoin(dataRoot(), "downloads"); }
function buildRoot() { return pathJoin(dataRoot(), "build"); }
function manifestPath() { return pathJoin(dataRoot(), "manifest.json"); }
function workerRoot() { return pathJoin(dataRoot(), "worker"); }
function workerQueueDir() { return pathJoin(workerRoot(), "queue"); }
function workerResponseDir() { return pathJoin(workerRoot(), "responses"); }
function workerStateDir() { return pathJoin(workerRoot(), "state"); }
function workerConfigPath() { return pathJoin(workerRoot(), "config.tsv"); }
function workerPidPath() { return pathJoin(workerRoot(), "worker.pid"); }
function workerStopPath() { return pathJoin(workerRoot(), "stop"); }
function workerReadyPath() { return pathJoin(workerStateDir(), "ready.json"); }
function workerLogPath() { return pathJoin(workerRoot(), "worker.log"); }
function workerStartScriptPath() { return pathJoin(workerRoot(), "start_worker.sh"); }

async function execChecked(command, args, cwd, stdoutHook, stderrHook) {
  const result = await utils.exec(command, args || [], cwd || undefined, stdoutHook, stderrHook);
  if (!result || result.status !== 0) {
    throw new Error(command + " exited with " + (result ? result.status : "unknown") + ": " + ((result && result.stderr) || (result && result.stdout) || ""));
  }
  return result;
}
async function ensureDataDirs() {
  await execChecked("/bin/mkdir", ["-p", dataRoot(), pathJoin(dataRoot(), "bin"), dictRoot(), downloadRoot(), buildRoot(), workerRoot(), workerQueueDir(), workerResponseDir(), workerStateDir()]);
}
function safeDelete(path) { try { if (file.exists(path)) file.delete(path); } catch (_) {} }
async function clearDirFiles(dir) {
  try {
    if (!file.exists(dir)) return;
    const items = file.list(dir, { includeSubDir: false }) || [];
    for (const item of items) if (item && !item.isDir) safeDelete(item.path);
  } catch (_) {}
}
