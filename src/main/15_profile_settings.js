const DEFAULT_PROFILE_ID = "default";
const DEFAULT_AUDIO_SOURCE_URL =
  "http://127.0.0.1:5050/?term={term}&reading={reading}";
const DEFAULT_AUDIO_SOURCES_JSON = JSON.stringify([
  { url: DEFAULT_AUDIO_SOURCE_URL },
]);
const DEFAULT_ANKI_CONNECT_URL = "http://127.0.0.1:8765";
const DEFAULT_ANKI_FIELD_TEMPLATES_JSON = "{}";
const CONTROLLER_BUTTON_NAMES = [
  "primary",
  "back",
  "square",
  "audio",
  "leftShoulder",
  "rightShoulder",
  "leftTrigger",
  "rightTrigger",
  "dpadUp",
  "dpadDown",
  "dpadLeft",
  "dpadRight",
];
const CONTROLLER_BINDING_ACTIONS = {
  noPopup: [
    "none",
    "lookup",
    "toggle-pause",
    "resume-playback",
    "subtitle-previous",
    "subtitle-next",
    "seek-backward",
    "seek-forward",
    "frame-step-backward",
    "frame-step-forward",
    "volume-down",
    "volume-up",
    "speed-down",
    "speed-up",
    "audio-menu",
    "anki-primary",
    "anki-force-add",
  ],
  popup: [
    "none",
    "lookup",
    "toggle-pause",
    "close-popup",
    "subtitle-previous",
    "subtitle-next",
    "popup-up",
    "popup-down",
    "popup-left",
    "popup-right",
    "popup-scroll-up",
    "popup-scroll-down",
    "play-audio",
    "audio-menu",
    "anki-primary",
    "anki-force-add",
  ],
  audio: [
    "none",
    "close-audio-list",
    "audio-up",
    "audio-down",
    "audio-left",
    "audio-right",
    "audio-activate",
  ],
};
const DEFAULT_CONTROLLER_BINDINGS = {
  noPopup: {
    primary: "lookup",
    back: "resume-playback",
    square: "toggle-pause",
    audio: "audio-menu",
    leftShoulder: "subtitle-previous",
    rightShoulder: "subtitle-next",
    leftTrigger: "anki-force-add",
    rightTrigger: "anki-primary",
    dpadUp: "volume-up",
    dpadDown: "volume-down",
    dpadLeft: "seek-backward",
    dpadRight: "seek-forward",
  },
  popup: {
    primary: "lookup",
    back: "close-popup",
    square: "toggle-pause",
    audio: "audio-menu",
    leftShoulder: "subtitle-previous",
    rightShoulder: "subtitle-next",
    leftTrigger: "anki-force-add",
    rightTrigger: "anki-primary",
    dpadUp: "popup-scroll-up",
    dpadDown: "popup-scroll-down",
    dpadLeft: "popup-left",
    dpadRight: "popup-right",
  },
  audio: {
    primary: "audio-activate",
    back: "close-audio-list",
    square: "none",
    audio: "none",
    leftShoulder: "none",
    rightShoulder: "none",
    leftTrigger: "none",
    rightTrigger: "none",
    dpadUp: "audio-up",
    dpadDown: "audio-down",
    dpadLeft: "audio-left",
    dpadRight: "audio-right",
  },
};
const DEFAULT_CONTROLLER_NO_POPUP_BINDINGS_JSON = JSON.stringify(
  DEFAULT_CONTROLLER_BINDINGS.noPopup,
);
const DEFAULT_CONTROLLER_POPUP_BINDINGS_JSON = JSON.stringify(
  DEFAULT_CONTROLLER_BINDINGS.popup,
);
const DEFAULT_CONTROLLER_AUDIO_BINDINGS_JSON = JSON.stringify(
  DEFAULT_CONTROLLER_BINDINGS.audio,
);
const PROFILE_PREFERENCE_DEFAULTS = {
  enabledByDefault: true,
  hideNativeSubtitles: true,
  bitmapSubtitleOcrEnabled: true,
  bitmapSubtitleOcrPrefetchEnabled: false,
  bitmapSubtitleOcrScreenshotFallbackEnabled: false,
  experimentalNativeSubtitleHitLayer: true,
  experimentalNativeSubtitleLookupHighlight: true,
  experimentalNativeSubtitleHitBoxes: false,
  experimentalNativeSubtitleTextOpacity: 0,
  experimentalNativeSubtitleValidation: false,
  pauseWhilePopupVisible: true,
  audioAutoPlay: false,
  audioSourcesJson: DEFAULT_AUDIO_SOURCES_JSON,
  ankiEnabled: false,
  ankiConnectUrl: DEFAULT_ANKI_CONNECT_URL,
  ankiConnectTimeoutSeconds: 3,
  ankiDeckName: "",
  ankiModelName: "",
  ankiFieldTemplatesJson: DEFAULT_ANKI_FIELD_TEMPLATES_JSON,
  ankiTags: "iinatan",
  ankiAudioFormat: "mp3",
  ankiAudioBitrateKbps: 96,
  ankiImageQuality: 85,
  ankiDuplicateCheck: true,
  ankiDuplicateMode: "prevent",
  ankiDuplicateScope: "deck",
  ankiSentenceAudioPaddingMs: 250,
  lookupLanguage: "ja",
  scanLength: 24,
  maxEntries: 3,
  maxGlossesPerEntry: 4,
  lookupTimeoutMs: 9000,
  fontScale: 1.0,
  popupScale: 0.92,
  popupMinWidth: 250,
  popupMaxWidth: 440,
  popupMaxHeightVh: 34,
  popupSubtitleGapPx: 34,
  subtitleLookupMode: "hover",
  nestedPopupMode: "off",
  nestedPopupMaxDepth: 3,
  flattenSubtitleLineBreaks: false,
  popupTheme: "inherit",
  subtitlePollMs: 120,
  etymologyCollapseDefault: "collapsed",
  wiktionaryEtymologyCollapseOverride: "collapsed",
  customPopupCss: "",
  hoverRequestTimeoutMs: 15000,
  backendTimeoutMs: 30000,
  debugLogEnabled: true,
  debugLogVerbose: false,
  directWorkerIpc: true,
  fallbackToClientExec: true,
  directIpcPollMs: 2,
  workerIdleSleepMs: 2,
  controllerEnabled: false,
  controllerNoPopupBindingsJson: DEFAULT_CONTROLLER_NO_POPUP_BINDINGS_JSON,
  controllerPopupBindingsJson: DEFAULT_CONTROLLER_POPUP_BINDINGS_JSON,
  controllerAudioBindingsJson: DEFAULT_CONTROLLER_AUDIO_BINDINGS_JSON,
};
const PROFILE_PREFERENCE_KEYS = Object.keys(PROFILE_PREFERENCE_DEFAULTS);
const GLOBAL_SETTINGS_DEFAULTS = {
  lowRamImport: true,
  importTimeoutMs: 1800000,
};
const GLOBAL_SETTINGS_KEYS = Object.keys(GLOBAL_SETTINGS_DEFAULTS);
const PROFILE_PREFERENCE_RUNTIME_EFFECTS = {
  lookupLanguage: ["lookupCache", "geometryCache", "backendRestart"],
  scanLength: ["lookupCache"],
  maxEntries: ["lookupCache"],
  maxGlossesPerEntry: ["lookupCache"],
  flattenSubtitleLineBreaks: ["geometryCache"],
  experimentalNativeSubtitleHitLayer: ["geometryCache", "nativeVisibility"],
  bitmapSubtitleOcrEnabled: ["geometryCache", "nativeVisibility"],
  bitmapSubtitleOcrPrefetchEnabled: ["geometryCache"],
  bitmapSubtitleOcrScreenshotFallbackEnabled: ["geometryCache"],
  experimentalNativeSubtitleTextOpacity: ["geometryCache"],
  experimentalNativeSubtitleValidation: ["geometryCache"],
  experimentalNativeSubtitleHitBoxes: ["hitLayer"],
  subtitlePollMs: ["polling"],
  hideNativeSubtitles: ["nativeVisibility"],
  workerIdleSleepMs: ["backendRestart"],
  controllerEnabled: ["backendRestart"],
};
function profilePreferenceRuntimeEffects(keys) {
  const effects = Object.create(null);
  (keys || []).forEach((key) => {
    (PROFILE_PREFERENCE_RUNTIME_EFFECTS[key] || []).forEach((effect) => {
      effects[effect] = true;
    });
  });
  return effects;
}

function normalizeAudioSourceUrl(value) {
  const url = String(value || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return "";
  return url;
}
function normalizeAudioSourceItem(source) {
  const raw =
    typeof source === "string"
      ? { url: source }
      : source && typeof source === "object"
        ? source
        : {};
  const url = normalizeAudioSourceUrl(raw.url);
  if (!url) return null;
  const name = String(raw.name || "").trim();
  return name ? { name, url } : { url };
}
function normalizeAudioSources(value) {
  let raw = value;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try {
      raw = JSON.parse(text);
    } catch (_) {
      raw = text;
    }
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.audioSources))
    raw = raw.audioSources;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const seen = Object.create(null);
  const out = [];
  values.forEach((item) => {
    const normalized = normalizeAudioSourceItem(item);
    if (!normalized || seen[normalized.url]) return;
    seen[normalized.url] = true;
    out.push(normalized);
  });
  return out;
}
function normalizeAudioSourcesJsonPreference(value, useDefaultWhenEmpty) {
  const sources = normalizeAudioSources(value);
  if (!sources.length && useDefaultWhenEmpty) return DEFAULT_AUDIO_SOURCES_JSON;
  return JSON.stringify(sources);
}
function normalizeAnkiConnectUrl(value) {
  const url = String(value || "").trim();
  if (!url || !/^https?:\/\//i.test(url) || /[\s<>"']/.test(url))
    return DEFAULT_ANKI_CONNECT_URL;
  return url.replace(/\/+$/, "");
}
function normalizeAnkiConnectTimeoutSeconds(value) {
  const timeout = Math.round(
    Number(value) || PROFILE_PREFERENCE_DEFAULTS.ankiConnectTimeoutSeconds,
  );
  return Math.max(1, Math.min(30, timeout));
}
function normalizeAnkiFieldTemplates(value) {
  let raw = value;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    try {
      raw = JSON.parse(text);
    } catch (_) {
      return {};
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  Object.keys(raw).forEach((key) => {
    const field = String(key || "").trim();
    if (!field) return;
    out[field] = String(
      raw[key] === undefined || raw[key] === null ? "" : raw[key],
    ).slice(0, 20000);
  });
  return out;
}
function normalizeAnkiFieldTemplatesJsonPreference(value) {
  return JSON.stringify(normalizeAnkiFieldTemplates(value));
}
function normalizeAnkiAudioFormat(value) {
  const format = String(value || "")
    .trim()
    .toLowerCase();
  return format === "opus" ? "opus" : "mp3";
}
function normalizeAnkiAudioBitrateKbps(value) {
  const bitrate = Math.round(
    Number(value) || PROFILE_PREFERENCE_DEFAULTS.ankiAudioBitrateKbps,
  );
  return Math.max(24, Math.min(320, bitrate));
}
function normalizeAnkiImageQuality(value) {
  const quality = Math.round(
    Number(value) || PROFILE_PREFERENCE_DEFAULTS.ankiImageQuality,
  );
  return Math.max(1, Math.min(100, quality));
}
function normalizeAnkiDuplicateMode(value) {
  const mode = String(value || "")
    .trim()
    .toLowerCase();
  return mode === "allow" ? "allow" : "prevent";
}
function normalizeAnkiDuplicateScope(value) {
  const scope = String(value || "")
    .trim()
    .toLowerCase();
  return scope === "collection" ? "collection" : "deck";
}
function normalizeProfilePreferenceBoolValue(value, fallback) {
  if (typeof preferenceValueToBool === "function")
    return preferenceValueToBool(value, fallback);
  if (value === undefined || value === null || value === "") return !!fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return !!fallback;
    if (["true", "1", "yes", "on"].indexOf(normalized) >= 0) return true;
    if (["false", "0", "no", "off"].indexOf(normalized) >= 0) return false;
  }
  return !!value;
}
function normalizeControllerBindings(value, context) {
  let raw = value;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) raw = {};
    else {
      try {
        raw = JSON.parse(text);
      } catch (_) {
        raw = {};
      }
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const defaults = DEFAULT_CONTROLLER_BINDINGS[context] || {};
  const actions = CONTROLLER_BINDING_ACTIONS[context] || ["none"];
  const allowedActions = Object.create(null);
  actions.forEach((action) => {
    allowedActions[action] = true;
  });
  const out = {};
  CONTROLLER_BUTTON_NAMES.forEach((button) => {
    const candidate = String(
      raw[button] === undefined ? defaults[button] || "none" : raw[button],
    ).trim();
    out[button] = allowedActions[candidate] ? candidate : "none";
  });
  return out;
}
function normalizeControllerBindingsJsonPreference(value, context) {
  return JSON.stringify(normalizeControllerBindings(value, context));
}
function controllerBindingsFromPreference(value, context) {
  return normalizeControllerBindings(value, context);
}
function normalizeProfilePreferences(prefs) {
  const out = {};
  PROFILE_PREFERENCE_KEYS.forEach((key) => {
    out[key] = PROFILE_PREFERENCE_DEFAULTS[key];
  });
  if (!prefs || typeof prefs !== "object") return out;
  const hasAudioSources = Object.prototype.hasOwnProperty.call(
    prefs,
    "audioSourcesJson",
  );
  PROFILE_PREFERENCE_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(prefs, key)) out[key] = prefs[key];
  });
  out.audioAutoPlay = normalizeProfilePreferenceBoolValue(
    out.audioAutoPlay,
    PROFILE_PREFERENCE_DEFAULTS.audioAutoPlay,
  );
  out.flattenSubtitleLineBreaks = normalizeProfilePreferenceBoolValue(
    out.flattenSubtitleLineBreaks,
    PROFILE_PREFERENCE_DEFAULTS.flattenSubtitleLineBreaks,
  );
  out.experimentalNativeSubtitleHitLayer = normalizeProfilePreferenceBoolValue(
    out.experimentalNativeSubtitleHitLayer,
    PROFILE_PREFERENCE_DEFAULTS.experimentalNativeSubtitleHitLayer,
  );
  out.bitmapSubtitleOcrEnabled = normalizeProfilePreferenceBoolValue(
    out.bitmapSubtitleOcrEnabled,
    PROFILE_PREFERENCE_DEFAULTS.bitmapSubtitleOcrEnabled,
  );
  out.bitmapSubtitleOcrPrefetchEnabled = normalizeProfilePreferenceBoolValue(
    out.bitmapSubtitleOcrPrefetchEnabled,
    PROFILE_PREFERENCE_DEFAULTS.bitmapSubtitleOcrPrefetchEnabled,
  );
  out.bitmapSubtitleOcrScreenshotFallbackEnabled =
    normalizeProfilePreferenceBoolValue(
      out.bitmapSubtitleOcrScreenshotFallbackEnabled,
      PROFILE_PREFERENCE_DEFAULTS.bitmapSubtitleOcrScreenshotFallbackEnabled,
    );
  out.experimentalNativeSubtitleLookupHighlight =
    normalizeProfilePreferenceBoolValue(
      out.experimentalNativeSubtitleLookupHighlight,
      PROFILE_PREFERENCE_DEFAULTS.experimentalNativeSubtitleLookupHighlight,
    );
  out.experimentalNativeSubtitleHitBoxes = normalizeProfilePreferenceBoolValue(
    out.experimentalNativeSubtitleHitBoxes,
    PROFILE_PREFERENCE_DEFAULTS.experimentalNativeSubtitleHitBoxes,
  );
  out.experimentalNativeSubtitleValidation =
    normalizeProfilePreferenceBoolValue(
      out.experimentalNativeSubtitleValidation,
      PROFILE_PREFERENCE_DEFAULTS.experimentalNativeSubtitleValidation,
    );
  out.controllerEnabled = normalizeProfilePreferenceBoolValue(
    out.controllerEnabled,
    PROFILE_PREFERENCE_DEFAULTS.controllerEnabled,
  );
  out.controllerNoPopupBindingsJson = normalizeControllerBindingsJsonPreference(
    out.controllerNoPopupBindingsJson,
    "noPopup",
  );
  out.controllerPopupBindingsJson = normalizeControllerBindingsJsonPreference(
    out.controllerPopupBindingsJson,
    "popup",
  );
  out.controllerAudioBindingsJson = normalizeControllerBindingsJsonPreference(
    out.controllerAudioBindingsJson,
    "audio",
  );
  out.experimentalNativeSubtitleTextOpacity = Math.max(
    0,
    Math.min(1, Number(out.experimentalNativeSubtitleTextOpacity) || 0),
  );
  const subtitleLookupMode = String(out.subtitleLookupMode || "")
    .trim()
    .toLowerCase();
  out.subtitleLookupMode =
    subtitleLookupMode === "shift-hover" ? "shift-hover" : "hover";
  const nestedPopupMode = String(out.nestedPopupMode || "")
    .trim()
    .toLowerCase();
  out.nestedPopupMode =
    nestedPopupMode === "hover" ||
    nestedPopupMode === "shift-hover" ||
    nestedPopupMode === "click"
      ? nestedPopupMode
      : "off";
  out.nestedPopupMaxDepth = Math.max(
    1,
    Math.min(99999, Math.round(Number(out.nestedPopupMaxDepth) || 3)),
  );
  out.audioSourcesJson = normalizeAudioSourcesJsonPreference(
    out.audioSourcesJson,
    !hasAudioSources,
  );
  out.ankiEnabled = normalizeProfilePreferenceBoolValue(
    out.ankiEnabled,
    PROFILE_PREFERENCE_DEFAULTS.ankiEnabled,
  );
  out.ankiConnectUrl = normalizeAnkiConnectUrl(out.ankiConnectUrl);
  out.ankiConnectTimeoutSeconds = normalizeAnkiConnectTimeoutSeconds(
    out.ankiConnectTimeoutSeconds,
  );
  out.ankiDeckName = String(out.ankiDeckName || "").trim();
  out.ankiModelName = String(out.ankiModelName || "").trim();
  out.ankiFieldTemplatesJson = normalizeAnkiFieldTemplatesJsonPreference(
    out.ankiFieldTemplatesJson,
  );
  out.ankiTags = String(out.ankiTags || "")
    .replace(/\s+/g, " ")
    .trim();
  out.ankiAudioFormat = normalizeAnkiAudioFormat(out.ankiAudioFormat);
  out.ankiAudioBitrateKbps = normalizeAnkiAudioBitrateKbps(
    out.ankiAudioBitrateKbps,
  );
  out.ankiImageQuality = normalizeAnkiImageQuality(out.ankiImageQuality);
  out.ankiDuplicateCheck = normalizeProfilePreferenceBoolValue(
    out.ankiDuplicateCheck,
    PROFILE_PREFERENCE_DEFAULTS.ankiDuplicateCheck,
  );
  out.ankiDuplicateMode = normalizeAnkiDuplicateMode(out.ankiDuplicateMode);
  out.ankiDuplicateScope = normalizeAnkiDuplicateScope(out.ankiDuplicateScope);
  out.ankiSentenceAudioPaddingMs = Math.max(
    0,
    Math.min(
      2000,
      Number.isFinite(Number(out.ankiSentenceAudioPaddingMs))
        ? Number(out.ankiSentenceAudioPaddingMs)
        : PROFILE_PREFERENCE_DEFAULTS.ankiSentenceAudioPaddingMs,
    ),
  );
  return out;
}
