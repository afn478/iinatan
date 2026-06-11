function lookupPositionsForLine(text, scanLength) {
  const chars = charsOf(text);
  const positions = [];
  const limit = Math.min(chars.length, Math.max(1, prefNumber("maxLineLookupPositions", 64)));
  for (let i = 0; i < limit; i++) {
    if (isJapaneseish(chars[i])) positions.push(i);
  }
  return positions;
}
function scheduleLineLookupPrecompute(text, lineId) {
  if (lineLookupTimer !== null) {
    clearTimeout(lineLookupTimer);
    lineLookupTimer = null;
  }
  if (!enabled || !text || !isJapaneseish(text)) {
    postToOverlay("line-lookup-reset", { lineId });
    return;
  }
  lineLookupTimer = setTimeout(() => {
    lineLookupTimer = null;
    precomputeLineLookups(text, lineId).catch(error => {
      debugLog("line precompute top-level failed lineId=" + lineId + ": " + compactError(error));
      postToOverlay("line-lookup-progress", { lineId, ok: false, done: 0, total: 0, message: compactError(error) });
    });
  }, Math.max(20, prefNumber("lineLookupDelayMs", 120)));
}
async function precomputeLineLookups(text, lineId) {
  const clean = cleanSubtitleText(text);
  if (!enabled || lineId !== currentSubtitleLineId || !clean || !isJapaneseish(clean)) return;
  if (linePrecomputeActiveLineId && linePrecomputeActiveLineId === lineId) return;
  const dicts = activeDictionaryPaths();
  if (!dicts.length) {
    debugLog("line precompute skipped: no enabled dictionaries");
    postToOverlay("line-lookup-progress", { lineId, ok: false, done: 0, total: 0, message: "No enabled dictionaries are installed." });
    return;
  }
  const scanLength = Math.max(1, prefNumber("scanLength", 24));
  const positions = lookupPositionsForLine(clean, scanLength);
  if (!positions.length) return;
  const pending = positions.slice();
  const pendingSet = Object.create(null);
  positions.forEach(p => { pendingSet[p] = true; });
  const processed = Object.create(null);
  function takeNextPosition() {
    const pri = priorityLookupPositionsByLine[lineId] || [];
    while (pri.length) {
      const p = pri.shift();
      if (pendingSet[p] && !processed[p]) {
        const idx = pending.indexOf(p);
        if (idx >= 0) pending.splice(idx, 1);
        delete pendingSet[p];
        return p;
      }
    }
    const p = pending.shift();
    if (p !== undefined) delete pendingSet[p];
    return p;
  }

  debugLog("line precompute start lineId=" + lineId + " len=" + charsOf(clean).length + " positions=" + positions.length);
  postToOverlay("line-lookup-progress", { lineId, ok: true, done: 0, total: positions.length, message: "Preparing dictionary lookups…" });
  try {
    await ensureBackendWorker(dicts);
  } catch (error) {
    debugLog("line precompute worker failed lineId=" + lineId + ": " + compactError(error));
    postToOverlay("line-lookup-progress", { lineId, ok: false, done: 0, total: positions.length, message: "Dictionary lookup is not ready: " + compactError(error) });
    return;
  }

  linePrecomputeActiveLineId = lineId;
  let done = 0;
  try {
    while (pending.length || ((priorityLookupPositionsByLine[lineId] || []).length && done < positions.length)) {
      if (!enabled || lineId !== currentSubtitleLineId) {
        debugLog("line precompute cancelled lineId=" + lineId + " at done=" + done);
        return;
      }
      const pos = takeNextPosition();
      if (pos === undefined || processed[pos]) continue;
      processed[pos] = true;
      try {
        const result = await lookupAtPosition(clean, pos, null);
        done++;
        postToOverlay("line-lookup-result", { lineId, position: pos, ok: true, result });
        debugLog("line lookup result lineId=" + lineId + " pos=" + pos + " count=" + (result && result.results ? result.results.length : 0));
      } catch (error) {
        done++;
        const msg = compactError(error);
        postToOverlay("line-lookup-result", { lineId, position: pos, ok: false, error: msg });
        debugLog("line lookup failed lineId=" + lineId + " pos=" + pos + ": " + msg);
      }
      if (done === positions.length || done % 3 === 0) {
        postToOverlay("line-lookup-progress", { lineId, ok: true, done, total: positions.length, message: "Prepared " + done + "/" + positions.length + " lookup positions." });
      }
      await sleep(Math.max(0, prefNumber("lineLookupYieldMs", 10)));
    }
    debugLog("line precompute done lineId=" + lineId + " total=" + positions.length);
    postToOverlay("line-lookup-progress", { lineId, ok: true, done, total: positions.length, message: "Dictionary lookups ready." });
  } finally {
    if (linePrecomputeActiveLineId === lineId) linePrecomputeActiveLineId = 0;
  }
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
