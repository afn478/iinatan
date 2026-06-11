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
  try {
    const zipPath = utils.chooseFile("Choose a dictionary .zip", { allowedFileTypes: ["zip"] });
    if (!zipPath) return;
    await importDictionaryZip(zipPath);
  } catch (error) {
    const msg = "Could not add dictionary: " + compactError(error);
    setOverlayStatus(msg, "error", 12000);
    alert(msg);
  }
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
