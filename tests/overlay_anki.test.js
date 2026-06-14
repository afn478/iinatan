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
  'setAnkiButtonState',
  'updateAnkiCardState'
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
  clickButton(addButton);
  assert(context.__elements.status.textContent === 'Adding Anki card...', 'Anki add click should show immediate feedback');
  assert(!context.__sent.some(message => message.type === 'anki-card-add'), 'Anki add should wait while the bridge socket is connecting');
  context.__openSocket();
  await wait(120);
  const sentStatus = context.__sent.find(message => message.type === 'anki-card-status');
  if (sentStatus) overlay.updateAnkiCardState({ requestId: sentStatus.requestId, ok: true, ack: true, state: 'checking' });
  if (sentStatus) overlay.updateAnkiCardState({ requestId: sentStatus.requestId, ok: true, state: 'ready', duplicate: false, noteIds: [] });
  const sentAdd = context.__sent.find(message => message.type === 'anki-card-add');
  assert(sentAdd, 'Anki add should send once the bridge socket opens');
  overlay.updateAnkiCardState({ requestId: sentAdd.requestId, ok: true, ack: true, state: 'adding' });
  overlay.updateAnkiCardState({ requestId: sentAdd.requestId, ok: true, state: 'added', message: 'Added Anki card.' });

  const { context: retryContext, overlay: retryOverlay } = loadOverlayForTest(overlayAnkiExports);
  retryOverlay.applyConfig({
    overlayBridgePort: 19741,
    anki: { enabled: true, configured: true, duplicateMode: 'prevent' }
  });
  retryOverlay.state.ankiCardContexts.ctxRetry = overlay.state.ankiCardContexts.ctx1;
  const retryButton = makeAnkiButton(retryContext, 'ctxRetry');
  retryOverlay.bindPopupAnkiButtons();
  const retryStatus = retryContext.__sent.find(message => message.type === 'anki-card-status');
  if (retryStatus) retryOverlay.updateAnkiCardState({ requestId: retryStatus.requestId, ok: true, ack: true, state: 'checking' });
  if (retryStatus) retryOverlay.updateAnkiCardState({ requestId: retryStatus.requestId, ok: true, state: 'ready', duplicate: false, noteIds: [] });
  retryContext.__sent.length = 0;
  clickButton(retryButton);
  await wait(20);
  const firstRetryAdd = retryContext.__sent.find(message => message.type === 'anki-card-add');
  assert(firstRetryAdd, 'Anki add should send over the WebSocket bridge');
  await wait(980);
  const addRetries = retryContext.__sent.filter(message => message.type === 'anki-card-add');
  assert(addRetries.length === 2, 'Anki add should retry once when the bridge does not acknowledge receipt');
  assert(addRetries[0].requestId === addRetries[1].requestId, 'Anki add retry should keep the same request ID');
  retryOverlay.updateAnkiCardState({ requestId: firstRetryAdd.requestId, ok: true, ack: true, state: 'adding' });
  await wait(980);
  assert(retryContext.__sent.filter(message => message.type === 'anki-card-add').length === 2, 'Anki add should stop retrying after an acknowledgement');
  retryOverlay.updateAnkiCardState({ requestId: firstRetryAdd.requestId, ok: true, state: 'added', message: 'Added Anki card.' });

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
  const openStatus = openContext.__sent.find(message => message.type === 'anki-card-status');
  if (openStatus) openOverlay.updateAnkiCardState({ requestId: openStatus.requestId, ok: true, ack: true, state: 'checking' });
  if (openStatus) openOverlay.updateAnkiCardState({ requestId: openStatus.requestId, ok: true, state: 'duplicate', duplicate: true, noteIds: [12345] });
  openContext.__sent.length = 0;
  clickButton(openButton);
  await wait(20);
  const openMessage = openContext.__sent.find(message => message.type === 'anki-card-open');
  assert(openMessage, 'Duplicate book buttons should send an open request');
  assert(openMessage.noteIds[0] === 12345, 'Duplicate open requests should include the detected note ID');
  assert(!openContext.__sent.some(message => message.type === 'anki-card-add'), 'Duplicate book buttons should not fall through to add');
  openOverlay.updateAnkiCardState({ requestId: openMessage.requestId, ok: true, ack: true, state: 'opening' });
  openOverlay.updateAnkiCardState({ requestId: openMessage.requestId, ok: true, state: 'opened', noteIds: [12345], message: 'Opened in Anki.' });

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
  const staleStatus = staleContext.__sent.find(message => message.type === 'anki-card-status');
  if (staleStatus) staleOverlay.updateAnkiCardState({ requestId: staleStatus.requestId, ok: true, ack: true, state: 'checking' });
  if (staleStatus) staleOverlay.updateAnkiCardState({ requestId: staleStatus.requestId, ok: true, state: 'ready', duplicate: false, noteIds: [] });
  staleContext.__sent.length = 0;
  clickButton(staleButton);
  await wait(20);
  const addMessage = staleContext.__sent.find(message => message.type === 'anki-card-add');
  assert(addMessage, 'Ready buttons should send an add request after a deleted duplicate disappears');
  assert(addMessage.duplicateKnown === 'ready', 'Ready add requests should not report a known duplicate');
  assert(Array.isArray(addMessage.noteIds) && addMessage.noteIds.length === 0, 'Ready add requests should not send stale note IDs');
  staleOverlay.updateAnkiCardState({ requestId: addMessage.requestId, ok: true, ack: true, state: 'adding' });
  staleOverlay.updateAnkiCardState({ requestId: addMessage.requestId, ok: true, state: 'added', message: 'Added Anki card.' });

  console.log('overlay anki tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
