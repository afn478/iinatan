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
  if (seq !== null && Number.isFinite(seq)) {
    if (seq < lookupPopupLastSeq) {
      debugLog("ignoring stale popup visibility seq=" + seq + " lastSeq=" + lookupPopupLastSeq + " visible=" + String(visible));
      return;
    }
    lookupPopupLastSeq = seq;
  }
  if (!lookupPopupPauseEnabled()) {
    if (lookupPopupPauseActive) finishLookupPopupPause("preference-disabled");
    debugVerbose("popup visibility ignored because pauseWhilePopupVisible is disabled visible=" + String(visible) + " seq=" + String(seq));
    return;
  }
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
