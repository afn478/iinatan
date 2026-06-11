const IINATAN_ENGLISH_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;

  function isHoverableChar(ch) {
    return common.LATIN_WORD_CHAR_RE.test(String(ch || ""));
  }

  function hasLookupText(text) {
    return common.LATIN_WORD_CHAR_RE.test(String(text || ""));
  }

  function dictionaryMatches(dict) {
    const primary = [
      dict && dict.name,
      dict && dict.title,
      dict && dict.path
    ].join(" ").toLowerCase();
    if (!primary) return false;
    if (primary.indexOf("jitendex") >= 0) return false;
    return /\benglish\b/.test(primary) ||
      /(^|[^a-z])en[-_/]/.test(primary) ||
      /(^|[^a-z])eng[-_/]/.test(primary);
  }

  function lookupRequest(text, position) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    const run = common.findRun(chars, pos, isHoverableChar);
    if (!run) return null;
    const displayText = common.slice(chars, run.start, run.end);
    const lookupText = common.normalizeLatinLookup(displayText);
    if (!lookupText) return null;
    return {
      lookupText,
      displayText,
      suffix: chars.slice(pos).join(""),
      lookupStart: run.start,
      lookupEnd: run.end,
      matchStart: run.start,
      backendMode: "exact",
      scanLength: common.chars(lookupText).length,
      cacheStrategy: "word-span",
      cacheKey: "word:" + run.start + ":" + run.end + ":" + lookupText
    };
  }

  return {
    id: "en",
    label: "English (experimental)",
    experimental: true,
    lookupUnit: "word",
    wordMode: "latin-word",
    lookupMode: "exact",
    deinflection: "none",
    deinflectionMode: "none",
    dictionaryCompatibility: "Yomitan-compatible term dictionaries; exact whole-word lookup only.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    lookupRequest
  };
})();
