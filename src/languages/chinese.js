const IINATAN_CHINESE_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;

  function isHoverableChar(ch) {
    return common.CHINESE_CHAR_RE.test(String(ch || ""));
  }

  function hasLookupText(text) {
    return common.CHINESE_CHAR_RE.test(String(text || ""));
  }

  function dictionaryMatches(dict) {
    const primary = common.dictionaryIdentity(dict);
    if (!primary) return false;
    if (primary.indexOf("jitendex") >= 0) return false;
    return /\b(chinese|mandarin|cantonese|hanzi|hanyu|zhongwen)\b/.test(primary) ||
      /\b(cc-?cedict|cedict|cedict_ts|moedict)\b/.test(primary) ||
      /(^|[^a-z])(zh|zho|chi|cmn|yue|wuu|hak|nan)[-_/]/.test(primary) ||
      /[-_/](zh|zho|chi|cmn|yue|wuu|hak|nan)([^a-z]|$)/.test(primary);
  }

  function lookupRequest(text, position, scanLength) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    if (!chars.length || pos >= chars.length || !isHoverableChar(chars[pos])) return null;
    const maxChars = Math.max(1, Math.min(Number(scanLength) || 24, chars.length - pos));
    const lookupText = chars.slice(pos, pos + maxChars).join("");
    if (!lookupText) return null;
    return {
      lookupText,
      displayText: chars[pos],
      suffix: chars.slice(pos).join(""),
      lookupStart: pos,
      lookupEnd: Math.min(chars.length, pos + maxChars),
      matchStart: pos,
      backendMode: "prefix",
      scanLength: maxChars,
      cacheStrategy: "exact-position",
      cacheKey: "zh:" + pos + ":" + lookupText
    };
  }

  return {
    id: "zh",
    label: "Chinese (experimental)",
    experimental: true,
    lookupUnit: "character",
    wordMode: "rightward-prefix",
    lookupMode: "prefix",
    deinflection: "none",
    deinflectionMode: "none",
    dictionaryCompatibility: "Yomitan-compatible Chinese-headword term dictionaries; longest rightward-prefix lookup without Japanese deinflection.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    lookupRequest
  };
})();
