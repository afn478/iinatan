const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = [
  'src/languages/common.js',
  'src/languages/deinflection.js',
  'src/languages/japanese.js',
  'src/languages/english.js',
  'src/languages/french.js',
  'src/languages/german.js',
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
      return ['Jitendex.org [2026-06-06]', 'wty-en-de', 'wty-fr-en', 'wty-de-en', 'wty-ko-en'].map(name => ({
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
const ko = context.languageModuleById('ko');

context.selectedLanguage = 'ja';
assert(context.activeDictionaryPaths(ja).length === 5, 'Japanese should preserve all enabled dictionaries');

const enPaths = context.activeDictionaryPaths(en);
assert(enPaths.length === 1, 'English should select only English-compatible dictionaries');
assert(enPaths[0].endsWith('/wty-en-de'), 'English should select wty-en-de');

const koPaths = context.activeDictionaryPaths(ko);
assert(koPaths.length === 1, 'Korean should select only Korean-compatible dictionaries');
assert(koPaths[0].endsWith('/wty-ko-en'), 'Korean should select wty-ko-en');

const frPaths = context.activeDictionaryPaths(fr);
assert(frPaths.length === 1, 'French should select only French-compatible dictionaries');
assert(frPaths[0].endsWith('/wty-fr-en'), 'French should select wty-fr-en');

const dePaths = context.activeDictionaryPaths(de);
assert(dePaths.length === 1, 'German should select only German-compatible dictionaries');
assert(dePaths[0].endsWith('/wty-de-en'), 'German should select wty-de-en');

const fingerprint = context.workerFingerprint(enPaths.concat(koPaths), en);
assert(!fingerprint.includes('\n'), 'Worker fingerprint must stay on one config line');
const parsed = JSON.parse(fingerprint);
assert(parsed.language === 'en', 'Worker fingerprint should include selected language');
assert(parsed.dictionaries.length === 2, 'Worker fingerprint should include every dictionary path');
assert(parsed.dictionaries[0].endsWith('/wty-en-de'), 'Worker fingerprint should sort dictionary paths');

assert(
  /No English dictionaries/.test(context.dictionarySetupMessage(en, [])),
  'English setup message should be language-specific'
);
assert(
  /No French dictionaries/.test(context.dictionarySetupMessage(fr, [])),
  'French setup message should be language-specific'
);
assert(
  /No German dictionaries/.test(context.dictionarySetupMessage(de, [])),
  'German setup message should be language-specific'
);
assert(
  /Add Jitendex/.test(context.dictionarySetupMessage(ja, [])),
  'Japanese setup message should preserve Jitendex guidance'
);

console.log('dictionary pipeline tests passed');
