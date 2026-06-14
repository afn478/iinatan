let ankiManagerStateCache = null;
let ankiManagerRefreshInFlight = false;
let ankiManagerRefreshSerial = 0;
let ankiModelFieldCache = Object.create(null);

const ANKI_CONNECT_VERSION = 6;
const ANKI_MEDIA_MAX_AUDIO_SECONDS = 35;

function ankiActiveProfilePreferences(overrides) {
  const manifest = readManifest();
  const profile = activeDictionaryProfile(manifest);
  return normalizeProfilePreferences(Object.assign({}, profile.preferences || {}, overrides || {}));
}
function ankiFieldTemplatesFromPrefs(prefs) {
  return normalizeAnkiFieldTemplates(prefs && prefs.ankiFieldTemplatesJson);
}
function ankiProfileConfigured(prefs) {
  const templates = ankiFieldTemplatesFromPrefs(prefs || {});
  const hasTemplate = Object.keys(templates).some(field => String(templates[field] || "").trim());
  return !!(prefs && prefs.ankiEnabled && prefs.ankiConnectUrl && prefs.ankiDeckName && prefs.ankiModelName && hasTemplate);
}
function overlayAnkiConfig() {
  const prefs = ankiActiveProfilePreferences();
  return {
    enabled: !!prefs.ankiEnabled,
    configured: ankiProfileConfigured(prefs),
    duplicateCheck: !!prefs.ankiDuplicateCheck,
    duplicateMode: prefs.ankiDuplicateMode,
    duplicateScope: prefs.ankiDuplicateScope,
    deckName: prefs.ankiDeckName,
    modelName: prefs.ankiModelName
  };
}
function dictionaryManagerAnkiState(profilePreferences) {
  const prefs = normalizeProfilePreferences(profilePreferences || ankiActiveProfilePreferences());
  const cached = ankiManagerStateCache || {};
  const fields = Array.isArray(cached.fields) && cached.modelName === prefs.ankiModelName ? cached.fields.slice() : [];
  return {
    enabled: !!prefs.ankiEnabled,
    connectUrl: prefs.ankiConnectUrl,
    deckName: prefs.ankiDeckName,
    modelName: prefs.ankiModelName,
    fieldTemplates: ankiFieldTemplatesFromPrefs(prefs),
    tags: prefs.ankiTags,
    audioFormat: prefs.ankiAudioFormat,
    audioBitrateKbps: prefs.ankiAudioBitrateKbps,
    imageQuality: prefs.ankiImageQuality,
    duplicateCheck: !!prefs.ankiDuplicateCheck,
    duplicateMode: prefs.ankiDuplicateMode,
    duplicateScope: prefs.ankiDuplicateScope,
    sentenceAudioPaddingMs: prefs.ankiSentenceAudioPaddingMs,
    lookupLanguage: String(prefs.lookupLanguage || "ja"),
    markers: ankiMarkerDefinitions(String(prefs.lookupLanguage || "ja")),
    reachable: !!cached.reachable,
    checking: !!ankiManagerRefreshInFlight,
    message: cached.message || "AnkiConnect has not been checked yet.",
    checkedAt: cached.checkedAt || 0,
    version: cached.version || null,
    deckNames: Array.isArray(cached.deckNames) ? cached.deckNames.slice() : [],
    modelNames: Array.isArray(cached.modelNames) ? cached.modelNames.slice() : [],
    fields
  };
}
function ankiMarkerDefinitions(language) {
  const lang = String(language || "ja");
  const markers = [
    { marker: "{expression}", label: "Headword" },
    { marker: "{word}", label: "Headword alias" },
    { marker: "{reading}", label: "Reading" },
    { marker: "{furigana}", label: "Headword ruby" },
    { marker: "{furigana-plain}", label: "Furigana text" },
    { marker: "{popup-selection-text}", label: "Looked-up text" },
    { marker: "{sentence}", label: "Subtitle sentence" },
    { marker: "{cloze-prefix}", label: "Cloze before word" },
    { marker: "{cloze-body}", label: "Cloze word" },
    { marker: "{cloze-suffix}", label: "Cloze after word" },
    { marker: "{glossary-first}", label: "First definition" },
    { marker: "{selected-glossary}", label: "Selected definition" },
    { marker: "{glossary}", label: "All definitions" },
    { marker: "{glossary-plain}", label: "Plain definitions" },
    { marker: "{dictionary}", label: "Dictionary" },
    { marker: "{part-of-speech}", label: "Part of speech" },
    { marker: "{tags}", label: "Dictionary tags" },
    { marker: "{frequencies}", label: "Frequency tags" },
    { marker: "{frequency-harmonic-rank}", label: "Frequency rank" },
    { marker: "{phonetic-transcriptions}", label: "Phonetics" },
    { marker: "{document-title}", label: "Video title" },
    { marker: "{source-path}", label: "File path" },
    { marker: "{timestamp}", label: "Timestamp" },
    { marker: "{screenshot}", label: "Video screenshot" },
    { marker: "{image}", label: "Video screenshot alias" },
    { marker: "{sentence-audio}", label: "Subtitle audio" },
    { marker: "{subtitle-audio}", label: "Subtitle audio alias" },
    { marker: "{audio}", label: "Word audio or subtitle audio" }
  ];
  if (lang === "ja") {
    markers.push(
      { marker: "{pitch-accent-positions}", label: "Pitch positions" },
      { marker: "{pitch-accent-categories}", label: "Pitch categories" }
    );
  }
  return markers;
}
function ankiFieldCacheKey(prefs) {
  return String((prefs && prefs.ankiConnectUrl) || "") + "\n" + String((prefs && prefs.ankiModelName) || "");
}
function safeAnkiConnectUrl(rawUrl) {
  const value = normalizeAnkiConnectUrl(rawUrl);
  try {
    if (typeof safeExternalHttpUrl === "function") return safeExternalHttpUrl(value);
  } catch (_) {}
  return /^https?:\/\/[^\s<>"']+$/i.test(value) ? value : "";
}
function ankiRequestPath() {
  return dataPath("anki-connect-request-" + String(Date.now()) + "-" + String(Math.random()).slice(2) + ".json");
}
async function ankiConnectInvoke(action, params, options) {
  const opts = options || {};
  const url = safeAnkiConnectUrl(opts.url || ankiActiveProfilePreferences().ankiConnectUrl);
  if (!url) throw new Error("Invalid AnkiConnect URL.");
  const payload = {
    action: String(action || ""),
    version: ANKI_CONNECT_VERSION,
    params: params || {}
  };
  const requestPath = ankiRequestPath();
  file.write(requestPath, JSON.stringify(payload));
  const timeout = Math.max(1, Math.min(60, Number(opts.timeoutSeconds || 8) || 8));
  let result = null;
  try {
    result = await utils.exec("/usr/bin/curl", [
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      String(timeout),
      "--header",
      "Content-Type: application/json",
      "--data-binary",
      "@" + requestPath,
      url
    ], dataRoot());
  } finally {
    try { await utils.exec("/bin/rm", ["-f", requestPath], dataRoot()); } catch (_) {}
  }
  if (!result || result.status !== 0) {
    throw new Error("AnkiConnect request failed: " + String((result && (result.stderr || result.stdout)) || "curl failed").slice(0, 500));
  }
  let parsed = null;
  try { parsed = JSON.parse(String(result.stdout || "")); } catch (error) {
    throw new Error("AnkiConnect returned invalid JSON: " + compactError(error));
  }
  if (parsed && parsed.error) throw new Error(String(parsed.error));
  return parsed ? parsed.result : null;
}
function postDictionaryManagerAnkiState() {
  try { postToDictionaryManager("dictionary-manager-anki-state", dictionaryManagerAnkiState()); }
  catch (error) { debugWarn("could not build Anki manager state: " + compactError(error)); }
}
function refreshDictionaryManagerAnkiState(overrides) {
  const serial = ++ankiManagerRefreshSerial;
  const prefs = ankiActiveProfilePreferences(overrides || {});
  ankiManagerRefreshInFlight = true;
  ankiManagerStateCache = Object.assign({}, ankiManagerStateCache || {}, {
    reachable: false,
    message: "Checking AnkiConnect...",
    checkedAt: Date.now(),
    modelName: prefs.ankiModelName
  });
  postDictionaryManagerAnkiState();
  (async () => {
    try {
      const invokeOptions = { url: prefs.ankiConnectUrl, timeoutSeconds: 4 };
      const version = await ankiConnectInvoke("version", {}, invokeOptions);
      const deckNames = await ankiConnectInvoke("deckNames", {}, invokeOptions);
      const modelNames = await ankiConnectInvoke("modelNames", {}, invokeOptions);
      let fields = [];
      if (prefs.ankiModelName && Array.isArray(modelNames) && modelNames.indexOf(prefs.ankiModelName) >= 0) {
        fields = await ankiConnectInvoke("modelFieldNames", { modelName: prefs.ankiModelName }, invokeOptions);
      }
      if (serial !== ankiManagerRefreshSerial) return;
      ankiManagerStateCache = {
        reachable: true,
        message: "Reachable.",
        checkedAt: Date.now(),
        version,
        deckNames: Array.isArray(deckNames) ? deckNames : [],
        modelNames: Array.isArray(modelNames) ? modelNames : [],
        fields: Array.isArray(fields) ? fields : [],
        modelName: prefs.ankiModelName
      };
      ankiModelFieldCache[ankiFieldCacheKey(prefs)] = ankiManagerStateCache.fields.slice();
    } catch (error) {
      if (serial !== ankiManagerRefreshSerial) return;
      ankiManagerStateCache = {
        reachable: false,
        message: "Not reachable: " + compactError(error),
        checkedAt: Date.now(),
        version: null,
        deckNames: [],
        modelNames: [],
        fields: [],
        modelName: prefs.ankiModelName
      };
    } finally {
      if (serial === ankiManagerRefreshSerial) {
        ankiManagerRefreshInFlight = false;
        postDictionaryManagerAnkiState();
      }
    }
  })();
}
function ankiEscapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function ankiNormalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
function ankiCompareKey(value) {
  const raw = ankiNormalizeWhitespace(value).toLowerCase();
  try { return raw.normalize("NFKC"); } catch (_) { return raw; }
}
function ankiToArray(value) {
  return Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]);
}
function ankiParseGlossaryJson(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || (text.charAt(0) !== "[" && text.charAt(0) !== "{")) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}
function ankiAttr(value) {
  return ankiEscapeHtml(value);
}
function ankiSafeDataName(name) {
  const clean = String(name || "").trim();
  if (!clean || /[\s"'<>/=]/.test(clean)) return "";
  return clean;
}
function ankiDataMap(node) {
  return node && typeof node === "object" && node.data && typeof node.data === "object" ? node.data : {};
}
function ankiNodeKind(node) {
  const data = ankiDataMap(node);
  return String(data.content || data["data-content"] || node && node.dataContent || node && node.kind || "");
}
function ankiNodeClassName(node) {
  const data = ankiDataMap(node);
  const attrs = node && (node.attributes || node.attrs) ? (node.attributes || node.attrs) : {};
  return String(data.class || data.className || attrs.class || node && node.className || "");
}
function ankiNodeTitle(node) {
  const data = ankiDataMap(node);
  const attrs = node && (node.attributes || node.attrs) ? (node.attributes || node.attrs) : {};
  return String(node && node.title || data.title || attrs.title || "");
}
function ankiNodeHref(node) {
  const data = ankiDataMap(node);
  const attrs = node && (node.attributes || node.attrs) ? (node.attributes || node.attrs) : {};
  return String(node && (node.href || node.url) || data.href || data.url || attrs.href || attrs.url || "");
}
function ankiSafeHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\/[^\s<>"']+$/i.test(raw)) return raw;
  return "";
}
function ankiKebabCssName(value) {
  return String(value || "")
    .replace(/[A-Z]/g, ch => "-" + ch.toLowerCase())
    .replace(/[^a-z0-9-]/gi, "")
    .replace(/^-+|-+$/g, "");
}
function ankiStyleText(style) {
  if (!style) return "";
  if (typeof style === "string") {
    const text = style.replace(/javascript\s*:/gi, "").replace(/expression\s*\(/gi, "").trim();
    return /[<>"']/.test(text) ? "" : text.slice(0, 2000);
  }
  if (typeof style !== "object" || Array.isArray(style)) return "";
  const parts = [];
  Object.keys(style).forEach(key => {
    const name = ankiKebabCssName(key);
    const value = String(style[key] === undefined || style[key] === null ? "" : style[key]).trim();
    if (!name || !value || /[<>"']/.test(value) || /javascript\s*:|expression\s*\(/i.test(value)) return;
    parts.push(name + ": " + value);
  });
  return parts.join("; ");
}
function ankiCommonAttributes(node, options) {
  const opts = options || {};
  const attrs = [];
  const cls = opts.className !== undefined ? String(opts.className || "") : ankiNodeClassName(node);
  if (cls && !/[\0<>"']/.test(cls)) attrs.push('class="' + ankiAttr(cls).slice(0, 500) + '"');
  if (node && node.lang && /^[a-z0-9-]+$/i.test(String(node.lang))) attrs.push('lang="' + ankiAttr(node.lang) + '"');
  const title = ankiNodeTitle(node);
  if (title) attrs.push('title="' + ankiAttr(title).slice(0, 1000) + '"');
  const data = ankiDataMap(node);
  Object.keys(data).forEach(key => {
    const name = ankiSafeDataName(key === "className" ? "class" : key);
    if (!name) return;
    const value = data[key];
    if (value === undefined || value === null || typeof value === "object") return;
    attrs.push('data-' + name + '="' + ankiAttr(value).slice(0, 2000) + '"');
  });
  const style = ankiStyleText(node && node.style);
  if (style) attrs.push('style="' + ankiAttr(style) + '"');
  if (opts.extraAttrs) opts.extraAttrs.forEach(attr => { if (attr) attrs.push(attr); });
  return attrs.length ? " " + attrs.join(" ") : "";
}
const ANKI_STRUCTURED_TAGS = {
  a: true, abbr: true, b: true, blockquote: true, br: true, cite: true, code: true,
  del: true, details: true, div: true, em: true, i: true, img: true, ins: true,
  kbd: true, li: true, mark: true, ol: true, p: true, pre: true, q: true, rp: true,
  rt: true, ruby: true, s: true, samp: true, small: true, span: true, strong: true,
  sub: true, summary: true, sup: true, table: true, tbody: true, td: true, tfoot: true,
  th: true, thead: true, time: true, tr: true, u: true, ul: true, var: true
};
const ANKI_VOID_TAGS = { br: true, img: true };
function ankiSafeTagName(value) {
  const tag = String(value || "").trim().toLowerCase();
  return ANKI_STRUCTURED_TAGS[tag] ? tag : "";
}
function ankiImageSrc(node) {
  const data = ankiDataMap(node);
  const attrs = node && (node.attributes || node.attrs) ? (node.attributes || node.attrs) : {};
  const src = String(node && (node.src || node.path) || data.src || data.path || attrs.src || "");
  if (/^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)[^\s<>"']+$/i.test(src)) return src;
  return "";
}
function ankiStructuredText(value) {
  if (value === undefined || value === null) return "";
  const parsed = ankiParseGlossaryJson(value);
  if (parsed !== null) return ankiStructuredText(parsed);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const allPrimitive = value.every(item => item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean");
    return value.map(ankiStructuredText).filter(Boolean).join(allPrimitive ? "; " : "");
  }
  if (typeof value !== "object") return "";
  if (ankiNodeKind(value) === "attribution") return "";
  if (value.type === "structured-content") return ankiStructuredText(value.content);
  const tag = String(value.tag || "").toLowerCase();
  const kind = ankiNodeKind(value);
  if (tag === "rt" || tag === "rp") return "";
  if (tag === "br") return "\n";
  if (tag === "ruby") {
    return ankiToArray(value.content)
      .filter(part => !(part && typeof part === "object" && String(part.tag || "").toLowerCase() === "rt"))
      .map(ankiStructuredText)
      .join("");
  }
  if (tag === "ul" || tag === "ol") {
    return ankiToArray(value.content).map(ankiStructuredText).filter(Boolean).join("; ");
  }
  if (/^(div|p|details|summary|table|thead|tbody|tfoot|tr|th|td)$/i.test(tag)) {
    return ankiToArray(value.content).map(ankiStructuredText).filter(Boolean).join(" ");
  }
  if (kind === "part-of-speech-info" || kind === "tag" || kind === "misc-info") {
    const text = ankiStructuredText(value.content);
    return text ? text + " " : "";
  }
  if (value.content !== undefined) return ankiStructuredText(value.content);
  if (value.text !== undefined) return ankiStructuredText(value.text);
  if (value.glossary !== undefined) return ankiStructuredText(value.glossary);
  return "";
}
function ankiPlainText(value) {
  if (value === undefined || value === null) return "";
  const parsed = ankiParseGlossaryJson(value);
  if (parsed !== null) return ankiNormalizeWhitespace(ankiStructuredText(parsed));
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return ankiNormalizeWhitespace(value);
  if (Array.isArray(value)) return ankiNormalizeWhitespace(ankiStructuredText(value));
  if (typeof value === "object") {
    if (value.type === "structured-content" || value.tag) return ankiNormalizeWhitespace(ankiStructuredText(value));
    if (value.content !== undefined) return ankiPlainText(value.content);
    if (value.text !== undefined) return ankiPlainText(value.text);
    if (value.glossary !== undefined) return ankiPlainText(value.glossary);
    return Object.keys(value).map(key => ankiPlainText(value[key])).filter(Boolean).join("; ");
  }
  return "";
}
function ankiStructuredHtml(value) {
  if (value === undefined || value === null) return "";
  const parsed = ankiParseGlossaryJson(value);
  if (parsed !== null) return ankiStructuredHtml(parsed);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return ankiEscapeHtml(value).replace(/\n/g, "<br>");
  if (Array.isArray(value)) return value.map(ankiStructuredHtml).filter(Boolean).join("");
  if (typeof value !== "object") return "";
  if (ankiNodeKind(value) === "attribution") return "";
  if (value.type === "structured-content") return ankiStructuredHtml(value.content);
  const tag = ankiSafeTagName(value.tag);
  if (!tag) return ankiStructuredHtml(value.content !== undefined ? value.content : value.text);
  if (tag === "a") {
    const body = ankiStructuredHtml(value.content) || ankiEscapeHtml(ankiNodeHref(value));
    const href = ankiSafeHref(ankiNodeHref(value));
    return href ? '<a href="' + ankiAttr(href) + '">' + body + "</a>" : "<span>" + body + "</span>";
  }
  if (tag === "img") {
    const src = ankiImageSrc(value);
    const alt = ankiPlainText(value.alt || value.title || "");
    return src ? '<img src="' + ankiAttr(src) + '"' + (alt ? ' alt="' + ankiAttr(alt) + '"' : "") + ">" : (alt ? ankiEscapeHtml(alt) : "");
  }
  let extraAttrs = [];
  if ((tag === "td" || tag === "th") && Number.isFinite(Number(value.colSpan))) extraAttrs.push('colspan="' + ankiAttr(Number(value.colSpan)) + '"');
  if ((tag === "td" || tag === "th") && Number.isFinite(Number(value.rowSpan))) extraAttrs.push('rowspan="' + ankiAttr(Number(value.rowSpan)) + '"');
  if (tag === "details" && value.open === true) extraAttrs.push("open");
  const body = ANKI_VOID_TAGS[tag] ? "" : ankiStructuredHtml(value.content);
  const className = ankiNodeClassName(value);
  const attrs = ankiCommonAttributes(value, { className, extraAttrs });
  return ANKI_VOID_TAGS[tag] ? ("<" + tag + attrs + ">") : ("<" + tag + attrs + ">" + body + "</" + tag + ">");
}
function ankiHtmlFromValue(value) {
  if (value === undefined || value === null) return "";
  const parsed = ankiParseGlossaryJson(value);
  if (parsed !== null) return ankiStructuredHtml(parsed);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return ankiEscapeHtml(value);
  if (Array.isArray(value)) {
    const items = value.map(ankiHtmlFromValue).filter(Boolean);
    if (!items.length) return "";
    return "<ul>" + items.map(item => "<li>" + item + "</li>").join("") + "</ul>";
  }
  if (typeof value === "object") {
    if (value.type === "structured-content" || value.tag) return ankiStructuredHtml(value);
    if (value.content !== undefined) return ankiHtmlFromValue(value.content);
    if (value.text !== undefined) return ankiHtmlFromValue(value.text);
    if (value.glossary !== undefined) return ankiHtmlFromValue(value.glossary);
  }
  return ankiEscapeHtml(ankiPlainText(value));
}
function ankiGlossaryItems(entry) {
  const term = entry && entry.term ? entry.term : {};
  return Array.isArray(term.glossaries) ? term.glossaries : [];
}
function ankiGlossaryPlain(entry) {
  return ankiGlossaryItems(entry).map(item => ankiPlainText(item && item.glossary)).filter(Boolean).join("\n");
}
function ankiGlossaryMetaLabel(item) {
  const dict = ankiNormalizeWhitespace(item && item.dict);
  const bits = [];
  ["partOfSpeech", "part_of_speech", "partOfSpeechInfo"].forEach(key => {
    const text = ankiNormalizeWhitespace(item && item[key]);
    if (text) bits.push(text);
  });
  if (dict) bits.push(dict);
  return bits.filter(Boolean).join(", ");
}
function ankiGlossaryEntryHtml(item) {
  const dict = ankiNormalizeWhitespace(item && item.dict);
  const body = ankiHtmlFromValue(item && item.glossary);
  if (!dict && !body) return "";
  const meta = ankiGlossaryMetaLabel(item);
  return '<li' + (dict ? ' data-dictionary="' + ankiAttr(dict) + '"' : "") + ">" +
    (meta ? "<i>(" + ankiEscapeHtml(meta) + ")</i> " : "") +
    body +
    "</li>";
}
function ankiGlossaryHtml(entry) {
  const items = ankiGlossaryItems(entry).map(ankiGlossaryEntryHtml).filter(Boolean);
  return items.length ? '<div style="text-align: left;" class="yomitan-glossary"><ol>' + items.join("") + "</ol></div>" : "";
}
function ankiFirstGlossary(entry) {
  const items = ankiGlossaryItems(entry);
  return items.length ? ankiPlainText(items[0] && items[0].glossary) : "";
}
function ankiFirstGlossaryHtml(entry) {
  const first = ankiGlossaryItems(entry)[0];
  const item = first ? ankiGlossaryEntryHtml(first) : "";
  return item ? '<div style="text-align: left;" class="yomitan-glossary"><ol>' + item + "</ol></div>" : "";
}
function ankiDictionaryNames(entry) {
  const seen = Object.create(null);
  const out = [];
  ankiGlossaryItems(entry).forEach(item => {
    const dict = ankiNormalizeWhitespace(item && item.dict);
    if (dict && !seen[dict]) {
      seen[dict] = true;
      out.push(dict);
    }
  });
  return out.join(", ");
}
function ankiEntryTags(entry) {
  const out = [];
  ankiGlossaryItems(entry).forEach(item => {
    ["definitionTags", "termTags", "tags"].forEach(key => {
      const raw = item && item[key];
      if (Array.isArray(raw)) raw.forEach(tag => out.push(ankiNormalizeWhitespace(tag)));
      else if (raw) String(raw).split(/[,;]\s*|\s{2,}/).forEach(tag => out.push(ankiNormalizeWhitespace(tag)));
    });
  });
  return out.filter(Boolean).join(", ");
}
function ankiPartOfSpeech(entry) {
  const bits = [];
  ankiGlossaryItems(entry).forEach(item => {
    ["partOfSpeech", "part_of_speech", "partOfSpeechInfo"].forEach(key => {
      const text = ankiNormalizeWhitespace(item && item[key]);
      if (text) bits.push(text);
    });
  });
  return bits.filter(Boolean).join(", ");
}
function ankiFormatFrequencies(term) {
  const rows = Array.isArray(term && term.frequencies) ? term.frequencies : [];
  const out = [];
  rows.forEach(row => {
    const dict = ankiNormalizeWhitespace(row && (row.dict || row.dictName || row.dictionary));
    const values = Array.isArray(row && row.frequencies) ? row.frequencies : [];
    const display = values.map(value => ankiNormalizeWhitespace((value && (value.displayValue || value.display_value)) || (value && value.value !== undefined ? String(value.value) : ""))).filter(Boolean).join(", ");
    if (dict || display) out.push((dict || "Frequency") + (display ? " " + display : ""));
  });
  return out.join("; ");
}
function ankiFrequencyHarmonicRank(term) {
  const values = [];
  const rows = Array.isArray(term && term.frequencies) ? term.frequencies : [];
  rows.forEach(row => {
    const freqs = Array.isArray(row && row.frequencies) ? row.frequencies : [];
    freqs.forEach(item => {
      const value = Number(item && item.value);
      if (Number.isFinite(value) && value > 0) values.push(value);
    });
  });
  if (!values.length) return "";
  const denom = values.reduce((sum, value) => sum + (1 / value), 0);
  if (!denom) return "";
  return String(Math.round(values.length / denom));
}
function ankiPitchPositions(term) {
  const out = [];
  const rows = Array.isArray(term && term.pitches) ? term.pitches : [];
  rows.forEach(row => {
    const positions = Array.isArray(row && row.positions) ? row.positions : (Array.isArray(row && row.pitchPositions) ? row.pitchPositions : []);
    positions.forEach(pos => out.push(String(pos)));
  });
  return out.join(", ");
}
function ankiPitchCategories(term) {
  const positions = ankiPitchPositions(term).split(/,\s*/).map(v => Number(v)).filter(v => Number.isFinite(v));
  if (!positions.length) return "";
  return positions.map(pos => pos === 0 ? "heiban" : (pos === 1 ? "atamadaka" : "nakadaka")).join(", ");
}
function ankiPhoneticTranscriptions(term) {
  const out = [];
  const pitches = Array.isArray(term && term.pitches) ? term.pitches : [];
  pitches.forEach(row => {
    const values = Array.isArray(row && row.transcriptions) ? row.transcriptions : [];
    values.forEach(value => {
      const text = ankiNormalizeWhitespace(value);
      if (text) out.push(text);
    });
  });
  return out.join(", ");
}
function ankiDisplayHeadword(entry) {
  const term = entry && entry.term ? entry.term : {};
  return String(term.expression || (entry && entry.deinflected) || (entry && entry.matched) || "");
}
function ankiDisplayReading(entry, expression) {
  const term = entry && entry.term ? entry.term : {};
  const reading = ankiNormalizeWhitespace(term.reading || "");
  if (!reading || (expression && ankiCompareKey(reading) === ankiCompareKey(expression))) return "";
  return reading;
}
function ankiLookupSurface(context, entry) {
  const candidate = context && context.result && context.result.candidateUsed ? context.result.candidateUsed : null;
  if (context && context.surface) return String(context.surface);
  if (entry && entry.matched) return String(entry.matched);
  if (candidate && candidate.displayText) return String(candidate.displayText);
  const result = context && context.result ? context.result : {};
  const text = String(result.text || context.sentence || lastSubtitle || "");
  const start = Number(result.lookupStart);
  const end = Number(result.lookupEnd);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return Array.from(text).slice(start, end).join("");
  if (result.lookupText) return String(result.lookupText);
  return "";
}
function ankiMediaTitleFromMpv() {
  const props = ["media-title", "metadata/by-key/title", "metadata/by-key/Title", "filename/no-ext", "filename"];
  for (let i = 0; i < props.length; i++) {
    try {
      const value = ankiNormalizeWhitespace(mpv.getString(props[i]));
      if (value) return value;
    } catch (_) {}
  }
  try {
    const path = ankiSourcePathFromMpv();
    const filename = path.split("/").filter(Boolean).pop() || "";
    return filename.replace(/\.[^.]+$/, "");
  } catch (_) {}
  return "";
}
function ankiSourcePathFromMpv() {
  const props = ["path", "stream-open-filename"];
  for (let i = 0; i < props.length; i++) {
    try {
      const value = String(mpv.getString(props[i]) || "").trim();
      if (value) return value;
    } catch (_) {}
  }
  return "";
}
function ankiTimePosFromMpv() {
  try {
    const value = Number(mpv.getNumber("time-pos"));
    if (Number.isFinite(value)) return value;
  } catch (_) {}
  try {
    const value = Number(mpv.getString("time-pos"));
    if (Number.isFinite(value)) return value;
  } catch (_) {}
  return 0;
}
function ankiSubtitleBoundary(name) {
  try {
    const value = Number(mpv.getNumber(name));
    if (Number.isFinite(value) && value >= 0) return value;
  } catch (_) {}
  try {
    const value = Number(mpv.getString(name));
    if (Number.isFinite(value) && value >= 0) return value;
  } catch (_) {}
  return null;
}
function ankiFormatTimestamp(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  return (h > 0 ? String(h) + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(s).padStart(2, "0");
}
function ankiFuriganaPlain(expression, reading) {
  return reading ? (String(expression || "") + "[" + String(reading || "") + "]") : String(expression || "");
}
function ankiFuriganaHtml(expression, reading) {
  return reading ? ("<ruby>" + ankiEscapeHtml(expression) + "<rt>" + ankiEscapeHtml(reading) + "</rt></ruby>") : ankiEscapeHtml(expression);
}
function ankiClozeForSentence(sentence, surface, position) {
  const chars = Array.from(String(sentence || ""));
  const bodyChars = Array.from(String(surface || ""));
  let start = Number(position);
  if (!Number.isFinite(start) || start < 0 || start >= chars.length) {
    const sentenceText = String(sentence || "");
    const idx = surface ? sentenceText.indexOf(String(surface)) : -1;
    start = idx >= 0 ? Array.from(sentenceText.slice(0, idx)).length : 0;
  }
  let end = start + Math.max(1, bodyChars.length || 1);
  if (start < 0) start = 0;
  if (end > chars.length) end = chars.length;
  const body = chars.slice(start, end).join("") || String(surface || "");
  return {
    prefix: chars.slice(0, start).join(""),
    body,
    suffix: chars.slice(end).join("")
  };
}
function ankiCardContextFromPayload(payload) {
  const raw = payload && payload.context && typeof payload.context === "object" ? payload.context : {};
  const entry = raw.entry && typeof raw.entry === "object" ? raw.entry : {};
  const term = entry.term || {};
  const expression = ankiNormalizeWhitespace(raw.expression || raw.heading || ankiDisplayHeadword(entry));
  const reading = ankiNormalizeWhitespace(raw.reading || ankiDisplayReading(entry, expression));
  const sentence = String(raw.sentence || (raw.result && raw.result.text) || lastSubtitle || "");
  const surface = ankiNormalizeWhitespace(raw.surface || ankiLookupSurface(raw, entry) || expression);
  const position = Number(raw.position !== undefined ? raw.position : (payload && payload.position !== undefined ? payload.position : (raw.result && raw.result.lookupStart)));
  const cloze = ankiClozeForSentence(sentence, surface || expression, position);
  const title = ankiMediaTitleFromMpv();
  const sourcePath = ankiSourcePathFromMpv();
  const timePos = ankiTimePosFromMpv();
  const selectedGlossary = ankiFirstGlossary(entry);
  const selectedGlossaryHtml = ankiFirstGlossaryHtml(entry);
  return {
    requestId: String((payload && payload.requestId) || ""),
    entry,
    term,
    expression,
    word: expression,
    reading,
    sentence,
    surface,
    position: Number.isFinite(position) ? position : 0,
    clozePrefix: cloze.prefix,
    clozeBody: cloze.body,
    clozeSuffix: cloze.suffix,
    glossary: ankiGlossaryHtml(entry),
    glossaryPlain: ankiGlossaryPlain(entry),
    glossaryFirst: selectedGlossary,
    selectedGlossary,
    selectedGlossaryHtml,
    dictionary: ankiDictionaryNames(entry),
    partOfSpeech: ankiPartOfSpeech(entry),
    tags: ankiEntryTags(entry),
    frequencies: ankiFormatFrequencies(term),
    frequencyHarmonicRank: ankiFrequencyHarmonicRank(term),
    pitchAccentPositions: ankiPitchPositions(term),
    pitchAccentCategories: ankiPitchCategories(term),
    phoneticTranscriptions: ankiPhoneticTranscriptions(term),
    documentTitle: title,
    sourcePath,
    timestamp: ankiFormatTimestamp(timePos),
    timePos,
    audioTerm: expression,
    audioReading: reading
  };
}
function extractAnkiMarkersFromTemplates(templates) {
  const out = Object.create(null);
  Object.keys(templates || {}).forEach(field => {
    const text = String(templates[field] || "");
    text.replace(/\{([^{}]+)\}/g, (_match, key) => {
      out[String(key || "").trim().toLowerCase()] = true;
      return "";
    });
  });
  return out;
}
function ankiTemplatesNeedMedia(templates) {
  const markers = extractAnkiMarkersFromTemplates(templates || {});
  return {
    screenshot: !!(markers.screenshot || markers.image),
    sentenceAudio: !!(markers["sentence-audio"] || markers["subtitle-audio"]),
    wordAudio: !!markers.audio
  };
}
function ankiMarkerValue(marker, context, media) {
  const key = String(marker || "").trim().toLowerCase();
  if (key === "expression" || key === "word") return ankiEscapeHtml(context.expression);
  if (key === "reading") return ankiEscapeHtml(context.reading);
  if (key === "furigana-plain") return ankiEscapeHtml(ankiFuriganaPlain(context.expression, context.reading));
  if (key === "furigana") return ankiFuriganaHtml(context.expression, context.reading);
  if (key === "popup-selection-text") return ankiEscapeHtml(context.surface);
  if (key === "sentence") return ankiEscapeHtml(context.sentence);
  if (key === "cloze-prefix") return ankiEscapeHtml(context.clozePrefix);
  if (key === "cloze-body") return ankiEscapeHtml(context.clozeBody);
  if (key === "cloze-suffix") return ankiEscapeHtml(context.clozeSuffix);
  if (key === "glossary") return context.glossary;
  if (key === "glossary-plain") return ankiEscapeHtml(context.glossaryPlain);
  if (key === "glossary-first") return ankiEscapeHtml(context.glossaryFirst);
  if (key === "selected-glossary") return context.selectedGlossaryHtml || ankiEscapeHtml(context.selectedGlossary || context.glossaryFirst);
  if (key === "dictionary" || key === "dictionary-alias") return ankiEscapeHtml(context.dictionary);
  if (key === "part-of-speech") return ankiEscapeHtml(context.partOfSpeech);
  if (key === "tags") return ankiEscapeHtml(context.tags);
  if (key === "frequencies") return ankiEscapeHtml(context.frequencies);
  if (key === "frequency-harmonic-rank") return ankiEscapeHtml(context.frequencyHarmonicRank);
  if (key === "pitch-accent-positions") return ankiEscapeHtml(context.pitchAccentPositions);
  if (key === "pitch-accent-categories") return ankiEscapeHtml(context.pitchAccentCategories);
  if (key === "phonetic-transcriptions") return ankiEscapeHtml(context.phoneticTranscriptions);
  if (key === "document-title") return ankiEscapeHtml(context.documentTitle);
  if (key === "source-path") return ankiEscapeHtml(context.sourcePath);
  if (key === "timestamp") return ankiEscapeHtml(context.timestamp);
  if (key === "screenshot" || key === "image") return media && media.screenshot ? '<img src="' + ankiEscapeHtml(media.screenshot) + '">' : "";
  if (key === "sentence-audio" || key === "subtitle-audio") return media && media.sentenceAudio ? "[sound:" + media.sentenceAudio + "]" : "";
  if (key === "audio") return media && media.wordAudio ? "[sound:" + media.wordAudio + "]" : "";
  return "";
}
function renderAnkiTemplate(template, context, media) {
  return String(template || "").replace(/\{([^{}]+)\}/g, (_match, marker) => ankiMarkerValue(marker, context, media || {}));
}
function renderAnkiFields(templates, context, media) {
  const fields = {};
  Object.keys(templates || {}).forEach(field => {
    fields[field] = renderAnkiTemplate(templates[field], context, media || {});
  });
  return fields;
}
function ankiSearchEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
function ankiDuplicateQuery(prefs, fields, fieldNames) {
  const model = prefs.ankiModelName;
  const deck = prefs.ankiDeckName;
  const firstField = Array.isArray(fieldNames) && fieldNames.length ? fieldNames[0] : Object.keys(fields || {})[0];
  const value = firstField ? String(fields[firstField] || "") : "";
  if (!model || !firstField || !value) return "";
  const parts = ['note:"' + ankiSearchEscape(model) + '"', '"' + ankiSearchEscape(firstField) + ':' + ankiSearchEscape(value) + '"'];
  if (prefs.ankiDuplicateScope === "deck" && deck) parts.unshift('deck:"' + ankiSearchEscape(deck) + '"');
  return parts.join(" ");
}
async function ankiFindDuplicateNotes(prefs, fields, fieldNames) {
  if (!prefs.ankiDuplicateCheck) return [];
  const query = ankiDuplicateQuery(prefs, fields, fieldNames);
  if (!query) return [];
  const result = await ankiConnectInvoke("findNotes", { query }, { url: prefs.ankiConnectUrl, timeoutSeconds: 8 });
  return Array.isArray(result) ? result : [];
}
function ankiDuplicateOptions(prefs) {
  return {
    allowDuplicate: prefs.ankiDuplicateMode === "allow",
    duplicateScope: prefs.ankiDuplicateScope === "collection" ? "collection" : "deck",
    duplicateScopeOptions: {
      deckName: prefs.ankiDeckName,
      checkChildren: true,
      checkAllModels: false
    }
  };
}
function ankiNoteTags(prefs) {
  const seen = Object.create(null);
  const out = [];
  String(prefs.ankiTags || "").split(/[,\s]+/).forEach(tag => {
    const clean = tag.trim();
    if (clean && !seen[clean]) {
      seen[clean] = true;
      out.push(clean);
    }
  });
  return out;
}
async function ankiStoreMediaFile(filename, path, prefs) {
  if (!filename || !path) return "";
  const stored = await ankiConnectInvoke("storeMediaFile", {
    filename,
    path,
    deleteExisting: true
  }, { url: prefs.ankiConnectUrl, timeoutSeconds: 20 });
  return String(stored || filename);
}
async function ankiStoreMediaUrl(filename, url, prefs) {
  if (!filename || !url) return "";
  const stored = await ankiConnectInvoke("storeMediaFile", {
    filename,
    url,
    deleteExisting: true
  }, { url: prefs.ankiConnectUrl, timeoutSeconds: 20 });
  return String(stored || filename);
}
function ankiSafeMediaName(text) {
  const base = String(text || "iinatan").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return base || "iinatan";
}
function ankiMediaPath(filename) {
  return dataPath("anki-media", filename);
}
async function ensureAnkiMediaRoot() {
  await utils.exec("/bin/mkdir", ["-p", dataPath("anki-media")], dataRoot());
}
function ankiMpvGetProperty(name) {
  try { return mpv.getString(name); } catch (_) {}
  try { return mpv.getNumber(name); } catch (_) {}
  return undefined;
}
function ankiMpvSetProperty(name, value) {
  try { mpv.set(name, value); return true; } catch (_) {}
  try { mpv.command("set", [name, String(value)]); return true; } catch (_) {}
  return false;
}
async function ankiCaptureScreenshot(context, prefs) {
  await ensureAnkiMediaRoot();
  const filename = ankiSafeMediaName((context.documentTitle || "video") + "-" + ankiFormatTimestamp(context.timePos) + "-" + String(Date.now())) + ".jpg";
  const path = ankiMediaPath(filename);
  const quality = normalizeAnkiImageQuality(prefs && prefs.ankiImageQuality);
  const previousQuality = ankiMpvGetProperty("screenshot-jpeg-quality");
  const didSetQuality = ankiMpvSetProperty("screenshot-jpeg-quality", quality);
  try {
    try { mpv.command("screenshot-to-file", [path, "video"]); }
    catch (error) { throw new Error("Could not capture screenshot: " + compactError(error)); }
    for (let i = 0; i < 25; i++) {
      try { if (file.exists(path)) return ankiStoreMediaFile(filename, path, prefs); } catch (_) {}
      await sleep(40);
    }
  } finally {
    if (didSetQuality && previousQuality !== undefined && previousQuality !== null && previousQuality !== "") {
      ankiMpvSetProperty("screenshot-jpeg-quality", previousQuality);
    }
  }
  throw new Error("Screenshot file was not created.");
}
async function ankiFindFfmpegPath() {
  const candidates = [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/Applications/IINA.app/Contents/MacOS/ffmpeg"
  ];
  for (let i = 0; i < candidates.length; i++) {
    try { if (file.exists(candidates[i])) return candidates[i]; } catch (_) {}
  }
  try {
    const result = await utils.exec("/usr/bin/which", ["ffmpeg"], dataRoot());
    const path = String(result && result.stdout || "").trim().split(/\r?\n/)[0];
    if (result && result.status === 0 && path) return path;
  } catch (_) {}
  return "";
}
async function ankiCaptureSentenceAudio(context, prefs) {
  const sourcePath = ankiSourcePathFromMpv();
  if (!sourcePath || /^https?:\/\//i.test(sourcePath)) throw new Error("Sentence audio requires a local media file.");
  const ffmpegPath = await ankiFindFfmpegPath();
  if (!ffmpegPath) throw new Error("ffmpeg was not found for sentence audio capture.");
  const subStart = ankiSubtitleBoundary("sub-start");
  const subEnd = ankiSubtitleBoundary("sub-end");
  const current = context.timePos || ankiTimePosFromMpv();
  const padding = Math.max(0, Math.min(2, Number(prefs.ankiSentenceAudioPaddingMs || 0) / 1000));
  let start = subStart !== null ? subStart : Math.max(0, current - 1.5);
  let end = subEnd !== null && subEnd > start ? subEnd : Math.min(start + 4, current + 2.5);
  start = Math.max(0, start - padding);
  end = Math.max(start + 0.25, end + padding);
  if (end - start > ANKI_MEDIA_MAX_AUDIO_SECONDS) end = start + ANKI_MEDIA_MAX_AUDIO_SECONDS;
  const duration = Math.max(0.25, end - start);
  const format = normalizeAnkiAudioFormat(prefs.ankiAudioFormat);
  const bitrate = normalizeAnkiAudioBitrateKbps(prefs && prefs.ankiAudioBitrateKbps);
  const ext = format === "opus" ? "opus" : "mp3";
  const filename = ankiSafeMediaName((context.documentTitle || "video") + "-" + ankiFormatTimestamp(start) + "-" + String(Date.now())) + "." + ext;
  const outPath = ankiMediaPath(filename);
  await ensureAnkiMediaRoot();
  const codecArgs = format === "opus" ? ["-c:a", "libopus", "-b:a", String(bitrate) + "k"] : ["-codec:a", "libmp3lame", "-b:a", String(bitrate) + "k"];
  const args = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    String(start.toFixed(3)),
    "-i",
    sourcePath,
    "-t",
    String(duration.toFixed(3)),
    "-map",
    "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-threads",
    "2"
  ].concat(codecArgs, [outPath]);
  const result = await utils.exec(ffmpegPath, args, dataRoot());
  if (!result || result.status !== 0 || !file.exists(outPath)) {
    throw new Error("Sentence audio capture failed: " + String((result && (result.stderr || result.stdout)) || "ffmpeg failed").slice(0, 500));
  }
  return ankiStoreMediaFile(filename, outPath, prefs);
}
function ankiAudioUrlFromTemplate(template, context, prefs) {
  const values = {
    term: String(context && context.audioTerm || context && context.expression || ""),
    reading: String(context && context.audioReading || context && context.reading || ""),
    language: String(prefs && prefs.lookupLanguage || "")
  };
  return String(template || "").replace(/\{([^}]*)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
    try { return encodeURIComponent(values[key]); } catch (_) { return values[key]; }
  });
}
function ankiUrlLooksLikeAudioFile(url) {
  return /\.(?:mp3|m4a|aac|ogg|oga|opus|wav|webm)(?:[?#]|$)/i.test(String(url || ""));
}
function ankiAudioExtensionFromUrl(url) {
  const match = String(url || "").match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  const ext = match ? match[1].toLowerCase() : "";
  return /^(mp3|m4a|aac|ogg|oga|opus|wav|webm)$/.test(ext) ? ext : "mp3";
}
async function ankiResolveWordAudioUrl(context, prefs) {
  const sources = normalizeAudioSources(prefs && prefs.audioSourcesJson);
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const sourceUrl = safeAnkiConnectUrl(ankiAudioUrlFromTemplate(source && source.url, context, prefs));
    if (!sourceUrl) continue;
    if (ankiUrlLooksLikeAudioFile(sourceUrl)) return sourceUrl;
    try {
      if (typeof fetchAudioSourceCandidates === "function") {
        const candidates = await fetchAudioSourceCandidates(sourceUrl);
        if (Array.isArray(candidates) && candidates.length && candidates[0].url) return candidates[0].url;
      }
    } catch (error) {
      debugVerbose("Anki word audio source failed: " + compactError(error));
    }
  }
  return "";
}
async function ankiStoreWordAudio(context, prefs) {
  try {
    const url = await ankiResolveWordAudioUrl(context, prefs);
    if (!url) return "";
    const filename = ankiSafeMediaName((context.expression || "word") + "-" + String(Date.now())) + "." + ankiAudioExtensionFromUrl(url);
    return await ankiStoreMediaUrl(filename, url, prefs);
  } catch (error) {
    debugVerbose("Anki word audio unavailable: " + compactError(error));
    return "";
  }
}
async function ankiCaptureNeededMedia(needs, context, prefs) {
  const media = {};
  const jobs = [];
  if (needs.screenshot) {
    jobs.push(ankiCaptureScreenshot(context, prefs).then(value => { media.screenshot = value; }));
  }
  if (needs.sentenceAudio) {
    jobs.push(ankiCaptureSentenceAudio(context, prefs).then(value => { media.sentenceAudio = value; }));
  }
  if (needs.wordAudio) {
    jobs.push(ankiStoreWordAudio(context, prefs).then(value => { if (value) media.wordAudio = value; }));
  }
  if (jobs.length) await Promise.all(jobs);
  return media;
}
async function ankiConfiguredFieldNames(prefs) {
  const key = ankiFieldCacheKey(prefs);
  if (Array.isArray(ankiModelFieldCache[key])) return ankiModelFieldCache[key].slice();
  try {
    const fields = await ankiConnectInvoke("modelFieldNames", { modelName: prefs.ankiModelName }, { url: prefs.ankiConnectUrl, timeoutSeconds: 8 });
    const out = Array.isArray(fields) ? fields : [];
    ankiModelFieldCache[key] = out.slice();
    return out;
  } catch (_) {
    return Object.keys(ankiFieldTemplatesFromPrefs(prefs));
  }
}
async function ankiCardStatusForContext(payload) {
  const prefs = ankiActiveProfilePreferences();
  if (!ankiProfileConfigured(prefs)) return { ok: false, state: "disabled", message: "Anki export is not configured." };
  const templates = ankiFieldTemplatesFromPrefs(prefs);
  const context = ankiCardContextFromPayload(payload);
  const fields = renderAnkiFields(templates, context, {});
  const fieldNames = await ankiConfiguredFieldNames(prefs);
  const duplicates = await ankiFindDuplicateNotes(prefs, fields, fieldNames);
  if (duplicates.length) {
    return { ok: true, state: "duplicate", duplicate: true, noteIds: duplicates, message: "Duplicate found." };
  }
  return { ok: true, state: "ready", duplicate: false, noteIds: [], message: "Ready to add." };
}
function postAnkiCardState(requestId, payload) {
  postToOverlay("anki-card-state", Object.assign({ requestId: String(requestId || "") }, payload || {}));
}
function handleBridgeAnkiCardStatus(payload) {
  const requestId = payload && payload.requestId !== undefined ? String(payload.requestId) : "";
  (async () => {
    try {
      const status = await ankiCardStatusForContext(payload);
      postAnkiCardState(requestId, status);
    } catch (error) {
      postAnkiCardState(requestId, { ok: false, state: "error", message: compactError(error) });
    }
  })();
}
function handleBridgeAnkiCardOpen(payload) {
  const requestId = payload && payload.requestId !== undefined ? String(payload.requestId) : "";
  (async () => {
    try {
      const ids = payload && Array.isArray(payload.noteIds) ? payload.noteIds : [];
      let query = ids.length ? ("nid:" + String(ids[0])) : "";
      if (!query) {
        const prefs = ankiActiveProfilePreferences();
        const templates = ankiFieldTemplatesFromPrefs(prefs);
        const context = ankiCardContextFromPayload(payload);
        const fields = renderAnkiFields(templates, context, {});
        const fieldNames = await ankiConfiguredFieldNames(prefs);
        query = ankiDuplicateQuery(prefs, fields, fieldNames);
      }
      if (!query) throw new Error("No duplicate note query is available.");
      await ankiConnectInvoke("guiBrowse", { query }, { url: ankiActiveProfilePreferences().ankiConnectUrl, timeoutSeconds: 8 });
      postAnkiCardState(requestId, { ok: true, state: "opened", noteIds: ids, message: "Opened in Anki." });
    } catch (error) {
      postAnkiCardState(requestId, { ok: false, state: "error", message: compactError(error) });
    }
  })();
}
function handleBridgeAnkiCardAdd(payload) {
  const requestId = payload && payload.requestId !== undefined ? String(payload.requestId) : "";
  (async () => {
    try {
      const prefs = ankiActiveProfilePreferences();
      if (!ankiProfileConfigured(prefs)) throw new Error("Anki export is not configured.");
      const templates = ankiFieldTemplatesFromPrefs(prefs);
      const context = ankiCardContextFromPayload(payload);
      let fields = renderAnkiFields(templates, context, {});
      let duplicates = [];
      if (prefs.ankiDuplicateCheck) {
        const fieldNames = await ankiConfiguredFieldNames(prefs);
        duplicates = await ankiFindDuplicateNotes(prefs, fields, fieldNames);
      }
      if (duplicates.length && prefs.ankiDuplicateMode !== "allow") {
        postAnkiCardState(requestId, { ok: true, state: "duplicate", duplicate: true, noteIds: duplicates, message: "Duplicate found." });
        return;
      }
      const needs = ankiTemplatesNeedMedia(templates);
      const media = await ankiCaptureNeededMedia(needs, context, prefs);
      fields = renderAnkiFields(templates, context, media);
      const note = {
        deckName: prefs.ankiDeckName,
        modelName: prefs.ankiModelName,
        fields,
        options: ankiDuplicateOptions(prefs),
        tags: ankiNoteTags(prefs)
      };
      const noteId = await ankiConnectInvoke("addNote", { note }, { url: prefs.ankiConnectUrl, timeoutSeconds: 20 });
      postAnkiCardState(requestId, { ok: true, state: "added", noteId, message: "Added Anki card." });
    } catch (error) {
      postAnkiCardState(requestId, { ok: false, state: "error", message: compactError(error) });
    }
  })();
}
