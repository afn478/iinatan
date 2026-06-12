const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = [
  'src/main/20_dictionary_manifest.js',
  'src/main/30_backend_import_worker_lookup.js'
];

const storage = Object.create(null);
const calls = [];
const context = {
  console,
  Date,
  VERSION: '1.6.0',
  activeWorkerFingerprint: 'old-worker',
  dictRoot() { return '/data/dictionaries'; },
  manifestPath() { return '/data/manifest.json'; },
  dataRoot() { return '/data'; },
  pathJoin(...parts) { return parts.join('/').replace(/\/+/g, '/'); },
  compactError(error) { return error && error.message ? error.message : String(error); },
  debugLog() {},
  debugVerbose() {},
  debugWarn() {},
  debugError() {},
  prefBool() { return true; },
  prefNumber(_key, fallback) { return fallback; },
  selectedLanguageModule() { return { id: 'fr', label: 'French (experimental)' }; },
  showOSD() {},
  async ensureBundledBackendInstalled() { calls.push(['ensureBackendInstalled']); },
  async execChecked(command, args) { calls.push(['exec', command, args]); },
  startOverlayTask(kind) { calls.push(['startTask', kind]); return 'task-1'; },
  updateOverlayTask(id, payload) { calls.push(['updateTask', id, payload.message]); },
  finishOverlayTask(id, success, message) { calls.push(['finishTask', id, success, message]); },
  async stopBackendWorker() { calls.push(['stopWorker']); },
  rebuildMenu() { calls.push(['rebuildMenu']); },
  setOverlayStatus() {},
  filenameFromPath: undefined,
  file: {
    exists(p) { return p === '/tmp/latin.zip' || Object.prototype.hasOwnProperty.call(storage, p); },
    read(p) { return storage[p] || ''; },
    write(p, value) { storage[p] = String(value); },
    list() { return []; }
  }
};

storage['/data/manifest.json'] = JSON.stringify({ dictionaries: {}, disabled: { Existing: true } });

vm.createContext(context);
vm.runInContext(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'), context);
context.ensureBundledBackendInstalled = async function ensureBundledBackendInstalled() {
  calls.push(['ensureBackendInstalled']);
};
context.stopBackendWorker = async function stopBackendWorker() {
  calls.push(['stopWorker']);
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

context.updateManifestAfterImport({ ok: true, title: 'Latin Dict' }, '/tmp/latin.zip');
let manifest = JSON.parse(storage['/data/manifest.json']);
assert(manifest.disabled.Existing === true, 'manifest update should preserve disabled state');
assert(manifest.dictionaries['Latin Dict'].termCount === 0, 'missing term_count should default to zero');
assert(manifest.dictionaries['Latin Dict'].pitchCount === 0, 'missing pitch_count should default to zero');
assert(manifest.dictionaries['Latin Dict'].freqCount === 0, 'missing freq_count should default to zero');
assert(manifest.dictionaries['Latin Dict'].language === 'unknown', 'missing language metadata should remain importable as unknown');
assert(manifest.profiles.default.dictionaryOrder.includes('Latin Dict'), 'imported dictionary should be appended to the active profile order');
assert(manifest.dictionaryOrder.includes('Latin Dict'), 'legacy dictionaryOrder mirror should stay in sync');

context.updateManifestAfterImport({ ok: true, term_count: 3, meta_count: 2 }, '/tmp/latin.zip');
manifest = JSON.parse(storage['/data/manifest.json']);
assert(manifest.dictionaries.latin.title === 'latin', 'missing title should fall back to safe ZIP filename');
assert(manifest.dictionaries.latin.termCount === 3, 'snake_case term_count should be parsed');
assert(manifest.dictionaries.latin.metaCount === 2, 'snake_case meta_count should be parsed');

assert(
  JSON.stringify(context.normalizeChosenFilePaths(['/tmp/a.zip', '/tmp/b.zip'])) === JSON.stringify(['/tmp/a.zip', '/tmp/b.zip']),
  'multi-select arrays should be preserved'
);
assert(
  JSON.stringify(context.normalizeChosenFilePaths('["/tmp/a.zip","/tmp/b.zip"]')) === JSON.stringify(['/tmp/a.zip', '/tmp/b.zip']),
  'JSON array picker results should be parsed'
);
assert(
  JSON.stringify(context.normalizeChosenFilePaths('/tmp/a.zip\n/tmp/b.zip')) === JSON.stringify(['/tmp/a.zip', '/tmp/b.zip']),
  'newline-separated picker results should be split'
);
assert(context.isFilePickerCancelError(new Error('User cancelled')), 'file picker cancellation should be detected');
assert(context.isFilePickerCancelError(new Error('canceled by user')), 'alternate cancellation spelling should be detected');
assert(!context.isFilePickerCancelError(new Error('permission denied')), 'non-cancel picker errors should remain failures');

const backendArgs = [];
context.runBackendJson = async function runBackendJson(args) {
  backendArgs.push(args.slice());
  return { ok: true, title: 'Latin Dict', term_count: 1 };
};

(async () => {
  await context.importDictionaryZip('/tmp/latin.zip');
  assert(backendArgs.length === 1, 'dictionary import should call exactly one backend command');
  assert(backendArgs[0][0] === 'import', 'dictionary import should call the backend import command');
  assert(!backendArgs.some(args => args[0] === 'lookup' || args[0] === 'client'), 'dictionary import should not perform lookup validation');
  assert(calls.some(call => call[0] === 'stopWorker'), 'successful import should refresh the worker without failing import');

  storage['/data/dictionaries'] = '';
  storage['/data/dictionaries/Latin Dict/index.json'] = JSON.stringify({ title: 'Latin Dict Title' });
  storage['/data/manifest.json'] = JSON.stringify({
    dictionaries: {
      'Latin Dict': { title: 'Latin Dict Title', termCount: 4 },
      'Latin Dict Title': { title: 'Latin Dict Title', termCount: 4 },
      'Keep Dict': { title: 'Keep Dict', termCount: 2 }
    },
    disabled: { 'Latin Dict': true, 'Keep Dict': true },
    dictionaryOrder: ['Latin Dict', 'Keep Dict'],
    activeProfileId: 'alt',
    profiles: {
      default: {
        id: 'default',
        name: 'Default',
        dictionaryOrder: ['Latin Dict', 'Keep Dict'],
        disabled: { 'Latin Dict': true },
        preferences: {}
      },
      alt: {
        id: 'alt',
        name: 'Alt',
        dictionaryOrder: ['Keep Dict', 'Latin Dict Title', 'Latin Dict'],
        disabled: { 'Latin Dict Title': true, 'Keep Dict': true },
        preferences: {}
      }
    }
  });
  context.file.list = function list(p) {
    if (p !== '/data/dictionaries') return [];
    return [
      { filename: 'Latin Dict', path: '/Latin Dict', isDir: true },
      { filename: 'Keep Dict', path: '/Keep Dict', isDir: true }
    ];
  };
  calls.length = 0;
  await context.deleteDictionary('Latin Dict');
  manifest = JSON.parse(storage['/data/manifest.json']);
  assert(!manifest.dictionaries['Latin Dict'], 'deleted dictionary manifest key should be removed');
  assert(!manifest.dictionaries['Latin Dict Title'], 'deleted dictionary title aliases should be removed');
  assert(manifest.dictionaries['Keep Dict'], 'unrelated dictionary metadata should remain');
  assert(!manifest.profiles.default.dictionaryOrder.includes('Latin Dict'), 'deleted dictionary should be removed from default profile order');
  assert(!manifest.profiles.alt.dictionaryOrder.includes('Latin Dict'), 'deleted dictionary folder name should be removed from active profile order');
  assert(!manifest.profiles.alt.dictionaryOrder.includes('Latin Dict Title'), 'deleted dictionary title should be removed from active profile order');
  assert(!manifest.profiles.default.disabled['Latin Dict'], 'deleted dictionary should be removed from default profile disabled map');
  assert(!manifest.profiles.alt.disabled['Latin Dict Title'], 'deleted dictionary title should be removed from active profile disabled map');
  assert(manifest.profiles.alt.disabled['Keep Dict'], 'unrelated disabled state should remain');
  assert(calls.some(call => call[0] === 'stopWorker'), 'dictionary delete should stop the worker before removing files');
  assert(calls.some(call => call[0] === 'exec' && call[1] === '/bin/mkdir' && call[2][1] === '/data/deleted-dictionaries'), 'dictionary delete should create the holding folder');
  const moveCall = calls.find(call => call[0] === 'exec' && call[1] === '/bin/mv');
  assert(moveCall && moveCall[2][1] === '/data/dictionaries/Latin Dict', 'dictionary delete should move the installed dictionary out of the active folder');
  assert(moveCall[2][2].indexOf('/data/deleted-dictionaries/Latin Dict-') === 0, 'dictionary delete should move the dictionary to the holding folder');
  assert(calls.some(call => call[0] === 'exec' && call[1] === '/bin/rm' && call[2][0] === '-rf' && call[2][2] === moveCall[2][2]), 'dictionary delete should clean up the moved dictionary directory in the background');
  console.log('dictionary import manifest tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
