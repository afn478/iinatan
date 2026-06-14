const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const files = [
  'src/main/20_dictionary_manifest.js',
  'src/main/55_anki_integration.js'
];

const context = {
  console,
  Date,
  Math,
  lastSubtitle: '私は猫です。',
  compactError(error) { return error && error.message ? error.message : String(error); },
  readManifest() {
    return {
      activeProfileId: 'default',
      profiles: {
        default: {
          id: 'default',
          name: 'Default',
          preferences: {}
        }
      }
    };
  },
  selectedLanguageModule() { return { id: 'ja' }; },
  dataRoot() { return '/data'; },
  dataPath(...parts) { return ['/data'].concat(parts).join('/'); },
  postToOverlay() {},
  postToDictionaryManager() {},
  debugWarn() {},
  normalizePopupThemePreference(value) { return value; },
  preferences: { get() { return undefined; } },
  file: {
    write() {},
    exists() { return false; }
  },
  utils: {
    async exec() { return { status: 0, stdout: '{}', stderr: '' }; }
  },
  mpv: {
    getString(name) {
      if (name === 'media-title') return '猫の映画';
      if (name === 'path') return '/Movies/neko.mkv';
      return '';
    },
    getNumber(name) {
      if (name === 'time-pos') return 83.4;
      return 0;
    },
    command() {}
  }
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

vm.createContext(context);
vm.runInContext(files.map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'), context);

const prefs = context.normalizeProfilePreferences({
  ankiConnectUrl: 'ftp://example.invalid',
  ankiAudioFormat: 'opus',
  ankiAudioBitrateKbps: 999,
  ankiImageQuality: 999,
  ankiDuplicateMode: 'allow',
  ankiDuplicateScope: 'collection',
  ankiSentenceAudioPaddingMs: 99999,
  ankiFieldTemplatesJson: '{"Expression":"{expression}","SentenceAudio":"{sentence-audio}"}'
});
assert(prefs.ankiConnectUrl === 'http://127.0.0.1:8765', 'Invalid AnkiConnect URLs should fall back to localhost');
assert(prefs.ankiAudioFormat === 'opus', 'Opus should be an accepted sentence audio format');
assert(prefs.ankiAudioBitrateKbps === 320, 'Audio bitrate should be clamped to a reasonable maximum');
assert(prefs.ankiImageQuality === 100, 'Image quality should be clamped to a valid percentage');
assert(prefs.ankiDuplicateMode === 'allow', 'Duplicate mode should preserve add-anyway');
assert(prefs.ankiDuplicateScope === 'collection', 'Duplicate scope should preserve collection mode');
assert(prefs.ankiSentenceAudioPaddingMs === 2000, 'Sentence audio padding should be clamped');

const mediaNeeds = context.ankiTemplatesNeedMedia({
  Expression: '{expression}',
  SentenceAudio: '{sentence-audio}',
  Picture: '',
  Glossary: '{glossary}'
});
assert(mediaNeeds.sentenceAudio === true, 'Sentence audio capture should be required only by audio markers');
assert(mediaNeeds.screenshot === false, 'Screenshot capture should not run for empty picture fields');

const noMediaNeeds = context.ankiTemplatesNeedMedia({
  Expression: '{expression}',
  Sentence: '{sentence}',
  Glossary: '{glossary}'
});
assert(noMediaNeeds.sentenceAudio === false, 'Sentence audio capture should be skipped when no audio marker is mapped');
assert(noMediaNeeds.screenshot === false, 'Screenshot capture should be skipped when no screenshot marker is mapped');

const wordAudioNeeds = context.ankiTemplatesNeedMedia({
  ExpressionAudio: '{audio}'
});
assert(wordAudioNeeds.wordAudio === true, 'Word audio should be requested by the audio marker');
assert(wordAudioNeeds.sentenceAudio === false, 'The audio marker should not trigger subtitle audio extraction');

const entry = {
  matched: '猫',
  term: {
    expression: '猫',
    reading: 'ねこ',
    glossaries: [{ dict: 'Jitendex', glossary: 'cat; feline' }],
    frequencies: [{ dict: 'JPDB', frequencies: [{ value: 120, displayValue: '120' }] }],
    pitches: [{ positions: [1] }]
  }
};
const cardContext = context.ankiCardContextFromPayload({
  context: {
    sentence: '私は猫です。',
    position: 2,
    expression: '猫',
    reading: 'ねこ',
    surface: '猫',
    entry,
    result: {
      text: '私は猫です。',
      lookupStart: 2,
      lookupEnd: 3,
      language: 'ja'
    }
  }
});
assert(cardContext.documentTitle === '猫の映画', 'Document title should come from mpv metadata when available');
assert(cardContext.sourcePath === '/Movies/neko.mkv', 'Source path should come from mpv');
assert(cardContext.timestamp === '1:23', 'Timestamp should be formatted from mpv time-pos');
assert(cardContext.clozePrefix === '私は', 'Cloze prefix should follow the subtitle position');
assert(cardContext.clozeBody === '猫', 'Cloze body should contain the looked-up surface');
assert(cardContext.clozeSuffix === 'です。', 'Cloze suffix should preserve the rest of the subtitle');

const rendered = context.renderAnkiFields({
  Expression: '{expression}',
  Sentence: '{cloze-prefix}<b>{cloze-body}</b>{cloze-suffix}',
  SentenceAudio: '{sentence-audio}',
  ExpressionAudio: '{audio}',
  Picture: '{screenshot}',
  Glossary: '{glossary-first}',
  Frequency: '{frequencies}',
  PitchPosition: '{pitch-accent-positions}',
  MiscInfo: '{document-title} {timestamp}'
}, cardContext, {
  sentenceAudio: 'iinatan-audio.mp3',
  wordAudio: 'iinatan-word.mp3',
  screenshot: 'iinatan-shot.jpg'
});
assert(rendered.Expression === '猫', 'Expression marker should render the headword');
assert(rendered.Sentence === '私は<b>猫</b>です。', 'Cloze markers should allow HTML around the looked-up word');
assert(rendered.SentenceAudio === '[sound:iinatan-audio.mp3]', 'Sentence audio marker should render Anki sound syntax');
assert(rendered.ExpressionAudio === '[sound:iinatan-word.mp3]', 'Word audio marker should render separate Anki sound syntax');
assert(rendered.Picture === '<img src="iinatan-shot.jpg">', 'Screenshot marker should render an image tag');
assert(rendered.Glossary === 'cat; feline', 'First glossary marker should render the first definition');
assert(rendered.Frequency === 'JPDB 120', 'Frequency marker should include dictionary and display value');
assert(rendered.PitchPosition === '1', 'Pitch position marker should render pitch positions');
assert(rendered.MiscInfo === '猫の映画 1:23', 'Document metadata markers should render together');

const duplicateOptions = context.ankiDuplicateOptions({
  ankiDuplicateMode: 'allow',
  ankiDuplicateScope: 'collection',
  ankiDeckName: 'Mining'
});
assert(duplicateOptions.allowDuplicate === true, 'Duplicate options should allow add-anyway when configured');
assert(duplicateOptions.duplicateScope === 'collection', 'Duplicate options should support collection scope');

console.log('anki integration tests passed');
