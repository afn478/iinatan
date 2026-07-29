const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/main/15_profile_settings.js"),
  "utf8",
);
const context = { console, JSON, Object, String, Number, Math };

vm.createContext(context);
vm.runInContext(
  source +
    `
globalThis.__profileSettings = {
  DEFAULT_AUDIO_SOURCE_URL,
  DEFAULT_AUDIO_SOURCES_JSON,
  DEFAULT_ANKI_CONNECT_URL,
  PROFILE_PREFERENCE_DEFAULTS,
  PROFILE_PREFERENCE_KEYS,
  GLOBAL_SETTINGS_DEFAULTS,
  GLOBAL_SETTINGS_KEYS,
  normalizeAudioSources,
  normalizeAudioSourcesJsonPreference,
  normalizeAnkiConnectUrl,
  normalizeAnkiFieldTemplates,
  normalizeProfilePreferences
};`,
  context,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, message + "\n" + actualJson);
}

const settings = context.__profileSettings;
const info = JSON.parse(fs.readFileSync(path.join(root, "Info.json"), "utf8"));

settings.PROFILE_PREFERENCE_KEYS.forEach((key) => {
  assert(
    Object.prototype.hasOwnProperty.call(info.preferenceDefaults, key),
    "Info.json should define profile preference default: " + key,
  );
  assertDeepEqual(
    settings.PROFILE_PREFERENCE_DEFAULTS[key],
    info.preferenceDefaults[key],
    "Profile default should match Info.json for " + key,
  );
});

settings.GLOBAL_SETTINGS_KEYS.forEach((key) => {
  assert(
    Object.prototype.hasOwnProperty.call(info.preferenceDefaults, key),
    "Info.json should define global setting default: " + key,
  );
  assertDeepEqual(
    settings.GLOBAL_SETTINGS_DEFAULTS[key],
    info.preferenceDefaults[key],
    "Global setting default should match Info.json for " + key,
  );
});

assert(
  settings.PROFILE_PREFERENCE_KEYS.indexOf("lowRamImport") < 0,
  "Profile preference keys should not include global import settings",
);
assert(
  settings.GLOBAL_SETTINGS_KEYS.indexOf("lookupLanguage") < 0,
  "Global setting keys should not include profile settings",
);

let prefs = settings.normalizeProfilePreferences({});
assert(
  JSON.parse(prefs.audioSourcesJson)[0].url ===
    settings.DEFAULT_AUDIO_SOURCE_URL,
  "Missing profile audio source config should receive the default source",
);
assert(
  prefs.ankiConnectUrl === settings.DEFAULT_ANKI_CONNECT_URL,
  "Missing AnkiConnect URL should receive the default URL",
);
assert(
  prefs.flattenSubtitleLineBreaks === false,
  "Subtitle line-break flattening should default to off",
);
assert(
  prefs.experimentalNativeSubtitleHitLayer === false &&
    prefs.experimentalNativeSubtitleLookupHighlight === true &&
    prefs.experimentalNativeSubtitleHitBoxes === false &&
    prefs.experimentalNativeSubtitleTextOpacity === 0 &&
    prefs.experimentalNativeSubtitleValidation === false,
  "Native lookup highlighting should default on while experimental diagnostics stay invisible",
);

prefs = settings.normalizeProfilePreferences({
  audioAutoPlay: "yes",
  audioSourcesJson: "[]",
  ankiEnabled: "1",
  ankiConnectUrl: "http://127.0.0.1:8765///",
  ankiConnectTimeoutSeconds: 999,
  ankiDeckName: "  Mining  ",
  ankiModelName: "  Basic  ",
  ankiFieldTemplatesJson: {
    " Front ": "{expression}",
    Back: null,
    "": "ignored",
  },
  ankiTags: "  mined   subtitles  ",
  ankiAudioFormat: "opus",
  ankiAudioBitrateKbps: 999,
  ankiImageQuality: -1,
  ankiDuplicateCheck: "0",
  ankiDuplicateMode: "allow",
  ankiDuplicateScope: "collection",
  ankiSentenceAudioPaddingMs: 99999,
  flattenSubtitleLineBreaks: "yes",
  experimentalNativeSubtitleHitLayer: "yes",
  experimentalNativeSubtitleLookupHighlight: "0",
  experimentalNativeSubtitleHitBoxes: "1",
  experimentalNativeSubtitleTextOpacity: 4,
  experimentalNativeSubtitleValidation: "yes",
  unknownSetting: "ignored",
});

assert(prefs.audioAutoPlay === true, "Boolean-like strings should normalize");
assert(
  prefs.audioSourcesJson === "[]",
  "Explicit empty audio sources remain empty",
);
assert(prefs.ankiEnabled === true, "Anki enabled should normalize as boolean");
assert(
  prefs.flattenSubtitleLineBreaks === true,
  "Subtitle line-break flattening should normalize boolean-like values",
);
assert(
  prefs.experimentalNativeSubtitleHitLayer === true &&
    prefs.experimentalNativeSubtitleHitBoxes === true &&
    prefs.experimentalNativeSubtitleValidation === true &&
    prefs.experimentalNativeSubtitleLookupHighlight === false,
  "Experimental native subtitle booleans should normalize",
);
assert(
  prefs.experimentalNativeSubtitleTextOpacity === 1,
  "Experimental copied-text opacity should clamp to one",
);
assert(
  settings.normalizeProfilePreferences({
    experimentalNativeSubtitleTextOpacity: -5,
  }).experimentalNativeSubtitleTextOpacity === 0,
  "Experimental copied-text opacity should clamp to zero",
);
assert(
  prefs.ankiConnectUrl === "http://127.0.0.1:8765",
  "AnkiConnect URL should trim trailing slashes",
);
assert(
  prefs.ankiConnectTimeoutSeconds === 30,
  "AnkiConnect timeout should clamp high values",
);
assert(prefs.ankiDeckName === "Mining", "Deck names should be trimmed");
assert(prefs.ankiModelName === "Basic", "Model names should be trimmed");
assertDeepEqual(
  JSON.parse(prefs.ankiFieldTemplatesJson),
  { Front: "{expression}", Back: "" },
  "Anki field templates should trim field names and stringify values",
);
assert(prefs.ankiTags === "mined subtitles", "Tags should collapse whitespace");
assert(prefs.ankiAudioFormat === "opus", "Opus should be accepted");
assert(prefs.ankiAudioBitrateKbps === 320, "Audio bitrate should clamp high");
assert(prefs.ankiImageQuality === 1, "Image quality should clamp low values");
assert(
  prefs.ankiDuplicateCheck === false,
  "Duplicate check should normalize falsey strings",
);
assert(
  prefs.ankiDuplicateMode === "allow",
  "Allow duplicate mode should survive",
);
assert(
  prefs.ankiDuplicateScope === "collection",
  "Collection duplicate scope should survive",
);
assert(
  prefs.ankiSentenceAudioPaddingMs === 2000,
  "Sentence audio padding should clamp high values",
);
assert(
  !Object.prototype.hasOwnProperty.call(prefs, "unknownSetting"),
  "Unknown profile preference keys should be dropped",
);

assert(
  settings.normalizeAnkiConnectUrl("ftp://127.0.0.1") ===
    settings.DEFAULT_ANKI_CONNECT_URL,
  "Unsafe AnkiConnect URL schemes should fall back to the default",
);
assertDeepEqual(
  settings.normalizeAudioSources({
    audioSources: [
      { name: "Local", url: "http://127.0.0.1:5050/audio" },
      { name: "Duplicate", url: "http://127.0.0.1:5050/audio" },
      { name: "Rejected", url: "file:///tmp/audio.mp3" },
      "https://example.invalid/audio",
    ],
  }),
  [
    { name: "Local", url: "http://127.0.0.1:5050/audio" },
    { url: "https://example.invalid/audio" },
  ],
  "Audio source normalization should preserve unique HTTP(S) sources only",
);

console.log("profile settings tests passed");
