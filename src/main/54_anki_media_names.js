const ANKI_MEDIA_DOCUMENT_STEM_MAX_LENGTH = 14;

function ankiSafeMediaName(text) {
  const base = String(text || "iinatan")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return base || "iinatan";
}
function ankiMediaDocumentStem(text) {
  const safe = ankiSafeMediaName(text || "video");
  return (
    safe
      .slice(0, ANKI_MEDIA_DOCUMENT_STEM_MAX_LENGTH)
      .replace(/[._-]+$/g, "") || "video"
  );
}
function ankiRandomHex(length) {
  const target = Math.max(1, Math.min(32, Number(length) || 12));
  let out = "";
  while (out.length < target) {
    out += Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, "0");
  }
  return out.slice(0, target);
}
function ankiMediaHexSuffix(hex) {
  const clean = String(hex || "")
    .toLowerCase()
    .replace(/[^0-9a-f]+/g, "")
    .slice(0, 12);
  return clean || ankiRandomHex(12);
}
function ankiMediaFilename(documentName, hex, ext) {
  const suffix = ankiMediaHexSuffix(hex);
  const extension =
    String(ext || "bin")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 8) || "bin";
  return ankiMediaDocumentStem(documentName) + "_" + suffix + "." + extension;
}
