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

const VERSION = "1.9.1";
const RECOMMENDED_JITENDEX_URL = "https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip";
const RECOMMENDED_JAPANESE_DICTIONARIES = [
  {
    id: "jitendex-ja-en",
    title: "Jitendex",
    category: "Terms",
    language: "Japanese",
    description: "Japanese-English dictionary with structured JMdict data, examples, notes, and links.",
    homepage: "https://jitendex.org",
    downloadUrl: RECOMMENDED_JITENDEX_URL,
    filename: "jitendex-yomitan.zip",
    titlePrefixes: ["Jitendex"]
  },
  {
    id: "jmnedict-ja",
    title: "JMnedict",
    category: "Terms",
    language: "Japanese",
    description: "Japanese proper names from the Electronic Dictionary Research and Development Group.",
    homepage: "https://github.com/yomidevs/jmdict-yomitan?tab=readme-ov-file#jmnedict-for-yomitan",
    downloadUrl: "https://github.com/yomidevs/jmdict-yomitan/releases/latest/download/JMnedict.zip",
    filename: "JMnedict.zip",
    titlePrefixes: ["JMnedict"]
  },
  {
    id: "bccwj-suw-luw-combined",
    title: "BCCWJ SUW/LUW Combined",
    category: "Frequency",
    language: "Japanese",
    description: "Frequency ranks from the Balanced Corpus of Contemporary Written Japanese.",
    homepage: "https://github.com/Kuuuube/yomitan-dictionaries?tab=readme-ov-file#bccwj-suw-luw-combined",
    downloadUrl: "https://github.com/Kuuuube/yomitan-dictionaries/releases/download/yomitan-permalink/BCCWJ_SUW_LUW_combined.zip",
    filename: "BCCWJ_SUW_LUW_combined.zip",
    titlePrefixes: ["BCCWJ"]
  },
  {
    id: "jpdb-v2-kana",
    title: "JPDB v2.2 Kana",
    category: "Frequency",
    language: "Japanese",
    description: "Kana-aware frequency ranks from the JPDB corpus.",
    homepage: "https://github.com/Kuuuube/yomitan-dictionaries?tab=readme-ov-file#jpdb-v22-frequency",
    downloadUrl: "https://github.com/Kuuuube/yomitan-dictionaries/releases/download/yomitan-permalink/JPDB_v2.2_Frequency_Kana.zip",
    filename: "JPDB_v2.2_Frequency_Kana.zip",
    titlePrefixes: ["JPDBv2", "JPDB v2.2"]
  },
  {
    id: "jiten-global-frequency",
    title: "Jiten Global",
    category: "Frequency",
    language: "Japanese",
    description: "Global Yomitan frequency dictionary generated from the Jiten media database.",
    homepage: "https://jiten.moe/other",
    downloadUrl: "https://api.jiten.moe/api/frequency-list/download?downloadType=yomitan",
    downloadUrlAliases: ["https://api.jiten.moe/api/frequency-list/download"],
    filename: "jiten-global-yomitan.zip",
    titlePrefixes: ["Jiten"]
  }
];
const RECOMMENDED_DICTIONARIES_BY_LANGUAGE = {
  ja: RECOMMENDED_JAPANESE_DICTIONARIES,
  en: [
    {
      id: "wty-en-en",
      title: "wty-en-en",
      category: "Terms",
      language: "English",
      description: "English dictionary created from Wiktionary data.",
      homepage: "https://yomidevs.github.io/wiktionary-to-yomitan/download/",
      downloadUrl: "https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/en/en/wty-en-en.zip",
      filename: "wty-en-en.zip",
      titlePrefixes: ["wty-en-en"]
    }
  ],
  de: [
    {
      id: "wty-de-en",
      title: "wty-de-en",
      category: "Terms",
      language: "German",
      description: "German to English dictionary created from Wiktionary data.",
      homepage: "https://yomidevs.github.io/wiktionary-to-yomitan/download/",
      downloadUrl: "https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/de/en/wty-de-en.zip",
      filename: "wty-de-en.zip",
      titlePrefixes: ["wty-de-en"]
    }
  ],
  fr: [
    {
      id: "wty-fr-en",
      title: "wty-fr-en",
      category: "Terms",
      language: "French",
      description: "French to English dictionary created from Wiktionary data.",
      homepage: "https://yomidevs.github.io/wiktionary-to-yomitan/download/",
      downloadUrl: "https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/fr/en/wty-fr-en.zip",
      filename: "wty-fr-en.zip",
      titlePrefixes: ["wty-fr-en"]
    }
  ],
  zh: [
    {
      id: "cc-cedict-zh-en",
      title: "CC-CEDICT",
      category: "Terms",
      language: "Chinese",
      description: "Chinese-English dictionary provided by the CC-CEDICT project.",
      homepage: "https://github.com/MarvNC/cc-cedict-yomitan",
      downloadUrl: "https://github.com/MarvNC/cc-cedict-yomitan/releases/latest/download/CC-CEDICT.zip",
      filename: "CC-CEDICT.zip",
      titlePrefixes: ["CC-CEDICT"]
    },
    {
      id: "wty-zh-en",
      title: "wty-zh-en",
      category: "Terms",
      language: "Chinese",
      description: "Chinese to English dictionary created from Wiktionary data.",
      homepage: "https://yomidevs.github.io/wiktionary-to-yomitan/download/",
      downloadUrl: "https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/zh/en/wty-zh-en.zip",
      filename: "wty-zh-en.zip",
      titlePrefixes: ["wty-zh-en"]
    }
  ],
  ko: [
    {
      id: "wty-ko-en",
      title: "wty-ko-en",
      category: "Terms",
      language: "Korean",
      description: "Korean to English dictionary created from Wiktionary data.",
      homepage: "https://yomidevs.github.io/wiktionary-to-yomitan/download/",
      downloadUrl: "https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/ko/en/wty-ko-en.zip",
      filename: "wty-ko-en.zip",
      titlePrefixes: ["wty-ko-en"]
    }
  ]
};

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
let lookupPopupPauseResumeToken = 0;
let lookupPopupWatchdogTimer = null;
let lookupPopupLastHeartbeatAt = 0;
let lookupPopupLastSeq = 0;
let lookupPopupSessionId = "";
let overlayBridgeStarted = false;
let overlayBridgePort = 19741;
let dictionaryManagerHandlerGeneration = 0;
let dictionaryManagerActionInFlight = false;
let debugLogSnapshot = null;
let debugLogPending = "";
let debugLogFlushTimer = null;
let iinaAppearanceHint = "";
let iinaAppearanceHintRefreshInFlight = false;
let iinaAppearanceHintLastRefreshAt = 0;
const DEBUG_LOG_MAX_BYTES = 1000000;
const DEBUG_LOG_FLUSH_DELAY_MS = 750;
const LOOKUP_POPUP_RESUME_DELAY_MS = 90;

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

const IINATAN_LANGUAGE_COMMON = (() => {
  const JAPANESE_CHAR_RE = /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶー]/;
  const CHINESE_CHAR_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
  const LATIN_WORD_CHAR_RE = /[A-Za-zÀ-ÖØ-öø-ÿ0-9'’ʼ＇‘‛\-‐‑‒–—]/;
  const APOSTROPHE_RE = /['’ʼ＇‘‛]/g;
  const EDGE_PUNCTUATION_RE = /^[\s.,!?;:()[\]{}"“”«»‹›…]+|[\s.,!?;:()[\]{}"“”«»‹›…]+$/g;
  const KOREAN_CHAR_RE = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

  function chars(text) {
    return Array.from(String(text || ""));
  }

  function normalizeBasic(text) {
    const raw = String(text || "");
    try { return raw.normalize("NFKC"); } catch (_) { return raw; }
  }

  function normalizeLatinLookup(text) {
    return trimLookupPunctuation(normalizeBasic(text)).toLowerCase();
  }

  function normalizeApostrophes(text) {
    return String(text || "").replace(APOSTROPHE_RE, "'");
  }

  function trimLookupPunctuation(text) {
    return String(text || "").replace(EDGE_PUNCTUATION_RE, "").trim();
  }

  function candidateKey(text) {
    return String(text || "").normalize ? String(text || "").normalize("NFC") : String(text || "");
  }

  function pushUniqueCandidate(list, seen, candidate) {
    if (!candidate || !candidate.text) return;
    const text = String(candidate.text || "");
    const key = candidateKey(text);
    if (!key || seen[key]) return;
    seen[key] = true;
    list.push(Object.assign({
      normalizedText: text,
      source: "candidate",
      reason: "candidate"
    }, candidate, { text }));
  }

  function dictionaryIdentity(dict) {
    return [
      dict && dict.name,
      dict && dict.title,
      dict && dict.path,
      dict && dict.indexUrl,
      dict && dict.downloadUrl
    ].join(" ").toLowerCase();
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
    CHINESE_CHAR_RE,
    LATIN_WORD_CHAR_RE,
    KOREAN_CHAR_RE,
    APOSTROPHE_RE,
    chars,
    normalizeBasic,
    normalizeLatinLookup,
    normalizeApostrophes,
    trimLookupPunctuation,
    clampPosition,
    findRun,
    slice,
    pushUniqueCandidate,
    dictionaryIdentity
  };
})();

const IINATAN_DEINFLECTION = (() => {
  function arrayOf(value) {
    return Array.isArray(value) ? value : (value ? [value] : []);
  }

  function conditionDefaults(descriptor) {
    const out = Object.create(null);
    (descriptor.conditions || []).forEach(condition => {
      if (condition.isDefault !== false) out[condition.name] = true;
      (condition.subconditions || []).forEach(sub => {
        if (sub.isDefault) out[sub.name] = true;
      });
    });
    return out;
  }

  function conditionsMatch(active, required) {
    const names = arrayOf(required);
    if (!names.length) return true;
    return names.some(name => !!active[name]);
  }

  function nextConditions(active, outNames) {
    const names = arrayOf(outNames);
    if (!names.length) return Object.assign(Object.create(null), active);
    const out = Object.create(null);
    names.forEach(name => { out[name] = true; });
    return out;
  }

  function conditionsKey(conditions) {
    return Object.keys(conditions || {}).sort().join(",");
  }

  function suffixInflection(inflectedSuffix, deinflectedSuffix, conditionsIn, conditionsOut, reason) {
    return {
      type: "suffix",
      inflected: String(inflectedSuffix || ""),
      deinflected: String(deinflectedSuffix || ""),
      conditionsIn: arrayOf(conditionsIn),
      conditionsOut: arrayOf(conditionsOut),
      reason: reason || "suffix:" + inflectedSuffix + ">" + deinflectedSuffix
    };
  }

  function prefixInflection(inflectedPrefix, deinflectedPrefix, conditionsIn, conditionsOut, reason) {
    return {
      type: "prefix",
      inflected: String(inflectedPrefix || ""),
      deinflected: String(deinflectedPrefix || ""),
      conditionsIn: arrayOf(conditionsIn),
      conditionsOut: arrayOf(conditionsOut),
      reason: reason || "prefix:" + inflectedPrefix + ">" + deinflectedPrefix
    };
  }

  function wholeWordInflection(inflectedWord, deinflectedWord, conditionsIn, conditionsOut, reason) {
    return {
      type: "whole",
      inflected: String(inflectedWord || ""),
      deinflected: String(deinflectedWord || ""),
      conditionsIn: arrayOf(conditionsIn),
      conditionsOut: arrayOf(conditionsOut),
      reason: reason || "whole:" + inflectedWord + ">" + deinflectedWord
    };
  }

  function customInflection(apply, conditionsIn, conditionsOut, reason) {
    return {
      type: "custom",
      apply,
      conditionsIn: arrayOf(conditionsIn),
      conditionsOut: arrayOf(conditionsOut),
      reason: reason || "custom"
    };
  }

  function applyRule(text, rule) {
    if (rule.type === "suffix") {
      if (!rule.inflected || !text.endsWith(rule.inflected)) return [];
      return [text.slice(0, text.length - rule.inflected.length) + rule.deinflected];
    }
    if (rule.type === "prefix") {
      if (!rule.inflected || !text.startsWith(rule.inflected)) return [];
      return [rule.deinflected + text.slice(rule.inflected.length)];
    }
    if (rule.type === "whole") {
      return text === rule.inflected ? [rule.deinflected] : [];
    }
    if (rule.type === "custom" && typeof rule.apply === "function") {
      const applied = rule.apply(text);
      return Array.isArray(applied) ? applied : (applied ? [applied] : []);
    }
    return [];
  }

  function createTransformer(descriptor) {
    const defaults = conditionDefaults(descriptor || {});
    const rules = (descriptor && descriptor.rules) || [];
    const maxResults = Math.max(1, (descriptor && descriptor.maxResults) || 96);
    const maxDepth = Math.max(1, (descriptor && descriptor.maxDepth) || 4);

    function transform(sourceText) {
      const source = String(sourceText || "");
      if (!source) return [];
      const results = [{
        text: source,
        conditions: Object.assign(Object.create(null), defaults),
        trace: []
      }];
      const seen = Object.create(null);
      seen[source + "\t" + conditionsKey(defaults)] = true;
      for (let i = 0; i < results.length && results.length < maxResults; i++) {
        const current = results[i];
        if (current.trace.length >= maxDepth) continue;
        for (let r = 0; r < rules.length && results.length < maxResults; r++) {
          const rule = rules[r];
          if (!conditionsMatch(current.conditions, rule.conditionsIn)) continue;
          const applied = applyRule(current.text, rule);
          for (let a = 0; a < applied.length && results.length < maxResults; a++) {
            const text = String(applied[a] || "");
            if (!text || text === current.text) continue;
            const conditions = nextConditions(current.conditions, rule.conditionsOut);
            const trace = current.trace.concat([rule.reason || rule.type || "rule"]);
            const key = text + "\t" + conditionsKey(conditions) + "\t" + trace.join("|");
            if (seen[key]) continue;
            seen[key] = true;
            results.push({ text, conditions, trace });
          }
        }
      }
      return results;
    }

    return { transform };
  }

  function appendTransforms(list, seen, baseCandidate, transformer, language, maxDerived) {
    if (!transformer || typeof transformer.transform !== "function" || !baseCandidate || !baseCandidate.text) return;
    const transformed = transformer.transform(baseCandidate.text);
    const limit = Math.max(1, Number(maxDerived) || 24);
    let added = 0;
    for (let i = 0; i < transformed.length && added < limit; i++) {
      const result = transformed[i];
      if (!result || !result.text || result.text === baseCandidate.text) continue;
      IINATAN_LANGUAGE_COMMON.pushUniqueCandidate(list, seen, {
        text: result.text,
        normalizedText: result.text,
        source: "deinflection",
        reason: result.trace && result.trace.length ? result.trace.join(" -> ") : "deinflected",
        deinflectedFrom: baseCandidate.text,
        deinflectionTrace: result.trace || [],
        language,
        displayText: baseCandidate.displayText,
        range: baseCandidate.range
      });
      added++;
    }
  }

  return {
    suffixInflection,
    prefixInflection,
    wholeWordInflection,
    customInflection,
    createTransformer,
    appendTransforms
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
      cacheStrategy: "exact-position",
      cacheKey: "char:" + pos + ":" + lookupText
    };
  }

  return {
    id: "ja",
    label: "Japanese",
    experimental: false,
    lookupUnit: "character",
    wordMode: "rightward-prefix",
    lookupMode: "yomitan-japanese",
    deinflection: "hoshidicts-japanese",
    deinflectionMode: "hoshidicts-japanese",
    dictionaryCompatibility: "Yomitan-compatible Japanese dictionaries via HoshiDicts/Jitendex.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches: () => true,
    normalizeText: text => String(text || ""),
    lookupRequest
  };
})();

/*
 * Derived from Yomitan ext/js/language/en/english-transforms.js
 * Upstream source: https://github.com/yomidevs/yomitan/blob/master/ext/js/language/en/english-transforms.js
 * Copyright (C) 2024-2026 Yomitan Authors
 * License: GPL-3.0-or-later. See DEINFLECTION_NOTES.md for attribution notes.
 */
const IINATAN_ENGLISH_YOMITAN_SUFFIX_RULES = [
  ["s", "", ["np"], ["ns"], "plural"],
  ["es", "", ["np"], ["ns"], "plural"],
  ["ies", "y", ["np"], ["ns"], "plural"],
  ["ves", "fe", ["np"], ["ns"], "plural"],
  ["ves", "f", ["np"], ["ns"], "plural"],
  ["'s", "", ["n"], ["n"], "possessive"],
  ["s'", "s", ["n"], ["n"], "possessive"],
  ["ed", "", ["v"], ["v"], "past"],
  ["ed", "e", ["v"], ["v"], "past"],
  ["ied", "y", ["v"], ["v"], "past"],
  ["cked", "c", ["v"], ["v"], "past"],
  ["laid", "lay", ["v"], ["v"], "past"],
  ["paid", "pay", ["v"], ["v"], "past"],
  ["said", "say", ["v"], ["v"], "past"],
  ["ing", "", ["v"], ["v"], "ing"],
  ["ing", "e", ["v"], ["v"], "ing"],
  ["ying", "ie", ["v"], ["v"], "ing"],
  ["cking", "c", ["v"], ["v"], "ing"],
  ["s", "", ["v"], ["v"], "3rd pers. sing. pres"],
  ["es", "", ["v"], ["v"], "3rd pers. sing. pres"],
  ["ies", "y", ["v"], ["v"], "3rd pers. sing. pres"],
  ["'d", "ed", ["v"], ["v"], "archaic"],
  ["ly", "", ["adv"], ["adj"], "adverb"],
  ["ily", "y", ["adv"], ["adj"], "adverb"],
  ["ly", "le", ["adv"], ["adj"], "adverb"],
  ["er", "", ["adj"], ["adj"], "comparative"],
  ["er", "e", ["adj"], ["adj"], "comparative"],
  ["ier", "y", ["adj"], ["adj"], "comparative"],
  ["est", "", ["adj"], ["adj"], "superlative"],
  ["est", "e", ["adj"], ["adj"], "superlative"],
  ["iest", "y", ["adj"], ["adj"], "superlative"],
  ["in'", "ing", ["v"], ["v"], "dropped g"],
  ["y", "", ["adj"], ["n", "v"], "-y"],
  ["y", "e", ["adj"], ["n", "v"], "-y"],
  ["able", "", ["v"], ["adj"], "-able"],
  ["able", "e", ["v"], ["adj"], "-able"],
  ["iable", "y", ["v"], ["adj"], "-able"]
];
const IINATAN_ENGLISH_YOMITAN_PREFIX_RULES = [
  ["un", "", ["adj", "adv", "v"], ["adj", "adv", "v"], "un-"],
  ["going to ", "", ["v"], ["v"], "going-to future"],
  ["will ", "", ["v"], ["v"], "will future"],
  ["don't ", "", ["v"], ["v"], "imperative negative"],
  ["do not ", "", ["v"], ["v"], "imperative negative"]
];
const IINATAN_ENGLISH_YOMITAN_DOUBLED_SUFFIX_RULES = [
  ["bdgklmnprstz", "ed", ["v"], ["v"], "past"],
  ["bdgklmnprstz", "ing", ["v"], ["v"], "ing"],
  ["bdgmnt", "er", ["adj"], ["adj"], "comparative"],
  ["bdgmnt", "est", ["adj"], ["adj"], "superlative"],
  ["glmnprst", "y", [], ["n", "v"], "-y"],
  ["bdgklmnprstz", "able", ["v"], ["adj"], "-able"]
];

const IINATAN_ENGLISH_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;
  const deinflect = IINATAN_DEINFLECTION;
  const YOMITAN_SUFFIX_RULES = typeof IINATAN_ENGLISH_YOMITAN_SUFFIX_RULES !== "undefined" ? IINATAN_ENGLISH_YOMITAN_SUFFIX_RULES : [];
  const YOMITAN_PREFIX_RULES = typeof IINATAN_ENGLISH_YOMITAN_PREFIX_RULES !== "undefined" ? IINATAN_ENGLISH_YOMITAN_PREFIX_RULES : [];
  const YOMITAN_DOUBLED_SUFFIX_RULES = typeof IINATAN_ENGLISH_YOMITAN_DOUBLED_SUFFIX_RULES !== "undefined" ? IINATAN_ENGLISH_YOMITAN_DOUBLED_SUFFIX_RULES : [];

  function yomitanEnglishRules() {
    const rules = [];
    YOMITAN_SUFFIX_RULES.forEach(rule => {
      if (!rule || rule.length < 5) return;
      rules.push(deinflect.suffixInflection(rule[0], rule[1], rule[2], rule[3], "Yomitan " + rule[4]));
    });
    YOMITAN_PREFIX_RULES.forEach(rule => {
      if (!rule || rule.length < 5) return;
      rules.push(deinflect.prefixInflection(rule[0], rule[1], rule[2], rule[3], "Yomitan " + rule[4]));
    });
    YOMITAN_DOUBLED_SUFFIX_RULES.forEach(rule => {
      if (!rule || rule.length < 5) return;
      const consonants = String(rule[0] || "");
      const suffix = String(rule[1] || "");
      for (let i = 0; i < consonants.length; i++) {
        const consonant = consonants[i];
        rules.push(deinflect.suffixInflection(consonant + consonant + suffix, consonant, rule[2], rule[3], "Yomitan " + rule[4]));
      }
    });
    return rules;
  }

  const transformer = deinflect.createTransformer({
    maxDepth: 3,
    maxResults: 128,
    conditions: [
      { name: "v", isDefault: true },
      { name: "v_phr", isDefault: true },
      { name: "n", isDefault: true },
      { name: "np", isDefault: true },
      { name: "ns", isDefault: true },
      { name: "adj", isDefault: true },
      { name: "adv", isDefault: true }
    ],
    rules: yomitanEnglishRules()
  });

  function isHoverableChar(ch) {
    return common.LATIN_WORD_CHAR_RE.test(String(ch || ""));
  }

  function hasLookupText(text) {
    return common.LATIN_WORD_CHAR_RE.test(String(text || ""));
  }

  function dictionaryMatches(dict) {
    const primary = [
      dict && dict.name,
      dict && dict.title,
      dict && dict.path
    ].join(" ").toLowerCase();
    if (!primary) return false;
    if (primary.indexOf("jitendex") >= 0) return false;
    return /\benglish\b/.test(primary) ||
      /(^|[^a-z])en[-_/]/.test(primary) ||
      /(^|[^a-z])eng[-_/]/.test(primary);
  }

  function addCandidate(list, seen, text, displayText, range, source, reason) {
    const candidateText = common.trimLookupPunctuation(text);
    if (!candidateText) return;
    common.pushUniqueCandidate(list, seen, {
      text: candidateText,
      normalizedText: candidateText,
      source,
      reason,
      language: "en",
      displayText,
      range
    });
  }

  function generateCandidates(displayText, range) {
    const lookupText = common.normalizeLatinLookup(displayText);
    const list = [];
    const seen = Object.create(null);
    const candidateRange = range || null;
    addCandidate(list, seen, lookupText, displayText, candidateRange, "surface", "surface form");
    const baseCount = list.length;
    for (let i = 0; i < baseCount; i++) {
      deinflect.appendTransforms(list, seen, list[i], transformer, "en", 48);
    }
    return list;
  }

  function lookupRequest(text, position) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    const run = common.findRun(chars, pos, isHoverableChar);
    if (!run) return null;
    const displayText = common.slice(chars, run.start, run.end);
    const candidates = generateCandidates(displayText, { start: run.start, end: run.end });
    const lookupText = candidates.length ? candidates[0].text : "";
    if (!lookupText) return null;
    return {
      lookupText,
      displayText,
      suffix: chars.slice(pos).join(""),
      lookupStart: run.start,
      lookupEnd: run.end,
      matchStart: run.start,
      backendMode: "exact",
      scanLength: common.chars(lookupText).length,
      cacheStrategy: "word-candidates",
      cacheKey: "word:" + run.start + ":" + run.end + ":" + candidates.map(c => c.text).join("|"),
      candidates
    };
  }

  return {
    id: "en",
    label: "English",
    experimental: false,
    lookupUnit: "word",
    wordMode: "latin-word",
    lookupMode: "exact",
    deinflection: "yomitan-style-english",
    deinflectionMode: "yomitan-style-english",
    dictionaryCompatibility: "Yomitan-compatible term dictionaries; exact whole-word lookup with English deinflection candidates.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    generateCandidates,
    lookupRequest
  };
})();

/*
 * Derived from Yomitan ext/js/language/fr/french-transforms.js
 * Upstream commit: 462253fd3fd2f2a733ef327bc5bceedf7b797d24
 * Copyright (C) 2024-2026 Yomitan Authors
 * License: GPL-3.0-or-later. See DEINFLECTION_NOTES.md for attribution notes.
 */
const IINATAN_FRENCH_YOMITAN_SUFFIX_RULES = [["suis","être",["aux"],["v"],"present indicative"],["es","être",["aux"],["v"],"present indicative"],["est","être",["aux"],["v"],"present indicative"],["sommes","être",["aux"],["v"],"present indicative"],["êtes","être",["aux"],["v"],"present indicative"],["sont","être",["aux"],["v"],"present indicative"],["ai","avoir",["aux"],["v"],"present indicative"],["as","avoir",["aux"],["v"],"present indicative"],["a","avoir",["aux"],["v"],"present indicative"],["avons","avoir",["aux"],["v"],"present indicative"],["avez","avoir",["aux"],["v"],"present indicative"],["ont","avoir",["aux"],["v"],"present indicative"],["e","er",["v"],["v"],"present indicative"],["es","er",["v"],["v"],"present indicative"],["ons","er",["v"],["v"],"present indicative"],["ez","er",["v"],["v"],"present indicative"],["ent","er",["v"],["v"],"present indicative"],["çons","cer",["v"],["v"],"present indicative"],["geons","ger",["v"],["v"],"present indicative"],["èce","ecer",["v"],["v"],"present indicative"],["ève","ever",["v"],["v"],"present indicative"],["ène","ener",["v"],["v"],"present indicative"],["èpe","eper",["v"],["v"],"present indicative"],["ère","erer",["v"],["v"],"present indicative"],["ème","emer",["v"],["v"],"present indicative"],["èvre","evrer",["v"],["v"],"present indicative"],["èse","eser",["v"],["v"],"present indicative"],["ède","éder",["v"],["v"],"present indicative"],["èdes","éder",["v"],["v"],"present indicative"],["èdent","éder",["v"],["v"],"present indicative"],["èbre","ébrer",["v"],["v"],"present indicative"],["èbres","ébrer",["v"],["v"],"present indicative"],["èbrent","ébrer",["v"],["v"],"present indicative"],["èce","écer",["v"],["v"],"present indicative"],["èces","écer",["v"],["v"],"present indicative"],["ècent","écer",["v"],["v"],"present indicative"],["èche","écher",["v"],["v"],"present indicative"],["èches","écher",["v"],["v"],"present indicative"],["èchent","écher",["v"],["v"],"present indicative"],["ècre","écrer",["v"],["v"],"present indicative"],["ècres","écrer",["v"],["v"],"present indicative"],["ècrent","écrer",["v"],["v"],"present indicative"],["ègle","égler",["v"],["v"],"present indicative"],["ègles","égler",["v"],["v"],"present indicative"],["èglent","égler",["v"],["v"],"present indicative"],["ègne","égner",["v"],["v"],"present indicative"],["ègnes","égner",["v"],["v"],"present indicative"],["ègnent","égner",["v"],["v"],"present indicative"],["ègre","égrer",["v"],["v"],"present indicative"],["ègres","égrer",["v"],["v"],"present indicative"],["ègrent","égrer",["v"],["v"],"present indicative"],["ègue","éguer",["v"],["v"],"present indicative"],["ègues","éguer",["v"],["v"],"present indicative"],["èguent","éguer",["v"],["v"],"present indicative"],["èle","éler",["v"],["v"],"present indicative"],["èles","éler",["v"],["v"],"present indicative"],["èlent","éler",["v"],["v"],"present indicative"],["ème","émer",["v"],["v"],"present indicative"],["èmes","émer",["v"],["v"],"present indicative"],["èment","émer",["v"],["v"],"present indicative"],["ène","éner",["v"],["v"],"present indicative"],["ènes","éner",["v"],["v"],"present indicative"],["ènent","éner",["v"],["v"],"present indicative"],["èpe","éper",["v"],["v"],"present indicative"],["èpes","éper",["v"],["v"],"present indicative"],["èpent","éper",["v"],["v"],"present indicative"],["èque","équer",["v"],["v"],"present indicative"],["èques","équer",["v"],["v"],"present indicative"],["èquent","équer",["v"],["v"],"present indicative"],["ère","érer",["v"],["v"],"present indicative"],["ères","érer",["v"],["v"],"present indicative"],["èrent","érer",["v"],["v"],"present indicative"],["èse","éser",["v"],["v"],"present indicative"],["èses","éser",["v"],["v"],"present indicative"],["èsent","éser",["v"],["v"],"present indicative"],["ète","éter",["v"],["v"],"present indicative"],["ètes","éter",["v"],["v"],"present indicative"],["ètent","éter",["v"],["v"],"present indicative"],["ètre","étrer",["v"],["v"],"present indicative"],["ètres","étrer",["v"],["v"],"present indicative"],["ètrent","étrer",["v"],["v"],"present indicative"],["èye","éyer",["v"],["v"],"present indicative"],["èyes","éyer",["v"],["v"],"present indicative"],["èyent","éyer",["v"],["v"],"present indicative"],["elle","eler",["v"],["v"],"present indicative"],["elles","eler",["v"],["v"],"present indicative"],["ellent","eler",["v"],["v"],"present indicative"],["ette","eter",["v"],["v"],"present indicative"],["ettes","eter",["v"],["v"],"present indicative"],["ettent","eter",["v"],["v"],"present indicative"],["èle","eler",["v"],["v"],"present indicative"],["èles","eler",["v"],["v"],"present indicative"],["èlent","eler",["v"],["v"],"present indicative"],["ète","eter",["v"],["v"],"present indicative"],["ètes","eter",["v"],["v"],"present indicative"],["ètent","eter",["v"],["v"],"present indicative"],["ège","éger",["v"],["v"],"present indicative"],["èges","éger",["v"],["v"],"present indicative"],["ègent","éger",["v"],["v"],"present indicative"],["aie","ayer",["v"],["v"],"present indicative"],["aies","ayer",["v"],["v"],"present indicative"],["aient","ayer",["v"],["v"],"present indicative"],["oie","oyer",["v"],["v"],"present indicative"],["oies","oyer",["v"],["v"],"present indicative"],["oient","oyer",["v"],["v"],"present indicative"],["uie","uyer",["v"],["v"],"present indicative"],["uies","uyer",["v"],["v"],"present indicative"],["uient","uyer",["v"],["v"],"present indicative"],["is","ir",["v"],["v"],"present indicative"],["it","ir",["v"],["v"],"present indicative"],["issons","ir",["v"],["v"],"present indicative"],["issez","ir",["v"],["v"],"present indicative"],["issent","ir",["v"],["v"],"present indicative"],["hais","haïr",["v"],["v"],"present indicative"],["hait","haïr",["v"],["v"],"present indicative"],["vais","aller",["v"],["v"],"present indicative"],["vas","aller",["v"],["v"],"present indicative"],["va","aller",["v"],["v"],"present indicative"],["vont","aller",["v"],["v"],"present indicative"],["iens","enir",["v"],["v"],"present indicative"],["ient","enir",["v"],["v"],"present indicative"],["enons","enir",["v"],["v"],"present indicative"],["enez","enir",["v"],["v"],"present indicative"],["iennent","enir",["v"],["v"],"present indicative"],["iers","érir",["v"],["v"],"present indicative"],["iert","érir",["v"],["v"],"present indicative"],["érons","érir",["v"],["v"],"present indicative"],["érez","érir",["v"],["v"],"present indicative"],["ièrent","érir",["v"],["v"],"present indicative"],["s","tir",["v"],["v"],"present indicative"],["t","tir",["v"],["v"],"present indicative"],["tons","tir",["v"],["v"],"present indicative"],["tez","tir",["v"],["v"],"present indicative"],["tent","tir",["v"],["v"],"present indicative"],["êts","êtir",["v"],["v"],"present indicative"],["êt","êtir",["v"],["v"],"present indicative"],["êtons","êtir",["v"],["v"],"present indicative"],["êtez","êtir",["v"],["v"],"present indicative"],["êtent","êtir",["v"],["v"],"present indicative"],["vre","vrir",["v"],["v"],"present indicative"],["vres","vrir",["v"],["v"],"present indicative"],["vrons","vrir",["v"],["v"],"present indicative"],["vrez","vrir",["v"],["v"],"present indicative"],["vrent","vrir",["v"],["v"],"present indicative"],["fre","frir",["v"],["v"],"present indicative"],["fres","frir",["v"],["v"],"present indicative"],["frons","frir",["v"],["v"],"present indicative"],["frez","frir",["v"],["v"],"present indicative"],["frent","frir",["v"],["v"],"present indicative"],["ueille","ueillir",["v"],["v"],"present indicative"],["ueilles","ueillir",["v"],["v"],"present indicative"],["ueillons","ueillir",["v"],["v"],"present indicative"],["ueillez","ueillir",["v"],["v"],"present indicative"],["ueillent","ueillir",["v"],["v"],"present indicative"],["aille","aillir",["v"],["v"],"present indicative"],["ailles","aillir",["v"],["v"],"present indicative"],["aillons","aillir",["v"],["v"],"present indicative"],["aillez","aillir",["v"],["v"],"present indicative"],["aillent","aillir",["v"],["v"],"present indicative"],["faux","aillir",["v"],["v"],"present indicative"],["faut","aillir",["v"],["v"],"present indicative"],["bous","bouillir",["v"],["v"],"present indicative"],["bout","bouillir",["v"],["v"],"present indicative"],["bouillons","bouillir",["v"],["v"],"present indicative"],["bouillez","bouillir",["v"],["v"],"present indicative"],["bouillent","bouillir",["v"],["v"],"present indicative"],["dors","dormir",["v"],["v"],"present indicative"],["dort","dormir",["v"],["v"],"present indicative"],["dormons","dormir",["v"],["v"],"present indicative"],["dormez","dormir",["v"],["v"],"present indicative"],["dorment","dormir",["v"],["v"],"present indicative"],["cours","dormir",["v"],["v"],"present indicative"],["court","dormir",["v"],["v"],"present indicative"],["courons","dormir",["v"],["v"],"present indicative"],["courez","dormir",["v"],["v"],"present indicative"],["courent","dormir",["v"],["v"],"present indicative"],["meurs","mourir",["v"],["v"],"present indicative"],["meurt","mourir",["v"],["v"],"present indicative"],["mourons","mourir",["v"],["v"],"present indicative"],["mourez","mourir",["v"],["v"],"present indicative"],["meurent","mourir",["v"],["v"],"present indicative"],["sers","servir",["v"],["v"],"present indicative"],["sert","servir",["v"],["v"],"present indicative"],["servons","servir",["v"],["v"],"present indicative"],["servez","servir",["v"],["v"],"present indicative"],["servent","servir",["v"],["v"],"present indicative"],["fuis","fuir",["v"],["v"],"present indicative"],["fuit","fuir",["v"],["v"],"present indicative"],["fuyons","fuir",["v"],["v"],"present indicative"],["fuyez","fuir",["v"],["v"],"present indicative"],["fuient","fuir",["v"],["v"],"present indicative"],["ois","ouïr",["v"],["v"],"present indicative"],["oit","ouïr",["v"],["v"],"present indicative"],["oyons","ouïr",["v"],["v"],"present indicative"],["oyez","ouïr",["v"],["v"],"present indicative"],["oient","ouïr",["v"],["v"],"present indicative"],["gis","gésir",["v"],["v"],"present indicative"],["git","gésir",["v"],["v"],"present indicative"],["gisons","gésir",["v"],["v"],"present indicative"],["gisez","gésir",["v"],["v"],"present indicative"],["gisent","gésir",["v"],["v"],"present indicative"],["çois","cevoir",["v"],["v"],"present indicative"],["çoit","cevoir",["v"],["v"],"present indicative"],["cevons","cevoir",["v"],["v"],"present indicative"],["cevez","cevoir",["v"],["v"],"present indicative"],["çoivent","cevoir",["v"],["v"],"present indicative"],["vois","voir",["v"],["v"],"present indicative"],["voit","voir",["v"],["v"],"present indicative"],["voyons","voir",["v"],["v"],"present indicative"],["voyez","voir",["v"],["v"],"present indicative"],["voient","voir",["v"],["v"],"present indicative"],["sais","savoir",["v"],["v"],"present indicative"],["sait","savoir",["v"],["v"],"present indicative"],["savons","savoir",["v"],["v"],"present indicative"],["savez","savoir",["v"],["v"],"present indicative"],["savent","savoir",["v"],["v"],"present indicative"],["dois","devoir",["v"],["v"],"present indicative"],["doit","devoir",["v"],["v"],"present indicative"],["devons","devoir",["v"],["v"],"present indicative"],["devez","devoir",["v"],["v"],"present indicative"],["doivent","devoir",["v"],["v"],"present indicative"],["puis","pouvoir",["v"],["v"],"present indicative"],["peux","pouvoir",["v"],["v"],"present indicative"],["peut","pouvoir",["v"],["v"],"present indicative"],["pouvons","pouvoir",["v"],["v"],"present indicative"],["pouvez","pouvoir",["v"],["v"],"present indicative"],["peuvent","pouvoir",["v"],["v"],"present indicative"],["meus","mouvoir",["v"],["v"],"present indicative"],["meut","mouvoir",["v"],["v"],"present indicative"],["mouvons","mouvoir",["v"],["v"],"present indicative"],["mouvez","mouvoir",["v"],["v"],"present indicative"],["meuvent","mouvoir",["v"],["v"],"present indicative"],["pleut","pleuvoir",["v"],["v"],"present indicative"],["faut","falloir",["v"],["v"],"present indicative"],["vaux","valoir",["v"],["v"],"present indicative"],["vaut","valoir",["v"],["v"],"present indicative"],["valons","valoir",["v"],["v"],"present indicative"],["valez","valoir",["v"],["v"],"present indicative"],["valent","valoir",["v"],["v"],"present indicative"],["veux","vouloir",["v"],["v"],"present indicative"],["veut","vouloir",["v"],["v"],"present indicative"],["voulons","vouloir",["v"],["v"],"present indicative"],["voulez","vouloir",["v"],["v"],"present indicative"],["veulent","vouloir",["v"],["v"],"present indicative"],["sois","seoir",["v"],["v"],"present indicative"],["soit","seoir",["v"],["v"],"present indicative"],["soyons","seoir",["v"],["v"],"present indicative"],["soyez","seoir",["v"],["v"],"present indicative"],["soient","seoir",["v"],["v"],"present indicative"],["assied","asseoir",["v"],["v"],"present indicative"],["assieds","asseoir",["v"],["v"],"present indicative"],["asseyons","asseoir",["v"],["v"],"present indicative"],["asseyez","asseoir",["v"],["v"],"present indicative"],["asseyent","asseoir",["v"],["v"],"present indicative"],["sied","seoir",["v"],["v"],"present indicative"],["chois","choir",["v"],["v"],"present indicative"],["choit","choir",["v"],["v"],"present indicative"],["choyons","choir",["v"],["v"],"present indicative"],["choyez","choir",["v"],["v"],"present indicative"],["choient","choir",["v"],["v"],"present indicative"],["échoit","échoir",["v"],["v"],"present indicative"],["échet","échoir",["v"],["v"],"present indicative"],["échoient","échoir",["v"],["v"],"present indicative"],["échéent","échoir",["v"],["v"],"present indicative"],["and","andre",["v"],["v"],"present indicative"],["ands","andre",["v"],["v"],"present indicative"],["andons","andre",["v"],["v"],"present indicative"],["andez","andre",["v"],["v"],"present indicative"],["andent","andre",["v"],["v"],"present indicative"],["end","endre",["v"],["v"],"present indicative"],["ends","endre",["v"],["v"],"present indicative"],["endons","endre",["v"],["v"],"present indicative"],["endez","endre",["v"],["v"],"present indicative"],["endent","endre",["v"],["v"],"present indicative"],["ond","ondre",["v"],["v"],"present indicative"],["onds","ondre",["v"],["v"],"present indicative"],["ondons","ondre",["v"],["v"],"present indicative"],["ondez","ondre",["v"],["v"],"present indicative"],["ondent","ondre",["v"],["v"],"present indicative"],["erd","erdre",["v"],["v"],"present indicative"],["erds","erdre",["v"],["v"],"present indicative"],["erdons","erdre",["v"],["v"],"present indicative"],["erdez","erdre",["v"],["v"],"present indicative"],["erdent","erdre",["v"],["v"],"present indicative"],["ord","ordre",["v"],["v"],"present indicative"],["ords","ordre",["v"],["v"],"present indicative"],["ordons","ordre",["v"],["v"],"present indicative"],["ordez","ordre",["v"],["v"],"present indicative"],["ordent","ordre",["v"],["v"],"present indicative"],["prenons","prendre",["v"],["v"],"present indicative"],["prenez","prendre",["v"],["v"],"present indicative"],["prenent","prendre",["v"],["v"],"present indicative"],["bats","battre",["v"],["v"],"present indicative"],["bat","battre",["v"],["v"],"present indicative"],["battons","battre",["v"],["v"],"present indicative"],["battez","battre",["v"],["v"],"present indicative"],["battent","battre",["v"],["v"],"present indicative"],["mets","mettre",["v"],["v"],"present indicative"],["met","mettre",["v"],["v"],"present indicative"],["mettons","mettre",["v"],["v"],"present indicative"],["mettez","mettre",["v"],["v"],"present indicative"],["mettent","mettre",["v"],["v"],"present indicative"],["eins","eindre",["v"],["v"],"present indicative"],["eint","eindre",["v"],["v"],"present indicative"],["eignons","eindre",["v"],["v"],"present indicative"],["eignez","eindre",["v"],["v"],"present indicative"],["eignent","eindre",["v"],["v"],"present indicative"],["oins","oindre",["v"],["v"],"present indicative"],["oint","oindre",["v"],["v"],"present indicative"],["oignons","oindre",["v"],["v"],"present indicative"],["oignez","oindre",["v"],["v"],"present indicative"],["oignent","oindre",["v"],["v"],"present indicative"],["ains","aindre",["v"],["v"],"present indicative"],["aint","aindre",["v"],["v"],"present indicative"],["aignons","aindre",["v"],["v"],"present indicative"],["aignez","aindre",["v"],["v"],"present indicative"],["aignent","aindre",["v"],["v"],"present indicative"],["vaincs","vaincre",["v"],["v"],"present indicative"],["vainc","vaincre",["v"],["v"],"present indicative"],["vainquons","vaincre",["v"],["v"],"present indicative"],["vainquez","vaincre",["v"],["v"],"present indicative"],["vainquent","vaincre",["v"],["v"],"present indicative"],["rais","raire",["v"],["v"],"present indicative"],["rait","raire",["v"],["v"],"present indicative"],["rayons","raire",["v"],["v"],"present indicative"],["rayez","raire",["v"],["v"],"present indicative"],["raient","raire",["v"],["v"],"present indicative"],["fais","faire",["v"],["v"],"present indicative"],["fait","faire",["v"],["v"],"present indicative"],["faisons","faire",["v"],["v"],"present indicative"],["faites","faire",["v"],["v"],"present indicative"],["font","faire",["v"],["v"],"present indicative"],["plais","faire",["v"],["v"],"present indicative"],["plait","faire",["v"],["v"],"present indicative"],["plaisons","faire",["v"],["v"],"present indicative"],["plaisez","faire",["v"],["v"],"present indicative"],["plaisent","faire",["v"],["v"],"present indicative"],["ais","aître",["v"],["v"],"present indicative"],["aît","aître",["v"],["v"],"present indicative"],["ait","aître",["v"],["v"],"present indicative"],["aissons","aître",["v"],["v"],"present indicative"],["aissez","aître",["v"],["v"],"present indicative"],["aissent","aître",["v"],["v"],"present indicative"],["ois","oître",["v"],["v"],"present indicative"],["oît","oître",["v"],["v"],"present indicative"],["oit","oître",["v"],["v"],"present indicative"],["oissons","oître",["v"],["v"],"present indicative"],["oissez","oître",["v"],["v"],"present indicative"],["oissent","oître",["v"],["v"],"present indicative"],["crois","croire",["v"],["v"],"present indicative"],["croît","croire",["v"],["v"],"present indicative"],["croit","croire",["v"],["v"],"present indicative"],["croyons","croire",["v"],["v"],"present indicative"],["croyez","croire",["v"],["v"],"present indicative"],["croient","croire",["v"],["v"],"present indicative"],["bois","boire",["v"],["v"],"present indicative"],["boît","boire",["v"],["v"],"present indicative"],["boit","boire",["v"],["v"],"present indicative"],["buvons","boire",["v"],["v"],"present indicative"],["buvez","boire",["v"],["v"],"present indicative"],["boivent","boire",["v"],["v"],"present indicative"],["clos","clore",["v"],["v"],"present indicative"],["clôt","clore",["v"],["v"],"present indicative"],["closent","croire",["v"],["v"],"present indicative"],["clus","clure",["v"],["v"],"present indicative"],["clut","clure",["v"],["v"],"present indicative"],["cluons","clure",["v"],["v"],"present indicative"],["cluez","clure",["v"],["v"],"present indicative"],["cluent","clure",["v"],["v"],"present indicative"],["sous","soudre",["v"],["v"],"present indicative"],["sout","soudre",["v"],["v"],"present indicative"],["solvons","soudre",["v"],["v"],"present indicative"],["solvez","soudre",["v"],["v"],"present indicative"],["solvent","soudre",["v"],["v"],"present indicative"],["coud","coudre",["v"],["v"],"present indicative"],["couds","coudre",["v"],["v"],"present indicative"],["cousons","coudre",["v"],["v"],"present indicative"],["cousez","coudre",["v"],["v"],"present indicative"],["cousent","coudre",["v"],["v"],"present indicative"],["moud","moudre",["v"],["v"],"present indicative"],["mouds","moudre",["v"],["v"],"present indicative"],["moulons","moudre",["v"],["v"],"present indicative"],["moulez","moudre",["v"],["v"],"present indicative"],["moulent","moudre",["v"],["v"],"present indicative"],["is","vivre",["v"],["v"],"present indicative"],["it","vivre",["v"],["v"],"present indicative"],["ivons","vivre",["v"],["v"],"present indicative"],["ivez","vivre",["v"],["v"],"present indicative"],["ivent","vivre",["v"],["v"],"present indicative"],["lis","lire",["v"],["v"],"present indicative"],["lit","lire",["v"],["v"],"present indicative"],["lisons","lire",["v"],["v"],"present indicative"],["lisez","lire",["v"],["v"],"present indicative"],["lisent","lire",["v"],["v"],"present indicative"],["dis","dire",["v"],["v"],"present indicative"],["dit","dire",["v"],["v"],"present indicative"],["disons","dire",["v"],["v"],"present indicative"],["disez","dire",["v"],["v"],"present indicative"],["disent","dire",["v"],["v"],"present indicative"],["ris","rire",["v"],["v"],"present indicative"],["rit","rire",["v"],["v"],"present indicative"],["rions","rire",["v"],["v"],"present indicative"],["riez","rire",["v"],["v"],"present indicative"],["rient","rire",["v"],["v"],"present indicative"],["maudissons","maudire",["v"],["v"],"present indicative"],["maudissez","maudire",["v"],["v"],"present indicative"],["maudissent","maudire",["v"],["v"],"present indicative"],["cris","crire",["v"],["v"],"present indicative"],["crit","crire",["v"],["v"],"present indicative"],["crivons","crire",["v"],["v"],"present indicative"],["crivez","crire",["v"],["v"],"present indicative"],["crivent","crire",["v"],["v"],"present indicative"],["fis","fire",["v"],["v"],"present indicative"],["fit","fire",["v"],["v"],"present indicative"],["fisons","fire",["v"],["v"],"present indicative"],["fisez","fire",["v"],["v"],"present indicative"],["fisent","fire",["v"],["v"],"present indicative"],["cis","cire",["v"],["v"],"present indicative"],["cit","cire",["v"],["v"],"present indicative"],["cisons","cire",["v"],["v"],"present indicative"],["cisez","cire",["v"],["v"],"present indicative"],["cisent","cire",["v"],["v"],"present indicative"],["fris","frire",["v"],["v"],"present indicative"],["frit","frire",["v"],["v"],"present indicative"],["frisons","frire",["v"],["v"],"present indicative"],["frisez","frire",["v"],["v"],"present indicative"],["frisent","frire",["v"],["v"],"present indicative"],["uis","uire",["v"],["v"],"present indicative"],["uit","uire",["v"],["v"],"present indicative"],["uisons","uire",["v"],["v"],"present indicative"],["uisez","uire",["v"],["v"],"present indicative"],["uisent","uire",["v"],["v"],"present indicative"],["étais","être",["v"],["v"],"imperfect indicative"],["était","être",["v"],["v"],"imperfect indicative"],["étions","être",["v"],["v"],"imperfect indicative"],["étiez","être",["v"],["v"],"imperfect indicative"],["étaient","être",["v"],["v"],"imperfect indicative"],["avais","avoir",["v"],["v"],"imperfect indicative"],["avait","avoir",["v"],["v"],"imperfect indicative"],["avions","avoir",["v"],["v"],"imperfect indicative"],["aviez","avoir",["v"],["v"],"imperfect indicative"],["avaient","avoir",["v"],["v"],"imperfect indicative"],["ais","er",["v"],["v"],"imperfect indicative"],["ait","er",["v"],["v"],"imperfect indicative"],["ions","er",["v"],["v"],"imperfect indicative"],["iez","er",["v"],["v"],"imperfect indicative"],["aient","er",["v"],["v"],"imperfect indicative"],["çais","cer",["v"],["v"],"imperfect indicative"],["çait","cer",["v"],["v"],"imperfect indicative"],["çions","cer",["v"],["v"],"imperfect indicative"],["çiez","cer",["v"],["v"],"imperfect indicative"],["çaient","cer",["v"],["v"],"imperfect indicative"],["geais","ger",["v"],["v"],"imperfect indicative"],["geait","ger",["v"],["v"],"imperfect indicative"],["geaient","ger",["v"],["v"],"imperfect indicative"],["issais","ir",["v"],["v"],"imperfect indicative"],["issait","ir",["v"],["v"],"imperfect indicative"],["issions","ir",["v"],["v"],"imperfect indicative"],["issiez","ir",["v"],["v"],"imperfect indicative"],["issaient","ir",["v"],["v"],"imperfect indicative"],["haïssais","haïr",["v"],["v"],"imperfect indicative"],["haïssait","haïr",["v"],["v"],"imperfect indicative"],["haïssions","haïr",["v"],["v"],"imperfect indicative"],["haïssaient","haïr",["v"],["v"],"imperfect indicative"],["haissais","haïr",["v"],["v"],"imperfect indicative"],["haissait","haïr",["v"],["v"],"imperfect indicative"],["haissions","haïr",["v"],["v"],"imperfect indicative"],["haissaient","haïr",["v"],["v"],"imperfect indicative"],["allais","aller",["v"],["v"],"imperfect indicative"],["allait","aller",["v"],["v"],"imperfect indicative"],["allions","aller",["v"],["v"],"imperfect indicative"],["alliez","aller",["v"],["v"],"imperfect indicative"],["allaient","aller",["v"],["v"],"imperfect indicative"],["enais","enir",["v"],["v"],"imperfect indicative"],["enait","enir",["v"],["v"],"imperfect indicative"],["enions","enir",["v"],["v"],"imperfect indicative"],["eniez","enir",["v"],["v"],"imperfect indicative"],["enaient","enir",["v"],["v"],"imperfect indicative"],["érais","érir",["v"],["v"],"imperfect indicative"],["érait","érir",["v"],["v"],"imperfect indicative"],["érions","érir",["v"],["v"],"imperfect indicative"],["ériez","érir",["v"],["v"],"imperfect indicative"],["éraient","érir",["v"],["v"],"imperfect indicative"],["tais","tir",["v"],["v"],"imperfect indicative"],["tait","tir",["v"],["v"],"imperfect indicative"],["tions","tir",["v"],["v"],"imperfect indicative"],["tiez","tir",["v"],["v"],"imperfect indicative"],["taient","tir",["v"],["v"],"imperfect indicative"],["êtais","êtir",["v"],["v"],"imperfect indicative"],["êtait","êtir",["v"],["v"],"imperfect indicative"],["êtions","êtir",["v"],["v"],"imperfect indicative"],["êtiez","êtir",["v"],["v"],"imperfect indicative"],["êtaient","êtir",["v"],["v"],"imperfect indicative"],["vrais","vrir",["v"],["v"],"imperfect indicative"],["vrait","vrir",["v"],["v"],"imperfect indicative"],["vrions","vrir",["v"],["v"],"imperfect indicative"],["vriez","vrir",["v"],["v"],"imperfect indicative"],["vraient","vrir",["v"],["v"],"imperfect indicative"],["frais","frir",["v"],["v"],"imperfect indicative"],["frait","frir",["v"],["v"],"imperfect indicative"],["frions","frir",["v"],["v"],"imperfect indicative"],["friez","frir",["v"],["v"],"imperfect indicative"],["fraient","frir",["v"],["v"],"imperfect indicative"],["ueillais","ueillir",["v"],["v"],"imperfect indicative"],["ueillait","ueillir",["v"],["v"],"imperfect indicative"],["ueillions","ueillir",["v"],["v"],"imperfect indicative"],["ueilliez","ueillir",["v"],["v"],"imperfect indicative"],["ueillaient","ueillir",["v"],["v"],"imperfect indicative"],["aillais","aillir",["v"],["v"],"imperfect indicative"],["aillait","aillir",["v"],["v"],"imperfect indicative"],["aillions","aillir",["v"],["v"],"imperfect indicative"],["ailliez","aillir",["v"],["v"],"imperfect indicative"],["aillaient","aillir",["v"],["v"],"imperfect indicative"],["bouilliais","bouillir",["v"],["v"],"imperfect indicative"],["bouilliait","bouillir",["v"],["v"],"imperfect indicative"],["bouillions","bouillir",["v"],["v"],"imperfect indicative"],["bouilliez","bouillir",["v"],["v"],"imperfect indicative"],["bouillaient","bouillir",["v"],["v"],"imperfect indicative"],["dormais","dormir",["v"],["v"],"imperfect indicative"],["dormait","dormir",["v"],["v"],"imperfect indicative"],["dormions","dormir",["v"],["v"],"imperfect indicative"],["dormiez","dormir",["v"],["v"],"imperfect indicative"],["dormaient","dormir",["v"],["v"],"imperfect indicative"],["courais","dormir",["v"],["v"],"imperfect indicative"],["courait","dormir",["v"],["v"],"imperfect indicative"],["courions","dormir",["v"],["v"],"imperfect indicative"],["couriez","dormir",["v"],["v"],"imperfect indicative"],["couraient","dormir",["v"],["v"],"imperfect indicative"],["mourais","mourir",["v"],["v"],"imperfect indicative"],["mourait","mourir",["v"],["v"],"imperfect indicative"],["mourions","mourir",["v"],["v"],"imperfect indicative"],["mouriez","mourir",["v"],["v"],"imperfect indicative"],["mouraient","mourir",["v"],["v"],"imperfect indicative"],["servais","servir",["v"],["v"],"imperfect indicative"],["servait","servir",["v"],["v"],"imperfect indicative"],["servions","servir",["v"],["v"],"imperfect indicative"],["serviez","servir",["v"],["v"],"imperfect indicative"],["servaient","servir",["v"],["v"],"imperfect indicative"],["fuyais","fuir",["v"],["v"],"imperfect indicative"],["fuyait","fuir",["v"],["v"],"imperfect indicative"],["fuyions","fuir",["v"],["v"],"imperfect indicative"],["fuyiez","fuir",["v"],["v"],"imperfect indicative"],["fuyaient","fuir",["v"],["v"],"imperfect indicative"],["oyais","ouïr",["v"],["v"],"imperfect indicative"],["oyait","ouïr",["v"],["v"],"imperfect indicative"],["oyions","ouïr",["v"],["v"],"imperfect indicative"],["oyiez","ouïr",["v"],["v"],"imperfect indicative"],["oyaient","ouïr",["v"],["v"],"imperfect indicative"],["gisais","gésir",["v"],["v"],"imperfect indicative"],["gisait","gésir",["v"],["v"],"imperfect indicative"],["gisions","gésir",["v"],["v"],"imperfect indicative"],["gisiez","gésir",["v"],["v"],"imperfect indicative"],["gisaient","gésir",["v"],["v"],"imperfect indicative"],["cevais","cevoir",["v"],["v"],"imperfect indicative"],["cevait","cevoir",["v"],["v"],"imperfect indicative"],["cevions","cevoir",["v"],["v"],"imperfect indicative"],["ceviez","cevoir",["v"],["v"],"imperfect indicative"],["cevaient","cevoir",["v"],["v"],"imperfect indicative"],["voyais","voir",["v"],["v"],"imperfect indicative"],["voyait","voir",["v"],["v"],"imperfect indicative"],["voyions","voir",["v"],["v"],"imperfect indicative"],["voyiez","voir",["v"],["v"],"imperfect indicative"],["voyaient","voir",["v"],["v"],"imperfect indicative"],["savais","savoir",["v"],["v"],"imperfect indicative"],["savait","savoir",["v"],["v"],"imperfect indicative"],["savions","savoir",["v"],["v"],"imperfect indicative"],["saviez","savoir",["v"],["v"],"imperfect indicative"],["savaient","savoir",["v"],["v"],"imperfect indicative"],["devais","devoir",["v"],["v"],"imperfect indicative"],["devait","devoir",["v"],["v"],"imperfect indicative"],["devions","devoir",["v"],["v"],"imperfect indicative"],["deviez","devoir",["v"],["v"],"imperfect indicative"],["devaient","devoir",["v"],["v"],"imperfect indicative"],["pouvais","pouvoir",["v"],["v"],"imperfect indicative"],["pouvait","pouvoir",["v"],["v"],"imperfect indicative"],["pouvions","pouvoir",["v"],["v"],"imperfect indicative"],["pouviez","pouvoir",["v"],["v"],"imperfect indicative"],["pouvaient","pouvoir",["v"],["v"],"imperfect indicative"],["mouvais","mouvoir",["v"],["v"],"imperfect indicative"],["mouvait","mouvoir",["v"],["v"],"imperfect indicative"],["mouvions","mouvoir",["v"],["v"],"imperfect indicative"],["mouviez","mouvoir",["v"],["v"],"imperfect indicative"],["mouvaient","mouvoir",["v"],["v"],"imperfect indicative"],["pleuvait","pleuvoir",["v"],["v"],"imperfect indicative"],["fallait","falloir",["v"],["v"],"imperfect indicative"],["valais","vouloir",["v"],["v"],"imperfect indicative"],["valait","vouloir",["v"],["v"],"imperfect indicative"],["valions","vouloir",["v"],["v"],"imperfect indicative"],["valiez","vouloir",["v"],["v"],"imperfect indicative"],["valaient","vouloir",["v"],["v"],"imperfect indicative"],["voulais","vouloir",["v"],["v"],"imperfect indicative"],["voulait","vouloir",["v"],["v"],"imperfect indicative"],["voulions","vouloir",["v"],["v"],"imperfect indicative"],["vouliez","vouloir",["v"],["v"],"imperfect indicative"],["voulaient","vouloir",["v"],["v"],"imperfect indicative"],["seyais","seoir",["v"],["v"],"imperfect indicative"],["seyait","seoir",["v"],["v"],"imperfect indicative"],["seyions","seoir",["v"],["v"],"imperfect indicative"],["seyiez","seoir",["v"],["v"],"imperfect indicative"],["seyaient","seoir",["v"],["v"],"imperfect indicative"],["soyais","seoir",["v"],["v"],"imperfect indicative"],["soyait","seoir",["v"],["v"],"imperfect indicative"],["soyions","seoir",["v"],["v"],"imperfect indicative"],["soyiez","seoir",["v"],["v"],"imperfect indicative"],["soyaient","seoir",["v"],["v"],"imperfect indicative"],["assoyais","asseoir",["v"],["v"],"imperfect indicative"],["assoyait","asseoir",["v"],["v"],"imperfect indicative"],["assoyions","asseoir",["v"],["v"],"imperfect indicative"],["assoyiez","asseoir",["v"],["v"],"imperfect indicative"],["assoyaient","asseoir",["v"],["v"],"imperfect indicative"],["sied","seoir",["v"],["v"],"imperfect indicative"],["siéent","seoir",["v"],["v"],"imperfect indicative"],["échoyait","échoir",["v"],["v"],"imperfect indicative"],["échoyaient","échoir",["v"],["v"],"imperfect indicative"],["andais","andre",["v"],["v"],"imperfect indicative"],["andais","andre",["v"],["v"],"imperfect indicative"],["andions","andre",["v"],["v"],"imperfect indicative"],["andiez","andre",["v"],["v"],"imperfect indicative"],["andaient","andre",["v"],["v"],"imperfect indicative"],["endais","endre",["v"],["v"],"imperfect indicative"],["endait","endre",["v"],["v"],"imperfect indicative"],["endions","endre",["v"],["v"],"imperfect indicative"],["endiez","endre",["v"],["v"],"imperfect indicative"],["endaient","endre",["v"],["v"],"imperfect indicative"],["ondais","ondre",["v"],["v"],"imperfect indicative"],["ondait","ondre",["v"],["v"],"imperfect indicative"],["ondions","ondre",["v"],["v"],"imperfect indicative"],["ondiez","ondre",["v"],["v"],"imperfect indicative"],["ondaient","ondre",["v"],["v"],"imperfect indicative"],["erdais","erdre",["v"],["v"],"imperfect indicative"],["erdait","erdre",["v"],["v"],"imperfect indicative"],["erdions","erdre",["v"],["v"],"imperfect indicative"],["erdiez","erdre",["v"],["v"],"imperfect indicative"],["erdaient","erdre",["v"],["v"],"imperfect indicative"],["ordais","ordre",["v"],["v"],"imperfect indicative"],["ordait","ordre",["v"],["v"],"imperfect indicative"],["ordions","ordre",["v"],["v"],"imperfect indicative"],["ordiez","ordre",["v"],["v"],"imperfect indicative"],["ordaient","ordre",["v"],["v"],"imperfect indicative"],["prenais","prendre",["v"],["v"],"imperfect indicative"],["prenait","prendre",["v"],["v"],"imperfect indicative"],["prenions","prendre",["v"],["v"],"imperfect indicative"],["preniez","prendre",["v"],["v"],"imperfect indicative"],["prenaient","prendre",["v"],["v"],"imperfect indicative"],["battais","battre",["v"],["v"],"imperfect indicative"],["battait","battre",["v"],["v"],"imperfect indicative"],["battions","battre",["v"],["v"],"imperfect indicative"],["battiez","battre",["v"],["v"],"imperfect indicative"],["battaient","battre",["v"],["v"],"imperfect indicative"],["mettais","mettre",["v"],["v"],"imperfect indicative"],["mettait","mettre",["v"],["v"],"imperfect indicative"],["mettions","mettre",["v"],["v"],"imperfect indicative"],["mettiez","mettre",["v"],["v"],"imperfect indicative"],["mettaient","mettre",["v"],["v"],"imperfect indicative"],["eignais","eindre",["v"],["v"],"imperfect indicative"],["eignait","eindre",["v"],["v"],"imperfect indicative"],["eiginons","eindre",["v"],["v"],"imperfect indicative"],["eiginez","eindre",["v"],["v"],"imperfect indicative"],["eignaient","eindre",["v"],["v"],"imperfect indicative"],["oignais","oindre",["v"],["v"],"imperfect indicative"],["oignait","oindre",["v"],["v"],"imperfect indicative"],["oignions","oindre",["v"],["v"],"imperfect indicative"],["oigniez","oindre",["v"],["v"],"imperfect indicative"],["oignaient","oindre",["v"],["v"],"imperfect indicative"],["aignais","aindre",["v"],["v"],"imperfect indicative"],["aignait","aindre",["v"],["v"],"imperfect indicative"],["aignions","aindre",["v"],["v"],"imperfect indicative"],["aigniez","aindre",["v"],["v"],"imperfect indicative"],["aignaient","aindre",["v"],["v"],"imperfect indicative"],["vainquas","vaincre",["v"],["v"],"imperfect indicative"],["vainquait","vaincre",["v"],["v"],"imperfect indicative"],["vainquions","vaincre",["v"],["v"],"imperfect indicative"],["vainquiez","vaincre",["v"],["v"],"imperfect indicative"],["vainquaient","vaincre",["v"],["v"],"imperfect indicative"],["rayais","raire",["v"],["v"],"imperfect indicative"],["raiyat","raire",["v"],["v"],"imperfect indicative"],["rayions","raire",["v"],["v"],"imperfect indicative"],["rayiez","raire",["v"],["v"],"imperfect indicative"],["rayaient","raire",["v"],["v"],"imperfect indicative"],["faisais","faire",["v"],["v"],"imperfect indicative"],["faisait","faire",["v"],["v"],"imperfect indicative"],["faisions","faire",["v"],["v"],"imperfect indicative"],["faisiez","faire",["v"],["v"],"imperfect indicative"],["faisaient","faire",["v"],["v"],"imperfect indicative"],["plaisais","faire",["v"],["v"],"imperfect indicative"],["plaisait","faire",["v"],["v"],"imperfect indicative"],["plaisions","faire",["v"],["v"],"imperfect indicative"],["plaisiez","faire",["v"],["v"],"imperfect indicative"],["plaisaient","faire",["v"],["v"],"imperfect indicative"],["aissais","aître",["v"],["v"],"imperfect indicative"],["aissait","aître",["v"],["v"],"imperfect indicative"],["aissions","aître",["v"],["v"],"imperfect indicative"],["aissiez","aître",["v"],["v"],"imperfect indicative"],["aissaient","aître",["v"],["v"],"imperfect indicative"],["oissais","oître",["v"],["v"],"imperfect indicative"],["oissait","oître",["v"],["v"],"imperfect indicative"],["oissions","oître",["v"],["v"],"imperfect indicative"],["oissiez","oître",["v"],["v"],"imperfect indicative"],["oissaient","oître",["v"],["v"],"imperfect indicative"],["croyais","croire",["v"],["v"],"imperfect indicative"],["croyait","croire",["v"],["v"],"imperfect indicative"],["croyions","croire",["v"],["v"],"imperfect indicative"],["croyiez","croire",["v"],["v"],"imperfect indicative"],["croyaient","croire",["v"],["v"],"imperfect indicative"],["buvais","boire",["v"],["v"],"imperfect indicative"],["buvait","boire",["v"],["v"],"imperfect indicative"],["buvions","boire",["v"],["v"],"imperfect indicative"],["buviez","boire",["v"],["v"],"imperfect indicative"],["buvaient","boire",["v"],["v"],"imperfect indicative"],["cluais","clure",["v"],["v"],"imperfect indicative"],["cluait","clure",["v"],["v"],"imperfect indicative"],["cluions","clure",["v"],["v"],"imperfect indicative"],["cluiez","clure",["v"],["v"],"imperfect indicative"],["cluaient","clure",["v"],["v"],"imperfect indicative"],["solvais","soudre",["v"],["v"],"imperfect indicative"],["solvait","soudre",["v"],["v"],"imperfect indicative"],["solvions","soudre",["v"],["v"],"imperfect indicative"],["solviez","soudre",["v"],["v"],"imperfect indicative"],["solvaient","soudre",["v"],["v"],"imperfect indicative"],["cousais","coudre",["v"],["v"],"imperfect indicative"],["cousait","coudre",["v"],["v"],"imperfect indicative"],["cousions","coudre",["v"],["v"],"imperfect indicative"],["cousiez","coudre",["v"],["v"],"imperfect indicative"],["cousaient","coudre",["v"],["v"],"imperfect indicative"],["moulais","moudre",["v"],["v"],"imperfect indicative"],["moulait","moudre",["v"],["v"],"imperfect indicative"],["moulions","moudre",["v"],["v"],"imperfect indicative"],["mouliez","moudre",["v"],["v"],"imperfect indicative"],["moulaient","moudre",["v"],["v"],"imperfect indicative"],["ivais","vivre",["v"],["v"],"imperfect indicative"],["ivait","vivre",["v"],["v"],"imperfect indicative"],["ivions","vivre",["v"],["v"],"imperfect indicative"],["iviez","vivre",["v"],["v"],"imperfect indicative"],["ivaient","vivre",["v"],["v"],"imperfect indicative"],["lisais","lire",["v"],["v"],"imperfect indicative"],["lisait","lire",["v"],["v"],"imperfect indicative"],["lisions","lire",["v"],["v"],"imperfect indicative"],["lisiez","lire",["v"],["v"],"imperfect indicative"],["lisaient","lire",["v"],["v"],"imperfect indicative"],["disais","dire",["v"],["v"],"imperfect indicative"],["disait","dire",["v"],["v"],"imperfect indicative"],["disions","dire",["v"],["v"],"imperfect indicative"],["disiez","dire",["v"],["v"],"imperfect indicative"],["disaient","dire",["v"],["v"],"imperfect indicative"],["riais","rire",["v"],["v"],"imperfect indicative"],["riait","rire",["v"],["v"],"imperfect indicative"],["riions","rire",["v"],["v"],"imperfect indicative"],["riiez","rire",["v"],["v"],"imperfect indicative"],["riaient","rire",["v"],["v"],"imperfect indicative"],["maudissais","maudire",["v"],["v"],"imperfect indicative"],["maudissait","maudire",["v"],["v"],"imperfect indicative"],["maudissions","maudire",["v"],["v"],"imperfect indicative"],["maudissiez","maudire",["v"],["v"],"imperfect indicative"],["maudissaient","maudire",["v"],["v"],"imperfect indicative"],["crivais","crire",["v"],["v"],"imperfect indicative"],["crivait","crire",["v"],["v"],"imperfect indicative"],["crivions","crire",["v"],["v"],"imperfect indicative"],["criviez","crire",["v"],["v"],"imperfect indicative"],["crivaient","crire",["v"],["v"],"imperfect indicative"],["fisais","fire",["v"],["v"],"imperfect indicative"],["fisait","fire",["v"],["v"],"imperfect indicative"],["fisions","fire",["v"],["v"],"imperfect indicative"],["fisiez","fire",["v"],["v"],"imperfect indicative"],["fisaient","fire",["v"],["v"],"imperfect indicative"],["cisais","cire",["v"],["v"],"imperfect indicative"],["cisait","cire",["v"],["v"],"imperfect indicative"],["cisions","cire",["v"],["v"],"imperfect indicative"],["cisiez","cire",["v"],["v"],"imperfect indicative"],["cisaient","cire",["v"],["v"],"imperfect indicative"],["frisais","frire",["v"],["v"],"imperfect indicative"],["frisait","frire",["v"],["v"],"imperfect indicative"],["frisions","frire",["v"],["v"],"imperfect indicative"],["frisiez","frire",["v"],["v"],"imperfect indicative"],["frisaient","frire",["v"],["v"],"imperfect indicative"],["uisais","uire",["v"],["v"],"imperfect indicative"],["uisait","uire",["v"],["v"],"imperfect indicative"],["uisions","uire",["v"],["v"],"imperfect indicative"],["uisiez","uire",["v"],["v"],"imperfect indicative"],["uisaient","uire",["v"],["v"],"imperfect indicative"],["serai","être",["aux"],["v"],"future"],["seras","être",["aux"],["v"],"future"],["sera","être",["aux"],["v"],"future"],["serons,","être",["aux"],["v"],"future"],["serez","être",["aux"],["v"],"future"],["seront","être",["aux"],["v"],"future"],["aurai","avoir",["aux"],["v"],"future"],["auras","avoir",["aux"],["v"],"future"],["aura","avoir",["aux"],["v"],"future"],["aurons","avoir",["aux"],["v"],"future"],["aurez","avoir",["aux"],["v"],"future"],["auront","avoir",["aux"],["v"],"future"],["erai","er",["v"],["v"],"future"],["eras","er",["v"],["v"],"future"],["era","er",["v"],["v"],"future"],["erons","er",["v"],["v"],"future"],["erez","er",["v"],["v"],"future"],["eront","er",["v"],["v"],"future"],["ècerai","ecer",["v"],["v"],"future"],["èverai","ever",["v"],["v"],"future"],["ènerai","ener",["v"],["v"],"future"],["èperai","eper",["v"],["v"],"future"],["èrerai","erer",["v"],["v"],"future"],["èmerai","emer",["v"],["v"],"future"],["èvrerai","evrer",["v"],["v"],"future"],["èserai","eser",["v"],["v"],"future"],["èceras","ecer",["v"],["v"],"future"],["èveras","ever",["v"],["v"],"future"],["èneras","ener",["v"],["v"],"future"],["èperas","eper",["v"],["v"],"future"],["èreras","erer",["v"],["v"],"future"],["èmeras","emer",["v"],["v"],"future"],["èvreras","evrer",["v"],["v"],"future"],["èseras","eser",["v"],["v"],"future"],["ècera","ecer",["v"],["v"],"future"],["èvera","ever",["v"],["v"],"future"],["ènera","ener",["v"],["v"],"future"],["èpera","eper",["v"],["v"],"future"],["èrera","erer",["v"],["v"],"future"],["èmera","emer",["v"],["v"],"future"],["èvrera","evrer",["v"],["v"],"future"],["èsera","eser",["v"],["v"],"future"],["ècerons","ecer",["v"],["v"],"future"],["èverons","ever",["v"],["v"],"future"],["ènerons","ener",["v"],["v"],"future"],["èperons","eper",["v"],["v"],"future"],["èrerons","erer",["v"],["v"],"future"],["èmerons","emer",["v"],["v"],"future"],["èvrerons","evrer",["v"],["v"],"future"],["èserons","eser",["v"],["v"],"future"],["ècerez","ecer",["v"],["v"],"future"],["èverez","ever",["v"],["v"],"future"],["ènerez","ener",["v"],["v"],"future"],["èperez","eper",["v"],["v"],"future"],["èrerez","erer",["v"],["v"],"future"],["èmerez","emer",["v"],["v"],"future"],["èvrerez","evrer",["v"],["v"],"future"],["èserez","eser",["v"],["v"],"future"],["èceront","ecer",["v"],["v"],"future"],["èveront","ever",["v"],["v"],"future"],["èneront","ener",["v"],["v"],"future"],["èperontz","eper",["v"],["v"],"future"],["èreront","erer",["v"],["v"],"future"],["èmeront","emer",["v"],["v"],"future"],["èvreront","evrer",["v"],["v"],"future"],["èseront","eser",["v"],["v"],"future"],["ellerai","eler",["v"],["v"],"future"],["elleras","eler",["v"],["v"],"future"],["ellera","eler",["v"],["v"],"future"],["ellerons","eler",["v"],["v"],"future"],["ellerez","eler",["v"],["v"],"future"],["elleront","eler",["v"],["v"],"future"],["etterais","eter",["v"],["v"],"future"],["etteras","eter",["v"],["v"],"future"],["ettera","eter",["v"],["v"],"future"],["etterons","eter",["v"],["v"],"future"],["etterez","eter",["v"],["v"],"future"],["etteront","eter",["v"],["v"],"future"],["èlerai","eler",["v"],["v"],"future"],["èleras","eler",["v"],["v"],"future"],["èlera","eler",["v"],["v"],"future"],["èlerons","eler",["v"],["v"],"future"],["èlerez","eler",["v"],["v"],"future"],["èleront","eler",["v"],["v"],"future"],["èterai","eter",["v"],["v"],"future"],["èteras","eter",["v"],["v"],"future"],["ètera","eter",["v"],["v"],"future"],["èterons","eter",["v"],["v"],"future"],["èterez","eter",["v"],["v"],"future"],["èteront","eter",["v"],["v"],"future"],["ègerai","éger",["v"],["v"],"future"],["ègeras","éger",["v"],["v"],"future"],["ègera","éger",["v"],["v"],"future"],["ègerons","éger",["v"],["v"],"future"],["ègerez","éger",["v"],["v"],"future"],["ègeront","éger",["v"],["v"],"future"],["aierai","ayer",["v"],["v"],"future"],["aieras","ayer",["v"],["v"],"future"],["aiera","ayer",["v"],["v"],"future"],["aierons","ayer",["v"],["v"],"future"],["aierez","ayer",["v"],["v"],"future"],["aieront","ayer",["v"],["v"],"future"],["ayerai","ayer",["v"],["v"],"future"],["ayeras","ayer",["v"],["v"],"future"],["ayera","ayer",["v"],["v"],"future"],["ayerons","ayer",["v"],["v"],"future"],["ayerez","ayer",["v"],["v"],"future"],["ayeront","ayer",["v"],["v"],"future"],["oierai","oyer",["v"],["v"],"future"],["oieras","oyer",["v"],["v"],"future"],["oiera","oyer",["v"],["v"],"future"],["oierons","oyer",["v"],["v"],"future"],["oierez","oyer",["v"],["v"],"future"],["oieront","oyer",["v"],["v"],"future"],["uierai","uyer",["v"],["v"],"future"],["uieras","uyer",["v"],["v"],"future"],["uiera","uyer",["v"],["v"],"future"],["uierons","uyer",["v"],["v"],"future"],["uierez","uyer",["v"],["v"],"future"],["uieront","uyer",["v"],["v"],"future"],["enverrai","envoyer",["v"],["v"],"future"],["enverras","envoyer",["v"],["v"],"future"],["enverra","envoyer",["v"],["v"],"future"],["enverrons","envoyer",["v"],["v"],"future"],["enverrez","envoyer",["v"],["v"],"future"],["enverront","envoyer",["v"],["v"],"future"],["irai","ir",["v"],["v"],"future"],["iras","ir",["v"],["v"],"future"],["ira","ir",["v"],["v"],"future"],["irons","ir",["v"],["v"],"future"],["irez","ir",["v"],["v"],"future"],["iront","ir",["v"],["v"],"future"],["ïrai","ïr",["v"],["v"],"future"],["ïras","ïr",["v"],["v"],"future"],["ïra","ïr",["v"],["v"],"future"],["ïrons","ïr",["v"],["v"],"future"],["ïrez","ïr",["v"],["v"],"future"],["ïront","ïr",["v"],["v"],"future"],["irai","aller",["v"],["v"],"future"],["iras","aller",["v"],["v"],"future"],["ira","aller",["v"],["v"],"future"],["irons","aller",["v"],["v"],"future"],["irez","aller",["v"],["v"],"future"],["iront","aller",["v"],["v"],"future"],["iendrai","enir",["v"],["v"],"future"],["iendras","enir",["v"],["v"],"future"],["iendrons","enir",["v"],["v"],"future"],["iendrez","enir",["v"],["v"],"future"],["iendront","enir",["v"],["v"],"future"],["errai","érir",["v"],["v"],"future"],["erras","érir",["v"],["v"],"future"],["erra","érir",["v"],["v"],"future"],["errons","érir",["v"],["v"],"future"],["errez","érir",["v"],["v"],"future"],["erront","érir",["v"],["v"],"future"],["tirai","tir",["v"],["v"],"future"],["tiras","tir",["v"],["v"],"future"],["tira","tir",["v"],["v"],"future"],["tirons","tir",["v"],["v"],"future"],["tirez","tir",["v"],["v"],"future"],["tiront","tir",["v"],["v"],"future"],["êtirai","êtir",["v"],["v"],"future"],["êtiras","êtir",["v"],["v"],"future"],["êtira","êtir",["v"],["v"],"future"],["êtirons","êtir",["v"],["v"],"future"],["êtirez","êtir",["v"],["v"],"future"],["êtiront","êtir",["v"],["v"],"future"],["vrirai","vrir",["v"],["v"],"future"],["vriras","vrir",["v"],["v"],"future"],["vrira","vrir",["v"],["v"],"future"],["vrirons","vrir",["v"],["v"],"future"],["vrirez","vrir",["v"],["v"],"future"],["vriront","vrir",["v"],["v"],"future"],["frirai","frir",["v"],["v"],"future"],["frira","frir",["v"],["v"],"future"],["frira","frir",["v"],["v"],"future"],["frirons","frir",["v"],["v"],"future"],["frirez","frir",["v"],["v"],"future"],["friront","frir",["v"],["v"],"future"],["ueillerai","ueillir",["v"],["v"],"future"],["ueilleras","ueillir",["v"],["v"],"future"],["ueillera","ueillir",["v"],["v"],"future"],["ueillerons","ueillir",["v"],["v"],"future"],["ueillerez","ueillir",["v"],["v"],"future"],["ueilleront","ueillir",["v"],["v"],"future"],["aillirai","aillir",["v"],["v"],"future"],["ailliras","aillir",["v"],["v"],"future"],["aillira","aillir",["v"],["v"],"future"],["aillirons","aillir",["v"],["v"],"future"],["aillirez","aillir",["v"],["v"],"future"],["ailliront","aillir",["v"],["v"],"future"],["bouillirai","bouillir",["v"],["v"],"future"],["bouilliras","bouillir",["v"],["v"],"future"],["bouillira","bouillir",["v"],["v"],"future"],["bouillirons","bouillir",["v"],["v"],"future"],["bouillirez","bouillir",["v"],["v"],"future"],["bouilliront","bouillir",["v"],["v"],"future"],["dormirai","dormir",["v"],["v"],"future"],["dormiras","dormir",["v"],["v"],"future"],["dormira","dormir",["v"],["v"],"future"],["dormirons","dormir",["v"],["v"],"future"],["dormirez","dormir",["v"],["v"],"future"],["dormiront","dormir",["v"],["v"],"future"],["courrai","dormir",["v"],["v"],"future"],["courras","dormir",["v"],["v"],"future"],["courra","dormir",["v"],["v"],"future"],["courrons","dormir",["v"],["v"],"future"],["courrez","dormir",["v"],["v"],"future"],["courront","dormir",["v"],["v"],"future"],["mourrai","mourir",["v"],["v"],"future"],["mourras","mourir",["v"],["v"],"future"],["mourra","mourir",["v"],["v"],"future"],["mourrons","mourir",["v"],["v"],"future"],["mourrez","mourir",["v"],["v"],"future"],["mourront","mourir",["v"],["v"],"future"],["orrai","ouïr",["v"],["v"],"future"],["oirai","ouïr",["v"],["v"],"future"],["orras","ouïr",["v"],["v"],"future"],["orra","ouïr",["v"],["v"],"future"],["orrons","ouïr",["v"],["v"],"future"],["orrez","ouïr",["v"],["v"],"future"],["orront","ouïr",["v"],["v"],"future"],["cevrai","cevoir",["v"],["v"],"future"],["cevras","cevoir",["v"],["v"],"future"],["cevra","cevoir",["v"],["v"],"future"],["cevrons","cevoir",["v"],["v"],"future"],["cevrez","cevoir",["v"],["v"],"future"],["cevront","cevoir",["v"],["v"],"future"],["verrai","voir",["v"],["v"],"future"],["verras","voir",["v"],["v"],"future"],["verra","voir",["v"],["v"],"future"],["verrons","voir",["v"],["v"],"future"],["verrez","voir",["v"],["v"],"future"],["verront","voir",["v"],["v"],"future"],["pourvoirai","pourvoir",["v"],["v"],"future"],["pourvoiras","pourvoir",["v"],["v"],"future"],["pourvoira","pourvoir",["v"],["v"],"future"],["pourvoirons","pourvoir",["v"],["v"],"future"],["pourvoirez","pourvoir",["v"],["v"],"future"],["pourvoiront","pourvoir",["v"],["v"],"future"],["saurai","savoir",["v"],["v"],"future"],["sauras","savoir",["v"],["v"],"future"],["saura","savoir",["v"],["v"],"future"],["saurons","savoir",["v"],["v"],"future"],["saurez","savoir",["v"],["v"],"future"],["sauront","savoir",["v"],["v"],"future"],["devrai","devoir",["v"],["v"],"future"],["devras","devoir",["v"],["v"],"future"],["devra","devoir",["v"],["v"],"future"],["devrons","devoir",["v"],["v"],"future"],["devrez","devoir",["v"],["v"],"future"],["devront","devoir",["v"],["v"],"future"],["pourrai","pouvoir",["v"],["v"],"future"],["pourras","pouvoir",["v"],["v"],"future"],["pourra","pouvoir",["v"],["v"],"future"],["pourrons","pouvoir",["v"],["v"],"future"],["pourrez","pouvoir",["v"],["v"],"future"],["pourront","pouvoir",["v"],["v"],"future"],["mouvrai","mouvoir",["v"],["v"],"future"],["mouvras","mouvoir",["v"],["v"],"future"],["mouvra","mouvoir",["v"],["v"],"future"],["mouvrons","mouvoir",["v"],["v"],"future"],["mouvrez","mouvoir",["v"],["v"],"future"],["mouvront","mouvoir",["v"],["v"],"future"],["pleuvra","pleuvoir",["v"],["v"],"future"],["pleuvront","pleuvoir",["v"],["v"],"future"],["faudra","falloir",["v"],["v"],"future"],["vaudrai","valoir",["v"],["v"],"future"],["vaudras","valoir",["v"],["v"],"future"],["vaudra","valoir",["v"],["v"],"future"],["vaudrons","valoir",["v"],["v"],"future"],["vaudrez","valoir",["v"],["v"],"future"],["vaudront","valoir",["v"],["v"],"future"],["voudrai","vouloir",["v"],["v"],"future"],["voudras","vouloir",["v"],["v"],"future"],["voudra","vouloir",["v"],["v"],"future"],["voudrons","vouloir",["v"],["v"],"future"],["voudrez","vouloir",["v"],["v"],"future"],["voudront","vouloir",["v"],["v"],"future"],["soirai","seoir",["v"],["v"],"future"],["soiras","seoir",["v"],["v"],"future"],["soira","seoir",["v"],["v"],"future"],["soirons","seoir",["v"],["v"],"future"],["soirez","seoir",["v"],["v"],"future"],["soiront","seoir",["v"],["v"],"future"],["assiérai","asseoir",["v"],["v"],"future"],["assiéras","asseoir",["v"],["v"],"future"],["assiéra","asseoir",["v"],["v"],"future"],["assiérons","asseoir",["v"],["v"],"future"],["assiérez","asseoir",["v"],["v"],"future"],["assiéront","asseoir",["v"],["v"],"future"],["siéra","seoir",["v"],["v"],"future"],["siéront","seoir",["v"],["v"],"future"],["choirai","choir",["v"],["v"],"future"],["choiras","choir",["v"],["v"],"future"],["choira","choir",["v"],["v"],"future"],["choirons","choir",["v"],["v"],"future"],["choirez","choir",["v"],["v"],"future"],["choiront","choir",["v"],["v"],"future"],["cherrai","choir",["v"],["v"],"future"],["cherras","choir",["v"],["v"],"future"],["cherra","choir",["v"],["v"],"future"],["cherrosn","choir",["v"],["v"],"future"],["cherrez","choir",["v"],["v"],"future"],["cherront","choir",["v"],["v"],"future"],["andrai","andre",["v"],["v"],"future"],["andras","andre",["v"],["v"],"future"],["andra","andre",["v"],["v"],"future"],["androns","andre",["v"],["v"],"future"],["andrez","andre",["v"],["v"],"future"],["andront","andre",["v"],["v"],"future"],["endrai","endre",["v"],["v"],"future"],["endras","endre",["v"],["v"],"future"],["endra","endre",["v"],["v"],"future"],["endrons","endre",["v"],["v"],"future"],["endrez","endre",["v"],["v"],"future"],["endront","endre",["v"],["v"],"future"],["ondrai","ondre",["v"],["v"],"future"],["ondras","ondre",["v"],["v"],"future"],["ondra","ondre",["v"],["v"],"future"],["ondrons","ondre",["v"],["v"],"future"],["ondrez","ondre",["v"],["v"],"future"],["ondront","ondre",["v"],["v"],"future"],["erdrai","erdre",["v"],["v"],"future"],["erdras","erdre",["v"],["v"],"future"],["erdra","erdre",["v"],["v"],"future"],["erdrons","erdre",["v"],["v"],"future"],["erdrez","erdre",["v"],["v"],"future"],["erdront","erdre",["v"],["v"],"future"],["ordrai","ordre",["v"],["v"],"future"],["ordras","ordre",["v"],["v"],"future"],["ordra","ordre",["v"],["v"],"future"],["ordrons","ordre",["v"],["v"],"future"],["ordrez","ordre",["v"],["v"],"future"],["ordront","ordre",["v"],["v"],"future"],["battrai","battre",["v"],["v"],"future"],["battras","battre",["v"],["v"],"future"],["battra","battre",["v"],["v"],"future"],["battrons","battre",["v"],["v"],"future"],["battrez","battre",["v"],["v"],"future"],["battront","battre",["v"],["v"],"future"],["mettrai","mettre",["v"],["v"],"future"],["mettras","mettre",["v"],["v"],"future"],["mettra","mettre",["v"],["v"],"future"],["mettrons","mettre",["v"],["v"],"future"],["mettrez","mettre",["v"],["v"],"future"],["mettront","mettre",["v"],["v"],"future"],["eindrai","eindre",["v"],["v"],"future"],["eindras","eindre",["v"],["v"],"future"],["eindra","eindre",["v"],["v"],"future"],["eindrons","eindre",["v"],["v"],"future"],["eindrez","eindre",["v"],["v"],"future"],["eindront","eindre",["v"],["v"],"future"],["oindrai","oindre",["v"],["v"],"future"],["oindras","oindre",["v"],["v"],"future"],["oindra","oindre",["v"],["v"],"future"],["oindrons","oindre",["v"],["v"],"future"],["oindrez","oindre",["v"],["v"],"future"],["oindront","oindre",["v"],["v"],"future"],["aindrai","aindre",["v"],["v"],"future"],["aindras","aindre",["v"],["v"],"future"],["aindra","aindre",["v"],["v"],"future"],["aindrons","aindre",["v"],["v"],"future"],["aindrez","aindre",["v"],["v"],"future"],["aindront","aindre",["v"],["v"],"future"],["vaincrai","vaincre",["v"],["v"],"future"],["vaincras","vaincre",["v"],["v"],"future"],["vaincra","vaincre",["v"],["v"],"future"],["vaincrons","vaincre",["v"],["v"],"future"],["vaincrez","vaincre",["v"],["v"],"future"],["vaincront","vaincre",["v"],["v"],"future"],["rairai","raire",["v"],["v"],"future"],["rairas","raire",["v"],["v"],"future"],["raira","raire",["v"],["v"],"future"],["rairons","raire",["v"],["v"],"future"],["rairez","raire",["v"],["v"],"future"],["rairont","raire",["v"],["v"],"future"],["ferai","faire",["v"],["v"],"future"],["feras","faire",["v"],["v"],"future"],["fera","faire",["v"],["v"],"future"],["ferons","faire",["v"],["v"],"future"],["ferez","faire",["v"],["v"],"future"],["feront","faire",["v"],["v"],"future"],["plairai","plaire",["v"],["v"],"future"],["plairas","plaire",["v"],["v"],"future"],["plaira","plaire",["v"],["v"],"future"],["plairons","plaire",["v"],["v"],"future"],["plairez","plaire",["v"],["v"],"future"],["plairont","plaire",["v"],["v"],"future"],["aîtrai","aître",["v"],["v"],"future"],["aîtras","aître",["v"],["v"],"future"],["aîtra","aître",["v"],["v"],"future"],["aîtrons","aître",["v"],["v"],"future"],["aîtrez","aître",["v"],["v"],"future"],["aîtront","aître",["v"],["v"],"future"],["oîtrai","oître",["v"],["v"],"future"],["oîtras","oître",["v"],["v"],"future"],["oîtra","oître",["v"],["v"],"future"],["oîtrons","oître",["v"],["v"],"future"],["oîtrez","oître",["v"],["v"],"future"],["oîtront","oître",["v"],["v"],"future"],["croirai","croire",["v"],["v"],"future"],["croiras","croire",["v"],["v"],"future"],["croira","croire",["v"],["v"],"future"],["croirons","croire",["v"],["v"],"future"],["croirez","croire",["v"],["v"],"future"],["croiront","croire",["v"],["v"],"future"],["boirai","boire",["v"],["v"],"future"],["boiras","boire",["v"],["v"],"future"],["boira","boire",["v"],["v"],"future"],["boirons","boire",["v"],["v"],"future"],["boirez","boire",["v"],["v"],"future"],["boiront","boire",["v"],["v"],"future"],["clorai","clore",["v"],["v"],"future"],["cloras","clore",["v"],["v"],"future"],["clora","clore",["v"],["v"],"future"],["clorons","clore",["v"],["v"],"future"],["clorez","clore",["v"],["v"],"future"],["cloront","clore",["v"],["v"],"future"],["clurai","clure",["v"],["v"],"future"],["cluras","clure",["v"],["v"],"future"],["clura","clure",["v"],["v"],"future"],["clurons","clure",["v"],["v"],"future"],["clurez","clure",["v"],["v"],"future"],["cluront","clure",["v"],["v"],"future"],["soudrai","soudre",["v"],["v"],"future"],["soudras","soudre",["v"],["v"],"future"],["soudra","soudre",["v"],["v"],"future"],["soudrons","soudre",["v"],["v"],"future"],["soudrez","soudre",["v"],["v"],"future"],["soudront","soudre",["v"],["v"],"future"],["coudrai","coudre",["v"],["v"],"future"],["coudras","coudre",["v"],["v"],"future"],["coudra","coudre",["v"],["v"],"future"],["coudrons","coudre",["v"],["v"],"future"],["coudrez","coudre",["v"],["v"],"future"],["coudront","coudre",["v"],["v"],"future"],["moudrai","moudre",["v"],["v"],"future"],["moudras","moudre",["v"],["v"],"future"],["moudra","moudre",["v"],["v"],"future"],["moudrons","moudre",["v"],["v"],"future"],["moudrez","moudre",["v"],["v"],"future"],["moudront","moudre",["v"],["v"],"future"],["ivrai","vivre",["v"],["v"],"future"],["ivras","vivre",["v"],["v"],"future"],["ivra","vivre",["v"],["v"],"future"],["ivrons","vivre",["v"],["v"],"future"],["ivrez","vivre",["v"],["v"],"future"],["ivront","vivre",["v"],["v"],"future"],["lirai","lire",["v"],["v"],"future"],["liras","lire",["v"],["v"],"future"],["lira","lire",["v"],["v"],"future"],["lirons","lire",["v"],["v"],"future"],["lirez","lire",["v"],["v"],"future"],["liront","lire",["v"],["v"],"future"],["dirai","dire",["v"],["v"],"future"],["diras","dire",["v"],["v"],"future"],["dira","dire",["v"],["v"],"future"],["dirons","dire",["v"],["v"],"future"],["direz","dire",["v"],["v"],"future"],["diront","dire",["v"],["v"],"future"],["rirai","rire",["v"],["v"],"future"],["riras","rire",["v"],["v"],"future"],["rira","rire",["v"],["v"],"future"],["rirons","rire",["v"],["v"],"future"],["rirez","rire",["v"],["v"],"future"],["riront","rire",["v"],["v"],"future"],["maudirai","maudire",["v"],["v"],"future"],["maudiras","maudire",["v"],["v"],"future"],["maudira","maudire",["v"],["v"],"future"],["maudirons","maudire",["v"],["v"],"future"],["maudirez","maudire",["v"],["v"],"future"],["maudiront","maudire",["v"],["v"],"future"],["crirai","crire",["v"],["v"],"future"],["criras","crire",["v"],["v"],"future"],["crira","crire",["v"],["v"],"future"],["crirons","crire",["v"],["v"],"future"],["crirez","crire",["v"],["v"],"future"],["criront","crire",["v"],["v"],"future"],["firai","fire",["v"],["v"],"future"],["firas","fire",["v"],["v"],"future"],["fira","fire",["v"],["v"],"future"],["firons","fire",["v"],["v"],"future"],["firez","fire",["v"],["v"],"future"],["firont","fire",["v"],["v"],"future"],["cirai","cire",["v"],["v"],"future"],["ciras","cire",["v"],["v"],"future"],["cira","cire",["v"],["v"],"future"],["cirons","cire",["v"],["v"],"future"],["cirez","cire",["v"],["v"],"future"],["ciront","cire",["v"],["v"],"future"],["frirai","frire",["v"],["v"],"future"],["friras","frire",["v"],["v"],"future"],["frira","frire",["v"],["v"],"future"],["frirons","frire",["v"],["v"],"future"],["frirez","frire",["v"],["v"],"future"],["friront","frire",["v"],["v"],"future"],["uirai","uire",["v"],["v"],"future"],["uiras","uire",["v"],["v"],"future"],["uira","uire",["v"],["v"],"future"],["uirons","uire",["v"],["v"],"future"],["uirez","uire",["v"],["v"],"future"],["uiront","uire",["v"],["v"],"future"],["sois","être",["aux"],["v"],"imperative present"],["soyons","être",["aux"],["v"],"imperative present"],["soyez","être",["aux"],["v"],"imperative present"],["aie","avoir",["aux"],["v"],"imperative present"],["ayons","avoir",["aux"],["v"],"imperative present"],["ayez","avoir",["aux"],["v"],"imperative present"],["e","er",["v"],["v"],"imperative present"],["ons","er",["v"],["v"],"imperative present"],["ez","er",["v"],["v"],"imperative present"],["ce","er",["v"],["v"],"imperative present"],["çons","er",["v"],["v"],"imperative present"],["cez","er",["v"],["v"],"imperative present"],["ge","ger",["v"],["v"],"imperative present"],["geons","ger",["v"],["v"],"imperative present"],["gez","ger",["v"],["v"],"imperative present"],["èce","ecer",["v"],["v"],"imperative present"],["eçons","ecer",["v"],["v"],"imperative present"],["ecez","ecer",["v"],["v"],"imperative present"],["ève","ever",["v"],["v"],"imperative present"],["evons","ever",["v"],["v"],"imperative present"],["evez","ever",["v"],["v"],"imperative present"],["ène","ener",["v"],["v"],"imperative present"],["enons","ener",["v"],["v"],"imperative present"],["enez","ener",["v"],["v"],"imperative present"],["èpe","eper",["v"],["v"],"imperative present"],["epons","eper",["v"],["v"],"imperative present"],["epez","eper",["v"],["v"],"imperative present"],["ère","erer",["v"],["v"],"imperative present"],["erons","erer",["v"],["v"],"imperative present"],["erez","erer",["v"],["v"],"imperative present"],["ème","emer",["v"],["v"],"imperative present"],["emons","emer",["v"],["v"],"imperative present"],["emez","emer",["v"],["v"],"imperative present"],["èvre","evrer",["v"],["v"],"imperative present"],["evrons","evrer",["v"],["v"],"imperative present"],["evrez","evrer",["v"],["v"],"imperative present"],["èse","eser",["v"],["v"],"imperative present"],["èsons","eser",["v"],["v"],"imperative present"],["esez","eser",["v"],["v"],"imperative present"],["ède","éder",["v"],["v"],"imperative present"],["édons","éder",["v"],["v"],"imperative present"],["édez","éder",["v"],["v"],"imperative present"],["èbre","ébrer",["v"],["v"],"imperative present"],["ébrons","ébrer",["v"],["v"],"imperative present"],["ébrez","ébrer",["v"],["v"],"imperative present"],["èce","écer",["v"],["v"],"imperative present"],["éçons","écer",["v"],["v"],"imperative present"],["écez","écer",["v"],["v"],"imperative present"],["èche","écher",["v"],["v"],"imperative present"],["échons","écher",["v"],["v"],"imperative present"],["échez","écher",["v"],["v"],"imperative present"],["ècre","écrer",["v"],["v"],"imperative present"],["écrons","écrer",["v"],["v"],"imperative present"],["écrez","écrer",["v"],["v"],"imperative present"],["ègle","égler",["v"],["v"],"imperative present"],["églons","égler",["v"],["v"],"imperative present"],["églez","égler",["v"],["v"],"imperative present"],["ègne","égner",["v"],["v"],"imperative present"],["égnons","égner",["v"],["v"],"imperative present"],["égnez","égner",["v"],["v"],"imperative present"],["ègre","égrer",["v"],["v"],"imperative present"],["égrons","égrer",["v"],["v"],"imperative present"],["égrez","égrer",["v"],["v"],"imperative present"],["ègue","éguer",["v"],["v"],"imperative present"],["éguons","éguer",["v"],["v"],"imperative present"],["éguez","éguer",["v"],["v"],"imperative present"],["èle","éler",["v"],["v"],"imperative present"],["élons","éler",["v"],["v"],"imperative present"],["élez","éler",["v"],["v"],"imperative present"],["ème","émer",["v"],["v"],"imperative present"],["émons","émer",["v"],["v"],"imperative present"],["émez","émer",["v"],["v"],"imperative present"],["ène","éner",["v"],["v"],"imperative present"],["énons","éner",["v"],["v"],"imperative present"],["énez","éner",["v"],["v"],"imperative present"],["èpe","éper",["v"],["v"],"imperative present"],["épons","éper",["v"],["v"],"imperative present"],["épez","éper",["v"],["v"],"imperative present"],["èque","équer",["v"],["v"],"imperative present"],["équons","équer",["v"],["v"],"imperative present"],["équez","équer",["v"],["v"],"imperative present"],["ère","érer",["v"],["v"],"imperative present"],["érons","érer",["v"],["v"],"imperative present"],["érez","érer",["v"],["v"],"imperative present"],["èse","éser",["v"],["v"],"imperative present"],["ésons","éser",["v"],["v"],"imperative present"],["ésez","éser",["v"],["v"],"imperative present"],["ète","éter",["v"],["v"],"imperative present"],["étons","éter",["v"],["v"],"imperative present"],["étez","éter",["v"],["v"],"imperative present"],["ètre","étrer",["v"],["v"],"imperative present"],["étrons","étrer",["v"],["v"],"imperative present"],["étrez","étrer",["v"],["v"],"imperative present"],["èye","éyer",["v"],["v"],"imperative present"],["éyons","éyer",["v"],["v"],"imperative present"],["éyez","éyer",["v"],["v"],"imperative present"],["elle","eler",["v"],["v"],"imperative present"],["ellons","eler",["v"],["v"],"imperative present"],["ellez","eler",["v"],["v"],"imperative present"],["ette","eter",["v"],["v"],"imperative present"],["ettons","eter",["v"],["v"],"imperative present"],["ettez","eter",["v"],["v"],"imperative present"],["èle","eler",["v"],["v"],"imperative present"],["élons","eler",["v"],["v"],"imperative present"],["élez","eler",["v"],["v"],"imperative present"],["ète","eter",["v"],["v"],"imperative present"],["étons","eter",["v"],["v"],"imperative present"],["étez","eter",["v"],["v"],"imperative present"],["ège","éger",["v"],["v"],"imperative present"],["égeons","éger",["v"],["v"],"imperative present"],["égez","éger",["v"],["v"],"imperative present"],["aie","ayer",["v"],["v"],"imperative present"],["ayons","ayer",["v"],["v"],"imperative present"],["ayez","ayer",["v"],["v"],"imperative present"],["oie","oyer",["v"],["v"],"imperative present"],["oyons","oyer",["v"],["v"],"imperative present"],["oyez","oyer",["v"],["v"],"imperative present"],["uie","uyer",["v"],["v"],"imperative present"],["uyons","uyer",["v"],["v"],"imperative present"],["uyez","uyer",["v"],["v"],"imperative present"],["is","ir",["v"],["v"],"imperative present"],["issons","ir",["v"],["v"],"imperative present"],["issez","ir",["v"],["v"],"imperative present"],["ïs","ïr",["v"],["v"],"imperative present"],["ïssons","ïr",["v"],["v"],"imperative present"],["ïssez","ïr",["v"],["v"],"imperative present"],["hais","haïr",["v"],["v"],"imperative present"],["haïssons","haïr",["v"],["v"],"imperative present"],["haïssez","haïr",["v"],["v"],"imperative present"],["va","aller",["v"],["v"],"imperative present"],["allons","aller",["v"],["v"],"imperative present"],["allez","aller",["v"],["v"],"imperative present"],["iens","enir",["v"],["v"],"imperative present"],["enons","enir",["v"],["v"],"imperative present"],["enez","enir",["v"],["v"],"imperative present"],["iers","érir",["v"],["v"],"imperative present"],["érons","érir",["v"],["v"],"imperative present"],["érez","érir",["v"],["v"],"imperative present"],["s","tir",["v"],["v"],"imperative present"],["tons","tir",["v"],["v"],"imperative present"],["tez","tir",["v"],["v"],"imperative present"],["êts","êtir",["v"],["v"],"imperative present"],["êtons","êtir",["v"],["v"],"imperative present"],["êtez","êtir",["v"],["v"],"imperative present"],["vre","vrir",["v"],["v"],"imperative present"],["vrons","vrir",["v"],["v"],"imperative present"],["vrez","vrir",["v"],["v"],"imperative present"],["fre","frir",["v"],["v"],"imperative present"],["frons","frir",["v"],["v"],"imperative present"],["frez","frir",["v"],["v"],"imperative present"],["ueille","ueillir",["v"],["v"],"imperative present"],["ueillons","ueillir",["v"],["v"],"imperative present"],["ueillez","ueillir",["v"],["v"],"imperative present"],["aille","aillir",["v"],["v"],"imperative present"],["aillons","aillir",["v"],["v"],"imperative present"],["aillez","aillir",["v"],["v"],"imperative present"],["bous","bouillir",["v"],["v"],"imperative present"],["bouillons","bouillir",["v"],["v"],"imperative present"],["bouillez","bouillir",["v"],["v"],"imperative present"],["dors","dormir",["v"],["v"],"imperative present"],["dormons","dormir",["v"],["v"],"imperative present"],["dormez","dormir",["v"],["v"],"imperative present"],["cours","dormir",["v"],["v"],"imperative present"],["courons","dormir",["v"],["v"],"imperative present"],["courez","dormir",["v"],["v"],"imperative present"],["meurs","mourir",["v"],["v"],"imperative present"],["mourons","mourir",["v"],["v"],"imperative present"],["mourez","mourir",["v"],["v"],"imperative present"],["sers","servir",["v"],["v"],"imperative present"],["servons","servir",["v"],["v"],"imperative present"],["servez","servir",["v"],["v"],"imperative present"],["fuis","fuir",["v"],["v"],"imperative present"],["fuyons","fuir",["v"],["v"],"imperative present"],["fuyez","fuir",["v"],["v"],"imperative present"],["ois","ouïr",["v"],["v"],"imperative present"],["oyons","ouïr",["v"],["v"],"imperative present"],["oyez","ouïr",["v"],["v"],"imperative present"],["çois","cevoir",["v"],["v"],"imperative present"],["cevons","cevoir",["v"],["v"],"imperative present"],["cevez","cevoir",["v"],["v"],"imperative present"],["vois","voir",["v"],["v"],"imperative present"],["voyons","voir",["v"],["v"],"imperative present"],["voyez","voir",["v"],["v"],"imperative present"],["sais","savoir",["v"],["v"],"imperative present"],["savons","savoir",["v"],["v"],"imperative present"],["savez","savoir",["v"],["v"],"imperative present"],["dois","devoir",["v"],["v"],"imperative present"],["devons","devoir",["v"],["v"],"imperative present"],["devez","devoir",["v"],["v"],"imperative present"],["meus","mouvoir",["v"],["v"],"imperative present"],["mouvons","mouvoir",["v"],["v"],"imperative present"],["mouvez","mouvoir",["v"],["v"],"imperative present"],["vaux","valoir",["v"],["v"],"imperative present"],["valons","valoir",["v"],["v"],"imperative present"],["valez","valoir",["v"],["v"],"imperative present"],["veux","vouloir",["v"],["v"],"imperative present"],["veuille","vouloir",["v"],["v"],"imperative present"],["voulons","vouloir",["v"],["v"],"imperative present"],["voulez","vouloir",["v"],["v"],"imperative present"],["veuillez","vouloir",["v"],["v"],"imperative present"],["sois","seoir",["v"],["v"],"imperative present"],["soyons","seoir",["v"],["v"],"imperative present"],["soyez","seoir",["v"],["v"],"imperative present"],["assieds","asseoir",["v"],["v"],"imperative present"],["asseyons","asseoir",["v"],["v"],"imperative present"],["asseyez","asseoir",["v"],["v"],"imperative present"],["ands","andre",["v"],["v"],"imperative present"],["andons","andre",["v"],["v"],"imperative present"],["andez","andre",["v"],["v"],"imperative present"],["ends","endre",["v"],["v"],"imperative present"],["endons","endre",["v"],["v"],"imperative present"],["endez","endre",["v"],["v"],"imperative present"],["onds","ondre",["v"],["v"],"imperative present"],["ondons","ondre",["v"],["v"],"imperative present"],["ondez","ondre",["v"],["v"],"imperative present"],["erds","erdre",["v"],["v"],"imperative present"],["erdons","erdre",["v"],["v"],"imperative present"],["erdez","erdre",["v"],["v"],"imperative present"],["ords","ordre",["v"],["v"],"imperative present"],["ordons","ordre",["v"],["v"],"imperative present"],["ordez","ordre",["v"],["v"],"imperative present"],["prends","prendre",["v"],["v"],"imperative present"],["prenons","prendre",["v"],["v"],"imperative present"],["prenez","prendre",["v"],["v"],"imperative present"],["bats","battre",["v"],["v"],"imperative present"],["battons","battre",["v"],["v"],"imperative present"],["battez","battre",["v"],["v"],"imperative present"],["mets","mettre",["v"],["v"],"imperative present"],["mettons","mettre",["v"],["v"],"imperative present"],["mettez","mettre",["v"],["v"],"imperative present"],["eins","eindre",["v"],["v"],"imperative present"],["eignons","eindre",["v"],["v"],"imperative present"],["eignez","eindre",["v"],["v"],"imperative present"],["oins","oindre",["v"],["v"],"imperative present"],["oignons","oindre",["v"],["v"],"imperative present"],["oignez","oindre",["v"],["v"],"imperative present"],["ains","aindre",["v"],["v"],"imperative present"],["aignons","aindre",["v"],["v"],"imperative present"],["aignez","aindre",["v"],["v"],"imperative present"],["vaincs","vaincre",["v"],["v"],"imperative present"],["vainquons","vaincre",["v"],["v"],"imperative present"],["vainquez","vaincre",["v"],["v"],"imperative present"],["rais","raire",["v"],["v"],"imperative present"],["rayons","raire",["v"],["v"],"imperative present"],["rayez","raire",["v"],["v"],"imperative present"],["fais","faire",["v"],["v"],"imperative present"],["faisons","faire",["v"],["v"],"imperative present"],["faites","faire",["v"],["v"],"imperative present"],["plais","faire",["v"],["v"],"imperative present"],["plaisons","faire",["v"],["v"],"imperative present"],["plaisez","faire",["v"],["v"],"imperative present"],["ais","aître",["v"],["v"],"imperative present"],["aissons","aître",["v"],["v"],"imperative present"],["aissez","aître",["v"],["v"],"imperative present"],["ois","oître",["v"],["v"],"imperative present"],["oissons","oître",["v"],["v"],"imperative present"],["oissez","oître",["v"],["v"],"imperative present"],["crois","croire",["v"],["v"],"imperative present"],["croyons","croire",["v"],["v"],"imperative present"],["croyez","croire",["v"],["v"],"imperative present"],["bois","boire",["v"],["v"],"imperative present"],["buvons","boire",["v"],["v"],"imperative present"],["buvez","boire",["v"],["v"],"imperative present"],["clos","clore",["v"],["v"],"imperative present"],["clus","clure",["v"],["v"],"imperative present"],["cluons","clure",["v"],["v"],"imperative present"],["cluez","clure",["v"],["v"],"imperative present"],["sous","soudre",["v"],["v"],"imperative present"],["solvons","soudre",["v"],["v"],"imperative present"],["solvez","soudre",["v"],["v"],"imperative present"],["couds","coudre",["v"],["v"],"imperative present"],["cousons","coudre",["v"],["v"],"imperative present"],["cousez","coudre",["v"],["v"],"imperative present"],["mouds","moudre",["v"],["v"],"imperative present"],["moulons","moudre",["v"],["v"],"imperative present"],["moulez","moudre",["v"],["v"],"imperative present"],["is","vivre",["v"],["v"],"imperative present"],["ivons","vivre",["v"],["v"],"imperative present"],["ivez","vivre",["v"],["v"],"imperative present"],["lis","lire",["v"],["v"],"imperative present"],["lisons","lire",["v"],["v"],"imperative present"],["lisez","lire",["v"],["v"],"imperative present"],["dis","dire",["v"],["v"],"imperative present"],["disons","dire",["v"],["v"],"imperative present"],["disez","dire",["v"],["v"],"imperative present"],["ris","rire",["v"],["v"],"imperative present"],["rions","rire",["v"],["v"],"imperative present"],["riez","rire",["v"],["v"],"imperative present"],["maudis","maudire",["v"],["v"],"imperative present"],["maudissons","maudire",["v"],["v"],"imperative present"],["maudissez","maudire",["v"],["v"],"imperative present"],["cris","crire",["v"],["v"],"imperative present"],["crivons","crire",["v"],["v"],"imperative present"],["crivez","crire",["v"],["v"],"imperative present"],["fis","fire",["v"],["v"],"imperative present"],["fisons","fire",["v"],["v"],"imperative present"],["fisez","fire",["v"],["v"],"imperative present"],["cis","cire",["v"],["v"],"imperative present"],["cisons","cire",["v"],["v"],"imperative present"],["cisez","cire",["v"],["v"],"imperative present"],["fris","frire",["v"],["v"],"imperative present"],["frisons","frire",["v"],["v"],"imperative present"],["frisez","frire",["v"],["v"],"imperative present"],["uis","uire",["v"],["v"],"imperative present"],["uisons","uire",["v"],["v"],"imperative present"],["uisez","uire",["v"],["v"],"imperative present"],["serais","être",["aux"],["v"],"Conditional"],["serais","être",["aux"],["v"],"Conditional"],["serait","être",["aux"],["v"],"Conditional"],["serions","être",["aux"],["v"],"Conditional"],["seriez","être",["aux"],["v"],"Conditional"],["seraient","être",["aux"],["v"],"Conditional"],["aurais","avoir",["aux"],["v"],"Conditional"],["aurais","avoir",["aux"],["v"],"Conditional"],["aurait","avoir",["aux"],["v"],"Conditional"],["aurions","avoir",["aux"],["v"],"Conditional"],["auriez","avoir",["aux"],["v"],"Conditional"],["auraient","avoir",["aux"],["v"],"Conditional"],["erais","er",["v"],["v"],"Conditional"],["erait","er",["v"],["v"],"Conditional"],["erions","er",["v"],["v"],"Conditional"],["eriez","er",["v"],["v"],"Conditional"],["eraient","er",["v"],["v"],"Conditional"],["cerais","cer",["v"],["v"],"Conditional"],["cerait","cer",["v"],["v"],"Conditional"],["cerions","cer",["v"],["v"],"Conditional"],["ceriez","cer",["v"],["v"],"Conditional"],["ceraient","cer",["v"],["v"],"Conditional"],["gerais","ger",["v"],["v"],"Conditional"],["gerait","ger",["v"],["v"],"Conditional"],["gerions","ger",["v"],["v"],"Conditional"],["geriez","ger",["v"],["v"],"Conditional"],["géraient","ger",["v"],["v"],"Conditional"],["ècerais","ecer",["v"],["v"],"Conditional"],["ècerait","ecer",["v"],["v"],"Conditional"],["ècerions","ecer",["v"],["v"],"Conditional"],["èceriez","ecer",["v"],["v"],"Conditional"],["èceraient","ecer",["v"],["v"],"Conditional"],["èverais","ever",["v"],["v"],"Conditional"],["èverait","ever",["v"],["v"],"Conditional"],["èverions","ever",["v"],["v"],"Conditional"],["èveriez","ever",["v"],["v"],"Conditional"],["èveraient","ever",["v"],["v"],"Conditional"],["ènerais","ener",["v"],["v"],"Conditional"],["ènerait","ener",["v"],["v"],"Conditional"],["ènerions","ener",["v"],["v"],"Conditional"],["èneriez","ener",["v"],["v"],"Conditional"],["èneraient","ener",["v"],["v"],"Conditional"],["èperais","eper",["v"],["v"],"Conditional"],["èperait","eper",["v"],["v"],"Conditional"],["èperions","eper",["v"],["v"],"Conditional"],["èperiez","eper",["v"],["v"],"Conditional"],["èperaient","eper",["v"],["v"],"Conditional"],["èrerais","erer",["v"],["v"],"Conditional"],["èrerait","erer",["v"],["v"],"Conditional"],["èrerions","erer",["v"],["v"],"Conditional"],["èreriez","erer",["v"],["v"],"Conditional"],["èraient","erer",["v"],["v"],"Conditional"],["èmerais","emer",["v"],["v"],"Conditional"],["èmerait","emer",["v"],["v"],"Conditional"],["èmerions","emer",["v"],["v"],"Conditional"],["èmeriez","emer",["v"],["v"],"Conditional"],["èmeraient","emer",["v"],["v"],"Conditional"],["èvrerais","evrer",["v"],["v"],"Conditional"],["èvrerait","evrer",["v"],["v"],"Conditional"],["èvrerions","evrer",["v"],["v"],"Conditional"],["èvreriez","evrer",["v"],["v"],"Conditional"],["èvreraient","evrer",["v"],["v"],"Conditional"],["èserais","eser",["v"],["v"],"Conditional"],["èserait","eser",["v"],["v"],"Conditional"],["èserions","eser",["v"],["v"],"Conditional"],["èseriez","eser",["v"],["v"],"Conditional"],["èseraient","eser",["v"],["v"],"Conditional"],["éderais","éder",["v"],["v"],"Conditional"],["éderait","éder",["v"],["v"],"Conditional"],["éderions","éder",["v"],["v"],"Conditional"],["éderiez","éder",["v"],["v"],"Conditional"],["éderaient","éder",["v"],["v"],"Conditional"],["ébrerais","ébrer",["v"],["v"],"Conditional"],["ébrerait","ébrer",["v"],["v"],"Conditional"],["ébrerions","ébrer",["v"],["v"],"Conditional"],["ébreriez","ébrer",["v"],["v"],"Conditional"],["ébreraient","ébrer",["v"],["v"],"Conditional"],["écerais","écer",["v"],["v"],"Conditional"],["écerait","écer",["v"],["v"],"Conditional"],["écerions","écer",["v"],["v"],"Conditional"],["éceriez","écer",["v"],["v"],"Conditional"],["éceraient","écer",["v"],["v"],"Conditional"],["écherais","écher",["v"],["v"],"Conditional"],["écherait","écher",["v"],["v"],"Conditional"],["écherions","écher",["v"],["v"],"Conditional"],["écheriez","écher",["v"],["v"],"Conditional"],["écheraient","écher",["v"],["v"],"Conditional"],["écrerais","écrer",["v"],["v"],"Conditional"],["écrerait","écrer",["v"],["v"],"Conditional"],["écrerions","écrer",["v"],["v"],"Conditional"],["écreriez","écrer",["v"],["v"],"Conditional"],["écreraient","écrer",["v"],["v"],"Conditional"],["églerais","égler",["v"],["v"],"Conditional"],["églerait","égler",["v"],["v"],"Conditional"],["églerions","égler",["v"],["v"],"Conditional"],["égleriez","égler",["v"],["v"],"Conditional"],["égleraient","égler",["v"],["v"],"Conditional"],["égnerais","égner",["v"],["v"],"Conditional"],["égnerait","égner",["v"],["v"],"Conditional"],["égnerions","égner",["v"],["v"],"Conditional"],["égneriez","égner",["v"],["v"],"Conditional"],["égneraient","égner",["v"],["v"],"Conditional"],["égrerais","égrer",["v"],["v"],"Conditional"],["égrerait","égrer",["v"],["v"],"Conditional"],["égrerions","égrer",["v"],["v"],"Conditional"],["égreriez","égrer",["v"],["v"],"Conditional"],["égréraient","égrer",["v"],["v"],"Conditional"],["éguerais","éguer",["v"],["v"],"Conditional"],["éguerait","éguer",["v"],["v"],"Conditional"],["éguerions","éguer",["v"],["v"],"Conditional"],["égueriez","éguer",["v"],["v"],"Conditional"],["égueraient","éguer",["v"],["v"],"Conditional"],["élerais","éler",["v"],["v"],"Conditional"],["élerait","éler",["v"],["v"],"Conditional"],["élerions","éler",["v"],["v"],"Conditional"],["éleriez","éler",["v"],["v"],"Conditional"],["éleraient","éler",["v"],["v"],"Conditional"],["émerais","émer",["v"],["v"],"Conditional"],["émerait","émer",["v"],["v"],"Conditional"],["émerions","émer",["v"],["v"],"Conditional"],["émeriez","émer",["v"],["v"],"Conditional"],["émeraient","émer",["v"],["v"],"Conditional"],["énerais","éner",["v"],["v"],"Conditional"],["énerait","éner",["v"],["v"],"Conditional"],["énerions","éner",["v"],["v"],"Conditional"],["éneriez","éner",["v"],["v"],"Conditional"],["éneraient","éner",["v"],["v"],"Conditional"],["éperais","éper",["v"],["v"],"Conditional"],["éperait","éper",["v"],["v"],"Conditional"],["éperions","éper",["v"],["v"],"Conditional"],["éperiez","éper",["v"],["v"],"Conditional"],["éperaient","éper",["v"],["v"],"Conditional"],["équerais","équer",["v"],["v"],"Conditional"],["équerait","équer",["v"],["v"],"Conditional"],["équerions","équer",["v"],["v"],"Conditional"],["équeriez","équer",["v"],["v"],"Conditional"],["équeraient","équer",["v"],["v"],"Conditional"],["érerais","érer",["v"],["v"],"Conditional"],["érerait","érer",["v"],["v"],"Conditional"],["érerions","érer",["v"],["v"],"Conditional"],["éreriez","érer",["v"],["v"],"Conditional"],["éraient","érer",["v"],["v"],"Conditional"],["éserais","éser",["v"],["v"],"Conditional"],["éserait","éser",["v"],["v"],"Conditional"],["éserions","éser",["v"],["v"],"Conditional"],["éseriez","éser",["v"],["v"],"Conditional"],["ésaient","éser",["v"],["v"],"Conditional"],["éterais","éter",["v"],["v"],"Conditional"],["éterait","éter",["v"],["v"],"Conditional"],["éterions","éter",["v"],["v"],"Conditional"],["éteriez","éter",["v"],["v"],"Conditional"],["éteraient","éter",["v"],["v"],"Conditional"],["étrerais","étrer",["v"],["v"],"Conditional"],["étrerait","étrer",["v"],["v"],"Conditional"],["étrerions","étrer",["v"],["v"],"Conditional"],["étreriez","étrer",["v"],["v"],"Conditional"],["étraient","étrer",["v"],["v"],"Conditional"],["éyerais","éyer",["v"],["v"],"Conditional"],["éyerait","éyer",["v"],["v"],"Conditional"],["éyerions","éyer",["v"],["v"],"Conditional"],["éyeriez","éyer",["v"],["v"],"Conditional"],["éyeraient","éyer",["v"],["v"],"Conditional"],["ellerais","eler",["v"],["v"],"Conditional"],["ellerait","eler",["v"],["v"],"Conditional"],["ellerions","eler",["v"],["v"],"Conditional"],["elleriez","eler",["v"],["v"],"Conditional"],["elleraient","eler",["v"],["v"],"Conditional"],["etterais","eter",["v"],["v"],"Conditional"],["etterait","eter",["v"],["v"],"Conditional"],["etterions","eter",["v"],["v"],"Conditional"],["etteriez","eter",["v"],["v"],"Conditional"],["etteraient","eter",["v"],["v"],"Conditional"],["èlerais","eler",["v"],["v"],"Conditional"],["èlerait","eler",["v"],["v"],"Conditional"],["èlerions","eler",["v"],["v"],"Conditional"],["èleriez","eler",["v"],["v"],"Conditional"],["èleraient","eler",["v"],["v"],"Conditional"],["èterais","eter",["v"],["v"],"Conditional"],["èterait","eter",["v"],["v"],"Conditional"],["èterions","eter",["v"],["v"],"Conditional"],["èteriez","eter",["v"],["v"],"Conditional"],["èteraient","eter",["v"],["v"],"Conditional"],["égerais","éger",["v"],["v"],"Conditional"],["égerait","éger",["v"],["v"],"Conditional"],["égerions","éger",["v"],["v"],"Conditional"],["égeriez","éger",["v"],["v"],"Conditional"],["égeraient","éger",["v"],["v"],"Conditional"],["ayerais","ayer",["v"],["v"],"Conditional"],["ayerait","ayer",["v"],["v"],"Conditional"],["ayerions","ayer",["v"],["v"],"Conditional"],["ayeriez","ayer",["v"],["v"],"Conditional"],["ayeraient","ayer",["v"],["v"],"Conditional"],["aierais","ayer",["v"],["v"],"Conditional"],["aierait","ayer",["v"],["v"],"Conditional"],["aierions","ayer",["v"],["v"],"Conditional"],["aieriez","ayer",["v"],["v"],"Conditional"],["aieraient","ayer",["v"],["v"],"Conditional"],["oierais","oyer",["v"],["v"],"Conditional"],["oierait","oyer",["v"],["v"],"Conditional"],["oierions","oyer",["v"],["v"],"Conditional"],["oieriez","oyer",["v"],["v"],"Conditional"],["oieraient","oyer",["v"],["v"],"Conditional"],["uyerais","uyer",["v"],["v"],"Conditional"],["uyerait","uyer",["v"],["v"],"Conditional"],["uyerions","uyer",["v"],["v"],"Conditional"],["uyeriez","uyer",["v"],["v"],"Conditional"],["uyeraient","uyer",["v"],["v"],"Conditional"],["irais","ir",["v"],["v"],"Conditional"],["irait","ir",["v"],["v"],"Conditional"],["irions","ir",["v"],["v"],"Conditional"],["iriez","ir",["v"],["v"],"Conditional"],["iraient","ir",["v"],["v"],"Conditional"],["haïrais","haïr",["v"],["v"],"Conditional"],["haïrait","haïr",["v"],["v"],"Conditional"],["haïrions","haïr",["v"],["v"],"Conditional"],["haïriez","haïr",["v"],["v"],"Conditional"],["haïraient","haïr",["v"],["v"],"Conditional"],["irais","aller",["v"],["v"],"Conditional"],["irait","aller",["v"],["v"],"Conditional"],["irions","aller",["v"],["v"],"Conditional"],["iriez","aller",["v"],["v"],"Conditional"],["iraient","aller",["v"],["v"],"Conditional"],["iendrais","enir",["v"],["v"],"Conditional"],["iendrait","enir",["v"],["v"],"Conditional"],["iendrions","enir",["v"],["v"],"Conditional"],["iendriez","enir",["v"],["v"],"Conditional"],["iendraient","enir",["v"],["v"],"Conditional"],["ierais","érir",["v"],["v"],"Conditional"],["ierait","érir",["v"],["v"],"Conditional"],["irions","érir",["v"],["v"],"Conditional"],["iriez","érir",["v"],["v"],"Conditional"],["ièrent","érir",["v"],["v"],"Conditional"],["irais","tir",["v"],["v"],"Conditional"],["irait","tir",["v"],["v"],"Conditional"],["irions","tir",["v"],["v"],"Conditional"],["iriez","tir",["v"],["v"],"Conditional"],["raient","tir",["v"],["v"],"Conditional"],["êtirais","êtir",["v"],["v"],"Conditional"],["êtirait","êtir",["v"],["v"],"Conditional"],["êtirions","êtir",["v"],["v"],"Conditional"],["êtiriez","êtir",["v"],["v"],"Conditional"],["êtiraient","êtir",["v"],["v"],"Conditional"],["vrirais","vrir",["v"],["v"],"Conditional"],["vrirait","vrir",["v"],["v"],"Conditional"],["vririons","vrir",["v"],["v"],"Conditional"],["vririez","vrir",["v"],["v"],"Conditional"],["vriraient","vrir",["v"],["v"],"Conditional"],["frirais","frir",["v"],["v"],"Conditional"],["frirait","frir",["v"],["v"],"Conditional"],["fririons","frir",["v"],["v"],"Conditional"],["fririez","frir",["v"],["v"],"Conditional"],["friraient","frir",["v"],["v"],"Conditional"],["ueillerais","ueillir",["v"],["v"],"Conditional"],["ueillerait","ueillir",["v"],["v"],"Conditional"],["ueillerions","ueillir",["v"],["v"],"Conditional"],["ueilleriez","ueillir",["v"],["v"],"Conditional"],["ueilleraient","ueillir",["v"],["v"],"Conditional"],["aillirais","aillir",["v"],["v"],"Conditional"],["aillirait","aillir",["v"],["v"],"Conditional"],["aillirions","aillir",["v"],["v"],"Conditional"],["ailliriez","aillir",["v"],["v"],"Conditional"],["ailliraient","aillir",["v"],["v"],"Conditional"],["faillirais","faillir",["v"],["v"],"Conditional"],["faillirait","faillir",["v"],["v"],"Conditional"],["faillirions","faillir",["v"],["v"],"Conditional"],["failliriez","faillir",["v"],["v"],"Conditional"],["failliraient","faillir",["v"],["v"],"Conditional"],["bouillirais","bouillir",["v"],["v"],"Conditional"],["bouillirait","bouillir",["v"],["v"],"Conditional"],["bouillirions","bouillir",["v"],["v"],"Conditional"],["bouilliriez","bouillir",["v"],["v"],"Conditional"],["bouilliraient","bouillir",["v"],["v"],"Conditional"],["dormirais","dormir",["v"],["v"],"Conditional"],["dormirait","dormir",["v"],["v"],"Conditional"],["dormirions","dormir",["v"],["v"],"Conditional"],["dormiriez","dormir",["v"],["v"],"Conditional"],["dormiraient","dormir",["v"],["v"],"Conditional"],["courrais","courir",["v"],["v"],"Conditional"],["courrait","courir",["v"],["v"],"Conditional"],["courrions","courir",["v"],["v"],"Conditional"],["courriez","courir",["v"],["v"],"Conditional"],["courraient","courir",["v"],["v"],"Conditional"],["mourrais","mourir",["v"],["v"],"Conditional"],["mourrait","mourir",["v"],["v"],"Conditional"],["mourrions","mourir",["v"],["v"],"Conditional"],["mourriez","mourir",["v"],["v"],"Conditional"],["mourraient","mourir",["v"],["v"],"Conditional"],["servirais","servir",["v"],["v"],"Conditional"],["servirait","servir",["v"],["v"],"Conditional"],["servirions","servir",["v"],["v"],"Conditional"],["serviriez","servir",["v"],["v"],"Conditional"],["serviraient","servir",["v"],["v"],"Conditional"],["fuirais","fuir",["v"],["v"],"Conditional"],["fuirait","fuir",["v"],["v"],"Conditional"],["fuirions","fuir",["v"],["v"],"Conditional"],["fuiriez","fuir",["v"],["v"],"Conditional"],["fuiraient","fuir",["v"],["v"],"Conditional"],["ouïrais","ouïr",["v"],["v"],"Conditional"],["ouïrait","ouïr",["v"],["v"],"Conditional"],["ouïrions","ouïr",["v"],["v"],"Conditional"],["ouïriez","ouïr",["v"],["v"],"Conditional"],["ouïraient","ouïr",["v"],["v"],"Conditional"],["gîrais","gésir",["v"],["v"],"Conditional"],["gîrait","gésir",["v"],["v"],"Conditional"],["gîraient","gésir",["v"],["v"],"Conditional"],["cevrais","cevoir",["v"],["v"],"Conditional"],["cevrait","cevoir",["v"],["v"],"Conditional"],["cevrions","cevoir",["v"],["v"],"Conditional"],["cevriez","cevoir",["v"],["v"],"Conditional"],["cevraient","cevoir",["v"],["v"],"Conditional"],["verrais","voir",["v"],["v"],"Conditional"],["verrait","voir",["v"],["v"],"Conditional"],["verrions","voir",["v"],["v"],"Conditional"],["verriez","voir",["v"],["v"],"Conditional"],["verraient","voir",["v"],["v"],"Conditional"],["saurais","savoir",["v"],["v"],"Conditional"],["saurait","savoir",["v"],["v"],"Conditional"],["saurions","savoir",["v"],["v"],"Conditional"],["sauriez","savoir",["v"],["v"],"Conditional"],["sauraient","savoir",["v"],["v"],"Conditional"],["devrais","devoir",["v"],["v"],"Conditional"],["devrait","devoir",["v"],["v"],"Conditional"],["devrions","devoir",["v"],["v"],"Conditional"],["devriez","devoir",["v"],["v"],"Conditional"],["devraient","devoir",["v"],["v"],"Conditional"],["pourrais","pouvoir",["v"],["v"],"Conditional"],["pourrait","pouvoir",["v"],["v"],"Conditional"],["pourrions","pouvoir",["v"],["v"],"Conditional"],["pourriez","pouvoir",["v"],["v"],"Conditional"],["pourraient","pouvoir",["v"],["v"],"Conditional"],["mouvrais","mouvoir",["v"],["v"],"Conditional"],["mouvrait","mouvoir",["v"],["v"],"Conditional"],["mouvrions","mouvoir",["v"],["v"],"Conditional"],["mouvriez","mouvoir",["v"],["v"],"Conditional"],["mouvraient","mouvoir",["v"],["v"],"Conditional"],["pleuvrait","pleuvoir",["v"],["v"],"Conditional"],["faudrait","falloir",["v"],["v"],"Conditional"],["vaudrais","valoir",["v"],["v"],"Conditional"],["vaudrait","valoir",["v"],["v"],"Conditional"],["vaudrions","valoir",["v"],["v"],"Conditional"],["vaudriez","valoir",["v"],["v"],"Conditional"],["vaudraient","valoir",["v"],["v"],"Conditional"],["voudrais","vouloir",["v"],["v"],"Conditional"],["voudrait","vouloir",["v"],["v"],"Conditional"],["voudrions","vouloir",["v"],["v"],"Conditional"],["voudriez","vouloir",["v"],["v"],"Conditional"],["voudraient","vouloir",["v"],["v"],"Conditional"],["serais","seoir",["v"],["v"],"Conditional"],["serait","seoir",["v"],["v"],"Conditional"],["serions","seoir",["v"],["v"],"Conditional"],["seriez","seoir",["v"],["v"],"Conditional"],["seraient","seoir",["v"],["v"],"Conditional"],["assoirais","asseoir",["v"],["v"],"Conditional"],["assoirait","asseoir",["v"],["v"],"Conditional"],["assoirions","asseoir",["v"],["v"],"Conditional"],["assoiriez","asseoir",["v"],["v"],"Conditional"],["assoiraient","asseoir",["v"],["v"],"Conditional"],["siéraient","seoir",["v"],["v"],"Conditional"],["choirais","choir",["v"],["v"],"Conditional"],["choirait","choir",["v"],["v"],"Conditional"],["choirions","choir",["v"],["v"],"Conditional"],["choiriez","choir",["v"],["v"],"Conditional"],["choiraient","choir",["v"],["v"],"Conditional"],["échoirais","échoir",["v"],["v"],"Conditional"],["échoirait","échoir",["v"],["v"],"Conditional"],["échoirions","échoir",["v"],["v"],"Conditional"],["échoiriez","échoir",["v"],["v"],"Conditional"],["échoiraient","échoir",["v"],["v"],"Conditional"],["andrais","andre",["v"],["v"],"Conditional"],["andrai","andre",["v"],["v"],"Conditional"],["andrions","andre",["v"],["v"],"Conditional"],["andriez","andre",["v"],["v"],"Conditional"],["andraient","andre",["v"],["v"],"Conditional"],["endrais","endre",["v"],["v"],"Conditional"],["endrai","endre",["v"],["v"],"Conditional"],["endrions","endre",["v"],["v"],"Conditional"],["endriez","endre",["v"],["v"],"Conditional"],["endraient","endre",["v"],["v"],"Conditional"],["ondrais","ondre",["v"],["v"],"Conditional"],["ondra","ondre",["v"],["v"],"Conditional"],["ondrions","ondre",["v"],["v"],"Conditional"],["ondriez","ondre",["v"],["v"],"Conditional"],["ondraient","ondre",["v"],["v"],"Conditional"],["erdras","erdre",["v"],["v"],"Conditional"],["erdrait","erdre",["v"],["v"],"Conditional"],["erdrions","erdre",["v"],["v"],"Conditional"],["erdriez","erdre",["v"],["v"],"Conditional"],["erdaient","erdre",["v"],["v"],"Conditional"],["ordrais","ordre",["v"],["v"],"Conditional"],["ordrait","ordre",["v"],["v"],"Conditional"],["ordrions","ordre",["v"],["v"],"Conditional"],["ordriez","ordre",["v"],["v"],"Conditional"],["ordraient","ordre",["v"],["v"],"Conditional"],["prendrais","prendre",["v"],["v"],"Conditional"],["prendrait","prendre",["v"],["v"],"Conditional"],["prendrions","prendre",["v"],["v"],"Conditional"],["prendriez","prendre",["v"],["v"],"Conditional"],["prendraient","prendre",["v"],["v"],"Conditional"],["battrais","battre",["v"],["v"],"Conditional"],["battrait","battre",["v"],["v"],"Conditional"],["battrions","battre",["v"],["v"],"Conditional"],["battriez","battre",["v"],["v"],"Conditional"],["battraient","battre",["v"],["v"],"Conditional"],["mettrais","mettre",["v"],["v"],"Conditional"],["mettrait","mettre",["v"],["v"],"Conditional"],["mettrions","mettre",["v"],["v"],"Conditional"],["mettriez","mettre",["v"],["v"],"Conditional"],["mettraient","mettre",["v"],["v"],"Conditional"],["eindrais","eindre",["v"],["v"],"Conditional"],["eindrait","eindre",["v"],["v"],"Conditional"],["eindrions","eindre",["v"],["v"],"Conditional"],["eindriez","eindre",["v"],["v"],"Conditional"],["eindraient","eindre",["v"],["v"],"Conditional"],["oindrais","oindre",["v"],["v"],"Conditional"],["oindrait","oindre",["v"],["v"],"Conditional"],["oindrions","oindre",["v"],["v"],"Conditional"],["oindriez","oindre",["v"],["v"],"Conditional"],["oindraient","oindre",["v"],["v"],"Conditional"],["aindrais","aindre",["v"],["v"],"Conditional"],["aindrait","aindre",["v"],["v"],"Conditional"],["aindrions","aindre",["v"],["v"],"Conditional"],["aindriez","aindre",["v"],["v"],"Conditional"],["aindraient","aindre",["v"],["v"],"Conditional"],["vaincrais","vaincre",["v"],["v"],"Conditional"],["vaincrait","vaincre",["v"],["v"],"Conditional"],["vaincrions","vaincre",["v"],["v"],"Conditional"],["vaincriez","vaincre",["v"],["v"],"Conditional"],["vaincraient","vaincre",["v"],["v"],"Conditional"],["rairais","raire",["v"],["v"],"Conditional"],["rairait","raire",["v"],["v"],"Conditional"],["rairions","raire",["v"],["v"],"Conditional"],["rairiez","raire",["v"],["v"],"Conditional"],["rairaient","raire",["v"],["v"],"Conditional"],["ferais","faire",["v"],["v"],"Conditional"],["ferait","faire",["v"],["v"],"Conditional"],["ferions","faire",["v"],["v"],"Conditional"],["feriez","faire",["v"],["v"],"Conditional"],["feraient","faire",["v"],["v"],"Conditional"],["plairais","faire",["v"],["v"],"Conditional"],["plairait","faire",["v"],["v"],"Conditional"],["plairions","faire",["v"],["v"],"Conditional"],["plairiez","faire",["v"],["v"],"Conditional"],["plairaient","faire",["v"],["v"],"Conditional"],["naîtrais","naître",["v"],["v"],"Conditional"],["naîtrait","naître",["v"],["v"],"Conditional"],["naîtrions","naître",["v"],["v"],"Conditional"],["naîtriez","naître",["v"],["v"],"Conditional"],["naîtraient","naître",["v"],["v"],"Conditional"],["oîtrais","oître",["v"],["v"],"Conditional"],["oîtrait","oître",["v"],["v"],"Conditional"],["oîtrions","oître",["v"],["v"],"Conditional"],["oîtriez","oître",["v"],["v"],"Conditional"],["oîtraient","oître",["v"],["v"],"Conditional"],["croirais","croire",["v"],["v"],"Conditional"],["croirait","croire",["v"],["v"],"Conditional"],["croirions","croire",["v"],["v"],"Conditional"],["croiriez","croire",["v"],["v"],"Conditional"],["croiraient","croire",["v"],["v"],"Conditional"],["boirais","boire",["v"],["v"],"Conditional"],["boirait","boire",["v"],["v"],"Conditional"],["boirions","boire",["v"],["v"],"Conditional"],["boiriez","boire",["v"],["v"],"Conditional"],["boiraient","boire",["v"],["v"],"Conditional"],["clorais","clore",["v"],["v"],"Conditional"],["clorait","clore",["v"],["v"],"Conditional"],["clorions","clore",["v"],["v"],"Conditional"],["cloriez","clore",["v"],["v"],"Conditional"],["cloraient","clore",["v"],["v"],"Conditional"],["clurais","clure",["v"],["v"],"Conditional"],["clurait","clure",["v"],["v"],"Conditional"],["clurions","clure",["v"],["v"],"Conditional"],["cluriez","clure",["v"],["v"],"Conditional"],["cluraient","clure",["v"],["v"],"Conditional"],["soudrais","soudre",["v"],["v"],"Conditional"],["soudrait","soudre",["v"],["v"],"Conditional"],["soudrions","soudre",["v"],["v"],"Conditional"],["soudriez","soudre",["v"],["v"],"Conditional"],["soudraient","soudre",["v"],["v"],"Conditional"],["coudrais","coudre",["v"],["v"],"Conditional"],["coudrait","coudre",["v"],["v"],"Conditional"],["coudrions","coudre",["v"],["v"],"Conditional"],["coudriez","coudre",["v"],["v"],"Conditional"],["coudraient","coudre",["v"],["v"],"Conditional"],["moudrais","moudre",["v"],["v"],"Conditional"],["moudrait","moudre",["v"],["v"],"Conditional"],["moudrions","moudre",["v"],["v"],"Conditional"],["moudriez","moudre",["v"],["v"],"Conditional"],["moudraient","moudre",["v"],["v"],"Conditional"],["vivrais","vivre",["v"],["v"],"Conditional"],["vivrait","vivre",["v"],["v"],"Conditional"],["vivrions","vivre",["v"],["v"],"Conditional"],["vivriez","vivre",["v"],["v"],"Conditional"],["vivraient","vivre",["v"],["v"],"Conditional"],["lirais","lire",["v"],["v"],"Conditional"],["lirait","lire",["v"],["v"],"Conditional"],["lirions","lire",["v"],["v"],"Conditional"],["liriez","lire",["v"],["v"],"Conditional"],["liraient","lire",["v"],["v"],"Conditional"],["dirais","dire",["v"],["v"],"Conditional"],["dirait","dire",["v"],["v"],"Conditional"],["dirions","dire",["v"],["v"],"Conditional"],["diriez","dire",["v"],["v"],"Conditional"],["diraient","dire",["v"],["v"],"Conditional"],["rirais","rire",["v"],["v"],"Conditional"],["rirait","rire",["v"],["v"],"Conditional"],["ririons","rire",["v"],["v"],"Conditional"],["ririez","rire",["v"],["v"],"Conditional"],["riraient","rire",["v"],["v"],"Conditional"],["maudirais","maudire",["v"],["v"],"Conditional"],["maudirait","maudire",["v"],["v"],"Conditional"],["maudrions","maudire",["v"],["v"],"Conditional"],["maudriez","maudire",["v"],["v"],"Conditional"],["maudiraient","maudire",["v"],["v"],"Conditional"],["crirais","crire",["v"],["v"],"Conditional"],["crirait","crire",["v"],["v"],"Conditional"],["cririons","crire",["v"],["v"],"Conditional"],["cririez","crire",["v"],["v"],"Conditional"],["criraient","crire",["v"],["v"],"Conditional"],["firais","fire",["v"],["v"],"Conditional"],["firait","fire",["v"],["v"],"Conditional"],["firions","fire",["v"],["v"],"Conditional"],["firiez","fire",["v"],["v"],"Conditional"],["firaient","fire",["v"],["v"],"Conditional"],["cirais","cire",["v"],["v"],"Conditional"],["cirait","cire",["v"],["v"],"Conditional"],["cirions","cire",["v"],["v"],"Conditional"],["ciriez","cire",["v"],["v"],"Conditional"],["ciraient","cire",["v"],["v"],"Conditional"],["frirais","frire",["v"],["v"],"Conditional"],["frirait","frire",["v"],["v"],"Conditional"],["fririons","frire",["v"],["v"],"Conditional"],["fririez","frire",["v"],["v"],"Conditional"],["friraient","frire",["v"],["v"],"Conditional"],["cuirais","uire",["v"],["v"],"Conditional"],["cuirait","uire",["v"],["v"],"Conditional"],["cuirions","uire",["v"],["v"],"Conditional"],["cuiriez","uire",["v"],["v"],"Conditional"],["cuiraient","uire",["v"],["v"],"Conditional"],["fus","être",["aux"],["v"],"Preterite"],["fus","être",["aux"],["v"],"Preterite"],["fut","être",["aux"],["v"],"Preterite"],["fûmes","être",["aux"],["v"],"Preterite"],["fûtes","être",["aux"],["v"],"Preterite"],["furent","être",["aux"],["v"],"Preterite"],["eus","avoir",["aux"],["v"],"Preterite"],["eus","avoir",["aux"],["v"],"Preterite"],["eut","avoir",["aux"],["v"],"Preterite"],["eûmes","avoir",["aux"],["v"],"Preterite"],["eûtes","avoir",["aux"],["v"],"Preterite"],["eurent","avoir",["aux"],["v"],"Preterite"],["ai","er",["v"],["v"],"Preterite"],["as","er",["v"],["v"],"Preterite"],["a","er",["v"],["v"],"Preterite"],["âmes","er",["v"],["v"],"Preterite"],["âtes","er",["v"],["v"],"Preterite"],["èrent","er",["v"],["v"],"Preterite"],["çai","cer",["v"],["v"],"Preterite"],["ças","cer",["v"],["v"],"Preterite"],["ça","cer",["v"],["v"],"Preterite"],["çâmes","cer",["v"],["v"],"Preterite"],["çâtes","cer",["v"],["v"],"Preterite"],["çèrent","cer",["v"],["v"],"Preterite"],["geai","ger",["v"],["v"],"Preterite"],["geas","ger",["v"],["v"],"Preterite"],["gea","ger",["v"],["v"],"Preterite"],["geâmes","ger",["v"],["v"],"Preterite"],["geâtes","ger",["v"],["v"],"Preterite"],["gèrent","ger",["v"],["v"],"Preterite"],["èçai","ecer",["v"],["v"],"Preterite"],["èças","ecer",["v"],["v"],"Preterite"],["èça","ecer",["v"],["v"],"Preterite"],["èçâmes","ecer",["v"],["v"],"Preterite"],["èçâtes","ecer",["v"],["v"],"Preterite"],["ècèrent","ecer",["v"],["v"],"Preterite"],["èvai","ever",["v"],["v"],"Preterite"],["èvas","ever",["v"],["v"],"Preterite"],["èva","ever",["v"],["v"],"Preterite"],["èvâmes","ever",["v"],["v"],"Preterite"],["èvâtes","ever",["v"],["v"],"Preterite"],["èvèrent","ever",["v"],["v"],"Preterite"],["ènai","ener",["v"],["v"],"Preterite"],["ènas","ener",["v"],["v"],"Preterite"],["èna","ener",["v"],["v"],"Preterite"],["ènâmes","ener",["v"],["v"],"Preterite"],["ènâtes","ener",["v"],["v"],"Preterite"],["ènèrent","ener",["v"],["v"],"Preterite"],["èpai","eper",["v"],["v"],"Preterite"],["èpas","eper",["v"],["v"],"Preterite"],["èpa","eper",["v"],["v"],"Preterite"],["èpâmes","eper",["v"],["v"],"Preterite"],["èpâtes","eper",["v"],["v"],"Preterite"],["èpèrent","eper",["v"],["v"],"Preterite"],["èrai","erer",["v"],["v"],"Preterite"],["èras","erer",["v"],["v"],"Preterite"],["èra","erer",["v"],["v"],"Preterite"],["èrâmes","erer",["v"],["v"],"Preterite"],["èrâtes","erer",["v"],["v"],"Preterite"],["èrèrent","erer",["v"],["v"],"Preterite"],["èmai","emer",["v"],["v"],"Preterite"],["èmas","emer",["v"],["v"],"Preterite"],["èma","emer",["v"],["v"],"Preterite"],["èmâmes","emer",["v"],["v"],"Preterite"],["èmâtes","emer",["v"],["v"],"Preterite"],["èmèrent","emer",["v"],["v"],"Preterite"],["èvrài","evrer",["v"],["v"],"Preterite"],["èvràs","evrer",["v"],["v"],"Preterite"],["èvrà","evrer",["v"],["v"],"Preterite"],["èvrâmes","evrer",["v"],["v"],"Preterite"],["èvrâtes","evrer",["v"],["v"],"Preterite"],["èvrèrent","evrer",["v"],["v"],"Preterite"],["èsai","eser",["v"],["v"],"Preterite"],["èsas","eser",["v"],["v"],"Preterite"],["èsa","eser",["v"],["v"],"Preterite"],["èsâmes","eser",["v"],["v"],"Preterite"],["èsâtes","eser",["v"],["v"],"Preterite"],["èsèrent","eser",["v"],["v"],"Preterite"],["édai","éder",["v"],["v"],"Preterite"],["édas","éder",["v"],["v"],"Preterite"],["éda","éder",["v"],["v"],"Preterite"],["édâmes","éder",["v"],["v"],"Preterite"],["édâtes","éder",["v"],["v"],"Preterite"],["édèrent","éder",["v"],["v"],"Preterite"],["ébrai","ébrer",["v"],["v"],"Preterite"],["ébras","ébrer",["v"],["v"],"Preterite"],["ébra","ébrer",["v"],["v"],"Preterite"],["ébrâmes","ébrer",["v"],["v"],"Preterite"],["ébrâtes","ébrer",["v"],["v"],"Preterite"],["ébrèrent","ébrer",["v"],["v"],"Preterite"],["échai","écher",["v"],["v"],"Preterite"],["échas","écher",["v"],["v"],"Preterite"],["écha","écher",["v"],["v"],"Preterite"],["échâmes","écher",["v"],["v"],"Preterite"],["échâtes","écher",["v"],["v"],"Preterite"],["échèrent","écher",["v"],["v"],"Preterite"],["aiyai","ayer",["v"],["v"],"Preterite"],["aiyas","ayer",["v"],["v"],"Preterite"],["aiya","ayer",["v"],["v"],"Preterite"],["aiyâmes","ayer",["v"],["v"],"Preterite"],["aiyâtes","ayer",["v"],["v"],"Preterite"],["aiyèrent","ayer",["v"],["v"],"Preterite"],["oiyai","oyer",["v"],["v"],"Preterite"],["oiyas","oyer",["v"],["v"],"Preterite"],["oiya","oyer",["v"],["v"],"Preterite"],["oiyâmes","oyer",["v"],["v"],"Preterite"],["oiyâtes","oyer",["v"],["v"],"Preterite"],["oiyèrent","oyer",["v"],["v"],"Preterite"],["uiyai","uyer",["v"],["v"],"Preterite"],["uiyas","uyer",["v"],["v"],"Preterite"],["uiya","uyer",["v"],["v"],"Preterite"],["uiyâmes","uyer",["v"],["v"],"Preterite"],["uiyâtes","uyer",["v"],["v"],"Preterite"],["uiyèrent","uyer",["v"],["v"],"Preterite"],["is","ir",["v"],["v"],"Preterite"],["it","ir",["v"],["v"],"Preterite"],["îmes","ir",["v"],["v"],"Preterite"],["îtes","ir",["v"],["v"],"Preterite"],["irent","ir",["v"],["v"],"Preterite"],["haïs","haïr",["v"],["v"],"Preterite"],["haït","haïr",["v"],["v"],"Preterite"],["haïmes","haïr",["v"],["v"],"Preterite"],["haïtes","haïr",["v"],["v"],"Preterite"],["haïrent","haïr",["v"],["v"],"Preterite"],["allai","aller",["v"],["v"],"Preterite"],["allas","aller",["v"],["v"],"Preterite"],["alla","aller",["v"],["v"],"Preterite"],["allâmes","aller",["v"],["v"],"Preterite"],["allâtes","aller",["v"],["v"],"Preterite"],["allèrent","aller",["v"],["v"],"Preterite"],["ins","enir",["v"],["v"],"Preterite"],["int","enir",["v"],["v"],"Preterite"],["înmes","enir",["v"],["v"],"Preterite"],["întes","enir",["v"],["v"],"Preterite"],["inrent","enir",["v"],["v"],"Preterite"],["éris","érir",["v"],["v"],"Preterite"],["érit","érir",["v"],["v"],"Preterite"],["érîmes","érir",["v"],["v"],"Preterite"],["érîtes","érir",["v"],["v"],"Preterite"],["érirent","érir",["v"],["v"],"Preterite"],["tis","tir",["v"],["v"],"Preterite"],["tit","tir",["v"],["v"],"Preterite"],["tîmes","tir",["v"],["v"],"Preterite"],["tîtes","tir",["v"],["v"],"Preterite"],["tirent","tir",["v"],["v"],"Preterite"],["êtis","êtir",["v"],["v"],"Preterite"],["êtit","êtir",["v"],["v"],"Preterite"],["êtîmes","êtir",["v"],["v"],"Preterite"],["êtîtes","êtir",["v"],["v"],"Preterite"],["êtirent","êtir",["v"],["v"],"Preterite"],["vris","vrir",["v"],["v"],"Preterite"],["vrit","vrir",["v"],["v"],"Preterite"],["vrîmes","vrir",["v"],["v"],"Preterite"],["vrîtes","vrir",["v"],["v"],"Preterite"],["vrirent","vrir",["v"],["v"],"Preterite"],["fris","frir",["v"],["v"],"Preterite"],["frit","frir",["v"],["v"],"Preterite"],["frîmes","frir",["v"],["v"],"Preterite"],["frîtes","frir",["v"],["v"],"Preterite"],["frirent","frir",["v"],["v"],"Preterite"],["ueillis","ueillir",["v"],["v"],"Preterite"],["ueillit","ueillir",["v"],["v"],"Preterite"],["ueillîmes","ueillir",["v"],["v"],"Preterite"],["ueillîtes","ueillir",["v"],["v"],"Preterite"],["ueillirent","ueillir",["v"],["v"],"Preterite"],["aillis","aillir",["v"],["v"],"Preterite"],["aillit","aillir",["v"],["v"],"Preterite"],["aillîmes","aillir",["v"],["v"],"Preterite"],["aillîtes","aillir",["v"],["v"],"Preterite"],["aillirent","aillir",["v"],["v"],"Preterite"],["bouillis","bouillir",["v"],["v"],"Preterite"],["bouillit","bouillir",["v"],["v"],"Preterite"],["bouillîmes","bouillir",["v"],["v"],"Preterite"],["bouillîtes","bouillir",["v"],["v"],"Preterite"],["bouillirent","bouillir",["v"],["v"],"Preterite"],["dormis","dormir",["v"],["v"],"Preterite"],["dormit","dormir",["v"],["v"],"Preterite"],["dormîmes","dormir",["v"],["v"],"Preterite"],["dormîtes","dormir",["v"],["v"],"Preterite"],["dormirent","dormir",["v"],["v"],"Preterite"],["courus","courir",["v"],["v"],"Preterite"],["courut","courir",["v"],["v"],"Preterite"],["courûmes","courir",["v"],["v"],"Preterite"],["courûtes","courir",["v"],["v"],"Preterite"],["coururent","courir",["v"],["v"],"Preterite"],["mourus","mourir",["v"],["v"],"Preterite"],["mourut","mourir",["v"],["v"],"Preterite"],["mourûmes","mourir",["v"],["v"],"Preterite"],["mourûtes","mourir",["v"],["v"],"Preterite"],["moururent","mourir",["v"],["v"],"Preterite"],["servis","servir",["v"],["v"],"Preterite"],["servit","servir",["v"],["v"],"Preterite"],["servîmes","servir",["v"],["v"],"Preterite"],["servîtes","servir",["v"],["v"],"Preterite"],["servirent","servir",["v"],["v"],"Preterite"],["fuis","fuir",["v"],["v"],"Preterite"],["fuit","fuir",["v"],["v"],"Preterite"],["fuîmes","fuir",["v"],["v"],"Preterite"],["fuîtes","fuir",["v"],["v"],"Preterite"],["fuirent","fuir",["v"],["v"],"Preterite"],["ouïs","ouïr",["v"],["v"],"Preterite"],["ouït","ouïr",["v"],["v"],"Preterite"],["ouïmes","ouïr",["v"],["v"],"Preterite"],["ouïtes","ouïr",["v"],["v"],"Preterite"],["ouïrent","ouïr",["v"],["v"],"Preterite"],["gis","gésir",["v"],["v"],"Preterite"],["git","gésir",["v"],["v"],"Preterite"],["gîmes","gésir",["v"],["v"],"Preterite"],["gîtes","gésir",["v"],["v"],"Preterite"],["gisirent","gésir",["v"],["v"],"Preterite"],["çus","cevoir",["v"],["v"],"Preterite"],["çut","cevoir",["v"],["v"],"Preterite"],["çûmes","cevoir",["v"],["v"],"Preterite"],["çûtes","cevoir",["v"],["v"],"Preterite"],["çurent","cevoir",["v"],["v"],"Preterite"],["vis","voir",["v"],["v"],"Preterite"],["vit","voir",["v"],["v"],"Preterite"],["vîmes","voir",["v"],["v"],"Preterite"],["vîtes","voir",["v"],["v"],"Preterite"],["virent","voir",["v"],["v"],"Preterite"],["sus","savoir",["v"],["v"],"Preterite"],["sut","savoir",["v"],["v"],"Preterite"],["sûmes","savoir",["v"],["v"],"Preterite"],["sûtes","savoir",["v"],["v"],"Preterite"],["surent","savoir",["v"],["v"],"Preterite"],["dus","devoir",["v"],["v"],"Preterite"],["dut","devoir",["v"],["v"],"Preterite"],["dûmes","devoir",["v"],["v"],"Preterite"],["dûtes","devoir",["v"],["v"],"Preterite"],["durent","devoir",["v"],["v"],"Preterite"],["pus","pouvoir",["v"],["v"],"Preterite"],["put","pouvoir",["v"],["v"],"Preterite"],["pûmes","pouvoir",["v"],["v"],"Preterite"],["pûtes","pouvoir",["v"],["v"],"Preterite"],["purent","pouvoir",["v"],["v"],"Preterite"],["mus","mouvoir",["v"],["v"],"Preterite"],["mut","mouvoir",["v"],["v"],"Preterite"],["mûmes","mouvoir",["v"],["v"],"Preterite"],["mûtes","mouvoir",["v"],["v"],"Preterite"],["murent","mouvoir",["v"],["v"],"Preterite"],["plut","pleuvoir",["v"],["v"],"Preterite"],["fallut","falloir",["v"],["v"],"Preterite"],["valus","valoir",["v"],["v"],"Preterite"],["valut","valoir",["v"],["v"],"Preterite"],["valûmes","valoir",["v"],["v"],"Preterite"],["valûtes","valoir",["v"],["v"],"Preterite"],["valurent","valoir",["v"],["v"],"Preterite"],["voulus","vouloir",["v"],["v"],"Preterite"],["voulut","vouloir",["v"],["v"],"Preterite"],["voulûmes","vouloir",["v"],["v"],"Preterite"],["voulûtes","vouloir",["v"],["v"],"Preterite"],["voulurent","vouloir",["v"],["v"],"Preterite"],["seus","seoir",["v"],["v"],"Preterite"],["seut","seoir",["v"],["v"],"Preterite"],["seûmes","seoir",["v"],["v"],"Preterite"],["seûtes","seoir",["v"],["v"],"Preterite"],["seurent","seoir",["v"],["v"],"Preterite"],["assis","asseoir",["v"],["v"],"Preterite"],["assit","asseoir",["v"],["v"],"Preterite"],["assîmes","asseoir",["v"],["v"],"Preterite"],["assîtes","asseoir",["v"],["v"],"Preterite"],["assirent","asseoir",["v"],["v"],"Preterite"],["chus","choir",["v"],["v"],"Preterite"],["chut","choir",["v"],["v"],"Preterite"],["chûmes","choir",["v"],["v"],"Preterite"],["chûtes","choir",["v"],["v"],"Preterite"],["churent","choir",["v"],["v"],"Preterite"],["andis","andre",["v"],["v"],"Preterite"],["andit","andre",["v"],["v"],"Preterite"],["andîmes","andre",["v"],["v"],"Preterite"],["andîtes","andre",["v"],["v"],"Preterite"],["andirent","andre",["v"],["v"],"Preterite"],["endis","endre",["v"],["v"],"Preterite"],["endit","endre",["v"],["v"],"Preterite"],["endîmes","endre",["v"],["v"],"Preterite"],["endîtes","endre",["v"],["v"],"Preterite"],["endirent","endre",["v"],["v"],"Preterite"],["ondis","ondre",["v"],["v"],"Preterite"],["ondit","ondre",["v"],["v"],"Preterite"],["ondîmes","ondre",["v"],["v"],"Preterite"],["ondîtes","ondre",["v"],["v"],"Preterite"],["ondirent","ondre",["v"],["v"],"Preterite"],["erdis","erdre",["v"],["v"],"Preterite"],["erdit","erdre",["v"],["v"],"Preterite"],["erdîmes","erdre",["v"],["v"],"Preterite"],["erdîtes","erdre",["v"],["v"],"Preterite"],["erdirent","erdre",["v"],["v"],"Preterite"],["ordis","ordre",["v"],["v"],"Preterite"],["ordit","ordre",["v"],["v"],"Preterite"],["ordîmes","ordre",["v"],["v"],"Preterite"],["ordîtes","ordre",["v"],["v"],"Preterite"],["ordirent","ordre",["v"],["v"],"Preterite"],["pris","prendre",["v"],["v"],"Preterite"],["prit","prendre",["v"],["v"],"Preterite"],["prîmes","prendre",["v"],["v"],"Preterite"],["prîtes","prendre",["v"],["v"],"Preterite"],["prirent","prendre",["v"],["v"],"Preterite"],["battis","battre",["v"],["v"],"Preterite"],["battit","battre",["v"],["v"],"Preterite"],["battîmes","battre",["v"],["v"],"Preterite"],["battîtes","battre",["v"],["v"],"Preterite"],["battirent","battre",["v"],["v"],"Preterite"],["mis","mettre",["v"],["v"],"Preterite"],["mit","mettre",["v"],["v"],"Preterite"],["mîmes","mettre",["v"],["v"],"Preterite"],["mîtes","mettre",["v"],["v"],"Preterite"],["mirent","mettre",["v"],["v"],"Preterite"],["eignis","eindre",["v"],["v"],"Preterite"],["eignit","eindre",["v"],["v"],"Preterite"],["eignîmes","eindre",["v"],["v"],"Preterite"],["eignîtes","eindre",["v"],["v"],"Preterite"],["eignirent","eindre",["v"],["v"],"Preterite"],["oignis","oindre",["v"],["v"],"Preterite"],["oignit","oindre",["v"],["v"],"Preterite"],["oignîmes","oindre",["v"],["v"],"Preterite"],["oignîtes","oindre",["v"],["v"],"Preterite"],["oignirent","oindre",["v"],["v"],"Preterite"],["aignis","aindre",["v"],["v"],"Preterite"],["aignit","aindre",["v"],["v"],"Preterite"],["aignîmes","aindre",["v"],["v"],"Preterite"],["aignîtes","aindre",["v"],["v"],"Preterite"],["aignirent","aindre",["v"],["v"],"Preterite"],["vainquis","vaincre",["v"],["v"],"Preterite"],["vainquit","vaincre",["v"],["v"],"Preterite"],["vainquîmes","vaincre",["v"],["v"],"Preterite"],["vainquîtes","vaincre",["v"],["v"],"Preterite"],["vainquirent","vaincre",["v"],["v"],"Preterite"],["rais","raire",["v"],["v"],"Preterite"],["rait","raire",["v"],["v"],"Preterite"],["rayons","raire",["v"],["v"],"Preterite"],["rayez","raire",["v"],["v"],"Preterite"],["raient","raire",["v"],["v"],"Preterite"],["fis","faire",["v"],["v"],"Preterite"],["fit","faire",["v"],["v"],"Preterite"],["fîmes","faire",["v"],["v"],"Preterite"],["fîtes","faire",["v"],["v"],"Preterite"],["firent","faire",["v"],["v"],"Preterite"],["plais","plaire",["v"],["v"],"Preterite"],["plut","plaire",["v"],["v"],"Preterite"],["plûmes","plaire",["v"],["v"],"Preterite"],["plûtes","plaire",["v"],["v"],"Preterite"],["plurent","plaire",["v"],["v"],"Preterite"],["naquis","naître",["v"],["v"],"Preterite"],["naquit","naître",["v"],["v"],"Preterite"],["naquîmes","naître",["v"],["v"],"Preterite"],["naquîtes","naître",["v"],["v"],"Preterite"],["naquirent","naître",["v"],["v"],"Preterite"],["perdis","perdre",["v"],["v"],"Preterite"],["perdit","perdre",["v"],["v"],"Preterite"],["perdîmes","perdre",["v"],["v"],"Preterite"],["perdîtes","perdre",["v"],["v"],"Preterite"],["perdirent","perdre",["v"],["v"],"Preterite"],["crus","croire",["v"],["v"],"Preterite"],["crut","croire",["v"],["v"],"Preterite"],["crûmes","croire",["v"],["v"],"Preterite"],["crûtes","croire",["v"],["v"],"Preterite"],["crurent","croire",["v"],["v"],"Preterite"],["bus","boire",["v"],["v"],"Preterite"],["but","boire",["v"],["v"],"Preterite"],["bûmes","boire",["v"],["v"],"Preterite"],["bûtes","boire",["v"],["v"],"Preterite"],["burent","boire",["v"],["v"],"Preterite"],["closis","clore",["v"],["v"],"Preterite"],["closit","clore",["v"],["v"],"Preterite"],["closîmes","clore",["v"],["v"],"Preterite"],["closîtes","clore",["v"],["v"],"Preterite"],["closirent","clore",["v"],["v"],"Preterite"],["clus","clure",["v"],["v"],"Preterite"],["clut","clure",["v"],["v"],"Preterite"],["clûmes","clure",["v"],["v"],"Preterite"],["clûtes","clure",["v"],["v"],"Preterite"],["clurent","clure",["v"],["v"],"Preterite"],["sous","soudre",["v"],["v"],"Preterite"],["sout","soudre",["v"],["v"],"Preterite"],["solvons","soudre",["v"],["v"],"Preterite"],["solvez","soudre",["v"],["v"],"Preterite"],["solvent","soudre",["v"],["v"],"Preterite"],["couds","coudre",["v"],["v"],"Preterite"],["coud","coudre",["v"],["v"],"Preterite"],["cousîmes","coudre",["v"],["v"],"Preterite"],["cousîtes","coudre",["v"],["v"],"Preterite"],["cousirent","coudre",["v"],["v"],"Preterite"],["mouds","moudre",["v"],["v"],"Preterite"],["moud","moudre",["v"],["v"],"Preterite"],["moulîmes","moudre",["v"],["v"],"Preterite"],["moulîtes","moudre",["v"],["v"],"Preterite"],["moulurent","moudre",["v"],["v"],"Preterite"],["vis","vivre",["v"],["v"],"Preterite"],["vit","vivre",["v"],["v"],"Preterite"],["vîmes","vivre",["v"],["v"],"Preterite"],["vîtes","vivre",["v"],["v"],"Preterite"],["virent","vivre",["v"],["v"],"Preterite"],["lis","lire",["v"],["v"],"Preterite"],["lit","lire",["v"],["v"],"Preterite"],["lîmes","lire",["v"],["v"],"Preterite"],["lîtes","lire",["v"],["v"],"Preterite"],["lurent","lire",["v"],["v"],"Preterite"],["dis","dire",["v"],["v"],"Preterite"],["dit","dire",["v"],["v"],"Preterite"],["dîmes","dire",["v"],["v"],"Preterite"],["dîtes","dire",["v"],["v"],"Preterite"],["dirent","dire",["v"],["v"],"Preterite"],["ris","rire",["v"],["v"],"Preterite"],["rit","rire",["v"],["v"],"Preterite"],["rîmes","rire",["v"],["v"],"Preterite"],["rîtes","rire",["v"],["v"],"Preterite"],["rirent","rire",["v"],["v"],"Preterite"],["maudis","maudire",["v"],["v"],"Preterite"],["maudit","maudire",["v"],["v"],"Preterite"],["maudîmes","maudire",["v"],["v"],"Preterite"],["maudîtes","maudire",["v"],["v"],"Preterite"],["maudissent","maudire",["v"],["v"],"Preterite"],["cris","crire",["v"],["v"],"Preterite"],["crit","crire",["v"],["v"],"Preterite"],["crîmes","crire",["v"],["v"],"Preterite"],["crîtes","crire",["v"],["v"],"Preterite"],["crirent","crire",["v"],["v"],"Preterite"],["fis","fire",["v"],["v"],"Preterite"],["fit","fire",["v"],["v"],"Preterite"],["fîmes","fire",["v"],["v"],"Preterite"],["fîtes","fire",["v"],["v"],"Preterite"],["fîrent","fire",["v"],["v"],"Preterite"],["cis","cire",["v"],["v"],"Preterite"],["cit","cire",["v"],["v"],"Preterite"],["cîmes","cire",["v"],["v"],"Preterite"],["cîtes","cire",["v"],["v"],"Preterite"],["cîrent","cire",["v"],["v"],"Preterite"],["fris","frire",["v"],["v"],"Preterite"],["frit","frire",["v"],["v"],"Preterite"],["frîmes","frire",["v"],["v"],"Preterite"],["frîtes","frire",["v"],["v"],"Preterite"],["frîrent","frire",["v"],["v"],"Preterite"],["uis","uire",["v"],["v"],"Preterite"],["uit","uire",["v"],["v"],"Preterite"],["ûmes","uire",["v"],["v"],"Preterite"],["ûtes","uire",["v"],["v"],"Preterite"],["urent","uire",["v"],["v"],"Preterite"],["s","",["n"],["n"],"plural"],["aux","au",["n"],["n"],"plural"],["eaux","eau",["n"],["n"],"plural"],["eux","eu",["n"],["n"],"plural"],["oux","ou",["n"],["n"],"plural"],["aux","al",["n"],["n"],"plural"],["aux","ail",["n"],["n"],"plural"],["ant","er",["v"],["v"],"present participle"],["geant","ger",["v"],["v"],"present participle"],["issant","ir",["v"],["v"],"present participle"],["ant","ir",["v"],["v"],"present participle"],["ant","re",["v"],["v"],"present participle"],["ant","oir",["v"],["v"],"present participle"],["ignant","indre",["v"],["v"],"present participle"],["solvant","soudre",["v"],["v"],"present participle"],["ant","dre",["v"],["v"],"present participle"],["rait","raire",["v"],["v"],"present participle"],["ant","oir",["v"],["v"],"present participle"],["ayant","avoir",["v"],["v"],"present participle"],["étant","être",["v"],["v"],"present participle"],["faisant","faire",["v"],["v"],"present participle"],["disant","dire",["v"],["v"],"present participle"],["lisant","lire",["v"],["v"],"present participle"],["voyant","voir",["v"],["v"],"present participle"],["sachant","savoir",["v"],["v"],"present participle"],["e","er",["v"],["v"],"present subjunctive"],["es","er",["v"],["v"],"present subjunctive"],["e","er",["v"],["v"],"present subjunctive"],["ions","er",["v"],["v"],"present subjunctive"],["iez","er",["v"],["v"],"present subjunctive"],["ent","er",["v"],["v"],"present subjunctive"],["sse","ir",["v"],["v"],"present subjunctive"],["sses","ir",["v"],["v"],"present subjunctive"],["t","ir",["v"],["v"],"present subjunctive"],["ssions","ir",["v"],["v"],"present subjunctive"],["ssiez","ir",["v"],["v"],"present subjunctive"],["ssent","ir",["v"],["v"],"present subjunctive"],["sois","être",["v"],["v"],"present subjunctive"],["sois","être",["v"],["v"],"present subjunctive"],["soit","être",["v"],["v"],"present subjunctive"],["soyons","être",["v"],["v"],"present subjunctive"],["soyez","être",["v"],["v"],"present subjunctive"],["soient","être",["v"],["v"],"present subjunctive"],["aie","avoir",["v"],["v"],"present subjunctive"],["aies","avoir",["v"],["v"],"present subjunctive"],["ait","avoir",["v"],["v"],"present subjunctive"],["ayons","avoir",["v"],["v"],"present subjunctive"],["ayez","avoir",["v"],["v"],"present subjunctive"],["aient","avoir",["v"],["v"],"present subjunctive"],["fasse","faire",["v"],["v"],"present subjunctive"],["fasses","faire",["v"],["v"],"present subjunctive"],["fasse","faire",["v"],["v"],"present subjunctive"],["fassions","faire",["v"],["v"],"present subjunctive"],["fassiez","faire",["v"],["v"],"present subjunctive"],["fassent","faire",["v"],["v"],"present subjunctive"],["aille","aller",["v"],["v"],"present subjunctive"],["ailles","aller",["v"],["v"],"present subjunctive"],["aille","aller",["v"],["v"],"present subjunctive"],["allions","aller",["v"],["v"],"present subjunctive"],["alliez","aller",["v"],["v"],"present subjunctive"],["aillent","aller",["v"],["v"],"present subjunctive"],["sache","savoir",["v"],["v"],"present subjunctive"],["saches","savoir",["v"],["v"],"present subjunctive"],["sache","savoir",["v"],["v"],"present subjunctive"],["sachions","savoir",["v"],["v"],"present subjunctive"],["sachiez","savoir",["v"],["v"],"present subjunctive"],["sachent","savoir",["v"],["v"],"present subjunctive"],["puisse","pouvoir",["v"],["v"],"present subjunctive"],["puisses","pouvoir",["v"],["v"],"present subjunctive"],["puisse","pouvoir",["v"],["v"],"present subjunctive"],["puissions","pouvoir",["v"],["v"],"present subjunctive"],["puissiez","pouvoir",["v"],["v"],"present subjunctive"],["puissent","pouvoir",["v"],["v"],"present subjunctive"],["sse","re",["v"],["v"],"present subjunctive"],["sses","re",["v"],["v"],"present subjunctive"],["t","re",["v"],["v"],"present subjunctive"],["ssions","re",["v"],["v"],"present subjunctive"],["ssiez","re",["v"],["v"],"present subjunctive"],["ssent","re",["v"],["v"],"present subjunctive"],["ienne","ir",["v"],["v"],"present subjunctive"],["iennes","ir",["v"],["v"],"present subjunctive"],["ienne","ir",["v"],["v"],"present subjunctive"],["nions","ir",["v"],["v"],"present subjunctive"],["niez","ir",["v"],["v"],"present subjunctive"],["iennent","ir",["v"],["v"],"present subjunctive"],["sse","indre",["v"],["v"],"present subjunctive"],["sses","indre",["v"],["v"],"present subjunctive"],["t","indre",["v"],["v"],"present subjunctive"],["nions","indre",["v"],["v"],"present subjunctive"],["niez","indre",["v"],["v"],"present subjunctive"],["ngent","indre",["v"],["v"],"present subjunctive"],["sse","oudre",["v"],["v"],"present subjunctive"],["sses","oudre",["v"],["v"],"present subjunctive"],["t","oudre",["v"],["v"],"present subjunctive"],["dions","oudre",["v"],["v"],"present subjunctive"],["diez","oudre",["v"],["v"],"present subjunctive"],["dent","oudre",["v"],["v"],"present subjunctive"],["se","uire",["v"],["v"],"present subjunctive"],["ses","uire",["v"],["v"],"present subjunctive"],["t","uire",["v"],["v"],"present subjunctive"],["sions","uire",["v"],["v"],"present subjunctive"],["siez","uire",["v"],["v"],"present subjunctive"],["sent","uire",["v"],["v"],"present subjunctive"],["sse","ir",["v"],["v"],"present subjunctive"],["sses","ir",["v"],["v"],"present subjunctive"],["t","ir",["v"],["v"],"present subjunctive"],["ssions","ir",["v"],["v"],"present subjunctive"],["ssiez","ir",["v"],["v"],"present subjunctive"],["ssent","ir",["v"],["v"],"present subjunctive"]];

const IINATAN_FRENCH_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;
  const deinflect = IINATAN_DEINFLECTION;
  const YOMITAN_RULES = typeof IINATAN_FRENCH_YOMITAN_SUFFIX_RULES !== "undefined" ? IINATAN_FRENCH_YOMITAN_SUFFIX_RULES : [];
  const ELIDED_PREFIXES = {
    c: true,
    d: true,
    j: true,
    l: true,
    m: true,
    n: true,
    qu: true,
    s: true,
    t: true
  };

  function yomitanFrenchRules() {
    const rules = [];
    for (let i = 0; i < YOMITAN_RULES.length; i++) {
      const rule = YOMITAN_RULES[i];
      if (!rule || rule.length < 4) continue;
      rules.push(deinflect.suffixInflection(rule[0], rule[1], rule[2], rule[3], "Yomitan " + (rule[4] || "French transform")));
    }
    return rules;
  }

  const transformer = deinflect.createTransformer({
    maxDepth: 3,
    maxResults: 128,
    conditions: [
      { name: "v", isDefault: true },
      { name: "n", isDefault: true },
      { name: "adj", isDefault: true },
      { name: "adv", isDefault: true },
      { name: "aux", isDefault: true }
    ],
    rules: yomitanFrenchRules().concat([
      deinflect.wholeWordInflection("compris", "comprendre", "v", "v", "irregular past participle"),
      deinflect.suffixInflection("ées", "er", "v", "v", "past participle -ées"),
      deinflect.suffixInflection("ée", "er", "v", "v", "past participle -ée"),
      deinflect.suffixInflection("és", "er", "v", "v", "past participle -és"),
      deinflect.suffixInflection("é", "er", "v", "v", "past participle -é"),
      deinflect.suffixInflection("ies", "ir", "v", "v", "past participle -ies"),
      deinflect.suffixInflection("ie", "ir", "v", "v", "past participle -ie"),
      deinflect.suffixInflection("çons", "cer", "v", "v", "present -çons"),
      deinflect.suffixInflection("geons", "ger", "v", "v", "present -geons"),
      deinflect.suffixInflection("amment", "ant", "adv", "adj", "adverb -amment"),
      deinflect.suffixInflection("emment", "ent", "adv", "adj", "adverb -emment"),
      deinflect.suffixInflection("ment", "", "adv", "adj", "adverb -ment")
    ])
  });

  function isHoverableChar(ch) {
    return common.LATIN_WORD_CHAR_RE.test(String(ch || ""));
  }

  function hasLookupText(text) {
    return common.LATIN_WORD_CHAR_RE.test(String(text || ""));
  }

  function dictionaryMatches(dict) {
    const primary = [
      dict && dict.name,
      dict && dict.title,
      dict && dict.path
    ].join(" ").toLowerCase();
    if (!primary) return false;
    if (primary.indexOf("jitendex") >= 0) return false;
    return /\bfrench\b/.test(primary) ||
      /\bfrancais\b/.test(primary) ||
      /\bfrançais\b/.test(primary) ||
      /(^|[^a-z])fr[-_/]/.test(primary) ||
      /(^|[^a-z])fra[-_/]/.test(primary) ||
      /(^|[^a-z])fre[-_/]/.test(primary);
  }

  function addBaseCandidate(list, seen, text, displayText, range, source, reason) {
    const candidateText = common.trimLookupPunctuation(text);
    if (!candidateText) return;
    common.pushUniqueCandidate(list, seen, {
      text: candidateText,
      normalizedText: candidateText,
      source,
      reason,
      language: "fr",
      displayText,
      range
    });
  }

  function addElisionTails(list, seen, text, displayText, range) {
    const normalized = common.normalizeApostrophes(text);
    const match = /^([a-zà-öø-ÿ]+)'(.+)$/i.exec(normalized);
    if (!match) return;
    const prefix = match[1].toLowerCase();
    if (!ELIDED_PREFIXES[prefix]) return;
    addBaseCandidate(list, seen, match[2], displayText, range, "french-elision", "elided prefix " + prefix + "'");
  }

  function generateCandidates(displayText, range) {
    const normalized = common.normalizeBasic(displayText);
    const trimmed = common.trimLookupPunctuation(normalized);
    const lowerOriginal = trimmed.toLowerCase();
    const lowerApostrophe = common.normalizeApostrophes(lowerOriginal);
    const list = [];
    const seen = Object.create(null);
    const candidateRange = range || null;

    addBaseCandidate(list, seen, lowerOriginal, displayText, candidateRange, "surface", "lowercase surface");
    addBaseCandidate(list, seen, lowerApostrophe, displayText, candidateRange, "apostrophe-normalized", "apostrophe variants");
    addElisionTails(list, seen, lowerOriginal, displayText, candidateRange);
    addElisionTails(list, seen, lowerApostrophe, displayText, candidateRange);

    const baseCount = list.length;
    for (let i = 0; i < baseCount; i++) {
      deinflect.appendTransforms(list, seen, list[i], transformer, "fr", 36);
    }
    return list;
  }

  function lookupRequest(text, position) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    const run = common.findRun(chars, pos, isHoverableChar);
    if (!run) return null;
    const displayText = common.slice(chars, run.start, run.end);
    const candidates = generateCandidates(displayText, { start: run.start, end: run.end });
    if (!candidates.length) return null;
    return {
      lookupText: candidates[0].text,
      displayText,
      suffix: chars.slice(pos).join(""),
      lookupStart: run.start,
      lookupEnd: run.end,
      matchStart: run.start,
      backendMode: "exact",
      scanLength: common.chars(candidates[0].text).length,
      cacheStrategy: "word-candidates",
      cacheKey: "word:" + run.start + ":" + run.end + ":" + candidates.map(c => c.text).join("|"),
      candidates
    };
  }

  return {
    id: "fr",
    label: "French",
    experimental: false,
    lookupUnit: "word",
    wordMode: "latin-word",
    lookupMode: "exact",
    deinflection: "yomitan-style-french",
    deinflectionMode: "yomitan-style-french",
    dictionaryCompatibility: "Yomitan-compatible French-headword term dictionaries; apostrophe/elision-aware exact lookup.",
    upstreamRuleCount: YOMITAN_RULES.length,
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    generateCandidates,
    lookupRequest
  };
})();

/*
 * Derived from Yomitan ext/js/language/de/german-transforms.js
 * Upstream source: https://github.com/yomidevs/yomitan/blob/master/ext/js/language/de/german-transforms.js
 * Copyright (C) 2024-2026 Yomitan Authors
 * License: GPL-3.0-or-later. See DEINFLECTION_NOTES.md for attribution notes.
 */
const IINATAN_GERMAN_YOMITAN_SEPARABLE_PREFIXES = [
  "ab", "an", "auf", "aus", "auseinander", "bei", "da", "dabei", "dar", "daran",
  "dazwischen", "durch", "ein", "empor", "entgegen", "entlang", "entzwei",
  "fehl", "fern", "fest", "fort", "frei", "gegenüber", "gleich", "heim", "her",
  "herab", "heran", "herauf", "heraus", "herbei", "herein", "herüber", "herum",
  "herunter", "hervor", "hin", "hinab", "hinauf", "hinaus", "hinein",
  "hinterher", "hinunter", "hinweg", "hinzu", "hoch", "los", "mit", "nach",
  "nebenher", "nieder", "statt", "um", "vor", "voran", "voraus", "vorbei",
  "vorüber", "vorweg", "weg", "weiter", "wieder", "zu", "zurecht", "zurück",
  "zusammen"
];
const IINATAN_GERMAN_LOCAL_SEPARABLE_PREFIXES = ["hinüber", "teil"];
const IINATAN_GERMAN_YOMITAN_SUFFIX_RULES = [
  ["ung", "en", [], ["v"], "nominalization"],
  ["lung", "eln", [], ["v"], "nominalization"],
  ["rung", "rn", [], ["v"], "nominalization"],
  ["bar", "en", ["adj"], ["v"], "-bar"],
  ["bar", "n", ["adj"], ["v"], "-bar"],
  ["heit", "", ["n"], ["adj", "n"], "-heit"],
  ["keit", "", ["n"], ["adj", "n"], "-heit"]
];
const IINATAN_GERMAN_LOCAL_SUFFIX_RULES = [
  ["ungen", "en", ["n"], ["v"], "local plural nominalization -ungen"]
];
const IINATAN_GERMAN_YOMITAN_PREFIX_RULES = [
  ["un", "", [], ["adj"], "negative"]
];

const IINATAN_GERMAN_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;
  const deinflect = IINATAN_DEINFLECTION;
  const YOMITAN_SEPARABLE_PREFIXES = typeof IINATAN_GERMAN_YOMITAN_SEPARABLE_PREFIXES !== "undefined" ? IINATAN_GERMAN_YOMITAN_SEPARABLE_PREFIXES : [];
  const LOCAL_SEPARABLE_PREFIXES = typeof IINATAN_GERMAN_LOCAL_SEPARABLE_PREFIXES !== "undefined" ? IINATAN_GERMAN_LOCAL_SEPARABLE_PREFIXES : [];
  const YOMITAN_SUFFIX_RULES = typeof IINATAN_GERMAN_YOMITAN_SUFFIX_RULES !== "undefined" ? IINATAN_GERMAN_YOMITAN_SUFFIX_RULES : [];
  const LOCAL_SUFFIX_RULES = typeof IINATAN_GERMAN_LOCAL_SUFFIX_RULES !== "undefined" ? IINATAN_GERMAN_LOCAL_SUFFIX_RULES : [];
  const YOMITAN_PREFIX_RULES = typeof IINATAN_GERMAN_YOMITAN_PREFIX_RULES !== "undefined" ? IINATAN_GERMAN_YOMITAN_PREFIX_RULES : [];
  const MAX_RIGHT_CONTEXT_CHARS = 96;
  const MAX_RIGHT_CONTEXT_WORDS = 12;
  const GERMAN_WORD_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ]+$/;
  const GERMAN_TOKEN_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
  const ABBREVIATIONS = [
    "bzw.", "bspw.", "ca.", "d.h.", "dr.", "etc.", "evtl.", "ggf.", "inkl.",
    "i.d.r.", "m.e.", "nr.", "prof.", "s.", "sog.", "u.a.", "u.u.", "usw.",
    "v.a.", "vgl.", "z.b.", "z.t.", "zzgl."
  ];
  const SEPARABLE_PREFIXES = YOMITAN_SEPARABLE_PREFIXES.concat(LOCAL_SEPARABLE_PREFIXES);
  const PREFIX_SET = SEPARABLE_PREFIXES.reduce((out, prefix) => {
    out[prefix] = true;
    return out;
  }, Object.create(null));
  const IRREGULAR_FINITE_VERBS = {
    bin: ["sein"],
    bist: ["sein"],
    ist: ["sein"],
    sind: ["sein"],
    seid: ["sein"],
    war: ["sein"],
    waren: ["sein"],
    habe: ["haben"],
    hast: ["haben"],
    hat: ["haben"],
    haben: ["haben"],
    habt: ["haben"],
    hatte: ["haben"],
    hatten: ["haben"],
    kann: ["können"],
    kannst: ["können"],
    können: ["können"],
    könnt: ["können"],
    muss: ["müssen"],
    musst: ["müssen"],
    müssen: ["müssen"],
    müsst: ["müssen"],
    will: ["wollen"],
    willst: ["wollen"],
    wollen: ["wollen"],
    wollt: ["wollen"],
    darf: ["dürfen"],
    darfst: ["dürfen"],
    dürfen: ["dürfen"],
    dürft: ["dürfen"],
    soll: ["sollen"],
    sollst: ["sollen"],
    sollen: ["sollen"],
    sollt: ["sollen"],
    mag: ["mögen"],
    magst: ["mögen"],
    mögen: ["mögen"],
    mögt: ["mögen"],
    geht: ["gehen"],
    gehe: ["gehen"],
    gehst: ["gehen"],
    gibst: ["geben"],
    gibt: ["geben"],
    hilft: ["helfen"],
    helfe: ["helfen"],
    hilfst: ["helfen"],
    lese: ["lesen"],
    liest: ["lesen"],
    nimmt: ["nehmen"],
    nimmst: ["nehmen"],
    sehe: ["sehen"],
    siehst: ["sehen"],
    sieht: ["sehen"],
    spreche: ["sprechen"],
    sprichst: ["sprechen"],
    spricht: ["sprechen"],
    stehe: ["stehen"],
    stehst: ["stehen"],
    steht: ["stehen"],
    tue: ["tun"],
    tust: ["tun"],
    tut: ["tun"],
    werde: ["werden"],
    wirst: ["werden"],
    wird: ["werden"]
  };

  function yomitanGermanRules() {
    const rules = [];
    YOMITAN_SUFFIX_RULES.concat(LOCAL_SUFFIX_RULES).forEach(rule => {
      if (!rule || rule.length < 5) return;
      rules.push(deinflect.suffixInflection(rule[0], rule[1], rule[2], rule[3], rule[4]));
    });
    YOMITAN_PREFIX_RULES.forEach(rule => {
      if (!rule || rule.length < 5) return;
      rules.push(deinflect.prefixInflection(rule[0], rule[1], rule[2], rule[3], rule[4]));
    });
    return rules;
  }

  const transformer = deinflect.createTransformer({
    maxDepth: 3,
    maxResults: 80,
    conditions: [
      { name: "v", isDefault: true },
      { name: "vw", isDefault: true },
      { name: "vst", isDefault: true },
      { name: "n", isDefault: true },
      { name: "adj", isDefault: true }
    ],
    rules: yomitanGermanRules().concat([
      deinflect.customInflection(getBasicPastParticiples, [], "vw", "past participle"),
      deinflect.customInflection(getSeparablePastParticiples, [], "vw", "past participle"),
      deinflect.customInflection(getZuInfinitives, [], "v", "zu-infinitive")
    ])
  });

  function isHoverableChar(ch) {
    return common.LATIN_WORD_CHAR_RE.test(String(ch || ""));
  }

  function hasLookupText(text) {
    return common.LATIN_WORD_CHAR_RE.test(String(text || ""));
  }

  function dictionaryMatches(dict) {
    const primary = [
      dict && dict.name,
      dict && dict.title,
      dict && dict.path
    ].join(" ").toLowerCase();
    if (!primary) return false;
    if (primary.indexOf("jitendex") >= 0) return false;
    return /\bgerman\b/.test(primary) ||
      /\bdeutsch\b/.test(primary) ||
      /(^|[^a-z])de[-_/]/.test(primary) ||
      /(^|[^a-z])deu[-_/]/.test(primary) ||
      /(^|[^a-z])ger[-_/]/.test(primary);
  }

  function getBasicPastParticiples(text) {
    const match = /^ge([a-zà-öø-ÿ]+)t$/i.exec(text);
    if (!match) return [];
    return [match[1] + "en", match[1] + "n"];
  }

  function getSeparablePastParticiples(text) {
    const prefix = SEPARABLE_PREFIXES.join("|");
    const match = new RegExp("^(" + prefix + ")ge([a-zà-öø-ÿ]+)t$", "i").exec(text);
    if (!match) return [];
    return [match[1] + match[2] + "en", match[1] + match[2] + "n"];
  }

  function getZuInfinitives(text) {
    const prefix = SEPARABLE_PREFIXES.join("|");
    const match = new RegExp("^(" + prefix + ")zu([a-zà-öø-ÿ]+)$", "i").exec(text);
    return match ? [match[1] + match[2]] : [];
  }

  function addCandidate(list, seen, text, displayText, range, source, reason) {
    const candidateText = common.trimLookupPunctuation(text);
    if (!candidateText) return;
    common.pushUniqueCandidate(list, seen, {
      text: candidateText,
      normalizedText: candidateText,
      source,
      reason,
      language: "de",
      displayText,
      range
    });
  }

  function addEszettVariants(list, seen, text, displayText, range) {
    const ss = String(text || "").replace(/ẞ/g, "SS").replace(/ß/g, "ss");
    const eszett = String(text || "").replace(/SS/g, "ẞ").replace(/ss/g, "ß");
    addCandidate(list, seen, ss, displayText, range, "eszett", "eszett to ss");
    addCandidate(list, seen, eszett, displayText, range, "eszett", "ss to eszett");
  }

  function finiteVerbInfinitives(word) {
    const lower = String(word || "").toLowerCase();
    const out = [];
    const seen = Object.create(null);
    function push(value) {
      if (!value || seen[value]) return;
      seen[value] = true;
      out.push(value);
    }
    (IRREGULAR_FINITE_VERBS[lower] || []).forEach(push);
    if (lower.endsWith("elst")) push(lower.slice(0, -4) + "eln");
    if (lower.endsWith("elt")) push(lower.slice(0, -3) + "eln");
    if (lower.endsWith("erst")) push(lower.slice(0, -4) + "ern");
    if (lower.endsWith("ert")) push(lower.slice(0, -3) + "ern");
    if (lower.endsWith("est")) push(lower.slice(0, -3) + "en");
    if (lower.endsWith("et")) push(lower.slice(0, -2) + "en");
    if (lower.endsWith("st")) push(lower.slice(0, -2) + "en");
    if (lower.endsWith("t")) push(lower.slice(0, -1) + "en");
    if (lower.endsWith("e")) push(lower.slice(0, -1) + "en");
    if (lower.endsWith("en")) push(lower);
    return out.filter(value => value.length > 3);
  }

  function abbreviationKey(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, "");
  }

  function isAbbreviationPeriod(line, index) {
    const raw = String(line || "");
    const before = abbreviationKey(raw.slice(Math.max(0, index - 16), index + 1));
    if (ABBREVIATIONS.some(abbr => before.endsWith(abbr))) return true;
    const after = abbreviationKey(raw.slice(index + 1, Math.min(raw.length, index + 8)));
    if (/^[a-zà-öø-ÿ]\./.test(after)) return true;
    const recent = raw.slice(Math.max(0, index - 12), index + 1).toLowerCase();
    return /(?:^|[^a-zà-öø-ÿ])(?:[a-zà-öø-ÿ]{1,3}\.){2,}$/.test(recent.replace(/\s+/g, ""));
  }

  function rightContextWindow(text, start, end) {
    const chars = common.chars(text);
    const runEnd = common.clampPosition(end, chars.length);
    const maxEnd = Math.min(chars.length, runEnd + MAX_RIGHT_CONTEXT_CHARS);
    let stop = runEnd;
    for (; stop < maxEnd; stop++) {
      const ch = chars[stop];
      if ((ch === "!" || ch === "?" || ch === ";" || ch === ":") && stop > runEnd) break;
      if (ch === "." && stop > runEnd && !isAbbreviationPeriod(text, stop)) break;
    }
    let context = common.slice(chars, start, stop);
    const tokens = context.match(GERMAN_TOKEN_RE) || [];
    if (tokens.length > MAX_RIGHT_CONTEXT_WORDS) {
      const wanted = tokens.slice(0, MAX_RIGHT_CONTEXT_WORDS).join(" ");
      context = wanted;
    }
    return {
      text: context,
      end: start + common.chars(context).length,
      maxChars: MAX_RIGHT_CONTEXT_CHARS,
      maxWords: MAX_RIGHT_CONTEXT_WORDS
    };
  }

  function splitVerbCandidates(contextText) {
    const tokens = String(contextText || "").match(GERMAN_TOKEN_RE) || [];
    if (tokens.length < 2) return [];
    const finite = tokens[0];
    const prefix = tokens[tokens.length - 1].toLowerCase();
    if (!PREFIX_SET[prefix]) return [];
    return finiteVerbInfinitives(finite).map(infinitive => prefix + infinitive);
  }

  function generateCandidates(displayText, range, fullText) {
    const normalized = common.normalizeBasic(displayText);
    const trimmed = common.trimLookupPunctuation(normalized);
    const lower = trimmed.toLowerCase();
    const list = [];
    const seen = Object.create(null);
    const candidateRange = range || null;
    const rightContext = fullText && range ? rightContextWindow(fullText, range.start, range.end) : null;

    addCandidate(list, seen, trimmed, displayText, candidateRange, "surface", "surface form");
    addCandidate(list, seen, lower, displayText, candidateRange, "lowercase", "lowercase form");
    addEszettVariants(list, seen, trimmed, displayText, candidateRange);
    addEszettVariants(list, seen, lower, displayText, candidateRange);

    const baseCount = list.length;
    for (let i = 0; i < baseCount; i++) {
      deinflect.appendTransforms(list, seen, list[i], transformer, "de", 16);
    }

    if (rightContext && GERMAN_WORD_RE.test(trimmed)) {
      splitVerbCandidates(rightContext.text).forEach(candidate => {
        addCandidate(list, seen, candidate, displayText, candidateRange, "german-split-verb", "bounded right-context separable prefix");
      });
    }
    return { candidates: list, rightContext };
  }

  function lookupRequest(text, position) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    const run = common.findRun(chars, pos, isHoverableChar);
    if (!run) return null;
    const displayText = common.slice(chars, run.start, run.end);
    const generated = generateCandidates(displayText, { start: run.start, end: run.end }, normalized);
    const candidates = generated.candidates;
    if (!candidates.length) return null;
    return {
      lookupText: candidates[0].text,
      displayText,
      suffix: chars.slice(pos).join(""),
      lookupStart: run.start,
      lookupEnd: run.end,
      matchStart: run.start,
      backendMode: "exact",
      scanLength: common.chars(candidates[0].text).length,
      cacheStrategy: "word-candidates",
      cacheKey: "word:" + run.start + ":" + run.end + ":" + candidates.map(c => c.text).join("|"),
      candidates,
      rightContext: generated.rightContext
    };
  }

  return {
    id: "de",
    label: "German",
    experimental: false,
    lookupUnit: "word",
    wordMode: "latin-word",
    lookupMode: "exact",
    deinflection: "yomitan-style-german",
    deinflectionMode: "yomitan-style-german",
    dictionaryCompatibility: "Yomitan-compatible German-headword term dictionaries; capitalization and separable-verb candidate lookup.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    generateCandidates,
    rightContextWindow,
    splitVerbCandidates,
    lookupRequest
  };
})();

const IINATAN_CHINESE_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;

  function isHoverableChar(ch) {
    return common.CHINESE_CHAR_RE.test(String(ch || ""));
  }

  function hasLookupText(text) {
    return common.CHINESE_CHAR_RE.test(String(text || ""));
  }

  function dictionaryMatches(dict) {
    const primary = common.dictionaryIdentity(dict);
    if (!primary) return false;
    if (primary.indexOf("jitendex") >= 0) return false;
    return /\b(chinese|mandarin|cantonese|hanzi|hanyu|zhongwen)\b/.test(primary) ||
      /\b(cc-?cedict|cedict|cedict_ts|moedict)\b/.test(primary) ||
      /(^|[^a-z])(zh|zho|chi|cmn|yue|wuu|hak|nan)[-_/]/.test(primary) ||
      /[-_/](zh|zho|chi|cmn|yue|wuu|hak|nan)([^a-z]|$)/.test(primary);
  }

  function lookupRequest(text, position, scanLength) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    if (!chars.length || pos >= chars.length || !isHoverableChar(chars[pos])) return null;
    const maxChars = Math.max(1, Math.min(Number(scanLength) || 24, chars.length - pos));
    const lookupText = chars.slice(pos, pos + maxChars).join("");
    if (!lookupText) return null;
    return {
      lookupText,
      displayText: chars[pos],
      suffix: chars.slice(pos).join(""),
      lookupStart: pos,
      lookupEnd: Math.min(chars.length, pos + maxChars),
      matchStart: pos,
      backendMode: "prefix",
      scanLength: maxChars,
      cacheStrategy: "exact-position",
      cacheKey: "zh:" + pos + ":" + lookupText
    };
  }

  return {
    id: "zh",
    label: "Chinese",
    experimental: false,
    lookupUnit: "character",
    wordMode: "rightward-prefix",
    lookupMode: "prefix",
    deinflection: "none",
    deinflectionMode: "none",
    dictionaryCompatibility: "Yomitan-compatible Chinese-headword term dictionaries; longest rightward-prefix lookup without Japanese deinflection.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
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

  function dictionaryMatches(dict) {
    const primary = [
      dict && dict.name,
      dict && dict.title,
      dict && dict.path
    ].join(" ").toLowerCase();
    if (!primary) return false;
    if (primary.indexOf("jitendex") >= 0) return false;
    return /\bkorean\b/.test(primary) ||
      /(^|[^a-z])ko[-_/]/.test(primary) ||
      /(^|[^a-z])kor[-_/]/.test(primary);
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
      cacheStrategy: "word-span",
      cacheKey: "word:" + run.start + ":" + run.end + ":" + lookupText
    };
  }

  return {
    id: "ko",
    label: "Korean (experimental)",
    experimental: true,
    lookupUnit: "word",
    wordMode: "korean-run",
    lookupMode: "exact",
    deinflection: "none",
    deinflectionMode: "none",
    dictionaryCompatibility: "Yomitan-compatible term dictionaries; exact contiguous-Hangul lookup only.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    lookupRequest
  };
})();

const IINATAN_LANGUAGE_REGISTRY = (() => {
  const languages = [
    IINATAN_JAPANESE_LANGUAGE,
    IINATAN_ENGLISH_LANGUAGE,
    IINATAN_FRENCH_LANGUAGE,
    IINATAN_GERMAN_LANGUAGE,
    IINATAN_CHINESE_LANGUAGE,
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
      lookupUnit: selectedLanguage.lookupUnit || "character",
      wordMode: selectedLanguage.wordMode,
      lookupMode: selectedLanguage.lookupMode || selectedLanguage.backendMode || "yomitan-japanese",
      deinflection: selectedLanguage.deinflection,
      deinflectionMode: selectedLanguage.deinflectionMode || selectedLanguage.deinflection,
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
function normalizePopupThemePreference(value) {
  const theme = String(value || "").trim().toLowerCase();
  if (theme === "dark" || theme === "light" || theme === "inherit") return theme;
  return "inherit";
}
function normalizeAppearanceHint(value) {
  const theme = String(value || "").trim().toLowerCase();
  if (theme === "dark" || theme === "light") return theme;
  return "";
}
function appearanceHintFromThemeMaterial(value, systemHint) {
  const themeMaterial = Number(String(value || "").trim());
  if (themeMaterial === 0) return "dark";
  if (themeMaterial === 2) return "light";
  if (themeMaterial === 4) return normalizeAppearanceHint(systemHint);
  return "";
}
async function readMacOSAppearanceHint() {
  try {
    const result = await utils.exec("/usr/bin/defaults", ["read", "-g", "AppleInterfaceStyle"], dataRoot());
    const text = String((result && result.stdout) || "").trim().toLowerCase();
    return text === "dark" ? "dark" : "light";
  } catch (_) {
    return "";
  }
}
async function readIINAAppearanceHint() {
  try {
    const result = await utils.exec("/usr/bin/defaults", ["read", "com.colliderli.iina", "themeMaterial"], dataRoot());
    const raw = String((result && result.stdout) || "").trim();
    if (!raw) return "";
    const systemHint = Number(raw) === 4 ? await readMacOSAppearanceHint() : "";
    return appearanceHintFromThemeMaterial(raw, systemHint);
  } catch (_) {
    return "";
  }
}
function scheduleIINAAppearanceHintRefresh(force) {
  const now = Date.now();
  if (iinaAppearanceHintRefreshInFlight) return;
  if (!force && now - iinaAppearanceHintLastRefreshAt < 5000) return;
  iinaAppearanceHintRefreshInFlight = true;
  iinaAppearanceHintLastRefreshAt = now;
  readIINAAppearanceHint().then(hint => {
    const next = normalizeAppearanceHint(hint);
    if (next && next !== iinaAppearanceHint) {
      iinaAppearanceHint = next;
      if (typeof pushOverlayConfigForProfileChange === "function") pushOverlayConfigForProfileChange();
    }
  }).catch(error => {
    debugVerbose("Could not read IINA appearance preference: " + compactError(error));
  }).finally(() => {
    iinaAppearanceHintRefreshInFlight = false;
  });
}
function overlayConfig() {
  const language = selectedLanguageModule();
  scheduleIINAAppearanceHintRefresh(false);
  return {
    language: selectedLanguageOverlayConfig(),
    lookupLanguage: language.id,
    fontScale: prefNumber("fontScale", 1.0),
    popupScale: prefNumber("popupScale", 0.92),
    popupMaxWidth: Math.max(260, prefNumber("popupMaxWidth", 440)),
    popupMaxHeightVh: Math.max(20, prefNumber("popupMaxHeightVh", 34)),
    popupSubtitleGapPx: Math.max(12, prefNumber("popupSubtitleGapPx", 34)),
    popupTheme: normalizePopupThemePreference(pref("popupTheme", "inherit")),
    popupThemeHint: normalizeAppearanceHint(iinaAppearanceHint),
    ...readSubtitleStyleConfig(),
    maxEntries: Math.max(1, prefNumber("maxEntries", 3)),
    maxGlossesPerEntry: Math.max(1, prefNumber("maxGlossesPerEntry", 4)),
    scanLength: Math.max(1, prefNumber("scanLength", 24)),
    hoverRequestTimeoutMs: Math.max(1500, prefNumber("hoverRequestTimeoutMs", 15000)),
    audioAutoPlay: prefBool("audioAutoPlay", false),
    audioSources: normalizeAudioSources(pref("audioSourcesJson", DEFAULT_AUDIO_SOURCES_JSON)),
    anki: typeof overlayAnkiConfig === "function" ? overlayAnkiConfig() : { enabled: false, configured: false },
    etymologyCollapseDefault: String(pref("etymologyCollapseDefault", "collapsed") || "collapsed"),
    wiktionaryEtymologyCollapseOverride: String(pref("wiktionaryEtymologyCollapseOverride", "collapsed") || "collapsed"),
    customPopupCss: String(pref("customPopupCss", "") || ""),
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
  const language = selectedLanguageModule();
  const dicts = activeDictionaryPaths(language);
  debugVerbose("publishSubtitle lineId=" + currentSubtitleLineId + " language=" + language.id + " activeDicts=" + dicts.length + " len=" + String(normalized || "").length + " text=" + JSON.stringify(String(normalized || "").slice(0, 80)));
  postToOverlay("subtitle", { text: normalized, config: overlayConfig(), lineId: currentSubtitleLineId });
  postToOverlay("line-lookup-reset", { lineId: currentSubtitleLineId });
  // v1.5.0: no full-line background precompute. Hover requests are looked up
  // directly and serialized so the hovered word is never blocked by a batch.
  if (normalized && language.hasLookupText(normalized) && dicts.length) {
    ensureBackendWorker(dicts, language).catch(error => {
      debugLog("background worker warmup failed lineId=" + currentSubtitleLineId + ": " + compactError(error));
    });
  }
}
function canHideNativeSubtitlesForCurrentLanguage() {
  if (!lookupBackendReadyForNativeHide) return false;
  try {
    const language = selectedLanguageModule();
    const dicts = activeDictionaryPaths(language);
    if (dictionarySetupMessage(language, dicts)) return false;
    const ready = activeWorkerReady || readWorkerReady();
    return !!ready && activeWorkerFingerprint === workerFingerprint(dicts, language) && ready.fingerprint === activeWorkerFingerprint;
  } catch (_) { return false; }
}
function syncNativeSubtitleVisibility() {
  if (!enabled) return;
  try {
    if (prefBool("hideNativeSubtitles", true) && canHideNativeSubtitlesForCurrentLanguage()) {
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

const DEFAULT_PROFILE_ID = "default";
const DEFAULT_AUDIO_SOURCE_URL = "http://127.0.0.1:5050/?term={term}&reading={reading}";
const DEFAULT_AUDIO_SOURCES_JSON = JSON.stringify([{ url: DEFAULT_AUDIO_SOURCE_URL }]);
const DEFAULT_ANKI_CONNECT_URL = "http://127.0.0.1:8765";
const DEFAULT_ANKI_FIELD_TEMPLATES_JSON = "{}";
const PROFILE_PREFERENCE_DEFAULTS = {
  enabledByDefault: true,
  hideNativeSubtitles: true,
  pauseWhilePopupVisible: true,
  audioAutoPlay: false,
  audioSourcesJson: DEFAULT_AUDIO_SOURCES_JSON,
  ankiEnabled: false,
  ankiConnectUrl: DEFAULT_ANKI_CONNECT_URL,
  ankiDeckName: "",
  ankiModelName: "",
  ankiFieldTemplatesJson: DEFAULT_ANKI_FIELD_TEMPLATES_JSON,
  ankiTags: "iinatan",
  ankiAudioFormat: "mp3",
  ankiAudioBitrateKbps: 96,
  ankiImageQuality: 85,
  ankiDuplicateCheck: true,
  ankiDuplicateMode: "prevent",
  ankiDuplicateScope: "deck",
  ankiSentenceAudioPaddingMs: 250,
  lookupLanguage: "ja",
  scanLength: 24,
  maxEntries: 3,
  maxGlossesPerEntry: 4,
  lookupTimeoutMs: 9000,
  fontScale: 1.0,
  popupScale: 0.92,
  popupMaxWidth: 440,
  popupMaxHeightVh: 34,
  popupSubtitleGapPx: 34,
  popupTheme: "inherit",
  subtitlePollMs: 120,
  etymologyCollapseDefault: "collapsed",
  wiktionaryEtymologyCollapseOverride: "collapsed",
  customPopupCss: "",
  hoverRequestTimeoutMs: 15000,
  backendTimeoutMs: 30000,
  debugLogEnabled: true,
  debugLogVerbose: false,
  directWorkerIpc: true,
  fallbackToClientExec: true,
  directIpcPollMs: 2,
  workerIdleSleepMs: 2
};
const PROFILE_PREFERENCE_KEYS = Object.keys(PROFILE_PREFERENCE_DEFAULTS);
const GLOBAL_SETTINGS_DEFAULTS = {
  lowRamImport: true,
  importTimeoutMs: 1800000
};
const GLOBAL_SETTINGS_KEYS = Object.keys(GLOBAL_SETTINGS_DEFAULTS);

function normalizeAudioSourceUrl(value) {
  const url = String(value || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return "";
  return url;
}
function normalizeAudioSourceItem(source) {
  const raw = typeof source === "string" ? { url: source } : (source && typeof source === "object" ? source : {});
  const url = normalizeAudioSourceUrl(raw.url);
  if (!url) return null;
  const name = String(raw.name || "").trim();
  return name ? { name, url } : { url };
}
function normalizeAudioSources(value) {
  let raw = value;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try { raw = JSON.parse(text); } catch (_) { raw = text; }
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.audioSources)) raw = raw.audioSources;
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const seen = Object.create(null);
  const out = [];
  values.forEach(item => {
    const normalized = normalizeAudioSourceItem(item);
    if (!normalized || seen[normalized.url]) return;
    seen[normalized.url] = true;
    out.push(normalized);
  });
  return out;
}
function normalizeAudioSourcesJsonPreference(value, useDefaultWhenEmpty) {
  const sources = normalizeAudioSources(value);
  if (!sources.length && useDefaultWhenEmpty) return DEFAULT_AUDIO_SOURCES_JSON;
  return JSON.stringify(sources);
}
function normalizeAnkiConnectUrl(value) {
  const url = String(value || "").trim();
  if (!url || !/^https?:\/\//i.test(url) || /[\s<>"']/.test(url)) return DEFAULT_ANKI_CONNECT_URL;
  return url.replace(/\/+$/, "");
}
function normalizeAnkiFieldTemplates(value) {
  let raw = value;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    try { raw = JSON.parse(text); } catch (_) { return {}; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  Object.keys(raw).forEach(key => {
    const field = String(key || "").trim();
    if (!field) return;
    out[field] = String(raw[key] === undefined || raw[key] === null ? "" : raw[key]).slice(0, 20000);
  });
  return out;
}
function normalizeAnkiFieldTemplatesJsonPreference(value) {
  return JSON.stringify(normalizeAnkiFieldTemplates(value));
}
function normalizeAnkiAudioFormat(value) {
  const format = String(value || "").trim().toLowerCase();
  return format === "opus" ? "opus" : "mp3";
}
function normalizeAnkiAudioBitrateKbps(value) {
  const bitrate = Math.round(Number(value) || PROFILE_PREFERENCE_DEFAULTS.ankiAudioBitrateKbps);
  return Math.max(24, Math.min(320, bitrate));
}
function normalizeAnkiImageQuality(value) {
  const quality = Math.round(Number(value) || PROFILE_PREFERENCE_DEFAULTS.ankiImageQuality);
  return Math.max(1, Math.min(100, quality));
}
function normalizeAnkiDuplicateMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "allow" ? "allow" : "prevent";
}
function normalizeAnkiDuplicateScope(value) {
  const scope = String(value || "").trim().toLowerCase();
  return scope === "collection" ? "collection" : "deck";
}
function normalizeProfilePreferenceBoolValue(value, fallback) {
  if (typeof preferenceValueToBool === "function") return preferenceValueToBool(value, fallback);
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
function emptyManifest() {
  return { dictionaries: {}, disabled: {}, dictionaryOrder: [], activeProfileId: DEFAULT_PROFILE_ID, profiles: {} };
}
function normalizeDictionaryOrder(order) {
  const seen = Object.create(null);
  const out = [];
  if (!Array.isArray(order)) return out;
  order.forEach(name => {
    const key = String(name || "").trim();
    if (key && !seen[key]) {
      seen[key] = true;
      out.push(key);
    }
  });
  return out;
}
function normalizeDisabledMap(map) {
  const out = {};
  if (!map || typeof map !== "object") return out;
  Object.keys(map).forEach(name => {
    if (map[name]) out[name] = true;
  });
  return out;
}
function normalizeProfilePreferences(prefs) {
  const out = {};
  PROFILE_PREFERENCE_KEYS.forEach(key => { out[key] = PROFILE_PREFERENCE_DEFAULTS[key]; });
  if (!prefs || typeof prefs !== "object") return out;
  const hasAudioSources = Object.prototype.hasOwnProperty.call(prefs, "audioSourcesJson");
  PROFILE_PREFERENCE_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(prefs, key)) out[key] = prefs[key];
  });
  out.audioAutoPlay = normalizeProfilePreferenceBoolValue(out.audioAutoPlay, PROFILE_PREFERENCE_DEFAULTS.audioAutoPlay);
  out.audioSourcesJson = normalizeAudioSourcesJsonPreference(out.audioSourcesJson, !hasAudioSources);
  out.ankiEnabled = normalizeProfilePreferenceBoolValue(out.ankiEnabled, PROFILE_PREFERENCE_DEFAULTS.ankiEnabled);
  out.ankiConnectUrl = normalizeAnkiConnectUrl(out.ankiConnectUrl);
  out.ankiDeckName = String(out.ankiDeckName || "").trim();
  out.ankiModelName = String(out.ankiModelName || "").trim();
  out.ankiFieldTemplatesJson = normalizeAnkiFieldTemplatesJsonPreference(out.ankiFieldTemplatesJson);
  out.ankiTags = String(out.ankiTags || "").replace(/\s+/g, " ").trim();
  out.ankiAudioFormat = normalizeAnkiAudioFormat(out.ankiAudioFormat);
  out.ankiAudioBitrateKbps = normalizeAnkiAudioBitrateKbps(out.ankiAudioBitrateKbps);
  out.ankiImageQuality = normalizeAnkiImageQuality(out.ankiImageQuality);
  out.ankiDuplicateCheck = normalizeProfilePreferenceBoolValue(out.ankiDuplicateCheck, PROFILE_PREFERENCE_DEFAULTS.ankiDuplicateCheck);
  out.ankiDuplicateMode = normalizeAnkiDuplicateMode(out.ankiDuplicateMode);
  out.ankiDuplicateScope = normalizeAnkiDuplicateScope(out.ankiDuplicateScope);
  out.ankiSentenceAudioPaddingMs = Math.max(0, Math.min(2000, Number(out.ankiSentenceAudioPaddingMs) || PROFILE_PREFERENCE_DEFAULTS.ankiSentenceAudioPaddingMs));
  return out;
}
function makeDefaultProfile(id, name) {
  const profileId = String(id || DEFAULT_PROFILE_ID);
  return { id: profileId, name: String(name || "Profile 1"), dictionaryOrder: [], disabled: {}, preferences: normalizeProfilePreferences({}) };
}
function normalizeManifestProfile(id, profile, manifest, existed) {
  const profileId = String(id || DEFAULT_PROFILE_ID);
  const source = profile && typeof profile === "object" ? profile : {};
  const fallbackFromRoot = !existed && (profileId === String(manifest.activeProfileId || DEFAULT_PROFILE_ID) || profileId === DEFAULT_PROFILE_ID);
  const fallback = makeDefaultProfile(profileId, profileId === DEFAULT_PROFILE_ID ? "Default" : profileId);
  return {
    id: profileId,
    name: String(source.name || fallback.name),
    dictionaryOrder: normalizeDictionaryOrder(
      Array.isArray(source.dictionaryOrder) ? source.dictionaryOrder :
        fallbackFromRoot ? manifest.dictionaryOrder : []
    ),
    disabled: normalizeDisabledMap(
      source.disabled && typeof source.disabled === "object" ? source.disabled :
        fallbackFromRoot ? manifest.disabled : {}
    ),
    preferences: normalizeProfilePreferences(source.preferences)
  };
}
function normalizeManifestShape(manifest) {
  const out = manifest && typeof manifest === "object" ? manifest : emptyManifest();
  if (!out.dictionaries || typeof out.dictionaries !== "object") out.dictionaries = {};
  out.disabled = normalizeDisabledMap(out.disabled);
  out.dictionaryOrder = normalizeDictionaryOrder(out.dictionaryOrder);
  out.activeProfileId = String(out.activeProfileId || DEFAULT_PROFILE_ID);
  const sourceProfiles = out.profiles && typeof out.profiles === "object" ? out.profiles : {};
  const profiles = {};
  Object.keys(sourceProfiles).forEach(id => {
    profiles[id] = normalizeManifestProfile(id, sourceProfiles[id], out, true);
  });
  if (!profiles[out.activeProfileId]) profiles[out.activeProfileId] = normalizeManifestProfile(out.activeProfileId, null, out, false);
  if (!profiles[DEFAULT_PROFILE_ID]) profiles[DEFAULT_PROFILE_ID] = normalizeManifestProfile(DEFAULT_PROFILE_ID, null, out, false);
  out.profiles = profiles;
  const active = profiles[out.activeProfileId] || profiles[DEFAULT_PROFILE_ID];
  out.disabled = normalizeDisabledMap(active.disabled);
  out.dictionaryOrder = normalizeDictionaryOrder(active.dictionaryOrder);
  return out;
}
function activeDictionaryProfile(manifest) {
  const normalized = normalizeManifestShape(manifest || readManifest());
  return normalized.profiles[normalized.activeProfileId] || normalized.profiles[DEFAULT_PROFILE_ID] || makeDefaultProfile(DEFAULT_PROFILE_ID, "Default");
}
function activeProfilePreferenceValue(key, fallback) {
  const preferenceKey = String(key || "");
  const fallbackValue = Object.prototype.hasOwnProperty.call(PROFILE_PREFERENCE_DEFAULTS, preferenceKey) ? PROFILE_PREFERENCE_DEFAULTS[preferenceKey] : fallback;
  const profile = activeDictionaryProfile(readManifest());
  const prefs = normalizeProfilePreferences(profile.preferences);
  if (Object.prototype.hasOwnProperty.call(prefs, preferenceKey)) return prefs[preferenceKey];
  return fallbackValue;
}
function activeProfilePreferenceBool(key, fallback) {
  const preferenceKey = String(key || "");
  const fallbackValue = Object.prototype.hasOwnProperty.call(PROFILE_PREFERENCE_DEFAULTS, preferenceKey) ? PROFILE_PREFERENCE_DEFAULTS[preferenceKey] : fallback;
  try {
    return preferenceValueToBool(activeProfilePreferenceValue(preferenceKey, fallbackValue), fallbackValue);
  } catch (_) {
    return prefBool(preferenceKey, fallbackValue);
  }
}
function profileSummaries(manifest) {
  const normalized = normalizeManifestShape(manifest || readManifest());
  return Object.keys(normalized.profiles).sort((a, b) => {
    if (a === normalized.activeProfileId) return -1;
    if (b === normalized.activeProfileId) return 1;
    if (a === DEFAULT_PROFILE_ID) return -1;
    if (b === DEFAULT_PROFILE_ID) return 1;
    return String(normalized.profiles[a].name || a).localeCompare(String(normalized.profiles[b].name || b));
  }).map(id => ({
    id,
    name: normalized.profiles[id].name || id,
    active: id === normalized.activeProfileId,
    locked: id === DEFAULT_PROFILE_ID
  }));
}
function activeProfileDisabledMap(manifest) {
  return normalizeDisabledMap(activeDictionaryProfile(manifest).disabled);
}
function activeProfileDictionaryOrder(manifest) {
  return normalizeDictionaryOrder(activeDictionaryProfile(manifest).dictionaryOrder);
}
function updateActiveProfile(manifest, updater) {
  const normalized = normalizeManifestShape(manifest || readManifest());
  const profile = activeDictionaryProfile(normalized);
  updater(profile, normalized);
  profile.dictionaryOrder = normalizeDictionaryOrder(profile.dictionaryOrder);
  profile.disabled = normalizeDisabledMap(profile.disabled);
  profile.preferences = normalizeProfilePreferences(profile.preferences);
  normalized.profiles[profile.id] = profile;
  normalized.dictionaryOrder = profile.dictionaryOrder.slice();
  normalized.disabled = normalizeDisabledMap(profile.disabled);
  return normalized;
}
function dictionaryOrderWithInstalledNames(requestedOrder, installedNames) {
  const installedSeen = Object.create(null);
  const installed = (installedNames || []).map(name => String(name || "")).filter(Boolean);
  installed.forEach(name => { installedSeen[name] = true; });
  const out = [];
  const used = Object.create(null);
  normalizeDictionaryOrder(requestedOrder).forEach(name => {
    if (installedSeen[name] && !used[name]) {
      used[name] = true;
      out.push(name);
    }
  });
  installed.forEach(name => {
    if (!used[name]) {
      used[name] = true;
      out.push(name);
    }
  });
  return out;
}
function orderedDictionaryDirs(installed, manifest) {
  const dicts = (installed || []).slice();
  const order = activeProfileDictionaryOrder(manifest);
  if (!order.length) return dicts;
  const byName = Object.create(null);
  dicts.forEach(d => { if (d && d.name) byName[d.name] = d; });
  const used = Object.create(null);
  const out = [];
  order.forEach(name => {
    if (byName[name] && !used[name]) {
      used[name] = true;
      out.push(byName[name]);
    }
  });
  dicts.forEach(d => {
    if (d && d.name && !used[d.name]) out.push(d);
  });
  return out;
}

function readManifest() {
  try {
    if (!file.exists(manifestPath())) return normalizeManifestShape(emptyManifest());
    const parsed = JSON.parse(file.read(manifestPath()));
    return normalizeManifestShape(parsed);
  } catch (_) { return normalizeManifestShape(emptyManifest()); }
}
function writeManifest(manifest) {
  try { file.write(manifestPath(), JSON.stringify(normalizeManifestShape(manifest), null, 2)); } catch (error) { console.warn("Could not write manifest: " + compactError(error)); }
}
function readDictionaryIndexMetadata(dictPath) {
  try {
    const indexPath = pathJoin(dictPath, "index.json");
    if (!file.exists(indexPath)) return {};
    const parsed = JSON.parse(file.read(indexPath));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    debugWarn("Could not read dictionary index metadata for " + String(dictPath || "") + ": " + compactError(error));
    return {};
  }
}
function normalizeDictionaryLanguage(value) {
  const lang = String(value || "").trim().toLowerCase();
  if (!lang) return "";
  if (/^(ja|jpn|jp|japanese)$/.test(lang)) return "ja";
  if (/^(en|eng|english)$/.test(lang)) return "en";
  if (/^(fr|fra|fre|french|francais|français)$/.test(lang)) return "fr";
  if (/^(de|deu|ger|german|deutsch)$/.test(lang)) return "de";
  if (/^(ko|kor|korean)$/.test(lang)) return "ko";
  if (/^(zh|zho|chi|cmn|yue|wuu|hak|nan|chinese|mandarin|cantonese|hanzi|hanyu|zhongwen)$/.test(lang)) return "zh";
  return lang;
}
function dictionaryLanguageFromMetadata(meta, manifestEntry) {
  const candidates = [
    meta && meta.language,
    meta && meta.lang,
    meta && meta.sourceLanguage,
    meta && meta.source_language,
    meta && meta.targetLanguage,
    meta && meta.target_language,
    manifestEntry && manifestEntry.language
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDictionaryLanguage(candidate);
    if (normalized) return normalized;
  }
  return "unknown";
}
function filenameFromListPath(listPath) {
  return String(listPath || "").split(/[\\/]/).filter(Boolean).pop() || "";
}
function dictionaryListItemName(item) {
  const name = String((item && item.filename) || filenameFromListPath(item && item.path) || "").trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) return "";
  return name;
}
function dictionaryListItemPath(item) {
  const name = dictionaryListItemName(item);
  return name ? pathJoin(dictRoot(), name) : "";
}
function unorderedDictionaryDirs() {
  try {
    if (!file.exists(dictRoot())) return [];
    const manifest = readManifest();
    return file.list(dictRoot(), { includeSubDir: false })
      .filter(item => item && item.isDir && dictionaryListItemName(item))
      .map(item => {
        const name = dictionaryListItemName(item);
        const dictPath = dictionaryListItemPath(item);
        const meta = readDictionaryIndexMetadata(dictPath);
        const manifestEntry = (manifest.dictionaries && (manifest.dictionaries[name] || manifest.dictionaries[meta.title])) || {};
        return {
          name,
          path: dictPath,
          title: meta.title || name,
          revision: meta.revision || "",
          format: meta.format || null,
          indexUrl: meta.indexUrl || "",
          downloadUrl: meta.downloadUrl || "",
          language: dictionaryLanguageFromMetadata(meta, manifestEntry),
          termCount: Number(manifestEntry.termCount || 0),
          metaCount: Number(manifestEntry.metaCount || 0),
          tagCount: Number(manifestEntry.tagCount || 0),
          mediaCount: Number(manifestEntry.mediaCount || 0),
          pitchCount: Number(manifestEntry.pitchCount || 0),
          freqCount: Number(manifestEntry.freqCount || 0)
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.warn("Could not list dictionaries: " + compactError(error));
    return [];
  }
}
function dictionaryDirs() {
  const manifest = readManifest();
  return orderedDictionaryDirs(unorderedDictionaryDirs(), manifest);
}
function recommendedDictionariesByLanguage() {
  if (typeof RECOMMENDED_DICTIONARIES_BY_LANGUAGE !== "undefined" && RECOMMENDED_DICTIONARIES_BY_LANGUAGE) return RECOMMENDED_DICTIONARIES_BY_LANGUAGE;
  return { ja: RECOMMENDED_JAPANESE_DICTIONARIES };
}
function recommendedDictionaryItemsForLanguage(language) {
  const groups = recommendedDictionariesByLanguage();
  const key = String(language || "ja");
  return Array.isArray(groups[key]) ? groups[key] : [];
}
function allRecommendedDictionaryItems() {
  const groups = recommendedDictionariesByLanguage();
  const out = [];
  Object.keys(groups).forEach(language => {
    if (Array.isArray(groups[language])) groups[language].forEach(item => out.push(item));
  });
  return out;
}
function recommendedDictionaryById(id) {
  const key = String(id || "");
  for (const item of allRecommendedDictionaryItems()) {
    if (item && item.id === key) return item;
  }
  return null;
}
function normalizeRecommendedDictionaryUrl(url) {
  return String(url || "").trim().replace(/\?.*$/, "");
}
function recommendedDictionaryUrlMatches(item, dict) {
  const installedUrl = normalizeRecommendedDictionaryUrl(dict && dict.downloadUrl);
  if (!installedUrl) return false;
  const urls = [item && item.downloadUrl].concat((item && Array.isArray(item.downloadUrlAliases)) ? item.downloadUrlAliases : []);
  return urls.some(url => normalizeRecommendedDictionaryUrl(url) === installedUrl);
}
function recommendedDictionaryTitlePrefixMatches(title, prefix) {
  const value = String(title || "").trim().toLowerCase();
  const needle = String(prefix || "").trim().toLowerCase();
  if (!value || !needle || value.indexOf(needle) !== 0) return false;
  const next = value.charAt(needle.length);
  return !next || !/[a-z0-9]/.test(next);
}
function recommendedDictionaryTitleMatches(item, dict) {
  const prefixes = (item && Array.isArray(item.titlePrefixes) && item.titlePrefixes.length) ? item.titlePrefixes : [item && item.title];
  const title = String((dict && dict.title) || "");
  const name = String((dict && dict.name) || "");
  return prefixes.some(prefix => recommendedDictionaryTitlePrefixMatches(title, prefix) || recommendedDictionaryTitlePrefixMatches(name, prefix));
}
function recommendedDictionaryMatchesInstalled(item, dict) {
  return !!(item && dict && (recommendedDictionaryUrlMatches(item, dict) || recommendedDictionaryTitleMatches(item, dict)));
}
function recommendedDictionaryInstalledMatches(item, dicts) {
  const seen = Object.create(null);
  const out = [];
  (dicts || []).forEach(dict => {
    if (!recommendedDictionaryMatchesInstalled(item, dict)) return;
    const key = String((dict && dict.path) || (dict && dict.name) || (dict && dict.title) || "");
    if (key && seen[key]) return;
    if (key) seen[key] = true;
    out.push(dict);
  });
  return out;
}
function recommendedDictionaryInstalled(item, dicts) {
  return recommendedDictionaryInstalledMatches(item, dicts).length > 0;
}
function recommendedDictionariesForLanguage(language, dicts) {
  return recommendedDictionaryItemsForLanguage(language).map(item => ({
    id: item.id,
    title: item.title,
    category: item.category || "",
    language: item.language || "Japanese",
    description: item.description || "",
    homepage: item.homepage || "",
    downloadUrl: item.downloadUrl,
    installed: recommendedDictionaryInstalled(item, dicts)
  }));
}
function disabledDictionaryMap(manifest) { return activeProfileDisabledMap(manifest || readManifest()); }
function dictionaryCompatibilityDetails(language, installed) {
  const lang = language || selectedLanguageModule();
  const dicts = installed || dictionaryDirs();
  const out = { compatible: [], unknown: [], incompatible: [] };
  if (!lang || lang.id === "ja" || typeof lang.dictionaryMatches !== "function") {
    out.compatible = dicts.slice();
    return out;
  }
  dicts.forEach(d => {
    try {
      if (d && d.language && d.language !== "unknown") {
        if (d.language === lang.id) out.compatible.push(d);
        else out.incompatible.push(d);
        return;
      }
      if (lang.dictionaryMatches(d)) out.compatible.push(d);
      else out.unknown.push(d);
    } catch (error) {
      debugWarn("Dictionary compatibility check failed language=" + String(lang.id || "") + " dict=" + String(d && d.name || "") + ": " + compactError(error));
      out.unknown.push(d);
    }
  });
  return out;
}
function languageCompatibleDictionaries(language, installed) {
  return dictionaryCompatibilityDetails(language, installed).compatible;
}
function activeDictionaryEntries(language) {
  const installed = dictionaryDirs();
  const disabled = disabledDictionaryMap();
  const seen = Object.create(null);
  const out = [];
  installed.filter(d => !disabled[d.name]).forEach(d => {
    const p = pathJoin(dictRoot(), d.name);
    if (!seen[p]) { seen[p] = true; out.push(d); }
  });
  return out;
}
function activeDictionaryPaths(language) {
  return activeDictionaryEntries(language).map(d => pathJoin(dictRoot(), d.name));
}
function dictionarySetupMessage(language, dicts) {
  const lang = language || selectedLanguageModule();
  const label = lang.label || lang.id || "selected language";
  if (dicts && dicts.length) return "";
  if (lang.id === "ja") return "No dictionaries installed/enabled. Use Plugins -> iinatan -> Settings... to download recommended dictionaries.";
  return "No dictionaries installed/enabled for " + label.replace(/\s*\(experimental\)\s*/i, "") + ". Import or enable a Yomitan dictionary ZIP.";
}
function dictionaryCompatibilityWarning(language, entries) {
  const lang = language || selectedLanguageModule();
  const dicts = entries || activeDictionaryEntries(lang);
  if (!lang || lang.id === "ja" || !dicts.length || typeof lang.dictionaryMatches !== "function") return "";
  const details = dictionaryCompatibilityDetails(lang, dicts);
  if (details.compatible.length || details.unknown.length) return "";
  return "No enabled dictionary is marked compatible with " + (lang.label || lang.id) + "; lookup will still try the enabled dictionaries.";
}
function workerFingerprint(dicts, language) {
  const lang = language || selectedLanguageModule();
  const paths = (dicts || activeDictionaryPaths(lang)).slice();
  return JSON.stringify({ version: VERSION, language: lang.id || "ja", dictionaries: paths });
}
function setDictionaryEnabled(name, enabledNow) {
  const manifest = updateActiveProfile(readManifest(), profile => {
    if (!profile.disabled) profile.disabled = {};
    if (enabledNow) delete profile.disabled[name]; else profile.disabled[name] = true;
  });
  writeManifest(manifest);
  lookupCache = Object.create(null);
  activeWorkerFingerprint = null;
  activeWorkerReady = null;
  stopBackendWorker().catch(() => {});
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  showOSD((enabledNow ? "Enabled" : "Disabled") + " dictionary: " + name);
}
function setDictionaryOrder(names) {
  const installedNames = unorderedDictionaryDirs().map(d => d.name);
  const manifest = updateActiveProfile(readManifest(), profile => {
    profile.dictionaryOrder = dictionaryOrderWithInstalledNames(names, installedNames);
  });
  writeManifest(manifest);
  lookupCache = Object.create(null);
  activeWorkerFingerprint = null;
  activeWorkerReady = null;
  stopBackendWorker().catch(() => {});
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  showOSD("Updated dictionary order.");
}
function dictionaryRemovalNameMap(names) {
  const out = Object.create(null);
  (Array.isArray(names) ? names : []).forEach(name => {
    const key = String(name || "").trim();
    if (key) out[key] = true;
  });
  return out;
}
function removeDictionaryReferencesFromProfile(profile, removeMap) {
  if (!profile || typeof profile !== "object") return;
  profile.dictionaryOrder = normalizeDictionaryOrder(profile.dictionaryOrder).filter(name => !removeMap[name]);
  profile.disabled = normalizeDisabledMap(profile.disabled);
  Object.keys(profile.disabled).forEach(name => {
    if (removeMap[name]) delete profile.disabled[name];
  });
}
function removeDictionaryReferencesFromManifest(manifest, names) {
  const normalized = normalizeManifestShape(manifest);
  const removeMap = dictionaryRemovalNameMap(names);
  Object.keys(normalized.dictionaries || {}).forEach(key => {
    const entry = normalized.dictionaries[key] || {};
    if (removeMap[key] || removeMap[entry.title] || removeMap[entry.name]) delete normalized.dictionaries[key];
  });
  Object.keys(normalized.profiles || {}).forEach(id => {
    removeDictionaryReferencesFromProfile(normalized.profiles[id], removeMap);
  });
  normalized.dictionaryOrder = normalizeDictionaryOrder(normalized.dictionaryOrder).filter(name => !removeMap[name]);
  normalized.disabled = normalizeDisabledMap(normalized.disabled);
  Object.keys(normalized.disabled).forEach(name => {
    if (removeMap[name]) delete normalized.disabled[name];
  });
  return normalizeManifestShape(normalized);
}
function replaceDictionaryReferencesInProfile(profile, removeMap, replacementName) {
  if (!profile || typeof profile !== "object") return;
  const replacement = String(replacementName || "").trim();
  const seen = Object.create(null);
  const order = [];
  normalizeDictionaryOrder(profile.dictionaryOrder).forEach(name => {
    const nextName = removeMap[name] && replacement ? replacement : name;
    if (nextName && !seen[nextName]) {
      seen[nextName] = true;
      order.push(nextName);
    }
  });
  profile.dictionaryOrder = order;
  const disabled = normalizeDisabledMap(profile.disabled);
  let replacementDisabled = !!(replacement && disabled[replacement]);
  Object.keys(disabled).forEach(name => {
    if (removeMap[name]) {
      replacementDisabled = replacementDisabled || !!disabled[name];
      delete disabled[name];
    }
  });
  if (replacement && replacementDisabled) disabled[replacement] = true;
  profile.disabled = disabled;
}
function replaceDictionaryReferencesInManifest(manifest, names, replacementName) {
  const normalized = normalizeManifestShape(manifest);
  const replacement = String(replacementName || "").trim();
  const removeMap = dictionaryRemovalNameMap(names);
  Object.keys(normalized.dictionaries || {}).forEach(key => {
    const entry = normalized.dictionaries[key] || {};
    if (key !== replacement && (removeMap[key] || removeMap[entry.title] || removeMap[entry.name])) delete normalized.dictionaries[key];
  });
  Object.keys(normalized.profiles || {}).forEach(id => {
    replaceDictionaryReferencesInProfile(normalized.profiles[id], removeMap, replacement);
  });
  normalized.dictionaryOrder = normalizeDictionaryOrder(normalized.dictionaryOrder).map(name => removeMap[name] && replacement ? replacement : name);
  normalized.dictionaryOrder = normalizeDictionaryOrder(normalized.dictionaryOrder);
  normalized.disabled = normalizeDisabledMap(normalized.disabled);
  let replacementDisabled = !!(replacement && normalized.disabled[replacement]);
  Object.keys(normalized.disabled).forEach(name => {
    if (removeMap[name]) {
      replacementDisabled = replacementDisabled || !!normalized.disabled[name];
      delete normalized.disabled[name];
    }
  });
  if (replacement && replacementDisabled) normalized.disabled[replacement] = true;
  return normalizeManifestShape(normalized);
}
function installedDictionaryByName(name) {
  const requested = String(name || "").trim();
  if (!requested) return null;
  const dicts = unorderedDictionaryDirs();
  for (let i = 0; i < dicts.length; i++) {
    if (dicts[i] && dicts[i].name === requested) return dicts[i];
  }
  return null;
}
function safeInstalledDictionaryPath(dictPath) {
  const root = String(dictRoot()).replace(/\/+$/, "");
  const candidate = String(dictPath || "").replace(/\/+$/, "");
  const relative = candidate.indexOf(root + "/") === 0 ? candidate.slice(root.length + 1) : "";
  const hasUnsafePart = relative.split("/").some(part => !part || part === "." || part === "..");
  if (!candidate || candidate === root || candidate.indexOf(root + "/") !== 0 || hasUnsafePart) {
    throw new Error("Refusing to delete dictionary outside installed dictionary folder: " + candidate);
  }
  return candidate;
}
function deletedDictionaryRoot() {
  return pathJoin(dataRoot(), "deleted-dictionaries");
}
function deletedDictionaryPath(name) {
  const safeName = String(name || "dictionary").replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/^-+|-+$/g, "") || "dictionary";
  return pathJoin(deletedDictionaryRoot(), safeName + "-" + String(Date.now()));
}
function deleteDictionaryPathInBackground(dictPath, name) {
  execChecked("/bin/rm", ["-rf", "--", dictPath]).catch(error => {
    debugWarn("background cleanup failed for deleted dictionary " + String(name || "") + ": " + compactError(error));
  });
}
async function deleteDictionary(name) {
  const dict = installedDictionaryByName(name);
  if (!dict) throw new Error("Dictionary is not installed: " + String(name || ""));
  const deletePath = safeInstalledDictionaryPath(dict.path);
  const removedPath = deletedDictionaryPath(dict.name);
  const names = [dict.name, dict.title, name].filter(Boolean);
  lookupCache = Object.create(null);
  activeWorkerFingerprint = null;
  activeWorkerReady = null;
  stopBackendWorker().catch(error => {
    debugWarn("dictionary delete could not stop worker before removing files: " + compactError(error));
  });
  await execChecked("/bin/mkdir", ["-p", deletedDictionaryRoot()]);
  await execChecked("/bin/mv", ["--", deletePath, removedPath]);
  writeManifest(removeDictionaryReferencesFromManifest(readManifest(), names));
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  deleteDictionaryPathInBackground(removedPath, dict.name);
  showOSD("Deleted dictionary: " + dict.name);
  return dict;
}
async function replaceRecommendedDictionaryMatches(item, replacementName, matches) {
  const replacement = String(replacementName || "").trim();
  if (!item || !replacement) return [];
  const replacementPath = safeInstalledDictionaryPath(pathJoin(dictRoot(), replacement));
  const seen = Object.create(null);
  const stale = [];
  (Array.isArray(matches) ? matches : []).forEach(dict => {
    if (!dict || !dict.path) return;
    const dictPath = safeInstalledDictionaryPath(dict.path);
    if (dictPath === replacementPath || seen[dictPath]) return;
    seen[dictPath] = true;
    stale.push(Object.assign({}, dict, { path: dictPath }));
  });
  if (!stale.length) return [];
  const names = [];
  stale.forEach(dict => {
    [dict.name, dict.title].forEach(name => {
      const key = String(name || "").trim();
      if (key && key !== replacement) names.push(key);
    });
  });
  lookupCache = Object.create(null);
  activeWorkerFingerprint = null;
  activeWorkerReady = null;
  await stopBackendWorker().catch(error => {
    debugWarn("recommended dictionary replacement could not stop worker before cleanup: " + compactError(error));
  });
  await execChecked("/bin/mkdir", ["-p", deletedDictionaryRoot()]);
  for (const dict of stale) {
    const removedPath = deletedDictionaryPath(dict.name || dict.title || item.title);
    await execChecked("/bin/mv", ["--", dict.path, removedPath]);
    deleteDictionaryPathInBackground(removedPath, dict.name || dict.title || item.title);
  }
  writeManifest(replaceDictionaryReferencesInManifest(readManifest(), names, replacement));
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return stale;
}
function ensureDictionaryInActiveProfileOrder(manifest, name) {
  const dictName = String(name || "").trim();
  if (!dictName) return normalizeManifestShape(manifest);
  return updateActiveProfile(manifest, profile => {
    const order = normalizeDictionaryOrder(profile.dictionaryOrder);
    if (order.indexOf(dictName) < 0) order.push(dictName);
    profile.dictionaryOrder = order;
  });
}
function readPreferenceForSnapshot(key) {
  const fallback = PROFILE_PREFERENCE_DEFAULTS[key];
  try {
    if (preferences && typeof preferences.get === "function") {
      const value = preferences.get(key);
      if (value !== undefined && value !== null && value !== "") return value;
    }
  } catch (_) {}
  try {
    if (typeof pref === "function") return pref(key, fallback);
  } catch (_) {}
  return fallback;
}
function applyProfilePreferences(profile) {
  if (!profile || !profile.preferences) return;
  const profilePreferences = normalizeProfilePreferences(profile.preferences);
  Object.keys(profilePreferences).forEach(key => {
    try {
      if (PROFILE_PREFERENCE_KEYS.indexOf(key) >= 0 && typeof preferences !== "undefined" && preferences && typeof preferences.set === "function") {
        preferences.set(key, profilePreferences[key]);
      }
    } catch (_) {}
  });
  try { if (typeof preferences !== "undefined" && preferences && preferences.sync) preferences.sync(); } catch (_) {}
}
function currentProfilePreferenceSnapshot() {
  const out = normalizeProfilePreferences({});
  PROFILE_PREFERENCE_KEYS.forEach(key => {
    out[key] = readPreferenceForSnapshot(key);
  });
  return normalizeProfilePreferences(out);
}
function profileIdFromName(name) {
  const base = String(name || "profile").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "profile";
}
function nextProfileName(profiles) {
  const names = Object.create(null);
  Object.keys(profiles || {}).forEach(id => {
    const name = String((profiles[id] && profiles[id].name) || "").trim();
    if (name) names[name] = true;
  });
  let index = Object.keys(profiles || {}).length + 1;
  while (names["Profile " + index]) index++;
  return "Profile " + index;
}
function uniqueProfileId(base, profiles) {
  const root = profileIdFromName(base);
  let id = root;
  let index = 2;
  while (profiles[id]) {
    id = root + "-" + String(index++);
  }
  return id;
}
function resetLookupRuntimeForProfileChange() {
  lookupCache = Object.create(null);
  lookupInFlight = Object.create(null);
  activeWorkerFingerprint = null;
  activeWorkerReady = null;
  lookupBackendReadyForNativeHide = false;
  try {
    if (typeof stopBackendWorker === "function") stopBackendWorker().catch(() => {});
  } catch (_) {}
}
function refreshRuntimeAfterProfileChange(reloadOverlay) {
  resetLookupRuntimeForProfileChange();
  if (reloadOverlay && typeof reloadOverlayForProfileChange === "function") {
    reloadOverlayForProfileChange();
  } else if (typeof pushOverlayConfigForProfileChange === "function") {
    pushOverlayConfigForProfileChange();
  }
}
function createDictionaryProfile(name, sourceProfileId) {
  const manifest = normalizeManifestShape(readManifest());
  const source = manifest.profiles[String(sourceProfileId || manifest.activeProfileId || DEFAULT_PROFILE_ID)] || activeDictionaryProfile(manifest);
  const sourcePreferences = source.id === manifest.activeProfileId ? currentProfilePreferenceSnapshot() : source.preferences;
  const profileName = String(name || nextProfileName(manifest.profiles)).trim() || nextProfileName(manifest.profiles);
  const id = uniqueProfileId(profileName, manifest.profiles);
  manifest.profiles[id] = {
    id,
    name: profileName,
    dictionaryOrder: normalizeDictionaryOrder(source.dictionaryOrder),
    disabled: normalizeDisabledMap(source.disabled),
    preferences: normalizeProfilePreferences(sourcePreferences)
  };
  writeManifest(manifest);
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return manifest.profiles[id];
}
function renameDictionaryProfile(profileId, name) {
  const manifest = normalizeManifestShape(readManifest());
  const id = String(profileId || manifest.activeProfileId || DEFAULT_PROFILE_ID);
  if (!manifest.profiles[id]) throw new Error("Unknown dictionary profile: " + id);
  const nextName = String(name || "").trim();
  if (!nextName) throw new Error("Profile name cannot be empty.");
  manifest.profiles[id].name = nextName;
  writeManifest(manifest);
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return manifest.profiles[id];
}
function deleteDictionaryProfile(profileId) {
  const manifest = normalizeManifestShape(readManifest());
  const id = String(profileId || "").trim();
  if (!id || !manifest.profiles[id]) throw new Error("Unknown dictionary profile: " + id);
  if (id === DEFAULT_PROFILE_ID) throw new Error("The first profile cannot be deleted.");
  const wasActive = id === manifest.activeProfileId;
  delete manifest.profiles[id];
  if (wasActive) manifest.activeProfileId = DEFAULT_PROFILE_ID;
  const normalized = normalizeManifestShape(manifest);
  writeManifest(normalized);
  if (wasActive) {
    applyProfilePreferences(activeDictionaryProfile(normalized));
    refreshRuntimeAfterProfileChange(true);
  } else {
    rebuildMenu();
  }
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return activeDictionaryProfile(normalized);
}
function updateDictionaryProfilePreferences(profileId, prefs) {
  const manifest = normalizeManifestShape(readManifest());
  const id = String(profileId || manifest.activeProfileId || DEFAULT_PROFILE_ID);
  if (!manifest.profiles[id]) throw new Error("Unknown dictionary profile: " + id);
  const previous = normalizeProfilePreferences(manifest.profiles[id].preferences);
  manifest.profiles[id].preferences = normalizeProfilePreferences(Object.assign({}, previous, prefs || {}));
  writeManifest(manifest);
  if (id === manifest.activeProfileId) {
    applyProfilePreferences(manifest.profiles[id]);
    refreshRuntimeAfterProfileChange(previous.lookupLanguage !== manifest.profiles[id].preferences.lookupLanguage);
    rebuildMenu();
  }
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return manifest.profiles[id];
}
function readGlobalSettingsSnapshot() {
  const out = {};
  GLOBAL_SETTINGS_KEYS.forEach(key => {
    const fallback = GLOBAL_SETTINGS_DEFAULTS[key];
    try {
      const value = typeof preferences !== "undefined" && preferences && typeof preferences.get === "function" ? preferences.get(key) : undefined;
      out[key] = value === undefined || value === null || value === "" ? fallback : value;
    } catch (_) {
      out[key] = fallback;
    }
  });
  return out;
}
function updateGlobalSettings(prefs) {
  const values = prefs && typeof prefs === "object" ? prefs : {};
  GLOBAL_SETTINGS_KEYS.forEach(key => {
    try {
      if (Object.prototype.hasOwnProperty.call(values, key) && typeof preferences !== "undefined" && preferences && typeof preferences.set === "function") {
        preferences.set(key, values[key]);
      }
    } catch (_) {}
  });
  try { if (typeof preferences !== "undefined" && preferences && preferences.sync) preferences.sync(); } catch (_) {}
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return readGlobalSettingsSnapshot();
}
function setActiveDictionaryProfile(profileId) {
  const requested = String(profileId || "").trim();
  const manifest = normalizeManifestShape(readManifest());
  if (!requested || !manifest.profiles[requested]) throw new Error("Unknown dictionary profile: " + requested);
  const currentId = manifest.activeProfileId || DEFAULT_PROFILE_ID;
  if (manifest.profiles[currentId]) {
    manifest.profiles[currentId].preferences = currentProfilePreferenceSnapshot();
  }
  manifest.activeProfileId = requested;
  const normalized = normalizeManifestShape(manifest);
  writeManifest(normalized);
  applyProfilePreferences(activeDictionaryProfile(normalized));
  refreshRuntimeAfterProfileChange(true);
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  showOSD("Switched iinatan profile: " + activeDictionaryProfile(normalized).name);
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
async function backendBinaryMatchesBundled() {
  if (!backendInstalled()) return false;
  try {
    const result = await utils.exec("/usr/bin/cmp", ["-s", bundledBinPath(), binPath()], dataRoot());
    return !!result && result.status === 0;
  } catch (_) {
    return false;
  }
}
async function ensureBundledBackendInstalled() {
  await ensureDataDirs();
  if (!file.exists(bundledBinPath())) {
    if (backendInstalled()) return;
    throw new Error("iinatan's lookup engine is missing. Install a packaged Apple Silicon build or run scripts/build_native_backend.sh while developing.");
  }
  if (await backendBinaryMatchesBundled()) return;
  const tmpPath = binPath() + ".tmp-" + String(Date.now());
  safeDelete(tmpPath);
  const result = await utils.exec("/bin/cp", [bundledBinPath(), tmpPath], dataRoot());
  if (!result || result.status !== 0) throw new Error("Could not install iinatan lookup engine: " + ((result && (result.stderr || result.stdout)) || "copy failed"));
  await execChecked("/bin/chmod", ["755", tmpPath]);
  const moved = await utils.exec("/bin/mv", ["-f", tmpPath, binPath()], dataRoot());
  if (!moved || moved.status !== 0) {
    safeDelete(tmpPath);
    throw new Error("Could not activate iinatan lookup engine: " + ((moved && (moved.stderr || moved.stdout)) || "move failed"));
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
  throw new Error("Dictionary backend returned incomplete output. stdoutBytes=" + text.length + " stdoutPrefix=" + text.slice(0, 260) + " stderr=" + String(stderr || "").slice(0, 260));
}
function outputPrefixSuffix(text, limit) {
  const s = String(text || "");
  const n = Math.max(80, limit || 600);
  return {
    bytes: s.length,
    prefix: s.slice(0, n),
    suffix: s.length > n ? s.slice(-n) : s
  };
}
function backendCommandError(stage, args, result, parsed, parseError) {
  const label = stage || "Dictionary backend command";
  const status = result && result.status !== undefined ? Number(result.status) : null;
  const stdout = outputPrefixSuffix(result && result.stdout, 700);
  const stderr = outputPrefixSuffix(result && result.stderr, 700);
  const backendMessage = (parsed && parsed.error) || String((result && result.stderr) || "").trim() || (parseError && parseError.message) || "";
  const message = label + " failed" + (status !== null ? " (exit " + status + ")" : "") + (backendMessage ? ": " + backendMessage : "");
  const error = new Error(message);
  error.backendStage = label;
  error.backendArgs = args || [];
  error.backendStatus = status;
  error.backendStdoutPrefix = stdout.prefix;
  error.backendStdoutSuffix = stdout.suffix;
  error.backendStdoutBytes = stdout.bytes;
  error.backendStderrPrefix = stderr.prefix;
  error.backendStderrSuffix = stderr.suffix;
  error.backendStderrBytes = stderr.bytes;
  error.backendParsedJson = parsed || null;
  if (parseError) error.backendParseError = compactError(parseError);
  return error;
}

async function runBackendJson(args, timeoutMs, stage) {
  await ensureBundledBackendInstalled();
  let timer = null;
  const timeout = Math.max(1000, timeoutMs || prefNumber("backendTimeoutMs", 30000));
  const label = stage || "Dictionary backend command";
  try {
    debugVerbose("backend exec start stage=" + label + " cwd=" + dataRoot() + " bin=" + binPath() + " args=" + JSON.stringify(args || []));
    const execStartedAt = Date.now();
    const result = await Promise.race([
      utils.exec(binPath(), args || [], dataRoot()),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + " timed out after " + timeout + " ms")), timeout); })
    ]);
    if (!result) throw new Error(label + " returned no process result");
    debugVerbose("backend exec done stage=" + label + " status=" + result.status + " elapsedMs=" + (Date.now() - execStartedAt) + " stdoutBytes=" + String(result.stdout || "").length + " stderr=" + String(result.stderr || "").slice(0, 600));
    const raw = String(result.stdout || "").trim();
    let parsed = null;
    try {
      parsed = parseBackendJsonOutput(raw, result.stderr);
    } catch (parseError) {
      if (result.status !== 0) throw backendCommandError(label, args, result, null, parseError);
      throw parseError;
    }
    if (result.status !== 0 || (parsed && parsed.ok === false)) throw backendCommandError(label, args, result, parsed, null);
    return parsed;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}
function filenameFromPath(path) {
  return String(path || "").split(/[\\/]/).filter(Boolean).pop() || "";
}
function titleFromImportResult(importResult, zipPath) {
  const raw = String((importResult && (importResult.title || importResult.name)) || "").trim();
  if (raw) return raw;
  const fromZip = filenameFromPath(zipPath).replace(/\.zip$/i, "").trim();
  return fromZip || "Imported Dictionary";
}
function numericImportField(importResult, snakeName, camelName) {
  const value = importResult && (importResult[snakeName] !== undefined ? importResult[snakeName] : importResult[camelName]);
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function updateManifestAfterImport(importResult, zipPath) {
  if (!importResult) return;
  const title = titleFromImportResult(importResult, zipPath);
  const dictPath = pathJoin(dictRoot(), title);
  const meta = readDictionaryIndexMetadata(dictPath);
  const language = dictionaryLanguageFromMetadata(meta, {
    language: importResult.language || importResult.lang || importResult.sourceLanguage || importResult.targetLanguage
  });
  let manifest = readManifest();
  const existing = (manifest.dictionaries && manifest.dictionaries[title]) || {};
  manifest.dictionaries[title] = {
    title,
    zipPath: zipPath || "",
    importedAt: existing.importedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    language: language || "unknown",
    termCount: numericImportField(importResult, "term_count", "termCount"),
    metaCount: numericImportField(importResult, "meta_count", "metaCount"),
    tagCount: numericImportField(importResult, "tag_count", "tagCount"),
    mediaCount: numericImportField(importResult, "media_count", "mediaCount"),
    pitchCount: numericImportField(importResult, "pitch_count", "pitchCount"),
    freqCount: numericImportField(importResult, "freq_count", "freqCount")
  };
  manifest = ensureDictionaryInActiveProfileOrder(manifest, title);
  writeManifest(manifest);
}
async function importDictionaryZip(zipPath, existingTaskId) {
  if (!zipPath) return;
  let taskId = existingTaskId || null;
  const ownsTask = !taskId;
  const importArgs = ["import", zipPath, dictRoot(), prefBool("lowRamImport", true) ? "--low-ram" : "--normal-ram"];
  try {
    await ensureBundledBackendInstalled();
    if (!taskId) taskId = startOverlayTask("dictionary-import", "Adding dictionary", "Preparing import...");
    updateOverlayTask(taskId, { title: "Adding dictionary", message: "Importing dictionary...", detail: "Large dictionaries can take several minutes." });
    const started = Date.now();
    const selected = selectedLanguageModule();
    debugLog("dictionary import start language=" + String(selected && selected.id || "") + " zipPath=" + JSON.stringify(String(zipPath || "")) + " zipExists=" + String(file.exists(zipPath)) + " zipFilename=" + JSON.stringify(filenameFromPath(zipPath)) + " args=" + JSON.stringify(importArgs));
    const result = await runBackendJson(importArgs, Math.max(30000, prefNumber("importTimeoutMs", 1800000)), "Dictionary import command");
    if (!result || !result.ok) {
      const error = new Error((result && result.error) || "Import failed");
      error.importStage = "backend-import";
      throw error;
    }
    updateOverlayTask(taskId, { title: "Adding dictionary", message: "Saving dictionary list...", detail: "Refreshing installed dictionaries." });
    try {
      updateManifestAfterImport(result, zipPath);
    } catch (error) {
      error.importStage = "manifest-update";
      throw error;
    }
    activeWorkerFingerprint = null;
    updateOverlayTask(taskId, { title: "Adding dictionary", message: "Refreshing lookup worker...", detail: "The new dictionary will be available for hover popups." });
    try {
      await stopBackendWorker();
    } catch (error) {
      debugWarn("dictionary imported but worker refresh failed: " + compactError(error));
      setOverlayStatus("Dictionary imported, but worker restart failed. Restart iinatan or use Debug -> Restart Dictionary Lookup.", "error", 12000);
    }
    rebuildMenu();
    if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
    const elapsed = Math.round((Date.now() - started) / 1000);
    const msg = "Added " + titleFromImportResult(result, zipPath) + " (" + numericImportField(result, "term_count", "termCount") + " terms).";
    if (ownsTask) finishOverlayTask(taskId, true, msg, "Import took about " + elapsed + " seconds.");
    else updateOverlayTask(taskId, { title: "Adding dictionary", message: msg, detail: "Import took about " + elapsed + " seconds." });
    debugLog("dictionary import complete title=" + JSON.stringify(titleFromImportResult(result, zipPath)) + " language=" + String((readManifest().dictionaries[titleFromImportResult(result, zipPath)] || {}).language || "unknown") + " elapsedSec=" + elapsed);
    return result;
  } catch (error) {
    const stage = error && (error.importStage || error.backendStage) ? String(error.importStage || error.backendStage) : "unknown";
    debugError("dictionary import failed stage=" + stage +
      " selectedLanguage=" + String((selectedLanguageModule() || {}).id || "") +
      " zipPath=" + JSON.stringify(String(zipPath || "")) +
      " zipExists=" + String(zipPath ? file.exists(zipPath) : false) +
      " zipFilename=" + JSON.stringify(filenameFromPath(zipPath)) +
      " args=" + JSON.stringify(importArgs) +
      " backendExit=" + String(error && error.backendStatus !== undefined ? error.backendStatus : "") +
      " stdoutPrefix=" + JSON.stringify(String((error && error.backendStdoutPrefix) || "").slice(0, 500)) +
      " stdoutSuffix=" + JSON.stringify(String((error && error.backendStdoutSuffix) || "").slice(0, 500)) +
      " stderrPrefix=" + JSON.stringify(String((error && error.backendStderrPrefix) || "").slice(0, 500)) +
      " stderrSuffix=" + JSON.stringify(String((error && error.backendStderrSuffix) || "").slice(0, 500)) +
      " parsedJson=" + JSON.stringify((error && error.backendParsedJson) || null) +
      " postImportLookupAttempted=false" +
      " error=" + compactError(error));
    const userStage = stage === "manifest-update" ? "Manifest update failed." :
      String(stage).indexOf("Dictionary import command") >= 0 || stage === "backend-import" ? "Backend import command failed." :
      "Dictionary import failed.";
    if (ownsTask) finishOverlayTask(taskId, false, "Could not add dictionary.", userStage + " " + compactError(error));
    throw error;
  }
}
async function chooseAndImportDictionary() {
  debugLog("manual dictionary import menu clicked");
  try {
    const zipPaths = await chooseDictionaryZipPaths();
    if (!zipPaths.length) {
      notify("Dictionary import cancelled.", "info", 3500);
      return;
    }
    await validateAndImportDictionaryZips(zipPaths, "manual-picker");
  } catch (error) {
    const msg = "Could not add dictionary: " + compactError(error);
    debugError("manual dictionary import failed: " + compactError(error));
    setOverlayStatus(msg, "error", 12000);
    alert(msg);
  }
}

function normalizeChosenFilePaths(value) {
  if (Array.isArray(value)) return value.map(item => String(item || "").trim()).filter(Boolean);
  const s = String(value || "").trim();
  if (!s) return [];
  if (s.charAt(0) === "[") {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(item => String(item || "").trim()).filter(Boolean);
    } catch (_) {}
  }
  if (s.indexOf("\n") >= 0) return s.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  return [s];
}
function isFilePickerCancelError(error) {
  const msg = String(compactError(error) || "").toLowerCase();
  return /cancel|cancelled|canceled|user abort|user-abort|user declined/.test(msg);
}

async function chooseDictionaryZipPaths() {
  if (!utils || typeof utils.chooseFile !== "function") {
    throw new Error("This IINA build does not expose utils.chooseFile.");
  }
  const options = {
    allowedFileTypes: ["zip"],
    allowsMultipleSelection: true,
    allowMultipleSelection: true,
    multiple: true
  };
  debugLog("manual dictionary import: opening file chooser with zip filter and multi-select");
  try {
    const selected = await resolveMaybePromise(utils.chooseFile("Choose Yomitan dictionary ZIPs", options));
    const paths = normalizeChosenFilePaths(selected);
    debugLog("manual dictionary import: filtered chooser returned count=" + paths.length + " sample=" + JSON.stringify(paths.slice(0, 5)));
    return paths;
  } catch (error) {
    if (isFilePickerCancelError(error)) {
      debugLog("manual dictionary import: filtered chooser cancelled");
      return [];
    }
    debugWarn("manual dictionary import chooser with zip filter failed: " + compactError(error));
  }

  debugLog("manual dictionary import: opening fallback unfiltered file chooser");
  try {
    const selected = await resolveMaybePromise(utils.chooseFile("Choose Yomitan dictionary ZIPs", { allowsMultipleSelection: true, allowMultipleSelection: true, multiple: true }));
    const paths = normalizeChosenFilePaths(selected);
    debugLog("manual dictionary import: unfiltered chooser returned count=" + paths.length + " sample=" + JSON.stringify(paths.slice(0, 5)));
    return paths;
  } catch (error) {
    if (isFilePickerCancelError(error)) {
      debugLog("manual dictionary import: unfiltered chooser cancelled");
      return [];
    }
    throw new Error("IINA file picker failed: " + compactError(error));
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

async function validateAndImportDictionaryZips(zipPaths, source) {
  const paths = normalizeChosenFilePaths(zipPaths);
  const label = String(source || "manual-picker");
  if (!paths.length) {
    notify("Dictionary import cancelled.", "info", 3500);
    return [];
  }
  const imported = [];
  for (let i = 0; i < paths.length; i++) {
    const result = await validateAndImportDictionaryZip(paths[i], label + "-" + String(i + 1));
    if (result) imported.push(result);
  }
  if (imported.length > 1) notify("Imported " + imported.length + " dictionaries.", "info", 6500);
  return imported;
}

async function testFilePickerApiFromMenu() {
  debugLog("debug file picker test clicked");
  const selected = await chooseDictionaryZipPaths();
  if (!selected.length) {
    debugLog("debug file picker test cancelled");
    alert("File picker test cancelled.");
    return;
  }
  const invalid = selected.map(p => dictionaryZipValidation(p, candidate => file.exists(candidate))).filter(result => !result.ok);
  debugLog("debug file picker test selected=" + JSON.stringify(selected.slice(0, 12)) + " invalid=" + JSON.stringify(invalid));
  if (!invalid.length) alert("File picker returned " + selected.length + " valid ZIP" + (selected.length === 1 ? "" : "s") + ".");
  else alert("File picker returned invalid path(s): " + invalid.map(result => result.message).join("; "));
}
async function getRecommendedDictionaries(id) {
  const requestedId = id ? String(id) : "jitendex-ja-en";
  const item = recommendedDictionaryById(requestedId);
  if (!item) throw new Error("Unknown recommended dictionary: " + requestedId);
  const title = item.title || "Recommended dictionary";
  const downloadUrl = item.downloadUrl || "";
  if (!downloadUrl) throw new Error("Recommended dictionary has no download URL: " + title);
  let taskId = null;
  try {
    await ensureDataDirs();
    const previousMatches = recommendedDictionaryInstalledMatches(item, dictionaryDirs());
    taskId = startOverlayTask("recommended-dictionary", "Downloading " + title, "Downloading dictionary...");
    const dest = pathJoin(downloadRoot(), item.filename || (item.id + ".zip"));
    updateOverlayTask(taskId, { title: "Downloading " + title, message: "Downloading " + title + "...", detail: downloadUrl });
    await http.download(downloadUrl, dest);
    updateOverlayTask(taskId, { title: "Downloading " + title, message: "Download complete. Importing...", detail: dest });
    const result = await importDictionaryZip(dest, taskId);
    const importedTitle = titleFromImportResult(result, dest);
    const replaced = await replaceRecommendedDictionaryMatches(item, importedTitle, previousMatches);
    const msg = (replaced.length ? "Updated " : "Added ") + importedTitle + " (" + (result.term_count || 0) + " terms).";
    finishOverlayTask(taskId, true, msg, "The dictionary is now available for lookup popups.");
    return result;
  } catch (error) {
    const msg = "Could not download " + title + ".";
    finishOverlayTask(taskId, false, msg, compactError(error));
    throw error;
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
function writeWorkerConfig(dicts, fingerprint, language) {
  const lines = [
    "version\t" + VERSION,
    "fingerprint\t" + String(fingerprint || ""),
    "language\t" + String((language && language.id) || ""),
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
  activeWorkerReady = null;
  await sleep(120);
}
async function startBackendWorkerProcess(dicts, language) {
  await ensureBundledBackendInstalled();
  await ensureDataDirs();
  await clearDirFiles(workerQueueDir());
  await clearDirFiles(workerResponseDir());
  safeDelete(workerStopPath());
  safeDelete(workerReadyPath());
  activeWorkerReady = null;
  const lang = language || selectedLanguageModule();
  const fingerprint = workerFingerprint(dicts, lang);
  debugLog("start backend worker language=" + lang.id + " dictCount=" + (dicts || []).length + " fingerprint=" + fingerprint);
  writeWorkerConfig(dicts, fingerprint, lang);
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
      activeWorkerReady = ready;
      setOverlayStatus("Dictionary lookup ready.", "info", 2500);
      return ready;
    }
    if (ready && (!last || ready.fingerprint !== last.fingerprint)) {
      debugWarn("worker ready fingerprint mismatch expected=" + JSON.stringify(String(fingerprint || "")) + " actual=" + JSON.stringify(String(ready.fingerprint || "")) + " ready=" + JSON.stringify(ready));
    }
    last = ready;
    await sleep(180);
  }
  let logHint = "";
  try { if (file.exists(workerLogPath())) logHint = " Worker log: " + String(file.read(workerLogPath()) || "").slice(-1400); } catch (_) {}
  const lastState = last ? " Last ready state: " + JSON.stringify(last) : "";
  const mismatch = last && last.fingerprint !== fingerprint ? " Expected fingerprint: " + fingerprint : "";
  throw new Error("Dictionary lookup did not become ready." + lastState + mismatch + logHint);
}
async function ensureBackendWorker(dicts, language) {
  const lang = language || selectedLanguageModule();
  dicts = dicts || activeDictionaryPaths(lang);
  const setupMessage = dictionarySetupMessage(lang, dicts);
  if (setupMessage) throw new Error(setupMessage);
  const advisory = dictionaryCompatibilityWarning(lang, activeDictionaryEntries(lang));
  if (advisory) {
    debugWarn(advisory);
    setOverlayStatus(advisory, "info", 7000);
  }
  const fingerprint = workerFingerprint(dicts, lang);
  debugVerbose("ensureBackendWorker language=" + lang.id + " dictCount=" + dicts.length + " activeFingerprintMatches=" + String(activeWorkerFingerprint === fingerprint));
  if (activeWorkerFingerprint === fingerprint && activeWorkerReady) return activeWorkerReady;
  if (workerStartInFlight) return workerStartInFlight;
  workerStartInFlight = (async () => {
    await stopBackendWorker().catch(() => {});
    setOverlayStatus("Preparing dictionary lookup...", "info", 4000);
    await startBackendWorkerProcess(dicts, lang);
    return await waitForWorkerReady(fingerprint, Math.max(8000, prefNumber("backendTimeoutMs", 30000)));
  })();
  try { return await workerStartInFlight; }
  finally { workerStartInFlight = null; }
}
async function clearPendingWorkerRequests() { await clearDirFiles(workerQueueDir()); }

function makeJsWorkerRequestId() {
  return "j" + String(Date.now()) + "-" + String(++requestSerial) + "-" + String(Math.floor(Math.random() * 1000000));
}
async function runWorkerQueueLookupDirect(suffix, dicts, scanLength, maxResults, requestId, timeoutMs, backendMode, maxGlossaries, language) {
  const ensureStartedAt = Date.now();
  await ensureBackendWorker(dicts, language);
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
      debugVerbose("direct worker lookup done requestId=" + String(requestId || "") + " workerRequestId=" + id + " elapsedMs=" + (Date.now() - startedAt) + " stdoutBytes=" + raw.length + " resultCount=" + (parsed && parsed.results ? parsed.results.length : "n/a"));
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
async function runWorkerLookupViaClientExec(suffix, dicts, scanLength, maxResults, requestId, timeout, backendMode, maxGlossaries, language) {
  await ensureBackendWorker(dicts, language);
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
  const result = await runBackendJson(clientArgs, timeout + 2500, "Dictionary lookup command");
  debugVerbose("client exec lookup result requestId=" + String(requestId || "") + " elapsedMs=" + (Date.now() - lookupStartedAt) + " resultCount=" + (result && result.results ? result.results.length : "n/a"));
  return result;
}
async function lookupViaWorker(suffix, dicts, scanLength, maxResults, requestId, backendMode, maxGlossaries, language) {
  const lang = language || selectedLanguageModule();
  debugVerbose("lookupViaWorker begin requestId=" + String(requestId || "") + " language=" + lang.id + " suffix=" + JSON.stringify(String(suffix || "").slice(0, 80)) + " dicts=" + dicts.length + " mode=" + String(backendMode || "yomitan-japanese") + " directIpc=" + String(prefBool("directWorkerIpc", true)));
  const timeout = Math.max(1500, prefNumber("lookupTimeoutMs", 9000));

  if (prefBool("directWorkerIpc", true)) {
    try {
      const result = await runWorkerQueueLookupDirect(suffix, dicts, scanLength, maxResults, requestId, timeout, backendMode, maxGlossaries, lang);
      return result;
    } catch (error) {
      debugWarn("direct worker lookup failed requestId=" + String(requestId || "") + ": " + compactError(error));
      if (!prefBool("fallbackToClientExec", true)) throw error;
    }
  }

  const result = await runWorkerLookupViaClientExec(suffix, dicts, scanLength, maxResults, requestId, timeout, backendMode, maxGlossaries, lang);
  if (!result || result.ok === false) throw new Error((result && result.error) || "Worker client lookup failed");
  return result;
}
function glossaryTagsIndicateNonLemma(glossary) {
  const tags = String((glossary && glossary.definitionTags) || "") + " " + String((glossary && glossary.termTags) || "");
  return /\bnon[-\s]?lemma\b/i.test(tags);
}
function lookupResultIsOnlyNonLemma(result) {
  const results = result && Array.isArray(result.results) ? result.results : [];
  if (!results.length) return false;
  let glossaryCount = 0;
  for (let i = 0; i < results.length; i++) {
    const glossaries = results[i] && results[i].term && Array.isArray(results[i].term.glossaries)
      ? results[i].term.glossaries
      : [];
    if (!glossaries.length) return false;
    for (let g = 0; g < glossaries.length; g++) {
      glossaryCount++;
      if (!glossaryTagsIndicateNonLemma(glossaries[g])) return false;
    }
  }
  return glossaryCount > 0;
}
function compactLookupText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}
function parseLookupGlossaryJson(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || (text[0] !== "[" && text[0] !== "{")) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}
function nonLemmaLemmaCandidates(result, alreadyTried, limit) {
  const out = [];
  const seen = Object.create(null);
  const max = Math.max(1, Number(limit) || 4);
  const results = result && Array.isArray(result.results) ? result.results : [];
  for (let i = 0; i < results.length && out.length < max; i++) {
    const glossaries = results[i] && results[i].term && Array.isArray(results[i].term.glossaries)
      ? results[i].term.glossaries
      : [];
    for (let g = 0; g < glossaries.length && out.length < max; g++) {
      const glossary = glossaries[g];
      if (!glossaryTagsIndicateNonLemma(glossary)) continue;
      const parsed = parseLookupGlossaryJson(glossary.glossary);
      if (!Array.isArray(parsed)) continue;
      for (let r = 0; r < parsed.length && out.length < max; r++) {
        const row = parsed[r];
        if (!Array.isArray(row) || row.length < 1) continue;
        const lemma = compactLookupText(row[0]);
        if (!lemma || seen[lemma] || (alreadyTried && alreadyTried[lemma])) continue;
        seen[lemma] = true;
        out.push({
          text: lemma,
          source: "non-lemma-reference",
          reason: "form-of lemma",
          displayText: lemma
        });
      }
    }
  }
  return out;
}
function lookupEntryKey(entry) {
  const term = entry && entry.term ? entry.term : {};
  const glossaries = Array.isArray(term.glossaries) ? term.glossaries : [];
  return [
    entry && entry.matched,
    entry && entry.deinflected,
    term.expression,
    term.reading,
    term.rules,
    glossaries.map(g => [
      g && g.dict,
      g && g.definitionTags,
      g && g.termTags,
      g && g.glossary
    ].join("\u0002")).join("\u0003")
  ].map(v => String(v || "")).join("\u0001");
}
function appendLookupResultEntries(target, seen, candidateResult, limit) {
  const entries = candidateResult && Array.isArray(candidateResult.results) ? candidateResult.results : [];
  const max = Math.max(1, Number(limit) || 1);
  for (let i = 0; i < entries.length && target.length < max; i++) {
    const key = lookupEntryKey(entries[i]);
    if (seen[key]) continue;
    seen[key] = true;
    target.push(entries[i]);
  }
  return target.length;
}
async function lookupAtPosition(text, position, requestId) {
  const language = selectedLanguageModule();
  const clean = language.normalizeText(cleanSubtitleText(text));
  const chars = charsOf(clean);
  const pos = Math.max(0, Math.min(Number(position) || 0, chars.length));
  const scanLength = Math.max(1, prefNumber("scanLength", 24));
  const request = language.lookupRequest(clean, pos, scanLength);
  debugVerbose("lookupAtPosition request language=" + language.id + " pos=" + pos + " request=" + JSON.stringify(request || {}));
  if (language.id === "fr") debugVerbose("French deinflection rule loading upstreamRules=" + String(language.upstreamRuleCount || "unknown") + " mode=" + String(language.deinflectionMode || language.deinflection || ""));
  if (language.id === "de") debugVerbose("German deinflection rule loading mode=" + String(language.deinflectionMode || language.deinflection || ""));
  if (language.id === "zh") debugVerbose("Chinese parser/preprocessor selection mode=" + String((request && request.backendMode) || language.lookupMode || "") + " scanLength=" + String((request && request.scanLength) || scanLength));
  if (!request || !request.lookupText) {
    const suffix = chars.slice(pos).join("");
    return { ok: true, text: clean, position: pos, suffix, language: language.id, results: [] };
  }
  const dicts = activeDictionaryPaths(language);
  const setupMessage = dictionarySetupMessage(language, dicts);
  if (setupMessage) throw new Error(setupMessage);
  const maxResults = Math.max(1, prefNumber("maxEntries", 3));
  const maxGlossaries = Math.max(1, prefNumber("maxGlossesPerEntry", 4));
  const candidates = Array.isArray(request.candidates) && request.candidates.length
    ? request.candidates.filter(c => c && c.text).map(c => Object.assign({}, c, { text: String(c.text || "") }))
    : [{ text: request.lookupText, source: "lookupText", reason: "single lookup text", language: language.id, displayText: request.displayText }];
  const lookupText = candidates[0] && candidates[0].text;
  const effectiveScanLength = Math.max(1, Number(request.scanLength) || scanLength);
  const backendMode = request.backendMode || language.backendMode || "yomitan-japanese";
  const languageCacheKey = request.cacheKey || [
    request.cacheStrategy || "",
    request.lookupStart,
    request.lookupEnd,
    candidates.map(c => c.text).join("|")
  ].join(":");
  const key = [
    dicts.join("|"),
    language.id,
    backendMode,
    clean,
    languageCacheKey,
    effectiveScanLength,
    maxResults,
    maxGlossaries
  ].join("\n");
  if (lookupCache[key]) {
    debugVerbose("lookupAtPosition cache hit lang=" + language.id + " pos=" + pos + " lookupText=" + JSON.stringify(lookupText) + " noResult=" + String(!!lookupCache[key].noResult) + " cacheKey=" + JSON.stringify(languageCacheKey));
    return lookupCache[key];
  }
  debugVerbose("lookupAtPosition cache miss lang=" + language.id + " mode=" + backendMode + " pos=" + pos + " candidateCount=" + candidates.length + " cacheKey=" + JSON.stringify(languageCacheKey) + " candidates=" + JSON.stringify(candidates.map(c => ({ text: c.text, source: c.source, reason: c.reason })).slice(0, 24)));
  let result = null;
  let candidateUsed = null;
  const mergedEntries = [];
  const seenEntryKeys = Object.create(null);
  const triedLookupTexts = Object.create(null);
  let nonLemmaFallbackResult = null;
  let nonLemmaFallbackCandidate = null;
  async function followNonLemmaLemmaReferences(nonLemmaResult) {
    const lemmaCandidates = nonLemmaLemmaCandidates(nonLemmaResult, triedLookupTexts, maxResults);
    for (let i = 0; i < lemmaCandidates.length && mergedEntries.length < maxResults; i++) {
      const candidate = lemmaCandidates[i];
      triedLookupTexts[candidate.text] = true;
      const candidateScanLength = Math.max(1, charsOf(candidate.text).length || effectiveScanLength);
      debugVerbose("lookupAtPosition non-lemma lemma candidate language=" + language.id + " index=" + i + " text=" + JSON.stringify(candidate.text));
      const candidateResult = await lookupViaWorker(candidate.text, dicts, candidateScanLength, maxResults, requestId, backendMode, maxGlossaries, language);
      debugVerbose("lookupAtPosition non-lemma lemma result language=" + language.id + " index=" + i + " resultCount=" + (candidateResult && candidateResult.results ? candidateResult.results.length : 0));
      if (!candidateResult || !candidateResult.results || !candidateResult.results.length || lookupResultIsOnlyNonLemma(candidateResult)) continue;
      if (!candidateUsed) {
        result = Object.assign({}, candidateResult, { results: mergedEntries });
        candidateUsed = candidate;
      }
      appendLookupResultEntries(mergedEntries, seenEntryKeys, candidateResult, maxResults);
    }
  }
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    triedLookupTexts[candidate.text] = true;
    const candidateScanLength = Math.max(1, Number(candidate.scanLength) || charsOf(candidate.text).length || effectiveScanLength);
    debugVerbose("lookupAtPosition candidate language=" + language.id + " index=" + i + " text=" + JSON.stringify(candidate.text) + " source=" + String(candidate.source || "") + " reason=" + String(candidate.reason || ""));
    const candidateResult = await lookupViaWorker(candidate.text, dicts, candidateScanLength, maxResults, requestId, backendMode, maxGlossaries, language);
    debugVerbose("lookupAtPosition candidate result language=" + language.id + " index=" + i + " resultCount=" + (candidateResult && candidateResult.results ? candidateResult.results.length : 0));
    if (!result) result = candidateResult;
    if (candidateResult && candidateResult.results && candidateResult.results.length) {
      if (lookupResultIsOnlyNonLemma(candidateResult)) {
        if (!nonLemmaFallbackResult) {
          nonLemmaFallbackResult = candidateResult;
          nonLemmaFallbackCandidate = candidate;
        }
        debugVerbose("lookupAtPosition candidate non-lemma-only language=" + language.id + " text=" + JSON.stringify(candidate.text) + " continuing=true");
        await followNonLemmaLemmaReferences(candidateResult);
        if (mergedEntries.length >= maxResults) break;
        continue;
      }
      if (!candidateUsed) {
        result = Object.assign({}, candidateResult, { results: mergedEntries });
        candidateUsed = candidate;
      }
      appendLookupResultEntries(mergedEntries, seenEntryKeys, candidateResult, maxResults);
      debugVerbose("lookupAtPosition candidate matched language=" + language.id + " text=" + JSON.stringify(candidate.text) + " mergedResultCount=" + mergedEntries.length);
      if (mergedEntries.length >= maxResults) break;
    }
  }
  if (!candidateUsed && nonLemmaFallbackResult) {
    await followNonLemmaLemmaReferences(nonLemmaFallbackResult);
  }
  if (candidateUsed) {
    result.results = mergedEntries;
  } else if (nonLemmaFallbackResult) {
    result = nonLemmaFallbackResult;
    candidateUsed = nonLemmaFallbackCandidate;
    debugVerbose("lookupAtPosition using non-lemma fallback language=" + language.id + " text=" + JSON.stringify(candidateUsed && candidateUsed.text || ""));
  }
  if (!result) result = { ok: true, results: [] };
  if (!candidateUsed) debugVerbose("lookupAtPosition no-result terminal language=" + language.id + " candidateCount=" + candidates.length + " reason=all-candidates-empty cacheKey=" + JSON.stringify(languageCacheKey) + " stopScanning=true candidates=" + candidates.map(c => c.text).join(", "));
  result.text = clean;
  result.position = pos;
  result.suffix = request.suffix;
  result.lookupText = candidateUsed ? candidateUsed.text : lookupText;
  result.lookupCandidates = candidates;
  result.candidateUsed = candidateUsed;
  result.lookupStart = request.lookupStart;
  result.lookupEnd = request.lookupEnd;
  result.matchStart = request.matchStart;
  result.language = language.id;
  result.backendMode = backendMode;
  result.noResult = !candidateUsed && !(result.results && result.results.length);
  result.noResultReason = result.noResult ? "all-candidates-empty" : "";
  result.lookupCacheKey = languageCacheKey;
  lookupCache[key] = result;
  if (result.noResult) debugVerbose("lookupAtPosition cached no-result language=" + language.id + " cacheKey=" + JSON.stringify(languageCacheKey));
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
  debugVerbose("lookup-at received requestId=" + requestId + " pos=" + position + " textLen=" + String(text || "").length + " payloadType=" + typeof payload);
  postToOverlay("config", overlayConfig());
  postToOverlay("lookup-ack", { requestId, message: "Plugin received hover request." });
  postToOverlay("lookup-status", { requestId, message: "Plugin received hover request." });
  const inflightKey = cleanSubtitleText(text) + "\n" + position;
  try {
    if (!lookupInFlight[inflightKey]) lookupInFlight[inflightKey] = lookupAtPosition(text, position, requestId).finally(() => { delete lookupInFlight[inflightKey]; });
    const result = await lookupInFlight[inflightKey];
    debugVerbose("lookup success requestId=" + requestId + " resultCount=" + (result && result.results ? result.results.length : 0));
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
	        debugVerbose("overlay bridge message=" + raw.slice(0, 200));
	        let payload = raw;
	        try { payload = JSON.parse(raw); } catch (_) {}
	        if (payload && typeof payload === "object" && payload.type === "popup") {
	          handleLookupPopupVisibility(payload);
	        } else if (payload && typeof payload === "object" && payload.type === "lookup") {
	          handleBridgeLookup(payload);
	        } else if (payload && typeof payload === "object" && payload.type === "audio-source") {
	          handleBridgeAudioSource(payload);
	        } else if (payload && typeof payload === "object" && payload.type === "anki-card-status") {
	          handleBridgeAnkiCardStatus(payload);
	        } else if (payload && typeof payload === "object" && payload.type === "anki-card-add") {
	          handleBridgeAnkiCardAdd(payload);
	        } else if (payload && typeof payload === "object" && payload.type === "anki-card-open") {
	          handleBridgeAnkiCardOpen(payload);
	        } else if (payload && typeof payload === "object" && payload.type === "open-url") {
	          openExternalUrlFromOverlay(payload.url);
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

	function fallbackResolveAudioCandidateUrl(value, baseUrl) {
	  if (/^https?:\/\/[^\s<>"']+$/i.test(value)) return value;
	  if (/[\s<>"']/.test(value)) return "";
	  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return "";
	  const base = String(baseUrl || "").trim();
	  const baseMatch = /^(https?:)\/\/([^\/?#]+)(\/[^?#]*)?/i.exec(base);
	  if (!baseMatch) return "";
	  if (/^\/\//.test(value)) return baseMatch[1] + value;
	  const origin = baseMatch[1] + "//" + baseMatch[2];
	  if (value.charAt(0) === "/") return origin + value;
	  const basePath = baseMatch[3] || "/";
	  const baseDir = basePath.charAt(basePath.length - 1) === "/" ? basePath : basePath.slice(0, basePath.lastIndexOf("/") + 1) || "/";
	  return origin + baseDir + value;
	}
	function safeAudioCandidateUrl(rawUrl, baseUrl) {
	  const value = String(rawUrl || "").trim();
	  if (!value) return "";
	  try {
	    if (typeof URL === "function") {
	      const parsed = new URL(value, baseUrl || undefined);
	      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
	      return "";
	    }
	  } catch (_) {
	    return "";
	  }
	  return fallbackResolveAudioCandidateUrl(value, baseUrl);
	}
	function audioCandidatesFromSourceJson(rawJson, sourceUrl) {
	  let parsed = null;
	  try { parsed = JSON.parse(String(rawJson || "")); } catch (error) {
	    throw new Error("Audio source did not return JSON: " + compactError(error));
	  }
	  if (!parsed || parsed.type !== "audioSourceList" || !Array.isArray(parsed.audioSources)) {
	    throw new Error("Audio source JSON was not a Yomitan audioSourceList.");
	  }
	  const out = [];
	  parsed.audioSources.forEach(item => {
	    const url = safeAudioCandidateUrl(item && item.url, sourceUrl);
	    if (!url) return;
	    const name = String((item && item.name) || "").trim();
	    out.push(name ? { name, url } : { url });
	  });
	  return out;
	}
	async function fetchAudioSourceCandidates(sourceUrl) {
	  const url = safeExternalHttpUrl(sourceUrl);
	  if (!url) throw new Error("Invalid audio source URL.");
	  const result = await utils.exec("/usr/bin/curl", [
	    "--silent",
	    "--show-error",
	    "--location",
	    "--max-time",
	    "8",
	    url
	  ], dataRoot());
	  if (!result || result.status !== 0) {
	    throw new Error("Audio source request failed: " + String((result && (result.stderr || result.stdout)) || "curl failed").slice(0, 500));
	  }
	  return audioCandidatesFromSourceJson(result.stdout, url);
	}
	function handleBridgeAudioSource(payload) {
	  const requestId = payload && payload.requestId !== undefined ? String(payload.requestId) : "";
	  const sourceUrl = String((payload && payload.url) || "");
	  (async () => {
	    try {
	      const candidates = await fetchAudioSourceCandidates(sourceUrl);
	      debugVerbose("audio source resolved requestId=" + requestId + " url=" + JSON.stringify(sourceUrl) + " candidates=" + candidates.length);
	      postToOverlay("audio-source-result", { requestId, ok: true, candidates });
	    } catch (error) {
	      const msg = compactError(error);
	      debugWarn("audio source request failed requestId=" + requestId + " url=" + JSON.stringify(sourceUrl) + ": " + msg);
	      postToOverlay("audio-source-result", { requestId, ok: false, error: msg });
	    }
	  })();
	}

	function safeExternalHttpUrl(rawUrl) {
	  const value = String(rawUrl || "").trim();
	  if (!/^https?:\/\//i.test(value)) return "";
	  try {
	    if (typeof URL === "function") {
	      const parsed = new URL(value);
	      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
	      return "";
	    }
	  } catch (_) {
	    return "";
	  }
	  return /^[^\s<>"']+$/.test(value) ? value : "";
	}
	function openExternalUrlFromOverlay(rawUrl) {
	  const url = safeExternalHttpUrl(rawUrl);
	  if (!url) {
	    debugWarn("Rejected unsafe external URL from overlay: " + JSON.stringify(String(rawUrl || "").slice(0, 180)));
	    return false;
	  }
	  try {
	    debugLog("Opening external dictionary URL: " + url);
	    utils.open(url);
	    return true;
	  } catch (error) {
	    const message = "Could not open external dictionary URL: " + compactError(error);
	    debugWarn(message + " url=" + JSON.stringify(url));
	    notify(message, "error", 8000);
	    return false;
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
  debugVerbose("hover lookup queued requestId=" + requestId + " key=" + key + " currentLineId=" + currentSubtitleLineId + " inFlight=" + hoverLookupInFlight + " activeKey=" + hoverLookupActiveKey);
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
          debugVerbose("hover lookup start requestId=" + requestId + " key=" + key + " pendingNext=" + String(!!pendingHoverLookup));
          const hoverStartedAt = Date.now();
          const result = await lookupAtPosition(lastSubtitle || "", position, requestId);
          debugVerbose("hover lookup completed requestId=" + requestId + " key=" + key + " elapsedMs=" + (Date.now() - hoverStartedAt));
          if (!enabled || lineId !== currentSubtitleLineId) {
            hoverLookupActiveKey = "";
            continue;
          }
          postToOverlay("line-lookup-result", { lineId, position, ok: true, result, hover: true, requestId, seq });
          debugVerbose("hover lookup result requestId=" + requestId + " key=" + key + " count=" + (result && result.results ? result.results.length : 0));
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
  try { mpv.set("pause", !!paused); return true; } catch (_) {}
  try { if (paused) core.pause(); else core.resume(); return true; } catch (_) {}
  return false;
}
function clearLookupPopupWatchdog() {
  if (lookupPopupWatchdogTimer !== null) {
    clearTimeout(lookupPopupWatchdogTimer);
    lookupPopupWatchdogTimer = null;
  }
}
function cancelLookupPopupResumeTimer() {
  lookupPopupPauseResumeToken++;
  if (lookupPopupPauseResumeTimer !== null) {
    clearTimeout(lookupPopupPauseResumeTimer);
    lookupPopupPauseResumeTimer = null;
  }
}
function scheduleLookupPopupResume(reason) {
  cancelLookupPopupResumeTimer();
  const token = ++lookupPopupPauseResumeToken;
  lookupPopupPauseResumeTimer = setTimeout(() => {
    if (token !== lookupPopupPauseResumeToken) return;
    lookupPopupPauseResumeTimer = null;
    if (!lookupPopupPauseShouldResume) return;
    if (lookupPopupPauseActive) {
      debugVerbose("lookup popup resume skipped reason=" + String(reason || "unknown") + "; popup visible again");
      return;
    }
    lookupPopupPauseShouldResume = false;
    if (!enabled) {
      debugVerbose("lookup popup resume skipped reason=" + String(reason || "unknown") + "; plugin disabled");
      return;
    }
    if (!pauseState()) {
      debugVerbose("lookup popup resume skipped reason=" + String(reason || "unknown") + "; playback already running");
      return;
    }
    if (setPauseState(false)) {
      debugLog("lookup popup hidden reason=" + String(reason || "unknown") + "; resuming playback");
    } else {
      debugWarn("lookup popup hidden reason=" + String(reason || "unknown") + "; could not resume playback");
    }
  }, LOOKUP_POPUP_RESUME_DELAY_MS);
  debugVerbose("lookup popup hidden reason=" + String(reason || "unknown") + "; resume scheduled");
}
function finishLookupPopupPause(reason, options) {
  clearLookupPopupWatchdog();
  const resume = !!(options && options.resume);
  if (!lookupPopupPauseActive && !lookupPopupPauseShouldResume && lookupPopupPauseResumeTimer === null) return;
  lookupPopupPauseActive = false;
  if (resume && lookupPopupPauseShouldResume) {
    scheduleLookupPopupResume(reason);
    return;
  }
  cancelLookupPopupResumeTimer();
  lookupPopupPauseShouldResume = false;
  debugVerbose("lookup popup pause ended reason=" + String(reason || "unknown") + "; resume not owned");
}
function scheduleLookupPopupWatchdog() {
  // Resume is driven by explicit overlay hide events. A heartbeat watchdog would
  // risk resuming during transient bridge delays, so keep this path inactive.
  clearLookupPopupWatchdog();
}
function lookupPopupSessionFromPayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  return String(payload.popupSessionId || payload.sessionId || payload.session || "");
}
function noteLookupPopupSession(sessionId, reason) {
  const nextSessionId = String(sessionId || "");
  if (!nextSessionId) return;
  if (lookupPopupSessionId === nextSessionId) return;
  debugLog(
    "lookup popup overlay session changed " +
    JSON.stringify(lookupPopupSessionId || "none") +
    " -> " +
    JSON.stringify(nextSessionId) +
    " reason=" +
    String(reason || "unknown")
  );
  lookupPopupSessionId = nextSessionId;
  lookupPopupLastSeq = 0;
  finishLookupPopupPause(reason || "overlay-session-change");
}
function handleLookupPopupOverlayReady(payload) {
  noteLookupPopupSession(lookupPopupSessionFromPayload(payload), "overlay-ready");
  lookupPopupLastSeq = 0;
  finishLookupPopupPause("overlay-ready");
}
function lookupPopupPauseEnabled() {
  try {
    return activeProfilePreferenceBool("pauseWhilePopupVisible", true);
  } catch (error) {
    debugWarn("falling back to plugin popup pause preference: " + compactError(error));
    return prefBool("pauseWhilePopupVisible", true);
  }
}
function handleLookupPopupVisibility(payload) {
  const visible = (payload === true) || payload === "show" || payload === "visible" || (payload && !!payload.visible);
  const seq = payload && typeof payload === "object" && payload.seq !== undefined ? Number(payload.seq) : null;
  noteLookupPopupSession(lookupPopupSessionFromPayload(payload), "popup-visibility");
  if (seq !== null && Number.isFinite(seq)) {
    if (seq < lookupPopupLastSeq) {
      debugLog("ignoring stale popup visibility seq=" + seq + " lastSeq=" + lookupPopupLastSeq + " visible=" + String(visible));
      return;
    }
    lookupPopupLastSeq = seq;
  }
  if (!lookupPopupPauseEnabled()) {
    finishLookupPopupPause("preference-disabled");
    debugVerbose("popup visibility ignored because pauseWhilePopupVisible is disabled visible=" + String(visible) + " seq=" + String(seq));
    return;
  }
  debugVerbose("popup visibility event visible=" + String(visible) + " seq=" + String(seq) + " active=" + String(lookupPopupPauseActive) + " enabled=" + String(enabled));
  if (visible) {
    if (!enabled) return;
    cancelLookupPopupResumeTimer();
    lookupPopupLastHeartbeatAt = Date.now();
    if (lookupPopupPauseActive) {
      if (lookupPopupPauseShouldResume && !pauseState()) {
        lookupPopupPauseShouldResume = setPauseState(true);
        debugLog("lookup popup visible seq=" + String(seq) + "; playback was running again, pausing");
      } else {
        debugVerbose("lookup popup visible seq=" + String(seq) + "; preserving active pause ownership=" + String(lookupPopupPauseShouldResume));
      }
      return;
    }
    lookupPopupPauseActive = true;
    if (lookupPopupPauseShouldResume) {
      if (!pauseState()) {
        lookupPopupPauseShouldResume = setPauseState(true);
        debugLog("lookup popup visible seq=" + String(seq) + "; pausing playback after cancelled resume");
      } else {
        debugVerbose("lookup popup visible seq=" + String(seq) + "; cancelled pending resume");
      }
      return;
    }
    if (!pauseState()) {
      lookupPopupPauseShouldResume = setPauseState(true);
      debugLog("lookup popup visible seq=" + String(seq) + "; pausing playback resumeOwned=" + String(lookupPopupPauseShouldResume));
    } else {
      lookupPopupPauseShouldResume = false;
      debugVerbose("lookup popup visible seq=" + String(seq) + "; playback already paused");
    }
    return;
  }
  debugVerbose("popup hidden received seq=" + String(seq));
  finishLookupPopupPause("hidden-seq-" + String(seq), { resume: true });
}
function resetLookupPopupPause() {
  cancelLookupPopupResumeTimer();
  clearLookupPopupWatchdog();
  lookupPopupPauseActive = false;
  lookupPopupPauseShouldResume = false;
  lookupPopupLastHeartbeatAt = 0;
  lookupPopupLastSeq = 0;
  lookupPopupSessionId = "";
}

let ankiManagerStateCache = null;
let ankiManagerRefreshInFlight = false;
let ankiManagerRefreshSerial = 0;
let ankiModelFieldCache = Object.create(null);

const ANKI_CONNECT_VERSION = 6;
const ANKI_MEDIA_MAX_AUDIO_SECONDS = 35;

function ankiActiveProfilePreferences(overrides) {
  const manifest = readManifest();
  const profile = activeDictionaryProfile(manifest);
  return normalizeProfilePreferences(Object.assign({}, profile.preferences || {}, overrides || {}));
}
function ankiFieldTemplatesFromPrefs(prefs) {
  return normalizeAnkiFieldTemplates(prefs && prefs.ankiFieldTemplatesJson);
}
function ankiProfileConfigured(prefs) {
  const templates = ankiFieldTemplatesFromPrefs(prefs || {});
  const hasTemplate = Object.keys(templates).some(field => String(templates[field] || "").trim());
  return !!(prefs && prefs.ankiEnabled && prefs.ankiConnectUrl && prefs.ankiDeckName && prefs.ankiModelName && hasTemplate);
}
function overlayAnkiConfig() {
  const prefs = ankiActiveProfilePreferences();
  return {
    enabled: !!prefs.ankiEnabled,
    configured: ankiProfileConfigured(prefs),
    duplicateCheck: !!prefs.ankiDuplicateCheck,
    duplicateMode: prefs.ankiDuplicateMode,
    duplicateScope: prefs.ankiDuplicateScope,
    deckName: prefs.ankiDeckName,
    modelName: prefs.ankiModelName
  };
}
function dictionaryManagerAnkiState(profilePreferences) {
  const prefs = normalizeProfilePreferences(profilePreferences || ankiActiveProfilePreferences());
  const cached = ankiManagerStateCache || {};
  const fields = Array.isArray(cached.fields) && cached.modelName === prefs.ankiModelName ? cached.fields.slice() : [];
  return {
    enabled: !!prefs.ankiEnabled,
    connectUrl: prefs.ankiConnectUrl,
    deckName: prefs.ankiDeckName,
    modelName: prefs.ankiModelName,
    fieldTemplates: ankiFieldTemplatesFromPrefs(prefs),
    tags: prefs.ankiTags,
    audioFormat: prefs.ankiAudioFormat,
    audioBitrateKbps: prefs.ankiAudioBitrateKbps,
    imageQuality: prefs.ankiImageQuality,
    duplicateCheck: !!prefs.ankiDuplicateCheck,
    duplicateMode: prefs.ankiDuplicateMode,
    duplicateScope: prefs.ankiDuplicateScope,
    sentenceAudioPaddingMs: prefs.ankiSentenceAudioPaddingMs,
    lookupLanguage: String(prefs.lookupLanguage || "ja"),
    markers: ankiMarkerDefinitions(String(prefs.lookupLanguage || "ja")),
    reachable: !!cached.reachable,
    checking: !!ankiManagerRefreshInFlight,
    message: cached.message || "AnkiConnect has not been checked yet.",
    checkedAt: cached.checkedAt || 0,
    version: cached.version || null,
    deckNames: Array.isArray(cached.deckNames) ? cached.deckNames.slice() : [],
    modelNames: Array.isArray(cached.modelNames) ? cached.modelNames.slice() : [],
    fields
  };
}
function ankiMarkerDefinitions(language) {
  const lang = String(language || "ja");
  const markers = [
    { marker: "{expression}", label: "Headword" },
    { marker: "{word}", label: "Headword alias" },
    { marker: "{reading}", label: "Reading" },
    { marker: "{furigana}", label: "Headword ruby" },
    { marker: "{furigana-plain}", label: "Furigana text" },
    { marker: "{popup-selection-text}", label: "Looked-up text" },
    { marker: "{sentence}", label: "Subtitle sentence" },
    { marker: "{cloze-prefix}", label: "Cloze before word" },
    { marker: "{cloze-body}", label: "Cloze word" },
    { marker: "{cloze-suffix}", label: "Cloze after word" },
    { marker: "{glossary-first}", label: "First definition" },
    { marker: "{selected-glossary}", label: "Selected definition" },
    { marker: "{glossary}", label: "All definitions" },
    { marker: "{glossary-plain}", label: "Plain definitions" },
    { marker: "{dictionary}", label: "Dictionary" },
    { marker: "{part-of-speech}", label: "Part of speech" },
    { marker: "{tags}", label: "Dictionary tags" },
    { marker: "{frequencies}", label: "Frequency tags" },
    { marker: "{frequency-harmonic-rank}", label: "Frequency rank" },
    { marker: "{phonetic-transcriptions}", label: "Phonetics" },
    { marker: "{document-title}", label: "Video title" },
    { marker: "{source-path}", label: "File path" },
    { marker: "{timestamp}", label: "Timestamp" },
    { marker: "{screenshot}", label: "Video screenshot" },
    { marker: "{image}", label: "Video screenshot alias" },
    { marker: "{sentence-audio}", label: "Subtitle audio" },
    { marker: "{subtitle-audio}", label: "Subtitle audio alias" },
    { marker: "{audio}", label: "Word audio or subtitle audio" }
  ];
  if (lang === "ja") {
    markers.push(
      { marker: "{pitch-accent-positions}", label: "Pitch positions" },
      { marker: "{pitch-accent-categories}", label: "Pitch categories" }
    );
  }
  return markers;
}
function ankiFieldCacheKey(prefs) {
  return String((prefs && prefs.ankiConnectUrl) || "") + "\n" + String((prefs && prefs.ankiModelName) || "");
}
function safeAnkiConnectUrl(rawUrl) {
  const value = normalizeAnkiConnectUrl(rawUrl);
  try {
    if (typeof safeExternalHttpUrl === "function") return safeExternalHttpUrl(value);
  } catch (_) {}
  return /^https?:\/\/[^\s<>"']+$/i.test(value) ? value : "";
}
function ankiRequestPath() {
  return dataPath("anki-connect-request-" + String(Date.now()) + "-" + String(Math.random()).slice(2) + ".json");
}
async function ankiConnectInvoke(action, params, options) {
  const opts = options || {};
  const url = safeAnkiConnectUrl(opts.url || ankiActiveProfilePreferences().ankiConnectUrl);
  if (!url) throw new Error("Invalid AnkiConnect URL.");
  const payload = {
    action: String(action || ""),
    version: ANKI_CONNECT_VERSION,
    params: params || {}
  };
  const requestPath = ankiRequestPath();
  file.write(requestPath, JSON.stringify(payload));
  const timeout = Math.max(1, Math.min(60, Number(opts.timeoutSeconds || 8) || 8));
  let result = null;
  try {
    result = await utils.exec("/usr/bin/curl", [
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      String(timeout),
      "--header",
      "Content-Type: application/json",
      "--data-binary",
      "@" + requestPath,
      url
    ], dataRoot());
  } finally {
    try { await utils.exec("/bin/rm", ["-f", requestPath], dataRoot()); } catch (_) {}
  }
  if (!result || result.status !== 0) {
    throw new Error("AnkiConnect request failed: " + String((result && (result.stderr || result.stdout)) || "curl failed").slice(0, 500));
  }
  let parsed = null;
  try { parsed = JSON.parse(String(result.stdout || "")); } catch (error) {
    throw new Error("AnkiConnect returned invalid JSON: " + compactError(error));
  }
  if (parsed && parsed.error) throw new Error(String(parsed.error));
  return parsed ? parsed.result : null;
}
function postDictionaryManagerAnkiState() {
  try { postToDictionaryManager("dictionary-manager-anki-state", dictionaryManagerAnkiState()); }
  catch (error) { debugWarn("could not build Anki manager state: " + compactError(error)); }
}
function refreshDictionaryManagerAnkiState(overrides) {
  const serial = ++ankiManagerRefreshSerial;
  const prefs = ankiActiveProfilePreferences(overrides || {});
  ankiManagerRefreshInFlight = true;
  ankiManagerStateCache = Object.assign({}, ankiManagerStateCache || {}, {
    reachable: false,
    message: "Checking AnkiConnect...",
    checkedAt: Date.now(),
    modelName: prefs.ankiModelName
  });
  postDictionaryManagerAnkiState();
  (async () => {
    try {
      const invokeOptions = { url: prefs.ankiConnectUrl, timeoutSeconds: 4 };
      const version = await ankiConnectInvoke("version", {}, invokeOptions);
      const deckNames = await ankiConnectInvoke("deckNames", {}, invokeOptions);
      const modelNames = await ankiConnectInvoke("modelNames", {}, invokeOptions);
      let fields = [];
      if (prefs.ankiModelName && Array.isArray(modelNames) && modelNames.indexOf(prefs.ankiModelName) >= 0) {
        fields = await ankiConnectInvoke("modelFieldNames", { modelName: prefs.ankiModelName }, invokeOptions);
      }
      if (serial !== ankiManagerRefreshSerial) return;
      ankiManagerStateCache = {
        reachable: true,
        message: "Reachable.",
        checkedAt: Date.now(),
        version,
        deckNames: Array.isArray(deckNames) ? deckNames : [],
        modelNames: Array.isArray(modelNames) ? modelNames : [],
        fields: Array.isArray(fields) ? fields : [],
        modelName: prefs.ankiModelName
      };
      ankiModelFieldCache[ankiFieldCacheKey(prefs)] = ankiManagerStateCache.fields.slice();
    } catch (error) {
      if (serial !== ankiManagerRefreshSerial) return;
      ankiManagerStateCache = {
        reachable: false,
        message: "Not reachable: " + compactError(error),
        checkedAt: Date.now(),
        version: null,
        deckNames: [],
        modelNames: [],
        fields: [],
        modelName: prefs.ankiModelName
      };
    } finally {
      if (serial === ankiManagerRefreshSerial) {
        ankiManagerRefreshInFlight = false;
        postDictionaryManagerAnkiState();
      }
    }
  })();
}
function ankiEscapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function ankiNormalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
function ankiCompareKey(value) {
  const raw = ankiNormalizeWhitespace(value).toLowerCase();
  try { return raw.normalize("NFKC"); } catch (_) { return raw; }
}
function ankiPlainText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return ankiNormalizeWhitespace(value);
  if (Array.isArray(value)) return value.map(ankiPlainText).filter(Boolean).join("; ");
  if (typeof value === "object") {
    if (value.content !== undefined) return ankiPlainText(value.content);
    if (value.text !== undefined) return ankiPlainText(value.text);
    if (value.glossary !== undefined) return ankiPlainText(value.glossary);
    return Object.keys(value).map(key => ankiPlainText(value[key])).filter(Boolean).join("; ");
  }
  return "";
}
function ankiHtmlFromValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return ankiEscapeHtml(value);
  if (Array.isArray(value)) {
    const items = value.map(ankiHtmlFromValue).filter(Boolean);
    if (!items.length) return "";
    return "<ul>" + items.map(item => "<li>" + item + "</li>").join("") + "</ul>";
  }
  if (typeof value === "object") {
    if (value.content !== undefined) return ankiHtmlFromValue(value.content);
    if (value.text !== undefined) return ankiHtmlFromValue(value.text);
    if (value.glossary !== undefined) return ankiHtmlFromValue(value.glossary);
  }
  return ankiEscapeHtml(ankiPlainText(value));
}
function ankiGlossaryItems(entry) {
  const term = entry && entry.term ? entry.term : {};
  return Array.isArray(term.glossaries) ? term.glossaries : [];
}
function ankiGlossaryPlain(entry) {
  return ankiGlossaryItems(entry).map(item => ankiPlainText(item && item.glossary)).filter(Boolean).join("\n");
}
function ankiGlossaryHtml(entry) {
  const items = ankiGlossaryItems(entry).map(item => {
    const dict = ankiNormalizeWhitespace(item && item.dict);
    const body = ankiHtmlFromValue(item && item.glossary);
    if (!dict && !body) return "";
    return "<div class=\"iinatan-glossary\">" + (dict ? "<b>" + ankiEscapeHtml(dict) + "</b>: " : "") + body + "</div>";
  }).filter(Boolean);
  return items.join("");
}
function ankiFirstGlossary(entry) {
  const items = ankiGlossaryItems(entry);
  return items.length ? ankiPlainText(items[0] && items[0].glossary) : "";
}
function ankiDictionaryNames(entry) {
  const seen = Object.create(null);
  const out = [];
  ankiGlossaryItems(entry).forEach(item => {
    const dict = ankiNormalizeWhitespace(item && item.dict);
    if (dict && !seen[dict]) {
      seen[dict] = true;
      out.push(dict);
    }
  });
  return out.join(", ");
}
function ankiEntryTags(entry) {
  const out = [];
  ankiGlossaryItems(entry).forEach(item => {
    ["definitionTags", "termTags", "tags"].forEach(key => {
      const raw = item && item[key];
      if (Array.isArray(raw)) raw.forEach(tag => out.push(ankiNormalizeWhitespace(tag)));
      else if (raw) String(raw).split(/[,;]\s*|\s{2,}/).forEach(tag => out.push(ankiNormalizeWhitespace(tag)));
    });
  });
  return out.filter(Boolean).join(", ");
}
function ankiPartOfSpeech(entry) {
  const bits = [];
  ankiGlossaryItems(entry).forEach(item => {
    ["partOfSpeech", "part_of_speech", "partOfSpeechInfo"].forEach(key => {
      const text = ankiNormalizeWhitespace(item && item[key]);
      if (text) bits.push(text);
    });
  });
  return bits.filter(Boolean).join(", ");
}
function ankiFormatFrequencies(term) {
  const rows = Array.isArray(term && term.frequencies) ? term.frequencies : [];
  const out = [];
  rows.forEach(row => {
    const dict = ankiNormalizeWhitespace(row && (row.dict || row.dictName || row.dictionary));
    const values = Array.isArray(row && row.frequencies) ? row.frequencies : [];
    const display = values.map(value => ankiNormalizeWhitespace((value && (value.displayValue || value.display_value)) || (value && value.value !== undefined ? String(value.value) : ""))).filter(Boolean).join(", ");
    if (dict || display) out.push((dict || "Frequency") + (display ? " " + display : ""));
  });
  return out.join("; ");
}
function ankiFrequencyHarmonicRank(term) {
  const values = [];
  const rows = Array.isArray(term && term.frequencies) ? term.frequencies : [];
  rows.forEach(row => {
    const freqs = Array.isArray(row && row.frequencies) ? row.frequencies : [];
    freqs.forEach(item => {
      const value = Number(item && item.value);
      if (Number.isFinite(value) && value > 0) values.push(value);
    });
  });
  if (!values.length) return "";
  const denom = values.reduce((sum, value) => sum + (1 / value), 0);
  if (!denom) return "";
  return String(Math.round(values.length / denom));
}
function ankiPitchPositions(term) {
  const out = [];
  const rows = Array.isArray(term && term.pitches) ? term.pitches : [];
  rows.forEach(row => {
    const positions = Array.isArray(row && row.positions) ? row.positions : (Array.isArray(row && row.pitchPositions) ? row.pitchPositions : []);
    positions.forEach(pos => out.push(String(pos)));
  });
  return out.join(", ");
}
function ankiPitchCategories(term) {
  const positions = ankiPitchPositions(term).split(/,\s*/).map(v => Number(v)).filter(v => Number.isFinite(v));
  if (!positions.length) return "";
  return positions.map(pos => pos === 0 ? "heiban" : (pos === 1 ? "atamadaka" : "nakadaka")).join(", ");
}
function ankiPhoneticTranscriptions(term) {
  const out = [];
  const pitches = Array.isArray(term && term.pitches) ? term.pitches : [];
  pitches.forEach(row => {
    const values = Array.isArray(row && row.transcriptions) ? row.transcriptions : [];
    values.forEach(value => {
      const text = ankiNormalizeWhitespace(value);
      if (text) out.push(text);
    });
  });
  return out.join(", ");
}
function ankiDisplayHeadword(entry) {
  const term = entry && entry.term ? entry.term : {};
  return String(term.expression || (entry && entry.deinflected) || (entry && entry.matched) || "");
}
function ankiDisplayReading(entry, expression) {
  const term = entry && entry.term ? entry.term : {};
  const reading = ankiNormalizeWhitespace(term.reading || "");
  if (!reading || (expression && ankiCompareKey(reading) === ankiCompareKey(expression))) return "";
  return reading;
}
function ankiLookupSurface(context, entry) {
  const candidate = context && context.result && context.result.candidateUsed ? context.result.candidateUsed : null;
  if (context && context.surface) return String(context.surface);
  if (entry && entry.matched) return String(entry.matched);
  if (candidate && candidate.displayText) return String(candidate.displayText);
  const result = context && context.result ? context.result : {};
  const text = String(result.text || context.sentence || lastSubtitle || "");
  const start = Number(result.lookupStart);
  const end = Number(result.lookupEnd);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return Array.from(text).slice(start, end).join("");
  if (result.lookupText) return String(result.lookupText);
  return "";
}
function ankiMediaTitleFromMpv() {
  const props = ["media-title", "metadata/by-key/title", "metadata/by-key/Title", "filename/no-ext", "filename"];
  for (let i = 0; i < props.length; i++) {
    try {
      const value = ankiNormalizeWhitespace(mpv.getString(props[i]));
      if (value) return value;
    } catch (_) {}
  }
  try {
    const path = ankiSourcePathFromMpv();
    const filename = path.split("/").filter(Boolean).pop() || "";
    return filename.replace(/\.[^.]+$/, "");
  } catch (_) {}
  return "";
}
function ankiSourcePathFromMpv() {
  const props = ["path", "stream-open-filename"];
  for (let i = 0; i < props.length; i++) {
    try {
      const value = String(mpv.getString(props[i]) || "").trim();
      if (value) return value;
    } catch (_) {}
  }
  return "";
}
function ankiTimePosFromMpv() {
  try {
    const value = Number(mpv.getNumber("time-pos"));
    if (Number.isFinite(value)) return value;
  } catch (_) {}
  try {
    const value = Number(mpv.getString("time-pos"));
    if (Number.isFinite(value)) return value;
  } catch (_) {}
  return 0;
}
function ankiSubtitleBoundary(name) {
  try {
    const value = Number(mpv.getNumber(name));
    if (Number.isFinite(value) && value >= 0) return value;
  } catch (_) {}
  try {
    const value = Number(mpv.getString(name));
    if (Number.isFinite(value) && value >= 0) return value;
  } catch (_) {}
  return null;
}
function ankiFormatTimestamp(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return (h > 0 ? String(h) + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
}
function ankiFuriganaPlain(expression, reading) {
  return reading ? (String(expression || "") + "[" + String(reading || "") + "]") : String(expression || "");
}
function ankiFuriganaHtml(expression, reading) {
  return reading ? ("<ruby>" + ankiEscapeHtml(expression) + "<rt>" + ankiEscapeHtml(reading) + "</rt></ruby>") : ankiEscapeHtml(expression);
}
function ankiClozeForSentence(sentence, surface, position) {
  const chars = Array.from(String(sentence || ""));
  const bodyChars = Array.from(String(surface || ""));
  let start = Number(position);
  if (!Number.isFinite(start) || start < 0 || start >= chars.length) {
    const sentenceText = String(sentence || "");
    const idx = surface ? sentenceText.indexOf(String(surface)) : -1;
    start = idx >= 0 ? Array.from(sentenceText.slice(0, idx)).length : 0;
  }
  let end = start + Math.max(1, bodyChars.length || 1);
  if (start < 0) start = 0;
  if (end > chars.length) end = chars.length;
  const body = chars.slice(start, end).join("") || String(surface || "");
  return {
    prefix: chars.slice(0, start).join(""),
    body,
    suffix: chars.slice(end).join("")
  };
}
function ankiCardContextFromPayload(payload) {
  const raw = payload && payload.context && typeof payload.context === "object" ? payload.context : {};
  const entry = raw.entry && typeof raw.entry === "object" ? raw.entry : {};
  const term = entry.term || {};
  const expression = ankiNormalizeWhitespace(raw.expression || raw.heading || ankiDisplayHeadword(entry));
  const reading = ankiNormalizeWhitespace(raw.reading || ankiDisplayReading(entry, expression));
  const sentence = String(raw.sentence || (raw.result && raw.result.text) || lastSubtitle || "");
  const surface = ankiNormalizeWhitespace(raw.surface || ankiLookupSurface(raw, entry) || expression);
  const position = Number(raw.position !== undefined ? raw.position : (payload && payload.position !== undefined ? payload.position : (raw.result && raw.result.lookupStart)));
  const cloze = ankiClozeForSentence(sentence, surface || expression, position);
  const title = ankiMediaTitleFromMpv();
  const sourcePath = ankiSourcePathFromMpv();
  const timePos = ankiTimePosFromMpv();
  const selectedGlossary = ankiFirstGlossary(entry);
  return {
    requestId: String((payload && payload.requestId) || ""),
    entry,
    term,
    expression,
    word: expression,
    reading,
    sentence,
    surface,
    position: Number.isFinite(position) ? position : 0,
    clozePrefix: cloze.prefix,
    clozeBody: cloze.body,
    clozeSuffix: cloze.suffix,
    glossary: ankiGlossaryHtml(entry),
    glossaryPlain: ankiGlossaryPlain(entry),
    glossaryFirst: selectedGlossary,
    selectedGlossary,
    dictionary: ankiDictionaryNames(entry),
    partOfSpeech: ankiPartOfSpeech(entry),
    tags: ankiEntryTags(entry),
    frequencies: ankiFormatFrequencies(term),
    frequencyHarmonicRank: ankiFrequencyHarmonicRank(term),
    pitchAccentPositions: ankiPitchPositions(term),
    pitchAccentCategories: ankiPitchCategories(term),
    phoneticTranscriptions: ankiPhoneticTranscriptions(term),
    documentTitle: title,
    sourcePath,
    timestamp: ankiFormatTimestamp(timePos),
    timePos,
    audioTerm: expression,
    audioReading: reading
  };
}
function extractAnkiMarkersFromTemplates(templates) {
  const out = Object.create(null);
  Object.keys(templates || {}).forEach(field => {
    const text = String(templates[field] || "");
    text.replace(/\{([^{}]+)\}/g, (_match, key) => {
      out[String(key || "").trim().toLowerCase()] = true;
      return "";
    });
  });
  return out;
}
function ankiTemplatesNeedMedia(templates) {
  const markers = extractAnkiMarkersFromTemplates(templates || {});
  return {
    screenshot: !!(markers.screenshot || markers.image),
    sentenceAudio: !!(markers["sentence-audio"] || markers["subtitle-audio"]),
    wordAudio: !!markers.audio
  };
}
function ankiMarkerValue(marker, context, media) {
  const key = String(marker || "").trim().toLowerCase();
  if (key === "expression" || key === "word") return ankiEscapeHtml(context.expression);
  if (key === "reading") return ankiEscapeHtml(context.reading);
  if (key === "furigana-plain") return ankiEscapeHtml(ankiFuriganaPlain(context.expression, context.reading));
  if (key === "furigana") return ankiFuriganaHtml(context.expression, context.reading);
  if (key === "popup-selection-text") return ankiEscapeHtml(context.surface);
  if (key === "sentence") return ankiEscapeHtml(context.sentence);
  if (key === "cloze-prefix") return ankiEscapeHtml(context.clozePrefix);
  if (key === "cloze-body") return ankiEscapeHtml(context.clozeBody);
  if (key === "cloze-suffix") return ankiEscapeHtml(context.clozeSuffix);
  if (key === "glossary") return context.glossary;
  if (key === "glossary-plain") return ankiEscapeHtml(context.glossaryPlain);
  if (key === "glossary-first" || key === "selected-glossary") return ankiEscapeHtml(context.glossaryFirst);
  if (key === "dictionary" || key === "dictionary-alias") return ankiEscapeHtml(context.dictionary);
  if (key === "part-of-speech") return ankiEscapeHtml(context.partOfSpeech);
  if (key === "tags") return ankiEscapeHtml(context.tags);
  if (key === "frequencies") return ankiEscapeHtml(context.frequencies);
  if (key === "frequency-harmonic-rank") return ankiEscapeHtml(context.frequencyHarmonicRank);
  if (key === "pitch-accent-positions") return ankiEscapeHtml(context.pitchAccentPositions);
  if (key === "pitch-accent-categories") return ankiEscapeHtml(context.pitchAccentCategories);
  if (key === "phonetic-transcriptions") return ankiEscapeHtml(context.phoneticTranscriptions);
  if (key === "document-title") return ankiEscapeHtml(context.documentTitle);
  if (key === "source-path") return ankiEscapeHtml(context.sourcePath);
  if (key === "timestamp") return ankiEscapeHtml(context.timestamp);
  if (key === "screenshot" || key === "image") return media && media.screenshot ? '<img src="' + ankiEscapeHtml(media.screenshot) + '">' : "";
  if (key === "sentence-audio" || key === "subtitle-audio") return media && media.sentenceAudio ? "[sound:" + media.sentenceAudio + "]" : "";
  if (key === "audio") return media && media.wordAudio ? "[sound:" + media.wordAudio + "]" : "";
  return "";
}
function renderAnkiTemplate(template, context, media) {
  return String(template || "").replace(/\{([^{}]+)\}/g, (_match, marker) => ankiMarkerValue(marker, context, media || {}));
}
function renderAnkiFields(templates, context, media) {
  const fields = {};
  Object.keys(templates || {}).forEach(field => {
    fields[field] = renderAnkiTemplate(templates[field], context, media || {});
  });
  return fields;
}
function ankiSearchEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function ankiDuplicateQuery(prefs, fields, fieldNames) {
  const model = prefs.ankiModelName;
  const deck = prefs.ankiDeckName;
  const firstField = Array.isArray(fieldNames) && fieldNames.length ? fieldNames[0] : Object.keys(fields || {})[0];
  const value = firstField ? String(fields[firstField] || "") : "";
  if (!model || !firstField || !value) return "";
  const parts = ['note:"' + ankiSearchEscape(model) + '"', '"' + ankiSearchEscape(firstField) + ':' + ankiSearchEscape(value) + '"'];
  if (prefs.ankiDuplicateScope === "deck" && deck) parts.unshift('deck:"' + ankiSearchEscape(deck) + '"');
  return parts.join(" ");
}
async function ankiFindDuplicateNotes(prefs, fields, fieldNames) {
  if (!prefs.ankiDuplicateCheck) return [];
  const query = ankiDuplicateQuery(prefs, fields, fieldNames);
  if (!query) return [];
  const result = await ankiConnectInvoke("findNotes", { query }, { url: prefs.ankiConnectUrl, timeoutSeconds: 8 });
  return Array.isArray(result) ? result : [];
}
function ankiDuplicateOptions(prefs) {
  return {
    allowDuplicate: prefs.ankiDuplicateMode === "allow",
    duplicateScope: prefs.ankiDuplicateScope === "collection" ? "collection" : "deck",
    duplicateScopeOptions: {
      deckName: prefs.ankiDeckName,
      checkChildren: true,
      checkAllModels: false
    }
  };
}
function ankiNoteTags(prefs) {
  const seen = Object.create(null);
  const out = [];
  String(prefs.ankiTags || "").split(/[,\s]+/).forEach(tag => {
    const clean = tag.trim();
    if (clean && !seen[clean]) {
      seen[clean] = true;
      out.push(clean);
    }
  });
  return out;
}
async function ankiStoreMediaFile(filename, path, prefs) {
  if (!filename || !path) return "";
  const stored = await ankiConnectInvoke("storeMediaFile", {
    filename,
    path,
    deleteExisting: true
  }, { url: prefs.ankiConnectUrl, timeoutSeconds: 20 });
  return String(stored || filename);
}
async function ankiStoreMediaUrl(filename, url, prefs) {
  if (!filename || !url) return "";
  const stored = await ankiConnectInvoke("storeMediaFile", {
    filename,
    url,
    deleteExisting: true
  }, { url: prefs.ankiConnectUrl, timeoutSeconds: 20 });
  return String(stored || filename);
}
function ankiSafeMediaName(text) {
  const base = String(text || "iinatan").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return base || "iinatan";
}
function ankiMediaPath(filename) {
  return dataPath("anki-media", filename);
}
async function ensureAnkiMediaRoot() {
  await utils.exec("/bin/mkdir", ["-p", dataPath("anki-media")], dataRoot());
}
function ankiMpvGetProperty(name) {
  try { return mpv.getString(name); } catch (_) {}
  try { return mpv.getNumber(name); } catch (_) {}
  return undefined;
}
function ankiMpvSetProperty(name, value) {
  try { mpv.set(name, value); return true; } catch (_) {}
  try { mpv.command("set", [name, String(value)]); return true; } catch (_) {}
  return false;
}
async function ankiCaptureScreenshot(context, prefs) {
  await ensureAnkiMediaRoot();
  const filename = ankiSafeMediaName((context.documentTitle || "video") + "-" + ankiFormatTimestamp(context.timePos) + "-" + String(Date.now())) + ".jpg";
  const path = ankiMediaPath(filename);
  const quality = normalizeAnkiImageQuality(prefs && prefs.ankiImageQuality);
  const previousQuality = ankiMpvGetProperty("screenshot-jpeg-quality");
  const didSetQuality = ankiMpvSetProperty("screenshot-jpeg-quality", quality);
  try {
    try { mpv.command("screenshot-to-file", [path, "video"]); }
    catch (error) { throw new Error("Could not capture screenshot: " + compactError(error)); }
    for (let i = 0; i < 25; i++) {
      try { if (file.exists(path)) return ankiStoreMediaFile(filename, path, prefs); } catch (_) {}
      await sleep(40);
    }
  } finally {
    if (didSetQuality && previousQuality !== undefined && previousQuality !== null && previousQuality !== "") {
      ankiMpvSetProperty("screenshot-jpeg-quality", previousQuality);
    }
  }
  throw new Error("Screenshot file was not created.");
}
async function ankiFindFfmpegPath() {
  const candidates = [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/Applications/IINA.app/Contents/MacOS/ffmpeg"
  ];
  for (let i = 0; i < candidates.length; i++) {
    try { if (file.exists(candidates[i])) return candidates[i]; } catch (_) {}
  }
  try {
    const result = await utils.exec("/usr/bin/which", ["ffmpeg"], dataRoot());
    const path = String(result && result.stdout || "").trim().split(/\r?\n/)[0];
    if (result && result.status === 0 && path) return path;
  } catch (_) {}
  return "";
}
async function ankiCaptureSentenceAudio(context, prefs) {
  const sourcePath = ankiSourcePathFromMpv();
  if (!sourcePath || /^https?:\/\//i.test(sourcePath)) throw new Error("Sentence audio requires a local media file.");
  const ffmpegPath = await ankiFindFfmpegPath();
  if (!ffmpegPath) throw new Error("ffmpeg was not found for sentence audio capture.");
  const subStart = ankiSubtitleBoundary("sub-start");
  const subEnd = ankiSubtitleBoundary("sub-end");
  const current = context.timePos || ankiTimePosFromMpv();
  const padding = Math.max(0, Math.min(2, Number(prefs.ankiSentenceAudioPaddingMs || 0) / 1000));
  let start = subStart !== null ? subStart : Math.max(0, current - 1.5);
  let end = subEnd !== null && subEnd > start ? subEnd : Math.min(start + 4, current + 2.5);
  start = Math.max(0, start - padding);
  end = Math.max(start + 0.25, end + padding);
  if (end - start > ANKI_MEDIA_MAX_AUDIO_SECONDS) end = start + ANKI_MEDIA_MAX_AUDIO_SECONDS;
  const duration = Math.max(0.25, end - start);
  const format = normalizeAnkiAudioFormat(prefs.ankiAudioFormat);
  const bitrate = normalizeAnkiAudioBitrateKbps(prefs && prefs.ankiAudioBitrateKbps);
  const ext = format === "opus" ? "opus" : "mp3";
  const filename = ankiSafeMediaName((context.documentTitle || "video") + "-" + ankiFormatTimestamp(start) + "-" + String(Date.now())) + "." + ext;
  const outPath = ankiMediaPath(filename);
  await ensureAnkiMediaRoot();
  const codecArgs = format === "opus" ? ["-c:a", "libopus", "-b:a", String(bitrate) + "k"] : ["-codec:a", "libmp3lame", "-b:a", String(bitrate) + "k"];
  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(start.toFixed(3)),
    "-i",
    sourcePath,
    "-t",
    String(duration.toFixed(3)),
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-threads",
    "2"
  ].concat(codecArgs, [outPath]);
  const result = await utils.exec(ffmpegPath, args, dataRoot());
  if (!result || result.status !== 0 || !file.exists(outPath)) {
    throw new Error("Sentence audio capture failed: " + String((result && (result.stderr || result.stdout)) || "ffmpeg failed").slice(0, 500));
  }
  return ankiStoreMediaFile(filename, outPath, prefs);
}
function ankiAudioUrlFromTemplate(template, context, prefs) {
  const values = {
    term: String(context && context.audioTerm || context && context.expression || ""),
    reading: String(context && context.audioReading || context && context.reading || ""),
    language: String(prefs && prefs.lookupLanguage || "")
  };
  return String(template || "").replace(/\{([^}]*)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
    try { return encodeURIComponent(values[key]); } catch (_) { return values[key]; }
  });
}
function ankiUrlLooksLikeAudioFile(url) {
  return /\.(?:mp3|m4a|aac|ogg|oga|opus|wav|webm)(?:[?#]|$)/i.test(String(url || ""));
}
function ankiAudioExtensionFromUrl(url) {
  const match = String(url || "").match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  const ext = match ? match[1].toLowerCase() : "";
  return /^(mp3|m4a|aac|ogg|oga|opus|wav|webm)$/.test(ext) ? ext : "mp3";
}
async function ankiResolveWordAudioUrl(context, prefs) {
  const sources = normalizeAudioSources(prefs && prefs.audioSourcesJson);
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const sourceUrl = safeAnkiConnectUrl(ankiAudioUrlFromTemplate(source && source.url, context, prefs));
    if (!sourceUrl) continue;
    if (ankiUrlLooksLikeAudioFile(sourceUrl)) return sourceUrl;
    try {
      if (typeof fetchAudioSourceCandidates === "function") {
        const candidates = await fetchAudioSourceCandidates(sourceUrl);
        if (Array.isArray(candidates) && candidates.length && candidates[0].url) return candidates[0].url;
      }
    } catch (error) {
      debugVerbose("Anki word audio source failed: " + compactError(error));
    }
  }
  return "";
}
async function ankiStoreWordAudio(context, prefs) {
  try {
    const url = await ankiResolveWordAudioUrl(context, prefs);
    if (!url) return "";
    const filename = ankiSafeMediaName((context.expression || "word") + "-" + String(Date.now())) + "." + ankiAudioExtensionFromUrl(url);
    return await ankiStoreMediaUrl(filename, url, prefs);
  } catch (error) {
    debugVerbose("Anki word audio unavailable: " + compactError(error));
    return "";
  }
}
async function ankiCaptureNeededMedia(needs, context, prefs) {
  const media = {};
  const jobs = [];
  if (needs.screenshot) {
    jobs.push(ankiCaptureScreenshot(context, prefs).then(value => { media.screenshot = value; }));
  }
  if (needs.sentenceAudio) {
    jobs.push(ankiCaptureSentenceAudio(context, prefs).then(value => { media.sentenceAudio = value; }));
  }
  if (needs.wordAudio) {
    jobs.push(ankiStoreWordAudio(context, prefs).then(value => { if (value) media.wordAudio = value; }));
  }
  if (jobs.length) await Promise.all(jobs);
  return media;
}
async function ankiConfiguredFieldNames(prefs) {
  const key = ankiFieldCacheKey(prefs);
  if (Array.isArray(ankiModelFieldCache[key])) return ankiModelFieldCache[key].slice();
  try {
    const fields = await ankiConnectInvoke("modelFieldNames", { modelName: prefs.ankiModelName }, { url: prefs.ankiConnectUrl, timeoutSeconds: 8 });
    const out = Array.isArray(fields) ? fields : [];
    ankiModelFieldCache[key] = out.slice();
    return out;
  } catch (_) {
    return Object.keys(ankiFieldTemplatesFromPrefs(prefs));
  }
}
async function ankiCardStatusForContext(payload) {
  const prefs = ankiActiveProfilePreferences();
  if (!ankiProfileConfigured(prefs)) return { ok: false, state: "disabled", message: "Anki export is not configured." };
  const templates = ankiFieldTemplatesFromPrefs(prefs);
  const context = ankiCardContextFromPayload(payload);
  const fields = renderAnkiFields(templates, context, {});
  const fieldNames = await ankiConfiguredFieldNames(prefs);
  const duplicates = await ankiFindDuplicateNotes(prefs, fields, fieldNames);
  if (duplicates.length) {
    return { ok: true, state: "duplicate", duplicate: true, noteIds: duplicates, message: "Duplicate found." };
  }
  return { ok: true, state: "ready", duplicate: false, noteIds: [], message: "Ready to add." };
}
function postAnkiCardState(requestId, payload) {
  postToOverlay("anki-card-state", Object.assign({ requestId: String(requestId || "") }, payload || {}));
}
function handleBridgeAnkiCardStatus(payload) {
  const requestId = payload && payload.requestId !== undefined ? String(payload.requestId) : "";
  (async () => {
    try {
      const status = await ankiCardStatusForContext(payload);
      postAnkiCardState(requestId, status);
    } catch (error) {
      postAnkiCardState(requestId, { ok: false, state: "error", message: compactError(error) });
    }
  })();
}
function handleBridgeAnkiCardOpen(payload) {
  const requestId = payload && payload.requestId !== undefined ? String(payload.requestId) : "";
  (async () => {
    try {
      const ids = payload && Array.isArray(payload.noteIds) ? payload.noteIds : [];
      let query = ids.length ? ("nid:" + String(ids[0])) : "";
      if (!query) {
        const prefs = ankiActiveProfilePreferences();
        const templates = ankiFieldTemplatesFromPrefs(prefs);
        const context = ankiCardContextFromPayload(payload);
        const fields = renderAnkiFields(templates, context, {});
        const fieldNames = await ankiConfiguredFieldNames(prefs);
        query = ankiDuplicateQuery(prefs, fields, fieldNames);
      }
      if (!query) throw new Error("No duplicate note query is available.");
      await ankiConnectInvoke("guiBrowse", { query }, { url: ankiActiveProfilePreferences().ankiConnectUrl, timeoutSeconds: 8 });
      postAnkiCardState(requestId, { ok: true, state: "opened", message: "Opened in Anki." });
    } catch (error) {
      postAnkiCardState(requestId, { ok: false, state: "error", message: compactError(error) });
    }
  })();
}
function handleBridgeAnkiCardAdd(payload) {
  const requestId = payload && payload.requestId !== undefined ? String(payload.requestId) : "";
  (async () => {
    try {
      const prefs = ankiActiveProfilePreferences();
      if (!ankiProfileConfigured(prefs)) throw new Error("Anki export is not configured.");
      const templates = ankiFieldTemplatesFromPrefs(prefs);
      const context = ankiCardContextFromPayload(payload);
      let fields = renderAnkiFields(templates, context, {});
      const known = String((payload && payload.duplicateKnown) || "");
      const knownIds = payload && Array.isArray(payload.noteIds) ? payload.noteIds : [];
      let duplicates = [];
      if (prefs.ankiDuplicateCheck && known === "duplicate" && knownIds.length) {
        duplicates = knownIds;
      } else if (prefs.ankiDuplicateCheck && known !== "ready") {
        const fieldNames = await ankiConfiguredFieldNames(prefs);
        duplicates = await ankiFindDuplicateNotes(prefs, fields, fieldNames);
      }
      if (duplicates.length && prefs.ankiDuplicateMode !== "allow") {
        postAnkiCardState(requestId, { ok: true, state: "duplicate", duplicate: true, noteIds: duplicates, message: "Duplicate found." });
        return;
      }
      const needs = ankiTemplatesNeedMedia(templates);
      const media = await ankiCaptureNeededMedia(needs, context, prefs);
      fields = renderAnkiFields(templates, context, media);
      const note = {
        deckName: prefs.ankiDeckName,
        modelName: prefs.ankiModelName,
        fields,
        options: ankiDuplicateOptions(prefs),
        tags: ankiNoteTags(prefs)
      };
      const noteId = await ankiConnectInvoke("addNote", { note }, { url: prefs.ankiConnectUrl, timeoutSeconds: 20 });
      postAnkiCardState(requestId, { ok: true, state: "added", noteId, message: "Added Anki card." });
    } catch (error) {
      postAnkiCardState(requestId, { ok: false, state: "error", message: compactError(error) });
    }
  })();
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
    handleLookupPopupOverlayReady(payload);
    postToOverlay("config", overlayConfig());
    postToOverlay("enabled", { enabled });
    replayActiveOverlayTask();
    if (enabled) pollSubtitle();
  });
  overlay.onMessage("lookup-at", payload => { handleLookupAt(payload); });
	  overlay.onMessage("lookup-at-lite", payload => { handleLookupAt(payload); });
	  overlay.onMessage("lookup-popup-visibility", payload => { handleLookupPopupVisibility(payload); });
	  overlay.onMessage("lookup-popup-visible", payload => { handleLookupPopupVisibility(payload); });
	  overlay.onMessage("open-external-url", payload => { openExternalUrlFromOverlay(payload && payload.url !== undefined ? payload.url : payload); });
	}
function prepareRuntimeAfterProfileChange() {
  lookupBackendReadyForNativeHide = false;
  lookupInFlight = Object.create(null);
  hoverLookupInFlight = false;
  pendingHoverLookup = null;
  hoverLookupActiveKey = "";
  lastSubtitle = null;
  resetLookupPopupPause();
}
function warmActiveProfileBackend() {
  if (!enabled) return;
  const language = selectedLanguageModule();
  const dicts = activeDictionaryPaths(language);
  prepareLookupBackendForEnabledOverlay(language, dicts).then(() => {
    if (!enabled) return;
    lookupBackendReadyForNativeHide = true;
    syncNativeSubtitleVisibility();
    setOverlayStatus("Dictionary lookup ready for " + language.label + ".", "info", 3500);
  }).catch(error => {
    lookupBackendReadyForNativeHide = false;
    debugError("Dictionary lookup startup failed after profile change language=" + language.id + ": " + compactError(error));
    setOverlayStatus(compactError(error), "error", 14000);
  });
}
function pushOverlayConfigForProfileChange() {
  prepareRuntimeAfterProfileChange();
  if (initialized) {
    postToOverlay("config", overlayConfig());
    postToOverlay("enabled", { enabled });
  }
  if (enabled) {
    refreshPollingInterval();
    pollSubtitle();
    syncNativeSubtitleVisibility();
    warmActiveProfileBackend();
  }
}
function videoWindowAvailableForOverlayLoad() {
  try { return !!(core && core.window && core.window.loaded); }
  catch (_) { return false; }
}
function reloadOverlayForProfileChange() {
  prepareRuntimeAfterProfileChange();
  if (!videoWindowAvailableForOverlayLoad()) {
    debugLog("deferring overlay reload for profile change until iina.window-loaded");
    return;
  }
  if (!initialized) {
    initializeOverlay();
  } else {
    try {
      debugLog("reloading overlay for active profile language=" + selectedLanguageModule().id);
      overlay.loadFile("overlay.html");
      overlay.setOpacity(1);
      overlay.setClickable(enabled);
      if (enabled) overlay.show();
    } catch (error) {
      debugWarn("overlay reload failed for profile change: " + compactError(error));
    }
  }
  setTimeout(() => {
    postToOverlay("config", overlayConfig());
    postToOverlay("enabled", { enabled });
    replayActiveOverlayTask();
    if (enabled) {
      startPolling();
      syncNativeSubtitleVisibility();
      warmActiveProfileBackend();
    } else {
      publishSubtitle("");
    }
  }, 80);
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
async function prepareLookupBackendForEnabledOverlay(language, dicts) {
  const lang = language || selectedLanguageModule();
  const activeDicts = dicts || activeDictionaryPaths(lang);
  debugLog("prepare lookup backend language=" + lang.id + " label=" + lang.label + " activeDicts=" + activeDicts.length + " dicts=" + JSON.stringify(activeDicts.map(p => String(p).split("/").pop())));
  const setupMessage = dictionarySetupMessage(lang, activeDicts);
  if (setupMessage) throw new Error(setupMessage);
  const ready = await ensureBackendWorker(activeDicts, lang);
  debugLog("prepare lookup backend ready language=" + lang.id + " fingerprint=" + JSON.stringify((ready && ready.fingerprint) || ""));
  return ready;
}
function setEnabled(next) {
  debugLog("setEnabled requested next=" + String(!!next) + " previous=" + String(enabled));
  enabled = !!next;
  lookupBackendReadyForNativeHide = false;
  initializeOverlay();
  overlay.setClickable(enabled);
  postToOverlay("enabled", { enabled });
  postToOverlay("config", overlayConfig());
  rebuildMenu();
  if (enabled) {
    const language = selectedLanguageModule();
    const dicts = activeDictionaryPaths(language);
    try {
      nativeSubVisibilityBeforeEnable = mpv.getFlag("sub-visibility");
      syncNativeSubtitleVisibility();
    } catch (error) { console.warn("Could not update native subtitle visibility: " + compactError(error)); }
    overlay.show();
    startPolling();
    showOSD("iinatan: On");
    prepareLookupBackendForEnabledOverlay(language, dicts).then(() => {
      if (!enabled) return;
      lookupBackendReadyForNativeHide = true;
      syncNativeSubtitleVisibility();
      setOverlayStatus("Dictionary lookup ready for " + language.label + ".", "info", 3500);
    }).catch(error => {
      lookupBackendReadyForNativeHide = false;
      debugError("Dictionary lookup startup failed language=" + language.id + ": " + compactError(error));
      try { if (nativeSubVisibilityBeforeEnable !== null) mpv.set("sub-visibility", nativeSubVisibilityBeforeEnable); } catch (_) {}
      setOverlayStatus(compactError(error), "error", 14000);
    });
  } else {
    lookupBackendReadyForNativeHide = false;
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

function dictionaryManagerAvailable() {
  return !!(standaloneWindow && typeof standaloneWindow.loadFile === "function");
}
function postToDictionaryManager(name, data) {
  try {
    if (!standaloneWindow || typeof standaloneWindow.postMessage !== "function") return;
    standaloneWindow.postMessage(name, data || {});
  } catch (error) {
    debugWarn("dictionary manager postMessage failed name=" + String(name || "") + ": " + compactError(error));
  }
}
function dictionaryManagerState() {
  const manifest = readManifest();
  const disabled = disabledDictionaryMap(manifest);
  const dicts = dictionaryDirs();
  const activeProfile = activeDictionaryProfile(manifest);
  const profilePreferences = normalizeProfilePreferences(activeProfile.preferences);
  const lookupLanguage = String(profilePreferences.lookupLanguage || pref("lookupLanguage", "ja"));
  return {
    version: VERSION,
    dictionaries: dicts.map((dict, index) => ({
      name: dict.name,
      title: dict.title || dict.name,
      language: dict.language || "unknown",
      revision: dict.revision || "",
      format: dict.format || "",
      termCount: Number(dict.termCount || 0),
      metaCount: Number(dict.metaCount || 0),
      tagCount: Number(dict.tagCount || 0),
      mediaCount: Number(dict.mediaCount || 0),
      pitchCount: Number(dict.pitchCount || 0),
      freqCount: Number(dict.freqCount || 0),
      enabled: !disabled[dict.name],
      order: index
    })),
    activeProfileId: manifest.activeProfileId || DEFAULT_PROFILE_ID,
    activeProfileName: activeProfile.name || "Profile 1",
    profiles: profileSummaries(manifest),
    profilePreferenceKeys: PROFILE_PREFERENCE_KEYS.slice(),
    profilePreferenceDefaults: Object.assign({}, PROFILE_PREFERENCE_DEFAULTS),
    profilePreferences,
    globalSettings: readGlobalSettingsSnapshot(),
    globalSettingDefaults: Object.assign({}, GLOBAL_SETTINGS_DEFAULTS),
    lookupLanguage,
    anki: typeof dictionaryManagerAnkiState === "function" ? dictionaryManagerAnkiState(profilePreferences) : null,
    recommendedDictionaries: recommendedDictionariesForLanguage(lookupLanguage, dicts)
  };
}
function postDictionaryManagerState() {
  try { postToDictionaryManager("dictionary-manager-state", dictionaryManagerState()); }
  catch (error) { debugWarn("could not build dictionary manager state: " + compactError(error)); }
}
function postDictionaryManagerStatus(message, kind, busy) {
  postToDictionaryManager("dictionary-manager-status", {
    message: String(message || ""),
    kind: kind || "info",
    busy: !!busy,
    updatedAt: Date.now()
  });
}
function runDictionaryManagerAction(label, action) {
  (async () => {
    const actionLabel = label || "Working";
    if (dictionaryManagerActionInFlight) {
      postDictionaryManagerStatus("Another dictionary action is already running.", "info", true);
      return;
    }
    dictionaryManagerActionInFlight = true;
    postDictionaryManagerStatus(actionLabel + "...", "info", true);
    try {
      const result = await action();
      postDictionaryManagerState();
      if (result && result.cancelled) {
        postDictionaryManagerStatus(result.message || actionLabel + " cancelled.", "info", false);
        return;
      }
      postDictionaryManagerStatus(actionLabel + " complete.", "info", false);
    } catch (error) {
      const msg = actionLabel + " failed: " + compactError(error);
      debugError("dictionary manager action failed label=" + actionLabel + " error=" + compactError(error));
      postDictionaryManagerState();
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
    } finally {
      dictionaryManagerActionInFlight = false;
    }
  })();
}
function runDictionaryManagerZipImport() {
  (async () => {
    if (dictionaryManagerActionInFlight) {
      postDictionaryManagerStatus("Another dictionary action is already running.", "info", true);
      return;
    }
    let zipPaths = [];
    try {
      zipPaths = await chooseDictionaryZipPaths();
    } catch (error) {
      const msg = "Could not open dictionary ZIP picker: " + compactError(error);
      debugError("dictionary manager file picker failed: " + compactError(error));
      postDictionaryManagerState();
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
      return;
    }
    if (!zipPaths.length) {
      notify("Dictionary import cancelled.", "info", 3500);
      postDictionaryManagerState();
      postDictionaryManagerStatus("Dictionary import cancelled.", "info", false);
      return;
    }

    const countLabel = zipPaths.length === 1 ? "dictionary" : String(zipPaths.length) + " dictionaries";
    dictionaryManagerActionInFlight = true;
    postDictionaryManagerStatus("Importing " + countLabel + "...", "info", true);
    try {
      await validateAndImportDictionaryZips(zipPaths, "dictionary-manager-picker");
      postDictionaryManagerState();
      postDictionaryManagerStatus("Imported " + countLabel + ".", "info", false);
    } catch (error) {
      const msg = "Importing dictionary failed: " + compactError(error);
      debugError("dictionary manager import failed: " + compactError(error));
      postDictionaryManagerState();
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
    } finally {
      dictionaryManagerActionInFlight = false;
    }
  })();
}
function registerDictionaryManagerHandlers() {
  if (!standaloneWindow || typeof standaloneWindow.onMessage !== "function") return;
  const generation = ++dictionaryManagerHandlerGeneration;
  const onMessage = (name, handler) => {
    standaloneWindow.onMessage(name, payload => {
      if (generation !== dictionaryManagerHandlerGeneration) {
        debugVerbose("ignored stale dictionary manager message name=" + String(name || "") + " generation=" + generation + " current=" + dictionaryManagerHandlerGeneration);
        return;
      }
      handler(payload);
    });
  };
  onMessage("dictionary-manager-ready", () => {
    postDictionaryManagerState();
    postDictionaryManagerStatus("", "info", false);
    if (typeof refreshDictionaryManagerAnkiState === "function") refreshDictionaryManagerAnkiState();
  });
  onMessage("dictionary-manager-refresh", () => {
    postDictionaryManagerState();
    postDictionaryManagerStatus("Dictionary list refreshed.", "info", false);
  });
  onMessage("dictionary-manager-anki-refresh", payload => {
    if (typeof refreshDictionaryManagerAnkiState === "function") refreshDictionaryManagerAnkiState(payload && payload.preferences);
  });
  onMessage("dictionary-manager-set-enabled", payload => {
    const name = payload && payload.name;
    if (!name) return;
    setDictionaryEnabled(String(name), !!(payload && payload.enabled));
    postDictionaryManagerStatus("Dictionary selection saved.", "info", false);
  });
  onMessage("dictionary-manager-set-order", payload => {
    const order = payload && Array.isArray(payload.order) ? payload.order : [];
    setDictionaryOrder(order);
    postDictionaryManagerStatus("Dictionary order saved.", "info", false);
  });
  onMessage("dictionary-manager-delete", payload => {
    const name = payload && payload.name;
    if (!name) return;
    runDictionaryManagerAction("Deleting dictionary", () => deleteDictionary(String(name)));
  });
  onMessage("dictionary-manager-download-recommended", payload => {
    const requestedId = payload && payload.id;
    const item = recommendedDictionaryById(requestedId);
    const label = "Downloading " + ((item && item.title) || "recommended dictionary");
    runDictionaryManagerAction(label, () => getRecommendedDictionaries(requestedId));
  });
  onMessage("dictionary-manager-import-zip", () => {
    runDictionaryManagerZipImport();
  });
  onMessage("dictionary-manager-switch-profile", payload => {
    const profileId = payload && payload.profileId;
    if (!profileId) return;
    runDictionaryManagerAction("Switching profile", () => {
      setActiveDictionaryProfile(profileId);
      return Promise.resolve();
    });
  });
  onMessage("dictionary-manager-create-profile", payload => {
    const name = payload && payload.name;
    runDictionaryManagerAction("Creating profile", () => {
      const profile = createDictionaryProfile(name || "", payload && payload.sourceProfileId);
      setActiveDictionaryProfile(profile.id);
      return Promise.resolve();
    });
  });
  onMessage("dictionary-manager-rename-profile", payload => {
    try {
      renameDictionaryProfile(payload && payload.profileId, payload && payload.name);
      postDictionaryManagerStatus("Profile renamed.", "info", false);
    } catch (error) {
      const msg = "Renaming profile failed: " + compactError(error);
      debugError(msg);
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
    }
  });
  onMessage("dictionary-manager-delete-profile", payload => {
    runDictionaryManagerAction("Deleting profile", () => {
      deleteDictionaryProfile(payload && payload.profileId);
      return Promise.resolve();
    });
  });
  onMessage("dictionary-manager-update-profile-preferences", payload => {
    try {
      const beforePrefs = normalizeProfilePreferences(activeDictionaryProfile(readManifest()).preferences);
      updateDictionaryProfilePreferences(payload && payload.profileId, payload && payload.preferences);
      postDictionaryManagerStatus("Profile settings saved.", "info", false);
      const nextPrefs = normalizeProfilePreferences((payload && payload.preferences) || {});
      if (
        typeof refreshDictionaryManagerAnkiState === "function" &&
        (beforePrefs.ankiConnectUrl !== nextPrefs.ankiConnectUrl || beforePrefs.ankiModelName !== nextPrefs.ankiModelName)
      ) {
        refreshDictionaryManagerAnkiState(payload && payload.preferences);
      }
    } catch (error) {
      const msg = "Saving profile settings failed: " + compactError(error);
      debugError(msg);
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
    }
  });
  onMessage("dictionary-manager-update-global-settings", payload => {
    try {
      updateGlobalSettings(payload && payload.settings);
      postDictionaryManagerStatus("Dictionary import settings saved.", "info", false);
    } catch (error) {
      const msg = "Saving dictionary import settings failed: " + compactError(error);
      debugError(msg);
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
    }
  });
}
function openDictionaryManager() {
  if (!dictionaryManagerAvailable()) {
    alert("This IINA build does not expose standalone windows. Use the Dictionaries menu for import actions.");
    return;
  }
  try {
    standaloneWindow.loadFile("dictionary-manager.html");
    registerDictionaryManagerHandlers();
    try {
      if (typeof standaloneWindow.setProperty === "function") standaloneWindow.setProperty({ title: "iinatan Settings", resizable: true });
    } catch (_) {}
    if (typeof standaloneWindow.open === "function") standaloneWindow.open();
    else if (typeof standaloneWindow.show === "function") standaloneWindow.show();
    setTimeout(() => postDictionaryManagerState(), 120);
  } catch (error) {
    const msg = "Could not open iinatan Settings: " + compactError(error);
    debugError(msg);
    alert(msg);
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
  const fr = languageModuleById("fr");
  const de = languageModuleById("de");
  const zh = languageModuleById("zh");
  const ko = languageModuleById("ko");
  check(ja.isHoverableChar("魔"), "Japanese kanji should be hoverable");
  check(!ja.isHoverableChar("r"), "Latin should not be Japanese-hoverable");
  check(en.isHoverableChar("r"), "Latin should be English-hoverable");
  check(ja.lookupMode === "yomitan-japanese", "Japanese should declare Yomitan/HoshiDicts mode");
  check(en.lookupMode === "exact", "English should declare exact lookup mode");
  check(fr.lookupMode === "exact", "French should declare exact lookup mode");
  check(de.lookupMode === "exact", "German should declare exact lookup mode");
  check(zh.lookupMode === "prefix", "Chinese should declare prefix lookup mode");
  check(ko.lookupMode === "exact", "Korean should declare exact lookup mode");
  check(typeof en.dictionaryMatches === "function", "English should expose dictionary compatibility checks");
  check(typeof fr.dictionaryMatches === "function", "French should expose dictionary compatibility checks");
  check(typeof de.dictionaryMatches === "function", "German should expose dictionary compatibility checks");
  check(ja.lookupUnit === "character", "Japanese should use character lookup units");
  check(en.lookupUnit === "word", "English should use word lookup units");
  check(fr.lookupUnit === "word", "French should use word lookup units");
  check(de.lookupUnit === "word", "German should use word lookup units");
  check(zh.lookupUnit === "character", "Chinese should use character lookup units");
  const englishText = "I am running fast";
  const enReq = en.lookupRequest(englishText, charsOf(englishText).indexOf("n"), 24);
  check(enReq && enReq.lookupText === "running", "English hover inside running should query running");
  check(enReq && enReq.suffix !== "nning", "English should not query partial rightward suffixes");
  check(enReq && enReq.backendMode === "exact", "English should use exact lookup");
  check(enReq && enReq.cacheStrategy === "word-span", "English should use word-span cache semantics");
  check(en.lookupRequest("RUNNING", 1, 24).lookupText === "running", "English should lowercase lookup text");
  check(en.lookupRequest("Don't", 1, 24).lookupText === "don't", "English should preserve apostrophes while lowercasing");
  const frReq = fr.lookupRequest("L’Homme", 2, 24);
  check(frReq && frReq.candidates.some(c => c.text === "homme"), "French should generate elision-tail candidates");
  const deReq = de.lookupRequest("Ich stehe morgen früh auf.", 5, 24);
  check(deReq && deReq.candidates.some(c => c.text === "aufstehen"), "German should generate split-verb candidates");
  check(fr.lookupRequest("mangent", 2, 24).candidates.some(c => c.text === "manger"), "French should load Yomitan present-indicative rules");
  check(de.lookupRequest("Die Sammlung ist groß", 5, 24).candidates.some(c => c.text === "sammeln"), "German should load Yomitan -lung rules");
  const zhReq = zh.lookupRequest("我喜欢中文", 0, 4);
  check(zhReq && zhReq.lookupText === "我喜欢中" && zhReq.backendMode === "prefix", "Chinese should use bounded prefix lookup");
  const jaReq = ja.lookupRequest("魔法使い", 1, 24);
  check(jaReq && jaReq.lookupText === "法使い", "Japanese should keep rightward-prefix lookup");
  check(jaReq && jaReq.cacheStrategy === "exact-position", "Japanese should keep exact-position cache semantics");
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
  check(["dark", "light", "inherit"].indexOf(cfg.popupTheme) >= 0, "popupTheme should be sent to overlay");
  check(["dark", "light", ""].indexOf(cfg.popupThemeHint || "") >= 0, "popupThemeHint should resolve to a concrete hint when present");
  check(cfg.etymologyCollapseDefault === "collapsed" || cfg.etymologyCollapseDefault === "expanded", "etymologyCollapseDefault should be sent to overlay");
  check(["collapsed", "expanded", "inherit"].indexOf(cfg.wiktionaryEtymologyCollapseOverride) >= 0, "wiktionaryEtymologyCollapseOverride should be sent to overlay");
  check(typeof cfg.customPopupCss === "string", "customPopupCss should be sent to overlay as a string");
  check(typeof prefBool("directWorkerIpc", true) === "boolean", "directWorkerIpc should be boolean-readable");
  check(typeof prefBool("fallbackToClientExec", true) === "boolean", "fallbackToClientExec should be boolean-readable");
  check(Number.isFinite(prefNumber("directIpcPollMs", 2)), "directIpcPollMs should be numeric");
  check(Number.isFinite(prefNumber("workerIdleSleepMs", 2)), "workerIdleSleepMs should be numeric");
  if (failures.length) alert("Settings audit checks failed:\n" + failures.join("\n"));
  else alert("Settings audit checks passed.");
}
async function testBackendLookup() {
  const result = await lookupAtPosition("魔法をかけられるのは魔法使いだけだ", 0);
  const count = result && result.results ? result.results.length : 0;
  alert("Lookup test returned " + count + " result(s). Top match: " + (count ? result.results[0].matched : "none"));
}
async function restartBackendWorkerFromMenu() {
  const language = selectedLanguageModule();
  await stopBackendWorker();
  await ensureBackendWorker(activeDictionaryPaths(language), language);
  alert("Dictionary lookup restarted for " + language.label + ".");
}
async function stopBackendWorkerFromMenu() {
  await stopBackendWorker();
  alert("Dictionary lookup stopped.");
}
function showInstalledDictionaries() {
  const dicts = dictionaryDirs();
  const disabled = disabledDictionaryMap();
  if (!dicts.length) { alert("No dictionaries installed yet. Download recommended dictionaries or import a Yomitan dictionary ZIP."); return; }
  alert("Installed dictionaries:\n\n" + dicts.map(d => (disabled[d.name] ? "[off] " : "[on] ") + d.name).join("\n"));
}
function emitDebugLogTestMessage() {
  debugLog("DEBUG TEST: plugin main log path works; enabled=" + String(enabled) + " lineId=" + currentSubtitleLineId + " bridgePort=" + overlayBridgePort);
  debugWarn("DEBUG TEST: warning level message");
  debugError("DEBUG TEST: error level message");
  flushDebugLogBuffer();
  alert("Debug log test messages were emitted. Use Reveal Debug Log File to inspect debug.log.");
}
function revealPathInFinder(path, label) {
  const p = String(path || "");
  if (!p) throw new Error("No path provided.");
  try {
    if (utils && typeof utils.open === "function" && utils.open(p)) {
      debugLog("revealed " + String(label || "path") + " via utils.open path=" + JSON.stringify(p));
      return;
    }
  } catch (error) {
    debugWarn("utils.open failed for " + String(label || "path") + ": " + compactError(error));
  }
  try {
    if (file && typeof file.showInFinder === "function") {
      const shown = file.showInFinder(p);
      if (shown !== false) {
        debugLog("revealed " + String(label || "path") + " via file.showInFinder path=" + JSON.stringify(p));
        return;
      }
    }
  } catch (error) {
    debugWarn("file.showInFinder failed for " + String(label || "path") + ": " + compactError(error));
  }
  throw new Error("Could not reveal " + String(label || "path") + ": " + p);
}
function revealDebugLogFile() {
  try {
    const p = dataPath("debug.log");
    flushDebugLogBuffer();
    if (!file.exists(p)) file.write(p, "");
    revealPathInFinder(p, "debug log file");
  } catch (error) {
    alert("Could not reveal debug.log: " + compactError(error));
  }
}
function revealPluginDataFolder() {
  try {
    revealPathInFinder(dataRoot(), "plugin data folder");
  } catch (error) {
    alert("Could not reveal plugin data folder: " + compactError(error));
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
    const language = selectedLanguageModule();
    const dicts = activeDictionaryPaths(language);
    if (!dicts.length) throw new Error("No enabled dictionaries installed.");
    await ensureBackendWorker(dicts, language);
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
  alert("Task panel test started. If a player window is loaded, the panel should be visible on the video overlay.");
}

function reportMenuActionError(label, error) {
  const msg = String(label || "Menu action") + " failed: " + compactError(error);
  debugError(msg);
  alert(msg);
}
function runMenuAction(label, action) {
  return () => {
    const actionLabel = String(label || "Menu action");
    debugLog("menu action clicked: " + actionLabel);
    try {
      const result = action();
      if (isPromiseLike(result)) result.catch(error => reportMenuActionError(actionLabel, error));
    } catch (error) {
      reportMenuActionError(actionLabel, error);
    }
  };
}
function addMenuCommand(parent, title, action, options) {
  addSubMenuItemCompat(parent, menu.item(title, runMenuAction(title, action), options));
}
function addDebugMenuItem(parent, title, action, options) {
  addMenuCommand(parent, title, action, options);
}

function rebuildMenu() {
  try { menu.removeAllItems(); } catch (_) {}
  try {
    const rootMenu = menu.item("iinatan");
    addMenuCommand(rootMenu, "Settings...", () => { openDictionaryManager(); });
    addSubMenuItemCompat(rootMenu, menu.separator());
    addSubMenuItemCompat(rootMenu, menu.item("Profiles", null, { enabled: false }));
    const profiles = profileSummaries(readManifest());
    const inlineProfileLimit = 5;
    const addProfileMenuItem = (parent, profile) => {
      addMenuCommand(parent, profile.name, () => { setActiveDictionaryProfile(profile.id); }, { selected: !!profile.active });
    };
    profiles.slice(0, inlineProfileLimit).forEach(profile => {
      addProfileMenuItem(rootMenu, profile);
    });
    if (profiles.length > inlineProfileLimit) {
      const moreMenu = menu.item("More");
      profiles.slice(inlineProfileLimit).forEach(profile => {
        addProfileMenuItem(moreMenu, profile);
      });
      addSubMenuItemCompat(rootMenu, moreMenu);
    }

    addSubMenuItemCompat(rootMenu, menu.separator());
    const debugMenu = menu.item("Debug");
    addDebugMenuItem(debugMenu, "Run Lookup Performance Benchmark", () => runLookupPerformanceBenchmark());
    addDebugMenuItem(debugMenu, "Run Lookup Parser Unit Tests", () => runLookupParserUnitTests());
    addDebugMenuItem(debugMenu, "Run Language Unit Tests", () => runLanguageUnitTests());
    addDebugMenuItem(debugMenu, "Run Settings Audit Checks", () => runSettingsAuditChecks());
    addDebugMenuItem(debugMenu, "Test File Picker API", () => testFilePickerApiFromMenu());
    addDebugMenuItem(debugMenu, "Test Dictionary Lookup", () => testBackendLookup());
    addDebugMenuItem(debugMenu, "Restart Dictionary Lookup", () => restartBackendWorkerFromMenu());
    addDebugMenuItem(debugMenu, "Stop Dictionary Lookup", () => stopBackendWorkerFromMenu());
    addDebugMenuItem(debugMenu, "Show Task Panel Test", () => showTaskPanelTest());
    addDebugMenuItem(debugMenu, "Emit Debug Log Test Message", () => emitDebugLogTestMessage());
    addDebugMenuItem(debugMenu, "Reveal Debug Log File", () => revealDebugLogFile());
    addDebugMenuItem(debugMenu, "Reveal Plugin Data Folder", () => revealPluginDataFolder());
    addSubMenuItemCompat(rootMenu, debugMenu);
    addMenuItemSafe(rootMenu);
  } catch (error) {
    console.error("Could not rebuild iinatan menu: " + compactError(error));
  }
}


registerShortcut();
rebuildMenu();
scheduleIINAAppearanceHintRefresh(true);
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
  flushDebugLogBuffer();
});
try {
  if (core.window.loaded) {
    initializeOverlay();
    setEnabled(prefBool("enabledByDefault", true));
  }
} catch (_) {}
