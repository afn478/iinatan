const IINATAN_JAPANESE_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;

  function isHoverableChar(ch) {
    return common.JAPANESE_CHAR_RE.test(String(ch || ""));
  }

  function hasLookupText(text) {
    return common.JAPANESE_CHAR_RE.test(String(text || ""));
  }

  function lookupRequest(text, position, scanLength) {
    const chars = common.chars(text);
    const pos = common.clampPosition(position, chars.length);
    const suffix = chars.slice(pos).join("");
    if (!suffix || !isHoverableChar(chars[pos])) return null;
    const length = Math.min(chars.length - pos, Math.max(1, Number(scanLength) || 24));
    const lookupText = common.slice(chars, pos, pos + length);
    return {
      lookupText,
      displayText: lookupText,
      suffix,
      lookupStart: pos,
      lookupEnd: pos + length,
      matchStart: pos,
      backendMode: "yomitan-japanese",
      scanLength: length,
      cacheStrategy: "exact-position"
    };
  }

  return {
    id: "ja",
    label: "Japanese",
    experimental: false,
    wordMode: "rightward-prefix",
    deinflection: "hoshidicts-japanese",
    dictionaryCompatibility: "Yomitan-compatible Japanese dictionaries via HoshiDicts/Jitendex.",
    isHoverableChar,
    hasLookupText,
    normalizeText: text => String(text || ""),
    lookupRequest
  };
})();
