const IINATAN_LOOKUP_CHARACTER_POLICY = (() => {
  const MAX_CODE_POINT = 0x10ffff;
  const policies = {
    japanese: {
      ranges: [
        { start: 0x3040, end: 0x30ff },
        { start: 0x3400, end: 0x9fff },
      ],
      additionalCharacters: "々〆",
    },
    latinWord: {
      ranges: [
        { start: 0x30, end: 0x39 },
        { start: 0x41, end: 0x5a },
        { start: 0x61, end: 0x7a },
        { start: 0xc0, end: 0xd6 },
        { start: 0xd8, end: 0xf6 },
        { start: 0xf8, end: 0x24f },
        { start: 0x1e00, end: 0x1eff },
      ],
      additionalCharacters: "'’ʼ＇‘‛-‐‑‒–—",
    },
    chinese: {
      ranges: [
        { start: 0x3400, end: 0x9fff },
        { start: 0xf900, end: 0xfaff },
      ],
      additionalCharacters: "",
    },
    korean: {
      ranges: [
        { start: 0x1100, end: 0x11ff },
        { start: 0x3130, end: 0x318f },
        { start: 0xac00, end: 0xd7af },
      ],
      additionalCharacters: "",
    },
  };

  function normalizedRange(value) {
    if (!value || typeof value !== "object") return null;
    const start = Number(value.start);
    const end = Number(value.end);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > MAX_CODE_POINT
    )
      return null;
    return { start, end };
  }

  function normalize(value) {
    if (!value || typeof value !== "object") return null;
    if (!Array.isArray(value.ranges)) return null;
    const ranges = [];
    for (let index = 0; index < value.ranges.length; index++) {
      const range = normalizedRange(value.ranges[index]);
      if (!range) return null;
      ranges.push(range);
    }
    const additionalCharacters =
      typeof value.additionalCharacters === "string"
        ? value.additionalCharacters
        : "";
    if (!ranges.length && !additionalCharacters) return null;
    return { ranges, additionalCharacters };
  }

  function matches(value, character) {
    const policy = normalize(value);
    const chars = Array.from(String(character || ""));
    if (!policy || chars.length !== 1) return false;
    const codePoint = chars[0].codePointAt(0);
    if (
      policy.ranges.some(
        (range) => codePoint >= range.start && codePoint <= range.end,
      )
    )
      return true;
    return Array.from(policy.additionalCharacters).includes(chars[0]);
  }

  return { policies, normalize, matches };
})();
