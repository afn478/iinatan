const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = [
  'src/languages/common.js',
  'src/languages/deinflection.js',
  'src/languages/japanese.js',
  'src/languages/english.js',
  'src/languages/french_yomitan_rules.js',
  'src/languages/french.js',
  'src/languages/german_yomitan_rules.js',
  'src/languages/german.js',
  'src/languages/chinese.js',
  'src/languages/korean.js',
  'src/languages/registry.js',
  'src/main/20_dictionary_manifest.js'
];

const dictRootPath = '/data/dictionaries';
const dictMeta = {
  [dictRootPath + '/Jitendex.org [2026-06-06]/index.json']: {
    title: 'Jitendex.org [2026-06-06]',
    indexUrl: 'https://jitendex.org/static/yomitan.json',
    downloadUrl: 'https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip'
  },
  [dictRootPath + '/wty-en-de/index.json']: {
    title: 'wty-en-de',
    indexUrl: 'https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/index/wty-en-de-index.json',
    downloadUrl: 'https://huggingface.co/datasets/daxida/wty-release/resolve/main/latest/dict/en/de/wty-en-de.zip'
  },
  [dictRootPath + '/wty-fr-en/index.json']: {
    title: 'wty-fr-en',
    indexUrl: 'https://example.test/dict/fr/en/index.json',
    downloadUrl: 'https://example.test/dict/fr/en/wty-fr-en.zip'
  },
  [dictRootPath + '/wty-de-en/index.json']: {
    title: 'wty-de-en',
    indexUrl: 'https://example.test/dict/de/en/index.json',
    downloadUrl: 'https://example.test/dict/de/en/wty-de-en.zip'
  },
  [dictRootPath + '/wty-ko-en/index.json']: {
    title: 'wty-ko-en',
    indexUrl: 'https://example.test/dict/ko/en/index.json',
    downloadUrl: 'https://example.test/dict/ko/en/wty-ko-en.zip'
  },
  [dictRootPath + '/cc-cedict-zh-en/index.json']: {
    title: 'cc-cedict-zh-en',
    indexUrl: 'https://example.test/dict/zh/en/index.json',
    downloadUrl: 'https://example.test/dict/zh/en/cc-cedict-zh-en.zip',
    sourceLanguage: 'zh',
    targetLanguage: 'en'
  }
};

const context = {
  VERSION: '1.6.0',
  pref(key, fallback) {
    return context.selectedLanguage || fallback;
  },
  pathJoin(...parts) {
    return parts.join('/').replace(/\/+/g, '/');
  },
  dictRoot() {
    return dictRootPath;
  },
  manifestPath() {
    return '/data/manifest.json';
  },
  compactError(error) {
    return error && error.message ? error.message : String(error);
  },
  debugWarn() {},
  file: {
    exists(p) {
      return p === dictRootPath || p === '/data/manifest.json' || Object.prototype.hasOwnProperty.call(dictMeta, p);
    },
    read(p) {
      if (p === '/data/manifest.json') return JSON.stringify({ dictionaries: {}, disabled: {} });
      return JSON.stringify(dictMeta[p] || {});
    },
    list(p) {
      if (p !== dictRootPath) return [];
      return ['Jitendex.org [2026-06-06]', 'wty-en-de', 'wty-fr-en', 'wty-de-en', 'wty-ko-en', 'cc-cedict-zh-en'].map(name => ({
        filename: name,
        path: dictRootPath + '/' + name,
        isDir: true
      }));
    },
    write() {}
  },
  console
};
vm.createContext(context);
vm.runInContext(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'), context);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ja = context.languageModuleById('ja');
const en = context.languageModuleById('en');
const fr = context.languageModuleById('fr');
const de = context.languageModuleById('de');
const zh = context.languageModuleById('zh');
const ko = context.languageModuleById('ko');

context.selectedLanguage = 'ja';
assert(context.activeDictionaryPaths(ja).length === 6, 'Japanese should preserve all enabled dictionaries');

const enPaths = context.activeDictionaryPaths(en);
assert(enPaths.length === 6, 'English should keep every enabled dictionary active');
assert(enPaths.some(p => p.endsWith('/Jitendex.org [2026-06-06]')), 'English should not silently hide unknown/incompatible dictionaries');
const enCompatible = context.languageCompatibleDictionaries(en);
assert(enCompatible.length === 1, 'English compatibility diagnostics should still identify English-looking dictionaries');
assert(enCompatible[0].name === 'wty-en-de', 'English compatibility diagnostics should identify wty-en-de');

const koPaths = context.activeDictionaryPaths(ko);
assert(koPaths.length === 6, 'Korean should keep every enabled dictionary active');
assert(context.languageCompatibleDictionaries(ko)[0].name === 'wty-ko-en', 'Korean compatibility diagnostics should identify wty-ko-en');

const frPaths = context.activeDictionaryPaths(fr);
assert(frPaths.length === 6, 'French should keep every enabled dictionary active');
assert(context.languageCompatibleDictionaries(fr)[0].name === 'wty-fr-en', 'French compatibility diagnostics should identify wty-fr-en');

const dePaths = context.activeDictionaryPaths(de);
assert(dePaths.length === 6, 'German should keep every enabled dictionary active');
assert(context.languageCompatibleDictionaries(de)[0].name === 'wty-de-en', 'German compatibility diagnostics should identify wty-de-en');

const zhPaths = context.activeDictionaryPaths(zh);
assert(zhPaths.length === 6, 'Chinese should keep every enabled dictionary active');
assert(context.languageCompatibleDictionaries(zh)[0].name === 'cc-cedict-zh-en', 'Chinese compatibility diagnostics should identify zh dictionaries');

const fingerprint = context.workerFingerprint(enPaths.concat(koPaths), en);
assert(!fingerprint.includes('\n'), 'Worker fingerprint must stay on one config line');
const parsed = JSON.parse(fingerprint);
assert(parsed.language === 'en', 'Worker fingerprint should include selected language');
assert(parsed.dictionaries.length === 12, 'Worker fingerprint should include every supplied dictionary path');
assert(parsed.dictionaries[0] === enPaths[0], 'Worker fingerprint should preserve dictionary order');
assert(parsed.dictionaries[enPaths.length] === koPaths[0], 'Worker fingerprint should preserve repeated supplied order');

const originalRead = context.file.read;
context.file.read = function read(p) {
  if (p === '/data/manifest.json') {
    return JSON.stringify({
      dictionaries: {},
      disabled: {},
      activeProfileId: 'default',
      profiles: {
        default: {
          id: 'default',
          name: 'Default',
          dictionaryOrder: ['wty-ko-en', 'Jitendex.org [2026-06-06]'],
          disabled: { 'wty-ko-en': true },
          preferences: { lookupLanguage: 'ko', unknownSetting: true }
        }
      }
    });
  }
  return originalRead.call(context.file, p);
};
const orderedNames = context.dictionaryDirs().map(d => d.name);
assert(orderedNames[0] === 'wty-ko-en', 'Profile dictionary order should put selected dictionaries first');
assert(orderedNames[1] === 'Jitendex.org [2026-06-06]', 'Profile dictionary order should preserve explicit order');
assert(context.disabledDictionaryMap()['wty-ko-en'] === true, 'Profile disabled map should drive active dictionary state');
assert(context.profileSummaries()[0].id === 'default', 'Profile summaries should expose the default profile');
assert(context.profileSummaries()[0].locked === true, 'Default profile should be marked locked');
assert(context.activeDictionaryProfile().preferences.lookupLanguage === 'ko', 'Profile preferences should preserve selected language');
assert(context.activeDictionaryProfile().preferences.scanLength === 24, 'Profile preferences should fill default scan length');
assert(!Object.prototype.hasOwnProperty.call(context.activeDictionaryProfile().preferences, 'unknownSetting'), 'Profile preferences should drop unknown settings');
context.file.read = originalRead;

assert(
  /No dictionaries installed\/enabled for English/.test(context.dictionarySetupMessage(en, [])),
  'English setup message should be language-specific'
);
assert(
  /No dictionaries installed\/enabled for French/.test(context.dictionarySetupMessage(fr, [])),
  'French setup message should be language-specific'
);
assert(
  /No dictionaries installed\/enabled for German/.test(context.dictionarySetupMessage(de, [])),
  'German setup message should be language-specific'
);
assert(
  /No dictionaries installed\/enabled for Chinese/.test(context.dictionarySetupMessage(zh, [])),
  'Chinese setup message should be language-specific'
);
assert(
  /Settings/.test(context.dictionarySetupMessage(ja, [])),
  'Japanese setup message should point to iinatan Settings'
);

console.log('dictionary pipeline tests passed');
