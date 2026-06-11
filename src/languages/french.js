const IINATAN_FRENCH_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;
  const deinflect = IINATAN_DEINFLECTION;
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

  const transformer = deinflect.createTransformer({
    maxDepth: 3,
    maxResults: 72,
    conditions: [
      { name: "v", isDefault: true },
      { name: "n", isDefault: true },
      { name: "adj", isDefault: true },
      { name: "adv", isDefault: true },
      { name: "aux", isDefault: true }
    ],
    rules: [
      deinflect.wholeWordInflection("suis", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("es", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("est", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("sommes", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("êtes", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("sont", "être", "aux", "v", "être"),
      deinflect.wholeWordInflection("ai", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("as", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("a", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("avons", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("avez", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("ont", "avoir", "aux", "v", "avoir"),
      deinflect.wholeWordInflection("compris", "comprendre", "v", "v", "irregular past participle"),
      deinflect.suffixInflection("ées", "er", "v", "v", "past participle -ées"),
      deinflect.suffixInflection("ée", "er", "v", "v", "past participle -ée"),
      deinflect.suffixInflection("és", "er", "v", "v", "past participle -és"),
      deinflect.suffixInflection("é", "er", "v", "v", "past participle -é"),
      deinflect.suffixInflection("çons", "cer", "v", "v", "present -çons"),
      deinflect.suffixInflection("geons", "ger", "v", "v", "present -geons"),
      deinflect.suffixInflection("e", "er", "v", "v", "present -e"),
      deinflect.suffixInflection("es", "er", "v", "v", "present -es"),
      deinflect.suffixInflection("ons", "er", "v", "v", "present -ons"),
      deinflect.suffixInflection("ez", "er", "v", "v", "present -ez"),
      deinflect.suffixInflection("ent", "er", "v", "v", "present -ent"),
      deinflect.suffixInflection("is", "ir", "v", "v", "present -is"),
      deinflect.suffixInflection("it", "ir", "v", "v", "present -it"),
      deinflect.suffixInflection("issons", "ir", "v", "v", "present -issons"),
      deinflect.suffixInflection("issez", "ir", "v", "v", "present -issez"),
      deinflect.suffixInflection("issent", "ir", "v", "v", "present -issent"),
      deinflect.suffixInflection("amment", "ant", "adv", "adj", "adverb -amment"),
      deinflect.suffixInflection("emment", "ent", "adv", "adj", "adverb -emment"),
      deinflect.suffixInflection("ment", "", "adv", "adj", "adverb -ment")
    ]
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
      deinflect.appendTransforms(list, seen, list[i], transformer, "fr", 18);
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
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    generateCandidates,
    lookupRequest
  };
})();
