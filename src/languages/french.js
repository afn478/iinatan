const IINATAN_FRENCH_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;
  const deinflect = IINATAN_DEINFLECTION;
  const YOMITAN_RULES = typeof IINATAN_FRENCH_YOMITAN_SUFFIX_RULES !== "undefined" ? IINATAN_FRENCH_YOMITAN_SUFFIX_RULES : [];
  const ELIDED_PREFIXES = {
    c: true,
    d: true,
    j: true,
    l: true,
    m: true,
    n: true,
    qu: true,
    s: true,
    t: true
  };

  function yomitanFrenchRules() {
    const rules = [];
    for (let i = 0; i < YOMITAN_RULES.length; i++) {
      const rule = YOMITAN_RULES[i];
      if (!rule || rule.length < 4) continue;
      rules.push(deinflect.suffixInflection(rule[0], rule[1], rule[2], rule[3], "Yomitan " + (rule[4] || "French transform")));
    }
    return rules;
  }

  const transformer = deinflect.createTransformer({
    maxDepth: 3,
    maxResults: 128,
    conditions: [
      { name: "v", isDefault: true },
      { name: "n", isDefault: true },
      { name: "adj", isDefault: true },
      { name: "adv", isDefault: true },
      { name: "aux", isDefault: true }
    ],
    rules: yomitanFrenchRules().concat([
      deinflect.wholeWordInflection("compris", "comprendre", "v", "v", "irregular past participle"),
      deinflect.suffixInflection("ées", "er", "v", "v", "past participle -ées"),
      deinflect.suffixInflection("ée", "er", "v", "v", "past participle -ée"),
      deinflect.suffixInflection("és", "er", "v", "v", "past participle -és"),
      deinflect.suffixInflection("é", "er", "v", "v", "past participle -é"),
      deinflect.suffixInflection("ies", "ir", "v", "v", "past participle -ies"),
      deinflect.suffixInflection("ie", "ir", "v", "v", "past participle -ie"),
      deinflect.suffixInflection("çons", "cer", "v", "v", "present -çons"),
      deinflect.suffixInflection("geons", "ger", "v", "v", "present -geons"),
      deinflect.suffixInflection("amment", "ant", "adv", "adj", "adverb -amment"),
      deinflect.suffixInflection("emment", "ent", "adv", "adj", "adverb -emment"),
      deinflect.suffixInflection("ment", "", "adv", "adj", "adverb -ment")
    ])
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
    return /\bfrench\b/.test(primary) ||
      /\bfrancais\b/.test(primary) ||
      /\bfrançais\b/.test(primary) ||
      /(^|[^a-z])fr[-_/]/.test(primary) ||
      /(^|[^a-z])fra[-_/]/.test(primary) ||
      /(^|[^a-z])fre[-_/]/.test(primary);
  }

  function addBaseCandidate(list, seen, text, displayText, range, source, reason) {
    const candidateText = common.trimLookupPunctuation(text);
    if (!candidateText) return;
    common.pushUniqueCandidate(list, seen, {
      text: candidateText,
      normalizedText: candidateText,
      source,
      reason,
      language: "fr",
      displayText,
      range
    });
  }

  function addElisionTails(list, seen, text, displayText, range) {
    const normalized = common.normalizeApostrophes(text);
    const match = /^([a-zà-öø-ÿ]+)'(.+)$/i.exec(normalized);
    if (!match) return;
    const prefix = match[1].toLowerCase();
    if (!ELIDED_PREFIXES[prefix]) return;
    addBaseCandidate(list, seen, match[2], displayText, range, "french-elision", "elided prefix " + prefix + "'");
  }

  function generateCandidates(displayText, range) {
    const normalized = common.normalizeBasic(displayText);
    const trimmed = common.trimLookupPunctuation(normalized);
    const lowerOriginal = trimmed.toLowerCase();
    const lowerApostrophe = common.normalizeApostrophes(lowerOriginal);
    const list = [];
    const seen = Object.create(null);
    const candidateRange = range || null;

    addBaseCandidate(list, seen, lowerOriginal, displayText, candidateRange, "surface", "lowercase surface");
    addBaseCandidate(list, seen, lowerApostrophe, displayText, candidateRange, "apostrophe-normalized", "apostrophe variants");
    addElisionTails(list, seen, lowerOriginal, displayText, candidateRange);
    addElisionTails(list, seen, lowerApostrophe, displayText, candidateRange);

    const baseCount = list.length;
    for (let i = 0; i < baseCount; i++) {
      deinflect.appendTransforms(list, seen, list[i], transformer, "fr", 36);
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
    if (!candidates.length) return null;
    return {
      lookupText: candidates[0].text,
      displayText,
      suffix: chars.slice(pos).join(""),
      lookupStart: run.start,
      lookupEnd: run.end,
      matchStart: run.start,
      backendMode: "exact",
      scanLength: common.chars(candidates[0].text).length,
      cacheStrategy: "word-candidates",
      cacheKey: "word:" + run.start + ":" + run.end + ":" + candidates.map(c => c.text).join("|"),
      candidates
    };
  }

  return {
    id: "fr",
    label: "French (experimental)",
    experimental: true,
    lookupUnit: "word",
    wordMode: "latin-word",
    lookupMode: "exact",
    deinflection: "yomitan-style-french",
    deinflectionMode: "yomitan-style-french",
    dictionaryCompatibility: "Yomitan-compatible French-headword term dictionaries; apostrophe/elision-aware exact lookup.",
    upstreamRuleCount: YOMITAN_RULES.length,
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    generateCandidates,
    lookupRequest
  };
})();
