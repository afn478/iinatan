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
let nextTimerId = 1;
const timers = new Map();

function setFakeTimeout(fn, ms) {
  const id = nextTimerId++;
  timers.set(id, { fn, ms });
  return id;
}

function clearFakeTimeout(id) {
  timers.delete(id);
}

function runTimers() {
  const pending = Array.from(timers.entries());
  timers.clear();
  pending.forEach(([, timer]) => timer.fn());
}

function pendingTimerCount() {
  return timers.size;
}

const context = {
  iina: {
    core: {
      status: { paused: false },
      pause() { paused = true; context.iina.core.status.paused = true; pauseWrites.push(true); },
      resume() { paused = false; context.iina.core.status.paused = false; pauseWrites.push(false); },
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
          context.iina.core.status.paused = paused;
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
  setTimeout: setFakeTimeout,
  clearTimeout: clearFakeTimeout,
  URL,
  console: { log() {}, warn() {}, error() {}, info() {} }
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n') + '\nenabled = true;', context);

function showPopup(seq, popupSessionId) {
  context.handleLookupPopupVisibility({ visible: true, seq, popupSessionId: popupSessionId || 'test-session' });
}

function hidePopup(seq, popupSessionId) {
  context.handleLookupPopupVisibility({ visible: false, seq, popupSessionId: popupSessionId || 'test-session' });
}

function resetCase(initialPaused) {
  context.resetLookupPopupPause();
  timers.clear();
  pauseWrites.length = 0;
  paused = !!initialPaused;
  context.iina.core.status.paused = paused;
}

storage['/data/manifest.json'] = manifestWithPopupPause(false);
preferenceValues.pauseWhilePopupVisible = true;
resetCase(false);
showPopup(1);
assert(pauseWrites.length === 0, 'Active profile false should prevent popup pause even when plugin preference is true');

storage['/data/manifest.json'] = manifestWithPopupPause('false');
preferenceValues.pauseWhilePopupVisible = true;
resetCase(false);
showPopup(2);
assert(pauseWrites.length === 0, 'String false in the active profile should be treated as disabled');

storage['/data/manifest.json'] = manifestWithPopupPause(true);
preferenceValues.pauseWhilePopupVisible = false;
resetCase(false);
showPopup(3);
assert(pauseWrites.length === 1 && pauseWrites[0] === true, 'Active profile true should allow popup pause even when plugin preference is stale false');

context.handleLookupPopupVisibility({ visible: false, seq: 8, popupSessionId: 'before-resize' });
resetCase(false);
context.handleLookupPopupOverlayReady({ ready: true, popupSessionId: 'after-resize' });
showPopup(1, 'after-resize');
assert(pauseWrites.length === 1 && pauseWrites[0] === true, 'Fresh overlay sessions should reset popup visibility sequence after resize/reload');

resetCase(false);
showPopup(1, 'resume-basic');
hidePopup(2, 'resume-basic');
assert(paused === true, 'Popup hide should debounce resume instead of resuming synchronously');
assert(pendingTimerCount() === 1, 'Popup hide should schedule one resume timer');
runTimers();
assert(paused === false, 'Playback should resume when a popup hidden event follows a plugin-owned pause');
assert(pauseWrites.length === 2 && pauseWrites[0] === true && pauseWrites[1] === false, 'Plugin-owned popup pause should write pause=true then pause=false');

resetCase(true);
showPopup(1, 'already-paused');
hidePopup(2, 'already-paused');
runTimers();
assert(paused === true, 'Playback that was already paused before popup show must stay paused after hide');
assert(pauseWrites.length === 0, 'Already-paused playback should not be touched by popup pause handling');

resetCase(false);
showPopup(1, 'duplicate-show');
showPopup(1, 'duplicate-show');
hidePopup(2, 'duplicate-show');
runTimers();
assert(paused === false, 'Duplicate visible events must not clear plugin-owned resume state');
assert(pauseWrites.length === 2 && pauseWrites[0] === true && pauseWrites[1] === false, 'Duplicate visible events should not add extra pause writes');

resetCase(false);
showPopup(1, 'stale-hide');
hidePopup(2, 'stale-hide');
showPopup(3, 'stale-hide');
hidePopup(2, 'stale-hide');
runTimers();
assert(paused === true, 'A stale lower-sequence hide after a newer show must not resume playback');
assert(pauseWrites.length === 1 && pauseWrites[0] === true, 'Stale hide should not write pause=false');
hidePopup(4, 'stale-hide');
runTimers();
assert(paused === false, 'The current popup hide should still resume playback');

resetCase(false);
showPopup(1, 'cancel-resume');
hidePopup(2, 'cancel-resume');
assert(pendingTimerCount() === 1, 'Hidden popup should schedule resume before a new popup appears');
showPopup(3, 'cancel-resume');
assert(pendingTimerCount() === 0, 'A new visible popup should cancel pending resume');
runTimers();
assert(paused === true, 'Cancelled resume must keep playback paused while the new popup is visible');
hidePopup(4, 'cancel-resume');
runTimers();
assert(paused === false, 'Playback should resume after the replacement popup hides');

console.log('popup pause preference tests passed');
