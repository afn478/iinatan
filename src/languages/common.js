const IINATAN_LANGUAGE_COMMON = (() => {
  const JAPANESE_CHAR_RE = /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶー]/;
  const LATIN_WORD_CHAR_RE = /[A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]/;
  const KOREAN_CHAR_RE = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

  function chars(text) {
    return Array.from(String(text || ""));
  }

  function normalizeBasic(text) {
    const raw = String(text || "");
    try { return raw.normalize("NFKC"); } catch (_) { return raw; }
  }

  function clampPosition(position, length) {
    return Math.max(0, Math.min(Number(position) || 0, Math.max(0, Number(length) || 0)));
  }

  function findRun(charsList, position, predicate) {
    const pos = clampPosition(position, charsList.length);
    if (!charsList.length || pos >= charsList.length || !predicate(charsList[pos])) return null;
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
    LATIN_WORD_CHAR_RE,
    KOREAN_CHAR_RE,
    chars,
    normalizeBasic,
    clampPosition,
    findRun,
    slice
  };
})();
