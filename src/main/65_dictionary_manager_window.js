function dictionaryManagerAvailable() {
  return !!(standaloneWindow && typeof standaloneWindow.loadFile === "function");
}
function postToDictionaryManager(name, data) {
  try {
    if (!standaloneWindow || typeof standaloneWindow.postMessage !== "function") return;
    standaloneWindow.postMessage(name, data || {});
  } catch (error) {
    debugWarn("dictionary manager postMessage failed name=" + String(name || "") + ": " + compactError(error));
  }
}
function dictionaryManagerState() {
  const manifest = readManifest();
  const disabled = disabledDictionaryMap(manifest);
  const dicts = dictionaryDirs();
  const activeProfile = activeDictionaryProfile(manifest);
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
      order: index
    })),
    activeProfileId: manifest.activeProfileId || DEFAULT_PROFILE_ID,
    activeProfileName: activeProfile.name || "Default",
    profiles: profileSummaries(manifest),
    profilePreferenceKeys: PROFILE_PREFERENCE_KEYS.slice(),
    lookupLanguage: pref("lookupLanguage", "ja")
  };
}
function postDictionaryManagerState() {
  try { postToDictionaryManager("dictionary-manager-state", dictionaryManagerState()); }
  catch (error) { debugWarn("could not build dictionary manager state: " + compactError(error)); }
}
function postDictionaryManagerStatus(message, kind, busy) {
  postToDictionaryManager("dictionary-manager-status", {
    message: String(message || ""),
    kind: kind || "info",
    busy: !!busy,
    updatedAt: Date.now()
  });
}
function runDictionaryManagerAction(label, action) {
  (async () => {
    const actionLabel = label || "Working";
    if (dictionaryManagerActionInFlight) {
      postDictionaryManagerStatus("Another dictionary action is already running.", "info", true);
      return;
    }
    dictionaryManagerActionInFlight = true;
    postDictionaryManagerStatus(actionLabel + "...", "info", true);
    try {
      const result = await action();
      postDictionaryManagerState();
      if (result && result.cancelled) {
        postDictionaryManagerStatus(result.message || actionLabel + " cancelled.", "info", false);
        return;
      }
      postDictionaryManagerStatus(actionLabel + " complete.", "info", false);
    } catch (error) {
      const msg = actionLabel + " failed: " + compactError(error);
      debugError("dictionary manager action failed label=" + actionLabel + " error=" + compactError(error));
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
      postDictionaryManagerStatus("Another dictionary action is already running.", "info", true);
      return;
    }
    postDictionaryManagerStatus("Opening ZIP picker...", "info", false);
    let zipPaths = [];
    try {
      zipPaths = await chooseDictionaryZipPaths();
    } catch (error) {
      const msg = "Could not open dictionary ZIP picker: " + compactError(error);
      debugError("dictionary manager file picker failed: " + compactError(error));
      postDictionaryManagerState();
      postDictionaryManagerStatus(msg, "error", false);
      alert(msg);
      return;
    }
    if (!zipPaths.length) {
      notify("Dictionary import cancelled.", "info", 3500);
      postDictionaryManagerState();
      postDictionaryManagerStatus("Dictionary import cancelled.", "info", false);
      return;
    }

    const countLabel = zipPaths.length === 1 ? "dictionary" : String(zipPaths.length) + " dictionaries";
    dictionaryManagerActionInFlight = true;
    postDictionaryManagerStatus("Importing " + countLabel + "...", "info", true);
    try {
      await validateAndImportDictionaryZips(zipPaths, "dictionary-manager-picker");
      postDictionaryManagerState();
      postDictionaryManagerStatus("Imported " + countLabel + ".", "info", false);
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
  if (dictionaryManagerInitialized || !standaloneWindow || typeof standaloneWindow.onMessage !== "function") return;
  dictionaryManagerInitialized = true;
  standaloneWindow.onMessage("dictionary-manager-ready", () => {
    postDictionaryManagerState();
    postDictionaryManagerStatus("", "info", false);
  });
  standaloneWindow.onMessage("dictionary-manager-refresh", () => {
    postDictionaryManagerState();
    postDictionaryManagerStatus("Dictionary list refreshed.", "info", false);
  });
  standaloneWindow.onMessage("dictionary-manager-set-enabled", payload => {
    const name = payload && payload.name;
    if (!name) return;
    setDictionaryEnabled(String(name), !!(payload && payload.enabled));
    postDictionaryManagerStatus("Dictionary selection saved.", "info", false);
  });
  standaloneWindow.onMessage("dictionary-manager-set-order", payload => {
    const order = payload && Array.isArray(payload.order) ? payload.order : [];
    setDictionaryOrder(order);
    postDictionaryManagerStatus("Dictionary order saved.", "info", false);
  });
  standaloneWindow.onMessage("dictionary-manager-download-recommended", () => {
    runDictionaryManagerAction("Downloading recommended dictionaries", () => getRecommendedDictionaries());
  });
  standaloneWindow.onMessage("dictionary-manager-import-zip", () => {
    runDictionaryManagerZipImport();
  });
  standaloneWindow.onMessage("dictionary-manager-switch-profile", payload => {
    const profileId = payload && payload.profileId;
    if (!profileId) return;
    runDictionaryManagerAction("Switching profile", () => {
      setActiveDictionaryProfile(profileId);
      return Promise.resolve();
    });
  });
  standaloneWindow.onMessage("dictionary-manager-create-profile", payload => {
    const name = payload && payload.name;
    runDictionaryManagerAction("Creating profile", () => {
      createDictionaryProfile(name || "Profile", payload && payload.sourceProfileId);
      return Promise.resolve();
    });
  });
  standaloneWindow.onMessage("dictionary-manager-update-profile-preferences", payload => {
    runDictionaryManagerAction("Saving profile preferences", () => {
      updateDictionaryProfilePreferences(payload && payload.profileId, payload && payload.preferences);
      return Promise.resolve();
    });
  });
}
function openDictionaryManager() {
  if (!dictionaryManagerAvailable()) {
    alert("This IINA build does not expose standalone windows. Use the Dictionaries menu for import actions.");
    return;
  }
  try {
    standaloneWindow.loadFile("dictionary-manager.html");
    registerDictionaryManagerHandlers();
    try {
      if (typeof standaloneWindow.setProperty === "function") standaloneWindow.setProperty({ title: "iinatan Dictionary Manager", resizable: true });
    } catch (_) {}
    if (typeof standaloneWindow.open === "function") standaloneWindow.open();
    else if (typeof standaloneWindow.show === "function") standaloneWindow.show();
    setTimeout(() => postDictionaryManagerState(), 120);
  } catch (error) {
    const msg = "Could not open Dictionary Manager: " + compactError(error);
    debugError(msg);
    alert(msg);
  }
}
