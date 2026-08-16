const {
  assert,
  loadOverlayForTest,
} = require("./helpers/overlay_test_context");

function clickButton(button) {
  button.listeners.click({
    preventDefault() {},
    stopPropagation() {},
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeAnkiButton(context, id) {
  const group = context.document.createElement("span");
  group.className = "anki-action-group";
  group.dataset.ankiContextId = id;
  group.dataset.ankiState = "ready";
  group.dataset.ankiNoteIds = "[]";
  const forceButton = context.document.createElement("button");
  forceButton.className = "anki-button anki-add-anyway-button";
  forceButton.dataset.ankiRole = "force-add";
  forceButton.dataset.ankiState = "ready";
  forceButton.dataset.ankiAction = "add";
  forceButton.hidden = true;
  forceButton.disabled = true;
  const button = context.document.createElement("button");
  button.className = "anki-button anki-primary-button";
  button.dataset.ankiRole = "primary";
  button.dataset.ankiState = "ready";
  button.dataset.ankiAction = "add";
  group.appendChild(forceButton);
  group.appendChild(button);
  context.__elements.popup.appendChild(group);
  return button;
}

const overlayAnkiExports = [
  "state",
  "applyConfig",
  "audioTermReadingKey",
  "bindPopupAnkiButtons",
  "renderStoredLookup",
  "setAnkiButtonState",
  "showPopup",
  "updateAnkiCardState",
];

(async () => {
  const { context: renderContext, overlay: renderOverlay } = loadOverlayForTest(
    overlayAnkiExports,
    {
      autoOpenWebSocket: false,
    },
  );
  renderOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: "prevent" },
  });
  renderOverlay.showPopup(
    renderContext.document.createElement("span"),
    "猫",
    '<div class="loading">Loading...</div>',
  );
  renderOverlay.renderStoredLookup({
    ok: true,
    position: 0,
    result: {
      ok: true,
      language: "ja",
      text: "猫と犬",
      lookupStart: 0,
      lookupEnd: 1,
      results: [
        {
          matched: "猫",
          deinflected: "猫",
          term: { expression: "猫", reading: "ねこ", glossaries: [] },
        },
        {
          matched: "犬",
          deinflected: "犬",
          term: { expression: "犬", reading: "いぬ", glossaries: [] },
        },
      ],
    },
  });
  const renderedHeadHtml =
    renderContext.__elements.popup.children[0]._innerHTML;
  const renderedBodyHtml =
    renderContext.__elements.popup.children[1]._innerHTML;
  const headContextIds = Array.from(
    renderedHeadHtml.matchAll(/data-anki-context-id="([^"]+)"/g),
  ).map((match) => match[1]);
  const bodyContextIds = Array.from(
    renderedBodyHtml.matchAll(/data-anki-context-id="([^"]+)"/g),
  ).map((match) => match[1]);
  assert(
    headContextIds.length === 1,
    "Lookup result header should render its own Anki add button",
  );
  assert(
    bodyContextIds.length === 1,
    "Subsequent popup entries should render their own Anki add buttons",
  );
  assert(
    renderOverlay.state.ankiCardContexts[headContextIds[0]].expression === "猫",
    "Header Anki button should use the header entry headword",
  );
  assert(
    renderOverlay.state.ankiCardContexts[bodyContextIds[0]].expression === "犬",
    "Subsequent entry Anki buttons should use their own headword",
  );

  const { context, overlay } = loadOverlayForTest(overlayAnkiExports, {
    autoOpenWebSocket: false,
  });

  overlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: "prevent" },
  });
  overlay.state.ankiCardContexts.ctx1 = {
    lineId: 1,
    sentence: "私は猫です。",
    position: 2,
    expression: "猫",
    reading: "ねこ",
    audioTerm: "猫",
    audioReading: "ねこ",
    surface: "猫",
    entry: { term: { expression: "猫", reading: "ねこ", glossaries: [] } },
    result: {
      text: "私は猫です。",
      lookupStart: 2,
      lookupEnd: 3,
      language: "ja",
    },
  };
  overlay.state.audioAnkiSelections[overlay.audioTermReadingKey("猫", "ねこ")] =
    {
      sourceIndex: 1,
      sourceUrl: "http://127.0.0.1:5050/?term={term}&reading={reading}",
      candidateIndex: 2,
    };

  const addButton = makeAnkiButton(context, "ctx1");
  const selectedPopupText = context.document.createTextNode("cat; feline");
  context.__elements.popup.appendChild(selectedPopupText);
  context.window.getSelection = () => ({
    isCollapsed: false,
    anchorNode: selectedPopupText,
    focusNode: selectedPopupText,
    toString() {
      return "  cat;   feline  ";
    },
  });
  overlay.bindPopupAnkiButtons();
  clickButton(addButton);
  assert(
    context.__elements.status.textContent === "Adding Anki card...",
    "Anki add click should show immediate feedback",
  );
  const postedAdd = context.__posted.find(
    (message) => message.name === "anki-card-add",
  );
  assert(
    postedAdd,
    "Anki add clicks should immediately use IINA webview messaging even while the bridge socket is connecting",
  );
  assert(
    postedAdd.payload.popupSessionId === overlay.state.popupSessionId,
    "Direct Anki add messages should include the popup session ID",
  );
  assert(
    postedAdd.payload.context.popupSelectionText === "cat; feline",
    "Anki add requests should include manually selected popup text",
  );
  assert(
    postedAdd.payload.context.wordAudioSelection.sourceIndex === 1 &&
      postedAdd.payload.context.wordAudioSelection.candidateIndex === 2,
    "Anki add requests should include the popup's primary word-audio choice",
  );
  assert(
    !context.__sent.some((message) => message.type === "anki-card-add"),
    "Anki add should keep the WebSocket send as a bridge fallback while the socket is connecting",
  );
  await wait(1450);
  context.__openSocket();
  await wait(100);
  const sentAdd = context.__sent.find(
    (message) => message.type === "anki-card-add",
  );
  assert(
    sentAdd,
    "Anki add should use the WebSocket fallback when the direct post is not acknowledged",
  );
  assert(
    sentAdd.requestId === postedAdd.payload.requestId,
    "Bridge fallback should reuse the direct Anki request ID",
  );
  assert(
    sentAdd.popupSessionId === overlay.state.popupSessionId,
    "Anki add requests should include the popup session ID",
  );
  assert(
    sentAdd.context.popupSelectionText === "cat; feline",
    "Anki bridge fallback should preserve manually selected popup text",
  );
  overlay.updateAnkiCardState({
    requestId: sentAdd.requestId,
    popupSessionId: "stale-popup",
    ok: true,
    state: "added",
    noteId: 11111,
    noteIds: [11111],
    message: "Added Anki card.",
  });
  assert(
    addButton.dataset.ankiAction === "add",
    "Anki replies for stale popup sessions should be ignored",
  );
  overlay.updateAnkiCardState({
    requestId: sentAdd.requestId,
    ok: true,
    ack: true,
    state: "adding",
  });
  overlay.updateAnkiCardState({
    requestId: sentAdd.requestId,
    ok: true,
    state: "added",
    noteId: 24680,
    noteIds: [24680],
    message: "Added Anki card.",
  });
  assert(
    addButton.dataset.ankiAction === "open",
    "Added Anki buttons should become reveal actions",
  );
  assert(
    JSON.parse(addButton.parentNode.dataset.ankiNoteIds)[0] === 24680,
    "Added Anki buttons should preserve the new note ID",
  );
  assert(
    context.__elements.status.textContent === "Added Anki card." &&
      context.__elements.status.classList.contains("success"),
    "Added Anki status should use the success banner style",
  );
  await wait(2600);
  assert(
    context.__elements.status.classList.contains("hidden"),
    "Added Anki status should clear after its short confirmation",
  );

  const { context: retryContext, overlay: retryOverlay } =
    loadOverlayForTest(overlayAnkiExports);
  retryOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: "prevent" },
  });
  retryOverlay.state.ankiCardContexts.ctxRetry =
    overlay.state.ankiCardContexts.ctx1;
  const retryButton = makeAnkiButton(retryContext, "ctxRetry");
  retryOverlay.bindPopupAnkiButtons();
  const retryStatus = retryContext.__sent.find(
    (message) => message.type === "anki-card-status",
  );
  if (retryStatus)
    retryOverlay.updateAnkiCardState({
      requestId: retryStatus.requestId,
      ok: true,
      ack: true,
      state: "checking",
    });
  if (retryStatus)
    retryOverlay.updateAnkiCardState({
      requestId: retryStatus.requestId,
      ok: true,
      state: "ready",
      duplicate: false,
      noteIds: [],
    });
  retryContext.__sent.length = 0;
  retryContext.__posted.length = 0;
  clickButton(retryButton);
  await wait(20);
  const firstRetryAdd = retryContext.__sent.find(
    (message) => message.type === "anki-card-add",
  );
  assert(firstRetryAdd, "Anki add should prefer an already-open WebSocket");
  assert(
    !retryContext.__posted.some((message) => message.name === "anki-card-add"),
    "Anki add should wait for a WebSocket acknowledgement before using native fallback",
  );
  clickButton(retryButton);
  await wait(20);
  assert(
    retryContext.__sent.filter((message) => message.type === "anki-card-add")
      .length === 1,
    "Clicking again while an Anki add is in flight should not enqueue another add",
  );
  await wait(930);
  const addRetries = retryContext.__posted.filter(
    (message) => message.name === "anki-card-add",
  );
  assert(
    addRetries.length === 1,
    "Anki add should fall back to one native post when the WebSocket is not acknowledged",
  );
  retryOverlay.updateAnkiCardState({
    requestId: addRetries[0].payload.requestId,
    ok: true,
    ack: true,
    state: "adding",
  });
  await wait(980);
  assert(
    retryContext.__posted.filter((message) => message.name === "anki-card-add")
      .length === 1,
    "Anki add should not keep retrying after an acknowledgement",
  );
  retryOverlay.updateAnkiCardState({
    requestId: addRetries[0].payload.requestId,
    ok: true,
    state: "added",
    message: "Added Anki card.",
  });

  const { context: socketContext, overlay: socketOverlay } =
    loadOverlayForTest(overlayAnkiExports);
  socketOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: "prevent" },
  });
  socketOverlay.state.ankiCardContexts.ctxSocket =
    overlay.state.ankiCardContexts.ctx1;
  const socketButton = makeAnkiButton(socketContext, "ctxSocket");
  socketOverlay.bindPopupAnkiButtons();
  const socketStatus = socketContext.__sent.find(
    (message) => message.type === "anki-card-status",
  );
  if (socketStatus)
    socketOverlay.updateAnkiCardState({
      requestId: socketStatus.requestId,
      ok: true,
      ack: true,
      state: "checking",
    });
  if (socketStatus)
    socketOverlay.updateAnkiCardState({
      requestId: socketStatus.requestId,
      ok: true,
      state: "ready",
      duplicate: false,
      noteIds: [],
    });
  socketContext.__sent.length = 0;
  socketContext.__posted.length = 0;
  clickButton(socketButton);
  await wait(20);
  const socketAdd = socketContext.__sent.find(
    (message) => message.type === "anki-card-add",
  );
  assert(
    socketAdd,
    "Anki add should immediately use the open WebSocket bridge",
  );
  assert(
    !socketContext.__posted.some((message) => message.name === "anki-card-add"),
    "Anki add should not use native fallback before the WebSocket acknowledgement deadline",
  );
  const socket = socketContext.__sockets[socketContext.__sockets.length - 1];
  assert(
    socket && typeof socket.onmessage === "function",
    "Overlay should listen for bridge socket replies",
  );
  const binaryMessage = (payload) =>
    Uint8Array.from(Buffer.from(JSON.stringify(payload), "utf8"));
  socket.onmessage({
    data: binaryMessage({
      type: "anki-card-state",
      requestId: socketAdd.requestId,
      ok: true,
      ack: true,
      state: "adding",
    }),
  });
  socket.onmessage({
    data: binaryMessage({
      type: "anki-card-state",
      requestId: socketAdd.requestId,
      popupSessionId: "stale-popup",
      ok: true,
      state: "added",
      noteId: 11111,
      message: "Added Anki card.",
    }),
  });
  await wait(0);
  assert(
    socketButton.dataset.ankiState !== "added",
    "Bridge socket Anki replies for stale popup sessions should be ignored",
  );
  socket.onmessage({
    data: binaryMessage({
      type: "anki-card-state",
      requestId: socketAdd.requestId,
      popupSessionId: socketAdd.popupSessionId,
      ok: true,
      state: "added",
      noteId: 24680,
      message: "Added Anki card.",
    }),
  });
  await wait(0);
  assert(
    socketButton.dataset.ankiState === "added",
    "Bridge socket Anki replies should update the button state",
  );

  const { context: openContext, overlay: openOverlay } = loadOverlayForTest(
    overlayAnkiExports,
    { autoOpenWebSocket: false },
  );
  openOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: "prevent" },
  });
  openOverlay.state.ankiCardContexts.ctx2 = overlay.state.ankiCardContexts.ctx1;
  const openButton = makeAnkiButton(openContext, "ctx2");
  openOverlay.setAnkiButtonState(openButton, {
    state: "duplicate",
    duplicate: true,
    noteIds: [12345],
  });
  openOverlay.bindPopupAnkiButtons();
  const openStatus = openContext.__sent.find(
    (message) => message.type === "anki-card-status",
  );
  if (openStatus)
    openOverlay.updateAnkiCardState({
      requestId: openStatus.requestId,
      ok: true,
      ack: true,
      state: "checking",
    });
  if (openStatus)
    openOverlay.updateAnkiCardState({
      requestId: openStatus.requestId,
      ok: true,
      state: "duplicate",
      duplicate: true,
      noteIds: [12345],
    });
  openContext.__sent.length = 0;
  openContext.__posted.length = 0;
  clickButton(openButton);
  await wait(20);
  const postedOpenMessage = openContext.__posted.find(
    (message) => message.name === "anki-card-open",
  );
  assert(
    postedOpenMessage,
    "Duplicate book buttons should post open requests through IINA webview messaging",
  );
  assert(
    postedOpenMessage.payload.noteIds[0] === 12345,
    "Direct duplicate open requests should include the detected note ID",
  );
  const openMessage = openContext.__sent.find(
    (message) => message.type === "anki-card-open",
  );
  assert(
    !openMessage,
    "Duplicate book buttons should not need the WebSocket bridge after a direct open post",
  );
  assert(
    postedOpenMessage.payload.noteIds[0] === 12345,
    "Duplicate open requests should include the detected note ID",
  );
  assert(
    !openContext.__sent.some((message) => message.type === "anki-card-add"),
    "Duplicate book buttons should not fall through to add",
  );
  assert(
    openButton.dataset.ankiState === "opening",
    "Duplicate open requests should remain pending until the backend confirms reveal",
  );
  assert(
    openContext.__elements.status.textContent === "Opening in Anki...",
    "Duplicate open requests should not report optimistic success",
  );
  openOverlay.updateAnkiCardState({
    requestId: postedOpenMessage.payload.requestId,
    ok: true,
    ack: true,
    state: "opening",
  });
  openOverlay.updateAnkiCardState({
    requestId: postedOpenMessage.payload.requestId,
    ok: true,
    state: "opened",
    noteIds: [12345],
    message: "Opened in Anki.",
  });
  assert(
    openButton.dataset.ankiState === "opened" &&
      openContext.__elements.status.textContent === "Opened in Anki.",
    "Confirmed duplicate open requests should restore the book and show success",
  );
  await wait(2600);
  assert(
    openContext.__elements.status.classList.contains("hidden"),
    "Duplicate open status should clear after its short confirmation",
  );
  openContext.__posted.length = 0;
  clickButton(openButton);
  await wait(20);
  const staleOpenMessage = openContext.__posted.find(
    (message) => message.name === "anki-card-open",
  );
  openOverlay.updateAnkiCardState({
    requestId: staleOpenMessage.payload.requestId,
    ok: false,
    state: "error",
    staleNoteIds: true,
    message: "No matching Anki cards are available.",
  });
  assert(
    openButton.parentNode.dataset.ankiNoteIds === "[]" &&
      openButton.dataset.ankiState === "checking",
    "Deleted reveal targets should clear the book state and resume checking",
  );
  await wait(330);
  assert(
    openContext.__posted.some((message) => message.name === "anki-card-status"),
    "Deleted reveal targets should trigger a fresh passive status request",
  );
  const refreshedOpenStatus = openContext.__posted.find(
    (message) => message.name === "anki-card-status",
  );
  openOverlay.updateAnkiCardState({
    requestId: refreshedOpenStatus.payload.requestId,
    ok: true,
    state: "ready",
    duplicate: false,
    noteIds: [],
  });

  const { context: outsideSelectionContext, overlay: outsideSelectionOverlay } =
    loadOverlayForTest(overlayAnkiExports, { autoOpenWebSocket: false });
  outsideSelectionOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: "prevent" },
  });
  outsideSelectionOverlay.state.ankiCardContexts.ctxOutside =
    overlay.state.ankiCardContexts.ctx1;
  const outsideSelectionButton = makeAnkiButton(
    outsideSelectionContext,
    "ctxOutside",
  );
  const outsideSelectedText =
    outsideSelectionContext.document.createTextNode("outside");
  outsideSelectionContext.__body.appendChild(outsideSelectedText);
  outsideSelectionContext.window.getSelection = () => ({
    isCollapsed: false,
    anchorNode: outsideSelectedText,
    focusNode: outsideSelectedText,
    toString() {
      return "outside";
    },
  });
  outsideSelectionOverlay.bindPopupAnkiButtons();
  clickButton(outsideSelectionButton);
  const outsideSelectionAdd = outsideSelectionContext.__posted.find(
    (message) => message.name === "anki-card-add",
  );
  assert(
    outsideSelectionAdd.payload.context.popupSelectionText === "",
    "Anki add requests should ignore selections outside the dictionary popup",
  );
  outsideSelectionOverlay.updateAnkiCardState({
    requestId: outsideSelectionAdd.payload.requestId,
    ok: true,
    state: "added",
    noteId: 45679,
    noteIds: [45679],
    message: "Added Anki card.",
  });

  const { context: staleContext, overlay: staleOverlay } = loadOverlayForTest(
    overlayAnkiExports,
    { autoOpenWebSocket: false },
  );
  staleOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: "prevent" },
  });
  staleOverlay.state.ankiCardContexts.ctx3 =
    overlay.state.ankiCardContexts.ctx1;
  const staleButton = makeAnkiButton(staleContext, "ctx3");
  staleOverlay.setAnkiButtonState(staleButton, {
    state: "duplicate",
    duplicate: true,
    noteIds: [12345],
  });
  staleOverlay.setAnkiButtonState(staleButton, {
    state: "ready",
    duplicate: false,
    noteIds: [],
  });
  assert(
    staleButton.parentNode.dataset.ankiNoteIds === "[]",
    "Ready Anki buttons should clear stale duplicate note IDs",
  );
  assert(
    staleButton.parentNode.dataset.ankiDuplicateKnown === "ready",
    "Ready Anki buttons should mark the duplicate state as refreshed",
  );
  assert(
    staleButton.getAttribute("data-clickable") === "true",
    "Dynamically updated Anki buttons should remain IINA-clickable",
  );
  assert(
    /data-clickable="true"/.test(staleButton.innerHTML),
    "Dynamically replaced Anki icons should remain IINA-clickable",
  );
  staleOverlay.bindPopupAnkiButtons();
  const staleStatus = staleContext.__sent.find(
    (message) => message.type === "anki-card-status",
  );
  if (staleStatus)
    staleOverlay.updateAnkiCardState({
      requestId: staleStatus.requestId,
      ok: true,
      ack: true,
      state: "checking",
    });
  if (staleStatus)
    staleOverlay.updateAnkiCardState({
      requestId: staleStatus.requestId,
      ok: true,
      state: "ready",
      duplicate: false,
      noteIds: [],
    });
  staleContext.__sent.length = 0;
  staleContext.__posted.length = 0;
  clickButton(staleButton);
  await wait(20);
  const addMessage = staleContext.__posted.find(
    (message) => message.name === "anki-card-add",
  );
  assert(
    addMessage,
    "Ready buttons should post an add request after a deleted duplicate disappears",
  );
  assert(
    addMessage.payload.duplicateKnown === "ready",
    "Ready add requests should not report a known duplicate",
  );
  assert(
    Array.isArray(addMessage.payload.noteIds) &&
      addMessage.payload.noteIds.length === 0,
    "Ready add requests should not send stale note IDs",
  );
  staleOverlay.updateAnkiCardState({
    requestId: addMessage.payload.requestId,
    ok: true,
    ack: true,
    state: "adding",
  });
  staleOverlay.updateAnkiCardState({
    requestId: addMessage.payload.requestId,
    ok: true,
    state: "added",
    message: "Added Anki card.",
  });

  const { context: allowContext, overlay: allowOverlay } = loadOverlayForTest(
    overlayAnkiExports,
    { autoOpenWebSocket: false },
  );
  allowOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: "allow" },
  });
  allowOverlay.state.ankiCardContexts.ctxAllow =
    overlay.state.ankiCardContexts.ctx1;
  const allowButton = makeAnkiButton(allowContext, "ctxAllow");
  const allowGroup = allowButton.parentNode;
  const forceButton = allowGroup.children[0];
  allowOverlay.bindPopupAnkiButtons();
  await wait(260);
  const allowStatus = allowContext.__posted.find(
    (message) => message.name === "anki-card-status",
  );
  allowOverlay.updateAnkiCardState({
    requestId: allowStatus.payload.requestId,
    ok: true,
    ack: true,
    state: "checking",
  });
  allowOverlay.updateAnkiCardState({
    requestId: allowStatus.payload.requestId,
    ok: true,
    state: "duplicate",
    duplicate: true,
    noteIds: [12345, 23456],
  });
  assert(
    allowButton.dataset.ankiAction === "open" &&
      forceButton.hidden === false &&
      forceButton.dataset.ankiAction === "add",
    "Allow-mode duplicates should show a primary reveal action and separate force-add action",
  );
  allowContext.__posted.length = 0;
  clickButton(forceButton);
  const forcedAdd = allowContext.__posted.find(
    (message) => message.name === "anki-card-add",
  );
  assert(
    forcedAdd &&
      forcedAdd.payload.forceDuplicate === true &&
      forcedAdd.payload.noteIds.join(",") === "12345,23456",
    "The smaller plus should send an explicit force-add request with known duplicates",
  );
  allowOverlay.updateAnkiCardState({
    requestId: forcedAdd.payload.requestId,
    ok: true,
    ack: true,
    state: "adding",
  });
  allowOverlay.updateAnkiCardState({
    requestId: forcedAdd.payload.requestId,
    ok: true,
    state: "added",
    forceDuplicate: true,
    noteId: 34567,
    noteIds: [12345, 23456, 34567],
    message: "Added Anki card.",
  });
  assert(
    forceButton.hidden === false &&
      allowButton.dataset.ankiAction === "open" &&
      JSON.parse(allowGroup.dataset.ankiNoteIds).join(",") ===
        "12345,23456,34567",
    "Force-add success should keep both controls and merge the new note ID",
  );
  allowContext.__posted.length = 0;
  clickButton(forceButton);
  const failedForceAdd = allowContext.__posted.find(
    (message) => message.name === "anki-card-add",
  );
  allowOverlay.updateAnkiCardState({
    requestId: failedForceAdd.payload.requestId,
    ok: false,
    state: "error",
    message: "Forced add failed",
  });
  assert(
    forceButton.hidden === false &&
      allowButton.dataset.ankiAction === "open" &&
      JSON.parse(allowGroup.dataset.ankiNoteIds).length === 3,
    "Force-add failures should restore the existing duplicate reveal state",
  );
  allowOverlay.setAnkiButtonState(allowGroup, {
    state: "error",
    message: "Anki bridge did not respond",
  });
  allowContext.__posted.length = 0;
  clickButton(allowButton);
  const safePrimaryAdd = allowContext.__posted.find(
    (message) => message.name === "anki-card-add",
  );
  assert(
    safePrimaryAdd && safePrimaryAdd.payload.forceDuplicate === false,
    "An errored allow-mode primary button should request a protected add, never force-add",
  );
  allowOverlay.updateAnkiCardState({
    requestId: safePrimaryAdd.payload.requestId,
    ok: false,
    state: "error",
    message: "Authoritative duplicate check failed",
  });
  allowOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: {
      enabled: true,
      configured: true,
      duplicateCheck: false,
      duplicateMode: "allow",
    },
  });
  allowOverlay.setAnkiButtonState(allowGroup, {
    state: "added",
    noteIds: [12345, 23456, 34567],
  });
  assert(
    forceButton.hidden === true && allowButton.dataset.ankiAction === "open",
    "Disabling duplicate checks should hide add-anyway without removing the known added-card reveal",
  );

  const { context: deferredContext, overlay: deferredOverlay } =
    loadOverlayForTest(overlayAnkiExports, { autoOpenWebSocket: false });
  deferredOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: "prevent" },
  });
  deferredOverlay.state.ankiCardContexts.ctxDeferred =
    overlay.state.ankiCardContexts.ctx1;
  const deferredButton = makeAnkiButton(deferredContext, "ctxDeferred");
  deferredOverlay.bindPopupAnkiButtons();
  await wait(260);
  const firstDeferredStatus = deferredContext.__posted.find(
    (message) => message.name === "anki-card-status",
  );
  deferredOverlay.updateAnkiCardState({
    requestId: firstDeferredStatus.payload.requestId,
    ok: true,
    state: "deferred",
    retryAfterMs: 300,
    message: "Waiting to check Anki...",
  });
  assert(
    deferredButton.dataset.ankiState === "checking" &&
      deferredButton.disabled === true,
    "Deferred duplicate checks should remain visibly pending instead of becoming ready",
  );
  await wait(340);
  const deferredStatuses = deferredContext.__posted.filter(
    (message) => message.name === "anki-card-status",
  );
  assert(
    deferredStatuses.length === 2,
    "Deferred duplicate checks should retry while their popup remains attached",
  );
  deferredOverlay.updateAnkiCardState({
    requestId: deferredStatuses[1].payload.requestId,
    ok: true,
    state: "duplicate",
    duplicate: true,
    noteIds: [45678],
  });
  assert(
    deferredButton.dataset.ankiAction === "open",
    "A deferred retry should apply its eventual authoritative duplicate result",
  );

  const { context: passiveContext, overlay: passiveOverlay } =
    loadOverlayForTest(overlayAnkiExports, { autoOpenWebSocket: false });
  passiveOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: "prevent" },
  });
  passiveOverlay.state.ankiCardContexts.ctxPassive =
    overlay.state.ankiCardContexts.ctx1;
  const passiveButton = makeAnkiButton(passiveContext, "ctxPassive");
  passiveOverlay.bindPopupAnkiButtons();
  await wait(260);
  const passiveStatus = passiveContext.__posted.find(
    (message) => message.name === "anki-card-status",
  );
  assert(passiveStatus, "Anki buttons should request passive status checks");
  passiveOverlay.updateAnkiCardState({
    requestId: passiveStatus.payload.requestId,
    ok: true,
    ack: true,
    state: "checking",
  });
  passiveOverlay.updateAnkiCardState({
    requestId: passiveStatus.payload.requestId,
    ok: false,
    state: "error",
    message:
      "AnkiConnect did not respond after 3 attempts in 0.1 seconds (timeout 3 seconds per attempt).",
  });
  assert(
    passiveButton.dataset.ankiState === "error",
    "Passive Anki status failures should mark the button as errored",
  );
  assert(
    passiveContext.__elements.status.textContent === "",
    "Passive Anki status failures should not show the global status banner",
  );
  passiveContext.__sent.length = 0;
  passiveContext.__posted.length = 0;
  clickButton(passiveButton);
  await wait(20);
  const deliberateAdd = passiveContext.__posted.find(
    (message) => message.name === "anki-card-add",
  );
  assert(
    deliberateAdd,
    "Errored Anki buttons should still allow explicit adds",
  );
  passiveOverlay.updateAnkiCardState({
    requestId: deliberateAdd.payload.requestId,
    ok: true,
    ack: true,
    state: "adding",
  });
  passiveOverlay.updateAnkiCardState({
    requestId: deliberateAdd.payload.requestId,
    ok: false,
    state: "error",
    message:
      "AnkiConnect did not respond after 3 attempts in 0.1 seconds (timeout 3 seconds per attempt).",
  });
  assert(
    /AnkiConnect did not respond/.test(
      passiveContext.__elements.status.textContent,
    ),
    "Explicit Anki add failures should still show a status message",
  );

  console.log("overlay anki tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
