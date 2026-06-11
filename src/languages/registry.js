const IINATAN_LANGUAGE_REGISTRY = (() => {
  const languages = [
    IINATAN_JAPANESE_LANGUAGE,
    IINATAN_ENGLISH_LANGUAGE,
    IINATAN_KOREAN_LANGUAGE
  ];
  const byId = Object.create(null);
  languages.forEach(language => { byId[language.id] = language; });

  function get(id) {
    return byId[String(id || "ja")] || byId.ja;
  }

  function selected() {
    return get(pref("lookupLanguage", "ja"));
  }

  function overlayConfig(language) {
    const selectedLanguage = language || selected();
    return {
      id: selectedLanguage.id,
      label: selectedLanguage.label,
      experimental: !!selectedLanguage.experimental,
      lookupUnit: selectedLanguage.lookupUnit || "character",
      wordMode: selectedLanguage.wordMode,
      lookupMode: selectedLanguage.lookupMode || selectedLanguage.backendMode || "yomitan-japanese",
      deinflection: selectedLanguage.deinflection,
      deinflectionMode: selectedLanguage.deinflectionMode || selectedLanguage.deinflection,
      dictionaryCompatibility: selectedLanguage.dictionaryCompatibility
    };
  }

  return {
    all: languages.slice(),
    get,
    selected,
    overlayConfig
  };
})();

function languageModuleById(id) {
  return IINATAN_LANGUAGE_REGISTRY.get(id);
}

function selectedLanguageModule() {
  return IINATAN_LANGUAGE_REGISTRY.selected();
}

function selectedLanguageOverlayConfig() {
  return IINATAN_LANGUAGE_REGISTRY.overlayConfig(selectedLanguageModule());
}
