const { assert, loadOverlayForTest } = require('./helpers/overlay_test_context');

function clickButton(button) {
  button.listeners.click({
    preventDefault() {},
    stopPropagation() {}
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function postedMessage(context, name) {
  const item = context.__posted.find(message => message.name === name);
  return item && item.payload;
}

function makeAnkiButton(context, id) {
  const button = context.document.createElement('button');
  button.className = 'anki-button';
  button.dataset.ankiContextId = id;
  button.dataset.ankiState = 'ready';
  button.dataset.ankiAction = 'add';
  context.__elements.popup.appendChild(button);
  return button;
}

const overlayAnkiExports = [
  'state',
  'applyConfig',
  'bindPopupAnkiButtons',
  'setAnkiButtonState'
];

(async () => {
  const { context, overlay } = loadOverlayForTest(overlayAnkiExports, { autoOpenWebSocket: false });

  overlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: 'prevent' }
  });
  overlay.state.ankiCardContexts.ctx1 = {
    lineId: 1,
    sentence: '私は猫です。',
    position: 2,
    expression: '猫',
    reading: 'ねこ',
    surface: '猫',
    entry: { term: { expression: '猫', reading: 'ねこ', glossaries: [] } },
    result: { text: '私は猫です。', lookupStart: 2, lookupEnd: 3, language: 'ja' }
  };

  const addButton = makeAnkiButton(context, 'ctx1');
  overlay.bindPopupAnkiButtons();
  context.__posted.length = 0;
  clickButton(addButton);
  assert(context.__elements.status.textContent === 'Adding Anki card...', 'Anki add click should show immediate feedback');
  assert(postedMessage(context, 'anki-card-add'), 'Anki add should use the native IINA overlay bridge immediately');
  assert(!context.__sent.some(message => message.type === 'anki-card-add'), 'Anki add should not need the WebSocket when native overlay messages are available');

  const { context: fallbackContext, overlay: fallbackOverlay } = loadOverlayForTest(overlayAnkiExports, {
    autoOpenWebSocket: false,
    postMessageThrows: true
  });
  fallbackOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: 'prevent' }
  });
  fallbackOverlay.state.ankiCardContexts.ctxFallback = overlay.state.ankiCardContexts.ctx1;
  const fallbackButton = makeAnkiButton(fallbackContext, 'ctxFallback');
  fallbackOverlay.bindPopupAnkiButtons();
  clickButton(fallbackButton);
  assert(!fallbackContext.__sent.some(message => message.type === 'anki-card-add'), 'Anki add fallback should wait while the bridge socket is connecting');
  fallbackContext.__openSocket();
  await wait(120);
  assert(fallbackContext.__sent.some(message => message.type === 'anki-card-add'), 'Anki add fallback should send once the bridge socket opens');

  const { context: openContext, overlay: openOverlay } = loadOverlayForTest(overlayAnkiExports);
  openOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: 'prevent' }
  });
  openOverlay.state.ankiCardContexts.ctx2 = overlay.state.ankiCardContexts.ctx1;
  const openButton = makeAnkiButton(openContext, 'ctx2');
  openButton.dataset.ankiState = 'duplicate';
  openButton.dataset.ankiAction = 'open';
  openButton.dataset.ankiDuplicateKnown = 'duplicate';
  openButton.dataset.ankiNoteIds = JSON.stringify([12345]);
  openOverlay.bindPopupAnkiButtons();
  openContext.__posted.length = 0;
  clickButton(openButton);
  await wait(20);
  const openMessage = postedMessage(openContext, 'anki-card-open');
  assert(openMessage, 'Duplicate book buttons should send an open request');
  assert(openMessage.noteIds[0] === 12345, 'Duplicate open requests should include the detected note ID');
  assert(!postedMessage(openContext, 'anki-card-add'), 'Duplicate book buttons should not fall through to add');

  const { context: staleContext, overlay: staleOverlay } = loadOverlayForTest(overlayAnkiExports);
  staleOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: 'prevent' }
  });
  staleOverlay.state.ankiCardContexts.ctx3 = overlay.state.ankiCardContexts.ctx1;
  const staleButton = makeAnkiButton(staleContext, 'ctx3');
  staleButton.dataset.ankiState = 'duplicate';
  staleButton.dataset.ankiAction = 'open';
  staleButton.dataset.ankiDuplicateKnown = 'duplicate';
  staleButton.dataset.ankiNoteIds = JSON.stringify([12345]);
  staleOverlay.setAnkiButtonState(staleButton, { state: 'ready', duplicate: false, noteIds: [] });
  assert(staleButton.dataset.ankiNoteIds === '[]', 'Ready Anki buttons should clear stale duplicate note IDs');
  assert(staleButton.dataset.ankiDuplicateKnown === 'ready', 'Ready Anki buttons should mark the duplicate state as refreshed');
  staleOverlay.bindPopupAnkiButtons();
  staleContext.__posted.length = 0;
  clickButton(staleButton);
  await wait(20);
  const addMessage = postedMessage(staleContext, 'anki-card-add');
  assert(addMessage, 'Ready buttons should send an add request after a deleted duplicate disappears');
  assert(addMessage.duplicateKnown === 'ready', 'Ready add requests should not report a known duplicate');
  assert(Array.isArray(addMessage.noteIds) && addMessage.noteIds.length === 0, 'Ready add requests should not send stale note IDs');

  console.log('overlay anki tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
