function readManifest() {
  try {
    if (!file.exists(manifestPath())) return { dictionaries: {}, disabled: {} };
    const parsed = JSON.parse(file.read(manifestPath()));
    if (!parsed || typeof parsed !== "object") return { dictionaries: {}, disabled: {} };
    if (!parsed.dictionaries) parsed.dictionaries = {};
    if (!parsed.disabled) parsed.disabled = {};
    return parsed;
  } catch (_) { return { dictionaries: {}, disabled: {} }; }
}
function writeManifest(manifest) {
  try { file.write(manifestPath(), JSON.stringify(manifest || { dictionaries: {}, disabled: {} }, null, 2)); } catch (error) { console.warn("Could not write manifest: " + compactError(error)); }
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
function dictionaryDirs() {
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
function disabledDictionaryMap() { return readManifest().disabled || {}; }
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
  if (lang.id === "ja") return "No dictionaries installed/enabled. Use Plugins -> iinatan -> Dictionaries -> Add Jitendex.";
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
  const paths = (dicts || activeDictionaryPaths(lang)).slice().sort();
  return JSON.stringify({ version: VERSION, language: lang.id || "ja", dictionaries: paths });
}
function setDictionaryEnabled(name, enabledNow) {
  const manifest = readManifest();
  if (!manifest.disabled) manifest.disabled = {};
  if (enabledNow) delete manifest.disabled[name]; else manifest.disabled[name] = true;
  writeManifest(manifest);
  lookupCache = Object.create(null);
  activeWorkerFingerprint = null;
  stopBackendWorker().catch(() => {});
  rebuildMenu();
  showOSD((enabledNow ? "Enabled" : "Disabled") + " dictionary: " + name);
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
