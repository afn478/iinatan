const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = [
  'src/languages/common.js',
  'src/languages/japanese.js',
  'src/languages/english.js',
  'src/languages/korean.js',
  'src/languages/registry.js'
];

const context = {
  pref(key, fallback) {
    return fallback;
  }
};
vm.createContext(context);
vm.runInContext(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n') + '\nthis.registry = IINATAN_LANGUAGE_REGISTRY;', context);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ja = context.registry.get('ja');
const en = context.registry.get('en');
const ko = context.registry.get('ko');

assert(ja.id === 'ja', 'Japanese language should be registered');
assert(en.id === 'en', 'English language should be registered');
assert(ko.id === 'ko', 'Korean language should be registered');

assert(ja.isHoverableChar('魔'), 'Japanese kanji should be hoverable');
assert(!ja.isHoverableChar('r'), 'Latin character should not be Japanese-hoverable');

assert(en.isHoverableChar('r'), 'Latin character should be English-hoverable');
assert(!en.isHoverableChar('魔'), 'Japanese character should not be English-hoverable');

const englishText = 'I am running fast';
const nPos = Array.from(englishText).indexOf('n');
const enReq = en.lookupRequest(englishText, nPos, 24);
assert(enReq.lookupText === 'running', 'English hover inside running should query the whole word');
assert(enReq.suffix !== 'nning', 'English hover must not query the partial rightward suffix');
assert(enReq.lookupStart === 5, 'English word lookup should start at the word boundary');
assert(enReq.backendMode === 'exact', 'English should use exact no-deinflection lookup');
assert(enReq.cacheStrategy === 'exact-position', 'English lookup should keep exact-position cache semantics');

const jaText = '魔法使い';
const jaReq = ja.lookupRequest(jaText, 1, 24);
assert(jaReq.lookupText === '法使い', 'Japanese hover should keep rightward-prefix behavior');
assert(jaReq.lookupStart === 1, 'Japanese lookup should start at the hovered position');
assert(jaReq.backendMode === 'yomitan-japanese', 'Japanese should use HoshiDicts/Yomitan mode');

const koText = '한국어 공부';
const koReq = ko.lookupRequest(koText, 1, 24);
assert(koReq.lookupText === '한국어', 'Korean placeholder should query the contiguous Hangul run');
assert(koReq.backendMode === 'exact', 'Korean should use exact no-deinflection lookup');

console.log('language tests passed');
