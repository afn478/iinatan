const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = [
  'src/languages/common.js',
  'src/languages/deinflection.js',
  'src/languages/japanese.js',
  'src/languages/english_yomitan_rules.js',
  'src/languages/english.js',
  'src/languages/french_yomitan_rules.js',
  'src/languages/french.js',
  'src/languages/german_yomitan_rules.js',
  'src/languages/german.js',
  'src/languages/chinese.js',
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
const fr = context.registry.get('fr');
const de = context.registry.get('de');
const zh = context.registry.get('zh');
const ko = context.registry.get('ko');

assert(ja.id === 'ja', 'Japanese language should be registered');
assert(en.id === 'en', 'English language should be registered');
assert(fr.id === 'fr', 'French language should be registered');
assert(de.id === 'de', 'German language should be registered');
assert(zh.id === 'zh', 'Chinese language should be registered');
assert(ko.id === 'ko', 'Korean language should be registered');
assert(ja.lookupMode === 'yomitan-japanese', 'Japanese should declare HoshiDicts/Yomitan lookup mode');
assert(en.lookupMode === 'exact', 'English should declare exact lookup mode');
assert(fr.lookupMode === 'exact', 'French should declare exact lookup mode');
assert(de.lookupMode === 'exact', 'German should declare exact lookup mode');
assert(zh.lookupMode === 'prefix', 'Chinese should declare prefix lookup mode');
assert(ko.lookupMode === 'exact', 'Korean should declare exact lookup mode');
assert(ja.lookupUnit === 'character', 'Japanese should remain character lookup unit');
assert(en.lookupUnit === 'word', 'English should use word lookup unit');
assert(fr.lookupUnit === 'word', 'French should use word lookup unit');
assert(de.lookupUnit === 'word', 'German should use word lookup unit');
assert(zh.lookupUnit === 'character', 'Chinese should use character lookup unit');
assert(ko.lookupUnit === 'word', 'Korean should use word lookup unit');
assert(typeof ja.dictionaryMatches === 'function', 'Japanese should expose dictionary compatibility check');
assert(typeof en.dictionaryMatches === 'function', 'English should expose dictionary compatibility check');
assert(typeof fr.dictionaryMatches === 'function', 'French should expose dictionary compatibility check');
assert(typeof de.dictionaryMatches === 'function', 'German should expose dictionary compatibility check');
assert(typeof zh.dictionaryMatches === 'function', 'Chinese should expose dictionary compatibility check');
assert(typeof ko.dictionaryMatches === 'function', 'Korean should expose dictionary compatibility check');

assert(ja.isHoverableChar('魔'), 'Japanese kanji should be hoverable');
assert(!ja.isHoverableChar('r'), 'Latin character should not be Japanese-hoverable');

assert(en.isHoverableChar('r'), 'Latin character should be English-hoverable');
assert(!en.isHoverableChar('魔'), 'Japanese character should not be English-hoverable');
assert(fr.isHoverableChar('’'), 'French apostrophe should be hoverable');
assert(de.isHoverableChar('ä'), 'German umlaut should be hoverable');
assert(zh.isHoverableChar('中'), 'Chinese Han character should be hoverable');
assert(!zh.isHoverableChar('あ'), 'Japanese kana should not be Chinese-hoverable');

const englishText = 'I am running fast';
const nPos = Array.from(englishText).indexOf('n');
const enReq = en.lookupRequest(englishText, nPos, 24);
assert(enReq.lookupText === 'running', 'English hover inside running should query the whole word');
assert(enReq.suffix !== 'nning', 'English hover must not query the partial rightward suffix');
assert(enReq.lookupStart === 5, 'English word lookup should start at the word boundary');
assert(enReq.backendMode === 'exact', 'English should use exact no-deinflection lookup');
assert(enReq.cacheStrategy === 'word-candidates', 'English lookup should use word-candidates cache semantics');

[
  ['Running', 'running'],
  ['RUNNING', 'running'],
  ["Don't", "don't"],
  ['well-known', 'well-known']
].forEach(([input, expected]) => {
  const req = en.lookupRequest(input, 1, 24);
  assert(req.lookupText === expected, 'English should normalize ' + input + ' to ' + expected);
});

const runningStart = englishText.indexOf('running');
const runningEnd = runningStart + 'running'.length;
const firstRunningKey = en.lookupRequest(englishText, runningStart, 24).cacheKey;
for (let i = runningStart; i < runningEnd; i++) {
  const req = en.lookupRequest(englishText, i, 24);
  assert(req.lookupText === 'running', 'English char ' + i + ' inside running should query running');
  assert(req.lookupStart === runningStart && req.lookupEnd === runningEnd, 'English char ' + i + ' should resolve the running span');
  assert(req.cacheKey === firstRunningKey, 'English char ' + i + ' should share the same word cache key');
}

const said = candidateTexts(en.lookupRequest('said', 1, 24));
assertIncludes(said, 'say', 'English should include Yomitan said -> say past-tense rule');

const walked = candidateTexts(en.lookupRequest('walked', 2, 24));
assertIncludes(walked, 'walk', 'English should include Yomitan regular past-tense rules');

const running = candidateTexts(en.lookupRequest('running', 2, 24));
assertIncludes(running, 'run', 'English should include Yomitan doubled-consonant -ing rules');

const cats = candidateTexts(en.lookupRequest('cats', 2, 24));
assertIncludes(cats, 'cat', 'English should include Yomitan plural noun rules');

const jaText = '魔法使い';
const jaReq = ja.lookupRequest(jaText, 1, 24);
assert(jaReq.lookupText === '法使い', 'Japanese hover should keep rightward-prefix behavior');
assert(jaReq.lookupStart === 1, 'Japanese lookup should start at the hovered position');
assert(jaReq.backendMode === 'yomitan-japanese', 'Japanese should use HoshiDicts/Yomitan mode');
assert(jaReq.cacheStrategy === 'exact-position', 'Japanese lookup should remain exact-position cached');
assert(jaReq.lookupText === '法使い', 'Japanese lookup text should not be lowercased or normalized as Latin');

const koText = '한국어 공부';
const koReq = ko.lookupRequest(koText, 1, 24);
assert(koReq.lookupText === '한국어', 'Korean placeholder should query the contiguous Hangul run');
assert(koReq.backendMode === 'exact', 'Korean should use exact no-deinflection lookup');

const zhText = '我喜欢学习中文';
const zhReq = zh.lookupRequest(zhText, 0, 4);
assert(zhReq.lookupText === '我喜欢学', 'Chinese should query a bounded rightward prefix');
assert(zhReq.backendMode === 'prefix', 'Chinese should use prefix lookup without Japanese deinflection');
assert(zhReq.cacheStrategy === 'exact-position', 'Chinese should keep exact-position cache semantics');

function candidateTexts(reqOrList) {
  const list = Array.isArray(reqOrList) ? reqOrList : reqOrList.candidates;
  return list.map(c => c.text);
}

function assertIncludes(list, value, message) {
  assert(list.indexOf(value) >= 0, message + ' (missing ' + value + ' in ' + JSON.stringify(list) + ')');
}

const homme = candidateTexts(fr.lookupRequest('L’Homme', 1, 24));
assertIncludes(homme, 'l’homme', 'French should keep the original curly-apostrophe full candidate');
assertIncludes(homme, "l'homme", 'French should normalize curly apostrophes to straight apostrophes');
assertIncludes(homme, 'homme', 'French should try the tail after l apostrophe');
assert(homme.indexOf('l’homme') < homme.indexOf('homme'), 'French should try the full apostrophe form before the stripped tail');

const accord = candidateTexts(fr.lookupRequest('d’accord', 2, 24));
assertIncludes(accord, 'd’accord', 'French should keep d apostrophe as a full candidate');
assertIncludes(accord, "d'accord", 'French should normalize d apostrophe');
assertIncludes(accord, 'accord', 'French should try accord after d apostrophe');

const aime = candidateTexts(fr.lookupRequest('j’aime', 2, 24));
assertIncludes(aime, 'j’aime', 'French should keep j apostrophe as a full candidate');
assertIncludes(aime, 'aime', 'French should try aime after j apostrophe');
assertIncludes(aime, 'aimer', 'French should deinflect aime to aimer');

const mangent = candidateTexts(fr.lookupRequest('mangent', 2, 24));
assertIncludes(mangent, 'manger', 'French should include Yomitan present-indicative rules');

const attendez = candidateTexts(fr.lookupRequest('attendez', 2, 24));
assertIncludes(attendez, 'attendre', 'French should deinflect attendez to attendre');

const finies = candidateTexts(fr.lookupRequest('finies', 2, 24));
assertIncludes(finies, 'finir', 'French should include local feminine/plural past participle patches');

const achèterais = candidateTexts(fr.lookupRequest('achèterais', 3, 24));
assertIncludes(achèterais, 'acheter', 'French should include Yomitan stem-change conditional rules');

const quil = candidateTexts(fr.lookupRequest('qu’il', 2, 24));
assertIncludes(quil, 'qu’il', 'French should keep qu apostrophe as a full candidate');
assertIncludes(quil, 'il', 'French should strip known qu elision');

const hui = candidateTexts(fr.lookupRequest("aujourd'hui", 8, 24));
assert(hui.indexOf('hui') < 0, "French should not blindly strip unknown/internal apostrophe prefixes");

const houses = candidateTexts(de.lookupRequest('Die Häuser stehen', 5, 24));
assertIncludes(houses, 'Häuser', 'German should preserve noun capitalization');
assertIncludes(houses, 'häuser', 'German should also try lowercase noun candidates');

const sammlung = candidateTexts(de.lookupRequest('Die Sammlung ist groß', 5, 24));
assertIncludes(sammlung, 'sammeln', 'German should include Yomitan -lung nominalization');

const erinnerung = candidateTexts(de.lookupRequest('Die Erinnerung bleibt', 5, 24));
assertIncludes(erinnerung, 'erinnern', 'German should include Yomitan -rung nominalization');

const lesbar = candidateTexts(de.lookupRequest('lesbar', 2, 24));
assertIncludes(lesbar, 'lesen', 'German should include Yomitan -bar to -en adjective rule');

const unmoeglich = candidateTexts(de.lookupRequest('unmöglich', 2, 24));
assertIncludes(unmoeglich, 'möglich', 'German should include Yomitan negative un- rule');

const wahrheit = candidateTexts(de.lookupRequest('Wahrheit', 3, 24));
assertIncludes(wahrheit, 'wahr', 'German should include Yomitan -heit nominalization');

const geschnitzt = candidateTexts(de.lookupRequest('geschnitzt', 3, 24));
assertIncludes(geschnitzt, 'schnitzen', 'German should include Yomitan regular past participle rules');

const aufzuraeumen = candidateTexts(de.lookupRequest('aufzuräumen', 4, 24));
assertIncludes(aufzuraeumen, 'aufräumen', 'German should include Yomitan separable zu-infinitive rules');

const split = de.lookupRequest('Ich stehe morgen früh auf.', 'Ich '.length + 1, 24);
assertIncludes(candidateTexts(split), 'aufstehen', 'German should generate separable verb infinitive from bounded right context');
assert(split.rightContext && split.rightContext.text.indexOf('auf') >= 0, 'German right context should include the separable prefix');

const abbreviated = de.lookupRequest('Er hilft z.T. schon viel mit.', 'Er '.length + 1, 24);
assertIncludes(candidateTexts(abbreviated), 'mithelfen', 'German abbreviation-aware scan should still find split verb prefixes');
assert(abbreviated.rightContext.text.indexOf('z.T.') >= 0, 'German right context should not split at z.T.');

const bounded = de.rightContextWindow('Ich stehe auf. Danach gehe ich weg und komme nie zurück.', 'Ich '.length, 'Ich stehe'.length);
assert(bounded.text.indexOf('Danach') < 0, 'German sentence scan should stop at a real period');
assert(Array.from(bounded.text).length <= 96, 'German right context should be bounded');

console.log('language tests passed');
