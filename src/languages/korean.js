const IINATAN_KOREAN_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;

  function isHoverableChar(ch) {
    return common.KOREAN_CHAR_RE.test(String(ch || ""));
  }

  function hasLookupText(text) {
    return common.KOREAN_CHAR_RE.test(String(text || ""));
  }

  function dictionaryMatches(dict) {
    const primary = [
      dict && dict.name,
      dict && dict.title,
      dict && dict.path
    ].join(" ").toLowerCase();
    if (!primary) return false;
    if (primary.indexOf("jitendex") >= 0) return false;
    return /\bkorean\b/.test(primary) ||
      /(^|[^a-z])ko[-_/]/.test(primary) ||
      /(^|[^a-z])kor[-_/]/.test(primary);
  }

  function lookupRequest(text, position) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    const run = common.findRun(chars, pos, isHoverableChar);
    if (!run) return null;
    const lookupText = common.slice(chars, run.start, run.end);
    return {
      lookupText,
      displayText: lookupText,
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
    id: "ko",
    label: "Korean (experimental)",
    experimental: true,
    lookupUnit: "word",
    wordMode: "korean-run",
    lookupMode: "exact",
    deinflection: "none",
    deinflectionMode: "none",
    dictionaryCompatibility: "Yomitan-compatible term dictionaries; exact contiguous-Hangul lookup only.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    lookupRequest
  };
})();
