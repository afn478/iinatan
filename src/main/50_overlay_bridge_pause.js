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
    });
    ws.onNewConnection((conn, info) => {
      rememberOverlayBridgeConnection(conn);
      debugLog(
        "overlay bridge connection=" +
          conn +
          " path=" +
          (info && info.path ? info.path : ""),
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
        if (
          payload &&
          typeof payload === "object" &&
          payload.type === "popup"
        ) {
          handleLookupPopupVisibility(payload);
        } else if (
          payload &&
          typeof payload === "object" &&
          payload.type === "lookup"
        ) {
          handleBridgeLookup(payload);
        } else if (
          payload &&
          typeof payload === "object" &&
          payload.type === "audio-source"
        ) {
          handleBridgeAudioSource(payload);
        } else if (
          payload &&
          typeof payload === "object" &&
          payload.type === "anki-card-status"
        ) {
          handleBridgeAnkiCardStatus(payload);
        } else if (
          payload &&
          typeof payload === "object" &&
          payload.type === "anki-card-add"
        ) {
          handleBridgeAnkiCardAdd(payload);
        } else if (
          payload &&
          typeof payload === "object" &&
          payload.type === "anki-card-open"
        ) {
          handleBridgeAnkiCardOpen(payload);
        } else if (
          payload &&
          typeof payload === "object" &&
          payload.type === "open-url"
        ) {
          openExternalUrlFromOverlay(payload.url);
        } else if (
          payload &&
          typeof payload === "object" &&
          payload.type === "overlay-log"
        ) {
          debugVerbose("[overlay] " + String(payload.message || ""));
        } else if (
          raw === "popup:show" ||
          raw === "show" ||
          raw === "visible"
        ) {
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
    throw new Error("Audio source did not return JSON: " + compactError(error));
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
async function fetchAudioSourceCandidates(sourceUrl) {
  const url = safeExternalHttpUrl(sourceUrl);
  if (!url) throw new Error("Invalid audio source URL.");
  const result = await utils.exec(
    "/usr/bin/curl",
    ["--silent", "--show-error", "--location", "--max-time", "8", url],
    dataRoot(),
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
          postToOverlay("line-lookup-result", {
            lineId,
            position,
            ok: false,
            error: "Subtitle line changed before lookup completed.",
          });
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
            lastSubtitle || "",
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
          if (!enabled || lineId !== currentSubtitleLineId) {
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
          if (!enabled || lineId !== currentSubtitleLineId) {
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
  clearLookupPopupWatchdog();
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
function scheduleLookupPopupWatchdog() {
  // Resume is driven by explicit overlay hide events. A heartbeat watchdog would
  // risk resuming during transient bridge delays, so keep this path inactive.
  clearLookupPopupWatchdog();
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
  clearLookupPopupWatchdog();
  lookupPopupPauseActive = false;
  lookupPopupPauseShouldResume = false;
  lookupPopupLastHeartbeatAt = 0;
  lookupPopupLastSeq = 0;
  lookupPopupSessionId = "";
}
