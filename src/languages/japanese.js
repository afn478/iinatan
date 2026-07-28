const IINATAN_JAPANESE_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;
  const KANA_ONLY_FULLWIDTH_PARENS_RE =
    /（([\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f\s]+)）/g;
  const KANA_RE =
    /[\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fd-\u30ff\u31f0-\u31ff\uff66-\uff9f]/;
  const lookupCharacterPolicy =
    IINATAN_LOOKUP_CHARACTER_POLICY.policies.japanese;

  function stripParenthesizedFurigana(text) {
    return String(text || "").replace(
      KANA_ONLY_FULLWIDTH_PARENS_RE,
      (match, reading) => (KANA_RE.test(reading) ? "" : match),
    );
  }

  function isHoverableChar(ch) {
    return IINATAN_LOOKUP_CHARACTER_POLICY.matches(lookupCharacterPolicy, ch);
  }

  function hasLookupText(text) {
    return common.JAPANESE_CHAR_RE.test(String(text || ""));
  }

  function lookupRequest(text, position, scanLength) {
    const chars = common.chars(text);
    const pos = common.clampPosition(position, chars.length);
    const suffix = chars.slice(pos).join("");
    if (!suffix || !isHoverableChar(chars[pos])) return null;
    const length = Math.min(
      chars.length - pos,
      Math.max(1, Number(scanLength) || 24),
    );
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
      cacheStrategy: "exact-position",
      cacheKey: "char:" + pos + ":" + lookupText,
    };
  }

  return {
    id: "ja",
    label: "Japanese",
    experimental: false,
    lookupUnit: "character",
    wordMode: "rightward-prefix",
    lookupMode: "yomitan-japanese",
    deinflection: "hoshidicts-japanese",
    deinflectionMode: "hoshidicts-japanese",
    dictionaryCompatibility:
      "Yomitan-compatible Japanese dictionaries via HoshiDicts/Jitendex.",
    lookupCharacterPolicy,
    isHoverableChar,
    hasLookupText,
    dictionaryMatches: () => true,
    normalizeSubtitleText: stripParenthesizedFurigana,
    normalizeText: stripParenthesizedFurigana,
    lookupRequest,
  };
})();
