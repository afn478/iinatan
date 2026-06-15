function dictionaryManagerAvailable() {
  return !!(
    standaloneWindow && typeof standaloneWindow.loadFile === "function"
  );
}
function postToDictionaryManager(name, data) {
  try {
    if (!standaloneWindow || typeof standaloneWindow.postMessage !== "function")
      return;
    standaloneWindow.postMessage(name, data || {});
  } catch (error) {
    debugWarn(
      "dictionary manager postMessage failed name=" +
        String(name || "") +
        ": " +
        compactError(error),
    );
  }
}
function dictionaryManagerState() {
  const manifest = readManifest();
  const disabled = disabledDictionaryMap(manifest);
  const dicts = dictionaryDirs();
  const activeProfile = activeDictionaryProfile(manifest);
  const profilePreferences = normalizeProfilePreferences(
    activeProfile.preferences,
  );
  const lookupLanguage = String(
    profilePreferences.lookupLanguage || pref("lookupLanguage", "ja"),
  );
  return {
    version: VERSION,
    dictionaries: dicts.map((dict, index) => ({
      name: dict.name,
      title: dict.title || dict.name,
      language: dict.language || "unknown",
      revision: dict.revision || "",
      format: dict.format || "",
      termCount: Number(dict.termCount || 0),
      metaCount: Number(dict.metaCount || 0),
      tagCount: Number(dict.tagCount || 0),
      mediaCount: Number(dict.mediaCount || 0),
      pitchCount: Number(dict.pitchCount || 0),
      freqCount: Number(dict.freqCount || 0),
      enabled: !disabled[dict.name],
      order: index,
    })),
    activeProfileId: manifest.activeProfileId || DEFAULT_PROFILE_ID,
    activeProfileName: activeProfile.name || "Profile 1",
    profiles: profileSummaries(manifest),
    profilePreferenceKeys: PROFILE_PREFERENCE_KEYS.slice(),
    profilePreferenceDefaults: Object.assign({}, PROFILE_PREFERENCE_DEFAULTS),
    profilePreferences,
    globalSettings: readGlobalSettingsSnapshot(),
    globalSettingDefaults: Object.assign({}, GLOBAL_SETTINGS_DEFAULTS),
    lookupLanguage,
    anki:
      typeof dictionaryManagerAnkiState === "function"
        ? dictionaryManagerAnkiState(profilePreferences)
        : null,
    recommendedDictionaries: recommendedDictionariesForLanguage(
      lookupLanguage,
      dicts,
    ),
  };
}
function postDictionaryManagerState() {
  try {
    postToDictionaryManager(
      "dictionary-manager-state",
      dictionaryManagerState(),
    );
  } catch (error) {
    debugWarn(
      "could not build dictionary manager state: " + compactError(error),
    );
  }
}
function postDictionaryManagerStatus(message, kind, busy) {
  postToDictionaryManager("dictionary-manager-status", {
    message: String(message || ""),
    kind: kind || "info",
    busy: !!busy,
    updatedAt: Date.now(),
  });
}
function runDictionaryManagerAction(label, action) {
  (async () => {
    const actionLabel = label || "Working";
    if (dictionaryManagerActionInFlight) {
      postDictionaryManagerStatus(
        "Another dictionary action is already running.",
        "info",
        true,
      );
      return;
    }
    dictionaryManagerActionInFlight = true;
    postDictionaryManagerStatus(actionLabel + "...", "info", true);
    try {
      const result = await action();
      postDictionaryManagerState();
      if (result && result.cancelled) {
        postDictionaryManagerStatus(
          result.message || actionLabel + " cancelled.",
          "info",
          false,
        );
        return;
      }
      postDictionaryManagerStatus(actionLabel + " complete.", "info", false);
    } catch (error) {
      const msg = actionLabel + " failed: " + compactError(error);
      debugError(
        "dictionary manager action failed label=" +
          actionLabel +
          " error=" +
          compactError(error),
      );
      postDictionaryManagerState();
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
    } finally {
      dictionaryManagerActionInFlight = false;
    }
  })();
}
function runDictionaryManagerZipImport() {
  (async () => {
    if (dictionaryManagerActionInFlight) {
      postDictionaryManagerStatus(
        "Another dictionary action is already running.",
        "info",
        true,
      );
      return;
    }
    let zipPaths = [];
    try {
      zipPaths = await chooseDictionaryZipPaths();
    } catch (error) {
      const msg =
        "Could not open dictionary ZIP picker: " + compactError(error);
      debugError(
        "dictionary manager file picker failed: " + compactError(error),
      );
      postDictionaryManagerState();
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
      return;
    }
    if (!zipPaths.length) {
      notify("Dictionary import cancelled.", "info", 3500);
      postDictionaryManagerState();
      postDictionaryManagerStatus(
        "Dictionary import cancelled.",
        "info",
        false,
      );
      return;
    }

    const countLabel =
      zipPaths.length === 1
        ? "dictionary"
        : String(zipPaths.length) + " dictionaries";
    dictionaryManagerActionInFlight = true;
    postDictionaryManagerStatus(
      "Importing " + countLabel + "...",
      "info",
      true,
    );
    try {
      await validateAndImportDictionaryZips(
        zipPaths,
        "dictionary-manager-picker",
      );
      postDictionaryManagerState();
      postDictionaryManagerStatus(
        "Imported " + countLabel + ".",
        "info",
        false,
      );
    } catch (error) {
      const msg = "Importing dictionary failed: " + compactError(error);
      debugError("dictionary manager import failed: " + compactError(error));
      postDictionaryManagerState();
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
    } finally {
      dictionaryManagerActionInFlight = false;
    }
  })();
}
function registerDictionaryManagerHandlers() {
  if (!standaloneWindow || typeof standaloneWindow.onMessage !== "function")
    return;
  const generation = ++dictionaryManagerHandlerGeneration;
  const onMessage = (name, handler) => {
    standaloneWindow.onMessage(name, (payload) => {
      if (generation !== dictionaryManagerHandlerGeneration) {
        debugVerbose(
          "ignored stale dictionary manager message name=" +
            String(name || "") +
            " generation=" +
            generation +
            " current=" +
            dictionaryManagerHandlerGeneration,
        );
        return;
      }
      handler(payload);
    });
  };
  onMessage("dictionary-manager-ready", () => {
    postDictionaryManagerState();
    postDictionaryManagerStatus("", "info", false);
    if (typeof refreshDictionaryManagerAnkiState === "function")
      refreshDictionaryManagerAnkiState();
  });
  onMessage("dictionary-manager-refresh", () => {
    postDictionaryManagerState();
    postDictionaryManagerStatus("Dictionary list refreshed.", "info", false);
  });
  onMessage("dictionary-manager-anki-refresh", (payload) => {
    if (typeof refreshDictionaryManagerAnkiState === "function")
      refreshDictionaryManagerAnkiState(payload && payload.preferences);
  });
  onMessage("dictionary-manager-set-enabled", (payload) => {
    const name = payload && payload.name;
    if (!name) return;
    setDictionaryEnabled(String(name), !!(payload && payload.enabled));
    postDictionaryManagerStatus("Dictionary selection saved.", "info", false);
  });
  onMessage("dictionary-manager-set-order", (payload) => {
    const order = payload && Array.isArray(payload.order) ? payload.order : [];
    setDictionaryOrder(order);
    postDictionaryManagerStatus("Dictionary order saved.", "info", false);
  });
  onMessage("dictionary-manager-delete", (payload) => {
    const name = payload && payload.name;
    if (!name) return;
    runDictionaryManagerAction("Deleting dictionary", () =>
      deleteDictionary(String(name)),
    );
  });
  onMessage("dictionary-manager-download-recommended", (payload) => {
    const requestedId = payload && payload.id;
    const item = recommendedDictionaryById(requestedId);
    const label =
      "Downloading " + ((item && item.title) || "recommended dictionary");
    runDictionaryManagerAction(label, () =>
      getRecommendedDictionaries(requestedId),
    );
  });
  onMessage("dictionary-manager-import-zip", () => {
    runDictionaryManagerZipImport();
  });
  onMessage("dictionary-manager-switch-profile", (payload) => {
    const profileId = payload && payload.profileId;
    if (!profileId) return;
    runDictionaryManagerAction("Switching profile", () => {
      setActiveDictionaryProfile(profileId);
      return Promise.resolve();
    });
  });
  onMessage("dictionary-manager-create-profile", (payload) => {
    const name = payload && payload.name;
    runDictionaryManagerAction("Creating profile", () => {
      const profile = createDictionaryProfile(
        name || "",
        payload && payload.sourceProfileId,
      );
      setActiveDictionaryProfile(profile.id);
      return Promise.resolve();
    });
  });
  onMessage("dictionary-manager-rename-profile", (payload) => {
    try {
      renameDictionaryProfile(
        payload && payload.profileId,
        payload && payload.name,
      );
      postDictionaryManagerStatus("Profile renamed.", "info", false);
    } catch (error) {
      const msg = "Renaming profile failed: " + compactError(error);
      debugError(msg);
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
    }
  });
  onMessage("dictionary-manager-delete-profile", (payload) => {
    runDictionaryManagerAction("Deleting profile", () => {
      deleteDictionaryProfile(payload && payload.profileId);
      return Promise.resolve();
    });
  });
  onMessage("dictionary-manager-update-profile-preferences", (payload) => {
    try {
      const beforePrefs = normalizeProfilePreferences(
        activeDictionaryProfile(readManifest()).preferences,
      );
      updateDictionaryProfilePreferences(
        payload && payload.profileId,
        payload && payload.preferences,
      );
      postDictionaryManagerStatus("Profile settings saved.", "info", false);
      const nextPrefs = normalizeProfilePreferences(
        (payload && payload.preferences) || {},
      );
      if (
        typeof refreshDictionaryManagerAnkiState === "function" &&
        (beforePrefs.ankiConnectUrl !== nextPrefs.ankiConnectUrl ||
          beforePrefs.ankiConnectTimeoutSeconds !==
            nextPrefs.ankiConnectTimeoutSeconds ||
          beforePrefs.ankiModelName !== nextPrefs.ankiModelName)
      ) {
        refreshDictionaryManagerAnkiState(payload && payload.preferences);
      }
    } catch (error) {
      const msg = "Saving profile settings failed: " + compactError(error);
      debugError(msg);
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
    }
  });
  onMessage("dictionary-manager-update-global-settings", (payload) => {
    try {
      updateGlobalSettings(payload && payload.settings);
      postDictionaryManagerStatus(
        "Dictionary import settings saved.",
        "info",
        false,
      );
    } catch (error) {
      const msg =
        "Saving dictionary import settings failed: " + compactError(error);
      debugError(msg);
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
    }
  });
}
function openDictionaryManager() {
  if (!dictionaryManagerAvailable()) {
    alert(
      "This IINA build does not expose standalone windows. Use the Dictionaries menu for import actions.",
    );
    return;
  }
  try {
    standaloneWindow.loadFile("dictionary-manager.html");
    registerDictionaryManagerHandlers();
    try {
      if (typeof standaloneWindow.setProperty === "function")
        standaloneWindow.setProperty({
          title: "iinatan Settings",
          resizable: true,
        });
    } catch (_) {}
    if (typeof standaloneWindow.open === "function") standaloneWindow.open();
    else if (typeof standaloneWindow.show === "function")
      standaloneWindow.show();
    setTimeout(() => postDictionaryManagerState(), 120);
  } catch (error) {
    const msg = "Could not open iinatan Settings: " + compactError(error);
    debugError(msg);
    alert(msg);
  }
}
