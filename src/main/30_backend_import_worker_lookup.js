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

