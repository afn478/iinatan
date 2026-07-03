const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/main/54_anki_media_names.js"),
  "utf8",
);
const context = { console, Math, Number, String };

vm.createContext(context);
vm.runInContext(
  source +
    `
globalThis.__ankiMediaNames = {
  ANKI_MEDIA_DOCUMENT_STEM_MAX_LENGTH,
  ankiSafeMediaName,
  ankiMediaDocumentStem,
  ankiRandomHex,
  ankiMediaHexSuffix,
  ankiMediaFilename
};`,
  context,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const media = context.__ankiMediaNames;

assert(
  media.ANKI_MEDIA_DOCUMENT_STEM_MAX_LENGTH === 14,
  "Document stems should stay capped to the existing short prefix length",
);
assert(
  media.ankiSafeMediaName(" Episode 01: Cat/Dog? ") === "Episode_01_Cat_Dog",
  "Media names should replace unsafe runs with underscores and trim edges",
);
assert(
  media.ankiSafeMediaName("***") === "iinatan",
  "Empty sanitized media names should fall back to iinatan",
);
assert(
  media.ankiMediaDocumentStem("Very Long Episode Name 01") === "Very_Long_Epis",
  "Document stems should truncate safely without trailing separators",
);
assert(
  media.ankiMediaDocumentStem("...") === "video",
  "Document stems should fall back to video when trimming removes all content",
);
assert(
  media.ankiMediaHexSuffix("ABCDEF1234567890") === "abcdef123456",
  "Hex suffixes should lowercase and cap to 12 characters",
);
assert(
  /^[0-9a-f]{12}$/.test(media.ankiMediaHexSuffix("zzzz")),
  "Invalid hex suffixes should fall back to random hex",
);
assert(
  /^[0-9a-f]{1}$/.test(media.ankiRandomHex(-10)),
  "Random hex length should clamp to at least one character",
);
assert(
  /^[0-9a-f]{32}$/.test(media.ankiRandomHex(999)),
  "Random hex length should clamp to 32 characters",
);
assert(
  media.ankiMediaFilename(
    "Very Long Episode Name 01",
    "ABCDEF1234567890",
    "JPG",
  ) === "Very_Long_Epis_abcdef123456.jpg",
  "Media filenames should combine short document stem, hex suffix, and lowercase extension",
);
assert(
  media.ankiMediaFilename("clip", "deadbeef", "../../weird-ext") ===
    "clip_deadbeef.weirdext",
  "Media filename extensions should keep only alphanumeric characters",
);
assert(
  media.ankiMediaFilename("", "", "") !== "",
  "Media filenames should always return a usable fallback filename",
);

console.log("anki media name tests passed");
