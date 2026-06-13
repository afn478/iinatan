const { assert, loadOverlayForTest } = require('./helpers/overlay_test_context');

const { context, overlay } = loadOverlayForTest([
  'state',
  'applyConfig',
  'showPopup',
  'renderStoredLookup',
  'audioTermReadingKey',
  'playAudioForTerm'
]);

const fetchUrls = [];
let responseMode = 'fallback';
context.fetch = async function fetch(url) {
  fetchUrls.push(String(url));
  const audioSources = responseMode === 'empty' ? [] : [
    { name: 'bad', url: 'http://127.0.0.1:5050/bad.mp3' },
    { name: 'good', url: '/good.mp3' }
  ];
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ type: 'audioSourceList', audioSources });
    }
  };
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

(async () => {
  const ok = await overlay.playAudioForTerm('読む', 'よむ', button, {});
  assert(ok, 'Audio playback should succeed when a later candidate works');
  assert(fetchUrls[0].indexOf('term=%E8%AA%AD%E3%82%80') >= 0, 'Audio source URL should receive the encoded term');
  assert(fetchUrls[0].indexOf('reading=%E3%82%88%E3%82%80') >= 0, 'Audio source URL should receive the encoded reading');
  assert(loaded[0].indexOf('bad.mp3') >= 0, 'The first candidate should be tried before fallback candidates');
  assert(played[0] === 'http://127.0.0.1:5050/good.mp3', 'The first working candidate should be played');
  assert(button.dataset.audioState === 'ready', 'Successful audio should leave the button available without a missing badge');

  responseMode = 'empty';
  const missingKey = overlay.audioTermReadingKey('無音', '');
  const missingButton = context.document.createElement('button');
  missingButton.className = 'audio-button';
  missingButton.dataset.audioKey = missingKey;
  context.__elements.popup.appendChild(missingButton);
  const missing = await overlay.playAudioForTerm('無音', '', missingButton, {});
  assert(!missing, 'Empty audio source JSON should report missing audio');
  assert(missingButton.dataset.audioState === 'missing', 'Missing audio should mark the speaker with the missing badge state');

  console.log('overlay audio tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
