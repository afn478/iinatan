let ankiManagerStateCache = null;
let ankiManagerRefreshInFlight = false;
let ankiManagerRefreshSerial = 0;
let ankiModelFieldCache = Object.create(null);
let ankiActiveBridgeRequests = Object.create(null);
let ankiStatusCache = Object.create(null);
let ankiStatusInFlight = Object.create(null);
let ankiStatusQueueTail = Promise.resolve();
let ankiStatusQueuedCount = 0;
let ankiMediaRootReady = false;
let ankiMediaRootPromise = null;
let ankiFfmpegPathCache = "";

const ANKI_MEDIA_MAX_AUDIO_SECONDS = 35;
const ANKI_MEDIA_MAX_CACHE_PREROLL_SECONDS = 30;
const ANKI_MODEL_FIELD_CACHE_LIMIT = 32;
const ANKI_PASSIVE_STATUS_CACHE_MS = 5000;
const ANKI_PASSIVE_STATUS_CACHE_LIMIT = 80;
const ANKI_PASSIVE_STATUS_QUEUE_LIMIT = 4;

function ankiActiveProfilePreferences(overrides) {
  const manifest = readManifest();
  const profile = activeDictionaryProfile(manifest);
  return normalizeProfilePreferences(
    Object.assign({}, profile.preferences || {}, overrides || {}),
  );
}
function ankiFieldTemplatesFromPrefs(prefs) {
  return normalizeAnkiFieldTemplates(prefs && prefs.ankiFieldTemplatesJson);
}
function ankiProfileConfigured(prefs, preparedTemplates) {
  const templates =
    preparedTemplates || ankiFieldTemplatesFromPrefs(prefs || {});
  const hasTemplate = Object.keys(templates).some((field) =>
    String(templates[field] || "").trim(),
  );
  return !!(
    prefs &&
    prefs.ankiEnabled &&
    prefs.ankiConnectUrl &&
    prefs.ankiDeckName &&
    prefs.ankiModelName &&
    hasTemplate
  );
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
    modelName: prefs.ankiModelName,
  };
}
function dictionaryManagerAnkiState(profilePreferences) {
  const prefs = normalizeProfilePreferences(
    profilePreferences || ankiActiveProfilePreferences(),
  );
  const cached = ankiManagerStateCache || {};
  const fields =
    Array.isArray(cached.fields) && cached.modelName === prefs.ankiModelName
      ? cached.fields.slice()
      : [];
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
    modelNames: Array.isArray(cached.modelNames)
      ? cached.modelNames.slice()
      : [],
    fields,
  };
}
function ankiFieldCacheKey(prefs) {
  return (
    String((prefs && prefs.ankiConnectUrl) || "") +
    "\n" +
    String((prefs && prefs.ankiModelName) || "")
  );
}
function postDictionaryManagerAnkiState() {
  try {
    postToDictionaryManager(
      "dictionary-manager-anki-state",
      dictionaryManagerAnkiState(),
    );
  } catch (error) {
    debugWarn("could not build Anki manager state: " + compactError(error));
  }
}
function refreshDictionaryManagerAnkiState(overrides) {
  const serial = ++ankiManagerRefreshSerial;
  const prefs = ankiActiveProfilePreferences(overrides || {});
  ankiManagerRefreshInFlight = true;
  ankiManagerStateCache = Object.assign({}, ankiManagerStateCache || {}, {
    reachable: false,
    message: "Checking AnkiConnect...",
    checkedAt: Date.now(),
    modelName: prefs.ankiModelName,
  });
  postDictionaryManagerAnkiState();
  (async () => {
    try {
      const invokeOptions = {
        url: prefs.ankiConnectUrl,
        timeoutSeconds: 4,
        preferences: prefs,
      };
      const [version, deckNames, modelNames] = await Promise.all([
        ankiConnectInvoke("version", {}, invokeOptions),
        ankiConnectInvoke("deckNames", {}, invokeOptions),
        ankiConnectInvoke("modelNames", {}, invokeOptions),
      ]);
      let fields = [];
      if (
        prefs.ankiModelName &&
        Array.isArray(modelNames) &&
        modelNames.indexOf(prefs.ankiModelName) >= 0
      ) {
        fields = await ankiConnectInvoke(
          "modelFieldNames",
          { modelName: prefs.ankiModelName },
          invokeOptions,
        );
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
        modelName: prefs.ankiModelName,
      };
      putBoundedCache(
        ankiModelFieldCache,
        ankiFieldCacheKey(prefs),
        ankiManagerStateCache.fields.slice(),
        ANKI_MODEL_FIELD_CACHE_LIMIT,
      );
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
        modelName: prefs.ankiModelName,
      };
    } finally {
      if (serial === ankiManagerRefreshSerial) {
        ankiManagerRefreshInFlight = false;
        postDictionaryManagerAnkiState();
      }
    }
  })();
}
function ankiMediaTitleFromMpv() {
  const props = [
    "media-title",
    "metadata/by-key/title",
    "metadata/by-key/Title",
    "filename/no-ext",
    "filename",
  ];
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
  return currentMediaSourceSnapshot().display.raw;
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
function ankiCardContextFromPayload(payload) {
  return ankiBuildCardContext(payload, {
    lastSubtitle,
    documentTitle: ankiMediaTitleFromMpv(),
    sourcePath: ankiSourcePathFromMpv(),
    timePos: ankiTimePosFromMpv(),
  });
}
async function ankiStoreMediaFile(filename, path, prefs) {
  if (!filename || !path) return "";
  const stored = await ankiConnectInvoke(
    "storeMediaFile",
    {
      filename,
      path,
      deleteExisting: true,
    },
    { url: prefs.ankiConnectUrl, timeoutSeconds: 20, preferences: prefs },
  );
  return String(stored || filename);
}
async function ankiStoreMediaUrl(filename, url, prefs) {
  if (!filename || !url) return "";
  const stored = await ankiConnectInvoke(
    "storeMediaFile",
    {
      filename,
      url,
      deleteExisting: true,
    },
    { url: prefs.ankiConnectUrl, timeoutSeconds: 20, preferences: prefs },
  );
  return String(stored || filename);
}
async function ankiMediaFileHashHex(path) {
  try {
    const result = await utils.exec("/sbin/md5", ["-q", path], dataRoot());
    const match =
      result && result.status === 0
        ? String(result.stdout || "").match(/\b([0-9a-f]{8,40})\b/i)
        : null;
    if (match) return match[1].toLowerCase().slice(0, 12);
  } catch (error) {
    debugVerbose("Anki media hash failed: " + compactError(error));
  }
  return ankiRandomHex(12);
}
function ankiMediaPath(filename) {
  return dataPath("anki-media", filename);
}
async function ensureAnkiMediaRoot() {
  if (ankiMediaRootReady) return;
  if (ankiMediaRootPromise) return ankiMediaRootPromise;
  const promise = utils
    .exec("/bin/mkdir", ["-p", dataPath("anki-media")], dataRoot())
    .then((result) => {
      if (!result || result.status !== 0)
        throw new Error("Could not create the Anki media directory.");
      ankiMediaRootReady = true;
    });
  ankiMediaRootPromise = promise;
  try {
    await promise;
  } finally {
    if (ankiMediaRootPromise === promise) ankiMediaRootPromise = null;
  }
}
function ankiMpvGetProperty(name) {
  try {
    return mpv.getString(name);
  } catch (_) {}
  try {
    return mpv.getNumber(name);
  } catch (_) {}
  return undefined;
}
function ankiMpvSetProperty(name, value) {
  try {
    mpv.set(name, value);
    return true;
  } catch (_) {}
  try {
    mpv.command("set", [name, String(value)]);
    return true;
  } catch (_) {}
  return false;
}
function ankiAlignedCacheAudioWindow(start, end) {
  const previousA = ankiMpvGetProperty("ab-loop-a");
  const previousB = ankiMpvGetProperty("ab-loop-b");
  let changedA = false;
  let changedB = false;
  try {
    changedA = ankiMpvSetProperty("ab-loop-a", start);
    changedB = ankiMpvSetProperty("ab-loop-b", end);
    if (!changedA || !changedB) return null;
    mpv.command("ab-loop-align-cache", []);
    const alignedStart = Number(ankiMpvGetProperty("ab-loop-a"));
    const seek = start - alignedStart;
    if (
      !Number.isFinite(alignedStart) ||
      alignedStart < 0 ||
      seek < -0.001 ||
      seek > ANKI_MEDIA_MAX_CACHE_PREROLL_SECONDS
    )
      return null;
    return {
      dumpStart: start,
      dumpEnd: end,
      seek: Math.max(0, seek),
    };
  } catch (error) {
    debugVerbose("Anki cache audio alignment failed: " + compactError(error));
    return null;
  } finally {
    if (changedA)
      ankiMpvSetProperty(
        "ab-loop-a",
        previousA !== undefined && previousA !== null && previousA !== ""
          ? previousA
          : "no",
      );
    if (changedB)
      ankiMpvSetProperty(
        "ab-loop-b",
        previousB !== undefined && previousB !== null && previousB !== ""
          ? previousB
          : "no",
      );
  }
}
async function ankiCaptureScreenshot(context, prefs) {
  await ensureAnkiMediaRoot();
  const documentName = context.documentTitle || "video";
  const tempFilename = ankiMediaFilename(
    documentName,
    ankiRandomHex(12),
    "jpg",
  );
  const path = ankiMediaPath(tempFilename);
  const quality = normalizeAnkiImageQuality(prefs && prefs.ankiImageQuality);
  const previousQuality = ankiMpvGetProperty("screenshot-jpeg-quality");
  const didSetQuality = ankiMpvSetProperty("screenshot-jpeg-quality", quality);
  try {
    try {
      mpv.command("screenshot-to-file", [path, "video"]);
    } catch (error) {
      throw new Error("Could not capture screenshot: " + compactError(error));
    }
    for (let i = 0; i < 25; i++) {
      try {
        if (file.exists(path)) {
          const filename = ankiMediaFilename(
            documentName,
            await ankiMediaFileHashHex(path),
            "jpg",
          );
          return await ankiStoreMediaFile(filename, path, prefs);
        }
      } catch (_) {}
      await sleep(40);
    }
  } finally {
    safeDelete(path);
    if (
      didSetQuality &&
      previousQuality !== undefined &&
      previousQuality !== null &&
      previousQuality !== ""
    ) {
      ankiMpvSetProperty("screenshot-jpeg-quality", previousQuality);
    }
  }
  throw new Error("Screenshot file was not created.");
}
async function ankiFindFfmpegPath() {
  if (ankiFfmpegPathCache) return ankiFfmpegPathCache;
  const candidates = [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/Applications/IINA.app/Contents/MacOS/ffmpeg",
  ];
  for (let i = 0; i < candidates.length; i++) {
    try {
      if (file.exists(candidates[i])) {
        ankiFfmpegPathCache = candidates[i];
        return candidates[i];
      }
    } catch (_) {}
  }
  try {
    const result = await utils.exec("/usr/bin/which", ["ffmpeg"], dataRoot());
    const path = String((result && result.stdout) || "")
      .trim()
      .split(/\r?\n/)[0];
    if (result && result.status === 0 && path) {
      ankiFfmpegPathCache = path;
      return path;
    }
  } catch (_) {}
  return "";
}
async function ankiCaptureSentenceAudio(context, prefs) {
  const mediaSources = currentMediaSourceSnapshot();
  const source = mediaSources.audio;
  const ffmpegPath = await ankiFindFfmpegPath();
  if (!ffmpegPath)
    throw new Error("ffmpeg was not found for sentence audio capture.");
  const subStart = ankiSubtitleBoundary("sub-start");
  const subEnd = ankiSubtitleBoundary("sub-end");
  const current = context.timePos || ankiTimePosFromMpv();
  const padding = Math.max(
    0,
    Math.min(2, Number(prefs.ankiSentenceAudioPaddingMs || 0) / 1000),
  );
  let start = subStart !== null ? subStart : Math.max(0, current - 1.5);
  let end =
    subEnd !== null && subEnd > start
      ? subEnd
      : Math.min(start + 4, current + 2.5);
  start = Math.max(0, start - padding);
  end = Math.max(start + 0.25, end + padding);
  if (end - start > ANKI_MEDIA_MAX_AUDIO_SECONDS)
    end = start + ANKI_MEDIA_MAX_AUDIO_SECONDS;
  const duration = Math.max(0.25, end - start);
  const format = normalizeAnkiAudioFormat(prefs.ankiAudioFormat);
  const bitrate = normalizeAnkiAudioBitrateKbps(
    prefs && prefs.ankiAudioBitrateKbps,
  );
  const ext = format === "opus" ? "opus" : "mp3";
  const documentName = context.documentTitle || "video";
  const tempFilename = ankiMediaFilename(documentName, ankiRandomHex(12), ext);
  const outPath = ankiMediaPath(tempFilename);
  const cachedPath = ankiMediaPath(
    ankiMediaFilename(documentName, ankiRandomHex(12), "mkv"),
  );
  await ensureAnkiMediaRoot();
  try {
    const codecArgs =
      format === "opus"
        ? ["-c:a", "libopus", "-b:a", String(bitrate) + "k"]
        : ["-codec:a", "libmp3lame", "-b:a", String(bitrate) + "k"];
    const ffmpegArgs = (input, seek) =>
      [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        String(seek.toFixed(3)),
        "-i",
        input,
        "-t",
        String(duration.toFixed(3)),
        "-map",
        "0:a:0",
        "-vn",
        "-sn",
        "-dn",
        "-threads",
        "2",
      ].concat(codecArgs, [outPath]);
    let result = null;
    if (source.origin !== "selected-audio-track") {
      try {
        const cacheWindow = ankiAlignedCacheAudioWindow(start, end);
        if (cacheWindow) {
          mpv.command("dump-cache", [
            String(cacheWindow.dumpStart.toFixed(3)),
            String(cacheWindow.dumpEnd.toFixed(3)),
            cachedPath,
          ]);
        }
        if (cacheWindow && file.exists(cachedPath))
          result = await utils.exec(
            ffmpegPath,
            ffmpegArgs(cachedPath, cacheWindow.seek),
            dataRoot(),
          );
      } catch (error) {
        debugVerbose(
          "Anki cache audio fallback failed: " + compactError(error),
        );
      } finally {
        safeDelete(cachedPath);
      }
    }
    if (
      (!result || result.status !== 0 || !file.exists(outPath)) &&
      source.ffmpegReadable
    ) {
      result = await utils.exec(
        ffmpegPath,
        ffmpegArgs(source.locator, start),
        dataRoot(),
      );
    }
    if (!result || result.status !== 0 || !file.exists(outPath)) {
      const limitation = source.ffmpegReadable
        ? "ffmpeg failed"
        : "source is only readable by mpv and its current cache had no usable audio";
      throw new Error(
        "Sentence audio capture failed: " +
          String(
            (result && (result.stderr || result.stdout)) || limitation,
          ).slice(0, 500),
      );
    }
    const filename = ankiMediaFilename(
      documentName,
      await ankiMediaFileHashHex(outPath),
      ext,
    );
    return await ankiStoreMediaFile(filename, outPath, prefs);
  } finally {
    safeDelete(outPath);
  }
}
function ankiAudioUrlFromTemplate(template, context, prefs) {
  const values = {
    term: String(
      (context && context.audioTerm) || (context && context.expression) || "",
    ),
    reading: String(
      (context && context.audioReading) || (context && context.reading) || "",
    ),
    language: String((prefs && prefs.lookupLanguage) || ""),
  };
  return String(template || "").replace(/\{([^}]*)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
    try {
      return encodeURIComponent(values[key]);
    } catch (_) {
      return values[key];
    }
  });
}
function ankiUrlLooksLikeAudioFile(url) {
  return /\.(?:mp3|m4a|aac|ogg|oga|opus|wav|webm)(?:[?#]|$)/i.test(
    String(url || ""),
  );
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
    const sourceUrl = safeAnkiConnectUrl(
      ankiAudioUrlFromTemplate(source && source.url, context, prefs),
    );
    if (!sourceUrl) continue;
    if (ankiUrlLooksLikeAudioFile(sourceUrl)) return sourceUrl;
    try {
      if (typeof fetchAudioSourceCandidates === "function") {
        const candidates = await fetchAudioSourceCandidates(sourceUrl);
        if (Array.isArray(candidates) && candidates.length && candidates[0].url)
          return candidates[0].url;
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
    const filename = ankiMediaFilename(
      context.documentTitle || context.expression || "word",
      ankiRandomHex(12),
      ankiAudioExtensionFromUrl(url),
    );
    return await ankiStoreMediaUrl(filename, url, prefs);
  } catch (error) {
    debugVerbose("Anki word audio unavailable: " + compactError(error));
    return "";
  }
}
async function ankiCaptureNeededMedia(needs, context, prefs) {
  const media = {};
  const jobs = [];
  const allowCurrentMedia = !context || context.allowCurrentMedia !== false;
  if (needs.screenshot && allowCurrentMedia) {
    jobs.push(
      ankiCaptureScreenshot(context, prefs).then((value) => {
        media.screenshot = value;
      }),
    );
  }
  if (needs.sentenceAudio && allowCurrentMedia) {
    jobs.push(
      ankiCaptureSentenceAudio(context, prefs).then((value) => {
        media.sentenceAudio = value;
      }),
    );
  }
  if (needs.wordAudio) {
    jobs.push(
      ankiStoreWordAudio(context, prefs).then((value) => {
        if (value) media.wordAudio = value;
      }),
    );
  }
  if (jobs.length) await Promise.all(jobs);
  return media;
}
async function ankiConfiguredFieldNames(prefs) {
  const key = ankiFieldCacheKey(prefs);
  if (Array.isArray(ankiModelFieldCache[key]))
    return ankiModelFieldCache[key].slice();
  try {
    const fields = await ankiConnectInvoke(
      "modelFieldNames",
      { modelName: prefs.ankiModelName },
      { url: prefs.ankiConnectUrl, timeoutSeconds: 8, preferences: prefs },
    );
    const out = Array.isArray(fields) ? fields : [];
    putBoundedCache(
      ankiModelFieldCache,
      key,
      out.slice(),
      ANKI_MODEL_FIELD_CACHE_LIMIT,
    );
    return out;
  } catch (_) {
    return Object.keys(ankiFieldTemplatesFromPrefs(prefs));
  }
}
function ankiStableJson(value) {
  if (Array.isArray(value))
    return "[" + value.map((item) => ankiStableJson(item)).join(",") + "]";
  if (value && typeof value === "object") {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + ankiStableJson(value[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value === undefined ? null : value);
}
function ankiPassiveStatusCacheKey(prefs, fields) {
  return [
    safeAnkiConnectUrl(prefs && prefs.ankiConnectUrl),
    String((prefs && prefs.ankiDeckName) || ""),
    String((prefs && prefs.ankiModelName) || ""),
    String((prefs && prefs.ankiDuplicateScope) || ""),
    String((prefs && prefs.ankiDuplicateMode) || ""),
    ankiStableJson(fields || {}),
  ].join("\n");
}
function ankiCloneStatusPayload(payload) {
  const out = Object.assign({}, payload || {});
  if (Array.isArray(out.noteIds)) out.noteIds = out.noteIds.slice();
  return out;
}
function ankiRememberPassiveStatus(key, payload) {
  if (!key || !payload) return;
  ankiStatusCache[key] = {
    expiresAt: Date.now() + ANKI_PASSIVE_STATUS_CACHE_MS,
    payload: ankiCloneStatusPayload(payload),
  };
  const keys = Object.keys(ankiStatusCache);
  if (keys.length <= ANKI_PASSIVE_STATUS_CACHE_LIMIT) return;
  keys
    .sort(
      (a, b) =>
        Number(ankiStatusCache[a] && ankiStatusCache[a].expiresAt) -
        Number(ankiStatusCache[b] && ankiStatusCache[b].expiresAt),
    )
    .slice(0, keys.length - ANKI_PASSIVE_STATUS_CACHE_LIMIT)
    .forEach((oldKey) => {
      try {
        delete ankiStatusCache[oldKey];
      } catch (_) {}
    });
}
function ankiCachedPassiveStatus(key) {
  const cached = key ? ankiStatusCache[key] : null;
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    try {
      delete ankiStatusCache[key];
    } catch (_) {}
    return null;
  }
  return ankiCloneStatusPayload(cached.payload);
}
async function ankiDuplicateNotesForAdd(prefs, fields) {
  const cacheKey = ankiPassiveStatusCacheKey(prefs, fields);
  let status = ankiCachedPassiveStatus(cacheKey);
  if (status && status.duplicate) status = null;
  if (!status && ankiStatusInFlight[cacheKey])
    status = await ankiStatusInFlight[cacheKey];
  if (status && status.ok !== false)
    return {
      cacheKey,
      noteIds: status.duplicate ? ankiNormalizeNoteIds(status.noteIds) : [],
    };
  const fieldNames = await ankiConfiguredFieldNames(prefs);
  return {
    cacheKey,
    noteIds: await ankiFindDuplicateNotes(prefs, fields, fieldNames),
  };
}
function ankiPassiveStatusQueueBusyPayload() {
  return {
    ok: true,
    state: "ready",
    duplicate: false,
    noteIds: [],
    message: "Add Anki card",
  };
}
function ankiRunQueuedPassiveStatus(task) {
  ankiStatusQueuedCount++;
  const run = ankiStatusQueueTail.catch(() => {}).then(task);
  ankiStatusQueueTail = run.catch(() => {});
  return run.finally(() => {
    ankiStatusQueuedCount = Math.max(0, ankiStatusQueuedCount - 1);
  });
}
async function ankiCardStatusForContext(payload) {
  const prefs = ankiActiveProfilePreferences();
  const templates = ankiFieldTemplatesFromPrefs(prefs);
  if (!ankiProfileConfigured(prefs, templates))
    return {
      ok: false,
      state: "disabled",
      message: "Anki export is not configured.",
    };
  const context = ankiCardContextFromPayload(payload);
  const fields = renderAnkiFields(templates, context, {});
  const cacheKey = ankiPassiveStatusCacheKey(prefs, fields);
  const cached = ankiCachedPassiveStatus(cacheKey);
  if (cached) return cached;
  if (ankiStatusInFlight[cacheKey])
    return ankiCloneStatusPayload(await ankiStatusInFlight[cacheKey]);
  if (ankiStatusQueuedCount >= ANKI_PASSIVE_STATUS_QUEUE_LIMIT)
    return ankiPassiveStatusQueueBusyPayload();
  const task = ankiRunQueuedPassiveStatus(async () => {
    let duplicates = [];
    if (prefs.ankiDuplicateCheck) {
      const fieldNames = await ankiConfiguredFieldNames(prefs);
      duplicates = await ankiFindDuplicateNotes(prefs, fields, fieldNames);
    } else {
      await ankiRequireConnectable(prefs);
    }
    if (duplicates.length)
      return {
        ok: true,
        state: "duplicate",
        duplicate: true,
        noteIds: duplicates,
        message: "Duplicate found.",
      };
    return {
      ok: true,
      state: "ready",
      duplicate: false,
      noteIds: [],
      message: "Ready to add.",
    };
  });
  ankiStatusInFlight[cacheKey] = task;
  try {
    const status = await task;
    if (status && status.ok !== false)
      ankiRememberPassiveStatus(cacheKey, status);
    return ankiCloneStatusPayload(status);
  } finally {
    try {
      delete ankiStatusInFlight[cacheKey];
    } catch (_) {}
  }
}
function postAnkiCardState(requestId, payload) {
  const message = Object.assign(
    { type: "anki-card-state", requestId: String(requestId || "") },
    payload || {},
  );
  try {
    postToOverlayBridge(message);
  } catch (_) {}
  postToOverlay("anki-card-state", message);
}
function ankiBridgeRequestId(payload) {
  return payload && payload.requestId !== undefined
    ? String(payload.requestId)
    : "";
}
function ankiBridgeSessionId(payload) {
  return payload && payload.popupSessionId !== undefined
    ? String(payload.popupSessionId)
    : "";
}
function ankiBridgeRequestKey(type, payload) {
  const requestId = ankiBridgeRequestId(payload);
  const sessionId = ankiBridgeSessionId(payload);
  if (sessionId) return String(type || "") + ":" + sessionId + ":" + requestId;
  return String(type || "") + ":" + String(requestId || "");
}
function postAnkiCardStateForBridgePayload(payload, statePayload) {
  const sessionId = ankiBridgeSessionId(payload);
  const response = Object.assign({}, statePayload || {});
  if (sessionId && response.popupSessionId === undefined)
    response.popupSessionId = sessionId;
  postAnkiCardState(ankiBridgeRequestId(payload), response);
}
function beginAnkiBridgeRequest(type, payload, ackPayload) {
  const requestId = ankiBridgeRequestId(payload);
  const key = ankiBridgeRequestKey(type, payload);
  if (requestId && ankiActiveBridgeRequests[key]) {
    postAnkiCardStateForBridgePayload(
      payload,
      Object.assign({ ok: true, ack: true }, ackPayload || {}),
    );
    return false;
  }
  if (requestId) ankiActiveBridgeRequests[key] = true;
  postAnkiCardStateForBridgePayload(
    payload,
    Object.assign({ ok: true, ack: true }, ackPayload || {}),
  );
  return true;
}
function finishAnkiBridgeRequest(type, payload) {
  const requestId = ankiBridgeRequestId(payload);
  const key = ankiBridgeRequestKey(type, payload);
  if (!requestId || !ankiActiveBridgeRequests[key]) return;
  ankiActiveBridgeRequests[key] = "done";
  scheduleOneShot(() => {
    try {
      delete ankiActiveBridgeRequests[key];
    } catch (_) {}
  }, 60000);
}
function handleBridgeAnkiCardStatus(payload) {
  if (
    !beginAnkiBridgeRequest("anki-card-status", payload, { state: "checking" })
  )
    return;
  (async () => {
    try {
      const status = await ankiCardStatusForContext(payload);
      postAnkiCardStateForBridgePayload(payload, status);
    } catch (error) {
      postAnkiCardStateForBridgePayload(payload, {
        ok: false,
        state: "error",
        message: compactError(error),
      });
    } finally {
      finishAnkiBridgeRequest("anki-card-status", payload);
    }
  })();
}
function handleBridgeAnkiCardOpen(payload) {
  if (
    !beginAnkiBridgeRequest("anki-card-open", payload, {
      state: "opening",
      message: "Opening in Anki...",
    })
  )
    return;
  try {
    const prefs = ankiActiveProfilePreferences();
    const openedIds = ankiOpenDuplicateNotes(prefs, payload && payload.noteIds);
    postAnkiCardStateForBridgePayload(payload, {
      ok: true,
      state: "opened",
      noteIds: openedIds,
      message: "Reveal sent to Anki.",
    });
  } catch (error) {
    postAnkiCardStateForBridgePayload(payload, {
      ok: false,
      state: "error",
      message: compactError(error),
    });
  } finally {
    finishAnkiBridgeRequest("anki-card-open", payload);
  }
}
function handleBridgeAnkiCardAdd(payload) {
  if (
    !beginAnkiBridgeRequest("anki-card-add", payload, {
      state: "adding",
      message: "Adding Anki card...",
    })
  )
    return;
  (async () => {
    try {
      const prefs = ankiActiveProfilePreferences();
      const templates = ankiFieldTemplatesFromPrefs(prefs);
      if (!ankiProfileConfigured(prefs, templates))
        throw new Error("Anki export is not configured.");
      const context = ankiCardContextFromPayload(payload);
      let fields = renderAnkiFields(templates, context, {});
      let duplicates = [];
      let statusCacheKey = "";
      if (prefs.ankiDuplicateCheck && prefs.ankiDuplicateMode !== "allow") {
        const duplicateStatus = await ankiDuplicateNotesForAdd(prefs, fields);
        statusCacheKey = duplicateStatus.cacheKey;
        duplicates = duplicateStatus.noteIds;
      }
      if (duplicates.length && prefs.ankiDuplicateMode !== "allow") {
        const openedIds = ankiOpenDuplicateNotes(prefs, duplicates);
        postAnkiCardStateForBridgePayload(payload, {
          ok: true,
          state: "opened",
          duplicate: true,
          noteIds: openedIds,
          message: "Reveal sent to Anki.",
        });
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
        tags: ankiNoteTags(prefs),
      };
      let noteId = null;
      try {
        noteId = await ankiConnectInvoke(
          "addNote",
          { note },
          { url: prefs.ankiConnectUrl, timeoutSeconds: 20, preferences: prefs },
        );
      } catch (error) {
        if (
          prefs.ankiDuplicateCheck &&
          prefs.ankiDuplicateMode !== "allow" &&
          ankiErrorLooksDuplicate(compactError(error))
        ) {
          const fieldNames = await ankiConfiguredFieldNames(prefs);
          const lateDuplicates = await ankiFindNotesByDuplicateQuery(
            prefs,
            fields,
            fieldNames,
          );
          if (lateDuplicates.length) {
            const openedIds = ankiOpenDuplicateNotes(prefs, lateDuplicates);
            postAnkiCardStateForBridgePayload(payload, {
              ok: true,
              state: "opened",
              duplicate: true,
              noteIds: openedIds,
              message: "Reveal sent to Anki.",
            });
            return;
          }
        }
        throw error;
      }
      if (!ankiValidAddedNoteId(noteId))
        throw new Error("AnkiConnect did not return a note ID.");
      if (statusCacheKey)
        ankiRememberPassiveStatus(statusCacheKey, {
          ok: true,
          state: "duplicate",
          duplicate: true,
          noteIds: [noteId],
          message: "Duplicate found.",
        });
      postAnkiCardStateForBridgePayload(payload, {
        ok: true,
        state: "added",
        noteId,
        noteIds: ankiDisplayNoteIds([noteId]),
        message: "Added Anki card.",
      });
    } catch (error) {
      postAnkiCardStateForBridgePayload(payload, {
        ok: false,
        state: "error",
        message: compactError(error),
      });
    } finally {
      finishAnkiBridgeRequest("anki-card-add", payload);
    }
  })();
}
