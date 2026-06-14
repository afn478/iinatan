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
  RECOMMENDED_JAPANESE_DICTIONARIES: [
    {
      id: 'jitendex-ja-en',
      title: 'Jitendex',
      downloadUrl: 'https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip',
      titlePrefixes: ['Jitendex']
    },
    {
      id: 'jmnedict-ja',
      title: 'JMnedict',
      downloadUrl: 'https://github.com/yomidevs/jmdict-yomitan/releases/latest/download/JMnedict.zip',
      titlePrefixes: ['JMnedict']
    },
    {
      id: 'jiten-global-frequency',
      title: 'Jiten Global',
      downloadUrl: 'https://api.jiten.moe/api/frequency-list/download?downloadType=yomitan',
      downloadUrlAliases: ['https://api.jiten.moe/api/frequency-list/download'],
      titlePrefixes: ['Jiten']
    }
  ],
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
  selectedLanguageModule() { return { id: 'fr', label: 'French' }; },
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
context.RECOMMENDED_DICTIONARIES_BY_LANGUAGE = {
  ja: context.RECOMMENDED_JAPANESE_DICTIONARIES,
  en: [
    {
      id: 'wty-en-en',
      title: 'wty-en-en',
      downloadUrl: 'https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/en/en/wty-en-en.zip',
      titlePrefixes: ['wty-en-en']
    }
  ],
  de: [
    {
      id: 'wty-de-en',
      title: 'wty-de-en',
      downloadUrl: 'https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/de/en/wty-de-en.zip',
      titlePrefixes: ['wty-de-en']
    }
  ]
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
assert(manifest.profiles.default.preferences.audioAutoPlay === false, 'word audio auto-play should default off per profile');
assert(JSON.parse(manifest.profiles.default.preferences.audioSourcesJson)[0].url === 'http://127.0.0.1:5050/?term={term}&reading={reading}', 'word audio sources should default to the local Anki audio server');
assert(manifest.profiles.default.preferences.ankiEnabled === false, 'Anki export should default off per profile');
assert(manifest.profiles.default.preferences.ankiConnectUrl === 'http://127.0.0.1:8765', 'AnkiConnect should default to localhost per profile');
assert(manifest.profiles.default.preferences.ankiAudioBitrateKbps === 96, 'Anki sentence audio bitrate should default per profile');
assert(manifest.profiles.default.preferences.ankiImageQuality === 85, 'Anki screenshot JPEG quality should default per profile');
assert(manifest.profiles.default.preferences.ankiDuplicateCheck === true, 'Anki duplicate checking should default on per profile');

assert(JSON.parse(context.normalizeAudioSourcesJsonPreference('', true))[0].url === 'http://127.0.0.1:5050/?term={term}&reading={reading}', 'missing audio source settings should receive the default source');
assert(context.normalizeAudioSourcesJsonPreference('[]', false) === '[]', 'explicitly empty audio source lists should stay empty');
assert(
  JSON.parse(context.normalizeAudioSourcesJsonPreference([{ url: 'ftp://example.invalid/audio' }, { url: 'http://127.0.0.1:5050/?term={term}' }], false)).length === 1,
  'audio source normalization should keep only http/https URLs'
);

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

  const jitendex = context.recommendedDictionaryById('jitendex-ja-en');
  const jiten = context.recommendedDictionaryById('jiten-global-frequency');
  assert(context.recommendedDictionaryMatchesInstalled(jitendex, { title: 'Jitendex.org [2026-06-06]' }), 'Jitendex recommendation should match installed Jitendex titles');
  assert(!context.recommendedDictionaryMatchesInstalled(jiten, { title: 'Jitendex.org [2026-06-06]' }), 'Jiten recommendation should not match Jitendex titles');
  assert(context.recommendedDictionaryMatchesInstalled(jiten, { title: 'Jiten', downloadUrl: 'https://api.jiten.moe/api/frequency-list/download' }), 'Jiten recommendation should match its canonical download URL without query parameters');
  assert(
    JSON.stringify(context.recommendedDictionariesForLanguage('en', []).map(item => item.id)) === JSON.stringify(['wty-en-en']),
    'English profiles should only show English recommended dictionaries'
  );
  assert(
    JSON.stringify(context.recommendedDictionariesForLanguage('de', []).map(item => item.id)) === JSON.stringify(['wty-de-en']),
    'German profiles should only show German recommended dictionaries'
  );

  storage['/data/manifest.json'] = JSON.stringify({
    dictionaries: {
      'JMnedict [2026-04-29]': { title: 'JMnedict [2026-04-29]', termCount: 600000 },
      'JMnedict [2026-06-14]': { title: 'JMnedict [2026-06-14]', termCount: 667587 },
      'Keep Dict': { title: 'Keep Dict', termCount: 2 }
    },
    dictionaryOrder: ['JMnedict [2026-04-29]', 'Keep Dict', 'JMnedict [2026-06-14]'],
    activeProfileId: 'default',
    profiles: {
      default: {
        id: 'default',
        name: 'Default',
        dictionaryOrder: ['JMnedict [2026-04-29]', 'Keep Dict', 'JMnedict [2026-06-14]'],
        disabled: {},
        preferences: {}
      },
      french: {
        id: 'french',
        name: 'French',
        dictionaryOrder: ['JMnedict [2026-04-29]'],
        disabled: { 'JMnedict [2026-04-29]': true },
        preferences: { lookupLanguage: 'fr' }
      }
    }
  });
  calls.length = 0;
  const replaced = await context.replaceRecommendedDictionaryMatches(
    context.recommendedDictionaryById('jmnedict-ja'),
    'JMnedict [2026-06-14]',
    [
      {
        name: 'JMnedict [2026-04-29]',
        title: 'JMnedict [2026-04-29]',
        path: '/data/dictionaries/JMnedict [2026-04-29]'
      }
    ]
  );
  manifest = JSON.parse(storage['/data/manifest.json']);
  assert(replaced.length === 1, 'Recommended dictionary replacement should report stale dictionaries');
  assert(!manifest.dictionaries['JMnedict [2026-04-29]'], 'Recommended dictionary replacement should remove stale manifest entries');
  assert(manifest.dictionaries['JMnedict [2026-06-14]'], 'Recommended dictionary replacement should preserve the new manifest entry');
  assert(
    JSON.stringify(manifest.profiles.default.dictionaryOrder) === JSON.stringify(['JMnedict [2026-06-14]', 'Keep Dict']),
    'Recommended dictionary replacement should preserve order position and remove duplicate new entries'
  );
  assert(manifest.profiles.french.disabled['JMnedict [2026-06-14]'], 'Recommended dictionary replacement should migrate disabled state in other profiles');
  assert(calls.some(call => call[0] === 'exec' && call[1] === '/bin/mv' && call[2][1] === '/data/dictionaries/JMnedict [2026-04-29]'), 'Recommended dictionary replacement should move stale dictionary files aside');
  console.log('dictionary import manifest tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
