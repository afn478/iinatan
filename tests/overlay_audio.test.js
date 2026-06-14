const { assert, loadOverlayForTest } = require('./helpers/overlay_test_context');

const { context, overlay } = loadOverlayForTest([
  'state',
  'applyConfig',
  'showPopup',
  'renderStoredLookup',
  'audioTermReadingKey',
  'playAudioForTerm',
  'showAudioSourceMenu'
]);

let fetchCalled = false;
context.fetch = async function fetch() {
  fetchCalled = true;
  throw new Error('overlay fetch should not be used when bridge resolves audio');
};

const loaded = [];
const played = [];
context.Audio = function TestAudio(url) {
  this.url = String(url);
  this.readyState = 0;
  this.listeners = Object.create(null);
};
context.Audio.prototype.addEventListener = function addEventListener(type, handler) {
  if (!this.listeners[type]) this.listeners[type] = [];
  this.listeners[type].push(handler);
};
context.Audio.prototype.removeEventListener = function removeEventListener(type, handler) {
  if (!this.listeners[type]) return;
  this.listeners[type] = this.listeners[type].filter(item => item !== handler);
};
context.Audio.prototype._emit = function emit(type) {
  (this.listeners[type] || []).slice().forEach(handler => handler());
};
context.Audio.prototype.load = function load() {
  loaded.push(this.url);
  setTimeout(() => {
    if (this.url.indexOf('bad') >= 0) {
      this.error = new Error('bad audio');
      this._emit('error');
      return;
    }
    this.readyState = 2;
    this._emit('loadeddata');
  }, 0);
};
context.Audio.prototype.play = function play() {
  played.push(this.url);
  return Promise.resolve();
};
context.Audio.prototype.pause = function pause() {};

overlay.applyConfig({
  language: { id: 'ja', label: 'Japanese', lookupUnit: 'character', wordMode: 'rightward-prefix' },
  audioSources: [{ url: 'http://127.0.0.1:5050/?term={term}&reading={reading}' }],
  overlayBridgePort: 19741,
  hoverRequestTimeoutMs: 5000
});

overlay.showPopup(context.document.createElement('span'), '読', '<div class="loading">Loading...</div>');
overlay.renderStoredLookup({
  ok: true,
  position: 0,
  result: {
    ok: true,
    language: 'ja',
    results: [{
      matched: '読む',
      deinflected: '読む',
      term: { expression: '読む', reading: 'よむ', glossaries: [] }
    }]
  }
});

const headHtml = context.__elements.popup.children[0]._innerHTML;
assert(/class="audio-button"/.test(headHtml), 'Lookup result header should render a speaker button when audio sources are configured');
assert(/data-audio-term="読む"/.test(headHtml), 'Speaker button should carry the entry headword');
assert(/data-audio-reading="よむ"/.test(headHtml), 'Speaker button should carry the entry reading');

const key = overlay.audioTermReadingKey('読む', 'よむ');
const button = context.document.createElement('button');
button.className = 'audio-button';
button.dataset.audioKey = key;
context.__elements.popup.appendChild(button);

function respondToAudioSourceRequest(fromIndex, candidates, ok) {
  const message = context.__sent.slice(fromIndex).find(item => item.type === 'audio-source');
  assert(message, 'Audio playback should request source JSON over the WebSocket bridge');
  context.__handlers['audio-source-result']({
    requestId: message.requestId,
    ok: ok !== false,
    candidates: candidates || []
  });
  return message;
}

(async () => {
  const beforeFirst = context.__sent.length;
  const playPromise = overlay.playAudioForTerm('読む', 'よむ', button, {});
  const request = respondToAudioSourceRequest(beforeFirst, [
    { name: 'bad', url: 'http://127.0.0.1:5050/bad.mp3' },
    { name: 'good', url: 'http://127.0.0.1:5050/good.mp3' }
  ]);
  const ok = await playPromise;
  assert(ok, 'Audio playback should succeed when a later candidate works');
  assert(request.url.indexOf('term=%E8%AA%AD%E3%82%80') >= 0, 'Audio source URL should receive the encoded term');
  assert(request.url.indexOf('reading=%E3%82%88%E3%82%80') >= 0, 'Audio source URL should receive the encoded reading');
  assert(!fetchCalled, 'Overlay should not fetch source JSON directly when the bridge resolves audio');
  assert(loaded[0].indexOf('bad.mp3') >= 0, 'The first candidate should be tried before fallback candidates');
  assert(played[0] === 'http://127.0.0.1:5050/good.mp3', 'The first working candidate should be played');
  assert(button.dataset.audioState === 'ready', 'Successful audio should leave the button available without a missing badge');

  const missingKey = overlay.audioTermReadingKey('無音', '');
  const missingButton = context.document.createElement('button');
  missingButton.className = 'audio-button';
  missingButton.dataset.audioKey = missingKey;
  context.__elements.popup.appendChild(missingButton);
  const beforeMissing = context.__sent.length;
  const missingPromise = overlay.playAudioForTerm('無音', '', missingButton, {});
  respondToAudioSourceRequest(beforeMissing, []);
  const missing = await missingPromise;
  assert(!missing, 'Empty audio source JSON should report missing audio');
  assert(missingButton.dataset.audioState === 'missing', 'Missing audio should mark the speaker with the missing badge state');

  overlay.applyConfig({
    audioSources: [{ name: 'LanguagePod101', url: 'https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji={term}&kana={reading}' }]
  });
  const directKey = overlay.audioTermReadingKey('読む', 'よむ');
  const directButton = context.document.createElement('button');
  directButton.className = 'audio-button';
  directButton.dataset.audioKey = directKey;
  context.__elements.popup.appendChild(directButton);
  const beforeDirect = context.__sent.length;
  const directPromise = overlay.playAudioForTerm('読む', 'よむ', directButton, {});
  const directRequest = respondToAudioSourceRequest(beforeDirect, [], false);
  const direct = await directPromise;
  assert(direct, 'Non-JSON source URLs should be tried directly as audio');
  assert(directRequest.url.indexOf('audiomp3.php') >= 0, 'Direct audio source templates should be sent to the bridge before fallback');
  assert(directRequest.url.indexOf('kanji=%E8%AA%AD%E3%82%80') >= 0, 'Direct audio source URL should encode the term');
  assert(directRequest.url.indexOf('kana=%E3%82%88%E3%82%80') >= 0, 'Direct audio source URL should encode the reading');
  assert(played[played.length - 1] === directRequest.url, 'Direct audio fallback should play the templated source URL');
  assert(directButton.dataset.audioState === 'ready', 'Direct audio fallback should leave the button ready');

  overlay.applyConfig({
    audioSources: [
      { name: 'JapanesePod101', url: 'https://japanese.example.invalid/audio.mp3?term={term}' },
      { url: 'https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji={term}&kana={reading}' },
      { url: 'http://127.0.0.1:5050/?term={term}&reading={reading}' }
    ]
  });
  const menuButton = context.document.createElement('button');
  menuButton.className = 'audio-button';
  menuButton.dataset.audioTerm = '読む';
  menuButton.dataset.audioReading = 'よむ';
  context.__elements.popup.appendChild(menuButton);
  let menuPrevented = false;
  const menuOpened = overlay.showAudioSourceMenu(menuButton, {
    clientX: 220,
    clientY: 160,
    preventDefault() { menuPrevented = true; },
    stopPropagation() {}
  });
  assert(menuOpened, 'Right-clicking an audio button should open the source menu');
  assert(menuPrevented, 'Audio source menu should suppress the native context menu');
  const menu = context.__elements.popup.querySelector('.audio-source-menu');
  assert(menu, 'Audio source menu should be rendered');
  const items = menu.querySelectorAll('.audio-source-menu-item');
  assert(items.length === 3, 'Audio source menu should list configured sources');
  assert(items[0].textContent === 'JapanesePod101', 'Named audio sources should use their configured name');
  assert(items[1].textContent === 'languagepod101.com', 'Unnamed web audio sources should use a readable host label');
  assert(items[2].textContent === 'Local audio', 'The local Anki source should use a readable label');

  const beforeMenuPlay = context.__sent.length;
  items[1].listeners.click({ preventDefault() {}, stopPropagation() {} });
  const menuRequest = respondToAudioSourceRequest(beforeMenuPlay, [], false);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert(menuRequest.url.indexOf('languagepod101.com') >= 0, 'Choosing a menu item should play only that source');
  assert(played[played.length - 1] === menuRequest.url, 'Chosen direct audio source should be played');
  assert(!context.__elements.popup.querySelector('.audio-source-menu'), 'Choosing a source should close the menu');

  console.log('overlay audio tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
