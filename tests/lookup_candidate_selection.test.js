const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function emptyResult() {
  return { ok: true, results: [] };
}

function resultFor(expression, definitionTags) {
  return {
    ok: true,
    lookupString: expression,
    results: [{
      matched: expression,
      deinflected: expression,
      term: {
        expression,
        reading: '',
        rules: '',
        glossaries: [{
          dict: 'test',
          glossary: expression + ' definition',
          definitionTags: definitionTags || '',
          termTags: ''
        }]
      }
    }]
  };
}

function nonLemmaTupleResult(expression, lemma) {
  const result = resultFor(expression, 'non-lemma');
  result.results[0].term.glossaries[0].glossary = JSON.stringify([[lemma, ['inflected form']]]);
  return result;
}

async function runLookupSelection(candidates, responses, maxEntries) {
  const calls = [];
  const language = {
    id: 'fr',
    normalizeText(text) { return text; },
    lookupRequest() {
      return {
        lookupText: candidates[0].text,
        displayText: 'surface',
        suffix: '',
        lookupStart: 0,
        lookupEnd: 7,
        matchStart: 0,
        backendMode: 'exact',
        scanLength: 7,
        cacheKey: 'test:' + candidates.map(c => c.text).join('|'),
        candidates
      };
    }
  };
  const context = {
    console,
    selectedLanguageModule() { return language; },
    cleanSubtitleText(text) { return text; },
    charsOf(text) { return Array.from(String(text || '')); },
    prefNumber(key, fallback) { return key === 'maxEntries' ? (maxEntries || 3) : fallback; },
    activeDictionaryPaths() { return ['/dict']; },
    dictionarySetupMessage() { return ''; },
    debugVerbose() {},
    debugWarn() {},
    compactError(error) { return error && error.message ? error.message : String(error); },
    prefBool() { return false; },
    lookupCache: Object.create(null)
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'src/main/30_backend_import_worker_lookup.js'), 'utf8'), context);
  context.lookupViaWorker = async function lookupViaWorker(text) {
    calls.push(text);
    return responses[text] || emptyResult();
  };
  const result = await context.lookupAtPosition('surface', 0, 'test');
  return { calls, result };
}

(async () => {
  const nonLemmaThenLemma = await runLookupSelection([
    { text: 'attendez', displayText: 'attendez', source: 'surface' },
    { text: 'attender', displayText: 'attendez', source: 'deinflection' },
    { text: 'attendre', displayText: 'attendez', source: 'deinflection' }
  ], {
    attendez: resultFor('attendez', 'non-lemma'),
    attendre: resultFor('attendre', 'v')
  });
  assert(nonLemmaThenLemma.calls.join('|') === 'attendez|attender|attendre', 'Lookup should continue past non-lemma-only surface hits');
  assert(nonLemmaThenLemma.result.lookupText === 'attendre', 'Lookup should report the lemma candidate when it finds definitions');
  assert(nonLemmaThenLemma.result.results.length === 1, 'Lemma result should replace non-lemma-only fallback');
  assert(nonLemmaThenLemma.result.results[0].term.expression === 'attendre', 'Lemma definitions should be returned for inflected French forms');

  const elisionAggregate = await runLookupSelection([
    { text: "c'est", displayText: "c'est", source: 'surface' },
    { text: 'est', displayText: "c'est", source: 'french-elision' },
    { text: 'être', displayText: "c'est", source: 'deinflection' }
  ], {
    "c'est": resultFor("c'est", 'phrase'),
    est: resultFor('est', 'non-lemma'),
    'être': resultFor('être', 'v')
  });
  assert(elisionAggregate.calls.join('|') === "c'est|est|être", 'Lookup should scan elision and deinflection candidates after a surface hit');
  assert(elisionAggregate.result.candidateUsed.text === "c'est", 'Surface phrase hits should stay primary when they contain definitions');
  assert(elisionAggregate.result.results.map(r => r.term.expression).join('|') === "c'est|être", 'Regular candidate results should merge while non-lemma-only hits stay fallback-only');

  const fallbackOnly = await runLookupSelection([
    { text: 'attendez', displayText: 'attendez', source: 'surface' },
    { text: 'attender', displayText: 'attendez', source: 'deinflection' }
  ], {
    attendez: resultFor('attendez', 'non-lemma')
  });
  assert(fallbackOnly.result.lookupText === 'attendez', 'Non-lemma-only result should remain available when no lemma candidate hits');
  assert(fallbackOnly.result.noResult === false, 'Non-lemma fallback should not become an empty lookup');

  const tupleLemma = await runLookupSelection([
    { text: 'traditionsreichen', displayText: 'traditionsreichen', source: 'surface' }
  ], {
    traditionsreichen: nonLemmaTupleResult('traditionsreichen', 'traditionsreich'),
    traditionsreich: resultFor('traditionsreich', 'adj')
  });
  assert(tupleLemma.calls.join('|') === 'traditionsreichen|traditionsreich', 'Lookup should query tuple non-lemma references before falling back');
  assert(tupleLemma.result.lookupText === 'traditionsreich', 'Lookup should report the referenced lemma when it finds definitions');
  assert(tupleLemma.result.results.map(r => r.term.expression).join('|') === 'traditionsreich', 'Referenced lemma definitions should replace tuple-only non-lemma rows');

  const capitalizedFormBeforeLowercase = await runLookupSelection([
    { text: 'Erben', displayText: 'Erben', source: 'surface' },
    { text: 'erben', displayText: 'Erben', source: 'lowercase' }
  ], {
    Erben: nonLemmaTupleResult('Erben', 'Erbe'),
    Erbe: resultFor('Erbe', 'n'),
    erben: resultFor('erben', 'v')
  });
  assert(capitalizedFormBeforeLowercase.calls.join('|') === 'Erben|Erbe|erben', 'Lookup should follow capitalized non-lemma references before lowercase candidates');
  assert(capitalizedFormBeforeLowercase.result.lookupText === 'Erbe', 'Capitalized non-lemma references should stay primary over lowercase hits');
  assert(capitalizedFormBeforeLowercase.result.results.map(r => r.term.expression).join('|') === 'Erbe|erben', 'Capitalized noun lemma should be returned before lowercase verb definitions');

  console.log('lookup candidate selection tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
