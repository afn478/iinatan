const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = [
  "src/main/15_profile_settings.js",
  "src/main/20_dictionary_manifest.js",
  "src/main/22_profile_backup.js",
]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");

const livePreferences = {
  lookupLanguage: "fr",
  lowRamImport: false,
  importTimeoutMs: 90000,
};
const context = {
  VERSION: "2.0.1",
  preferences: {
    get(key) {
      return livePreferences[key];
    },
  },
  pref(key, fallback) {
    return Object.prototype.hasOwnProperty.call(livePreferences, key)
      ? livePreferences[key]
      : fallback;
  },
  manifestPath() {
    return "/data/manifest.json";
  },
  dictRoot() {
    return "/data/dictionaries";
  },
  pathJoin(...parts) {
    return parts.join("/").replace(/\/+/g, "/");
  },
  file: {
    exists() {
      return false;
    },
    read() {
      return "";
    },
    list() {
      return [];
    },
  },
  debugError() {},
  debugWarn() {},
  compactError(error) {
    return error && error.message ? error.message : String(error);
  },
  console,
};
vm.createContext(context);
vm.runInContext(source, context);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const oldJitendex = "Jitendex.org [2026-01-01]";
const currentManifest = {
  dictionaries: {},
  activeProfileId: "default",
  profiles: {
    default: {
      id: "default",
      name: "Japanese",
      dictionaryOrder: [oldJitendex, "Future Dictionary"],
      disabled: { [oldJitendex]: true },
      preferences: { lookupLanguage: "ja", unknownSetting: true },
    },
    reading: {
      id: "reading",
      name: "Reading",
      dictionaryOrder: ["Future Dictionary", oldJitendex],
      disabled: { "Future Dictionary": true },
      preferences: { lookupLanguage: "de" },
    },
  },
  pendingDictionaryReferences: {
    "Future Dictionary": {
      title: "Future Dictionary",
      downloadUrl: "https://example.test/future.zip",
    },
  },
};
const installedAtExport = [
  {
    name: oldJitendex,
    title: oldJitendex,
    revision: "2026-01-01",
    downloadUrl: "https://example.test/jitendex.zip",
    language: "ja",
  },
];

const backup = context.buildProfileSettingsBackup(
  currentManifest,
  installedAtExport,
);
assert(
  backup.format === "iinatan-profile-settings" && backup.schemaVersion === 1,
  "backup should carry a recognizable, versioned envelope",
);
assert(
  backup.profiles.default.preferences.lookupLanguage === "fr",
  "the active profile backup should use the live preference snapshot",
);
assert(
  backup.profiles.reading.preferences.lookupLanguage === "de",
  "inactive profiles should retain their stored preferences",
);
assert(
  !Object.prototype.hasOwnProperty.call(
    backup.profiles.default.preferences,
    "unknownSetting",
  ),
  "backup should omit unknown profile settings",
);
assert(
  backup.dictionaryReferences[oldJitendex].downloadUrl ===
    "https://example.test/jitendex.zip",
  "backup should store stable dictionary identity without dictionary data",
);
assert(
  !Object.prototype.hasOwnProperty.call(backup, "dictionaries"),
  "settings backup should not embed dictionary contents or manifest records",
);

const serialized = JSON.stringify(backup);
const parsed = context.parseProfileSettingsBackupText(serialized);
const newJitendex = "Jitendex.org [2026-07-30]";
const installedAtRestore = [
  {
    name: newJitendex,
    title: newJitendex,
    revision: "2026-07-30",
    downloadUrl: "https://example.test/jitendex.zip",
    language: "ja",
  },
  {
    name: "Local Only",
    title: "Local Only",
    revision: "1",
    language: "en",
  },
];
const restored = context.restoredProfileSettingsState(
  parsed,
  { dictionaries: { "Local Only": { title: "Local Only" } } },
  installedAtRestore,
);
const defaultProfile = restored.manifest.profiles.default;
assert(
  defaultProfile.dictionaryOrder[0] === newJitendex,
  "restore should reconcile a versioned dictionary through its stable URL",
);
assert(
  defaultProfile.disabled[newJitendex] === true &&
    !defaultProfile.disabled[oldJitendex],
  "reconciled dictionaries should inherit their restored enabled state",
);
assert(
  defaultProfile.dictionaryOrder.includes("Future Dictionary") &&
    restored.manifest.pendingDictionaryReferences["Future Dictionary"],
  "restore should retain references to dictionaries which are not installed",
);
assert(
  defaultProfile.dictionaryOrder.includes("Local Only") &&
    defaultProfile.disabled["Local Only"] === true,
  "installed dictionaries absent from the backup should be appended disabled",
);
assert(
  restored.globalSettings.lowRamImport === false &&
    restored.globalSettings.importTimeoutMs === 90000,
  "restore should normalize backed-up global import settings",
);

const futureInstalled = {
  name: "Future Dictionary 2027",
  title: "Future Dictionary 2027",
  downloadUrl: "https://example.test/future.zip",
  language: "en",
};
const reconciled = context.reconcilePendingDictionaryReferences(
  restored.manifest,
  futureInstalled,
);
assert(
  reconciled.profiles.default.dictionaryOrder.includes(
    "Future Dictionary 2027",
  ) &&
    !reconciled.profiles.default.dictionaryOrder.includes("Future Dictionary"),
  "a later dictionary install should replace the pending restored reference",
);
assert(
  reconciled.profiles.reading.disabled["Future Dictionary 2027"] === true,
  "later installs should recover each profile's backed-up enabled state",
);
assert(
  !reconciled.pendingDictionaryReferences["Future Dictionary"],
  "matched pending dictionary references should be cleared",
);

assert(
  (() => {
    try {
      context.parseProfileSettingsBackupText('{"format":"other"}');
      return false;
    } catch (_) {
      return true;
    }
  })(),
  "restore should reject unrelated JSON files",
);

console.log("profile backup and restore tests passed");
