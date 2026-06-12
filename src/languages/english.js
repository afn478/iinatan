const IINATAN_ENGLISH_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;
  const deinflect = IINATAN_DEINFLECTION;
  const YOMITAN_SUFFIX_RULES = typeof IINATAN_ENGLISH_YOMITAN_SUFFIX_RULES !== "undefined" ? IINATAN_ENGLISH_YOMITAN_SUFFIX_RULES : [];
  const YOMITAN_PREFIX_RULES = typeof IINATAN_ENGLISH_YOMITAN_PREFIX_RULES !== "undefined" ? IINATAN_ENGLISH_YOMITAN_PREFIX_RULES : [];
  const YOMITAN_DOUBLED_SUFFIX_RULES = typeof IINATAN_ENGLISH_YOMITAN_DOUBLED_SUFFIX_RULES !== "undefined" ? IINATAN_ENGLISH_YOMITAN_DOUBLED_SUFFIX_RULES : [];

  function yomitanEnglishRules() {
    const rules = [];
    YOMITAN_SUFFIX_RULES.forEach(rule => {
      if (!rule || rule.length < 5) return;
      rules.push(deinflect.suffixInflection(rule[0], rule[1], rule[2], rule[3], "Yomitan " + rule[4]));
    });
    YOMITAN_PREFIX_RULES.forEach(rule => {
      if (!rule || rule.length < 5) return;
      rules.push(deinflect.prefixInflection(rule[0], rule[1], rule[2], rule[3], "Yomitan " + rule[4]));
    });
    YOMITAN_DOUBLED_SUFFIX_RULES.forEach(rule => {
      if (!rule || rule.length < 5) return;
      const consonants = String(rule[0] || "");
      const suffix = String(rule[1] || "");
      for (let i = 0; i < consonants.length; i++) {
        const consonant = consonants[i];
        rules.push(deinflect.suffixInflection(consonant + consonant + suffix, consonant, rule[2], rule[3], "Yomitan " + rule[4]));
      }
    });
    return rules;
  }

  const transformer = deinflect.createTransformer({
    maxDepth: 3,
    maxResults: 128,
    conditions: [
      { name: "v", isDefault: true },
      { name: "v_phr", isDefault: true },
      { name: "n", isDefault: true },
      { name: "np", isDefault: true },
      { name: "ns", isDefault: true },
      { name: "adj", isDefault: true },
      { name: "adv", isDefault: true }
    ],
    rules: yomitanEnglishRules()
  });

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

  function addCandidate(list, seen, text, displayText, range, source, reason) {
    const candidateText = common.trimLookupPunctuation(text);
    if (!candidateText) return;
    common.pushUniqueCandidate(list, seen, {
      text: candidateText,
      normalizedText: candidateText,
      source,
      reason,
      language: "en",
      displayText,
      range
    });
  }

  function generateCandidates(displayText, range) {
    const lookupText = common.normalizeLatinLookup(displayText);
    const list = [];
    const seen = Object.create(null);
    const candidateRange = range || null;
    addCandidate(list, seen, lookupText, displayText, candidateRange, "surface", "surface form");
    const baseCount = list.length;
    for (let i = 0; i < baseCount; i++) {
      deinflect.appendTransforms(list, seen, list[i], transformer, "en", 48);
    }
    return list;
  }

  function lookupRequest(text, position) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    const run = common.findRun(chars, pos, isHoverableChar);
    if (!run) return null;
    const displayText = common.slice(chars, run.start, run.end);
    const candidates = generateCandidates(displayText, { start: run.start, end: run.end });
    const lookupText = candidates.length ? candidates[0].text : "";
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
      cacheStrategy: "word-candidates",
      cacheKey: "word:" + run.start + ":" + run.end + ":" + candidates.map(c => c.text).join("|"),
      candidates
    };
  }

  return {
    id: "en",
    label: "English (experimental)",
    experimental: true,
    lookupUnit: "word",
    wordMode: "latin-word",
    lookupMode: "exact",
    deinflection: "yomitan-style-english",
    deinflectionMode: "yomitan-style-english",
    dictionaryCompatibility: "Yomitan-compatible term dictionaries; exact whole-word lookup with English deinflection candidates.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    generateCandidates,
    lookupRequest
  };
})();
