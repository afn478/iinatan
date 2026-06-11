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
