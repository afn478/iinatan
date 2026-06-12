const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const handlers = Object.create(null);
const posts = [];
const updates = [];

const context = {
  VERSION: '1.6.0',
  dictionaryManagerHandlerGeneration: 0,
  dictionaryManagerActionInFlight: false,
  standaloneWindow: {
    onMessage(name, handler) {
      if (!handlers[name]) handlers[name] = [];
      handlers[name].push(handler);
    },
    postMessage(name, data) {
      posts.push({ name, data });
    }
  },
  compactError(error) {
    return error && error.message ? error.message : String(error);
  },
  debugVerbose() {},
  debugWarn() {},
  debugError() {},
  alert() {},
  postDictionaryManagerState() {},
  updateDictionaryProfilePreferences(profileId, preferences) {
    updates.push({ profileId, preferences });
  },
  updateGlobalSettings() {},
  setDictionaryEnabled() {},
  setDictionaryOrder() {},
  deleteDictionary() {},
  getRecommendedDictionaries() {},
  runDictionaryManagerZipImport() {},
  setActiveDictionaryProfile() {},
  createDictionaryProfile() { return { id: 'new-profile' }; },
  renameDictionaryProfile() {},
  deleteDictionaryProfile() {},
  Promise,
  console,
  setTimeout,
  clearTimeout
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'src/main/65_dictionary_manager_window.js'), 'utf8'), context);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

context.registerDictionaryManagerHandlers();
context.registerDictionaryManagerHandlers();

const saveHandlers = handlers['dictionary-manager-update-profile-preferences'] || [];
assert(saveHandlers.length === 2, 'Repeated settings registration should install a fresh handler generation');
saveHandlers.forEach(handler => handler({
  profileId: 'default',
  preferences: { pauseWhilePopupVisible: true }
}));

assert(updates.length === 1, 'Only the newest settings handler generation should process a save command');
assert(updates[0].profileId === 'default', 'Settings save should pass through the active profile id');
assert(updates[0].preferences.pauseWhilePopupVisible === true, 'Settings save should pass through checkbox state');
assert(posts.some(post => post.name === 'dictionary-manager-status' && post.data.message === 'Profile settings saved.'), 'Settings save should acknowledge persistence');

console.log('dictionary manager bridge tests passed');
