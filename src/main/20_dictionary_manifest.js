const DEFAULT_PROFILE_ID = "default";
const DEFAULT_AUDIO_SOURCE_URL = "http://127.0.0.1:5050/?term={term}&reading={reading}";
const DEFAULT_AUDIO_SOURCES_JSON = JSON.stringify([{ url: DEFAULT_AUDIO_SOURCE_URL }]);
const DEFAULT_ANKI_CONNECT_URL = "http://127.0.0.1:8765";
const DEFAULT_ANKI_FIELD_TEMPLATES_JSON = "{}";
const PROFILE_PREFERENCE_DEFAULTS = {
  enabledByDefault: true,
  hideNativeSubtitles: true,
  pauseWhilePopupVisible: true,
  audioAutoPlay: false,
  audioSourcesJson: DEFAULT_AUDIO_SOURCES_JSON,
  ankiEnabled: false,
  ankiConnectUrl: DEFAULT_ANKI_CONNECT_URL,
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
  popupMaxWidth: 440,
  popupMaxHeightVh: 34,
  popupSubtitleGapPx: 34,
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
  workerIdleSleepMs: 2
};
const PROFILE_PREFERENCE_KEYS = Object.keys(PROFILE_PREFERENCE_DEFAULTS);
const GLOBAL_SETTINGS_DEFAULTS = {
  lowRamImport: true,
  importTimeoutMs: 1800000
};
const GLOBAL_SETTINGS_KEYS = Object.keys(GLOBAL_SETTINGS_DEFAULTS);

function normalizeAudioSourceUrl(value) {
  const url = String(value || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return "";
  return url;
}
function normalizeAudioSourceItem(source) {
  const raw = typeof source === "string" ? { url: source } : (source && typeof source === "object" ? source : {});
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
    try { raw = JSON.parse(text); } catch (_) { raw = text; }
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.audioSources)) raw = raw.audioSources;
  const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const seen = Object.create(null);
  const out = [];
  values.forEach(item => {
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
  if (!url || !/^https?:\/\//i.test(url) || /[\s<>"']/.test(url)) return DEFAULT_ANKI_CONNECT_URL;
  return url.replace(/\/+$/, "");
}
function normalizeAnkiFieldTemplates(value) {
  let raw = value;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    try { raw = JSON.parse(text); } catch (_) { return {}; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  Object.keys(raw).forEach(key => {
    const field = String(key || "").trim();
    if (!field) return;
    out[field] = String(raw[key] === undefined || raw[key] === null ? "" : raw[key]).slice(0, 20000);
  });
  return out;
}
function normalizeAnkiFieldTemplatesJsonPreference(value) {
  return JSON.stringify(normalizeAnkiFieldTemplates(value));
}
function normalizeAnkiAudioFormat(value) {
  const format = String(value || "").trim().toLowerCase();
  return format === "opus" ? "opus" : "mp3";
}
function normalizeAnkiAudioBitrateKbps(value) {
  const bitrate = Math.round(Number(value) || PROFILE_PREFERENCE_DEFAULTS.ankiAudioBitrateKbps);
  return Math.max(24, Math.min(320, bitrate));
}
function normalizeAnkiImageQuality(value) {
  const quality = Math.round(Number(value) || PROFILE_PREFERENCE_DEFAULTS.ankiImageQuality);
  return Math.max(1, Math.min(100, quality));
}
function normalizeAnkiDuplicateMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "allow" ? "allow" : "prevent";
}
function normalizeAnkiDuplicateScope(value) {
  const scope = String(value || "").trim().toLowerCase();
  return scope === "collection" ? "collection" : "deck";
}
function normalizeProfilePreferenceBoolValue(value, fallback) {
  if (typeof preferenceValueToBool === "function") return preferenceValueToBool(value, fallback);
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
function emptyManifest() {
  return { dictionaries: {}, disabled: {}, dictionaryOrder: [], activeProfileId: DEFAULT_PROFILE_ID, profiles: {} };
}
function normalizeDictionaryOrder(order) {
  const seen = Object.create(null);
  const out = [];
  if (!Array.isArray(order)) return out;
  order.forEach(name => {
    const key = String(name || "").trim();
    if (key && !seen[key]) {
      seen[key] = true;
      out.push(key);
    }
  });
  return out;
}
function normalizeDisabledMap(map) {
  const out = {};
  if (!map || typeof map !== "object") return out;
  Object.keys(map).forEach(name => {
    if (map[name]) out[name] = true;
  });
  return out;
}
function normalizeProfilePreferences(prefs) {
  const out = {};
  PROFILE_PREFERENCE_KEYS.forEach(key => { out[key] = PROFILE_PREFERENCE_DEFAULTS[key]; });
  if (!prefs || typeof prefs !== "object") return out;
  const hasAudioSources = Object.prototype.hasOwnProperty.call(prefs, "audioSourcesJson");
  PROFILE_PREFERENCE_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(prefs, key)) out[key] = prefs[key];
  });
  out.audioAutoPlay = normalizeProfilePreferenceBoolValue(out.audioAutoPlay, PROFILE_PREFERENCE_DEFAULTS.audioAutoPlay);
  out.audioSourcesJson = normalizeAudioSourcesJsonPreference(out.audioSourcesJson, !hasAudioSources);
  out.ankiEnabled = normalizeProfilePreferenceBoolValue(out.ankiEnabled, PROFILE_PREFERENCE_DEFAULTS.ankiEnabled);
  out.ankiConnectUrl = normalizeAnkiConnectUrl(out.ankiConnectUrl);
  out.ankiDeckName = String(out.ankiDeckName || "").trim();
  out.ankiModelName = String(out.ankiModelName || "").trim();
  out.ankiFieldTemplatesJson = normalizeAnkiFieldTemplatesJsonPreference(out.ankiFieldTemplatesJson);
  out.ankiTags = String(out.ankiTags || "").replace(/\s+/g, " ").trim();
  out.ankiAudioFormat = normalizeAnkiAudioFormat(out.ankiAudioFormat);
  out.ankiAudioBitrateKbps = normalizeAnkiAudioBitrateKbps(out.ankiAudioBitrateKbps);
  out.ankiImageQuality = normalizeAnkiImageQuality(out.ankiImageQuality);
  out.ankiDuplicateCheck = normalizeProfilePreferenceBoolValue(out.ankiDuplicateCheck, PROFILE_PREFERENCE_DEFAULTS.ankiDuplicateCheck);
  out.ankiDuplicateMode = normalizeAnkiDuplicateMode(out.ankiDuplicateMode);
  out.ankiDuplicateScope = normalizeAnkiDuplicateScope(out.ankiDuplicateScope);
  out.ankiSentenceAudioPaddingMs = Math.max(0, Math.min(2000, Number(out.ankiSentenceAudioPaddingMs) || PROFILE_PREFERENCE_DEFAULTS.ankiSentenceAudioPaddingMs));
  return out;
}
function makeDefaultProfile(id, name) {
  const profileId = String(id || DEFAULT_PROFILE_ID);
  return { id: profileId, name: String(name || "Profile 1"), dictionaryOrder: [], disabled: {}, preferences: normalizeProfilePreferences({}) };
}
function normalizeManifestProfile(id, profile, manifest, existed) {
  const profileId = String(id || DEFAULT_PROFILE_ID);
  const source = profile && typeof profile === "object" ? profile : {};
  const fallbackFromRoot = !existed && (profileId === String(manifest.activeProfileId || DEFAULT_PROFILE_ID) || profileId === DEFAULT_PROFILE_ID);
  const fallback = makeDefaultProfile(profileId, profileId === DEFAULT_PROFILE_ID ? "Default" : profileId);
  return {
    id: profileId,
    name: String(source.name || fallback.name),
    dictionaryOrder: normalizeDictionaryOrder(
      Array.isArray(source.dictionaryOrder) ? source.dictionaryOrder :
        fallbackFromRoot ? manifest.dictionaryOrder : []
    ),
    disabled: normalizeDisabledMap(
      source.disabled && typeof source.disabled === "object" ? source.disabled :
        fallbackFromRoot ? manifest.disabled : {}
    ),
    preferences: normalizeProfilePreferences(source.preferences)
  };
}
function normalizeManifestShape(manifest) {
  const out = manifest && typeof manifest === "object" ? manifest : emptyManifest();
  if (!out.dictionaries || typeof out.dictionaries !== "object") out.dictionaries = {};
  out.disabled = normalizeDisabledMap(out.disabled);
  out.dictionaryOrder = normalizeDictionaryOrder(out.dictionaryOrder);
  out.activeProfileId = String(out.activeProfileId || DEFAULT_PROFILE_ID);
  const sourceProfiles = out.profiles && typeof out.profiles === "object" ? out.profiles : {};
  const profiles = {};
  Object.keys(sourceProfiles).forEach(id => {
    profiles[id] = normalizeManifestProfile(id, sourceProfiles[id], out, true);
  });
  if (!profiles[out.activeProfileId]) profiles[out.activeProfileId] = normalizeManifestProfile(out.activeProfileId, null, out, false);
  if (!profiles[DEFAULT_PROFILE_ID]) profiles[DEFAULT_PROFILE_ID] = normalizeManifestProfile(DEFAULT_PROFILE_ID, null, out, false);
  out.profiles = profiles;
  const active = profiles[out.activeProfileId] || profiles[DEFAULT_PROFILE_ID];
  out.disabled = normalizeDisabledMap(active.disabled);
  out.dictionaryOrder = normalizeDictionaryOrder(active.dictionaryOrder);
  return out;
}
function activeDictionaryProfile(manifest) {
  const normalized = normalizeManifestShape(manifest || readManifest());
  return normalized.profiles[normalized.activeProfileId] || normalized.profiles[DEFAULT_PROFILE_ID] || makeDefaultProfile(DEFAULT_PROFILE_ID, "Default");
}
function activeProfilePreferenceValue(key, fallback) {
  const preferenceKey = String(key || "");
  const fallbackValue = Object.prototype.hasOwnProperty.call(PROFILE_PREFERENCE_DEFAULTS, preferenceKey) ? PROFILE_PREFERENCE_DEFAULTS[preferenceKey] : fallback;
  const profile = activeDictionaryProfile(readManifest());
  const prefs = normalizeProfilePreferences(profile.preferences);
  if (Object.prototype.hasOwnProperty.call(prefs, preferenceKey)) return prefs[preferenceKey];
  return fallbackValue;
}
function activeProfilePreferenceBool(key, fallback) {
  const preferenceKey = String(key || "");
  const fallbackValue = Object.prototype.hasOwnProperty.call(PROFILE_PREFERENCE_DEFAULTS, preferenceKey) ? PROFILE_PREFERENCE_DEFAULTS[preferenceKey] : fallback;
  try {
    return preferenceValueToBool(activeProfilePreferenceValue(preferenceKey, fallbackValue), fallbackValue);
  } catch (_) {
    return prefBool(preferenceKey, fallbackValue);
  }
}
function profileSummaries(manifest) {
  const normalized = normalizeManifestShape(manifest || readManifest());
  return Object.keys(normalized.profiles).sort((a, b) => {
    if (a === normalized.activeProfileId) return -1;
    if (b === normalized.activeProfileId) return 1;
    if (a === DEFAULT_PROFILE_ID) return -1;
    if (b === DEFAULT_PROFILE_ID) return 1;
    return String(normalized.profiles[a].name || a).localeCompare(String(normalized.profiles[b].name || b));
  }).map(id => ({
    id,
    name: normalized.profiles[id].name || id,
    active: id === normalized.activeProfileId,
    locked: id === DEFAULT_PROFILE_ID
  }));
}
function activeProfileDisabledMap(manifest) {
  return normalizeDisabledMap(activeDictionaryProfile(manifest).disabled);
}
function activeProfileDictionaryOrder(manifest) {
  return normalizeDictionaryOrder(activeDictionaryProfile(manifest).dictionaryOrder);
}
function updateActiveProfile(manifest, updater) {
  const normalized = normalizeManifestShape(manifest || readManifest());
  const profile = activeDictionaryProfile(normalized);
  updater(profile, normalized);
  profile.dictionaryOrder = normalizeDictionaryOrder(profile.dictionaryOrder);
  profile.disabled = normalizeDisabledMap(profile.disabled);
  profile.preferences = normalizeProfilePreferences(profile.preferences);
  normalized.profiles[profile.id] = profile;
  normalized.dictionaryOrder = profile.dictionaryOrder.slice();
  normalized.disabled = normalizeDisabledMap(profile.disabled);
  return normalized;
}
function dictionaryOrderWithInstalledNames(requestedOrder, installedNames) {
  const installedSeen = Object.create(null);
  const installed = (installedNames || []).map(name => String(name || "")).filter(Boolean);
  installed.forEach(name => { installedSeen[name] = true; });
  const out = [];
  const used = Object.create(null);
  normalizeDictionaryOrder(requestedOrder).forEach(name => {
    if (installedSeen[name] && !used[name]) {
      used[name] = true;
      out.push(name);
    }
  });
  installed.forEach(name => {
    if (!used[name]) {
      used[name] = true;
      out.push(name);
    }
  });
  return out;
}
function orderedDictionaryDirs(installed, manifest) {
  const dicts = (installed || []).slice();
  const order = activeProfileDictionaryOrder(manifest);
  if (!order.length) return dicts;
  const byName = Object.create(null);
  dicts.forEach(d => { if (d && d.name) byName[d.name] = d; });
  const used = Object.create(null);
  const out = [];
  order.forEach(name => {
    if (byName[name] && !used[name]) {
      used[name] = true;
      out.push(byName[name]);
    }
  });
  dicts.forEach(d => {
    if (d && d.name && !used[d.name]) out.push(d);
  });
  return out;
}

function readManifest() {
  try {
    if (!file.exists(manifestPath())) return normalizeManifestShape(emptyManifest());
    const parsed = JSON.parse(file.read(manifestPath()));
    return normalizeManifestShape(parsed);
  } catch (_) { return normalizeManifestShape(emptyManifest()); }
}
function writeManifest(manifest) {
  try { file.write(manifestPath(), JSON.stringify(normalizeManifestShape(manifest), null, 2)); } catch (error) { console.warn("Could not write manifest: " + compactError(error)); }
}
function readDictionaryIndexMetadata(dictPath) {
  try {
    const indexPath = pathJoin(dictPath, "index.json");
    if (!file.exists(indexPath)) return {};
    const parsed = JSON.parse(file.read(indexPath));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    debugWarn("Could not read dictionary index metadata for " + String(dictPath || "") + ": " + compactError(error));
    return {};
  }
}
function normalizeDictionaryLanguage(value) {
  const lang = String(value || "").trim().toLowerCase();
  if (!lang) return "";
  if (/^(ja|jpn|jp|japanese)$/.test(lang)) return "ja";
  if (/^(en|eng|english)$/.test(lang)) return "en";
  if (/^(fr|fra|fre|french|francais|français)$/.test(lang)) return "fr";
  if (/^(de|deu|ger|german|deutsch)$/.test(lang)) return "de";
  if (/^(ko|kor|korean)$/.test(lang)) return "ko";
  if (/^(zh|zho|chi|cmn|yue|wuu|hak|nan|chinese|mandarin|cantonese|hanzi|hanyu|zhongwen)$/.test(lang)) return "zh";
  return lang;
}
function dictionaryLanguageFromMetadata(meta, manifestEntry) {
  const candidates = [
    meta && meta.language,
    meta && meta.lang,
    meta && meta.sourceLanguage,
    meta && meta.source_language,
    meta && meta.targetLanguage,
    meta && meta.target_language,
    manifestEntry && manifestEntry.language
  ];
  for (const candidate of candidates) {
    const normalized = normalizeDictionaryLanguage(candidate);
    if (normalized) return normalized;
  }
  return "unknown";
}
function filenameFromListPath(listPath) {
  return String(listPath || "").split(/[\\/]/).filter(Boolean).pop() || "";
}
function dictionaryListItemName(item) {
  const name = String((item && item.filename) || filenameFromListPath(item && item.path) || "").trim();
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) return "";
  return name;
}
function dictionaryListItemPath(item) {
  const name = dictionaryListItemName(item);
  return name ? pathJoin(dictRoot(), name) : "";
}
function unorderedDictionaryDirs() {
  try {
    if (!file.exists(dictRoot())) return [];
    const manifest = readManifest();
    return file.list(dictRoot(), { includeSubDir: false })
      .filter(item => item && item.isDir && dictionaryListItemName(item))
      .map(item => {
        const name = dictionaryListItemName(item);
        const dictPath = dictionaryListItemPath(item);
        const meta = readDictionaryIndexMetadata(dictPath);
        const manifestEntry = (manifest.dictionaries && (manifest.dictionaries[name] || manifest.dictionaries[meta.title])) || {};
        return {
          name,
          path: dictPath,
          title: meta.title || name,
          revision: meta.revision || "",
          format: meta.format || null,
          indexUrl: meta.indexUrl || "",
          downloadUrl: meta.downloadUrl || "",
          language: dictionaryLanguageFromMetadata(meta, manifestEntry),
          termCount: Number(manifestEntry.termCount || 0),
          metaCount: Number(manifestEntry.metaCount || 0),
          tagCount: Number(manifestEntry.tagCount || 0),
          mediaCount: Number(manifestEntry.mediaCount || 0),
          pitchCount: Number(manifestEntry.pitchCount || 0),
          freqCount: Number(manifestEntry.freqCount || 0)
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.warn("Could not list dictionaries: " + compactError(error));
    return [];
  }
}
function dictionaryDirs() {
  const manifest = readManifest();
  return orderedDictionaryDirs(unorderedDictionaryDirs(), manifest);
}
function recommendedDictionariesByLanguage() {
  if (typeof RECOMMENDED_DICTIONARIES_BY_LANGUAGE !== "undefined" && RECOMMENDED_DICTIONARIES_BY_LANGUAGE) return RECOMMENDED_DICTIONARIES_BY_LANGUAGE;
  return { ja: RECOMMENDED_JAPANESE_DICTIONARIES };
}
function recommendedDictionaryItemsForLanguage(language) {
  const groups = recommendedDictionariesByLanguage();
  const key = String(language || "ja");
  return Array.isArray(groups[key]) ? groups[key] : [];
}
function allRecommendedDictionaryItems() {
  const groups = recommendedDictionariesByLanguage();
  const out = [];
  Object.keys(groups).forEach(language => {
    if (Array.isArray(groups[language])) groups[language].forEach(item => out.push(item));
  });
  return out;
}
function recommendedDictionaryById(id) {
  const key = String(id || "");
  for (const item of allRecommendedDictionaryItems()) {
    if (item && item.id === key) return item;
  }
  return null;
}
function normalizeRecommendedDictionaryUrl(url) {
  return String(url || "").trim().replace(/\?.*$/, "");
}
function recommendedDictionaryUrlMatches(item, dict) {
  const installedUrl = normalizeRecommendedDictionaryUrl(dict && dict.downloadUrl);
  if (!installedUrl) return false;
  const urls = [item && item.downloadUrl].concat((item && Array.isArray(item.downloadUrlAliases)) ? item.downloadUrlAliases : []);
  return urls.some(url => normalizeRecommendedDictionaryUrl(url) === installedUrl);
}
function recommendedDictionaryTitlePrefixMatches(title, prefix) {
  const value = String(title || "").trim().toLowerCase();
  const needle = String(prefix || "").trim().toLowerCase();
  if (!value || !needle || value.indexOf(needle) !== 0) return false;
  const next = value.charAt(needle.length);
  return !next || !/[a-z0-9]/.test(next);
}
function recommendedDictionaryTitleMatches(item, dict) {
  const prefixes = (item && Array.isArray(item.titlePrefixes) && item.titlePrefixes.length) ? item.titlePrefixes : [item && item.title];
  const title = String((dict && dict.title) || "");
  const name = String((dict && dict.name) || "");
  return prefixes.some(prefix => recommendedDictionaryTitlePrefixMatches(title, prefix) || recommendedDictionaryTitlePrefixMatches(name, prefix));
}
function recommendedDictionaryMatchesInstalled(item, dict) {
  return !!(item && dict && (recommendedDictionaryUrlMatches(item, dict) || recommendedDictionaryTitleMatches(item, dict)));
}
function recommendedDictionaryInstalledMatches(item, dicts) {
  const seen = Object.create(null);
  const out = [];
  (dicts || []).forEach(dict => {
    if (!recommendedDictionaryMatchesInstalled(item, dict)) return;
    const key = String((dict && dict.path) || (dict && dict.name) || (dict && dict.title) || "");
    if (key && seen[key]) return;
    if (key) seen[key] = true;
    out.push(dict);
  });
  return out;
}
function recommendedDictionaryInstalled(item, dicts) {
  return recommendedDictionaryInstalledMatches(item, dicts).length > 0;
}
function recommendedDictionariesForLanguage(language, dicts) {
  return recommendedDictionaryItemsForLanguage(language).map(item => ({
    id: item.id,
    title: item.title,
    category: item.category || "",
    language: item.language || "Japanese",
    description: item.description || "",
    homepage: item.homepage || "",
    downloadUrl: item.downloadUrl,
    installed: recommendedDictionaryInstalled(item, dicts)
  }));
}
function disabledDictionaryMap(manifest) { return activeProfileDisabledMap(manifest || readManifest()); }
function dictionaryCompatibilityDetails(language, installed) {
  const lang = language || selectedLanguageModule();
  const dicts = installed || dictionaryDirs();
  const out = { compatible: [], unknown: [], incompatible: [] };
  if (!lang || lang.id === "ja" || typeof lang.dictionaryMatches !== "function") {
    out.compatible = dicts.slice();
    return out;
  }
  dicts.forEach(d => {
    try {
      if (d && d.language && d.language !== "unknown") {
        if (d.language === lang.id) out.compatible.push(d);
        else out.incompatible.push(d);
        return;
      }
      if (lang.dictionaryMatches(d)) out.compatible.push(d);
      else out.unknown.push(d);
    } catch (error) {
      debugWarn("Dictionary compatibility check failed language=" + String(lang.id || "") + " dict=" + String(d && d.name || "") + ": " + compactError(error));
      out.unknown.push(d);
    }
  });
  return out;
}
function languageCompatibleDictionaries(language, installed) {
  return dictionaryCompatibilityDetails(language, installed).compatible;
}
function activeDictionaryEntries(language) {
  const installed = dictionaryDirs();
  const disabled = disabledDictionaryMap();
  const seen = Object.create(null);
  const out = [];
  installed.filter(d => !disabled[d.name]).forEach(d => {
    const p = pathJoin(dictRoot(), d.name);
    if (!seen[p]) { seen[p] = true; out.push(d); }
  });
  return out;
}
function activeDictionaryPaths(language) {
  return activeDictionaryEntries(language).map(d => pathJoin(dictRoot(), d.name));
}
function dictionarySetupMessage(language, dicts) {
  const lang = language || selectedLanguageModule();
  const label = lang.label || lang.id || "selected language";
  if (dicts && dicts.length) return "";
  if (lang.id === "ja") return "No dictionaries installed/enabled. Use Plugins -> iinatan -> Settings... to download recommended dictionaries.";
  return "No dictionaries installed/enabled for " + label.replace(/\s*\(experimental\)\s*/i, "") + ". Import or enable a Yomitan dictionary ZIP.";
}
function dictionaryCompatibilityWarning(language, entries) {
  const lang = language || selectedLanguageModule();
  const dicts = entries || activeDictionaryEntries(lang);
  if (!lang || lang.id === "ja" || !dicts.length || typeof lang.dictionaryMatches !== "function") return "";
  const details = dictionaryCompatibilityDetails(lang, dicts);
  if (details.compatible.length || details.unknown.length) return "";
  return "No enabled dictionary is marked compatible with " + (lang.label || lang.id) + "; lookup will still try the enabled dictionaries.";
}
function workerFingerprint(dicts, language) {
  const lang = language || selectedLanguageModule();
  const paths = (dicts || activeDictionaryPaths(lang)).slice();
  return JSON.stringify({ version: VERSION, language: lang.id || "ja", dictionaries: paths });
}
function setDictionaryEnabled(name, enabledNow) {
  const manifest = updateActiveProfile(readManifest(), profile => {
    if (!profile.disabled) profile.disabled = {};
    if (enabledNow) delete profile.disabled[name]; else profile.disabled[name] = true;
  });
  writeManifest(manifest);
  lookupCache = Object.create(null);
  activeWorkerFingerprint = null;
  activeWorkerReady = null;
  stopBackendWorker().catch(() => {});
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  showOSD((enabledNow ? "Enabled" : "Disabled") + " dictionary: " + name);
}
function setDictionaryOrder(names) {
  const installedNames = unorderedDictionaryDirs().map(d => d.name);
  const manifest = updateActiveProfile(readManifest(), profile => {
    profile.dictionaryOrder = dictionaryOrderWithInstalledNames(names, installedNames);
  });
  writeManifest(manifest);
  lookupCache = Object.create(null);
  activeWorkerFingerprint = null;
  activeWorkerReady = null;
  stopBackendWorker().catch(() => {});
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  showOSD("Updated dictionary order.");
}
function dictionaryRemovalNameMap(names) {
  const out = Object.create(null);
  (Array.isArray(names) ? names : []).forEach(name => {
    const key = String(name || "").trim();
    if (key) out[key] = true;
  });
  return out;
}
function removeDictionaryReferencesFromProfile(profile, removeMap) {
  if (!profile || typeof profile !== "object") return;
  profile.dictionaryOrder = normalizeDictionaryOrder(profile.dictionaryOrder).filter(name => !removeMap[name]);
  profile.disabled = normalizeDisabledMap(profile.disabled);
  Object.keys(profile.disabled).forEach(name => {
    if (removeMap[name]) delete profile.disabled[name];
  });
}
function removeDictionaryReferencesFromManifest(manifest, names) {
  const normalized = normalizeManifestShape(manifest);
  const removeMap = dictionaryRemovalNameMap(names);
  Object.keys(normalized.dictionaries || {}).forEach(key => {
    const entry = normalized.dictionaries[key] || {};
    if (removeMap[key] || removeMap[entry.title] || removeMap[entry.name]) delete normalized.dictionaries[key];
  });
  Object.keys(normalized.profiles || {}).forEach(id => {
    removeDictionaryReferencesFromProfile(normalized.profiles[id], removeMap);
  });
  normalized.dictionaryOrder = normalizeDictionaryOrder(normalized.dictionaryOrder).filter(name => !removeMap[name]);
  normalized.disabled = normalizeDisabledMap(normalized.disabled);
  Object.keys(normalized.disabled).forEach(name => {
    if (removeMap[name]) delete normalized.disabled[name];
  });
  return normalizeManifestShape(normalized);
}
function replaceDictionaryReferencesInProfile(profile, removeMap, replacementName) {
  if (!profile || typeof profile !== "object") return;
  const replacement = String(replacementName || "").trim();
  const seen = Object.create(null);
  const order = [];
  normalizeDictionaryOrder(profile.dictionaryOrder).forEach(name => {
    const nextName = removeMap[name] && replacement ? replacement : name;
    if (nextName && !seen[nextName]) {
      seen[nextName] = true;
      order.push(nextName);
    }
  });
  profile.dictionaryOrder = order;
  const disabled = normalizeDisabledMap(profile.disabled);
  let replacementDisabled = !!(replacement && disabled[replacement]);
  Object.keys(disabled).forEach(name => {
    if (removeMap[name]) {
      replacementDisabled = replacementDisabled || !!disabled[name];
      delete disabled[name];
    }
  });
  if (replacement && replacementDisabled) disabled[replacement] = true;
  profile.disabled = disabled;
}
function replaceDictionaryReferencesInManifest(manifest, names, replacementName) {
  const normalized = normalizeManifestShape(manifest);
  const replacement = String(replacementName || "").trim();
  const removeMap = dictionaryRemovalNameMap(names);
  Object.keys(normalized.dictionaries || {}).forEach(key => {
    const entry = normalized.dictionaries[key] || {};
    if (key !== replacement && (removeMap[key] || removeMap[entry.title] || removeMap[entry.name])) delete normalized.dictionaries[key];
  });
  Object.keys(normalized.profiles || {}).forEach(id => {
    replaceDictionaryReferencesInProfile(normalized.profiles[id], removeMap, replacement);
  });
  normalized.dictionaryOrder = normalizeDictionaryOrder(normalized.dictionaryOrder).map(name => removeMap[name] && replacement ? replacement : name);
  normalized.dictionaryOrder = normalizeDictionaryOrder(normalized.dictionaryOrder);
  normalized.disabled = normalizeDisabledMap(normalized.disabled);
  let replacementDisabled = !!(replacement && normalized.disabled[replacement]);
  Object.keys(normalized.disabled).forEach(name => {
    if (removeMap[name]) {
      replacementDisabled = replacementDisabled || !!normalized.disabled[name];
      delete normalized.disabled[name];
    }
  });
  if (replacement && replacementDisabled) normalized.disabled[replacement] = true;
  return normalizeManifestShape(normalized);
}
function installedDictionaryByName(name) {
  const requested = String(name || "").trim();
  if (!requested) return null;
  const dicts = unorderedDictionaryDirs();
  for (let i = 0; i < dicts.length; i++) {
    if (dicts[i] && dicts[i].name === requested) return dicts[i];
  }
  return null;
}
function safeInstalledDictionaryPath(dictPath) {
  const root = String(dictRoot()).replace(/\/+$/, "");
  const candidate = String(dictPath || "").replace(/\/+$/, "");
  const relative = candidate.indexOf(root + "/") === 0 ? candidate.slice(root.length + 1) : "";
  const hasUnsafePart = relative.split("/").some(part => !part || part === "." || part === "..");
  if (!candidate || candidate === root || candidate.indexOf(root + "/") !== 0 || hasUnsafePart) {
    throw new Error("Refusing to delete dictionary outside installed dictionary folder: " + candidate);
  }
  return candidate;
}
function deletedDictionaryRoot() {
  return pathJoin(dataRoot(), "deleted-dictionaries");
}
function deletedDictionaryPath(name) {
  const safeName = String(name || "dictionary").replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/^-+|-+$/g, "") || "dictionary";
  return pathJoin(deletedDictionaryRoot(), safeName + "-" + String(Date.now()));
}
function deleteDictionaryPathInBackground(dictPath, name) {
  execChecked("/bin/rm", ["-rf", "--", dictPath]).catch(error => {
    debugWarn("background cleanup failed for deleted dictionary " + String(name || "") + ": " + compactError(error));
  });
}
async function deleteDictionary(name) {
  const dict = installedDictionaryByName(name);
  if (!dict) throw new Error("Dictionary is not installed: " + String(name || ""));
  const deletePath = safeInstalledDictionaryPath(dict.path);
  const removedPath = deletedDictionaryPath(dict.name);
  const names = [dict.name, dict.title, name].filter(Boolean);
  lookupCache = Object.create(null);
  activeWorkerFingerprint = null;
  activeWorkerReady = null;
  stopBackendWorker().catch(error => {
    debugWarn("dictionary delete could not stop worker before removing files: " + compactError(error));
  });
  await execChecked("/bin/mkdir", ["-p", deletedDictionaryRoot()]);
  await execChecked("/bin/mv", ["--", deletePath, removedPath]);
  writeManifest(removeDictionaryReferencesFromManifest(readManifest(), names));
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  deleteDictionaryPathInBackground(removedPath, dict.name);
  showOSD("Deleted dictionary: " + dict.name);
  return dict;
}
async function replaceRecommendedDictionaryMatches(item, replacementName, matches) {
  const replacement = String(replacementName || "").trim();
  if (!item || !replacement) return [];
  const replacementPath = safeInstalledDictionaryPath(pathJoin(dictRoot(), replacement));
  const seen = Object.create(null);
  const stale = [];
  (Array.isArray(matches) ? matches : []).forEach(dict => {
    if (!dict || !dict.path) return;
    const dictPath = safeInstalledDictionaryPath(dict.path);
    if (dictPath === replacementPath || seen[dictPath]) return;
    seen[dictPath] = true;
    stale.push(Object.assign({}, dict, { path: dictPath }));
  });
  if (!stale.length) return [];
  const names = [];
  stale.forEach(dict => {
    [dict.name, dict.title].forEach(name => {
      const key = String(name || "").trim();
      if (key && key !== replacement) names.push(key);
    });
  });
  lookupCache = Object.create(null);
  activeWorkerFingerprint = null;
  activeWorkerReady = null;
  await stopBackendWorker().catch(error => {
    debugWarn("recommended dictionary replacement could not stop worker before cleanup: " + compactError(error));
  });
  await execChecked("/bin/mkdir", ["-p", deletedDictionaryRoot()]);
  for (const dict of stale) {
    const removedPath = deletedDictionaryPath(dict.name || dict.title || item.title);
    await execChecked("/bin/mv", ["--", dict.path, removedPath]);
    deleteDictionaryPathInBackground(removedPath, dict.name || dict.title || item.title);
  }
  writeManifest(replaceDictionaryReferencesInManifest(readManifest(), names, replacement));
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return stale;
}
function ensureDictionaryInActiveProfileOrder(manifest, name) {
  const dictName = String(name || "").trim();
  if (!dictName) return normalizeManifestShape(manifest);
  return updateActiveProfile(manifest, profile => {
    const order = normalizeDictionaryOrder(profile.dictionaryOrder);
    if (order.indexOf(dictName) < 0) order.push(dictName);
    profile.dictionaryOrder = order;
  });
}
function readPreferenceForSnapshot(key) {
  const fallback = PROFILE_PREFERENCE_DEFAULTS[key];
  try {
    if (preferences && typeof preferences.get === "function") {
      const value = preferences.get(key);
      if (value !== undefined && value !== null && value !== "") return value;
    }
  } catch (_) {}
  try {
    if (typeof pref === "function") return pref(key, fallback);
  } catch (_) {}
  return fallback;
}
function applyProfilePreferences(profile) {
  if (!profile || !profile.preferences) return;
  const profilePreferences = normalizeProfilePreferences(profile.preferences);
  Object.keys(profilePreferences).forEach(key => {
    try {
      if (PROFILE_PREFERENCE_KEYS.indexOf(key) >= 0 && typeof preferences !== "undefined" && preferences && typeof preferences.set === "function") {
        preferences.set(key, profilePreferences[key]);
      }
    } catch (_) {}
  });
  try { if (typeof preferences !== "undefined" && preferences && preferences.sync) preferences.sync(); } catch (_) {}
}
function currentProfilePreferenceSnapshot() {
  const out = normalizeProfilePreferences({});
  PROFILE_PREFERENCE_KEYS.forEach(key => {
    out[key] = readPreferenceForSnapshot(key);
  });
  return normalizeProfilePreferences(out);
}
function profileIdFromName(name) {
  const base = String(name || "profile").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "profile";
}
function nextProfileName(profiles) {
  const names = Object.create(null);
  Object.keys(profiles || {}).forEach(id => {
    const name = String((profiles[id] && profiles[id].name) || "").trim();
    if (name) names[name] = true;
  });
  let index = Object.keys(profiles || {}).length + 1;
  while (names["Profile " + index]) index++;
  return "Profile " + index;
}
function uniqueProfileId(base, profiles) {
  const root = profileIdFromName(base);
  let id = root;
  let index = 2;
  while (profiles[id]) {
    id = root + "-" + String(index++);
  }
  return id;
}
function resetLookupRuntimeForProfileChange() {
  lookupCache = Object.create(null);
  lookupInFlight = Object.create(null);
  activeWorkerFingerprint = null;
  activeWorkerReady = null;
  lookupBackendReadyForNativeHide = false;
  try {
    if (typeof stopBackendWorker === "function") stopBackendWorker().catch(() => {});
  } catch (_) {}
}
function refreshRuntimeAfterProfileChange(reloadOverlay) {
  resetLookupRuntimeForProfileChange();
  if (reloadOverlay && typeof reloadOverlayForProfileChange === "function") {
    reloadOverlayForProfileChange();
  } else if (typeof pushOverlayConfigForProfileChange === "function") {
    pushOverlayConfigForProfileChange();
  }
}
function createDictionaryProfile(name, sourceProfileId) {
  const manifest = normalizeManifestShape(readManifest());
  const source = manifest.profiles[String(sourceProfileId || manifest.activeProfileId || DEFAULT_PROFILE_ID)] || activeDictionaryProfile(manifest);
  const sourcePreferences = source.id === manifest.activeProfileId ? currentProfilePreferenceSnapshot() : source.preferences;
  const profileName = String(name || nextProfileName(manifest.profiles)).trim() || nextProfileName(manifest.profiles);
  const id = uniqueProfileId(profileName, manifest.profiles);
  manifest.profiles[id] = {
    id,
    name: profileName,
    dictionaryOrder: normalizeDictionaryOrder(source.dictionaryOrder),
    disabled: normalizeDisabledMap(source.disabled),
    preferences: normalizeProfilePreferences(sourcePreferences)
  };
  writeManifest(manifest);
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return manifest.profiles[id];
}
function renameDictionaryProfile(profileId, name) {
  const manifest = normalizeManifestShape(readManifest());
  const id = String(profileId || manifest.activeProfileId || DEFAULT_PROFILE_ID);
  if (!manifest.profiles[id]) throw new Error("Unknown dictionary profile: " + id);
  const nextName = String(name || "").trim();
  if (!nextName) throw new Error("Profile name cannot be empty.");
  manifest.profiles[id].name = nextName;
  writeManifest(manifest);
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return manifest.profiles[id];
}
function deleteDictionaryProfile(profileId) {
  const manifest = normalizeManifestShape(readManifest());
  const id = String(profileId || "").trim();
  if (!id || !manifest.profiles[id]) throw new Error("Unknown dictionary profile: " + id);
  if (id === DEFAULT_PROFILE_ID) throw new Error("The first profile cannot be deleted.");
  const wasActive = id === manifest.activeProfileId;
  delete manifest.profiles[id];
  if (wasActive) manifest.activeProfileId = DEFAULT_PROFILE_ID;
  const normalized = normalizeManifestShape(manifest);
  writeManifest(normalized);
  if (wasActive) {
    applyProfilePreferences(activeDictionaryProfile(normalized));
    refreshRuntimeAfterProfileChange(true);
  } else {
    rebuildMenu();
  }
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return activeDictionaryProfile(normalized);
}
function updateDictionaryProfilePreferences(profileId, prefs) {
  const manifest = normalizeManifestShape(readManifest());
  const id = String(profileId || manifest.activeProfileId || DEFAULT_PROFILE_ID);
  if (!manifest.profiles[id]) throw new Error("Unknown dictionary profile: " + id);
  const previous = normalizeProfilePreferences(manifest.profiles[id].preferences);
  manifest.profiles[id].preferences = normalizeProfilePreferences(Object.assign({}, previous, prefs || {}));
  writeManifest(manifest);
  if (id === manifest.activeProfileId) {
    applyProfilePreferences(manifest.profiles[id]);
    refreshRuntimeAfterProfileChange(previous.lookupLanguage !== manifest.profiles[id].preferences.lookupLanguage);
    rebuildMenu();
  }
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return manifest.profiles[id];
}
function readGlobalSettingsSnapshot() {
  const out = {};
  GLOBAL_SETTINGS_KEYS.forEach(key => {
    const fallback = GLOBAL_SETTINGS_DEFAULTS[key];
    try {
      const value = typeof preferences !== "undefined" && preferences && typeof preferences.get === "function" ? preferences.get(key) : undefined;
      out[key] = value === undefined || value === null || value === "" ? fallback : value;
    } catch (_) {
      out[key] = fallback;
    }
  });
  return out;
}
function updateGlobalSettings(prefs) {
  const values = prefs && typeof prefs === "object" ? prefs : {};
  GLOBAL_SETTINGS_KEYS.forEach(key => {
    try {
      if (Object.prototype.hasOwnProperty.call(values, key) && typeof preferences !== "undefined" && preferences && typeof preferences.set === "function") {
        preferences.set(key, values[key]);
      }
    } catch (_) {}
  });
  try { if (typeof preferences !== "undefined" && preferences && preferences.sync) preferences.sync(); } catch (_) {}
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return readGlobalSettingsSnapshot();
}
function setActiveDictionaryProfile(profileId) {
  const requested = String(profileId || "").trim();
  const manifest = normalizeManifestShape(readManifest());
  if (!requested || !manifest.profiles[requested]) throw new Error("Unknown dictionary profile: " + requested);
  const currentId = manifest.activeProfileId || DEFAULT_PROFILE_ID;
  if (manifest.profiles[currentId]) {
    manifest.profiles[currentId].preferences = currentProfilePreferenceSnapshot();
  }
  manifest.activeProfileId = requested;
  const normalized = normalizeManifestShape(manifest);
  writeManifest(normalized);
  applyProfilePreferences(activeDictionaryProfile(normalized));
  refreshRuntimeAfterProfileChange(true);
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  showOSD("Switched iinatan profile: " + activeDictionaryProfile(normalized).name);
}
function addSubMenuItemCompat(parent, item) {
  if (!parent) throw new Error("No parent menu item");
  if (typeof parent.addSubMenuItem === "function") return parent.addSubMenuItem(item);
  if (typeof parent.addSubmenuItem === "function") return parent.addSubmenuItem(item);
  throw new Error("This IINA build did not expose MenuItem.addSubMenuItem/addSubmenuItem");
}
function addMenuItemSafe(item) {
  try { menu.addItem(item); return true; }
  catch (error) { console.warn("Could not add menu item: " + compactError(error)); return false; }
}
