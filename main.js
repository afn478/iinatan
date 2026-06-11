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

const IINATAN_ENGLISH_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;

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

  function lookupRequest(text, position) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    const run = common.findRun(chars, pos, isHoverableChar);
    if (!run) return null;
    const displayText = common.slice(chars, run.start, run.end);
    const lookupText = common.normalizeLatinLookup(displayText);
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
      cacheStrategy: "word-span",
      cacheKey: "word:" + run.start + ":" + run.end + ":" + lookupText
    };
  }

  return {
    id: "en",
    label: "English (experimental)",
    experimental: true,
    lookupUnit: "word",
    wordMode: "latin-word",
    lookupMode: "exact",
    deinflection: "none",
    deinflectionMode: "none",
    dictionaryCompatibility: "Yomitan-compatible term dictionaries; exact whole-word lookup only.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    lookupRequest
  };
})();

const IINATAN_FRENCH_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;
  const deinflect = IINATAN_DEINFLECTION;
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

  const transformer = deinflect.createTransformer({
    maxDepth: 3,
    maxResults: 72,
    conditions: [
      { name: "v", isDefault: true },
      { name: "n", isDefault: true },
      { name: "adj", isDefault: true },
      { name: "adv", isDefault: true },
      { name: "aux", isDefault: true }
    ],
    rules: [
      deinflect.wholeWordInflection("suis", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("es", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("est", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("sommes", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("êtes", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("sont", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("ai", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("as", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("a", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("avons", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("avez", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("ont", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("compris", "comprendre", "v", "v", "irregular past participle"),
      deinflect.suffixInflection("ées", "er", "v", "v", "past participle -ées"),
      deinflect.suffixInflection("ée", "er", "v", "v", "past participle -ée"),
      deinflect.suffixInflection("és", "er", "v", "v", "past participle -és"),
      deinflect.suffixInflection("é", "er", "v", "v", "past participle -é"),
      deinflect.suffixInflection("çons", "cer", "v", "v", "present -çons"),
      deinflect.suffixInflection("geons", "ger", "v", "v", "present -geons"),
      deinflect.suffixInflection("e", "er", "v", "v", "present -e"),
      deinflect.suffixInflection("es", "er", "v", "v", "present -es"),
      deinflect.suffixInflection("ons", "er", "v", "v", "present -ons"),
      deinflect.suffixInflection("ez", "er", "v", "v", "present -ez"),
      deinflect.suffixInflection("ent", "er", "v", "v", "present -ent"),
      deinflect.suffixInflection("is", "ir", "v", "v", "present -is"),
      deinflect.suffixInflection("it", "ir", "v", "v", "present -it"),
      deinflect.suffixInflection("issons", "ir", "v", "v", "present -issons"),
      deinflect.suffixInflection("issez", "ir", "v", "v", "present -issez"),
      deinflect.suffixInflection("issent", "ir", "v", "v", "present -issent"),
      deinflect.suffixInflection("amment", "ant", "adv", "adj", "adverb -amment"),
      deinflect.suffixInflection("emment", "ent", "adv", "adj", "adverb -emment"),
      deinflect.suffixInflection("ment", "", "adv", "adj", "adverb -ment")
    ]
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
      deinflect.appendTransforms(list, seen, list[i], transformer, "fr", 18);
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
    label: "French (experimental)",
    experimental: true,
    lookupUnit: "word",
    wordMode: "latin-word",
    lookupMode: "exact",
    deinflection: "yomitan-style-french",
    deinflectionMode: "yomitan-style-french",
    dictionaryCompatibility: "Yomitan-compatible French-headword term dictionaries; apostrophe/elision-aware exact lookup.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    generateCandidates,
    lookupRequest
  };
})();

const IINATAN_GERMAN_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;
  const deinflect = IINATAN_DEINFLECTION;
  const MAX_RIGHT_CONTEXT_CHARS = 96;
  const MAX_RIGHT_CONTEXT_WORDS = 12;
  const GERMAN_WORD_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ]+$/;
  const GERMAN_TOKEN_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
  const ABBREVIATIONS = [
    "bzw.", "bspw.", "ca.", "d.h.", "dr.", "etc.", "evtl.", "ggf.", "inkl.",
    "i.d.r.", "m.e.", "nr.", "prof.", "s.", "sog.", "u.a.", "u.u.", "usw.",
    "v.a.", "vgl.", "z.b.", "z.t.", "zzgl."
  ];
  const SEPARABLE_PREFIXES = [
    "ab", "an", "auf", "aus", "bei", "dar", "ein", "empor", "entgegen", "entlang",
    "fehl", "fern", "fest", "fort", "frei", "gegenüber", "gleich", "heim", "her",
    "herab", "heran", "herauf", "heraus", "herbei", "herein", "herüber", "herum",
    "herunter", "hervor", "hin", "hinab", "hinauf", "hinaus", "hinein", "hinüber",
    "hinunter", "hinweg", "hinzu", "hoch", "los", "mit", "nach", "nieder",
    "statt", "teil", "um", "vor", "voran", "voraus", "vorbei", "vorüber", "weg",
    "weiter", "wieder", "zu", "zurück", "zusammen"
  ];
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

  const transformer = deinflect.createTransformer({
    maxDepth: 3,
    maxResults: 80,
    conditions: [
      { name: "v", isDefault: true },
      { name: "n", isDefault: true },
      { name: "adj", isDefault: true }
    ],
    rules: [
      deinflect.suffixInflection("ungen", "en", "n", "v", "nominalization -ungen"),
      deinflect.suffixInflection("ung", "en", "n", "v", "nominalization -ung"),
      deinflect.suffixInflection("bar", "en", "adj", "v", "adjective -bar"),
      deinflect.prefixInflection("un", "", "adj", "adj", "negative un-"),
      deinflect.customInflection(getBasicPastParticiples, "v", "v", "past participle"),
      deinflect.customInflection(getSeparablePastParticiples, "v", "v", "separable past participle"),
      deinflect.customInflection(getZuInfinitives, "v", "v", "zu-infinitive"),
      deinflect.suffixInflection("heit", "", "n", "adj", "nominalization -heit"),
      deinflect.suffixInflection("keit", "", "n", "adj", "nominalization -keit")
    ]
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
    label: "German (experimental)",
    experimental: true,
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
  const language = selectedLanguageModule();
  const dicts = activeDictionaryPaths(language);
  debugLog("publishSubtitle lineId=" + currentSubtitleLineId + " language=" + language.id + " activeDicts=" + dicts.length + " len=" + String(normalized || "").length + " text=" + JSON.stringify(String(normalized || "").slice(0, 80)));
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
    const ready = readWorkerReady();
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
function dictionaryDirs() {
  try {
    if (!file.exists(dictRoot())) return [];
    const manifest = readManifest();
    return file.list(dictRoot(), { includeSubDir: false })
      .filter(item => item && item.isDir)
      .map(item => {
        const meta = readDictionaryIndexMetadata(item.path);
        const manifestEntry = (manifest.dictionaries && (manifest.dictionaries[item.filename] || manifest.dictionaries[meta.title])) || {};
        return {
          name: item.filename,
          path: item.path,
          title: meta.title || item.filename,
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
function disabledDictionaryMap() { return readManifest().disabled || {}; }
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
  if (lang.id === "ja") return "No dictionaries installed/enabled. Use Plugins -> iinatan -> Dictionaries -> Add Jitendex.";
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
  const paths = (dicts || activeDictionaryPaths(lang)).slice().sort();
  return JSON.stringify({ version: VERSION, language: lang.id || "ja", dictionaries: paths });
}
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
  const manifest = readManifest();
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
  await sleep(120);
}
async function startBackendWorkerProcess(dicts, language) {
  await ensureBundledBackendInstalled();
  await ensureDataDirs();
  await clearDirFiles(workerQueueDir());
  await clearDirFiles(workerResponseDir());
  safeDelete(workerStopPath());
  safeDelete(workerReadyPath());
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
  debugLog("ensureBackendWorker language=" + lang.id + " dictCount=" + dicts.length + " activeFingerprintMatches=" + String(activeWorkerFingerprint === fingerprint));
  if (activeWorkerFingerprint === fingerprint && readWorkerReady()) return readWorkerReady();
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
  debugLog("client exec lookup result requestId=" + String(requestId || "") + " elapsedMs=" + (Date.now() - lookupStartedAt) + " resultCount=" + (result && result.results ? result.results.length : "n/a"));
  return result;
}
async function lookupViaWorker(suffix, dicts, scanLength, maxResults, requestId, backendMode, maxGlossaries, language) {
  const lang = language || selectedLanguageModule();
  debugLog("lookupViaWorker begin requestId=" + String(requestId || "") + " language=" + lang.id + " suffix=" + JSON.stringify(String(suffix || "").slice(0, 80)) + " dicts=" + dicts.length + " mode=" + String(backendMode || "yomitan-japanese") + " directIpc=" + String(prefBool("directWorkerIpc", true)));
  if (requestId) postToOverlay("lookup-status", { requestId, message: "Preparing dictionary lookup..." });
  const timeout = Math.max(1500, prefNumber("lookupTimeoutMs", 9000));

  if (prefBool("directWorkerIpc", true)) {
    try {
      const result = await runWorkerQueueLookupDirect(suffix, dicts, scanLength, maxResults, requestId, timeout, backendMode, maxGlossaries, lang);
      if (requestId) postToOverlay("lookup-status", { requestId, message: "Dictionary result ready; rendering..." });
      return result;
    } catch (error) {
      debugWarn("direct worker lookup failed requestId=" + String(requestId || "") + ": " + compactError(error));
      if (!prefBool("fallbackToClientExec", true)) throw error;
    }
  }

  if (requestId) postToOverlay("lookup-status", { requestId, message: "Trying another lookup path..." });
  const result = await runWorkerLookupViaClientExec(suffix, dicts, scanLength, maxResults, requestId, timeout, backendMode, maxGlossaries, lang);
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
  debugVerbose("lookupAtPosition request language=" + language.id + " pos=" + pos + " request=" + JSON.stringify(request || {}));
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
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const candidateScanLength = Math.max(1, Number(candidate.scanLength) || charsOf(candidate.text).length || effectiveScanLength);
    debugVerbose("lookupAtPosition candidate language=" + language.id + " index=" + i + " text=" + JSON.stringify(candidate.text) + " source=" + String(candidate.source || "") + " reason=" + String(candidate.reason || ""));
    const candidateResult = await lookupViaWorker(candidate.text, dicts, candidateScanLength, maxResults, requestId, backendMode, maxGlossaries, language);
    debugVerbose("lookupAtPosition candidate result language=" + language.id + " index=" + i + " resultCount=" + (candidateResult && candidateResult.results ? candidateResult.results.length : 0));
    if (!result) result = candidateResult;
    if (candidateResult && candidateResult.results && candidateResult.results.length) {
      result = candidateResult;
      candidateUsed = candidate;
      debugVerbose("lookupAtPosition candidate matched language=" + language.id + " text=" + JSON.stringify(candidate.text) + " resultCount=" + candidateResult.results.length);
      break;
    }
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
  const ko = languageModuleById("ko");
  check(ja.isHoverableChar("魔"), "Japanese kanji should be hoverable");
  check(!ja.isHoverableChar("r"), "Latin should not be Japanese-hoverable");
  check(en.isHoverableChar("r"), "Latin should be English-hoverable");
  check(ja.lookupMode === "yomitan-japanese", "Japanese should declare Yomitan/HoshiDicts mode");
  check(en.lookupMode === "exact", "English should declare exact lookup mode");
  check(fr.lookupMode === "exact", "French should declare exact lookup mode");
  check(de.lookupMode === "exact", "German should declare exact lookup mode");
  check(ko.lookupMode === "exact", "Korean should declare exact lookup mode");
  check(typeof en.dictionaryMatches === "function", "English should expose dictionary compatibility checks");
  check(typeof fr.dictionaryMatches === "function", "French should expose dictionary compatibility checks");
  check(typeof de.dictionaryMatches === "function", "German should expose dictionary compatibility checks");
  check(ja.lookupUnit === "character", "Japanese should use character lookup units");
  check(en.lookupUnit === "word", "English should use word lookup units");
  check(fr.lookupUnit === "word", "French should use word lookup units");
  check(de.lookupUnit === "word", "German should use word lookup units");
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
      const language = selectedLanguageModule();
      await stopBackendWorker();
      await ensureBackendWorker(activeDictionaryPaths(language), language);
      alert("Dictionary lookup restarted for " + language.label + ".");
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
