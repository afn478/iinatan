const DEFAULT_PROFILE_ID = "default";
const PROFILE_PREFERENCE_KEYS = [
  "lookupLanguage",
  "fontScale",
  "popupScale",
  "popupMaxWidth",
  "popupMaxHeightVh",
  "popupSubtitleGapPx",
  "maxEntries",
  "maxGlossesPerEntry",
  "scanLength",
  "etymologyCollapseDefault",
  "wiktionaryEtymologyCollapseOverride",
  "customPopupCss"
];

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
  if (!prefs || typeof prefs !== "object") return out;
  PROFILE_PREFERENCE_KEYS.forEach(key => {
    if (Object.prototype.hasOwnProperty.call(prefs, key)) out[key] = prefs[key];
  });
  return out;
}
function makeDefaultProfile(id, name) {
  const profileId = String(id || DEFAULT_PROFILE_ID);
  return { id: profileId, name: String(name || "Default"), dictionaryOrder: [], disabled: {}, preferences: {} };
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
    active: id === normalized.activeProfileId
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
function unorderedDictionaryDirs() {
  try {
    if (!file.exists(dictRoot())) return [];
    const manifest = readManifest();
    return file.list(dictRoot(), { includeSubDir: false })
      .filter(item => item && item.isDir)
      .map(item => {
        const meta = readDictionaryIndexMetadata(item.path);
        const manifestEntry = (manifest.dictionaries && (manifest.dictionaries[item.filename] || manifest.dictionaries[meta.title])) || {};
        return {
          name: item.filename,
          path: item.path,
          title: meta.title || item.filename,
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
  if (lang.id === "ja") return "No dictionaries installed/enabled. Use Plugins -> iinatan -> Dictionaries -> Download Recommended Dictionaries.";
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
function ensureDictionaryInActiveProfileOrder(manifest, name) {
  const dictName = String(name || "").trim();
  if (!dictName) return normalizeManifestShape(manifest);
  return updateActiveProfile(manifest, profile => {
    const order = normalizeDictionaryOrder(profile.dictionaryOrder);
    if (order.indexOf(dictName) < 0) order.push(dictName);
    profile.dictionaryOrder = order;
  });
}
function applyProfilePreferences(profile) {
  if (!profile || !profile.preferences) return;
  Object.keys(profile.preferences).forEach(key => {
    if (PROFILE_PREFERENCE_KEYS.indexOf(key) >= 0) preferences.set(key, profile.preferences[key]);
  });
  try { if (preferences.sync) preferences.sync(); } catch (_) {}
}
function currentProfilePreferenceSnapshot() {
  const out = {};
  PROFILE_PREFERENCE_KEYS.forEach(key => {
    try {
      const value = preferences.get(key);
      if (value !== undefined) out[key] = value;
    } catch (_) {}
  });
  return out;
}
function profileIdFromName(name) {
  const base = String(name || "profile").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "profile";
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
function createDictionaryProfile(name, sourceProfileId) {
  const manifest = normalizeManifestShape(readManifest());
  const source = manifest.profiles[String(sourceProfileId || manifest.activeProfileId || DEFAULT_PROFILE_ID)] || activeDictionaryProfile(manifest);
  const id = uniqueProfileId(name || "Profile", manifest.profiles);
  manifest.profiles[id] = {
    id,
    name: String(name || "Profile"),
    dictionaryOrder: normalizeDictionaryOrder(source.dictionaryOrder),
    disabled: normalizeDisabledMap(source.disabled),
    preferences: Object.assign({}, source.preferences || {}, currentProfilePreferenceSnapshot())
  };
  writeManifest(manifest);
  rebuildMenu();
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return manifest.profiles[id];
}
function updateDictionaryProfilePreferences(profileId, prefs) {
  const manifest = normalizeManifestShape(readManifest());
  const id = String(profileId || manifest.activeProfileId || DEFAULT_PROFILE_ID);
  if (!manifest.profiles[id]) throw new Error("Unknown dictionary profile: " + id);
  manifest.profiles[id].preferences = normalizeProfilePreferences(Object.assign({}, manifest.profiles[id].preferences || {}, prefs || {}));
  writeManifest(manifest);
  if (typeof postDictionaryManagerState === "function") postDictionaryManagerState();
  return manifest.profiles[id];
}
function setActiveDictionaryProfile(profileId) {
  const requested = String(profileId || "").trim();
  const manifest = normalizeManifestShape(readManifest());
  if (!requested || !manifest.profiles[requested]) throw new Error("Unknown dictionary profile: " + requested);
  manifest.activeProfileId = requested;
  const normalized = normalizeManifestShape(manifest);
  writeManifest(normalized);
  applyProfilePreferences(activeDictionaryProfile(normalized));
  lookupCache = Object.create(null);
  activeWorkerFingerprint = null;
  activeWorkerReady = null;
  stopBackendWorker().catch(() => {});
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
