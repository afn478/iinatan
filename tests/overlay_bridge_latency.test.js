const {
  assert,
  loadOverlayForTest,
} = require("./helpers/overlay_test_context");

function setupOverlay(options) {
  const { context, overlay } = loadOverlayForTest(
    [
      "state",
      "applyConfig",
      "renderSubtitle",
      "trySendLookupRequest",
      "subtitleEl",
      "popupEl",
    ],
    options,
  );
  overlay.applyConfig({
    language: {
      id: "ja",
      label: "Japanese",
      lookupUnit: "character",
      wordMode: "rightward-prefix",
    },
    overlayBridgePort: 19741,
    hoverRequestTimeoutMs: 5000,
    experimentalNativeSubtitleHitLayer: false,
  });
  context.__handlers.enabled({ enabled: true });
  overlay.renderSubtitle("毒物は ありません", 1);
  return { context, overlay };
}

function hoverFirstChar(overlay) {
  const el = overlay.subtitleEl.querySelector('.char.lookupable[data-pos="0"]');
  assert(
    el && el.listeners.mouseenter,
    "Expected the first character to be hoverable",
  );
  el.listeners.mouseenter({ currentTarget: el });
}

function messagesOfType(context, type) {
  return context.__sent.filter((message) => message.type === type);
}

function finishLookup(context) {
  const lookup = messagesOfType(context, "lookup")[0];
  assert(lookup, "Expected a lookup message before finishing the request");
  context.__handlers["line-lookup-result"]({
    lineId: lookup.lineId,
    position: lookup.position,
    ok: true,
    result: {
      ok: true,
      text: "毒物は ありません",
      position: lookup.position,
      lookupStart: lookup.position,
      lookupEnd: lookup.position + 1,
      matchStart: lookup.position,
      language: "ja",
      results: [],
    },
  });
}

{
  const { context, overlay } = setupOverlay();
  hoverFirstChar(overlay);
  const lookupIndex = context.__sent.findIndex(
    (message) => message.type === "lookup",
  );
  const popupIndex = context.__sent.findIndex(
    (message) => message.type === "popup" && message.visible === true,
  );
  assert(lookupIndex >= 0, "Open bridge hover should send lookup immediately");
  assert(
    popupIndex >= 0,
    "Open bridge hover should still send popup visibility",
  );
  assert(
    lookupIndex < popupIndex,
    "Lookup should be sent before popup visibility so pause handling cannot delay lookup",
  );
  assert(
    overlay.popupEl.classList.contains("lookup-pending"),
    "The provisional loading popup should remain visually pending",
  );
  finishLookup(context);
  assert(
    !overlay.popupEl.classList.contains("lookup-pending"),
    "A completed lookup should reveal the final popup",
  );
}

{
  const { context, overlay } = setupOverlay({ autoOpenWebSocket: false });
  hoverFirstChar(overlay);
  assert(
    messagesOfType(context, "lookup").length === 0,
    "Connecting bridge should not be able to send lookup before open",
  );
  context.__openSocket();
  const lookupIndex = context.__sent.findIndex(
    (message) => message.type === "lookup",
  );
  const popupIndex = context.__sent.findIndex(
    (message) => message.type === "popup" && message.visible === true,
  );
  assert(
    lookupIndex >= 0,
    "Pending lookup should flush as soon as the bridge opens",
  );
  assert(
    popupIndex >= 0,
    "Popup visibility should be sent after the bridge opens",
  );
  assert(
    lookupIndex < popupIndex,
    "Pending lookup flush should remain ahead of popup visibility after bridge open",
  );
  finishLookup(context);
}

{
  const { context, overlay } = setupOverlay({ autoOpenWebSocket: false });
  hoverFirstChar(overlay);
  const req = overlay.state.pendingLookupRequests[0];
  for (let attempt = 1; attempt < 6; attempt++)
    overlay.trySendLookupRequest(req);
  assert(
    context.__posted.some(
      (message) =>
        message.name === "line-lookup" && message.payload.lineId === 1,
    ),
    "a lookup should fall back to IINA messaging when the socket cannot open",
  );
  overlay.renderSubtitle("下一行", 2);
}

{
  const { context, overlay } = setupOverlay();
  const firstSocket = context.__sockets[0];
  overlay.applyConfig({ overlayBridgePort: 19742 });
  assert(firstSocket.readyState === 3, "the old bridge socket should close");
  assert(
    context.__sockets.at(-1).url === "ws://127.0.0.1:19742/overlay",
    "the overlay should reconnect to the replacement bridge port",
  );
}

{
  const { overlay } = setupOverlay();
  hoverFirstChar(overlay);
  assert(!overlay.popupEl.classList.contains("hidden"));
  overlay.renderSubtitle("新的字幕", 2);
  assert(
    overlay.popupEl.classList.contains("hidden") &&
      overlay.state.currentPos === null,
    "a changed subtitle line should not leave an orphaned loading popup",
  );
}

console.log("overlay bridge latency tests passed");
