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
function dictionaryDirs() {
  try {
    if (!file.exists(dictRoot())) return [];
    return file.list(dictRoot(), { includeSubDir: false })
      .filter(item => item && item.isDir)
      .map(item => ({ name: item.filename, path: item.path }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    console.warn("Could not list dictionaries: " + compactError(error));
    return [];
  }
}
function disabledDictionaryMap() { return readManifest().disabled || {}; }
function activeDictionaryPaths() {
  const installed = dictionaryDirs();
  const disabled = disabledDictionaryMap();
  const seen = Object.create(null);
  const out = [];
  installed.filter(d => !disabled[d.name]).forEach(d => {
    const p = pathJoin(dictRoot(), d.name);
    if (!seen[p]) { seen[p] = true; out.push(p); }
  });
  return out;
}
function workerFingerprint(dicts) { return (dicts || activeDictionaryPaths()).slice().sort().join("\n"); }
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
