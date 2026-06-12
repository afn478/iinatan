const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = [
  'src/main/00_context_state_paths.js',
  'src/main/20_dictionary_manifest.js',
  'src/main/50_overlay_bridge_pause.js'
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function manifestWithPopupPause(value) {
  return JSON.stringify({
    dictionaries: {},
    disabled: {},
    activeProfileId: 'default',
    profiles: {
      default: {
        id: 'default',
        name: 'Default',
        dictionaryOrder: [],
        disabled: {},
        preferences: { pauseWhilePopupVisible: value }
      }
    }
  });
}

const storage = Object.create(null);
const preferenceValues = {
  debugLogEnabled: false,
  debugLogVerbose: false,
  pauseWhilePopupVisible: true
};
let paused = false;
const pauseWrites = [];

const context = {
  iina: {
    core: {
      status: { paused: false },
      pause() { paused = true; pauseWrites.push(true); },
      resume() { paused = false; pauseWrites.push(false); },
      osd() {}
    },
    mpv: {
      getFlag(name) {
        if (name === 'pause') return paused;
        return false;
      },
      set(name, value) {
        if (name === 'pause') {
          paused = !!value;
          pauseWrites.push(!!value);
        }
      }
    },
    event: {},
    overlay: {},
    menu: {},
    input: {},
    ws: {},
    preferences: {
      get(key) { return preferenceValues[key]; },
      set(key, value) { preferenceValues[key] = value; },
      sync() {}
    },
    console: { log() {}, warn() {}, error() {}, info() {} },
    file: {
      exists(p) { return Object.prototype.hasOwnProperty.call(storage, p); },
      read(p) { return storage[p] || ''; },
      write(p, value) { storage[p] = String(value); },
      list() { return []; }
    },
    http: {},
    utils: {
      resolvePath(value) {
        if (value === '@data/') return '/data';
        return '/plugin';
      },
      open() {}
    },
    standaloneWindow: {}
  },
  globalThis: null,
  Date,
  setTimeout() { return 1; },
  clearTimeout() {},
  URL,
  console: { log() {}, warn() {}, error() {}, info() {} }
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n') + '\nenabled = true;', context);

function showPopup(seq, popupSessionId) {
  context.handleLookupPopupVisibility({ visible: true, seq, popupSessionId: popupSessionId || 'test-session' });
}

storage['/data/manifest.json'] = manifestWithPopupPause(false);
preferenceValues.pauseWhilePopupVisible = true;
pauseWrites.length = 0;
paused = false;
showPopup(1);
assert(pauseWrites.length === 0, 'Active profile false should prevent popup pause even when plugin preference is true');

storage['/data/manifest.json'] = manifestWithPopupPause('false');
preferenceValues.pauseWhilePopupVisible = true;
pauseWrites.length = 0;
paused = false;
showPopup(2);
assert(pauseWrites.length === 0, 'String false in the active profile should be treated as disabled');

storage['/data/manifest.json'] = manifestWithPopupPause(true);
preferenceValues.pauseWhilePopupVisible = false;
pauseWrites.length = 0;
paused = false;
showPopup(3);
assert(pauseWrites.length === 1 && pauseWrites[0] === true, 'Active profile true should allow popup pause even when plugin preference is stale false');

context.handleLookupPopupVisibility({ visible: false, seq: 8, popupSessionId: 'before-resize' });
pauseWrites.length = 0;
paused = false;
context.handleLookupPopupOverlayReady({ ready: true, popupSessionId: 'after-resize' });
showPopup(1, 'after-resize');
assert(pauseWrites.length === 1 && pauseWrites[0] === true, 'Fresh overlay sessions should reset popup visibility sequence after resize/reload');

console.log('popup pause preference tests passed');
