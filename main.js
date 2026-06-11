/**
 * iinatan for IINA 1.6.0+
 *
 * v1.2.4 architecture:
 * - No Yomitan browser-extension API dependency.
 * - No local HTTP server.
 * - Uses Manhhao/hoshidicts through a persistent filesystem-backed native worker.
 * - The worker keeps DictionaryQuery + Lookup in memory and accepts one lookup request file at a time.
 */

const { core, mpv, event, overlay, menu, input, ws, preferences, console, file, http, utils } = iina;

const VERSION = "1.6.0";
const RECOMMENDED_JITENDEX_URL = "https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip";

let enabled = false;
let initialized = false;
let pollTimer = null;
let lastSubtitle = null;
let nativeSubVisibilityBeforeEnable = null;
let requestSerial = 0;
let lookupInFlight = Object.create(null);
let lookupCache = Object.create(null);
let statusTimer = null;
let workerStartInFlight = null;
let activeWorkerFingerprint = null;
let subtitleLineSerial = 0;
let currentSubtitleLineId = 0;
let lineLookupTimer = null;
let linePrecomputeActiveLineId = 0;
let priorityLookupPositionsByLine = Object.create(null);
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
let overlayBridgeStarted = false;
let overlayBridgePort = 19741;

function pref(key, fallback) {
  const value = preferences.get(key);
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}
function prefBool(key, fallback) {
  const value = pref(key, fallback);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return !!value;
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
  try { return prefBool("debugLogVerbose", true); } catch (_) { return true; }
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
    const p = dataPath("debug.log");
    let prev = "";
    try { if (file.exists(p)) prev = String(file.read(p) || ""); } catch (_) {}
    const line = (new Date()).toISOString() + " [main][" + lvl + "] " + String(message || "") + "\n";
    file.write(p, (prev + line).slice(-1000000));
  } catch (_) {}
}
function debugVerbose(message) {
  if (verboseLogEnabled()) debugLog(message, "verbose");
}
function debugWarn(message) { debugLog(message, "warn"); }
function debugError(message) { debugLog(message, "error"); }
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
function dataRoot() {
  if (cachedDataRoot) return cachedDataRoot;
  const resolved = utils.resolvePath("@data/");
  if (!resolved || String(resolved).charAt(0) !== "/") {
    throw new Error("Could not resolve @data/ to an absolute plugin data directory; got: " + String(resolved));
  }
  cachedDataRoot = String(resolved).replace(/\/+$/, "");
  return cachedDataRoot;
}
function dataPath() { return pathJoin.apply(null, [dataRoot()].concat(Array.prototype.slice.call(arguments))); }
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

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
function cleanSubtitleText(text) {
  return decodeEntities(String(text || ""))
    .replace(/\uFEFF/g, "")
    .replace(/\{\\[^}]+\}/g, "")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+\n/g, "\n")
    .replace(/\n[ \t\f\v]+/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/[ \t\f\v]{2,}/g, " ")
    .trim();
}
function isJapaneseish(text) { return /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶー]/.test(text || ""); }
function mpvStringProp(names, fallback) {
  for (const name of names) {
    try {
      const value = mpv.getString(name);
      if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    } catch (_) {}
  }
  return fallback;
}
function sanitizeFontFamily(font) {
  const raw = String(font || "").trim();
  if (!raw) return '"Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif';
  if (/[,"]/.test(raw)) return raw;
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(raw)) return raw;
  return '"' + raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '", "Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", sans-serif';
}
function mpvNumberProp(names, fallback) {
  for (const name of names) {
    try {
      const raw = mpv.getString(name);
      if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        const value = Number(String(raw).trim());
        if (Number.isFinite(value)) return value;
      }
    } catch (_) {}
  }
  return fallback;
}
function mpvBoolProp(names, fallback) {
  for (const name of names) {
    try {
      const raw = mpv.getString(name);
      if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
        const s = String(raw).trim().toLowerCase();
        if (["yes", "true", "1", "on"].indexOf(s) >= 0) return true;
        if (["no", "false", "0", "off"].indexOf(s) >= 0) return false;
      }
    } catch (_) {}
  }
  return fallback;
}
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function cssColorFromMpv(raw, fallback) {
  const value = String(raw || "").trim();
  if (!value) return fallback;
  if (/^(rgb|rgba|hsl|hsla)\(/i.test(value)) return value;
  const hex = value.replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return "#" + hex;
  }
  if (/^[0-9a-fA-F]{8}$/.test(hex)) {
    // mpv style colors are commonly #AARRGGBB.
    const a = parseInt(hex.slice(0, 2), 16) / 255;
    const r = parseInt(hex.slice(2, 4), 16);
    const g = parseInt(hex.slice(4, 6), 16);
    const b = parseInt(hex.slice(6, 8), 16);
    return "rgba(" + r + "," + g + "," + b + "," + Math.round(a * 1000) / 1000 + ")";
  }
  return fallback;
}
function readMpvColor(names, fallback) {
  for (const name of names) {
    try {
      const raw = mpv.getString(name);
      const parsed = cssColorFromMpv(raw, "");
      if (parsed) return parsed;
    } catch (_) {}
  }
  return fallback;
}
function readSubtitleFontFamily() {
  // Best effort: this reads the IINA/mpv configured subtitle font. Embedded ASS
  // subtitle fonts are rendered by mpv/libass and are not exposed to this HTML
  // overlay, so external subtitle preference font is the reliable source here.
  const configured = mpvStringProp(["options/sub-font", "sub-font"], "");
  return sanitizeFontFamily(configured);
}
function readSubtitleStyleConfig() {
  const fontSize = clampNumber(mpvNumberProp(["options/sub-font-size", "sub-font-size"], 0), 18, 120, 0);
  const borderSize = clampNumber(mpvNumberProp(["options/sub-border-size", "sub-border-size"], 3), 0, 16, 3);
  const shadowOffset = clampNumber(mpvNumberProp(["options/sub-shadow-offset", "sub-shadow-offset"], 2), 0, 24, 2);
  const shadowBlur = clampNumber(mpvNumberProp(["options/sub-shadow-blur", "sub-shadow-blur"], Math.max(2, shadowOffset * 1.6)), 0, 32, Math.max(2, shadowOffset * 1.6));
  const bold = mpvBoolProp(["options/sub-bold", "sub-bold"], true);
  const italic = mpvBoolProp(["options/sub-italic", "sub-italic"], false);
  return {
    subtitleFontFamily: readSubtitleFontFamily(),
    subtitleFontSize: fontSize > 0 ? (String(fontSize) + "px") : "clamp(26px, 4.2vw, 64px)",
    subtitleFontWeight: bold ? "800" : "400",
    subtitleFontStyle: italic ? "italic" : "normal",
    subtitleColor: readMpvColor(["options/sub-color", "sub-color"], "#ffffff"),
    subtitleBorderColor: readMpvColor(["options/sub-border-color", "sub-border-color"], "#000000"),
    subtitleOutlineWidth: String(borderSize) + "px",
    subtitleShadowColor: readMpvColor(["options/sub-shadow-color", "sub-shadow-color"], "rgba(0,0,0,0.9)"),
    subtitleShadowOffset: String(shadowOffset) + "px",
    subtitleShadowBlur: String(shadowBlur) + "px"
  };
}
function overlayConfig() {
  return {
    fontScale: prefNumber("fontScale", 1.0),
    popupScale: prefNumber("popupScale", 0.92),
    popupMaxWidth: Math.max(260, prefNumber("popupMaxWidth", 440)),
    ...readSubtitleStyleConfig(),
    maxEntries: Math.max(1, prefNumber("maxEntries", 3)),
    maxGlossesPerEntry: Math.max(1, prefNumber("maxGlossesPerEntry", 4)),
    scanLength: Math.max(1, prefNumber("scanLength", 24)),
    hoverRequestTimeoutMs: Math.max(1500, prefNumber("hoverRequestTimeoutMs", 15000)),
    debugLogEnabled: prefBool("debugLogEnabled", true),
    debugLogVerbose: prefBool("debugLogVerbose", false),
    overlayBridgePort
  };
}
function readCurrentSubtitle() {
  let sub = "";
  try { sub = mpv.getString("sub-text") || ""; } catch (_) { sub = ""; }
  return cleanSubtitleText(sub);
}
function publishSubtitle(text) {
  const normalized = text || "";
  currentSubtitleLineId = ++subtitleLineSerial;
  priorityLookupPositionsByLine = Object.create(null);
  debugLog("publishSubtitle lineId=" + currentSubtitleLineId + " len=" + String(normalized || "").length + " text=" + JSON.stringify(String(normalized || "").slice(0, 80)));
  postToOverlay("subtitle", { text: normalized, config: overlayConfig(), lineId: currentSubtitleLineId });
  postToOverlay("line-lookup-reset", { lineId: currentSubtitleLineId });
  // v1.5.0: no full-line background precompute. Hover requests are looked up
  // directly and serialized so the hovered word is never blocked by a batch.
  ensureBackendWorker(activeDictionaryPaths()).catch(error => {
    debugLog("background worker warmup failed lineId=" + currentSubtitleLineId + ": " + compactError(error));
  });
}
function pollSubtitle() {
  if (!enabled) return;
  const sub = readCurrentSubtitle();
  if (sub === lastSubtitle) return;
  lastSubtitle = sub;
  publishSubtitle(sub);
}
function charsOf(text) { return Array.from(String(text || "")); }

function readManifest() {
  try {
    if (!file.exists(manifestPath())) return { dictionaries: {}, disabled: {} };
    const parsed = JSON.parse(file.read(manifestPath()));
    if (!parsed || typeof parsed !== "object") return { dictionaries: {}, disabled: {} };
    if (!parsed.dictionaries) parsed.dictionaries = {};
    if (!parsed.disabled) parsed.disabled = {};
    return parsed;
  } catch (_) { return { dictionaries: {}, disabled: {} }; }
}
function writeManifest(manifest) {
  try { file.write(manifestPath(), JSON.stringify(manifest || { dictionaries: {}, disabled: {} }, null, 2)); } catch (error) { console.warn("Could not write manifest: " + compactError(error)); }
}
function dictionaryDirs() {
  try {
    if (!file.exists(dictRoot())) return [];
    return file.list(dictRoot(), { includeSubDir: false })
      .filter(item => item && item.isDir)
      .map(item => ({ name: item.filename, path: item.path }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.warn("Could not list dictionaries: " + compactError(error));
    return [];
  }
}
function disabledDictionaryMap() { return readManifest().disabled || {}; }
function activeDictionaryPaths() {
  const installed = dictionaryDirs();
  const disabled = disabledDictionaryMap();
  const seen = Object.create(null);
  const out = [];
  installed.filter(d => !disabled[d.name]).forEach(d => {
    const p = pathJoin(dictRoot(), d.name);
    if (!seen[p]) { seen[p] = true; out.push(p); }
  });
  return out;
}
function workerFingerprint(dicts) { return (dicts || activeDictionaryPaths()).slice().sort().join("\n"); }
function setDictionaryEnabled(name, enabledNow) {
  const manifest = readManifest();
  if (!manifest.disabled) manifest.disabled = {};
  if (enabledNow) delete manifest.disabled[name]; else manifest.disabled[name] = true;
  writeManifest(manifest);
  lookupCache = Object.create(null);
  activeWorkerFingerprint = null;
  stopBackendWorker().catch(() => {});
  rebuildMenu();
  showOSD((enabledNow ? "Enabled" : "Disabled") + " dictionary: " + name);
}
function addSubMenuItemCompat(parent, item) {
  if (!parent) throw new Error("No parent menu item");
  if (typeof parent.addSubMenuItem === "function") return parent.addSubMenuItem(item);
  if (typeof parent.addSubmenuItem === "function") return parent.addSubmenuItem(item);
  throw new Error("This IINA build did not expose MenuItem.addSubMenuItem/addSubmenuItem");
}
function addMenuItemSafe(item) {
  try { menu.addItem(item); return true; }
  catch (error) { console.warn("Could not add menu item: " + compactError(error)); return false; }
}

function backendInstalled() { try { return file.exists(binPath()); } catch (_) { return false; } }
async function writeBackendSources() {
  await ensureDataDirs();
  file.write(dataPath("build", "iina_hoshi.cpp"), HOSHI_WRAPPER_CPP);
  file.write(dataPath("build", "build_hoshi_backend.sh"), BUILD_SCRIPT);
  await execChecked("/bin/chmod", ["755", pathJoin(buildRoot(), "build_hoshi_backend.sh")]);
}
async function buildOrUpdateBackend() {
  let log = "";
  let taskId = null;
  try {
    taskId = startOverlayTask("backend-build", "Building HoshiDicts backend", "Preparing build files…");
    await writeBackendSources();
    updateOverlayTask(taskId, { title: "Building HoshiDicts backend", message: "Running CMake/build script…", detail: "This can take a few minutes the first time." });
    const script = pathJoin(buildRoot(), "build_hoshi_backend.sh");
    let lastTaskUpdate = 0;
    const hook = data => {
      const chunk = String(data || "");
      log += chunk;
      const now = Date.now();
      if (now - lastTaskUpdate > 750) {
        lastTaskUpdate = now;
        const line = recentNonEmptyLine(log);
        if (line) updateOverlayTask(taskId, { title: "Building HoshiDicts backend", message: "Compiling native backend…", detail: line.slice(-260) });
      }
    };
    const result = await execChecked("/bin/bash", [script, dataRoot()], dataRoot(), hook, hook);
    log += "\n--- stdout ---\n" + String((result && result.stdout) || "");
    log += "\n--- stderr ---\n" + String((result && result.stderr) || "");
    try { file.write(dataPath("build", "last_build.log"), log); } catch (_) {}
    updateOverlayTask(taskId, { title: "Building HoshiDicts backend", message: "Finalizing…", detail: "Stopping old worker and refreshing menu." });
    activeWorkerFingerprint = null;
    await stopBackendWorker().catch(() => {});
    finishOverlayTask(taskId, true, "HoshiDicts backend ready.", "Build log saved to build/last_build.log.");
    console.log(result.stdout || log);
    rebuildMenu();
  } catch (error) {
    try { file.write(dataPath("build", "last_build.log"), log + "\n--- error ---\n" + compactError(error)); } catch (_) {}
    const message = "Could not build HoshiDicts backend.";
    finishOverlayTask(taskId, false, message, compactError(error) + "\nA full log was saved as build/last_build.log.");
    alert(message + " Details: " + compactError(error) + "\n\nA full log was saved to the plugin data folder as build/last_build.log.");
  }
}
async function extractFirstJsonObject(raw) {
  const s = String(raw || "").trim();
  const start = s.indexOf("{");
  if (start < 0) return s;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return s.slice(start);
}
function parseBackendJsonOutput(raw, stderr) {
  const text = String(raw || "").trim();
  try { return text ? JSON.parse(text) : null; } catch (_) {}
  const candidate = extractFirstJsonObject(text);
  if (candidate && candidate !== text) {
    try { return JSON.parse(candidate); } catch (_) {}
  }
  throw new Error("HoshiDicts backend returned incomplete or non-JSON output. stdoutBytes=" + text.length + " stdoutPrefix=" + text.slice(0, 260) + " stderr=" + String(stderr || "").slice(0, 260));
}

async function runBackendJson(args, timeoutMs) {
  if (!backendInstalled()) throw new Error("HoshiDicts backend is not installed. Use Plugin menu → Build/Update HoshiDicts Backend first.");
  let timer = null;
  const timeout = Math.max(1000, timeoutMs || prefNumber("backendTimeoutMs", 30000));
  try {
    debugVerbose("backend exec start cwd=" + dataRoot() + " bin=" + binPath() + " args=" + JSON.stringify(args || []));
    const execStartedAt = Date.now();
    const result = await Promise.race([
      utils.exec(binPath(), args || [], dataRoot()),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("HoshiDicts backend timed out after " + timeout + " ms")), timeout); })
    ]);
    if (!result) throw new Error("HoshiDicts backend returned no result");
    debugVerbose("backend exec done status=" + result.status + " elapsedMs=" + (Date.now() - execStartedAt) + " stdoutBytes=" + String(result.stdout || "").length + " stderr=" + String(result.stderr || "").slice(0, 600));
    const raw = String(result.stdout || "").trim();
    let parsed = parseBackendJsonOutput(raw, result.stderr);
    if (result.status !== 0 || (parsed && parsed.ok === false)) throw new Error((parsed && parsed.error) || result.stderr || ("HoshiDicts backend exit " + result.status));
    return parsed;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
function updateManifestAfterImport(importResult, zipPath) {
  if (!importResult || !importResult.title) return;
  const manifest = readManifest();
  manifest.dictionaries[importResult.title] = {
    title: importResult.title,
    zipPath: zipPath || "",
    importedAt: new Date().toISOString(),
    termCount: importResult.term_count || importResult.termCount || 0,
    metaCount: importResult.meta_count || importResult.metaCount || 0,
    tagCount: importResult.tag_count || importResult.tagCount || 0,
    mediaCount: importResult.media_count || importResult.mediaCount || 0
  };
  writeManifest(manifest);
}
async function importDictionaryZip(zipPath, existingTaskId) {
  if (!zipPath) return;
  let taskId = existingTaskId || null;
  const ownsTask = !taskId;
  try {
    await ensureDataDirs();
    if (!backendInstalled()) throw new Error("HoshiDicts backend is not installed. Use Plugin menu → Build/Update HoshiDicts Backend first.");
    if (!taskId) taskId = startOverlayTask("dictionary-import", "Installing dictionary", "Preparing import…");
    updateOverlayTask(taskId, { title: "Installing dictionary", message: "Importing Yomitan dictionary…", detail: "This can take several minutes for large dictionaries. IINA may not expose exact percentage progress." });
    const started = Date.now();
    const result = await runBackendJson(["import", zipPath, dictRoot(), prefBool("lowRamImport", true) ? "--low-ram" : "--normal-ram"], Math.max(30000, prefNumber("importTimeoutMs", 1800000)));
    if (!result || !result.ok) throw new Error((result && result.error) || "Import failed");
    updateOverlayTask(taskId, { title: "Installing dictionary", message: "Writing manifest…", detail: "Imported data; refreshing installed dictionaries." });
    updateManifestAfterImport(result, zipPath);
    activeWorkerFingerprint = null;
    updateOverlayTask(taskId, { title: "Installing dictionary", message: "Restarting lookup worker…", detail: "Stopping old worker so the new dictionary is used." });
    await stopBackendWorker().catch(() => {});
    rebuildMenu();
    const elapsed = Math.round((Date.now() - started) / 1000);
    const msg = "Imported " + result.title + " (" + (result.term_count || 0) + " terms).";
    if (ownsTask) finishOverlayTask(taskId, true, msg, "Import took about " + elapsed + " seconds.");
    else updateOverlayTask(taskId, { title: "Installing dictionary", message: msg, detail: "Import took about " + elapsed + " seconds." });
    return result;
  } catch (error) {
    if (ownsTask) finishOverlayTask(taskId, false, "Dictionary import failed.", compactError(error));
    throw error;
  }
}
async function chooseAndImportDictionary() {
  try {
    const zipPath = utils.chooseFile("Choose a Yomitan dictionary .zip", { allowedFileTypes: ["zip"] });
    if (!zipPath) return;
    await importDictionaryZip(zipPath);
  } catch (error) {
    const msg = "Dictionary import failed: " + compactError(error);
    setOverlayStatus(msg, "error", 12000);
    alert(msg);
  }
}
async function getRecommendedDictionaries() {
  let taskId = null;
  try {
    await ensureDataDirs();
    taskId = startOverlayTask("recommended-dictionary", "Installing recommended dictionary", "Downloading Jitendex…");
    const dest = pathJoin(downloadRoot(), "jitendex-yomitan.zip");
    updateOverlayTask(taskId, { title: "Installing recommended dictionary", message: "Downloading Jitendex…", detail: RECOMMENDED_JITENDEX_URL });
    await http.download(RECOMMENDED_JITENDEX_URL, dest);
    updateOverlayTask(taskId, { title: "Installing recommended dictionary", message: "Download complete. Importing…", detail: dest });
    const result = await importDictionaryZip(dest, taskId);
    const msg = "Installed " + result.title + " (" + (result.term_count || 0) + " terms).";
    finishOverlayTask(taskId, true, msg, "Recommended dictionary is ready for hover lookup.");
  } catch (error) {
    const msg = "Recommended dictionary install failed.";
    finishOverlayTask(taskId, false, msg, compactError(error));
    alert(msg + " Details: " + compactError(error));
  }
}
function homePathFromDataRoot() {
  const root = dataRoot();
  const marker = "/Library/Application Support/";
  const idx = root.indexOf(marker);
  if (idx > 0) return root.slice(0, idx);
  return root;
}
function backendLaunchPath() { return "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Xcode.app/Contents/Developer/usr/bin"; }
function writeWorkerConfig(dicts, fingerprint) {
  const lines = [
    "version\t" + VERSION,
    "fingerprint\t" + String(fingerprint || ""),
    "home\t" + homePathFromDataRoot(),
    "path\t" + backendLaunchPath()
  ];
  for (const d of dicts || []) lines.push("dict\t" + d);
  file.write(workerConfigPath(), lines.join("\n") + "\n");
}
async function writeWorkerStartScript() {
  const script = String.raw`#!/usr/bin/env bash
set -eu
DATA_ROOT="$1"
WORKER_ROOT="$DATA_ROOT/worker"
BIN="$DATA_ROOT/bin/iina-hoshi-dicts"
CONFIG="$WORKER_ROOT/config.tsv"
LOG="$WORKER_ROOT/worker.log"
PID="$WORKER_ROOT/worker.pid"
STOP="$WORKER_ROOT/stop"
READY="$WORKER_ROOT/state/ready.json"
mkdir -p "$WORKER_ROOT/queue" "$WORKER_ROOT/responses" "$WORKER_ROOT/state"
rm -f "$STOP" "$READY" "$PID"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Xcode.app/Contents/Developer/usr/bin:${"$"}{PATH:-}"
if [ -z "${"$"}{HOME:-}" ]; then
  HOME_FROM_DATA="${"$"}{DATA_ROOT%%/Library/Application Support/*}"
  if [ -n "$HOME_FROM_DATA" ] && [ "$HOME_FROM_DATA" != "$DATA_ROOT" ]; then
    export HOME="$HOME_FROM_DATA"
  else
    export HOME="$WORKER_ROOT/home"
    mkdir -p "$HOME"
  fi
fi
nohup "$BIN" worker "$WORKER_ROOT" > "$LOG" 2>&1 < /dev/null &
echo $! > "$PID"
`;
  file.write(workerStartScriptPath(), script);
  await execChecked("/bin/chmod", ["755", workerStartScriptPath()]);
}
async function stopBackendWorker() {
  try { await ensureDataDirs(); } catch (_) {}
  try { file.write(workerStopPath(), "stop\n"); } catch (_) {}
  try {
    if (file.exists(workerPidPath())) {
      const pid = String(file.read(workerPidPath()) || "").trim();
      if (/^\d+$/.test(pid)) await utils.exec("/bin/kill", ["-TERM", pid], dataRoot());
    }
  } catch (_) {}
  safeDelete(workerPidPath());
  safeDelete(workerReadyPath());
  activeWorkerFingerprint = null;
  await sleep(120);
}
async function startBackendWorkerProcess(dicts) {
  if (!backendInstalled()) throw new Error("HoshiDicts backend is not installed. Use Plugin menu → Build/Update HoshiDicts Backend first. Rebuild once after installing v1.2.4 because the native wrapper changed.");
  await ensureDataDirs();
  await clearDirFiles(workerQueueDir());
  await clearDirFiles(workerResponseDir());
  safeDelete(workerStopPath());
  safeDelete(workerReadyPath());
  const fingerprint = workerFingerprint(dicts);
  writeWorkerConfig(dicts, fingerprint);
  await writeWorkerStartScript();
  const res = await utils.exec("/bin/bash", [workerStartScriptPath(), dataRoot()], dataRoot());
  if (!res || res.status !== 0) throw new Error("Could not start HoshiDicts worker: " + ((res && (res.stderr || res.stdout)) || "unknown error"));
}
function readWorkerReady() {
  try {
    if (!file.exists(workerReadyPath())) return null;
    const parsed = JSON.parse(file.read(workerReadyPath()));
    if (parsed && parsed.ok) return parsed;
    return null;
  } catch (_) { return null; }
}
async function waitForWorkerReady(fingerprint, timeoutMs) {
  const deadline = Date.now() + Math.max(5000, timeoutMs || prefNumber("backendTimeoutMs", 30000));
  let last = null;
  while (Date.now() < deadline) {
    const ready = readWorkerReady();
    if (ready && ready.fingerprint === fingerprint) {
      activeWorkerFingerprint = fingerprint;
      setOverlayStatus("HoshiDicts worker ready.", "info", 2500);
      return ready;
    }
    last = ready;
    await sleep(180);
  }
  let logHint = "";
  try { if (file.exists(workerLogPath())) logHint = " Worker log: " + String(file.read(workerLogPath()) || "").slice(-900); } catch (_) {}
  throw new Error("HoshiDicts worker did not become ready." + (last ? " Last state: " + JSON.stringify(last).slice(0, 500) : "") + logHint);
}
async function ensureBackendWorker(dicts) {
  dicts = dicts || activeDictionaryPaths();
  if (!dicts.length) throw new Error("No enabled HoshiDicts dictionaries installed. Use Import Yomitan Dictionary ZIP or Get Recommended Dictionaries.");
  const fingerprint = workerFingerprint(dicts);
  if (activeWorkerFingerprint === fingerprint && readWorkerReady()) return readWorkerReady();
  if (workerStartInFlight) return workerStartInFlight;
  workerStartInFlight = (async () => {
    await stopBackendWorker().catch(() => {});
    setOverlayStatus("Loading HoshiDicts worker…", "info", 4000);
    await startBackendWorkerProcess(dicts);
    return await waitForWorkerReady(fingerprint, Math.max(8000, prefNumber("backendTimeoutMs", 30000)));
  })();
  try { return await workerStartInFlight; }
  finally { workerStartInFlight = null; }
}
async function clearPendingWorkerRequests() { await clearDirFiles(workerQueueDir()); }

function makeJsWorkerRequestId() {
  return "j" + String(Date.now()) + "-" + String(++requestSerial) + "-" + String(Math.floor(Math.random() * 1000000));
}
async function runWorkerQueueLookupDirect(suffix, dicts, scanLength, maxResults, requestId, timeoutMs) {
  const ensureStartedAt = Date.now();
  await ensureBackendWorker(dicts);
  const ensureElapsedMs = Date.now() - ensureStartedAt;
  const timeout = Math.max(1000, timeoutMs || prefNumber("lookupTimeoutMs", 9000));
  const id = makeJsWorkerRequestId();
  const req = pathJoin(workerQueueDir(), id + ".json");
  const resp = pathJoin(workerResponseDir(), id + ".json");
  const payload = {
    requestId: id,
    text: String(suffix || ""),
    scanLength: Math.max(1, Number(scanLength) || 24),
    maxResults: Math.max(1, Number(maxResults) || 1)
  };
  const startedAt = Date.now();
  debugVerbose("direct worker lookup write requestId=" + String(requestId || "") + " workerRequestId=" + id + " ensureMs=" + ensureElapsedMs + " text=" + JSON.stringify(String(suffix || "").slice(0, 80)));
  file.write(req, JSON.stringify(payload) + "\n");
  const deadline = startedAt + timeout;
  while (Date.now() < deadline) {
    if (file.exists(resp)) {
      const raw = String(file.read(resp) || "");
      safeDelete(resp);
      safeDelete(req);
      const parsed = parseBackendJsonOutput(raw, "");
      debugLog("direct worker lookup done requestId=" + String(requestId || "") + " workerRequestId=" + id + " elapsedMs=" + (Date.now() - startedAt) + " stdoutBytes=" + raw.length + " resultCount=" + (parsed && parsed.results ? parsed.results.length : "n/a"));
      if (!parsed || parsed.ok === false) throw new Error((parsed && parsed.error) || "Direct worker lookup failed");
      return parsed;
    }
    if (file.exists(workerStopPath())) {
      safeDelete(req);
      throw new Error("Worker stopped before direct lookup completed");
    }
    await sleep(Math.max(1, prefNumber("directIpcPollMs", 2)));
  }
  safeDelete(req);
  throw new Error("Direct worker lookup timed out after " + timeout + " ms");
}
async function runWorkerLookupViaClientExec(suffix, dicts, scanLength, maxResults, requestId, timeout) {
  await ensureBackendWorker(dicts);
  const clientArgs = [
    "client", workerRoot(),
    "--max-results", String(maxResults),
    "--scan-length", String(scanLength),
    "--timeout-ms", String(timeout),
    "--", suffix
  ];
  const lookupStartedAt = Date.now();
  const result = await runBackendJson(clientArgs, timeout + 2500);
  debugLog("client exec lookup result requestId=" + String(requestId || "") + " elapsedMs=" + (Date.now() - lookupStartedAt) + " resultCount=" + (result && result.results ? result.results.length : "n/a"));
  return result;
}
async function lookupViaWorker(suffix, dicts, scanLength, maxResults, requestId) {
  debugLog("lookupViaWorker begin requestId=" + String(requestId || "") + " suffix=" + JSON.stringify(String(suffix || "").slice(0, 80)) + " dicts=" + dicts.length + " directIpc=" + String(prefBool("directWorkerIpc", true)));
  if (requestId) postToOverlay("lookup-status", { requestId, message: "Starting HoshiDicts worker…" });
  const timeout = Math.max(1500, prefNumber("lookupTimeoutMs", 9000));

  if (prefBool("directWorkerIpc", true)) {
    try {
      const result = await runWorkerQueueLookupDirect(suffix, dicts, scanLength, maxResults, requestId, timeout);
      if (requestId) postToOverlay("lookup-status", { requestId, message: "Native lookup returned; rendering…" });
      return result;
    } catch (error) {
      debugWarn("direct worker lookup failed requestId=" + String(requestId || "") + ": " + compactError(error));
      if (!prefBool("fallbackToClientExec", true)) throw error;
    }
  }

  if (requestId) postToOverlay("lookup-status", { requestId, message: "Direct lookup unavailable; falling back to native client…" });
  const result = await runWorkerLookupViaClientExec(suffix, dicts, scanLength, maxResults, requestId, timeout);
  if (requestId) postToOverlay("lookup-status", { requestId, message: "Native lookup returned; rendering…" });
  if (!result || result.ok === false) throw new Error((result && result.error) || "Worker client lookup failed");
  return result;
}
async function lookupAtPosition(text, position, requestId) {
  const clean = cleanSubtitleText(text);
  const chars = charsOf(clean);
  const pos = Math.max(0, Math.min(Number(position) || 0, chars.length));
  const suffix = chars.slice(pos).join("");
  if (!suffix || !isJapaneseish(suffix[0])) return { ok: true, text: clean, position: pos, suffix, results: [] };
  const dicts = activeDictionaryPaths();
  if (!dicts.length) throw new Error("No enabled HoshiDicts dictionaries installed. Use Import Yomitan Dictionary ZIP or Get Recommended Dictionaries.");
  const scanLength = Math.max(1, prefNumber("scanLength", 24));
  // Keep native stdout small enough for IINA's utils.exec bridge. The popup
  // is driven by the top parsed expression anyway; additional native results
  // can make large Jitendex entries exceed stdout bridge limits.
  const maxResults = 1;
  // HoshiDicts only needs the text immediately to the right of the cursor.
  // Passing the whole subtitle line is wasteful and can create pathological
  // lookup work with long subtitle lines. Keep a bounded right-context.
  const lookupText = chars.slice(pos, pos + Math.min(chars.length - pos, scanLength)).join("");
  const key = dicts.join("|") + "\n" + lookupText + "\n" + scanLength + "\n" + maxResults;
  if (lookupCache[key]) {
    debugVerbose("lookupAtPosition cache hit pos=" + pos + " lookupText=" + JSON.stringify(lookupText));
    return lookupCache[key];
  }
  debugVerbose("lookupAtPosition cache miss pos=" + pos + " lookupText=" + JSON.stringify(lookupText));
  const result = await lookupViaWorker(lookupText, dicts, scanLength, maxResults, requestId);
  result.text = clean;
  result.position = pos;
  result.suffix = suffix;
  result.lookupText = lookupText;
  lookupCache[key] = result;
  return result;
}
function parseLookupPayload(payload) {
  // v1.2.4: prefer a tiny ASCII payload from the overlay: "requestId|position".
  // Sending the whole subtitle text through WebKit/IINA's overlay bridge appears unreliable on some IINA 1.4.x builds.
  if (typeof payload === "string") {
    const raw = payload;
    const pipe = raw.indexOf("|");
    if (pipe > 0 && /^\d/.test(raw.slice(0, pipe))) {
      return { requestId: raw.slice(0, pipe), position: Number(raw.slice(pipe + 1)), text: lastSubtitle || "" };
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.text !== "string") parsed.text = lastSubtitle || "";
      return parsed;
    }
    return { requestId: String(++requestSerial), position: 0, text: lastSubtitle || "" };
  }
  if (payload && typeof payload === "object") {
    if (typeof payload.text !== "string") payload.text = lastSubtitle || "";
    return payload;
  }
  return { requestId: String(++requestSerial), position: 0, text: lastSubtitle || "" };
}


function lookupPositionsForLine(text, scanLength) {
  const chars = charsOf(text);
  const positions = [];
  const limit = Math.min(chars.length, Math.max(1, prefNumber("maxLineLookupPositions", 64)));
  for (let i = 0; i < limit; i++) {
    if (isJapaneseish(chars[i])) positions.push(i);
  }
  return positions;
}
function scheduleLineLookupPrecompute(text, lineId) {
  if (lineLookupTimer !== null) {
    clearTimeout(lineLookupTimer);
    lineLookupTimer = null;
  }
  if (!enabled || !text || !isJapaneseish(text)) {
    postToOverlay("line-lookup-reset", { lineId });
    return;
  }
  lineLookupTimer = setTimeout(() => {
    lineLookupTimer = null;
    precomputeLineLookups(text, lineId).catch(error => {
      debugLog("line precompute top-level failed lineId=" + lineId + ": " + compactError(error));
      postToOverlay("line-lookup-progress", { lineId, ok: false, done: 0, total: 0, message: compactError(error) });
    });
  }, Math.max(20, prefNumber("lineLookupDelayMs", 120)));
}
async function precomputeLineLookups(text, lineId) {
  const clean = cleanSubtitleText(text);
  if (!enabled || lineId !== currentSubtitleLineId || !clean || !isJapaneseish(clean)) return;
  if (linePrecomputeActiveLineId && linePrecomputeActiveLineId === lineId) return;
  const dicts = activeDictionaryPaths();
  if (!backendInstalled()) {
    debugLog("line precompute skipped: backend not installed");
    postToOverlay("line-lookup-progress", { lineId, ok: false, done: 0, total: 0, message: "HoshiDicts backend is not installed. Build it from the plugin menu." });
    return;
  }
  if (!dicts.length) {
    debugLog("line precompute skipped: no enabled dictionaries");
    postToOverlay("line-lookup-progress", { lineId, ok: false, done: 0, total: 0, message: "No enabled dictionaries are installed." });
    return;
  }
  const scanLength = Math.max(1, prefNumber("scanLength", 24));
  const positions = lookupPositionsForLine(clean, scanLength);
  if (!positions.length) return;
  const pending = positions.slice();
  const pendingSet = Object.create(null);
  positions.forEach(p => { pendingSet[p] = true; });
  const processed = Object.create(null);
  function takeNextPosition() {
    const pri = priorityLookupPositionsByLine[lineId] || [];
    while (pri.length) {
      const p = pri.shift();
      if (pendingSet[p] && !processed[p]) {
        const idx = pending.indexOf(p);
        if (idx >= 0) pending.splice(idx, 1);
        delete pendingSet[p];
        return p;
      }
    }
    const p = pending.shift();
    if (p !== undefined) delete pendingSet[p];
    return p;
  }

  debugLog("line precompute start lineId=" + lineId + " len=" + charsOf(clean).length + " positions=" + positions.length);
  postToOverlay("line-lookup-progress", { lineId, ok: true, done: 0, total: positions.length, message: "Preparing dictionary lookups…" });
  try {
    await ensureBackendWorker(dicts);
  } catch (error) {
    debugLog("line precompute worker failed lineId=" + lineId + ": " + compactError(error));
    postToOverlay("line-lookup-progress", { lineId, ok: false, done: 0, total: positions.length, message: "Worker startup failed: " + compactError(error) });
    return;
  }

  linePrecomputeActiveLineId = lineId;
  let done = 0;
  try {
    while (pending.length || ((priorityLookupPositionsByLine[lineId] || []).length && done < positions.length)) {
      if (!enabled || lineId !== currentSubtitleLineId) {
        debugLog("line precompute cancelled lineId=" + lineId + " at done=" + done);
        return;
      }
      const pos = takeNextPosition();
      if (pos === undefined || processed[pos]) continue;
      processed[pos] = true;
      try {
        const result = await lookupAtPosition(clean, pos, null);
        done++;
        postToOverlay("line-lookup-result", { lineId, position: pos, ok: true, result });
        debugLog("line lookup result lineId=" + lineId + " pos=" + pos + " count=" + (result && result.results ? result.results.length : 0));
      } catch (error) {
        done++;
        const msg = compactError(error);
        postToOverlay("line-lookup-result", { lineId, position: pos, ok: false, error: msg });
        debugLog("line lookup failed lineId=" + lineId + " pos=" + pos + ": " + msg);
      }
      if (done === positions.length || done % 3 === 0) {
        postToOverlay("line-lookup-progress", { lineId, ok: true, done, total: positions.length, message: "Prepared " + done + "/" + positions.length + " lookup positions." });
      }
      await sleep(Math.max(0, prefNumber("lineLookupYieldMs", 10)));
    }
    debugLog("line precompute done lineId=" + lineId + " total=" + positions.length);
    postToOverlay("line-lookup-progress", { lineId, ok: true, done, total: positions.length, message: "Dictionary lookups ready." });
  } finally {
    if (linePrecomputeActiveLineId === lineId) linePrecomputeActiveLineId = 0;
  }
}

async function handleLookupAt(payload) {
  try {
    payload = parseLookupPayload(payload);
  } catch (error) {
    const requestId = String(++requestSerial);
    debugLog("lookup payload parse failed: " + compactError(error) + " raw=" + String(payload).slice(0, 300));
    postToOverlay("lookup-result", { requestId, ok: false, error: "Could not parse lookup payload: " + compactError(error) });
    return;
  }
  const requestId = payload && payload.requestId ? String(payload.requestId) : String(++requestSerial);
  const text = payload && typeof payload.text === "string" ? payload.text : (lastSubtitle || "");
  const position = payload && payload.position !== undefined ? Number(payload.position) : 0;
  debugLog("lookup-at received requestId=" + requestId + " pos=" + position + " textLen=" + String(text || "").length + " payloadType=" + typeof payload);
  postToOverlay("lookup-ack", { requestId, message: "Plugin received hover request." });
  postToOverlay("lookup-status", { requestId, message: "Plugin received hover request." });
  const inflightKey = cleanSubtitleText(text) + "\n" + position;
  try {
    if (!lookupInFlight[inflightKey]) lookupInFlight[inflightKey] = lookupAtPosition(text, position, requestId).finally(() => { delete lookupInFlight[inflightKey]; });
    const result = await lookupInFlight[inflightKey];
    debugLog("lookup success requestId=" + requestId + " resultCount=" + (result && result.results ? result.results.length : 0));
    postToOverlay("lookup-result", { requestId, ok: true, result });
  } catch (error) {
    debugLog("lookup failed requestId=" + requestId + ": " + compactError(error));
    postToOverlay("lookup-result", { requestId, ok: false, error: compactError(error) });
  }
}


function ensureOverlayBridge() {
  if (overlayBridgeStarted) return;
  overlayBridgeStarted = true;
  if (!ws || typeof ws.createServer !== "function") {
    debugLog("overlay bridge unavailable: IINA ws API missing");
    return;
  }
  try {
    ws.createServer({ port: overlayBridgePort });
    ws.onStateUpdate((state, error) => {
      debugLog("overlay bridge state=" + String(state) + (error ? " error=" + compactError(error.message || error.description || error) : ""));
    });
    ws.onNewConnection((conn, info) => {
      debugLog("overlay bridge connection=" + conn + " path=" + (info && info.path ? info.path : ""));
    });
    ws.onConnectionStateUpdate((conn, state, error) => {
      debugLog("overlay bridge conn=" + conn + " state=" + String(state) + (error ? " error=" + compactError(error.message || error.description || error) : ""));
    });
    ws.onMessage((conn, message) => {
      try {
        const raw = message && typeof message.text === "function" ? String(message.text() || "") : "";
        debugLog("overlay bridge message=" + raw.slice(0, 200));
        let payload = raw;
        try { payload = JSON.parse(raw); } catch (_) {}
        if (payload && typeof payload === "object" && payload.type === "popup") {
          handleLookupPopupVisibility(payload);
        } else if (payload && typeof payload === "object" && payload.type === "lookup") {
          handleBridgeLookup(payload);
        } else if (payload && typeof payload === "object" && payload.type === "overlay-log") {
          debugVerbose("[overlay] " + String(payload.message || ""));
        } else if (raw === "popup:show" || raw === "show" || raw === "visible") {
          handleLookupPopupVisibility({ visible: true });
        } else if (raw === "popup:hide" || raw === "hide" || raw === "hidden") {
          handleLookupPopupVisibility({ visible: false });
        }
      } catch (error) {
        debugLog("overlay bridge message failed: " + compactError(error));
      }
    });
    ws.startServer();
    debugLog("overlay bridge starting on ws://127.0.0.1:" + overlayBridgePort);
  } catch (error) {
    debugLog("overlay bridge start failed: " + compactError(error));
  }
}

function handleBridgeLookup(payload) {
  const requestId = payload && payload.requestId !== undefined ? String(payload.requestId) : String(++requestSerial);
  const lineId = Number(payload && payload.lineId !== undefined ? payload.lineId : currentSubtitleLineId);
  const position = Math.max(0, Number(payload && payload.position !== undefined ? payload.position : 0) || 0);
  const key = String(lineId) + ":" + String(position);

  // Ack immediately. The overlay uses this to stop retrying the WebSocket lookup
  // request, so pause heartbeats + mouseenter spam cannot flood the lookup queue.
  postToOverlay("lookup-request-ack", { requestId, lineId, position });

  if (!enabled || lineId !== currentSubtitleLineId) {
    postToOverlay("line-lookup-result", { lineId, position, ok: false, error: "Subtitle line changed before lookup completed." });
    return;
  }

  if (hoverLookupActiveKey === key || (pendingHoverLookup && pendingHoverLookup.key === key)) {
    debugVerbose("hover lookup duplicate ignored requestId=" + requestId + " key=" + key + " activeKey=" + hoverLookupActiveKey + " pendingKey=" + (pendingHoverLookup && pendingHoverLookup.key ? pendingHoverLookup.key : ""));
    return;
  }

  pendingHoverLookup = { requestId, lineId, position, key, seq: ++hoverLookupSequence };
  debugLog("hover lookup queued requestId=" + requestId + " key=" + key + " currentLineId=" + currentSubtitleLineId + " inFlight=" + hoverLookupInFlight + " activeKey=" + hoverLookupActiveKey);
  processHoverLookupQueue();
}
function processHoverLookupQueue() {
  if (hoverLookupInFlight) return;
  hoverLookupInFlight = true;
  (async () => {
    try {
      while (pendingHoverLookup) {
        const job = pendingHoverLookup;
        pendingHoverLookup = null;
        const { requestId, lineId, position, key, seq } = job;
        hoverLookupActiveKey = key;
        if (!enabled || lineId !== currentSubtitleLineId) {
          postToOverlay("line-lookup-result", { lineId, position, ok: false, error: "Subtitle line changed before lookup completed." });
          hoverLookupActiveKey = "";
          continue;
        }
        try {
          postToOverlay("line-lookup-progress", { lineId, ok: true, done: 0, total: 1, message: "Looking up hovered word…" });
          debugLog("hover lookup start requestId=" + requestId + " key=" + key + " pendingNext=" + String(!!pendingHoverLookup));
          const hoverStartedAt = Date.now();
          const result = await lookupAtPosition(lastSubtitle || "", position, requestId);
          debugLog("hover lookup completed requestId=" + requestId + " key=" + key + " elapsedMs=" + (Date.now() - hoverStartedAt));
          if (!enabled || lineId !== currentSubtitleLineId) {
            hoverLookupActiveKey = "";
            continue;
          }
          postToOverlay("line-lookup-result", { lineId, position, ok: true, result, hover: true, requestId, seq });
          debugLog("hover lookup result requestId=" + requestId + " key=" + key + " count=" + (result && result.results ? result.results.length : 0));
        } catch (error) {
          if (!enabled || lineId !== currentSubtitleLineId) {
            hoverLookupActiveKey = "";
            continue;
          }
          const msg = compactError(error);
          postToOverlay("line-lookup-result", { lineId, position, ok: false, error: msg, hover: true, requestId, seq });
          debugLog("hover lookup failed requestId=" + requestId + " key=" + key + ": " + msg);
        } finally {
          if (hoverLookupActiveKey === key) hoverLookupActiveKey = "";
        }
      }
    } finally {
      hoverLookupInFlight = false;
      if (pendingHoverLookup) processHoverLookupQueue();
    }
  })();
}



function pauseState() {
  try { return !!mpv.getFlag("pause"); } catch (_) {}
  try { return !!core.status.paused; } catch (_) {}
  return false;
}
function setPauseState(paused) {
  try { mpv.set("pause", !!paused); return; } catch (_) {}
  try { if (paused) core.pause(); else core.resume(); } catch (_) {}
}
function clearLookupPopupWatchdog() {
  if (lookupPopupWatchdogTimer !== null) {
    clearTimeout(lookupPopupWatchdogTimer);
    lookupPopupWatchdogTimer = null;
  }
}
function finishLookupPopupPause(reason) {
  clearLookupPopupWatchdog();
  if (!lookupPopupPauseActive) return;
  lookupPopupPauseActive = false;
  lookupPopupPauseShouldResume = false;
  debugLog("lookup popup pause ended reason=" + String(reason || "unknown") + "; not resuming by design");
}
function scheduleLookupPopupWatchdog() {
  // v1.5.4 pause-only mode: no heartbeat watchdog is needed because the plugin
  // intentionally does not resume playback when the popup closes.
  clearLookupPopupWatchdog();
}
function handleLookupPopupVisibility(payload) {
  const visible = (payload === true) || payload === "show" || payload === "visible" || (payload && !!payload.visible);
  const seq = payload && typeof payload === "object" && payload.seq !== undefined ? Number(payload.seq) : null;
  if (seq !== null && Number.isFinite(seq)) {
    if (seq < lookupPopupLastSeq) {
      debugLog("ignoring stale popup visibility seq=" + seq + " lastSeq=" + lookupPopupLastSeq + " visible=" + String(visible));
      return;
    }
    lookupPopupLastSeq = seq;
  }
  if (!prefBool("pauseWhilePopupVisible", true)) return;
  if (lookupPopupPauseResumeTimer !== null) {
    clearTimeout(lookupPopupPauseResumeTimer);
    lookupPopupPauseResumeTimer = null;
  }
  debugVerbose("popup visibility event visible=" + String(visible) + " seq=" + String(seq) + " active=" + String(lookupPopupPauseActive) + " enabled=" + String(enabled));
  if (visible) {
    if (!enabled) return;
    lookupPopupLastHeartbeatAt = Date.now();
    lookupPopupPauseActive = true;
    lookupPopupPauseShouldResume = false;
    if (!pauseState()) {
      debugLog("lookup popup visible seq=" + String(seq) + "; pausing playback and not scheduling resume");
      setPauseState(true);
    } else {
      debugVerbose("lookup popup visible seq=" + String(seq) + "; playback already paused");
    }
    return;
  }
  debugVerbose("popup hidden received seq=" + String(seq));
  finishLookupPopupPause("hidden-seq-" + String(seq));
}
function resetLookupPopupPause() {
  if (lookupPopupPauseResumeTimer !== null) {
    clearTimeout(lookupPopupPauseResumeTimer);
    lookupPopupPauseResumeTimer = null;
  }
  clearLookupPopupWatchdog();
  lookupPopupPauseActive = false;
  lookupPopupPauseShouldResume = false;
  lookupPopupLastHeartbeatAt = 0;
}


function initializeOverlay() {
  ensureOverlayBridge();
  if (initialized) return;
  debugLog("initializeOverlay v" + VERSION + " initialized=" + initialized + " enabled=" + enabled);
  overlay.loadFile("overlay.html");
  overlay.setOpacity(1);
  overlay.setClickable(true);
  overlay.show();
  initialized = true;
  overlay.onMessage("ready", payload => {
    debugLog("overlay ready received payloadType=" + typeof payload);
    postToOverlay("config", overlayConfig());
    postToOverlay("enabled", { enabled });
    replayActiveOverlayTask();
    if (enabled) pollSubtitle();
  });
  overlay.onMessage("lookup-at", payload => { handleLookupAt(payload); });
  overlay.onMessage("lookup-at-lite", payload => { handleLookupAt(payload); });
  overlay.onMessage("lookup-popup-visibility", payload => { handleLookupPopupVisibility(payload); });
  overlay.onMessage("lookup-popup-visible", payload => { handleLookupPopupVisibility(payload); });
}
function startPolling() {
  debugLog("startPolling subtitlePollMs=" + Math.max(80, prefNumber("subtitlePollMs", 120)));
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = setInterval(pollSubtitle, Math.max(80, prefNumber("subtitlePollMs", 120)));
  pollSubtitle();
}
function stopPolling() {
  debugLog("stopPolling");
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  lastSubtitle = null;
  lookupInFlight = Object.create(null);
}
function setEnabled(next) {
  debugLog("setEnabled requested next=" + String(!!next) + " previous=" + String(enabled));
  enabled = !!next;
  initializeOverlay();
  overlay.setClickable(enabled);
  postToOverlay("enabled", { enabled });
  postToOverlay("config", overlayConfig());
  rebuildMenu();
  if (enabled) {
    try {
      nativeSubVisibilityBeforeEnable = mpv.getFlag("sub-visibility");
      if (prefBool("hideNativeSubtitles", true)) mpv.set("sub-visibility", false);
    } catch (error) { console.warn("Could not update native subtitle visibility: " + compactError(error)); }
    overlay.show();
    startPolling();
    showOSD("iinatan: On");
    if (!backendInstalled()) setOverlayStatus("HoshiDicts backend not installed. Use Plugin menu → Build/Update HoshiDicts Backend.", "error", 9000);
    else if (!activeDictionaryPaths().length) setOverlayStatus("No dictionaries installed. Use Plugin menu → Get Recommended Dictionaries.", "error", 9000);
    else ensureBackendWorker(activeDictionaryPaths()).catch(error => setOverlayStatus("HoshiDicts worker could not start: " + compactError(error), "error", 12000));
  } else {
    resetLookupPopupPause();
    stopPolling();
    publishSubtitle("");
    try { if (nativeSubVisibilityBeforeEnable !== null) mpv.set("sub-visibility", nativeSubVisibilityBeforeEnable); } catch (_) {}
    showOSD("iinatan: Off");
  }
}
function toggleFromShortcut(data) {
  try {
    if (data && data.isRepeat) return true;
    const now = Date.now();
    if (now - lastShortcutToggleAt < 280) return true;
    lastShortcutToggleAt = now;
    debugLog("shortcut Shift+H toggle enabled=" + String(enabled) + " -> " + String(!enabled));
    setEnabled(!enabled);
    return true;
  } catch (error) {
    console.error("Shift+H shortcut failed: " + compactError(error));
    return true;
  }
}
function registerShortcut() {
  if (shortcutRegistered) return;
  shortcutRegistered = true;
  try {
    // Prefer IINA's input module over menu keyBinding here. The menu shortcut could
    // turn the overlay on but then fail to turn it off while the overlay/webview was
    // active. We listen for mpv's uppercase H form, i.e. Shift+h.
    input.onKeyDown("H", toggleFromShortcut, input.PRIORITY_HIGH);
    debugLog("registered input shortcut H for Shift+H");
  } catch (error) {
    console.warn("Could not register H shortcut: " + compactError(error));
  }
  try {
    // Fallback for builds/configs that accept explicit modifier notation.
    input.onKeyDown("Shift+H", toggleFromShortcut, input.PRIORITY_HIGH);
    debugLog("registered input shortcut Shift+H fallback");
  } catch (error) {
    console.warn("Could not register Shift+H fallback: " + compactError(error));
  }
}

function mockLongestRightwardLookup(text, position, dictionary, scanLength) {
  const chars = charsOf(text);
  const suffix = chars.slice(position).join("");
  let best = "";
  const maxChars = Math.min(scanLength || 24, charsOf(suffix).length);
  for (let len = maxChars; len >= 1; len--) {
    const candidate = charsOf(suffix).slice(0, len).join("");
    if (dictionary.indexOf(candidate) >= 0) { best = candidate; break; }
  }
  return best;
}
function runLookupParserUnitTests() {
  const tests = [
    { text: "何回見てもきれいだ", pos: 0, dict: ["何", "何回", "回", "見る"], expected: "何回" },
    { text: "魔法をかけられるのは魔法使いだけだ", pos: 0, dict: ["魔法", "魔法使い", "使い"], expected: "魔法" },
    { text: "魔法をかけられるのは魔法使いだけだ", pos: 10, dict: ["魔法", "魔法使い", "使い"], expected: "魔法使い" },
    { text: "スポーツ選手は生まれたときからスポーツ選手？", pos: 0, dict: ["スポーツ", "選手", "スポーツ選手"], expected: "スポーツ選手" },
    { text: "掛けられる前に逃げる", pos: 0, dict: ["掛け", "掛ける", "掛けられる"], expected: "掛けられる" }
  ];
  const failures = [];
  for (const t of tests) {
    const got = mockLongestRightwardLookup(t.text, t.pos, t.dict, 24);
    if (got !== t.expected) failures.push(t.text + " @" + t.pos + " expected " + t.expected + " got " + got);
  }
  if (failures.length) alert("Lookup parser unit tests failed:\n" + failures.join("\n"));
  else alert("Lookup parser unit tests passed: " + tests.length + "/" + tests.length + ".");
}
function testBackendLookup() {
  (async () => {
    try {
      const result = await lookupAtPosition("魔法をかけられるのは魔法使いだけだ", 0);
      const count = result && result.results ? result.results.length : 0;
      alert("Backend lookup test returned " + count + " result(s). Top match: " + (count ? result.results[0].matched : "none"));
    } catch (error) { alert("Backend lookup test failed: " + compactError(error)); }
  })();
}
function restartBackendWorkerFromMenu() {
  (async () => {
    try {
      await stopBackendWorker();
      await ensureBackendWorker(activeDictionaryPaths());
      alert("HoshiDicts backend worker restarted. No HTTP server is running.");
    } catch (error) { alert("Could not restart HoshiDicts backend worker: " + compactError(error)); }
  })();
}
function stopBackendWorkerFromMenu() {
  (async () => { await stopBackendWorker(); alert("HoshiDicts backend worker stopped."); })();
}
function showInstalledDictionaries() {
  const dicts = dictionaryDirs();
  const disabled = disabledDictionaryMap();
  if (!dicts.length) { alert("No dictionaries installed yet. Use Get Recommended Dictionaries or Import Yomitan Dictionary ZIP."); return; }
  alert("Installed HoshiDicts dictionaries:\n\n" + dicts.map(d => (disabled[d.name] ? "[disabled] " : "[enabled] ") + d.name).join("\n"));
}
function emitDebugLogTestMessage() {
  debugLog("DEBUG TEST: plugin main log path works; enabled=" + String(enabled) + " lineId=" + currentSubtitleLineId + " bridgePort=" + overlayBridgePort);
  debugWarn("DEBUG TEST: warning level message");
  debugError("DEBUG TEST: error level message");
  showOSD("iinatan debug test emitted");
}
function revealDebugLogFile() {
  try {
    const p = dataPath("debug.log");
    if (!file.exists(p)) file.write(p, "");
    file.showInFinder(p);
  } catch (error) {
    notify("Could not reveal debug.log: " + compactError(error), "error", 8000);
  }
}

function lookupBenchmarkCases() {
  const sentences = [
    "魔法使いにはなれないのだ",
    "いいなぁ 魔法使いに生まれた人は。",
    "シーツよ　シーツ。",
    "煙色の布が欲しいんですが 忙しいならあとでも…。",
    "正確には彼女の記憶だけが頼りだった。",
    "昨日からずっと雨が降り続いている。",
    "この世界では魔法を使える者だけが選ばれる。",
    "彼は何も言わずに部屋を出て行った。",
    "知らない町で道に迷ってしまった。",
    "それでも私は諦めるつもりはない。",
    "本当に必要なものは目に見えない。",
    "急に風が強くなって窓が揺れた。",
    "明日の朝までに準備しておいてください。",
    "子供のころから星を見るのが好きだった。",
    "彼女は小さな声でありがとうと言った。"
  ];
  const out = [];
  sentences.forEach(sentence => {
    const chars = charsOf(cleanSubtitleText(sentence));
    for (let i = 0; i < chars.length; i++) {
      if (isJapaneseish(chars[i])) out.push({ sentence, position: i, char: chars[i] });
      if (out.length >= 80) break;
    }
  });
  return out.slice(0, 80);
}
function summarizeTimings(label, samples) {
  const ok = samples.filter(s => s.ok);
  const failed = samples.filter(s => !s.ok);
  const times = ok.map(s => s.elapsedMs).sort((a, b) => a - b);
  const pick = p => times.length ? times[Math.min(times.length - 1, Math.max(0, Math.floor((times.length - 1) * p)))] : 0;
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  return {
    label,
    total: samples.length,
    ok: ok.length,
    failed: failed.length,
    min: times[0] || 0,
    median: pick(0.5),
    p95: pick(0.95),
    max: times[times.length - 1] || 0,
    avg
  };
}
function logTimingSummary(summary) {
  debugLog("BENCH " + summary.label + " total=" + summary.total + " ok=" + summary.ok + " failed=" + summary.failed + " min=" + summary.min + "ms median=" + summary.median + "ms avg=" + summary.avg + "ms p95=" + summary.p95 + "ms max=" + summary.max + "ms");
}
async function runLookupPerformanceBenchmark() {
  try {
    debugLog("BENCH starting lookup performance benchmark directIpc=" + String(prefBool("directWorkerIpc", true)) + " fallback=" + String(prefBool("fallbackToClientExec", true)));
    showOSD("iinatan lookup benchmark started");
    const dicts = activeDictionaryPaths();
    if (!backendInstalled()) throw new Error("Backend is not installed.");
    if (!dicts.length) throw new Error("No enabled dictionaries installed.");
    await ensureBackendWorker(dicts);
    lookupCache = Object.create(null);

    const cases = lookupBenchmarkCases();
    const seqSamples = [];
    const seqStart = Date.now();
    for (let i = 0; i < Math.min(30, cases.length); i++) {
      const c = cases[i];
      const started = Date.now();
      try {
        const r = await lookupAtPosition(c.sentence, c.position, "bench-seq-" + i);
        seqSamples.push({ ok: true, elapsedMs: Date.now() - started, count: r && r.results ? r.results.length : 0 });
      } catch (error) {
        seqSamples.push({ ok: false, elapsedMs: Date.now() - started, error: compactError(error) });
      }
    }
    const seqSummary = summarizeTimings("sequential", seqSamples);
    seqSummary.wallMs = Date.now() - seqStart;
    logTimingSummary(seqSummary);
    debugLog("BENCH sequential wallMs=" + seqSummary.wallMs);

    lookupCache = Object.create(null);
    const burstCases = cases.slice(0, 40);
    const burstStart = Date.now();
    const burstSamples = await Promise.all(burstCases.map(async (c, i) => {
      const started = Date.now();
      try {
        const r = await lookupAtPosition(c.sentence, c.position, "bench-burst-" + i);
        return { ok: true, elapsedMs: Date.now() - started, count: r && r.results ? r.results.length : 0 };
      } catch (error) {
        return { ok: false, elapsedMs: Date.now() - started, error: compactError(error) };
      }
    }));
    const burstSummary = summarizeTimings("burst40", burstSamples);
    burstSummary.wallMs = Date.now() - burstStart;
    logTimingSummary(burstSummary);
    debugLog("BENCH burst40 wallMs=" + burstSummary.wallMs);

    const failed = seqSamples.concat(burstSamples).filter(s => !s.ok).slice(0, 5);
    if (failed.length) debugWarn("BENCH failures sample=" + JSON.stringify(failed));
    showOSD("iinatan benchmark done: seq median " + seqSummary.median + "ms, burst p95 " + burstSummary.p95 + "ms");
    alert("Lookup benchmark complete.\n\nSequential median: " + seqSummary.median + " ms\nSequential p95: " + seqSummary.p95 + " ms\nBurst p95: " + burstSummary.p95 + " ms\n\nSee debug.log / IINA Log Viewer for full details.");
  } catch (error) {
    const msg = "Lookup benchmark failed: " + compactError(error);
    debugError(msg);
    alert(msg);
  }
}

function showTaskPanelTest() {
  const id = startOverlayTask("debug-task", "Task panel test", "This is where build/import progress appears.");
  updateOverlayTask(id, { title: "Task panel test", message: "Visible at top-center of the video overlay.", detail: "If you can see this panel, backend build and dictionary import progress should also be visible here." });
  setTimeout(() => finishOverlayTask(id, true, "Task panel test complete.", "The task panel will auto-hide shortly."), 4500);
}

function rebuildMenu() {
  try { menu.removeAllItems(); } catch (_) {}
  try {
    addMenuItemSafe(menu.item("Toggle iinatan (Shift+H)", () => setEnabled(!enabled), { selected: enabled }));

    const dictMenu = menu.item("Dictionaries");
    addSubMenuItemCompat(dictMenu, menu.item("Get Recommended Dictionaries", () => { getRecommendedDictionaries(); }));
    addSubMenuItemCompat(dictMenu, menu.item("Import Yomitan Dictionary ZIP…", () => { chooseAndImportDictionary(); }));
    addSubMenuItemCompat(dictMenu, menu.separator());
    const disabled = disabledDictionaryMap();
    const dicts = dictionaryDirs();
    if (!dicts.length) addSubMenuItemCompat(dictMenu, menu.item("No dictionaries installed", null, { enabled: false }));
    else {
      for (const d of dicts) {
        const isEnabled = !disabled[d.name];
        addSubMenuItemCompat(dictMenu, menu.item(d.name, () => setDictionaryEnabled(d.name, !isEnabled), { selected: isEnabled }));
      }
      addSubMenuItemCompat(dictMenu, menu.separator());
      addSubMenuItemCompat(dictMenu, menu.item("Show Installed Dictionaries", () => showInstalledDictionaries()));
    }
    addMenuItemSafe(dictMenu);

    const backendMenu = menu.item("Backend");
    addSubMenuItemCompat(backendMenu, menu.item("Build/Update HoshiDicts Backend", () => { buildOrUpdateBackend(); }));
    addSubMenuItemCompat(backendMenu, menu.item("Test Backend Lookup", () => testBackendLookup()));
    addSubMenuItemCompat(backendMenu, menu.item("Restart Backend Worker", () => restartBackendWorkerFromMenu()));
    addSubMenuItemCompat(backendMenu, menu.item("Stop Backend Worker", () => stopBackendWorkerFromMenu()));
    addMenuItemSafe(backendMenu);

    const debugMenu = menu.item("Debug");
    addSubMenuItemCompat(debugMenu, menu.item("Run Lookup Performance Benchmark", () => runLookupPerformanceBenchmark()));
    addSubMenuItemCompat(debugMenu, menu.item("Run Lookup Parser Unit Tests", () => runLookupParserUnitTests()));
    addSubMenuItemCompat(debugMenu, menu.item("Show Task Panel Test", () => showTaskPanelTest()));
    addSubMenuItemCompat(debugMenu, menu.item("Emit Debug Log Test Message", () => emitDebugLogTestMessage()));
    addSubMenuItemCompat(debugMenu, menu.item("Reveal Debug Log File", () => revealDebugLogFile()));
    addSubMenuItemCompat(debugMenu, menu.item("Reveal Plugin Data Folder", () => { try { file.showInFinder(dataRoot()); } catch (_) { utils.open(dataRoot()); } }));
    addMenuItemSafe(debugMenu);
  } catch (error) {
    console.error("Could not rebuild iinatan menu: " + compactError(error));
  }
}

const BUILD_SCRIPT = String.raw`#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Xcode.app/Contents/Developer/usr/bin:$PATH"
DATA_ROOT="$1"
if ! printenv HOME >/dev/null 2>&1 || [ -z "$(printenv HOME)" ]; then
  HOME_FROM_DATA="$(printf "%s\\n" "$DATA_ROOT" | sed 's#/Library/Application Support/.*##')"
  if [ -n "$HOME_FROM_DATA" ] && [ "$HOME_FROM_DATA" != "$DATA_ROOT" ]; then
    export HOME="$HOME_FROM_DATA"
  else
    export HOME="$DATA_ROOT/home"
    mkdir -p "$HOME"
  fi
fi
export GIT_TERMINAL_PROMPT=0
SRC_DIR="$DATA_ROOT/vendor/hoshidicts"
BIN_DIR="$DATA_ROOT/bin"
WRAPPER_SRC="$DATA_ROOT/build/iina_hoshi.cpp"
mkdir -p "$DATA_ROOT/vendor" "$BIN_DIR"
if ! command -v git >/dev/null 2>&1; then echo "git is required" >&2; exit 10; fi
if ! command -v cmake >/dev/null 2>&1; then echo "cmake is required. Install it with Homebrew or another package manager." >&2; exit 11; fi
GIT_URL_FIX_1="url.https://github.com/.insteadOf=git@github.com:"
GIT_URL_FIX_2="url.https://github.com/.insteadOf=ssh://git@github.com/"
if [ -d "$SRC_DIR" ] && [ ! -d "$SRC_DIR/.git" ]; then rm -rf "$SRC_DIR"; fi
if [ ! -d "$SRC_DIR/.git" ]; then git -c "$GIT_URL_FIX_1" -c "$GIT_URL_FIX_2" clone --depth 1 https://github.com/Manhhao/hoshidicts.git "$SRC_DIR"; fi
git -C "$SRC_DIR" remote set-url origin https://github.com/Manhhao/hoshidicts.git
git -c "$GIT_URL_FIX_1" -c "$GIT_URL_FIX_2" -C "$SRC_DIR" fetch --depth 1 origin main
git -C "$SRC_DIR" checkout main
git -C "$SRC_DIR" reset --hard origin/main
git -C "$SRC_DIR" config -f .gitmodules submodule.external/utf8proc.url https://github.com/JuliaStrings/utf8proc.git
git -C "$SRC_DIR" config submodule.external/utf8proc.url https://github.com/JuliaStrings/utf8proc.git
git -C "$SRC_DIR" submodule sync --recursive
git -C "$SRC_DIR" submodule deinit -f external/utf8proc >/dev/null 2>&1 || true
rm -rf "$SRC_DIR/.git/modules/external/utf8proc" "$SRC_DIR/external/utf8proc"
git -c "$GIT_URL_FIX_1" -c "$GIT_URL_FIX_2" -C "$SRC_DIR" submodule update --init --recursive --depth 1
cp "$WRAPPER_SRC" "$SRC_DIR/cli/iina_hoshi.cpp"
if ! grep -q "iina-hoshi-dicts" "$SRC_DIR/CMakeLists.txt"; then
  cat >> "$SRC_DIR/CMakeLists.txt" <<'CMAKEEOF'

add_executable(iina-hoshi-dicts cli/iina_hoshi.cpp)
target_link_libraries(iina-hoshi-dicts PRIVATE hoshidicts)
CMAKEEOF
fi
cmake -S "$SRC_DIR" -B "$SRC_DIR/build-iina" -DCMAKE_BUILD_TYPE=Release
cmake --build "$SRC_DIR/build-iina" --target iina-hoshi-dicts --config Release -j "$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
cp "$SRC_DIR/build-iina/iina-hoshi-dicts" "$BIN_DIR/iina-hoshi-dicts"
chmod 755 "$BIN_DIR/iina-hoshi-dicts"
echo "installed $BIN_DIR/iina-hoshi-dicts"
`;


const HOSHI_WRAPPER_CPP = String.raw`#include <algorithm>
#include <chrono>
#include <cctype>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <functional>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "hoshidicts/deinflector.hpp"
#include "hoshidicts/importer.hpp"
#include "hoshidicts/lookup.hpp"
#include "hoshidicts/query.hpp"

static constexpr const char* WRAPPER_VERSION = "1.5.6";
namespace fs = std::filesystem;

static std::string json_escape(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 16);
  for (unsigned char c : s) {
    switch (c) {
      case '\\\\': out += "\\\\\\\\"; break;
      case '"': out += "\\\\\\""; break;
      case '\\b': out += "\\\\b"; break;
      case '\\f': out += "\\\\f"; break;
      case '\\n': out += "\\\\n"; break;
      case '\\r': out += "\\\\r"; break;
      case '\\t': out += "\\\\t"; break;
      default:
        if (c < 0x20) {
          const char* hex = "0123456789abcdef";
          out += "\\\\u00";
          out += hex[(c >> 4) & 0xf];
          out += hex[c & 0xf];
        } else out += static_cast<char>(c);
    }
  }
  return out;
}
static std::string json_quote(const std::string& s) { return std::string("\\"") + json_escape(s) + "\\""; }
static std::string error_json(const std::string& message) { return std::string("{\\"ok\\":false,\\"error\\":") + json_quote(message) + "}\\n"; }
static void print_error(const std::string& message) { std::cout << error_json(message); }
static void print_string_array(const std::vector<std::string>& values) {
  std::cout << "[";
  for (size_t i = 0; i < values.size(); ++i) { if (i) std::cout << ","; std::cout << json_quote(values[i]); }
  std::cout << "]";
}
static int to_int(const std::string& s, int fallback) { try { return std::stoi(s); } catch (...) { return fallback; } }
static std::string read_file(const fs::path& p) {
  std::ifstream in(p, std::ios::binary);
  std::ostringstream ss; ss << in.rdbuf(); return ss.str();
}
static void write_file_atomic(const fs::path& p, const std::string& data) {
  fs::create_directories(p.parent_path());
  fs::path tmp = p;
  tmp += ".tmp";
  { std::ofstream out(tmp, std::ios::binary | std::ios::trunc); out << data; }
  std::error_code ec;
  fs::rename(tmp, p, ec);
  if (ec) { fs::remove(p, ec); fs::rename(tmp, p, ec); }
  if (ec) throw std::runtime_error("could not write " + p.string() + ": " + ec.message());
}
static std::string utf8_prefix(const std::string& s, size_t max_bytes) {
  std::string out;
  out.reserve(std::min(max_bytes, s.size()));
  for (size_t i = 0; i < s.size();) {
    unsigned char c = static_cast<unsigned char>(s[i]);
    size_t n = 1;
    if ((c & 0x80) == 0) n = 1;
    else if ((c & 0xE0) == 0xC0) n = 2;
    else if ((c & 0xF0) == 0xE0) n = 3;
    else if ((c & 0xF8) == 0xF0) n = 4;
    if (i + n > s.size() || out.size() + n > max_bytes) break;
    out.append(s, i, n);
    i += n;
  }
  if (out.size() < s.size()) out += "…";
  return out;
}
static std::string compact_glossary(const std::string& s) {
  // Jitendex structured-content can be very large. Returning it in full via
  // IINA utils.exec stdout can stall the plugin bridge, so cap each glossary.
  return utf8_prefix(s, 1200);
}
static std::string lookup_to_json(Lookup& lookup, const std::string& lookup_string, int max_results, int scan_length) {
  auto results = lookup.lookup(lookup_string, max_results, static_cast<size_t>(std::max(1, scan_length)));
  std::ostringstream out;
  out << "{\\"ok\\":true,\\"lookupString\\":" << json_quote(lookup_string)
      << ",\\"scanLength\\":" << scan_length
      << ",\\"resultCount\\":" << results.size()
      << ",\\"results\\":[";
  for (size_t i = 0; i < results.size(); ++i) {
    const auto& r = results[i];
    if (i) out << ",";
    out << "{\\"matched\\":" << json_quote(r.matched)
        << ",\\"deinflected\\":" << json_quote(r.deinflected)
        << ",\\"preprocessorSteps\\":" << r.preprocessor_steps
        << ",\\"trace\\":[";
    for (size_t j = 0; j < r.trace.size(); ++j) {
      if (j) out << ",";
      out << "{\\"name\\":" << json_quote(r.trace[j].name)
          << ",\\"description\\":" << json_quote(r.trace[j].description) << "}";
    }
    out << "],\\"term\\":{\\"expression\\":" << json_quote(r.term.expression)
        << ",\\"reading\\":" << json_quote(r.term.reading)
        << ",\\"rules\\":" << json_quote(r.term.rules)
        << ",\\"glossaries\\":[";
    size_t glossary_limit = std::min<size_t>(r.term.glossaries.size(), 4);
    for (size_t g = 0; g < glossary_limit; ++g) {
      const auto& gl = r.term.glossaries[g];
      if (g) out << ",";
      out << "{\\"dict\\":" << json_quote(gl.dict_name)
          << ",\\"glossary\\":" << json_quote(compact_glossary(gl.glossary))
          << ",\\"definitionTags\\":" << json_quote(gl.definition_tags)
          << ",\\"termTags\\":" << json_quote(gl.term_tags) << "}";
    }
    out << "]}}";
  }
  out << "]}\\n";
  return out.str();
}
static std::string parse_json_string_at(const std::string& body, size_t& i) {
  std::string out;
  if (i >= body.size() || body[i] != '"') return out;
  ++i;
  while (i < body.size()) {
    char c = body[i++];
    if (c == '"') break;
    if (c == '\\\\' && i < body.size()) {
      char e = body[i++];
      switch (e) {
        case 'n': out += '\\n'; break;
        case 'r': out += '\\r'; break;
        case 't': out += '\\t'; break;
        case 'b': out += '\\b'; break;
        case 'f': out += '\\f'; break;
        case '\\\\': out += '\\\\'; break;
        case '"': out += '"'; break;
        default: out += e; break;
      }
    } else out += c;
  }
  return out;
}
static std::string json_get_string(const std::string& body, const std::string& key) {
  std::string pattern = "\\"" + key + "\\"";
  size_t k = body.find(pattern);
  if (k == std::string::npos) return "";
  size_t colon = body.find(':', k + pattern.size());
  if (colon == std::string::npos) return "";
  size_t i = colon + 1;
  while (i < body.size() && std::isspace(static_cast<unsigned char>(body[i]))) ++i;
  if (i < body.size() && body[i] == '"') return parse_json_string_at(body, i);
  size_t end = body.find_first_of(",}\\r\\n", i);
  if (end == std::string::npos) end = body.size();
  return body.substr(i, end - i);
}
static int json_get_int(const std::string& body, const std::string& key, int fallback) {
  std::string pattern = "\\"" + key + "\\"";
  size_t k = body.find(pattern);
  if (k == std::string::npos) return fallback;
  size_t colon = body.find(':', k + pattern.size());
  if (colon == std::string::npos) return fallback;
  size_t i = colon + 1;
  while (i < body.size() && std::isspace(static_cast<unsigned char>(body[i]))) ++i;
  size_t end = body.find_first_of(",}\\r\\n", i);
  if (end == std::string::npos) end = body.size();
  return to_int(body.substr(i, end - i), fallback);
}
static void cmd_import(int argc, char** argv) {
  if (argc < 4) { print_error("usage: import <zip_path> <output_dir> [--low-ram]"); std::exit(2); }
  std::string zip_path = argv[2];
  std::string output_dir = argv[3];
  bool low_ram = true;
  for (int i = 4; i < argc; ++i) { std::string arg = argv[i]; if (arg == "--normal-ram") low_ram = false; if (arg == "--low-ram") low_ram = true; }
  auto r = dictionary_importer::import(zip_path, output_dir, low_ram);
  std::cout << "{\\"ok\\":" << (r.success ? "true" : "false") << ",\\"title\\":" << json_quote(r.title)
            << ",\\"term_count\\":" << r.term_count << ",\\"meta_count\\":" << r.meta_count
            << ",\\"freq_count\\":" << r.freq_count << ",\\"pitch_count\\":" << r.pitch_count
            << ",\\"media_count\\":" << r.media_count << ",\\"tag_count\\":0,\\"errors\\":";
  print_string_array(r.errors);
  if (!r.success && !r.errors.empty()) std::cout << ",\\"error\\":" << json_quote(r.errors.front());
  std::cout << "}\\n";
  if (!r.success) std::exit(1);
}
static std::vector<std::string> parse_lookup_args(int argc, char** argv, std::string& lookup_string, int& max_results, int& scan_length) {
  std::vector<std::string> dict_paths;
  max_results = 8; scan_length = 24;
  for (int i = 2; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--max-results" && i + 1 < argc) max_results = std::max(1, to_int(argv[++i], max_results));
    else if (arg == "--scan-length" && i + 1 < argc) scan_length = std::max(1, to_int(argv[++i], scan_length));
    else if (arg == "--" && i + 1 < argc) { lookup_string = argv[++i]; break; }
    else dict_paths.push_back(arg);
  }
  return dict_paths;
}
static void cmd_lookup(int argc, char** argv) {
  std::string lookup_string; int max_results = 8; int scan_length = 24;
  auto dict_paths = parse_lookup_args(argc, argv, lookup_string, max_results, scan_length);
  if (dict_paths.empty()) { print_error("no dictionary paths supplied"); std::exit(2); }
  if (lookup_string.empty()) { print_error("no lookup string supplied"); std::exit(2); }
  DictionaryQuery dict_query;
  for (const auto& p : dict_paths) dict_query.add_term_dict(p);
  Deinflector deinflector;
  Lookup lookup(dict_query, deinflector);
  std::cout << lookup_to_json(lookup, lookup_string, max_results, scan_length);
}
struct WorkerConfig { std::string fingerprint; std::vector<std::string> dicts; };
static WorkerConfig read_worker_config(const fs::path& config_path) {
  WorkerConfig cfg;
  std::ifstream in(config_path);
  std::string line;
  while (std::getline(in, line)) {
    size_t tab = line.find('\\t');
    if (tab == std::string::npos) continue;
    std::string key = line.substr(0, tab);
    std::string val = line.substr(tab + 1);
    if (key == "fingerprint") cfg.fingerprint = val;
    else if (key == "dict") cfg.dicts.push_back(val);
  }
  return cfg;
}
static void cmd_worker(int argc, char** argv) {
  if (argc < 3) { print_error("usage: worker <worker_dir> [--sleep-ms n]"); std::exit(2); }
  fs::path root = argv[2];
  int sleep_ms = 2;
  for (int i = 3; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--sleep-ms" && i + 1 < argc) sleep_ms = std::max(1, to_int(argv[++i], sleep_ms));
  }
  fs::path queue = root / "queue";
  fs::path responses = root / "responses";
  fs::path state = root / "state";
  fs::path stop = root / "stop";
  fs::path config_path = root / "config.tsv";
  fs::create_directories(queue); fs::create_directories(responses); fs::create_directories(state);
  WorkerConfig cfg = read_worker_config(config_path);
  if (cfg.dicts.empty()) throw std::runtime_error("worker config has no dictionaries");
  DictionaryQuery dict_query;
  for (const auto& p : cfg.dicts) dict_query.add_term_dict(p);
  Deinflector deinflector;
  Lookup lookup(dict_query, deinflector);
  write_file_atomic(state / "ready.json", std::string("{\\"ok\\":true,\\"worker\\":true,\\"wrapperVersion\\":") + json_quote(WRAPPER_VERSION) + ",\\"fingerprint\\":" + json_quote(cfg.fingerprint) + ",\\"dictCount\\":" + std::to_string(cfg.dicts.size()) + "}\\n");
  std::cerr << "iina-hoshi-dicts worker ready with " << cfg.dicts.size() << " dictionaries; sleep_ms=" << sleep_ms << "\\n";
  while (!fs::exists(stop)) {
    std::vector<fs::path> requests;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(queue, ec)) {
      if (!entry.is_regular_file()) continue;
      if (entry.path().extension() == ".json") requests.push_back(entry.path());
    }
    std::sort(requests.begin(), requests.end());
    for (const auto& req : requests) {
      std::string request_id = req.stem().string();
      fs::path resp = responses / (request_id + ".json");
      try {
        std::string body = read_file(req);
        std::string provided_id = json_get_string(body, "requestId");
        if (!provided_id.empty()) request_id = provided_id;
        resp = responses / (request_id + ".json");
        std::string text = json_get_string(body, "text");
        int max_results = std::max(1, json_get_int(body, "maxResults", 8));
        int scan_length = std::max(1, json_get_int(body, "scanLength", 24));
        if (text.empty()) throw std::runtime_error("lookup request did not include text");
        std::cerr << "lookup request " << request_id << " text_bytes=" << text.size() << " scan=" << scan_length << " max=" << max_results << "\\n";
        std::string out = lookup_to_json(lookup, text, max_results, scan_length);
        write_file_atomic(resp, out);
        std::cerr << "lookup response " << request_id << " bytes=" << out.size() << "\\n";
      } catch (const std::exception& e) {
        write_file_atomic(resp, error_json(e.what()));
      }
      fs::remove(req, ec);
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms));
  }
  std::cerr << "iina-hoshi-dicts worker stopping\\n";
}

static long long now_millis() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
static std::string make_request_id() {
  auto wall = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
  auto tid = std::hash<std::thread::id>{}(std::this_thread::get_id());
  return std::string("c") + std::to_string(wall) + "-" + std::to_string(static_cast<unsigned long long>(tid));
}
static void cmd_client(int argc, char** argv) {
  if (argc < 4) { print_error("usage: client <worker_dir> [--max-results n] [--scan-length n] [--timeout-ms n] -- <lookup_string>"); std::exit(2); }
  fs::path root = argv[2];
  int max_results = 8;
  int scan_length = 24;
  int timeout_ms = 30000;
  std::string lookup_string;
  for (int i = 3; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--max-results" && i + 1 < argc) max_results = std::max(1, to_int(argv[++i], max_results));
    else if (arg == "--scan-length" && i + 1 < argc) scan_length = std::max(1, to_int(argv[++i], scan_length));
    else if (arg == "--timeout-ms" && i + 1 < argc) timeout_ms = std::max(1000, to_int(argv[++i], timeout_ms));
    else if (arg == "--" && i + 1 < argc) { lookup_string = argv[++i]; break; }
  }
  if (lookup_string.empty()) { print_error("no lookup string supplied"); std::exit(2); }
  fs::path queue = root / "queue";
  fs::path responses = root / "responses";
  fs::path state = root / "state";
  fs::path ready = state / "ready.json";
  fs::path stop = root / "stop";
  fs::create_directories(queue);
  fs::create_directories(responses);
  if (!fs::exists(ready)) { print_error("worker is not ready; no ready.json found"); std::exit(1); }
  if (fs::exists(stop)) { print_error("worker stop file exists; restart the worker"); std::exit(1); }
  std::string request_id = make_request_id();
  fs::path req = queue / (request_id + ".json");
  fs::path resp = responses / (request_id + ".json");
  std::ostringstream payload;
  payload << "{\\"requestId\\":" << json_quote(request_id)
          << ",\\"text\\":" << json_quote(lookup_string)
          << ",\\"scanLength\\":" << scan_length
          << ",\\"maxResults\\":" << max_results << "}\\n";
  write_file_atomic(req, payload.str());
  const long long deadline = now_millis() + timeout_ms;
  std::error_code ec;
  while (now_millis() < deadline) {
    if (fs::exists(resp)) {
      std::string body = read_file(resp);
      fs::remove(resp, ec);
      fs::remove(req, ec);
      std::cout << body;
      if (body.empty() || body.back() != '\\n') std::cout << "\\n";
      return;
    }
    if (fs::exists(stop)) { fs::remove(req, ec); print_error("worker stopped before lookup completed"); std::exit(1); }
    std::this_thread::sleep_for(std::chrono::milliseconds(25));
  }
  fs::remove(req, ec);
  print_error("worker client timed out after " + std::to_string(timeout_ms) + " ms waiting for response to " + request_id);
  std::exit(1);
}

static void cmd_version() {
  std::cout << "{\\"ok\\":true,\\"name\\":\\"iina-hoshi-dicts\\",\\"backend\\":\\"Manhhao/hoshidicts\\",\\"wrapperVersion\\":" << json_quote(WRAPPER_VERSION) << ",\\"worker\\":true,\\"serve\\":false}\\n";
}
int main(int argc, char** argv) {
  try {
    if (argc < 2) { print_error("expected command: import, lookup, worker, client, version"); return 2; }
    std::string command = argv[1];
    if (command == "import") cmd_import(argc, argv);
    else if (command == "lookup") cmd_lookup(argc, argv);
    else if (command == "worker") cmd_worker(argc, argv);
    else if (command == "client") cmd_client(argc, argv);
    else if (command == "version") cmd_version();
    else { print_error("unknown command: " + command); return 2; }
    return 0;
  } catch (const std::exception& e) { print_error(e.what()); return 1; }
  catch (...) { print_error("unknown native exception"); return 1; }
}
`;


registerShortcut();
rebuildMenu();

event.on("iina.window-loaded", () => {
  initializeOverlay();
  setEnabled(prefBool("enabledByDefault", false));
});
event.on("mpv.file-loaded", () => {
  lastSubtitle = null;
  lookupCache = Object.create(null);
  lookupInFlight = Object.create(null);
  if (enabled) pollSubtitle();
});
event.on("mpv.end-file", () => { resetLookupPopupPause(); publishSubtitle(""); });
try {
  if (core.window.loaded) {
    initializeOverlay();
    setEnabled(prefBool("enabledByDefault", false));
  }
} catch (_) {}
