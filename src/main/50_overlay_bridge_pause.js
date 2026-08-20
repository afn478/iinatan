const OVERLAY_BRIDGE_HANDLERS = {
  hello(payload) {
    if (payload.source !== "overlay")
      throw new Error("overlay bridge hello has an invalid source");
    if (typeof handleOverlayDocumentReady === "function")
      handleOverlayDocumentReady(payload, "bridge-hello");
  },
  popup(payload) {
    handleLookupPopupVisibility(payload);
  },
  lookup(payload) {
    handleBridgeLookup(payload);
  },
  "nested-lookup"(payload) {
    handleBridgeNestedLookup(payload);
  },
  "audio-source"(payload) {
    handleBridgeAudioSource(payload);
  },
  "anki-card-status"(payload) {
    handleBridgeAnkiCardStatus(payload);
  },
  "anki-card-add"(payload) {
    handleBridgeAnkiCardAdd(payload);
  },
  "anki-card-open"(payload) {
    handleBridgeAnkiCardOpen(payload);
  },
  "open-url"(payload) {
    if (typeof payload.url !== "string")
      throw new Error("open-url message is missing url");
    openExternalUrlFromOverlay(payload.url);
  },
  "controller-subtitle-seek"(payload) {
    handleControllerSubtitleSeek(payload);
  },
  "controller-resume-playback"() {
    handleControllerResumePlayback();
  },
  "controller-status"(payload) {
    handleControllerStatus(payload);
  },
  "controller-input"(payload) {
    handleControllerInput(payload);
  },
  "native-layout-diagnostic"(payload) {
    handleNativeLayoutDiagnostic(payload);
  },
  "native-layout-performance"(payload) {
    handleNativeLayoutPerformance(payload);
  },
  "overlay-log"(payload) {
    debugVerbose("[overlay] " + String(payload.message || ""));
  },
};

function handleControllerSubtitleSeek(payload) {
  const direction = Number(payload && payload.direction);
  if (direction !== -1 && direction !== 1) {
    debugWarn("ignored invalid controller subtitle seek direction");
    return false;
  }
  try {
    mpv.command("sub-seek", [String(direction)]);
    return true;
  } catch (error) {
    debugWarn("controller subtitle seek failed: " + compactError(error));
    return false;
  }
}
function handleControllerResumePlayback() {
  try {
    const resumed = setPauseState(false);
    if (resumed)
      debugLog("controller circle resumed playback without an open popup");
    return resumed;
  } catch (error) {
    debugWarn("controller playback resume failed: " + compactError(error));
    return false;
  }
}
function handleControllerStatus(payload) {
  const status = payload && typeof payload === "object" ? payload : {};
  debugLog(
    "controller status " +
      JSON.stringify({
        reason: String(status.reason || ""),
        apiAvailable: !!status.apiAvailable,
        connected: !!status.connected,
        recognized: !!status.recognized,
        gamepadCount: Number(status.gamepadCount || 0),
        id: String(status.id || ""),
        mapping: String(status.mapping || ""),
        buttonCount: Number(status.buttonCount || 0),
        axisCount: Number(status.axisCount || 0),
        enabled: !!status.enabled,
        windowActive: status.windowActive !== false,
        visible: status.visible !== false,
        allowed: !!status.allowed,
      }),
  );
}
function handleControllerInput(payload) {
  const input = payload && typeof payload === "object" ? payload : {};
  debugLog(
    "controller input " +
      JSON.stringify({
        event: String(input.event || ""),
        action: String(input.action || ""),
        direction: input.direction,
        sent: input.sent === undefined ? undefined : !!input.sent,
        pressed: Array.isArray(input.pressed) ? input.pressed : undefined,
        axes: input.axes || undefined,
        rawButtons: Array.isArray(input.rawButtons)
          ? input.rawButtons
          : undefined,
        rawAxes: Array.isArray(input.rawAxes) ? input.rawAxes : undefined,
        allowed: input.allowed === undefined ? undefined : !!input.allowed,
      }),
  );
}
function dispatchOverlayBridgePayload(payload) {
  const type =
    payload && typeof payload === "object" && typeof payload.type === "string"
      ? payload.type
      : "";
  const handler = OVERLAY_BRIDGE_HANDLERS[type];
  if (handler) {
    handler(payload);
    return true;
  }
  debugWarn(
    "ignored overlay bridge message type=" +
      JSON.stringify(type || "<missing>"),
  );
  return false;
}

function restartOverlayBridgeAfterFailure(error) {
  if (overlayBridgeRecovering || overlayBridgeRecoveryCount >= 8) return;
  overlayBridgeRecovering = true;
  overlayBridgeRecoveryCount++;
  const previousPort = overlayBridgePort;
  overlayBridgePort = nextOverlayBridgePort(previousPort);
  overlayBridgeConnections = Object.create(null);
  overlayBridgeLastConnection = null;
  try {
    debugWarn(
      "overlay bridge retry=" +
        overlayBridgeRecoveryCount +
        " previousPort=" +
        previousPort +
        " nextPort=" +
        overlayBridgePort +
        " reason=" +
        compactError(error),
    );
    ws.createServer({ port: overlayBridgePort });
    ws.startServer();
    postToOverlay("config", overlayConfig());
  } catch (restartError) {
    debugWarn("overlay bridge retry failed: " + compactError(restartError));
  } finally {
    overlayBridgeRecovering = false;
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
      debugLog(
        "overlay bridge state=" +
          String(state) +
          (error
            ? " error=" +
              compactError(error.message || error.description || error)
            : ""),
      );
      if (String(state) === "ready") overlayBridgeRecoveryCount = 0;
      else if (String(state) === "failed")
        restartOverlayBridgeAfterFailure(error || "listener failed");
    });
    ws.onNewConnection((conn, info) => {
      rememberOverlayBridgeConnection(conn);
      debugLog(
        "overlay bridge connection=" +
          conn +
          " path=" +
          (info && info.path ? info.path : ""),
      );
      if (typeof handleOverlayDocumentReady === "function")
        handleOverlayDocumentReady(
          { type: "connection", connection: String(conn || "") },
          "bridge-connection",
        );
    });
    ws.onConnectionStateUpdate((conn, state, error) => {
      if (/close|fail|error|cancel/i.test(String(state || "")))
        forgetOverlayBridgeConnection(conn);
      else rememberOverlayBridgeConnection(conn);
      debugLog(
        "overlay bridge conn=" +
          conn +
          " state=" +
          String(state) +
          (error
            ? " error=" +
              compactError(error.message || error.description || error)
            : ""),
      );
    });
    ws.onMessage((conn, message) => {
      try {
        rememberOverlayBridgeConnection(conn);
        const raw =
          message && typeof message.text === "function"
            ? String(message.text() || "")
            : "";
        debugVerbose("overlay bridge message=" + raw.slice(0, 200));
        let payload = raw;
        try {
          payload = JSON.parse(raw);
        } catch (_) {}
        dispatchOverlayBridgePayload(payload);
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
  const baseDir =
    basePath.charAt(basePath.length - 1) === "/"
      ? basePath
      : basePath.slice(0, basePath.lastIndexOf("/") + 1) || "/";
  return origin + baseDir + value;
}
function safeAudioCandidateUrl(rawUrl, baseUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  try {
    if (typeof URL === "function") {
      const parsed = new URL(value, baseUrl || undefined);
      if (parsed.protocol === "http:" || parsed.protocol === "https:")
        return parsed.href;
      return "";
    }
  } catch (_) {
    return "";
  }
  return fallbackResolveAudioCandidateUrl(value, baseUrl);
}
function audioCandidatesFromSourceJson(rawJson, sourceUrl) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(rawJson || ""));
  } catch (error) {
    const invalidJsonError = new Error(
      "Audio source did not return JSON: " + compactError(error),
    );
    invalidJsonError.audioSourceResponseNotJson = true;
    throw invalidJsonError;
  }
  if (
    !parsed ||
    parsed.type !== "audioSourceList" ||
    !Array.isArray(parsed.audioSources)
  ) {
    throw new Error("Audio source JSON was not a Yomitan audioSourceList.");
  }
  const out = [];
  parsed.audioSources.forEach((item) => {
    const url = safeAudioCandidateUrl(item && item.url, sourceUrl);
    if (!url) return;
    const name = String((item && item.name) || "").trim();
    out.push(name ? { name, url } : { url });
  });
  return out;
}
let audioSourceCandidatesInFlight = Object.create(null);
const AUDIO_SOURCE_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const AUDIO_SOURCE_REQUEST_TIMEOUT_MS = 8000;
function audioSourceUrlIsLoopback(url) {
  try {
    if (typeof URL === "function") {
      const hostname = String(new URL(url).hostname || "").toLowerCase();
      return (
        hostname === "127.0.0.1" ||
        hostname === "localhost" ||
        hostname === "::1" ||
        hostname === "[::1]"
      );
    }
  } catch (_) {}
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(
    String(url || ""),
  );
}
function audioSourceResponseByteLength(value) {
  const text = String(value || "");
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
    if (bytes > AUDIO_SOURCE_RESPONSE_MAX_BYTES) break;
  }
  return bytes;
}
async function fetchLoopbackAudioSourceCandidates(url) {
  let timer = null;
  try {
    const response = await Promise.race([
      http.get(url, { headers: { Accept: "application/json" } }),
      new Promise((_, reject) => {
        timer = scheduleOneShot(
          () =>
            reject(
              new Error("Audio source request timed out after 8 seconds."),
            ),
          AUDIO_SOURCE_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
    const status = Number(response && response.statusCode) || 0;
    if (status && (status < 200 || status >= 300))
      throw new Error(
        "Audio source request failed with status " + status + ".",
      );
    const body =
      response && response.text !== undefined
        ? String(response.text || "")
        : JSON.stringify((response && response.data) || "");
    if (audioSourceResponseByteLength(body) > AUDIO_SOURCE_RESPONSE_MAX_BYTES)
      throw new Error("Audio source response exceeded 4 MiB.");
    return audioCandidatesFromSourceJson(body, url);
  } finally {
    if (timer) cancelOneShot(timer);
  }
}
async function fetchAudioSourceCandidatesUncached(url) {
  if (
    audioSourceUrlIsLoopback(url) &&
    typeof http === "object" &&
    http &&
    typeof http.get === "function"
  )
    return fetchLoopbackAudioSourceCandidates(url);
  const result = await execExternalProcess(
    "/usr/bin/curl",
    [
      "--silent",
      "--show-error",
      "--location",
      "--proto",
      "=http,https",
      "--proto-redir",
      "=http,https",
      "--max-filesize",
      "4194304",
      "--max-time",
      "8",
      url,
    ],
    dataRoot(),
    null,
    null,
    EXTERNAL_PROCESS_PRIORITY_INTERACTIVE,
  );
  if (!result || result.status !== 0) {
    throw new Error(
      "Audio source request failed: " +
        String(
          (result && (result.stderr || result.stdout)) || "curl failed",
        ).slice(0, 500),
    );
  }
  return audioCandidatesFromSourceJson(result.stdout, url);
}
async function fetchAudioSourceCandidates(sourceUrl) {
  const url = safeExternalHttpUrl(sourceUrl);
  if (!url) throw new Error("Invalid audio source URL.");
  if (audioSourceCandidatesInFlight[url])
    return audioSourceCandidatesInFlight[url];
  const task = fetchAudioSourceCandidatesUncached(url);
  audioSourceCandidatesInFlight[url] = task;
  try {
    return await task;
  } finally {
    if (audioSourceCandidatesInFlight[url] === task)
      delete audioSourceCandidatesInFlight[url];
  }
}
function handleBridgeAudioSource(payload) {
  const requestId =
    payload && payload.requestId !== undefined ? String(payload.requestId) : "";
  const sourceUrl = String((payload && payload.url) || "");
  (async () => {
    try {
      const candidates = await fetchAudioSourceCandidates(sourceUrl);
      debugVerbose(
        "audio source resolved requestId=" +
          requestId +
          " url=" +
          JSON.stringify(sourceUrl) +
          " candidates=" +
          candidates.length,
      );
      postToOverlay("audio-source-result", { requestId, ok: true, candidates });
    } catch (error) {
      const msg = compactError(error);
      debugWarn(
        "audio source request failed requestId=" +
          requestId +
          " url=" +
          JSON.stringify(sourceUrl) +
          ": " +
          msg,
      );
      postToOverlay("audio-source-result", {
        requestId,
        ok: false,
        error: msg,
      });
    }
  })();
}

function safeExternalHttpUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(value)) return "";
  try {
    if (typeof URL === "function") {
      const parsed = new URL(value);
      if (parsed.protocol === "http:" || parsed.protocol === "https:")
        return parsed.href;
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
    debugWarn(
      "Rejected unsafe external URL from overlay: " +
        JSON.stringify(String(rawUrl || "").slice(0, 180)),
    );
    return false;
  }
  try {
    debugLog("Opening external dictionary URL: " + url);
    utils.open(url);
    return true;
  } catch (error) {
    const message =
      "Could not open external dictionary URL: " + compactError(error);
    debugWarn(message + " url=" + JSON.stringify(url));
    notify(message, "error", 8000);
    return false;
  }
}

function resetHoverLookupQueue() {
  hoverLookupGeneration++;
  pendingHoverLookup = null;
  hoverLookupActiveKey = "";
}
function hoverLookupJobIsCurrent(job) {
  return (
    !!job &&
    job.generation === hoverLookupGeneration &&
    enabled &&
    job.lineId === currentSubtitleLineId
  );
}
function handleBridgeLookup(payload) {
  const requestId =
    payload && payload.requestId !== undefined
      ? String(payload.requestId)
      : String(++requestSerial);
  const lineId = Number(
    payload && payload.lineId !== undefined
      ? payload.lineId
      : currentSubtitleLineId,
  );
  const position = Math.max(
    0,
    Number(payload && payload.position !== undefined ? payload.position : 0) ||
      0,
  );
  const key = String(lineId) + ":" + String(position);

  // Ack immediately. The overlay uses this to stop retrying the WebSocket lookup
  // request, so pause heartbeats + mouseenter spam cannot flood the lookup queue.
  postToOverlay("lookup-request-ack", { requestId, lineId, position });

  if (!enabled || lineId !== currentSubtitleLineId) {
    postToOverlay("line-lookup-result", {
      lineId,
      position,
      ok: false,
      error: "Subtitle line changed before lookup completed.",
    });
    return;
  }
  const lookupInput = subtitleLookupInputForLine(lineId);
  if (lookupInput === null) {
    postToOverlay("line-lookup-result", {
      lineId,
      position,
      ok: false,
      error: "Canonical subtitle lookup text is unavailable for this line.",
    });
    return;
  }

  if (
    hoverLookupActiveKey === key ||
    (pendingHoverLookup && pendingHoverLookup.key === key)
  ) {
    debugVerbose(
      "hover lookup duplicate ignored requestId=" +
        requestId +
        " key=" +
        key +
        " activeKey=" +
        hoverLookupActiveKey +
        " pendingKey=" +
        (pendingHoverLookup && pendingHoverLookup.key
          ? pendingHoverLookup.key
          : ""),
    );
    return;
  }

  pendingHoverLookup = {
    requestId,
    lineId,
    position,
    key,
    seq: ++hoverLookupSequence,
    generation: hoverLookupGeneration,
    lookupInput,
  };
  debugVerbose(
    "hover lookup queued requestId=" +
      requestId +
      " key=" +
      key +
      " currentLineId=" +
      currentSubtitleLineId +
      " inFlight=" +
      hoverLookupInFlight +
      " activeKey=" +
      hoverLookupActiveKey,
  );
  processHoverLookupQueue();
}
const activeNestedLookupRequests = Object.create(null);
function handleBridgeNestedLookup(payload) {
  const requestId =
    payload && payload.requestId !== undefined
      ? String(payload.requestId)
      : String(++requestSerial);
  const lineId = Number(
    payload && payload.lineId !== undefined
      ? payload.lineId
      : currentSubtitleLineId,
  );
  const text = String((payload && payload.text) || "").slice(0, 4000);
  const position = Math.max(
    0,
    Math.min(
      charsOf(text).length,
      Number(
        payload && payload.position !== undefined ? payload.position : 0,
      ) || 0,
    ),
  );
  const depth = Math.max(
    1,
    Math.min(99999, Math.round(Number((payload && payload.depth) || 1) || 1)),
  );
  postToOverlay("nested-lookup-ack", { requestId, lineId, depth });
  if (activeNestedLookupRequests[requestId]) return;
  const mode = String(
    activeProfilePreferenceValue("nestedPopupMode", "off") || "off",
  ).toLowerCase();
  const maxDepth = Math.max(
    1,
    Math.min(
      99999,
      Math.round(
        Number(activeProfilePreferenceValue("nestedPopupMaxDepth", 3)) || 3,
      ),
    ),
  );
  if (
    !enabled ||
    lineId !== currentSubtitleLineId ||
    depth > maxDepth ||
    (mode !== "hover" && mode !== "shift-hover" && mode !== "click")
  ) {
    postToOverlay("nested-lookup-result", {
      requestId,
      lineId,
      depth,
      ok: false,
      error:
        mode === "off"
          ? "Nested popup lookup is disabled."
          : depth > maxDepth
            ? "Nested popup depth exceeds the configured limit."
            : "Subtitle line changed before nested lookup completed.",
    });
    return;
  }
  if (!text.trim()) {
    postToOverlay("nested-lookup-result", {
      requestId,
      lineId,
      depth,
      ok: false,
      error: "No popup text was available to look up.",
    });
    return;
  }
  activeNestedLookupRequests[requestId] = true;
  (async () => {
    try {
      const result = await lookupAtPosition(text, position, requestId);
      postToOverlay("nested-lookup-result", {
        requestId,
        lineId,
        depth,
        position,
        ok: true,
        result,
      });
    } catch (error) {
      postToOverlay("nested-lookup-result", {
        requestId,
        lineId,
        depth,
        position,
        ok: false,
        error: compactError(error),
      });
    } finally {
      delete activeNestedLookupRequests[requestId];
    }
  })();
}
function processHoverLookupQueue() {
  if (hoverLookupInFlight) return;
  hoverLookupInFlight = true;
  (async () => {
    try {
      while (pendingHoverLookup) {
        const job = pendingHoverLookup;
        pendingHoverLookup = null;
        const { requestId, lineId, position, key, seq, lookupInput } = job;
        hoverLookupActiveKey = key;
        if (!hoverLookupJobIsCurrent(job)) {
          hoverLookupActiveKey = "";
          continue;
        }
        try {
          debugVerbose(
            "hover lookup start requestId=" +
              requestId +
              " key=" +
              key +
              " pendingNext=" +
              String(!!pendingHoverLookup),
          );
          const hoverStartedAt = Date.now();
          const result = await lookupAtPosition(
            lookupInput,
            position,
            requestId,
          );
          debugVerbose(
            "hover lookup completed requestId=" +
              requestId +
              " key=" +
              key +
              " elapsedMs=" +
              (Date.now() - hoverStartedAt),
          );
          if (!hoverLookupJobIsCurrent(job)) {
            hoverLookupActiveKey = "";
            continue;
          }
          postToOverlay("line-lookup-result", {
            lineId,
            position,
            ok: true,
            result,
            hover: true,
            requestId,
            seq,
          });
          debugVerbose(
            "hover lookup result requestId=" +
              requestId +
              " key=" +
              key +
              " count=" +
              (result && result.results ? result.results.length : 0),
          );
        } catch (error) {
          if (!hoverLookupJobIsCurrent(job)) {
            hoverLookupActiveKey = "";
            continue;
          }
          const msg = compactError(error);
          postToOverlay("line-lookup-result", {
            lineId,
            position,
            ok: false,
            error: msg,
            hover: true,
            requestId,
            seq,
          });
          debugLog(
            "hover lookup failed requestId=" +
              requestId +
              " key=" +
              key +
              ": " +
              msg,
          );
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
  try {
    return !!mpv.getFlag("pause");
  } catch (_) {}
  try {
    return !!core.status.paused;
  } catch (_) {}
  return false;
}
function setPauseState(paused) {
  try {
    mpv.set("pause", !!paused);
    return true;
  } catch (_) {}
  try {
    if (paused) core.pause();
    else core.resume();
    return true;
  } catch (_) {}
  return false;
}
function cancelLookupPopupResumeTimer() {
  lookupPopupPauseResumeToken++;
  if (lookupPopupPauseResumeTimer !== null) {
    cancelOneShot(lookupPopupPauseResumeTimer);
    lookupPopupPauseResumeTimer = null;
  }
}
function scheduleLookupPopupResume(reason) {
  cancelLookupPopupResumeTimer();
  const token = ++lookupPopupPauseResumeToken;
  lookupPopupPauseResumeTimer = scheduleOneShot(() => {
    if (token !== lookupPopupPauseResumeToken) return;
    lookupPopupPauseResumeTimer = null;
    if (!lookupPopupPauseShouldResume) return;
    if (lookupPopupPauseActive) {
      debugVerbose(
        "lookup popup resume skipped reason=" +
          String(reason || "unknown") +
          "; popup visible again",
      );
      return;
    }
    lookupPopupPauseShouldResume = false;
    if (!enabled) {
      debugVerbose(
        "lookup popup resume skipped reason=" +
          String(reason || "unknown") +
          "; plugin disabled",
      );
      return;
    }
    if (!pauseState()) {
      debugVerbose(
        "lookup popup resume skipped reason=" +
          String(reason || "unknown") +
          "; playback already running",
      );
      return;
    }
    if (setPauseState(false)) {
      debugLog(
        "lookup popup hidden reason=" +
          String(reason || "unknown") +
          "; resuming playback",
      );
    } else {
      debugWarn(
        "lookup popup hidden reason=" +
          String(reason || "unknown") +
          "; could not resume playback",
      );
    }
  }, LOOKUP_POPUP_RESUME_DELAY_MS);
  debugVerbose(
    "lookup popup hidden reason=" +
      String(reason || "unknown") +
      "; resume scheduled",
  );
}
function finishLookupPopupPause(reason, options) {
  const resume = !!(options && options.resume);
  if (
    !lookupPopupPauseActive &&
    !lookupPopupPauseShouldResume &&
    lookupPopupPauseResumeTimer === null
  )
    return;
  lookupPopupPauseActive = false;
  if (resume && lookupPopupPauseShouldResume) {
    scheduleLookupPopupResume(reason);
    return;
  }
  cancelLookupPopupResumeTimer();
  lookupPopupPauseShouldResume = false;
  debugVerbose(
    "lookup popup pause ended reason=" +
      String(reason || "unknown") +
      "; resume not owned",
  );
}
function lookupPopupSessionFromPayload(payload) {
  if (!payload || typeof payload !== "object") return "";
  return String(
    payload.popupSessionId || payload.sessionId || payload.session || "",
  );
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
      String(reason || "unknown"),
  );
  lookupPopupSessionId = nextSessionId;
  lookupPopupLastSeq = 0;
  finishLookupPopupPause(reason || "overlay-session-change");
}
function handleLookupPopupOverlayReady(payload) {
  noteLookupPopupSession(
    lookupPopupSessionFromPayload(payload),
    "overlay-ready",
  );
  lookupPopupLastSeq = 0;
  finishLookupPopupPause("overlay-ready");
}
function lookupPopupPauseEnabled() {
  try {
    return activeProfilePreferenceBool("pauseWhilePopupVisible", true);
  } catch (error) {
    debugWarn(
      "falling back to plugin popup pause preference: " + compactError(error),
    );
    return prefBool("pauseWhilePopupVisible", true);
  }
}
function handleLookupPopupVisibility(payload) {
  const visible =
    payload === true ||
    payload === "show" ||
    payload === "visible" ||
    (payload && !!payload.visible);
  const seq =
    payload && typeof payload === "object" && payload.seq !== undefined
      ? Number(payload.seq)
      : null;
  noteLookupPopupSession(
    lookupPopupSessionFromPayload(payload),
    "popup-visibility",
  );
  if (seq !== null && Number.isFinite(seq)) {
    if (seq < lookupPopupLastSeq) {
      debugLog(
        "ignoring stale popup visibility seq=" +
          seq +
          " lastSeq=" +
          lookupPopupLastSeq +
          " visible=" +
          String(visible),
      );
      return;
    }
    lookupPopupLastSeq = seq;
  }
  if (!lookupPopupPauseEnabled()) {
    finishLookupPopupPause("preference-disabled");
    debugVerbose(
      "popup visibility ignored because pauseWhilePopupVisible is disabled visible=" +
        String(visible) +
        " seq=" +
        String(seq),
    );
    return;
  }
  debugVerbose(
    "popup visibility event visible=" +
      String(visible) +
      " seq=" +
      String(seq) +
      " active=" +
      String(lookupPopupPauseActive) +
      " enabled=" +
      String(enabled),
  );
  if (visible) {
    if (!enabled) return;
    cancelLookupPopupResumeTimer();
    lookupPopupLastHeartbeatAt = Date.now();
    if (lookupPopupPauseActive) {
      if (lookupPopupPauseShouldResume && !pauseState()) {
        lookupPopupPauseShouldResume = setPauseState(true);
        debugLog(
          "lookup popup visible seq=" +
            String(seq) +
            "; playback was running again, pausing",
        );
      } else {
        debugVerbose(
          "lookup popup visible seq=" +
            String(seq) +
            "; preserving active pause ownership=" +
            String(lookupPopupPauseShouldResume),
        );
      }
      return;
    }
    lookupPopupPauseActive = true;
    if (lookupPopupPauseShouldResume) {
      if (!pauseState()) {
        lookupPopupPauseShouldResume = setPauseState(true);
        debugLog(
          "lookup popup visible seq=" +
            String(seq) +
            "; pausing playback after cancelled resume",
        );
      } else {
        debugVerbose(
          "lookup popup visible seq=" +
            String(seq) +
            "; cancelled pending resume",
        );
      }
      return;
    }
    if (!pauseState()) {
      lookupPopupPauseShouldResume = setPauseState(true);
      debugLog(
        "lookup popup visible seq=" +
          String(seq) +
          "; pausing playback resumeOwned=" +
          String(lookupPopupPauseShouldResume),
      );
    } else {
      lookupPopupPauseShouldResume = false;
      debugVerbose(
        "lookup popup visible seq=" + String(seq) + "; playback already paused",
      );
    }
    return;
  }
  debugVerbose("popup hidden received seq=" + String(seq));
  finishLookupPopupPause("hidden-seq-" + String(seq), { resume: true });
}
function resetLookupPopupPause() {
  cancelLookupPopupResumeTimer();
  lookupPopupPauseActive = false;
  lookupPopupPauseShouldResume = false;
  lookupPopupLastHeartbeatAt = 0;
  lookupPopupLastSeq = 0;
  lookupPopupSessionId = "";
}
