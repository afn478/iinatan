const IINATAN_GERMAN_LANGUAGE = (() => {
  const common = IINATAN_LANGUAGE_COMMON;
  const deinflect = IINATAN_DEINFLECTION;
  const MAX_RIGHT_CONTEXT_CHARS = 96;
  const MAX_RIGHT_CONTEXT_WORDS = 12;
  const GERMAN_WORD_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ]+$/;
  const GERMAN_TOKEN_RE = /[A-Za-zÀ-ÖØ-öø-ÿ]+/g;
  const ABBREVIATIONS = [
    "bzw.", "bspw.", "ca.", "d.h.", "dr.", "etc.", "evtl.", "ggf.", "inkl.",
    "i.d.r.", "m.e.", "nr.", "prof.", "s.", "sog.", "u.a.", "u.u.", "usw.",
    "v.a.", "vgl.", "z.b.", "z.t.", "zzgl."
  ];
  const SEPARABLE_PREFIXES = [
    "ab", "an", "auf", "aus", "bei", "dar", "ein", "empor", "entgegen", "entlang",
    "fehl", "fern", "fest", "fort", "frei", "gegenüber", "gleich", "heim", "her",
    "herab", "heran", "herauf", "heraus", "herbei", "herein", "herüber", "herum",
    "herunter", "hervor", "hin", "hinab", "hinauf", "hinaus", "hinein", "hinüber",
    "hinunter", "hinweg", "hinzu", "hoch", "los", "mit", "nach", "nieder",
    "statt", "teil", "um", "vor", "voran", "voraus", "vorbei", "vorüber", "weg",
    "weiter", "wieder", "zu", "zurück", "zusammen"
  ];
  const PREFIX_SET = SEPARABLE_PREFIXES.reduce((out, prefix) => {
    out[prefix] = true;
    return out;
  }, Object.create(null));
  const IRREGULAR_FINITE_VERBS = {
    bin: ["sein"],
    bist: ["sein"],
    ist: ["sein"],
    sind: ["sein"],
    seid: ["sein"],
    war: ["sein"],
    waren: ["sein"],
    habe: ["haben"],
    hast: ["haben"],
    hat: ["haben"],
    haben: ["haben"],
    habt: ["haben"],
    hatte: ["haben"],
    hatten: ["haben"],
    kann: ["können"],
    kannst: ["können"],
    können: ["können"],
    könnt: ["können"],
    muss: ["müssen"],
    musst: ["müssen"],
    müssen: ["müssen"],
    müsst: ["müssen"],
    will: ["wollen"],
    willst: ["wollen"],
    wollen: ["wollen"],
    wollt: ["wollen"],
    darf: ["dürfen"],
    darfst: ["dürfen"],
    dürfen: ["dürfen"],
    dürft: ["dürfen"],
    soll: ["sollen"],
    sollst: ["sollen"],
    sollen: ["sollen"],
    sollt: ["sollen"],
    mag: ["mögen"],
    magst: ["mögen"],
    mögen: ["mögen"],
    mögt: ["mögen"],
    geht: ["gehen"],
    gehe: ["gehen"],
    gehst: ["gehen"],
    gibst: ["geben"],
    gibt: ["geben"],
    hilft: ["helfen"],
    helfe: ["helfen"],
    hilfst: ["helfen"],
    lese: ["lesen"],
    liest: ["lesen"],
    nimmt: ["nehmen"],
    nimmst: ["nehmen"],
    sehe: ["sehen"],
    siehst: ["sehen"],
    sieht: ["sehen"],
    spreche: ["sprechen"],
    sprichst: ["sprechen"],
    spricht: ["sprechen"],
    stehe: ["stehen"],
    stehst: ["stehen"],
    steht: ["stehen"],
    tue: ["tun"],
    tust: ["tun"],
    tut: ["tun"],
    werde: ["werden"],
    wirst: ["werden"],
    wird: ["werden"]
  };

  const transformer = deinflect.createTransformer({
    maxDepth: 3,
    maxResults: 80,
    conditions: [
      { name: "v", isDefault: true },
      { name: "n", isDefault: true },
      { name: "adj", isDefault: true }
    ],
    rules: [
      deinflect.suffixInflection("ungen", "en", "n", "v", "nominalization -ungen"),
      deinflect.suffixInflection("ung", "en", "n", "v", "nominalization -ung"),
      deinflect.suffixInflection("bar", "en", "adj", "v", "adjective -bar"),
      deinflect.prefixInflection("un", "", "adj", "adj", "negative un-"),
      deinflect.customInflection(getBasicPastParticiples, "v", "v", "past participle"),
      deinflect.customInflection(getSeparablePastParticiples, "v", "v", "separable past participle"),
      deinflect.customInflection(getZuInfinitives, "v", "v", "zu-infinitive"),
      deinflect.suffixInflection("heit", "", "n", "adj", "nominalization -heit"),
      deinflect.suffixInflection("keit", "", "n", "adj", "nominalization -keit")
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
    return /\bgerman\b/.test(primary) ||
      /\bdeutsch\b/.test(primary) ||
      /(^|[^a-z])de[-_/]/.test(primary) ||
      /(^|[^a-z])deu[-_/]/.test(primary) ||
      /(^|[^a-z])ger[-_/]/.test(primary);
  }

  function getBasicPastParticiples(text) {
    const match = /^ge([a-zà-öø-ÿ]+)t$/i.exec(text);
    if (!match) return [];
    return [match[1] + "en", match[1] + "n"];
  }

  function getSeparablePastParticiples(text) {
    const prefix = SEPARABLE_PREFIXES.join("|");
    const match = new RegExp("^(" + prefix + ")ge([a-zà-öø-ÿ]+)t$", "i").exec(text);
    if (!match) return [];
    return [match[1] + match[2] + "en", match[1] + match[2] + "n"];
  }

  function getZuInfinitives(text) {
    const prefix = SEPARABLE_PREFIXES.join("|");
    const match = new RegExp("^(" + prefix + ")zu([a-zà-öø-ÿ]+)$", "i").exec(text);
    return match ? [match[1] + match[2]] : [];
  }

  function addCandidate(list, seen, text, displayText, range, source, reason) {
    const candidateText = common.trimLookupPunctuation(text);
    if (!candidateText) return;
    common.pushUniqueCandidate(list, seen, {
      text: candidateText,
      normalizedText: candidateText,
      source,
      reason,
      language: "de",
      displayText,
      range
    });
  }

  function addEszettVariants(list, seen, text, displayText, range) {
    const ss = String(text || "").replace(/ẞ/g, "SS").replace(/ß/g, "ss");
    const eszett = String(text || "").replace(/SS/g, "ẞ").replace(/ss/g, "ß");
    addCandidate(list, seen, ss, displayText, range, "eszett", "eszett to ss");
    addCandidate(list, seen, eszett, displayText, range, "eszett", "ss to eszett");
  }

  function finiteVerbInfinitives(word) {
    const lower = String(word || "").toLowerCase();
    const out = [];
    const seen = Object.create(null);
    function push(value) {
      if (!value || seen[value]) return;
      seen[value] = true;
      out.push(value);
    }
    (IRREGULAR_FINITE_VERBS[lower] || []).forEach(push);
    if (lower.endsWith("elst")) push(lower.slice(0, -4) + "eln");
    if (lower.endsWith("elt")) push(lower.slice(0, -3) + "eln");
    if (lower.endsWith("erst")) push(lower.slice(0, -4) + "ern");
    if (lower.endsWith("ert")) push(lower.slice(0, -3) + "ern");
    if (lower.endsWith("est")) push(lower.slice(0, -3) + "en");
    if (lower.endsWith("et")) push(lower.slice(0, -2) + "en");
    if (lower.endsWith("st")) push(lower.slice(0, -2) + "en");
    if (lower.endsWith("t")) push(lower.slice(0, -1) + "en");
    if (lower.endsWith("e")) push(lower.slice(0, -1) + "en");
    if (lower.endsWith("en")) push(lower);
    return out.filter(value => value.length > 3);
  }

  function abbreviationKey(text) {
    return String(text || "").toLowerCase().replace(/\s+/g, "");
  }

  function isAbbreviationPeriod(line, index) {
    const raw = String(line || "");
    const before = abbreviationKey(raw.slice(Math.max(0, index - 16), index + 1));
    if (ABBREVIATIONS.some(abbr => before.endsWith(abbr))) return true;
    const after = abbreviationKey(raw.slice(index + 1, Math.min(raw.length, index + 8)));
    if (/^[a-zà-öø-ÿ]\./.test(after)) return true;
    const recent = raw.slice(Math.max(0, index - 12), index + 1).toLowerCase();
    return /(?:^|[^a-zà-öø-ÿ])(?:[a-zà-öø-ÿ]{1,3}\.){2,}$/.test(recent.replace(/\s+/g, ""));
  }

  function rightContextWindow(text, start, end) {
    const chars = common.chars(text);
    const runEnd = common.clampPosition(end, chars.length);
    const maxEnd = Math.min(chars.length, runEnd + MAX_RIGHT_CONTEXT_CHARS);
    let stop = runEnd;
    for (; stop < maxEnd; stop++) {
      const ch = chars[stop];
      if ((ch === "!" || ch === "?" || ch === ";" || ch === ":") && stop > runEnd) break;
      if (ch === "." && stop > runEnd && !isAbbreviationPeriod(text, stop)) break;
    }
    let context = common.slice(chars, start, stop);
    const tokens = context.match(GERMAN_TOKEN_RE) || [];
    if (tokens.length > MAX_RIGHT_CONTEXT_WORDS) {
      const wanted = tokens.slice(0, MAX_RIGHT_CONTEXT_WORDS).join(" ");
      context = wanted;
    }
    return {
      text: context,
      end: start + common.chars(context).length,
      maxChars: MAX_RIGHT_CONTEXT_CHARS,
      maxWords: MAX_RIGHT_CONTEXT_WORDS
    };
  }

  function splitVerbCandidates(contextText) {
    const tokens = String(contextText || "").match(GERMAN_TOKEN_RE) || [];
    if (tokens.length < 2) return [];
    const finite = tokens[0];
    const prefix = tokens[tokens.length - 1].toLowerCase();
    if (!PREFIX_SET[prefix]) return [];
    return finiteVerbInfinitives(finite).map(infinitive => prefix + infinitive);
  }

  function generateCandidates(displayText, range, fullText) {
    const normalized = common.normalizeBasic(displayText);
    const trimmed = common.trimLookupPunctuation(normalized);
    const lower = trimmed.toLowerCase();
    const list = [];
    const seen = Object.create(null);
    const candidateRange = range || null;
    const rightContext = fullText && range ? rightContextWindow(fullText, range.start, range.end) : null;

    addCandidate(list, seen, trimmed, displayText, candidateRange, "surface", "surface form");
    addCandidate(list, seen, lower, displayText, candidateRange, "lowercase", "lowercase form");
    addEszettVariants(list, seen, trimmed, displayText, candidateRange);
    addEszettVariants(list, seen, lower, displayText, candidateRange);

    const baseCount = list.length;
    for (let i = 0; i < baseCount; i++) {
      deinflect.appendTransforms(list, seen, list[i], transformer, "de", 16);
    }

    if (rightContext && GERMAN_WORD_RE.test(trimmed)) {
      splitVerbCandidates(rightContext.text).forEach(candidate => {
        addCandidate(list, seen, candidate, displayText, candidateRange, "german-split-verb", "bounded right-context separable prefix");
      });
    }
    return { candidates: list, rightContext };
  }

  function lookupRequest(text, position) {
    const normalized = common.normalizeBasic(text);
    const chars = common.chars(normalized);
    const pos = common.clampPosition(position, chars.length);
    const run = common.findRun(chars, pos, isHoverableChar);
    if (!run) return null;
    const displayText = common.slice(chars, run.start, run.end);
    const generated = generateCandidates(displayText, { start: run.start, end: run.end }, normalized);
    const candidates = generated.candidates;
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
      candidates,
      rightContext: generated.rightContext
    };
  }

  return {
    id: "de",
    label: "German (experimental)",
    experimental: true,
    lookupUnit: "word",
    wordMode: "latin-word",
    lookupMode: "exact",
    deinflection: "yomitan-style-german",
    deinflectionMode: "yomitan-style-german",
    dictionaryCompatibility: "Yomitan-compatible German-headword term dictionaries; capitalization and separable-verb candidate lookup.",
    isHoverableChar,
    hasLookupText,
    dictionaryMatches,
    normalizeText: common.normalizeBasic,
    generateCandidates,
    rightContextWindow,
    splitVerbCandidates,
    lookupRequest
  };
})();
