const IINATAN_LANGUAGE_COMMON = (() => {
  const JAPANESE_CHAR_RE = /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶー]/;
  const CHINESE_CHAR_RE = /[\u3400-\u9fff\uf900-\ufaff]/;
  const LATIN_WORD_CHAR_RE = /[A-Za-zÀ-ÖØ-öø-ÿ0-9'’ʼ＇‘‛\-‐‑‒–—]/;
  const APOSTROPHE_RE = /['’ʼ＇‘‛]/g;
  const EDGE_PUNCTUATION_RE =
    /^[\s.,!?;:()[\]{}"“”«»‹›…]+|[\s.,!?;:()[\]{}"“”«»‹›…]+$/g;
  const KOREAN_CHAR_RE = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

  function chars(text) {
    return Array.from(String(text || ""));
  }

  function normalizeBasic(text) {
    const raw = String(text || "");
    try {
      return raw.normalize("NFKC");
    } catch (_) {
      return raw;
    }
  }

  function normalizeLatinLookup(text) {
    return trimLookupPunctuation(normalizeBasic(text)).toLowerCase();
  }

  function normalizeApostrophes(text) {
    return String(text || "").replace(APOSTROPHE_RE, "'");
  }

  function trimLookupPunctuation(text) {
    return String(text || "")
      .replace(EDGE_PUNCTUATION_RE, "")
      .trim();
  }

  function candidateKey(text) {
    return String(text || "").normalize
      ? String(text || "").normalize("NFC")
      : String(text || "");
  }

  function pushUniqueCandidate(list, seen, candidate) {
    if (!candidate || !candidate.text) return;
    const text = String(candidate.text || "");
    const key = candidateKey(text);
    if (!key || seen[key]) return;
    seen[key] = true;
    list.push(
      Object.assign(
        {
          normalizedText: text,
          source: "candidate",
          reason: "candidate",
        },
        candidate,
        { text },
      ),
    );
  }

  function dictionaryIdentity(dict) {
    return [
      dict && dict.name,
      dict && dict.title,
      dict && dict.path,
      dict && dict.indexUrl,
      dict && dict.downloadUrl,
    ]
      .join(" ")
      .toLowerCase();
  }

  function clampPosition(position, length) {
    return Math.max(
      0,
      Math.min(Number(position) || 0, Math.max(0, Number(length) || 0)),
    );
  }

  function findRun(charsList, position, predicate) {
    const pos = clampPosition(position, charsList.length);
    if (
      !charsList.length ||
      pos >= charsList.length ||
      !predicate(charsList[pos])
    )
      return null;
    let start = pos;
    let end = pos + 1;
    while (start > 0 && predicate(charsList[start - 1])) start--;
    while (end < charsList.length && predicate(charsList[end])) end++;
    return { start, end };
  }

  function slice(charsList, start, end) {
    return charsList.slice(start, end).join("");
  }

  return {
    JAPANESE_CHAR_RE,
    CHINESE_CHAR_RE,
    LATIN_WORD_CHAR_RE,
    KOREAN_CHAR_RE,
    APOSTROPHE_RE,
    chars,
    normalizeBasic,
    normalizeLatinLookup,
    normalizeApostrophes,
    trimLookupPunctuation,
    clampPosition,
    findRun,
    slice,
    pushUniqueCandidate,
    dictionaryIdentity,
  };
})();
