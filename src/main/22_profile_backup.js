const PROFILE_SETTINGS_BACKUP_FORMAT = "iinatan-profile-settings";
const PROFILE_SETTINGS_BACKUP_SCHEMA_VERSION = 1;
const PROFILE_SETTINGS_BACKUP_MAX_BYTES = 5 * 1024 * 1024;

function profileBackupAppendNames(order, names) {
  const out = normalizeDictionaryOrder(order);
  const seen = Object.create(null);
  out.forEach((name) => {
    seen[name] = true;
  });
  (names || []).forEach((name) => {
    const key = String(name || "").trim();
    if (key && !seen[key]) {
      seen[key] = true;
      out.push(key);
    }
  });
  return out;
}

function dictionaryReferenceFromInstalledDictionary(dictionary) {
  const source = dictionary && typeof dictionary === "object" ? dictionary : {};
  return normalizeDictionaryReference(
    {
      title: source.title || source.name,
      revision: source.revision,
      indexUrl: source.indexUrl,
      downloadUrl: source.downloadUrl,
      language: source.language,
    },
    source.name,
  );
}

function normalizedDictionaryReferenceUrl(value) {
  return String(value || "")
    .trim()
    .replace(/#.*$/, "")
    .replace(/\/+$/, "");
}

function dictionaryReferenceMatchesInstalled(
  referenceName,
  reference,
  dictionary,
) {
  const requestedName = String(referenceName || "").trim();
  const ref = normalizeDictionaryReference(reference, requestedName);
  const installedName = String((dictionary && dictionary.name) || "").trim();
  const installedTitle = String(
    (dictionary && dictionary.title) || installedName,
  ).trim();
  if (
    requestedName === installedName ||
    requestedName === installedTitle ||
    (ref.title && (ref.title === installedName || ref.title === installedTitle))
  )
    return true;
  const installedReference =
    dictionaryReferenceFromInstalledDictionary(dictionary);
  return ["downloadUrl", "indexUrl"].some((key) => {
    const expected = normalizedDictionaryReferenceUrl(ref[key]);
    const actual = normalizedDictionaryReferenceUrl(installedReference[key]);
    return !!expected && expected === actual;
  });
}

function matchingInstalledDictionary(referenceName, reference, installed) {
  const dictionaries = Array.isArray(installed) ? installed : [];
  const exact = dictionaries.filter((dictionary) => {
    const name = String((dictionary && dictionary.name) || "").trim();
    const title = String((dictionary && dictionary.title) || name).trim();
    return referenceName === name || referenceName === title;
  });
  if (exact.length === 1) return exact[0];
  const matches = dictionaries.filter((dictionary) =>
    dictionaryReferenceMatchesInstalled(referenceName, reference, dictionary),
  );
  return matches.length === 1 ? matches[0] : null;
}

function buildProfileSettingsBackup(manifest, installedDictionaries) {
  const normalized = normalizeManifestShape(manifest || readManifest());
  const installed = Array.isArray(installedDictionaries)
    ? installedDictionaries
    : unorderedDictionaryDirs();
  const installedNames = installed
    .map((dictionary) => String((dictionary && dictionary.name) || "").trim())
    .filter(Boolean);
  const profiles = {};
  Object.keys(normalized.profiles).forEach((id) => {
    const source = normalized.profiles[id];
    const preferences =
      id === normalized.activeProfileId
        ? currentProfilePreferenceSnapshot()
        : normalizeProfilePreferences(source.preferences);
    profiles[id] = {
      id,
      name: String(source.name || id),
      dictionaryOrder: profileBackupAppendNames(
        source.dictionaryOrder,
        installedNames,
      ),
      disabled: normalizeDisabledMap(source.disabled),
      preferences,
    };
  });

  const references = normalizePendingDictionaryReferences(
    normalized.pendingDictionaryReferences,
  );
  installed.forEach((dictionary) => {
    const name = String((dictionary && dictionary.name) || "").trim();
    if (name)
      references[name] = dictionaryReferenceFromInstalledDictionary(dictionary);
  });
  Object.keys(profiles).forEach((id) => {
    const profile = profiles[id];
    profileBackupAppendNames(
      profile.dictionaryOrder,
      Object.keys(profile.disabled),
    ).forEach((name) => {
      if (!references[name])
        references[name] = normalizeDictionaryReference(null, name);
    });
  });

  return {
    format: PROFILE_SETTINGS_BACKUP_FORMAT,
    schemaVersion: PROFILE_SETTINGS_BACKUP_SCHEMA_VERSION,
    appVersion: VERSION,
    exportedAt: new Date().toISOString(),
    activeProfileId: normalized.activeProfileId,
    profiles,
    globalSettings: readGlobalSettingsSnapshot(),
    dictionaryReferences: references,
  };
}

function validRestoredProfileId(value) {
  const id = String(value || "").trim();
  return !!(
    id &&
    id.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(id) &&
    id !== "__proto__" &&
    id !== "constructor" &&
    id !== "prototype"
  );
}

function normalizedRestoredGlobalSettings(settings) {
  const source =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? settings
      : {};
  const lowRamValue = source.lowRamImport;
  const lowRamImport =
    typeof lowRamValue === "string"
      ? !/^(?:0|false|no|off)$/i.test(lowRamValue.trim())
      : lowRamValue === undefined
        ? GLOBAL_SETTINGS_DEFAULTS.lowRamImport
        : !!lowRamValue;
  const timeout = Number(source.importTimeoutMs);
  return {
    lowRamImport,
    importTimeoutMs: Number.isFinite(timeout)
      ? Math.max(30000, Math.min(7200000, Math.round(timeout)))
      : GLOBAL_SETTINGS_DEFAULTS.importTimeoutMs,
  };
}

function parseProfileSettingsBackupText(raw) {
  const text = String(raw || "");
  if (!text.trim()) throw new Error("The selected backup is empty.");
  if (text.length > PROFILE_SETTINGS_BACKUP_MAX_BYTES)
    throw new Error("The selected backup is larger than 5 MiB.");
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error("The selected backup is not valid JSON.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("The selected backup is not a JSON object.");
  if (data.format !== PROFILE_SETTINGS_BACKUP_FORMAT)
    throw new Error("This is not an iinatan profile settings backup.");
  if (data.schemaVersion !== PROFILE_SETTINGS_BACKUP_SCHEMA_VERSION)
    throw new Error(
      "Unsupported profile settings backup version: " +
        String(data.schemaVersion),
    );
  if (!data.profiles || typeof data.profiles !== "object")
    throw new Error("The backup does not contain any profiles.");
  return data;
}

function restoredProfileSettingsState(
  backup,
  currentManifest,
  installedDictionaries,
) {
  const sourceProfiles = backup.profiles;
  const profiles = {};
  Object.keys(sourceProfiles).forEach((sourceId) => {
    const source = sourceProfiles[sourceId];
    const id = String((source && source.id) || sourceId).trim();
    if (!validRestoredProfileId(id))
      throw new Error("The backup contains an invalid profile identifier.");
    if (profiles[id])
      throw new Error("The backup contains duplicate profile identifiers.");
    const disabled = {};
    Object.keys((source && source.disabled) || {}).forEach((name) => {
      if (validManifestMapKey(name) && source.disabled[name])
        disabled[name] = true;
    });
    profiles[id] = {
      id,
      name: String((source && source.name) || id)
        .trim()
        .slice(0, 200),
      dictionaryOrder: normalizeDictionaryOrder(
        source && source.dictionaryOrder,
      )
        .filter(validManifestMapKey)
        .slice(0, 2000),
      disabled,
      preferences: normalizeProfilePreferences(source && source.preferences),
    };
  });
  if (!Object.keys(profiles).length)
    throw new Error("The backup does not contain any profiles.");

  const current = normalizeManifestShape(currentManifest || readManifest());
  current.profiles = profiles;
  current.activeProfileId = profiles[backup.activeProfileId]
    ? backup.activeProfileId
    : profiles[DEFAULT_PROFILE_ID]
      ? DEFAULT_PROFILE_ID
      : Object.keys(profiles)[0];
  current.pendingDictionaryReferences = normalizePendingDictionaryReferences(
    backup.dictionaryReferences,
  );
  let restored = normalizeManifestShape(current);

  const installed = Array.isArray(installedDictionaries)
    ? installedDictionaries
    : unorderedDictionaryDirs();
  Object.keys(restored.pendingDictionaryReferences).forEach((referenceName) => {
    const dictionary = matchingInstalledDictionary(
      referenceName,
      restored.pendingDictionaryReferences[referenceName],
      installed,
    );
    if (!dictionary) return;
    const installedName = String(dictionary.name || dictionary.title || "");
    if (installedName && installedName !== referenceName)
      restored = replaceDictionaryReferencesInManifest(
        restored,
        [referenceName],
        installedName,
      );
    delete restored.pendingDictionaryReferences[installedName || referenceName];
    delete restored.pendingDictionaryReferences[referenceName];
  });

  const installedNames = installed
    .map((dictionary) => String((dictionary && dictionary.name) || "").trim())
    .filter(Boolean);
  Object.keys(restored.profiles).forEach((id) => {
    const profile = restored.profiles[id];
    const referenced = Object.create(null);
    profile.dictionaryOrder.forEach((name) => {
      referenced[name] = true;
    });
    profile.dictionaryOrder = profileBackupAppendNames(
      profile.dictionaryOrder,
      installedNames,
    );
    installedNames.forEach((name) => {
      if (!referenced[name]) profile.disabled[name] = true;
    });
  });
  return {
    manifest: normalizeManifestShape(restored),
    globalSettings: normalizedRestoredGlobalSettings(backup.globalSettings),
  };
}

function reconcilePendingDictionaryReferences(manifest, installedDictionary) {
  let normalized = normalizeManifestShape(manifest);
  const references = normalizePendingDictionaryReferences(
    normalized.pendingDictionaryReferences,
  );
  const installedName = String(
    (installedDictionary &&
      (installedDictionary.name || installedDictionary.title)) ||
      "",
  ).trim();
  if (!installedName) return normalized;
  Object.keys(references).forEach((referenceName) => {
    if (
      !dictionaryReferenceMatchesInstalled(
        referenceName,
        references[referenceName],
        installedDictionary,
      )
    )
      return;
    if (referenceName !== installedName)
      normalized = replaceDictionaryReferencesInManifest(
        normalized,
        [referenceName],
        installedName,
      );
    delete normalized.pendingDictionaryReferences[referenceName];
    delete normalized.pendingDictionaryReferences[installedName];
  });
  return normalizeManifestShape(normalized);
}

function profileBackupTimestamp(date) {
  return (date || new Date())
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
}

function normalizedProfileBackupPickerPaths(value) {
  if (Array.isArray(value))
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  const selected = String(value || "").trim();
  return selected ? [selected] : [];
}

function profileBackupPickerCancelled(error) {
  return /cancel|cancelled|canceled|user abort|user-abort|user declined/i.test(
    String((error && error.message) || error || ""),
  );
}

async function exportProfileSettingsBackup() {
  if (!utils || typeof utils.chooseFile !== "function")
    throw new Error("This IINA build does not expose a folder picker.");
  let selected;
  try {
    selected = await Promise.resolve(
      utils.chooseFile("Choose a folder for the settings backup", {
        chooseDir: true,
      }),
    );
  } catch (error) {
    if (profileBackupPickerCancelled(error))
      return { cancelled: true, message: "Settings backup cancelled." };
    throw error;
  }
  const directories = normalizedProfileBackupPickerPaths(selected);
  if (!directories.length)
    return { cancelled: true, message: "Settings backup cancelled." };
  const filename =
    "iinatan-profile-settings-" + profileBackupTimestamp(new Date()) + ".json";
  const destination = pathJoin(directories[0], filename);
  const backup = buildProfileSettingsBackup();
  file.write(destination, JSON.stringify(backup, null, 2) + "\n");
  if (typeof file.showInFinder === "function") file.showInFinder(destination);
  return {
    path: destination,
    message:
      "Settings backup saved. Dictionary files are not included; keep the JSON file private because it may contain custom URLs and Anki settings.",
  };
}

async function restoreProfileSettingsBackup() {
  if (!utils || typeof utils.chooseFile !== "function")
    throw new Error("This IINA build does not expose a file picker.");
  let selected;
  try {
    selected = await Promise.resolve(
      utils.chooseFile("Choose an iinatan profile settings backup", {
        allowedFileTypes: ["json"],
      }),
    );
  } catch (error) {
    if (profileBackupPickerCancelled(error))
      return { cancelled: true, message: "Settings restore cancelled." };
    throw error;
  }
  const paths = normalizedProfileBackupPickerPaths(selected);
  if (!paths.length)
    return { cancelled: true, message: "Settings restore cancelled." };
  const backup = parseProfileSettingsBackupText(file.read(paths[0]));
  if (
    utils &&
    typeof utils.ask === "function" &&
    !utils.ask(
      "Restore this backup? This replaces every iinatan profile and global import setting. Dictionary files are not changed.",
    )
  )
    return { cancelled: true, message: "Settings restore cancelled." };

  const previousManifest = readManifest();
  const previousGlobalSettings = readGlobalSettingsSnapshot();
  const restored = restoredProfileSettingsState(backup, previousManifest);
  try {
    writeManifest(restored.manifest);
    applyProfilePreferences(activeDictionaryProfile(restored.manifest));
    updateGlobalSettings(restored.globalSettings);
  } catch (error) {
    try {
      writeManifest(previousManifest);
      applyProfilePreferences(activeDictionaryProfile(previousManifest));
      updateGlobalSettings(previousGlobalSettings);
    } catch (rollbackError) {
      debugError(
        "Settings restore rollback failed: " + compactError(rollbackError),
      );
    }
    throw error;
  }
  refreshRuntimeAfterProfileChange();
  rebuildMenu();
  const unresolved = Object.keys(
    restored.manifest.pendingDictionaryReferences || {},
  ).length;
  return {
    message:
      "Settings restored for " +
      Object.keys(restored.manifest.profiles).length +
      " profile(s)." +
      (unresolved
        ? " " +
          unresolved +
          " dictionary reference(s) will be applied when matching dictionaries are installed."
        : ""),
  };
}
