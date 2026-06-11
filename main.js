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
let activeSubtitlePollMs = 0;
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
function importDropRoot() { return pathJoin(dataRoot(), "imports"); }
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
  await execChecked("/bin/mkdir", ["-p", dataRoot(), pathJoin(dataRoot(), "bin"), dictRoot(), downloadRoot(), importDropRoot(), buildRoot(), workerRoot(), workerQueueDir(), workerResponseDir(), workerStateDir()]);
}
function safeDelete(path) { try { if (file.exists(path)) file.delete(path); } catch (_) {} }
async function clearDirFiles(dir) {
  try {
    if (!file.exists(dir)) return;
    const items = file.list(dir, { includeSubDir: false }) || [];
    for (const item of items) if (item && !item.isDir) safeDelete(item.path);
  } catch (_) {}
}

const IINATAN_LANGUAGE_COMMON = (() => {
  const JAPANESE_CHAR_RE = /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶー]/;
  const LATIN_WORD_CHAR_RE = /[A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]/;
  const KOREAN_CHAR_RE = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

  function chars(text) {
    return Array.from(String(text || ""));
  }

  function normalizeBasic(text) {
    const raw = String(text || "");
    try { return raw.normalize("NFKC"); } catch (_) { return raw; }
  }

  function clampPosition(position, length) {
    return Math.max(0, Math.min(Number(position) || 0, Math.max(0, Number(length) || 0)));
  }

  function findRun(charsList, position, predicate) {
    const pos = clampPosition(position, charsList.length);
    if (!charsList.length || pos >= charsList.length || !predicate(charsList[pos])) return null;
    let start = pos;
    let end = pos + 1;
    while (start > 0 && predicate(charsList[start - 1])) start--;
    while (end < charsList.length && predicate(charsList[end])) end++;
    return { start, end };
  }

  function slice(charsList, start, end) {
    return charsList.slice(start, end).join("");
  }

  return {
    JAPANESE_CHAR_RE,
    LATIN_WORD_CHAR_RE,
    KOREAN_CHAR_RE,
    chars,
    normalizeBasic,
    clampPosition,
    findRun,
    slice
  };
})();

const IINATAN_JAPANESE_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;

  function isHoverableChar(ch) {
    return common.JAPANESE_CHAR_RE.test(String(ch || ""));
  }

  function hasLookupText(text) {
    return common.JAPANESE_CHAR_RE.test(String(text || ""));
  }

  function lookupRequest(text, position, scanLength) {
    const chars = common.chars(text);
    const pos = common.clampPosition(position, chars.length);
    const suffix = chars.slice(pos).join("");
    if (!suffix || !isHoverableChar(chars[pos])) return null;
    const length = Math.min(chars.length - pos, Math.max(1, Number(scanLength) || 24));
    const lookupText = common.slice(chars, pos, pos + length);
    return {
      lookupText,
      displayText: lookupText,
      suffix,
      lookupStart: pos,
      lookupEnd: pos + length,
      matchStart: pos,
      backendMode: "yomitan-japanese",
      scanLength: length,
      cacheStrategy: "exact-position"
    };
  }

  return {
    id: "ja",
    label: "Japanese",
    experimental: false,
    wordMode: "rightward-prefix",
    deinflection: "hoshidicts-japanese",
    dictionaryCompatibility: "Yomitan-compatible Japanese dictionaries via HoshiDicts/Jitendex.",
    isHoverableChar,
    hasLookupText,
    normalizeText: text => String(text || ""),
    lookupRequest
  };
})();

const IINATAN_ENGLISH_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;

  function isHoverableChar(ch) {
    return common.LATIN_WORD_CHAR_RE.test(String(ch || ""));
  }

  function hasLookupText(text) {
    return common.LATIN_WORD_CHAR_RE.test(String(text || ""));
  }

  function lookupRequest(text, position) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    const run = common.findRun(chars, pos, isHoverableChar);
    if (!run) return null;
    const lookupText = common.slice(chars, run.start, run.end);
    return {
      lookupText,
      displayText: lookupText,
      suffix: chars.slice(pos).join(""),
      lookupStart: run.start,
      lookupEnd: run.end,
      matchStart: run.start,
      backendMode: "exact",
      scanLength: common.chars(lookupText).length,
      cacheStrategy: "exact-position"
    };
  }

  return {
    id: "en",
    label: "English (experimental)",
    experimental: true,
    wordMode: "latin-word",
    deinflection: "none",
    dictionaryCompatibility: "Yomitan-compatible term dictionaries; exact whole-word lookup only.",
    isHoverableChar,
    hasLookupText,
    normalizeText: common.normalizeBasic,
    lookupRequest
  };
})();

const IINATAN_KOREAN_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;

  function isHoverableChar(ch) {
    return common.KOREAN_CHAR_RE.test(String(ch || ""));
  }

  function hasLookupText(text) {
    return common.KOREAN_CHAR_RE.test(String(text || ""));
  }

  function lookupRequest(text, position) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    const run = common.findRun(chars, pos, isHoverableChar);
    if (!run) return null;
    const lookupText = common.slice(chars, run.start, run.end);
    return {
      lookupText,
      displayText: lookupText,
      suffix: chars.slice(pos).join(""),
      lookupStart: run.start,
      lookupEnd: run.end,
      matchStart: run.start,
      backendMode: "exact",
      scanLength: common.chars(lookupText).length,
      cacheStrategy: "exact-position"
    };
  }

  return {
    id: "ko",
    label: "Korean (experimental)",
    experimental: true,
    wordMode: "korean-run",
    deinflection: "none",
    dictionaryCompatibility: "Yomitan-compatible term dictionaries; exact contiguous-Hangul lookup only.",
    isHoverableChar,
    hasLookupText,
    normalizeText: common.normalizeBasic,
    lookupRequest
  };
})();

const IINATAN_LANGUAGE_REGISTRY = (() => {
  const languages = [
    IINATAN_JAPANESE_LANGUAGE,
    IINATAN_ENGLISH_LANGUAGE,
    IINATAN_KOREAN_LANGUAGE
  ];
  const byId = Object.create(null);
  languages.forEach(language => { byId[language.id] = language; });

  function get(id) {
    return byId[String(id || "ja")] || byId.ja;
  }

  function selected() {
    return get(pref("lookupLanguage", "ja"));
  }

  function overlayConfig(language) {
    const selectedLanguage = language || selected();
    return {
      id: selectedLanguage.id,
      label: selectedLanguage.label,
      experimental: !!selectedLanguage.experimental,
      wordMode: selectedLanguage.wordMode,
      deinflection: selectedLanguage.deinflection,
      dictionaryCompatibility: selectedLanguage.dictionaryCompatibility
    };
  }

  return {
    all: languages.slice(),
    get,
    selected,
    overlayConfig
  };
})();

function languageModuleById(id) {
  return IINATAN_LANGUAGE_REGISTRY.get(id);
}

function selectedLanguageModule() {
  return IINATAN_LANGUAGE_REGISTRY.selected();
}

function selectedLanguageOverlayConfig() {
  return IINATAN_LANGUAGE_REGISTRY.overlayConfig(selectedLanguageModule());
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
function isJapaneseish(text) { return languageModuleById("ja").hasLookupText(text); }
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
  const language = selectedLanguageModule();
  return {
    language: selectedLanguageOverlayConfig(),
    lookupLanguage: language.id,
    fontScale: prefNumber("fontScale", 1.0),
    popupScale: prefNumber("popupScale", 0.92),
    popupMaxWidth: Math.max(260, prefNumber("popupMaxWidth", 440)),
    popupMaxHeightVh: Math.max(20, prefNumber("popupMaxHeightVh", 34)),
    popupSubtitleGapPx: Math.max(12, prefNumber("popupSubtitleGapPx", 34)),
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
  debugLog("publishSubtitle lineId=" + currentSubtitleLineId + " len=" + String(normalized || "").length + " text=" + JSON.stringify(String(normalized || "").slice(0, 80)));
  postToOverlay("subtitle", { text: normalized, config: overlayConfig(), lineId: currentSubtitleLineId });
  postToOverlay("line-lookup-reset", { lineId: currentSubtitleLineId });
  // v1.5.0: no full-line background precompute. Hover requests are looked up
  // directly and serialized so the hovered word is never blocked by a batch.
  const language = selectedLanguageModule();
  if (normalized && language.hasLookupText(normalized) && activeDictionaryPaths().length) {
    ensureBackendWorker(activeDictionaryPaths()).catch(error => {
      debugLog("background worker warmup failed lineId=" + currentSubtitleLineId + ": " + compactError(error));
    });
  }
}
function syncNativeSubtitleVisibility() {
  if (!enabled) return;
  try {
    if (prefBool("hideNativeSubtitles", true)) {
      mpv.set("sub-visibility", false);
    } else if (nativeSubVisibilityBeforeEnable !== null) {
      mpv.set("sub-visibility", nativeSubVisibilityBeforeEnable);
    }
  } catch (error) { console.warn("Could not update native subtitle visibility: " + compactError(error)); }
}
function pollSubtitle() {
  if (!enabled) return;
  refreshPollingInterval();
  syncNativeSubtitleVisibility();
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

function dictionaryZipValidation(zipPath, existsFn) {
  const raw = zipPath === undefined || zipPath === null ? "" : String(zipPath).trim();
  if (!raw || raw === "[object Promise]") {
    return { ok: false, reason: "empty", message: "No dictionary ZIP was selected." };
  }
  if (!/\.zip$/i.test(raw)) {
    return { ok: false, reason: "extension", path: raw, message: "Selected file is not a .zip dictionary: " + raw };
  }
  if (typeof existsFn === "function") {
    let exists = false;
    try { exists = !!existsFn(raw); } catch (_) { exists = false; }
    if (!exists) {
      return { ok: false, reason: "missing", path: raw, message: "Selected dictionary ZIP does not exist: " + raw };
    }
  }
  return { ok: true, path: raw };
}

function isPromiseLike(value) {
  return !!value && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
}

async function resolveMaybePromise(value) {
  return isPromiseLike(value) ? await value : value;
}

function backendInstalled() { try { return file.exists(binPath()); } catch (_) { return false; } }
async function ensureBundledBackendInstalled() {
  await ensureDataDirs();
  if (!file.exists(bundledBinPath())) {
    if (backendInstalled()) return;
    throw new Error("iinatan's lookup engine is missing. Install a packaged Apple Silicon build or run scripts/build_native_backend.sh while developing.");
  }
  const result = await utils.exec("/bin/cp", ["-f", bundledBinPath(), binPath()], dataRoot());
  if (!result || result.status !== 0) throw new Error("Could not install iinatan lookup engine: " + ((result && (result.stderr || result.stdout)) || "copy failed"));
  await execChecked("/bin/chmod", ["755", binPath()]);
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
  throw new Error("Dictionary lookup returned incomplete output. stdoutBytes=" + text.length + " stdoutPrefix=" + text.slice(0, 260) + " stderr=" + String(stderr || "").slice(0, 260));
}

async function runBackendJson(args, timeoutMs) {
  await ensureBundledBackendInstalled();
  let timer = null;
  const timeout = Math.max(1000, timeoutMs || prefNumber("backendTimeoutMs", 30000));
  try {
    debugVerbose("backend exec start cwd=" + dataRoot() + " bin=" + binPath() + " args=" + JSON.stringify(args || []));
    const execStartedAt = Date.now();
    const result = await Promise.race([
      utils.exec(binPath(), args || [], dataRoot()),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Dictionary lookup timed out after " + timeout + " ms")), timeout); })
    ]);
    if (!result) throw new Error("Dictionary lookup returned no result");
    debugVerbose("backend exec done status=" + result.status + " elapsedMs=" + (Date.now() - execStartedAt) + " stdoutBytes=" + String(result.stdout || "").length + " stderr=" + String(result.stderr || "").slice(0, 600));
    const raw = String(result.stdout || "").trim();
    let parsed = parseBackendJsonOutput(raw, result.stderr);
    if (result.status !== 0 || (parsed && parsed.ok === false)) throw new Error((parsed && parsed.error) || result.stderr || ("Dictionary lookup exit " + result.status));
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
    await ensureBundledBackendInstalled();
    if (!taskId) taskId = startOverlayTask("dictionary-import", "Adding dictionary", "Preparing import...");
    updateOverlayTask(taskId, { title: "Adding dictionary", message: "Importing dictionary...", detail: "Large dictionaries can take several minutes." });
    const started = Date.now();
    const result = await runBackendJson(["import", zipPath, dictRoot(), prefBool("lowRamImport", true) ? "--low-ram" : "--normal-ram"], Math.max(30000, prefNumber("importTimeoutMs", 1800000)));
    if (!result || !result.ok) throw new Error((result && result.error) || "Import failed");
    updateOverlayTask(taskId, { title: "Adding dictionary", message: "Saving dictionary list...", detail: "Refreshing installed dictionaries." });
    updateManifestAfterImport(result, zipPath);
    activeWorkerFingerprint = null;
    updateOverlayTask(taskId, { title: "Adding dictionary", message: "Refreshing lookup...", detail: "The new dictionary will be available for hover popups." });
    await stopBackendWorker().catch(() => {});
    rebuildMenu();
    const elapsed = Math.round((Date.now() - started) / 1000);
    const msg = "Added " + result.title + " (" + (result.term_count || 0) + " terms).";
    if (ownsTask) finishOverlayTask(taskId, true, msg, "Import took about " + elapsed + " seconds.");
    else updateOverlayTask(taskId, { title: "Adding dictionary", message: msg, detail: "Import took about " + elapsed + " seconds." });
    return result;
  } catch (error) {
    if (ownsTask) finishOverlayTask(taskId, false, "Could not add dictionary.", compactError(error));
    throw error;
  }
}
async function chooseAndImportDictionary() {
  debugLog("manual dictionary import menu clicked");
  try {
    const zipPath = await chooseDictionaryZipPath();
    if (!zipPath) {
      notify("Dictionary import cancelled.", "info", 3500);
      return;
    }
    await validateAndImportDictionaryZip(zipPath, "manual-picker");
  } catch (error) {
    const msg = "Could not add dictionary: " + compactError(error);
    debugError("manual dictionary import failed: " + compactError(error));
    setOverlayStatus(msg, "error", 12000);
    alert(msg);
  }
}

async function chooseDictionaryZipPath() {
  if (!utils || typeof utils.chooseFile !== "function") {
    throw new Error("This IINA build does not expose utils.chooseFile. Use Dictionaries -> Reveal Manual Import Folder, place one .zip there, then choose Import ZIP from Manual Import Folder.");
  }
  debugLog("manual dictionary import: opening file chooser with zip filter");
  try {
    const selected = await resolveMaybePromise(utils.chooseFile("Choose a Yomitan dictionary .zip", { allowedFileTypes: ["zip"] }));
    debugLog("manual dictionary import: filtered chooser returned " + JSON.stringify(String(selected || "").slice(0, 260)));
    return selected ? String(selected) : "";
  } catch (error) {
    debugWarn("manual dictionary import chooser with zip filter failed: " + compactError(error));
  }

  debugLog("manual dictionary import: opening fallback unfiltered file chooser");
  try {
    const selected = await resolveMaybePromise(utils.chooseFile("Choose a Yomitan dictionary .zip", {}));
    debugLog("manual dictionary import: unfiltered chooser returned " + JSON.stringify(String(selected || "").slice(0, 260)));
    return selected ? String(selected) : "";
  } catch (error) {
    throw new Error("IINA file picker failed: " + compactError(error) + ". Use Dictionaries -> Reveal Manual Import Folder, place one .zip there, then choose Import ZIP from Manual Import Folder.");
  }
}

async function validateAndImportDictionaryZip(zipPath, source) {
  const validation = dictionaryZipValidation(zipPath, p => file.exists(p));
  debugLog("manual dictionary import validation source=" + String(source || "") + " ok=" + String(validation.ok) + " reason=" + String(validation.reason || "") + " path=" + JSON.stringify(String(validation.path || zipPath || "").slice(0, 260)));
  if (!validation.ok) {
    if (validation.reason === "empty") {
      notify("Dictionary import cancelled.", "info", 3500);
      return null;
    }
    throw new Error(validation.message);
  }
  debugLog("manual dictionary import: importing validated zip path=" + JSON.stringify(validation.path));
  return await importDictionaryZip(validation.path);
}

function importFolderZipCandidates() {
  try {
    if (!file.exists(importDropRoot())) return [];
    return (file.list(importDropRoot(), { includeSubDir: false }) || [])
      .filter(item => item && !item.isDir && /\.zip$/i.test(String(item.filename || item.path || "")))
      .map(item => ({ name: item.filename || String(item.path || "").split("/").pop(), path: item.path }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  } catch (error) {
    debugWarn("could not list manual import folder: " + compactError(error));
    return [];
  }
}

async function importDictionaryFromManualFolder() {
  debugLog("manual import folder action clicked");
  try {
    await ensureDataDirs();
    const candidates = importFolderZipCandidates();
    debugLog("manual import folder candidates=" + JSON.stringify(candidates.map(c => c.name)));
    if (!candidates.length) {
      const msg = "No .zip files found in manual import folder. Place one Yomitan dictionary ZIP in: " + importDropRoot();
      notify(msg, "error", 12000);
      revealManualImportFolder();
      return;
    }
    let selected = candidates[0];
    if (candidates.length > 1) {
      const names = candidates.map(c => c.name).join(", ");
      let requested = "";
      if (utils && typeof utils.prompt === "function") {
        try { requested = String(await resolveMaybePromise(utils.prompt("Multiple ZIPs found. Enter the exact filename to import:\n" + names)) || "").trim(); }
        catch (error) { debugWarn("manual import folder filename prompt failed: " + compactError(error)); }
      }
      if (!requested) {
        notify("Multiple ZIPs found. Leave only one .zip in " + importDropRoot() + " or enter a filename when prompted.", "error", 14000);
        revealManualImportFolder();
        return;
      }
      selected = candidates.find(c => c.name === requested);
      if (!selected) throw new Error("No ZIP named " + requested + " found in manual import folder. Available: " + names);
    }
    await validateAndImportDictionaryZip(selected.path, "manual-folder");
  } catch (error) {
    const msg = "Could not import from manual folder: " + compactError(error);
    debugError(msg);
    setOverlayStatus(msg, "error", 12000);
    alert(msg);
  }
}

function revealManualImportFolder() {
  (async () => {
    try {
      await ensureDataDirs();
      debugLog("revealing manual import folder " + importDropRoot());
      try { file.showInFinder(importDropRoot()); }
      catch (_) { utils.open(importDropRoot()); }
      notify("Manual import folder opened. Place one Yomitan .zip there, then choose Import ZIP from Manual Import Folder.", "info", 9000);
    } catch (error) {
      notify("Could not reveal manual import folder: " + compactError(error), "error", 9000);
    }
  })();
}

function testFilePickerApiFromMenu() {
  (async () => {
    debugLog("debug file picker test clicked");
    try {
      const selected = await chooseDictionaryZipPath();
      if (!selected) {
        notify("File picker test cancelled.", "info", 4500);
        debugLog("debug file picker test cancelled");
        return;
      }
      const validation = dictionaryZipValidation(selected, p => file.exists(p));
      debugLog("debug file picker test selected=" + JSON.stringify(String(selected).slice(0, 260)) + " validation=" + JSON.stringify(validation));
      if (validation.ok) notify("File picker returned a valid ZIP: " + validation.path, "info", 9000);
      else notify("File picker returned an invalid path: " + validation.message, "error", 12000);
    } catch (error) {
      const msg = "File picker test failed: " + compactError(error);
      debugError(msg);
      notify(msg, "error", 12000);
      alert(msg);
    }
  })();
}
async function getRecommendedDictionaries() {
  let taskId = null;
  try {
    await ensureDataDirs();
    taskId = startOverlayTask("recommended-dictionary", "Adding Jitendex", "Downloading dictionary...");
    const dest = pathJoin(downloadRoot(), "jitendex-yomitan.zip");
    updateOverlayTask(taskId, { title: "Adding Jitendex", message: "Downloading dictionary...", detail: RECOMMENDED_JITENDEX_URL });
    await http.download(RECOMMENDED_JITENDEX_URL, dest);
    updateOverlayTask(taskId, { title: "Adding Jitendex", message: "Download complete. Importing...", detail: dest });
    const result = await importDictionaryZip(dest, taskId);
    const msg = "Added " + result.title + " (" + (result.term_count || 0) + " terms).";
    finishOverlayTask(taskId, true, msg, "You can now hover Japanese subtitles for dictionary popups.");
  } catch (error) {
    const msg = "Could not add Jitendex.";
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
SLEEP_MS="${"$"}{2:-2}"
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
nohup "$BIN" worker "$WORKER_ROOT" --sleep-ms "$SLEEP_MS" > "$LOG" 2>&1 < /dev/null &
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
  await ensureBundledBackendInstalled();
  await ensureDataDirs();
  await clearDirFiles(workerQueueDir());
  await clearDirFiles(workerResponseDir());
  safeDelete(workerStopPath());
  safeDelete(workerReadyPath());
  const fingerprint = workerFingerprint(dicts);
  writeWorkerConfig(dicts, fingerprint);
  await writeWorkerStartScript();
  const sleepMs = Math.max(1, prefNumber("workerIdleSleepMs", 2));
  const res = await utils.exec("/bin/bash", [workerStartScriptPath(), dataRoot(), String(sleepMs)], dataRoot());
  if (!res || res.status !== 0) throw new Error("Could not start dictionary lookup: " + ((res && (res.stderr || res.stdout)) || "unknown error"));
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
      setOverlayStatus("Dictionary lookup ready.", "info", 2500);
      return ready;
    }
    last = ready;
    await sleep(180);
  }
  let logHint = "";
  try { if (file.exists(workerLogPath())) logHint = " Worker log: " + String(file.read(workerLogPath()) || "").slice(-900); } catch (_) {}
  throw new Error("Dictionary lookup did not become ready." + (last ? " Last state: " + JSON.stringify(last).slice(0, 500) : "") + logHint);
}
async function ensureBackendWorker(dicts) {
  dicts = dicts || activeDictionaryPaths();
  if (!dicts.length) throw new Error("No dictionaries are enabled. Add Jitendex or import a Yomitan dictionary ZIP.");
  const fingerprint = workerFingerprint(dicts);
  if (activeWorkerFingerprint === fingerprint && readWorkerReady()) return readWorkerReady();
  if (workerStartInFlight) return workerStartInFlight;
  workerStartInFlight = (async () => {
    await stopBackendWorker().catch(() => {});
    setOverlayStatus("Preparing dictionary lookup...", "info", 4000);
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
async function runWorkerQueueLookupDirect(suffix, dicts, scanLength, maxResults, requestId, timeoutMs, backendMode, maxGlossaries) {
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
    maxResults: Math.max(1, Number(maxResults) || 1),
    maxGlossaries: Math.max(1, Number(maxGlossaries) || 4),
    mode: String(backendMode || "yomitan-japanese")
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
async function runWorkerLookupViaClientExec(suffix, dicts, scanLength, maxResults, requestId, timeout, backendMode, maxGlossaries) {
  await ensureBackendWorker(dicts);
  const clientArgs = [
    "client", workerRoot(),
    "--max-results", String(maxResults),
    "--max-glossaries", String(maxGlossaries),
    "--scan-length", String(scanLength),
    "--mode", String(backendMode || "yomitan-japanese"),
    "--timeout-ms", String(timeout),
    "--", suffix
  ];
  const lookupStartedAt = Date.now();
  const result = await runBackendJson(clientArgs, timeout + 2500);
  debugLog("client exec lookup result requestId=" + String(requestId || "") + " elapsedMs=" + (Date.now() - lookupStartedAt) + " resultCount=" + (result && result.results ? result.results.length : "n/a"));
  return result;
}
async function lookupViaWorker(suffix, dicts, scanLength, maxResults, requestId, backendMode, maxGlossaries) {
  debugLog("lookupViaWorker begin requestId=" + String(requestId || "") + " suffix=" + JSON.stringify(String(suffix || "").slice(0, 80)) + " dicts=" + dicts.length + " mode=" + String(backendMode || "yomitan-japanese") + " directIpc=" + String(prefBool("directWorkerIpc", true)));
  if (requestId) postToOverlay("lookup-status", { requestId, message: "Preparing dictionary lookup..." });
  const timeout = Math.max(1500, prefNumber("lookupTimeoutMs", 9000));

  if (prefBool("directWorkerIpc", true)) {
    try {
      const result = await runWorkerQueueLookupDirect(suffix, dicts, scanLength, maxResults, requestId, timeout, backendMode, maxGlossaries);
      if (requestId) postToOverlay("lookup-status", { requestId, message: "Dictionary result ready; rendering..." });
      return result;
    } catch (error) {
      debugWarn("direct worker lookup failed requestId=" + String(requestId || "") + ": " + compactError(error));
      if (!prefBool("fallbackToClientExec", true)) throw error;
    }
  }

  if (requestId) postToOverlay("lookup-status", { requestId, message: "Trying another lookup path..." });
  const result = await runWorkerLookupViaClientExec(suffix, dicts, scanLength, maxResults, requestId, timeout, backendMode, maxGlossaries);
  if (requestId) postToOverlay("lookup-status", { requestId, message: "Dictionary result ready; rendering..." });
  if (!result || result.ok === false) throw new Error((result && result.error) || "Worker client lookup failed");
  return result;
}
async function lookupAtPosition(text, position, requestId) {
  const language = selectedLanguageModule();
  const clean = language.normalizeText(cleanSubtitleText(text));
  const chars = charsOf(clean);
  const pos = Math.max(0, Math.min(Number(position) || 0, chars.length));
  const scanLength = Math.max(1, prefNumber("scanLength", 24));
  const request = language.lookupRequest(clean, pos, scanLength);
  if (!request || !request.lookupText) {
    const suffix = chars.slice(pos).join("");
    return { ok: true, text: clean, position: pos, suffix, language: language.id, results: [] };
  }
  const dicts = activeDictionaryPaths();
  if (!dicts.length) throw new Error("No dictionaries are enabled. Add Jitendex or import a Yomitan dictionary ZIP.");
  const maxResults = Math.max(1, prefNumber("maxEntries", 3));
  const maxGlossaries = Math.max(1, prefNumber("maxGlossesPerEntry", 4));
  const lookupText = request.lookupText;
  const effectiveScanLength = Math.max(1, Number(request.scanLength) || scanLength);
  const backendMode = request.backendMode || language.backendMode || "yomitan-japanese";
  const key = [
    dicts.join("|"),
    language.id,
    backendMode,
    clean,
    pos,
    lookupText,
    effectiveScanLength,
    maxResults,
    maxGlossaries
  ].join("\n");
  if (lookupCache[key]) {
    debugVerbose("lookupAtPosition cache hit lang=" + language.id + " pos=" + pos + " lookupText=" + JSON.stringify(lookupText));
    return lookupCache[key];
  }
  debugVerbose("lookupAtPosition cache miss lang=" + language.id + " mode=" + backendMode + " pos=" + pos + " lookupText=" + JSON.stringify(lookupText));
  const result = await lookupViaWorker(lookupText, dicts, effectiveScanLength, maxResults, requestId, backendMode, maxGlossaries);
  result.text = clean;
  result.position = pos;
  result.suffix = request.suffix;
  result.lookupText = lookupText;
  result.lookupStart = request.lookupStart;
  result.lookupEnd = request.lookupEnd;
  result.matchStart = request.matchStart;
  result.language = language.id;
  result.backendMode = backendMode;
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
  postToOverlay("config", overlayConfig());
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
  postToOverlay("config", overlayConfig());
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
  const nextMs = configuredSubtitlePollMs();
  debugLog("startPolling subtitlePollMs=" + nextMs);
  if (pollTimer !== null) clearInterval(pollTimer);
  activeSubtitlePollMs = nextMs;
  pollTimer = setInterval(pollSubtitle, activeSubtitlePollMs);
  pollSubtitle();
}
function configuredSubtitlePollMs() {
  return Math.max(80, prefNumber("subtitlePollMs", 120));
}
function refreshPollingInterval() {
  if (pollTimer === null) return;
  const nextMs = configuredSubtitlePollMs();
  if (nextMs === activeSubtitlePollMs) return;
  debugLog("subtitlePollMs changed " + activeSubtitlePollMs + " -> " + nextMs);
  clearInterval(pollTimer);
  activeSubtitlePollMs = nextMs;
  pollTimer = setInterval(pollSubtitle, activeSubtitlePollMs);
}
function stopPolling() {
  debugLog("stopPolling");
  if (pollTimer !== null) clearInterval(pollTimer);
  pollTimer = null;
  activeSubtitlePollMs = 0;
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
      syncNativeSubtitleVisibility();
    } catch (error) { console.warn("Could not update native subtitle visibility: " + compactError(error)); }
    overlay.show();
    startPolling();
    showOSD("iinatan: On");
    if (!activeDictionaryPaths().length) setOverlayStatus("No dictionaries installed. Use Plugins → iinatan → Dictionaries → Add Jitendex.", "error", 9000);
    else ensureBackendWorker(activeDictionaryPaths()).catch(error => setOverlayStatus("Dictionary lookup could not start: " + compactError(error), "error", 12000));
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
function runLanguageUnitTests() {
  const failures = [];
  function check(ok, message) { if (!ok) failures.push(message); }
  const ja = languageModuleById("ja");
  const en = languageModuleById("en");
  const ko = languageModuleById("ko");
  check(ja.isHoverableChar("魔"), "Japanese kanji should be hoverable");
  check(!ja.isHoverableChar("r"), "Latin should not be Japanese-hoverable");
  check(en.isHoverableChar("r"), "Latin should be English-hoverable");
  const englishText = "I am running fast";
  const enReq = en.lookupRequest(englishText, charsOf(englishText).indexOf("n"), 24);
  check(enReq && enReq.lookupText === "running", "English hover inside running should query running");
  check(enReq && enReq.suffix !== "nning", "English should not query partial rightward suffixes");
  check(enReq && enReq.backendMode === "exact", "English should use exact lookup");
  const jaReq = ja.lookupRequest("魔法使い", 1, 24);
  check(jaReq && jaReq.lookupText === "法使い", "Japanese should keep rightward-prefix lookup");
  const koReq = ko.lookupRequest("한국어 공부", 1, 24);
  check(koReq && koReq.lookupText === "한국어", "Korean should query the contiguous Hangul run");
  if (failures.length) alert("Language unit tests failed:\n" + failures.join("\n"));
  else alert("Language unit tests passed.");
}
function runSettingsAuditChecks() {
  const failures = [];
  function check(ok, message) { if (!ok) failures.push(message); }
  const cfg = overlayConfig();
  check(cfg.language && cfg.language.id, "language config should be present");
  check(Number.isFinite(Number(cfg.scanLength)) && cfg.scanLength >= 1, "scanLength should be numeric");
  check(Number.isFinite(Number(cfg.maxEntries)) && cfg.maxEntries >= 1, "maxEntries should be numeric");
  check(Number.isFinite(Number(cfg.maxGlossesPerEntry)) && cfg.maxGlossesPerEntry >= 1, "maxGlossesPerEntry should be numeric");
  check(Number.isFinite(Number(cfg.popupMaxHeightVh)) && cfg.popupMaxHeightVh >= 20, "popupMaxHeightVh should be sent to overlay");
  check(Number.isFinite(Number(cfg.popupSubtitleGapPx)) && cfg.popupSubtitleGapPx >= 12, "popupSubtitleGapPx should be sent to overlay");
  check(typeof prefBool("directWorkerIpc", true) === "boolean", "directWorkerIpc should be boolean-readable");
  check(typeof prefBool("fallbackToClientExec", true) === "boolean", "fallbackToClientExec should be boolean-readable");
  check(Number.isFinite(prefNumber("directIpcPollMs", 2)), "directIpcPollMs should be numeric");
  check(Number.isFinite(prefNumber("workerIdleSleepMs", 2)), "workerIdleSleepMs should be numeric");
  if (failures.length) alert("Settings audit checks failed:\n" + failures.join("\n"));
  else alert("Settings audit checks passed.");
}
function testBackendLookup() {
  (async () => {
    try {
      const result = await lookupAtPosition("魔法をかけられるのは魔法使いだけだ", 0);
      const count = result && result.results ? result.results.length : 0;
      alert("Lookup test returned " + count + " result(s). Top match: " + (count ? result.results[0].matched : "none"));
    } catch (error) { alert("Lookup test failed: " + compactError(error)); }
  })();
}
function restartBackendWorkerFromMenu() {
  (async () => {
    try {
      await stopBackendWorker();
      await ensureBackendWorker(activeDictionaryPaths());
      alert("Dictionary lookup restarted.");
    } catch (error) { alert("Could not restart dictionary lookup: " + compactError(error)); }
  })();
}
function stopBackendWorkerFromMenu() {
  (async () => { await stopBackendWorker(); alert("Dictionary lookup stopped."); })();
}
function showInstalledDictionaries() {
  const dicts = dictionaryDirs();
  const disabled = disabledDictionaryMap();
  if (!dicts.length) { alert("No dictionaries installed yet. Add Jitendex or import a Yomitan dictionary ZIP."); return; }
  alert("Installed dictionaries:\n\n" + dicts.map(d => (disabled[d.name] ? "[off] " : "[on] ") + d.name).join("\n"));
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
  const id = startOverlayTask("debug-task", "Task panel test", "This is where dictionary progress appears.");
  updateOverlayTask(id, { title: "Task panel test", message: "Visible at top-center of the video overlay.", detail: "If you can see this panel, dictionary downloads and imports can show progress here." });
  setTimeout(() => finishOverlayTask(id, true, "Task panel test complete.", "The task panel will auto-hide shortly."), 4500);
}

function rebuildMenu() {
  try { menu.removeAllItems(); } catch (_) {}
  try {
    addMenuItemSafe(menu.item("Toggle iinatan (Shift+H)", () => setEnabled(!enabled), { selected: enabled }));

    const dictMenu = menu.item("Dictionaries");
    addSubMenuItemCompat(dictMenu, menu.item("Add Jitendex Dictionary", () => { getRecommendedDictionaries(); }));
    addSubMenuItemCompat(dictMenu, menu.item("Import Yomitan Dictionary ZIP...", () => { chooseAndImportDictionary(); }));
    addSubMenuItemCompat(dictMenu, menu.item("Import ZIP from Manual Import Folder", () => { importDictionaryFromManualFolder(); }));
    addSubMenuItemCompat(dictMenu, menu.item("Reveal Manual Import Folder", () => { revealManualImportFolder(); }));
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

    const debugMenu = menu.item("Debug");
    addSubMenuItemCompat(debugMenu, menu.item("Run Lookup Performance Benchmark", () => runLookupPerformanceBenchmark()));
    addSubMenuItemCompat(debugMenu, menu.item("Run Lookup Parser Unit Tests", () => runLookupParserUnitTests()));
    addSubMenuItemCompat(debugMenu, menu.item("Run Language Unit Tests", () => runLanguageUnitTests()));
    addSubMenuItemCompat(debugMenu, menu.item("Run Settings Audit Checks", () => runSettingsAuditChecks()));
    addSubMenuItemCompat(debugMenu, menu.item("Test File Picker API", () => testFilePickerApiFromMenu()));
    addSubMenuItemCompat(debugMenu, menu.item("Test Dictionary Lookup", () => testBackendLookup()));
    addSubMenuItemCompat(debugMenu, menu.item("Restart Dictionary Lookup", () => restartBackendWorkerFromMenu()));
    addSubMenuItemCompat(debugMenu, menu.item("Stop Dictionary Lookup", () => stopBackendWorkerFromMenu()));
    addSubMenuItemCompat(debugMenu, menu.item("Show Task Panel Test", () => showTaskPanelTest()));
    addSubMenuItemCompat(debugMenu, menu.item("Emit Debug Log Test Message", () => emitDebugLogTestMessage()));
    addSubMenuItemCompat(debugMenu, menu.item("Reveal Debug Log File", () => revealDebugLogFile()));
    addSubMenuItemCompat(debugMenu, menu.item("Reveal Plugin Data Folder", () => { try { file.showInFinder(dataRoot()); } catch (_) { utils.open(dataRoot()); } }));
    addMenuItemSafe(debugMenu);
  } catch (error) {
    console.error("Could not rebuild iinatan menu: " + compactError(error));
  }
}


registerShortcut();
rebuildMenu();
ensureBundledBackendInstalled().catch(error => {
  debugWarn("lookup engine install check failed: " + compactError(error));
});

event.on("iina.window-loaded", () => {
  initializeOverlay();
  setEnabled(prefBool("enabledByDefault", true));
});
event.on("mpv.file-loaded", () => {
  lastSubtitle = null;
  lookupCache = Object.create(null);
  lookupInFlight = Object.create(null);
  if (enabled) startPolling();
});
event.on("mpv.end-file", () => {
  resetLookupPopupPause();
  stopPolling();
  publishSubtitle("");
});
event.on("iina.window-will-close", () => {
  resetLookupPopupPause();
  stopPolling();
});
try {
  if (core.window.loaded) {
    initializeOverlay();
    setEnabled(prefBool("enabledByDefault", true));
  }
} catch (_) {}
