let ankiManagerStateCache = null;
let ankiManagerRefreshInFlight = false;
let ankiManagerRefreshSerial = 0;
let ankiModelFieldCache = Object.create(null);
let ankiActiveBridgeRequests = Object.create(null);

const ANKI_CONNECT_VERSION = 6;
const ANKI_MEDIA_MAX_AUDIO_SECONDS = 35;
const ANKI_MEDIA_DOCUMENT_STEM_MAX_LENGTH = 14;

function ankiActiveProfilePreferences(overrides) {
  const manifest = readManifest();
  const profile = activeDictionaryProfile(manifest);
  return normalizeProfilePreferences(
    Object.assign({}, profile.preferences || {}, overrides || {}),
  );
}
function ankiFieldTemplatesFromPrefs(prefs) {
  return normalizeAnkiFieldTemplates(prefs && prefs.ankiFieldTemplatesJson);
}
function ankiProfileConfigured(prefs) {
  const templates = ankiFieldTemplatesFromPrefs(prefs || {});
  const hasTemplate = Object.keys(templates).some((field) =>
    String(templates[field] || "").trim(),
  );
  return !!(
    prefs &&
    prefs.ankiEnabled &&
    prefs.ankiConnectUrl &&
    prefs.ankiDeckName &&
    prefs.ankiModelName &&
    hasTemplate
  );
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
    modelName: prefs.ankiModelName,
  };
}
function dictionaryManagerAnkiState(profilePreferences) {
  const prefs = normalizeProfilePreferences(
    profilePreferences || ankiActiveProfilePreferences(),
  );
  const cached = ankiManagerStateCache || {};
  const fields =
    Array.isArray(cached.fields) && cached.modelName === prefs.ankiModelName
      ? cached.fields.slice()
      : [];
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
    modelNames: Array.isArray(cached.modelNames)
      ? cached.modelNames.slice()
      : [],
    fields,
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
    { marker: "{audio}", label: "Word audio or subtitle audio" },
  ];
  if (lang === "ja") {
    markers.push(
      { marker: "{pitch-accent-positions}", label: "Pitch positions" },
      { marker: "{pitch-accent-categories}", label: "Pitch categories" },
    );
  }
  return markers;
}
function ankiFieldCacheKey(prefs) {
  return (
    String((prefs && prefs.ankiConnectUrl) || "") +
    "\n" +
    String((prefs && prefs.ankiModelName) || "")
  );
}
function safeAnkiConnectUrl(rawUrl) {
  const value = normalizeAnkiConnectUrl(rawUrl);
  try {
    if (typeof safeExternalHttpUrl === "function")
      return safeExternalHttpUrl(value);
  } catch (_) {}
  return /^https?:\/\/[^\s<>"']+$/i.test(value) ? value : "";
}
function ankiRequestPath() {
  return dataPath(
    "anki-connect-request-" +
      String(Date.now()) +
      "-" +
      String(Math.random()).slice(2) +
      ".json",
  );
}
async function ankiConnectInvoke(action, params, options) {
  const opts = options || {};
  const url = safeAnkiConnectUrl(
    opts.url || ankiActiveProfilePreferences().ankiConnectUrl,
  );
  if (!url) throw new Error("Invalid AnkiConnect URL.");
  const payload = {
    action: String(action || ""),
    version: ANKI_CONNECT_VERSION,
    params: params || {},
  };
  const requestPath = ankiRequestPath();
  file.write(requestPath, JSON.stringify(payload));
  const timeout = Math.max(
    1,
    Math.min(60, Number(opts.timeoutSeconds || 8) || 8),
  );
  let result = null;
  try {
    result = await utils.exec(
      "/usr/bin/curl",
      [
        "--silent",
        "--show-error",
        "--location",
        "--max-time",
        String(timeout),
        "--header",
        "Content-Type: application/json",
        "--data-binary",
        "@" + requestPath,
        url,
      ],
      dataRoot(),
    );
  } finally {
    try {
      await utils.exec("/bin/rm", ["-f", requestPath], dataRoot());
    } catch (_) {}
  }
  if (!result || result.status !== 0) {
    throw new Error(
      "AnkiConnect request failed: " +
        String(
          (result && (result.stderr || result.stdout)) || "curl failed",
        ).slice(0, 500),
    );
  }
  let parsed = null;
  try {
    parsed = JSON.parse(String(result.stdout || ""));
  } catch (error) {
    throw new Error(
      "AnkiConnect returned invalid JSON: " + compactError(error),
    );
  }
  if (parsed && parsed.error) throw new Error(String(parsed.error));
  return parsed ? parsed.result : null;
}
function postDictionaryManagerAnkiState() {
  try {
    postToDictionaryManager(
      "dictionary-manager-anki-state",
      dictionaryManagerAnkiState(),
    );
  } catch (error) {
    debugWarn("could not build Anki manager state: " + compactError(error));
  }
}
function refreshDictionaryManagerAnkiState(overrides) {
  const serial = ++ankiManagerRefreshSerial;
  const prefs = ankiActiveProfilePreferences(overrides || {});
  ankiManagerRefreshInFlight = true;
  ankiManagerStateCache = Object.assign({}, ankiManagerStateCache || {}, {
    reachable: false,
    message: "Checking AnkiConnect...",
    checkedAt: Date.now(),
    modelName: prefs.ankiModelName,
  });
  postDictionaryManagerAnkiState();
  (async () => {
    try {
      const invokeOptions = { url: prefs.ankiConnectUrl, timeoutSeconds: 4 };
      const version = await ankiConnectInvoke("version", {}, invokeOptions);
      const deckNames = await ankiConnectInvoke("deckNames", {}, invokeOptions);
      const modelNames = await ankiConnectInvoke(
        "modelNames",
        {},
        invokeOptions,
      );
      let fields = [];
      if (
        prefs.ankiModelName &&
        Array.isArray(modelNames) &&
        modelNames.indexOf(prefs.ankiModelName) >= 0
      ) {
        fields = await ankiConnectInvoke(
          "modelFieldNames",
          { modelName: prefs.ankiModelName },
          invokeOptions,
        );
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
        modelName: prefs.ankiModelName,
      };
      ankiModelFieldCache[ankiFieldCacheKey(prefs)] =
        ankiManagerStateCache.fields.slice();
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
        modelName: prefs.ankiModelName,
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
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}
function ankiCompareKey(value) {
  const raw = ankiNormalizeWhitespace(value).toLowerCase();
  try {
    return raw.normalize("NFKC");
  } catch (_) {
    return raw;
  }
}
function ankiToArray(value) {
  return Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
}
function ankiParseGlossaryJson(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || (text.charAt(0) !== "[" && text.charAt(0) !== "{")) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}
function ankiAttr(value) {
  return ankiEscapeHtml(value);
}
function ankiYomitanEscapeExpression(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function ankiYomitanMultilineHtml(value) {
  return ankiYomitanEscapeExpression(value).replace(/\n/g, "<br>");
}
function ankiDataMap(node) {
  return node &&
    typeof node === "object" &&
    node.data &&
    typeof node.data === "object"
    ? node.data
    : {};
}
function ankiNodeKind(node) {
  const data = ankiDataMap(node);
  return String(
    data.content ||
      data["data-content"] ||
      (node && node.dataContent) ||
      (node && node.kind) ||
      "",
  );
}
function ankiNodeTitle(node) {
  const data = ankiDataMap(node);
  const attrs =
    node && (node.attributes || node.attrs)
      ? node.attributes || node.attrs
      : {};
  return String((node && node.title) || data.title || attrs.title || "");
}
function ankiNodeHref(node) {
  const data = ankiDataMap(node);
  const attrs =
    node && (node.attributes || node.attrs)
      ? node.attributes || node.attrs
      : {};
  return String(
    (node && (node.href || node.url)) ||
      data.href ||
      data.url ||
      attrs.href ||
      attrs.url ||
      "",
  );
}
function ankiSafeHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\/[^\s<>"']+$/i.test(raw)) return raw;
  return "";
}
function ankiKebabCssName(value) {
  return String(value || "")
    .replace(/[A-Z]/g, (ch) => "-" + ch.toLowerCase())
    .replace(/[^a-z0-9-]/gi, "")
    .replace(/^-+|-+$/g, "");
}
const ANKI_STRUCTURED_STYLE_PROPS = {
  fontStyle: true,
  fontWeight: true,
  fontSize: true,
  color: true,
  background: true,
  backgroundColor: true,
  textDecorationLine: true,
  textDecorationStyle: true,
  textDecorationColor: true,
  borderColor: true,
  borderStyle: true,
  borderRadius: true,
  borderWidth: true,
  clipPath: true,
  verticalAlign: true,
  textAlign: true,
  textEmphasis: true,
  textShadow: true,
  margin: true,
  marginTop: true,
  marginLeft: true,
  marginRight: true,
  marginBottom: true,
  padding: true,
  paddingTop: true,
  paddingLeft: true,
  paddingRight: true,
  paddingBottom: true,
  wordBreak: true,
  whiteSpace: true,
  cursor: true,
  listStyleType: true,
};
function ankiStyleText(style) {
  if (typeof style !== "object" || Array.isArray(style)) return "";
  const parts = [];
  Object.keys(style).forEach((key) => {
    if (!ANKI_STRUCTURED_STYLE_PROPS[key]) return;
    const name = ankiKebabCssName(key);
    let value = style[key];
    if (
      (key === "marginTop" ||
        key === "marginLeft" ||
        key === "marginRight" ||
        key === "marginBottom") &&
      typeof value === "number"
    )
      value = String(value) + "em";
    else if (key === "textDecorationLine" && Array.isArray(value))
      value = value.join(" ");
    value = String(value === undefined || value === null ? "" : value).trim();
    if (
      !name ||
      !value ||
      /[<>"']/.test(value) ||
      /javascript\s*:|expression\s*\(/i.test(value)
    )
      return;
    parts.push(name + ": " + value);
  });
  return parts.join("; ");
}
function ankiStructuredDataAttributes(node) {
  const attrs = [];
  const data = ankiDataMap(node);
  Object.keys(data).forEach((key) => {
    const name = ankiKebabCssName(key);
    if (!name) return;
    const value = data[key];
    if (value === undefined || value === null || typeof value === "object")
      return;
    attrs.push("data-sc-" + name + '="' + ankiAttr(value).slice(0, 2000) + '"');
  });
  return attrs;
}
function ankiCommonAttributes(node, options) {
  const opts = options || {};
  const attrs = [];
  const cls = opts.className !== undefined ? String(opts.className || "") : "";
  if (cls && !/[\0<>"']/.test(cls))
    attrs.push('class="' + ankiAttr(cls).slice(0, 500) + '"');
  if (node && node.lang && /^[a-z0-9-]+$/i.test(String(node.lang)))
    attrs.push('lang="' + ankiAttr(node.lang) + '"');
  const title = ankiNodeTitle(node);
  if (title) attrs.push('title="' + ankiAttr(title).slice(0, 1000) + '"');
  ankiStructuredDataAttributes(node).forEach((attr) => attrs.push(attr));
  const style = ankiStyleText(node && node.style);
  if (style) attrs.push('style="' + ankiAttr(style) + '"');
  if (opts.extraAttrs)
    opts.extraAttrs.forEach((attr) => {
      if (attr) attrs.push(attr);
    });
  return attrs.length ? " " + attrs.join(" ") : "";
}
const ANKI_STRUCTURED_TAGS = {
  a: true,
  br: true,
  details: true,
  div: true,
  img: true,
  li: true,
  ol: true,
  rp: true,
  rt: true,
  ruby: true,
  span: true,
  summary: true,
  table: true,
  tbody: true,
  td: true,
  tfoot: true,
  th: true,
  thead: true,
  tr: true,
  ul: true,
};
const ANKI_VOID_TAGS = { br: true, img: true };
function ankiSafeTagName(value) {
  const tag = String(value || "")
    .trim()
    .toLowerCase();
  return ANKI_STRUCTURED_TAGS[tag] ? tag : "";
}
function ankiImageSrc(node) {
  const data = ankiDataMap(node);
  const attrs =
    node && (node.attributes || node.attrs)
      ? node.attributes || node.attrs
      : {};
  const src = String(
    (node && (node.src || node.path)) ||
      data.src ||
      data.path ||
      attrs.src ||
      "",
  );
  if (
    /^(?:https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)[^\s<>"']+$/i.test(
      src,
    )
  )
    return src;
  return "";
}
function ankiGlossaryContentList(value) {
  const parsed = ankiParseGlossaryJson(value);
  const content = parsed !== null ? parsed : value;
  if (Array.isArray(content)) return content;
  if (content === undefined || content === null) return [];
  return [content];
}
function ankiStructuredContentPieces(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}
function ankiStructuredText(value) {
  if (value === undefined || value === null) return "";
  const parsed = ankiParseGlossaryJson(value);
  if (parsed !== null) return ankiStructuredText(parsed);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  if (Array.isArray(value)) {
    const allPrimitive = value.every(
      (item) =>
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    );
    return value
      .map(ankiStructuredText)
      .filter(Boolean)
      .join(allPrimitive ? "; " : "");
  }
  if (typeof value !== "object") return "";
  if (ankiNodeKind(value) === "attribution") return "";
  if (value.type === "structured-content")
    return ankiStructuredText(value.content);
  if (value.type === "text") return ankiStructuredText(value.text);
  if (value.type === "image") return "";
  const tag = String(value.tag || "").toLowerCase();
  const kind = ankiNodeKind(value);
  if (tag === "rp") return "";
  if (tag === "br") return "\n";
  if (tag === "ruby") {
    return ankiToArray(value.content)
      .map((part) => {
        if (
          part &&
          typeof part === "object" &&
          String(part.tag || "").toLowerCase() === "rt"
        ) {
          const text = ankiStructuredText(part.content);
          return text ? "[" + text + "]" : "";
        }
        return ankiStructuredText(part);
      })
      .join("");
  }
  if (tag === "ul" || tag === "ol") {
    return ankiToArray(value.content)
      .map(ankiStructuredText)
      .filter(Boolean)
      .join("\n");
  }
  if (
    /^(div|details|summary|table|thead|tbody|tfoot|tr|th|td|li)$/i.test(tag)
  ) {
    return ankiToArray(value.content)
      .map(ankiStructuredText)
      .filter(Boolean)
      .join(tag === "li" ? "" : "\n");
  }
  if (
    kind === "part-of-speech-info" ||
    kind === "tag" ||
    kind === "misc-info"
  ) {
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
  if (parsed !== null)
    return ankiGlossaryContentList(parsed)
      .map(ankiFormatGlossaryPlainText)
      .filter(Boolean)
      .join("\n");
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return ankiNormalizeWhitespace(value);
  if (Array.isArray(value))
    return value.map(ankiFormatGlossaryPlainText).filter(Boolean).join("\n");
  if (typeof value === "object") {
    if (
      value.type === "structured-content" ||
      value.tag ||
      value.type === "text" ||
      value.type === "image"
    )
      return ankiFormatGlossaryPlainText(value);
    if (value.content !== undefined) return ankiPlainText(value.content);
    if (value.text !== undefined) return ankiPlainText(value.text);
    if (value.glossary !== undefined) return ankiPlainText(value.glossary);
    return Object.keys(value)
      .map((key) => ankiPlainText(value[key]))
      .filter(Boolean)
      .join("; ");
  }
  return "";
}
function ankiStructuredHtml(value, dictionary) {
  if (value === undefined || value === null) return "";
  const parsed = ankiParseGlossaryJson(value);
  if (parsed !== null) return ankiStructuredHtml(parsed, dictionary);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return ankiYomitanMultilineHtml(value);
  if (Array.isArray(value))
    return value
      .map((item) => ankiStructuredHtml(item, dictionary))
      .filter(Boolean)
      .join("");
  if (typeof value !== "object") return "";
  if (ankiNodeKind(value) === "attribution") return "";
  if (value.type === "structured-content")
    return ankiStructuredContentHtml(value.content, dictionary);
  if (value.type === "text") return ankiYomitanMultilineHtml(value.text);
  if (value.type === "image") return ankiFormatGlossaryImage(value, dictionary);
  const tag = ankiSafeTagName(value.tag);
  if (!tag)
    return ankiStructuredHtml(
      value.content !== undefined ? value.content : value.text,
      dictionary,
    );
  if (tag === "a") {
    const body =
      '<span class="gloss-link-text">' +
      (ankiStructuredHtml(value.content, dictionary) ||
        ankiYomitanEscapeExpression(ankiNodeHref(value))) +
      "</span>";
    const rawHref = ankiNodeHref(value);
    const href =
      rawHref && rawHref.charAt(0) === "?" ? "#" : ankiSafeHref(rawHref);
    const icon =
      href && href !== "#"
        ? '<span class="gloss-link-external-icon icon"></span>'
        : "";
    return href
      ? '<a class="gloss-link" href="' +
          ankiAttr(href) +
          '">' +
          body +
          icon +
          "</a>"
      : '<span class="gloss-link">' + body + "</span>";
  }
  if (tag === "img") {
    return ankiFormatGlossaryImage(value, dictionary);
  }
  let extraAttrs = [];
  if ((tag === "td" || tag === "th") && Number.isFinite(Number(value.colSpan)))
    extraAttrs.push('colspan="' + ankiAttr(Number(value.colSpan)) + '"');
  if ((tag === "td" || tag === "th") && Number.isFinite(Number(value.rowSpan)))
    extraAttrs.push('rowspan="' + ankiAttr(Number(value.rowSpan)) + '"');
  if (tag === "details" && value.open === true) extraAttrs.push("open");
  const body = ANKI_VOID_TAGS[tag]
    ? ""
    : ankiStructuredHtml(value.content, dictionary);
  const className = "gloss-sc-" + tag;
  const attrs = ankiCommonAttributes(value, { className, extraAttrs });
  const element = ANKI_VOID_TAGS[tag]
    ? "<" + tag + attrs + ">"
    : "<" + tag + attrs + ">" + body + "</" + tag + ">";
  return tag === "table"
    ? '<div class="gloss-sc-table-container">' + element + "</div>"
    : element;
}
function ankiStructuredContentHtml(value, dictionary) {
  return (
    '<span class="structured-content">' +
    ankiStructuredContentPieces(value)
      .map((item) => ankiStructuredHtml(item, dictionary))
      .join("") +
    "</span>"
  );
}
function ankiFormatGlossaryImage(value, dictionary) {
  const src = ankiImageSrc(value);
  const path = String((value && value.path) || "");
  const alt = ankiPlainText(value && (value.alt || value.title || ""));
  if (src)
    return (
      '<img class="gloss-image" src="' +
      ankiAttr(src) +
      '"' +
      (alt ? ' alt="' + ankiAttr(alt) + '"' : "") +
      ">"
    );
  if (path) {
    const label = alt || path.split("/").filter(Boolean).pop() || "Image";
    return (
      '<a class="gloss-image-link" data-sc-dictionary="' +
      ankiAttr(dictionary || "") +
      '" data-sc-path="' +
      ankiAttr(path) +
      '">' +
      ankiYomitanEscapeExpression(label) +
      "</a>"
    );
  }
  return alt ? ankiYomitanEscapeExpression(alt) : "";
}
function ankiFormatGlossaryContent(value, dictionary) {
  if (value === undefined || value === null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return ankiYomitanMultilineHtml(value);
  if (Array.isArray(value))
    return value
      .map((item) => ankiFormatGlossaryContent(item, dictionary))
      .join("");
  if (typeof value !== "object") return "";
  if (value.type === "structured-content")
    return ankiStructuredContentHtml(value.content, dictionary);
  if (value.type === "text") return ankiYomitanMultilineHtml(value.text);
  if (value.type === "image") return ankiFormatGlossaryImage(value, dictionary);
  if (value.tag) return ankiStructuredContentHtml(value, dictionary);
  if (value.content !== undefined)
    return ankiFormatGlossaryContent(value.content, dictionary);
  if (value.text !== undefined)
    return ankiFormatGlossaryContent(value.text, dictionary);
  if (value.glossary !== undefined)
    return ankiFormatGlossaryContent(value.glossary, dictionary);
  return "";
}
function ankiExtractGlossaryStructuredContent(value) {
  const out = [];
  ankiStructuredContentPieces(value).forEach((item) => {
    if (Array.isArray(item)) {
      out.push.apply(out, ankiExtractGlossaryStructuredContent(item));
    } else if (item && typeof item === "object") {
      if (ankiNodeKind(item) === "glossary") {
        out.push(item);
      } else if (item.content !== undefined) {
        out.push.apply(out, ankiExtractGlossaryStructuredContent(item.content));
      }
    }
  });
  return out;
}
function ankiConvertGlossaryStructuredContent(value) {
  const out = [];
  ankiStructuredContentPieces(value).forEach((item) => {
    if (
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean"
    ) {
      out.push(String(item));
    } else if (Array.isArray(item)) {
      out.push.apply(out, ankiConvertGlossaryStructuredContent(item));
    } else if (item && typeof item === "object" && item.content !== undefined) {
      if (String(item.tag || "").toLowerCase() === "ruby")
        out.push(ankiStructuredText(item));
      else
        out.push.apply(out, ankiConvertGlossaryStructuredContent(item.content));
    }
  });
  return out;
}
function ankiFormatGlossaryPlainText(value) {
  if (value === undefined || value === null) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  if (Array.isArray(value))
    return value.map(ankiFormatGlossaryPlainText).filter(Boolean).join("\n");
  if (typeof value !== "object") return "";
  if (value.type === "image") return "";
  if (value.type === "text") return String(value.text || "");
  if (value.type === "structured-content") {
    const glossaryContent = ankiExtractGlossaryStructuredContent(value.content);
    const extracted = glossaryContent.length
      ? ankiConvertGlossaryStructuredContent(glossaryContent)
      : [ankiStructuredText(value.content)];
    return extracted.filter(Boolean).join("\n");
  }
  if (value.tag) return ankiStructuredText(value);
  if (value.content !== undefined)
    return ankiFormatGlossaryPlainText(value.content);
  if (value.text !== undefined) return ankiFormatGlossaryPlainText(value.text);
  if (value.glossary !== undefined)
    return ankiFormatGlossaryPlainText(value.glossary);
  return "";
}
function ankiGlossaryItems(entry) {
  const term = entry && entry.term ? entry.term : {};
  return Array.isArray(term.glossaries) ? term.glossaries : [];
}
function ankiGlossaryPlain(entry) {
  return ankiGlossaryItems(entry)
    .map((item) => {
      return ankiGlossaryContentList(item && item.glossary)
        .map(ankiFormatGlossaryPlainText)
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");
}
function ankiTagLabels(raw) {
  const labels = [];
  if (Array.isArray(raw)) {
    raw.forEach((tag) => {
      const text = ankiNormalizeWhitespace(
        tag && typeof tag === "object" ? tag.name : tag,
      );
      if (text) labels.push(text);
    });
  } else if (raw) {
    String(raw)
      .split(/[,;]\s*|\s{2,}/)
      .forEach((tag) => {
        const text = ankiNormalizeWhitespace(tag);
        if (text) labels.push(text);
      });
  }
  return labels;
}
function ankiGlossaryMetaLabel(item) {
  const dict = ankiNormalizeWhitespace(item && item.dict);
  const bits = [];
  ankiTagLabels(item && item.definitionTags).forEach((label) =>
    bits.push(label),
  );
  if (dict) bits.push(dict);
  return bits.filter(Boolean).join(", ");
}
function ankiGlossarySingleHtml(item, options) {
  const opts = options || {};
  const dict = ankiNormalizeWhitespace(item && item.dict);
  const contents = ankiGlossaryContentList(item && item.glossary);
  const bodyItems = contents
    .map((content) => ankiFormatGlossaryContent(content, dict))
    .filter(Boolean);
  if (!dict && !bodyItems.length) return "";
  const meta = opts.brief ? "" : ankiGlossaryMetaLabel(item);
  let body = "";
  if (bodyItems.length <= 1) {
    body = bodyItems.join("");
  } else {
    body =
      "<ul>" +
      bodyItems.map((html) => "<li>" + html + "</li>").join("") +
      "</ul>";
  }
  return (
    (meta ? "<i>(" + ankiYomitanEscapeExpression(meta) + ")</i> " : "") + body
  );
}
function ankiGlossaryEntryHtml(item) {
  const dict = ankiNormalizeWhitespace(item && item.dict);
  const body = ankiGlossarySingleHtml(item);
  if (!dict && !body) return "";
  return (
    "<li" +
    (dict ? ' data-dictionary="' + ankiAttr(dict) + '"' : "") +
    ">" +
    body +
    "</li>"
  );
}
function ankiGlossaryHtml(entry) {
  const glossaryItems = ankiGlossaryItems(entry);
  const items = glossaryItems.map(ankiGlossaryEntryHtml).filter(Boolean);
  if (!items.length) return "";
  const body =
    glossaryItems.length === 1
      ? ankiGlossarySingleHtml(glossaryItems[0])
      : "<ol>" + items.join("") + "</ol>";
  return (
    '<div style="text-align: left;" class="yomitan-glossary">' + body + "</div>"
  );
}
function ankiFirstGlossary(entry) {
  const items = ankiGlossaryItems(entry);
  return items.length ? ankiPlainText(items[0] && items[0].glossary) : "";
}
function ankiFirstGlossaryHtml(entry) {
  const first = ankiGlossaryItems(entry)[0];
  const item = first ? ankiGlossarySingleHtml(first) : "";
  return item
    ? '<div style="text-align: left;" class="yomitan-glossary">' +
        item +
        "</div>"
    : "";
}
function ankiDictionaryNames(entry) {
  const seen = Object.create(null);
  const out = [];
  ankiGlossaryItems(entry).forEach((item) => {
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
  ankiGlossaryItems(entry).forEach((item) => {
    ["definitionTags", "termTags", "tags"].forEach((key) => {
      const raw = item && item[key];
      if (Array.isArray(raw))
        raw.forEach((tag) => out.push(ankiNormalizeWhitespace(tag)));
      else if (raw)
        String(raw)
          .split(/[,;]\s*|\s{2,}/)
          .forEach((tag) => out.push(ankiNormalizeWhitespace(tag)));
    });
  });
  return out.filter(Boolean).join(", ");
}
function ankiPartOfSpeech(entry) {
  const bits = [];
  ankiGlossaryItems(entry).forEach((item) => {
    ["partOfSpeech", "part_of_speech", "partOfSpeechInfo"].forEach((key) => {
      const text = ankiNormalizeWhitespace(item && item[key]);
      if (text) bits.push(text);
    });
  });
  return bits.filter(Boolean).join(", ");
}
function ankiFormatFrequencies(term) {
  const rows = Array.isArray(term && term.frequencies) ? term.frequencies : [];
  const out = [];
  rows.forEach((row) => {
    const dict = ankiNormalizeWhitespace(
      row && (row.dict || row.dictName || row.dictionary),
    );
    const values = Array.isArray(row && row.frequencies) ? row.frequencies : [];
    const display = values
      .map((value) =>
        ankiNormalizeWhitespace(
          (value && (value.displayValue || value.display_value)) ||
            (value && value.value !== undefined ? String(value.value) : ""),
        ),
      )
      .filter(Boolean)
      .join(", ");
    if (dict || display)
      out.push((dict || "Frequency") + (display ? " " + display : ""));
  });
  return out.join("; ");
}
function ankiFrequencyHarmonicRank(term) {
  const values = [];
  const rows = Array.isArray(term && term.frequencies) ? term.frequencies : [];
  rows.forEach((row) => {
    const freqs = Array.isArray(row && row.frequencies) ? row.frequencies : [];
    freqs.forEach((item) => {
      const value = Number(item && item.value);
      if (Number.isFinite(value) && value > 0) values.push(value);
    });
  });
  if (!values.length) return "";
  const denom = values.reduce((sum, value) => sum + 1 / value, 0);
  if (!denom) return "";
  return String(Math.round(values.length / denom));
}
function ankiPitchPositions(term) {
  const out = [];
  const rows = Array.isArray(term && term.pitches) ? term.pitches : [];
  rows.forEach((row) => {
    const positions = Array.isArray(row && row.positions)
      ? row.positions
      : Array.isArray(row && row.pitchPositions)
        ? row.pitchPositions
        : [];
    positions.forEach((pos) => out.push(String(pos)));
  });
  return out.join(", ");
}
function ankiPitchCategories(term) {
  const positions = ankiPitchPositions(term)
    .split(/,\s*/)
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
  if (!positions.length) return "";
  return positions
    .map((pos) => (pos === 0 ? "heiban" : pos === 1 ? "atamadaka" : "nakadaka"))
    .join(", ");
}
function ankiPhoneticTranscriptions(term) {
  const out = [];
  const pitches = Array.isArray(term && term.pitches) ? term.pitches : [];
  pitches.forEach((row) => {
    const values = Array.isArray(row && row.transcriptions)
      ? row.transcriptions
      : [];
    values.forEach((value) => {
      const text = ankiNormalizeWhitespace(value);
      if (text) out.push(text);
    });
  });
  return out.join(", ");
}
function ankiDisplayHeadword(entry) {
  const term = entry && entry.term ? entry.term : {};
  return String(
    term.expression ||
      (entry && entry.deinflected) ||
      (entry && entry.matched) ||
      "",
  );
}
function ankiDisplayReading(entry, expression) {
  const term = entry && entry.term ? entry.term : {};
  const reading = ankiNormalizeWhitespace(term.reading || "");
  if (
    !reading ||
    (expression && ankiCompareKey(reading) === ankiCompareKey(expression))
  )
    return "";
  return reading;
}
function ankiLookupSurface(context, entry) {
  const candidate =
    context && context.result && context.result.candidateUsed
      ? context.result.candidateUsed
      : null;
  if (context && context.surface) return String(context.surface);
  if (entry && entry.matched) return String(entry.matched);
  if (candidate && candidate.displayText) return String(candidate.displayText);
  const result = context && context.result ? context.result : {};
  const text = String(result.text || context.sentence || lastSubtitle || "");
  const start = Number(result.lookupStart);
  const end = Number(result.lookupEnd);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start)
    return Array.from(text).slice(start, end).join("");
  if (result.lookupText) return String(result.lookupText);
  return "";
}
function ankiMediaTitleFromMpv() {
  const props = [
    "media-title",
    "metadata/by-key/title",
    "metadata/by-key/Title",
    "filename/no-ext",
    "filename",
  ];
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
  return (
    (h > 0 ? String(h) + ":" + String(m).padStart(2, "0") : String(m)) +
    ":" +
    String(s).padStart(2, "0")
  );
}
function ankiFuriganaPlain(expression, reading) {
  return reading
    ? String(expression || "") + "[" + String(reading || "") + "]"
    : String(expression || "");
}
function ankiFuriganaHtml(expression, reading) {
  return reading
    ? "<ruby>" +
        ankiEscapeHtml(expression) +
        "<rt>" +
        ankiEscapeHtml(reading) +
        "</rt></ruby>"
    : ankiEscapeHtml(expression);
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
    suffix: chars.slice(end).join(""),
  };
}
function ankiCardContextFromPayload(payload) {
  const raw =
    payload && payload.context && typeof payload.context === "object"
      ? payload.context
      : {};
  const entry = raw.entry && typeof raw.entry === "object" ? raw.entry : {};
  const term = entry.term || {};
  const expression = ankiNormalizeWhitespace(
    raw.expression || raw.heading || ankiDisplayHeadword(entry),
  );
  const reading = ankiNormalizeWhitespace(
    raw.reading || ankiDisplayReading(entry, expression),
  );
  const sentence = String(
    raw.sentence || (raw.result && raw.result.text) || lastSubtitle || "",
  );
  const surface = ankiNormalizeWhitespace(
    raw.surface || ankiLookupSurface(raw, entry) || expression,
  );
  const position = Number(
    raw.position !== undefined
      ? raw.position
      : payload && payload.position !== undefined
        ? payload.position
        : raw.result && raw.result.lookupStart,
  );
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
    glossaryFirstHtml: selectedGlossaryHtml,
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
    audioReading: reading,
  };
}
function extractAnkiMarkersFromTemplates(templates) {
  const out = Object.create(null);
  Object.keys(templates || {}).forEach((field) => {
    const text = String(templates[field] || "");
    text.replace(/\{([^{}]+)\}/g, (_match, key) => {
      out[
        String(key || "")
          .trim()
          .toLowerCase()
      ] = true;
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
    wordAudio: !!markers.audio,
  };
}
function ankiMarkerValue(marker, context, media) {
  const key = String(marker || "")
    .trim()
    .toLowerCase();
  if (key === "expression" || key === "word")
    return ankiEscapeHtml(context.expression);
  if (key === "reading") return ankiEscapeHtml(context.reading);
  if (key === "furigana-plain")
    return ankiEscapeHtml(
      ankiFuriganaPlain(context.expression, context.reading),
    );
  if (key === "furigana")
    return ankiFuriganaHtml(context.expression, context.reading);
  if (key === "popup-selection-text") return ankiEscapeHtml(context.surface);
  if (key === "sentence") return ankiEscapeHtml(context.sentence);
  if (key === "cloze-prefix") return ankiEscapeHtml(context.clozePrefix);
  if (key === "cloze-body") return ankiEscapeHtml(context.clozeBody);
  if (key === "cloze-suffix") return ankiEscapeHtml(context.clozeSuffix);
  if (key === "glossary") return context.glossary;
  if (key === "glossary-plain") return ankiEscapeHtml(context.glossaryPlain);
  if (key === "glossary-first")
    return context.glossaryFirstHtml || ankiEscapeHtml(context.glossaryFirst);
  if (key === "selected-glossary")
    return (
      context.selectedGlossaryHtml ||
      ankiEscapeHtml(context.selectedGlossary || context.glossaryFirst)
    );
  if (key === "dictionary" || key === "dictionary-alias")
    return ankiEscapeHtml(context.dictionary);
  if (key === "part-of-speech") return ankiEscapeHtml(context.partOfSpeech);
  if (key === "tags") return ankiEscapeHtml(context.tags);
  if (key === "frequencies") return ankiEscapeHtml(context.frequencies);
  if (key === "frequency-harmonic-rank")
    return ankiEscapeHtml(context.frequencyHarmonicRank);
  if (key === "pitch-accent-positions")
    return ankiEscapeHtml(context.pitchAccentPositions);
  if (key === "pitch-accent-categories")
    return ankiEscapeHtml(context.pitchAccentCategories);
  if (key === "phonetic-transcriptions")
    return ankiEscapeHtml(context.phoneticTranscriptions);
  if (key === "document-title") return ankiEscapeHtml(context.documentTitle);
  if (key === "source-path") return ankiEscapeHtml(context.sourcePath);
  if (key === "timestamp") return ankiEscapeHtml(context.timestamp);
  if (key === "screenshot" || key === "image")
    return media && media.screenshot
      ? '<img src="' + ankiEscapeHtml(media.screenshot) + '">'
      : "";
  if (key === "sentence-audio" || key === "subtitle-audio")
    return media && media.sentenceAudio
      ? "[sound:" + media.sentenceAudio + "]"
      : "";
  if (key === "audio")
    return media && media.wordAudio ? "[sound:" + media.wordAudio + "]" : "";
  return "";
}
function renderAnkiTemplate(template, context, media) {
  return String(template || "").replace(/\{([^{}]+)\}/g, (_match, marker) =>
    ankiMarkerValue(marker, context, media || {}),
  );
}
function renderAnkiFields(templates, context, media) {
  const fields = {};
  Object.keys(templates || {}).forEach((field) => {
    fields[field] = renderAnkiTemplate(templates[field], context, media || {});
  });
  return fields;
}
function ankiSearchEscape(value) {
  return String(value || "").replace(/"/g, "");
}
function ankiDuplicateFieldValue(fields, firstField) {
  const map = fields && typeof fields === "object" ? fields : {};
  const name = String(firstField || "");
  if (!name) return "";
  if (Object.prototype.hasOwnProperty.call(map, name))
    return String(map[name] || "");
  const target = ankiCompareKey(name);
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i++) {
    if (ankiCompareKey(keys[i]) === target) return String(map[keys[i]] || "");
  }
  return "";
}
function ankiFirstFieldName(fields, fieldNames) {
  if (Array.isArray(fieldNames) && fieldNames.length)
    return String(fieldNames[0] || "");
  return Object.keys(fields || {})[0] || "";
}
function ankiDuplicateFields(fields, fieldNames) {
  const firstField = ankiFirstFieldName(fields, fieldNames);
  const value = firstField ? ankiDuplicateFieldValue(fields, firstField) : "";
  if (!firstField || !value) return {};
  const out = {};
  out[firstField] = value;
  return out;
}
function ankiDuplicateQuery(prefs, fields, fieldNames) {
  const deck = prefs.ankiDeckName;
  const firstField = ankiFirstFieldName(fields, fieldNames);
  const value = firstField ? ankiDuplicateFieldValue(fields, firstField) : "";
  if (!firstField || !value) return "";
  const parts = [
    '"' +
      ankiSearchEscape(firstField).toLowerCase() +
      ":" +
      ankiSearchEscape(value) +
      '"',
  ];
  if (prefs.ankiDuplicateScope === "deck" && deck)
    parts.unshift('"deck:' + ankiSearchEscape(deck) + '"');
  return parts.join(" ");
}
function ankiDuplicateCheckOptions(prefs, allowDuplicate) {
  const options = ankiDuplicateOptions(prefs);
  options.allowDuplicate = !!allowDuplicate;
  return options;
}
function ankiDuplicateCheckNote(prefs, fields, fieldNames, allowDuplicate) {
  const firstFields = ankiDuplicateFields(fields, fieldNames);
  if (!Object.keys(firstFields).length) return null;
  return {
    deckName: prefs.ankiDeckName,
    modelName: prefs.ankiModelName,
    fields: firstFields,
    options: ankiDuplicateCheckOptions(prefs, allowDuplicate),
    tags: [],
  };
}
function ankiErrorLooksDuplicate(error) {
  return /cannot create note because it is a duplicate/i.test(
    String(error || ""),
  );
}
async function ankiNoteLooksDuplicate(prefs, fields, fieldNames) {
  const blockedNote = ankiDuplicateCheckNote(prefs, fields, fieldNames, false);
  if (!blockedNote) return false;
  try {
    const result = await ankiConnectInvoke(
      "canAddNotesWithErrorDetail",
      { notes: [blockedNote] },
      { url: prefs.ankiConnectUrl, timeoutSeconds: 8 },
    );
    const first = Array.isArray(result) ? result[0] : null;
    if (first && typeof first === "object")
      return ankiErrorLooksDuplicate(first.error);
  } catch (error) {
    if (!/unsupported action/i.test(compactError(error))) throw error;
  }
  const allowedNote = ankiDuplicateCheckNote(prefs, fields, fieldNames, true);
  const results = await Promise.all([
    ankiConnectInvoke(
      "canAddNotes",
      { notes: [allowedNote || blockedNote] },
      { url: prefs.ankiConnectUrl, timeoutSeconds: 8 },
    ),
    ankiConnectInvoke(
      "canAddNotes",
      { notes: [blockedNote] },
      { url: prefs.ankiConnectUrl, timeoutSeconds: 8 },
    ),
  ]);
  const withDuplicatesAllowed = Array.isArray(results[0])
    ? !!results[0][0]
    : false;
  const noDuplicatesAllowed = Array.isArray(results[1])
    ? !!results[1][0]
    : false;
  return withDuplicatesAllowed !== noDuplicatesAllowed;
}
async function ankiFindNotesByDuplicateQuery(prefs, fields, fieldNames) {
  const query = ankiDuplicateQuery(prefs, fields, fieldNames);
  if (!query) return [];
  const result = await ankiConnectInvoke(
    "findNotes",
    { query },
    { url: prefs.ankiConnectUrl, timeoutSeconds: 8 },
  );
  return Array.isArray(result) ? result : [];
}
async function ankiFindDuplicateNotes(prefs, fields, fieldNames) {
  if (!prefs.ankiDuplicateCheck) return [];
  if (!(await ankiNoteLooksDuplicate(prefs, fields, fieldNames))) return [];
  return ankiFindNotesByDuplicateQuery(prefs, fields, fieldNames);
}
function ankiNormalizeNoteIds(noteIds) {
  const seen = Object.create(null);
  const out = [];
  ankiToArray(noteIds).forEach((id) => {
    const text = String(id === undefined || id === null ? "" : id).trim();
    if (!/^\d+$/.test(text) || seen[text]) return;
    seen[text] = true;
    out.push(text);
  });
  return out;
}
function ankiNoteIdQuery(noteIds) {
  const ids = ankiNormalizeNoteIds(noteIds);
  return ids.length ? "nid:" + ids[0] : "";
}
function ankiDisplayNoteIds(noteIds) {
  return ankiNormalizeNoteIds(noteIds).map((id) => {
    const numeric = Number(id);
    return Number.isSafeInteger(numeric) ? numeric : id;
  });
}
function ankiOpenDuplicateNotes(prefs, noteIds) {
  const query = ankiNoteIdQuery(noteIds);
  if (!query) throw new Error("No duplicate note ID is available.");
  try {
    Promise.resolve(
      ankiConnectInvoke(
        "guiBrowse",
        { query },
        { url: prefs.ankiConnectUrl, timeoutSeconds: 8 },
      ),
    ).catch((error) => {
      debugWarn(
        "Anki reveal request failed after dispatch: " + compactError(error),
      );
    });
  } catch (error) {
    debugWarn(
      "Anki reveal request failed before dispatch: " + compactError(error),
    );
  }
  return ankiDisplayNoteIds(noteIds);
}
function ankiDuplicateOptions(prefs) {
  return {
    allowDuplicate: prefs.ankiDuplicateMode === "allow",
    duplicateScope:
      prefs.ankiDuplicateScope === "collection" ? "collection" : "deck",
    duplicateScopeOptions: {
      deckName: prefs.ankiDeckName,
      checkChildren: true,
      checkAllModels: false,
    },
  };
}
function ankiNoteTags(prefs) {
  const seen = Object.create(null);
  const out = [];
  String(prefs.ankiTags || "")
    .split(/[,\s]+/)
    .forEach((tag) => {
      const clean = tag.trim();
      if (clean && !seen[clean]) {
        seen[clean] = true;
        out.push(clean);
      }
    });
  return out;
}
function ankiValidAddedNoteId(noteId) {
  return !!ankiNoteIdQuery([noteId]);
}
async function ankiStoreMediaFile(filename, path, prefs) {
  if (!filename || !path) return "";
  const stored = await ankiConnectInvoke(
    "storeMediaFile",
    {
      filename,
      path,
      deleteExisting: true,
    },
    { url: prefs.ankiConnectUrl, timeoutSeconds: 20 },
  );
  return String(stored || filename);
}
async function ankiStoreMediaUrl(filename, url, prefs) {
  if (!filename || !url) return "";
  const stored = await ankiConnectInvoke(
    "storeMediaFile",
    {
      filename,
      url,
      deleteExisting: true,
    },
    { url: prefs.ankiConnectUrl, timeoutSeconds: 20 },
  );
  return String(stored || filename);
}
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
async function ankiMediaFileHashHex(path) {
  try {
    const result = await utils.exec(
      "/usr/bin/shasum",
      ["-a", "1", path],
      dataRoot(),
    );
    const match =
      result && result.status === 0
        ? String(result.stdout || "").match(/\b([0-9a-f]{8,40})\b/i)
        : null;
    if (match) return match[1].toLowerCase().slice(0, 12);
  } catch (error) {
    debugVerbose("Anki media hash failed: " + compactError(error));
  }
  return ankiRandomHex(12);
}
function ankiMediaPath(filename) {
  return dataPath("anki-media", filename);
}
async function ensureAnkiMediaRoot() {
  await utils.exec("/bin/mkdir", ["-p", dataPath("anki-media")], dataRoot());
}
function ankiMpvGetProperty(name) {
  try {
    return mpv.getString(name);
  } catch (_) {}
  try {
    return mpv.getNumber(name);
  } catch (_) {}
  return undefined;
}
function ankiMpvSetProperty(name, value) {
  try {
    mpv.set(name, value);
    return true;
  } catch (_) {}
  try {
    mpv.command("set", [name, String(value)]);
    return true;
  } catch (_) {}
  return false;
}
async function ankiCaptureScreenshot(context, prefs) {
  await ensureAnkiMediaRoot();
  const documentName = context.documentTitle || "video";
  const tempFilename = ankiMediaFilename(
    documentName,
    ankiRandomHex(12),
    "jpg",
  );
  const path = ankiMediaPath(tempFilename);
  const quality = normalizeAnkiImageQuality(prefs && prefs.ankiImageQuality);
  const previousQuality = ankiMpvGetProperty("screenshot-jpeg-quality");
  const didSetQuality = ankiMpvSetProperty("screenshot-jpeg-quality", quality);
  try {
    try {
      mpv.command("screenshot-to-file", [path, "video"]);
    } catch (error) {
      throw new Error("Could not capture screenshot: " + compactError(error));
    }
    for (let i = 0; i < 25; i++) {
      try {
        if (file.exists(path)) {
          const filename = ankiMediaFilename(
            documentName,
            await ankiMediaFileHashHex(path),
            "jpg",
          );
          return ankiStoreMediaFile(filename, path, prefs);
        }
      } catch (_) {}
      await sleep(40);
    }
  } finally {
    if (
      didSetQuality &&
      previousQuality !== undefined &&
      previousQuality !== null &&
      previousQuality !== ""
    ) {
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
    "/Applications/IINA.app/Contents/MacOS/ffmpeg",
  ];
  for (let i = 0; i < candidates.length; i++) {
    try {
      if (file.exists(candidates[i])) return candidates[i];
    } catch (_) {}
  }
  try {
    const result = await utils.exec("/usr/bin/which", ["ffmpeg"], dataRoot());
    const path = String((result && result.stdout) || "")
      .trim()
      .split(/\r?\n/)[0];
    if (result && result.status === 0 && path) return path;
  } catch (_) {}
  return "";
}
async function ankiCaptureSentenceAudio(context, prefs) {
  const sourcePath = ankiSourcePathFromMpv();
  if (!sourcePath || /^https?:\/\//i.test(sourcePath))
    throw new Error("Sentence audio requires a local media file.");
  const ffmpegPath = await ankiFindFfmpegPath();
  if (!ffmpegPath)
    throw new Error("ffmpeg was not found for sentence audio capture.");
  const subStart = ankiSubtitleBoundary("sub-start");
  const subEnd = ankiSubtitleBoundary("sub-end");
  const current = context.timePos || ankiTimePosFromMpv();
  const padding = Math.max(
    0,
    Math.min(2, Number(prefs.ankiSentenceAudioPaddingMs || 0) / 1000),
  );
  let start = subStart !== null ? subStart : Math.max(0, current - 1.5);
  let end =
    subEnd !== null && subEnd > start
      ? subEnd
      : Math.min(start + 4, current + 2.5);
  start = Math.max(0, start - padding);
  end = Math.max(start + 0.25, end + padding);
  if (end - start > ANKI_MEDIA_MAX_AUDIO_SECONDS)
    end = start + ANKI_MEDIA_MAX_AUDIO_SECONDS;
  const duration = Math.max(0.25, end - start);
  const format = normalizeAnkiAudioFormat(prefs.ankiAudioFormat);
  const bitrate = normalizeAnkiAudioBitrateKbps(
    prefs && prefs.ankiAudioBitrateKbps,
  );
  const ext = format === "opus" ? "opus" : "mp3";
  const documentName = context.documentTitle || "video";
  const tempFilename = ankiMediaFilename(documentName, ankiRandomHex(12), ext);
  const outPath = ankiMediaPath(tempFilename);
  await ensureAnkiMediaRoot();
  const codecArgs =
    format === "opus"
      ? ["-c:a", "libopus", "-b:a", String(bitrate) + "k"]
      : ["-codec:a", "libmp3lame", "-b:a", String(bitrate) + "k"];
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
    "2",
  ].concat(codecArgs, [outPath]);
  const result = await utils.exec(ffmpegPath, args, dataRoot());
  if (!result || result.status !== 0 || !file.exists(outPath)) {
    throw new Error(
      "Sentence audio capture failed: " +
        String(
          (result && (result.stderr || result.stdout)) || "ffmpeg failed",
        ).slice(0, 500),
    );
  }
  const filename = ankiMediaFilename(
    documentName,
    await ankiMediaFileHashHex(outPath),
    ext,
  );
  return ankiStoreMediaFile(filename, outPath, prefs);
}
function ankiAudioUrlFromTemplate(template, context, prefs) {
  const values = {
    term: String(
      (context && context.audioTerm) || (context && context.expression) || "",
    ),
    reading: String(
      (context && context.audioReading) || (context && context.reading) || "",
    ),
    language: String((prefs && prefs.lookupLanguage) || ""),
  };
  return String(template || "").replace(/\{([^}]*)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
    try {
      return encodeURIComponent(values[key]);
    } catch (_) {
      return values[key];
    }
  });
}
function ankiUrlLooksLikeAudioFile(url) {
  return /\.(?:mp3|m4a|aac|ogg|oga|opus|wav|webm)(?:[?#]|$)/i.test(
    String(url || ""),
  );
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
    const sourceUrl = safeAnkiConnectUrl(
      ankiAudioUrlFromTemplate(source && source.url, context, prefs),
    );
    if (!sourceUrl) continue;
    if (ankiUrlLooksLikeAudioFile(sourceUrl)) return sourceUrl;
    try {
      if (typeof fetchAudioSourceCandidates === "function") {
        const candidates = await fetchAudioSourceCandidates(sourceUrl);
        if (Array.isArray(candidates) && candidates.length && candidates[0].url)
          return candidates[0].url;
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
    const filename = ankiMediaFilename(
      context.documentTitle || context.expression || "word",
      ankiRandomHex(12),
      ankiAudioExtensionFromUrl(url),
    );
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
    jobs.push(
      ankiCaptureScreenshot(context, prefs).then((value) => {
        media.screenshot = value;
      }),
    );
  }
  if (needs.sentenceAudio) {
    jobs.push(
      ankiCaptureSentenceAudio(context, prefs).then((value) => {
        media.sentenceAudio = value;
      }),
    );
  }
  if (needs.wordAudio) {
    jobs.push(
      ankiStoreWordAudio(context, prefs).then((value) => {
        if (value) media.wordAudio = value;
      }),
    );
  }
  if (jobs.length) await Promise.all(jobs);
  return media;
}
async function ankiConfiguredFieldNames(prefs) {
  const key = ankiFieldCacheKey(prefs);
  if (Array.isArray(ankiModelFieldCache[key]))
    return ankiModelFieldCache[key].slice();
  try {
    const fields = await ankiConnectInvoke(
      "modelFieldNames",
      { modelName: prefs.ankiModelName },
      { url: prefs.ankiConnectUrl, timeoutSeconds: 8 },
    );
    const out = Array.isArray(fields) ? fields : [];
    ankiModelFieldCache[key] = out.slice();
    return out;
  } catch (_) {
    return Object.keys(ankiFieldTemplatesFromPrefs(prefs));
  }
}
async function ankiCardStatusForContext(payload) {
  const prefs = ankiActiveProfilePreferences();
  if (!ankiProfileConfigured(prefs))
    return {
      ok: false,
      state: "disabled",
      message: "Anki export is not configured.",
    };
  const templates = ankiFieldTemplatesFromPrefs(prefs);
  const context = ankiCardContextFromPayload(payload);
  const fields = renderAnkiFields(templates, context, {});
  const fieldNames = await ankiConfiguredFieldNames(prefs);
  const duplicates = await ankiFindDuplicateNotes(prefs, fields, fieldNames);
  if (duplicates.length) {
    return {
      ok: true,
      state: "duplicate",
      duplicate: true,
      noteIds: duplicates,
      message: "Duplicate found.",
    };
  }
  return {
    ok: true,
    state: "ready",
    duplicate: false,
    noteIds: [],
    message: "Ready to add.",
  };
}
function postAnkiCardState(requestId, payload) {
  const message = Object.assign(
    { type: "anki-card-state", requestId: String(requestId || "") },
    payload || {},
  );
  try {
    postToOverlayBridge(message);
  } catch (_) {}
  postToOverlay("anki-card-state", message);
}
function ankiBridgeRequestId(payload) {
  return payload && payload.requestId !== undefined
    ? String(payload.requestId)
    : "";
}
function ankiBridgeSessionId(payload) {
  return payload && payload.popupSessionId !== undefined
    ? String(payload.popupSessionId)
    : "";
}
function ankiBridgeRequestKey(type, payload) {
  const requestId = ankiBridgeRequestId(payload);
  const sessionId = ankiBridgeSessionId(payload);
  if (sessionId) return String(type || "") + ":" + sessionId + ":" + requestId;
  return String(type || "") + ":" + String(requestId || "");
}
function postAnkiCardStateForBridgePayload(payload, statePayload) {
  const sessionId = ankiBridgeSessionId(payload);
  const response = Object.assign({}, statePayload || {});
  if (sessionId && response.popupSessionId === undefined)
    response.popupSessionId = sessionId;
  postAnkiCardState(ankiBridgeRequestId(payload), response);
}
function beginAnkiBridgeRequest(type, payload, ackPayload) {
  const requestId = ankiBridgeRequestId(payload);
  const key = ankiBridgeRequestKey(type, payload);
  if (requestId && ankiActiveBridgeRequests[key]) {
    postAnkiCardStateForBridgePayload(
      payload,
      Object.assign({ ok: true, ack: true }, ackPayload || {}),
    );
    return false;
  }
  if (requestId) ankiActiveBridgeRequests[key] = true;
  postAnkiCardStateForBridgePayload(
    payload,
    Object.assign({ ok: true, ack: true }, ackPayload || {}),
  );
  return true;
}
function finishAnkiBridgeRequest(type, payload) {
  const requestId = ankiBridgeRequestId(payload);
  const key = ankiBridgeRequestKey(type, payload);
  if (!requestId || !ankiActiveBridgeRequests[key]) return;
  ankiActiveBridgeRequests[key] = "done";
  setTimeout(() => {
    try {
      delete ankiActiveBridgeRequests[key];
    } catch (_) {}
  }, 60000);
}
function handleBridgeAnkiCardStatus(payload) {
  if (
    !beginAnkiBridgeRequest("anki-card-status", payload, { state: "checking" })
  )
    return;
  (async () => {
    try {
      const status = await ankiCardStatusForContext(payload);
      postAnkiCardStateForBridgePayload(payload, status);
    } catch (error) {
      postAnkiCardStateForBridgePayload(payload, {
        ok: false,
        state: "error",
        message: compactError(error),
      });
    } finally {
      finishAnkiBridgeRequest("anki-card-status", payload);
    }
  })();
}
function handleBridgeAnkiCardOpen(payload) {
  if (
    !beginAnkiBridgeRequest("anki-card-open", payload, {
      state: "opening",
      message: "Opening in Anki...",
    })
  )
    return;
  try {
    const prefs = ankiActiveProfilePreferences();
    const openedIds = ankiOpenDuplicateNotes(prefs, payload && payload.noteIds);
    postAnkiCardStateForBridgePayload(payload, {
      ok: true,
      state: "opened",
      noteIds: openedIds,
      message: "Reveal sent to Anki.",
    });
  } catch (error) {
    postAnkiCardStateForBridgePayload(payload, {
      ok: false,
      state: "error",
      message: compactError(error),
    });
  } finally {
    finishAnkiBridgeRequest("anki-card-open", payload);
  }
}
function handleBridgeAnkiCardAdd(payload) {
  if (
    !beginAnkiBridgeRequest("anki-card-add", payload, {
      state: "adding",
      message: "Adding Anki card...",
    })
  )
    return;
  (async () => {
    try {
      const prefs = ankiActiveProfilePreferences();
      if (!ankiProfileConfigured(prefs))
        throw new Error("Anki export is not configured.");
      const templates = ankiFieldTemplatesFromPrefs(prefs);
      const context = ankiCardContextFromPayload(payload);
      let fields = renderAnkiFields(templates, context, {});
      let duplicates = [];
      if (prefs.ankiDuplicateCheck) {
        const fieldNames = await ankiConfiguredFieldNames(prefs);
        duplicates = await ankiFindDuplicateNotes(prefs, fields, fieldNames);
      }
      if (duplicates.length && prefs.ankiDuplicateMode !== "allow") {
        const openedIds = ankiOpenDuplicateNotes(prefs, duplicates);
        postAnkiCardStateForBridgePayload(payload, {
          ok: true,
          state: "opened",
          duplicate: true,
          noteIds: openedIds,
          message: "Reveal sent to Anki.",
        });
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
        tags: ankiNoteTags(prefs),
      };
      const noteId = await ankiConnectInvoke(
        "addNote",
        { note },
        { url: prefs.ankiConnectUrl, timeoutSeconds: 20 },
      );
      if (!ankiValidAddedNoteId(noteId))
        throw new Error("AnkiConnect did not return a note ID.");
      postAnkiCardStateForBridgePayload(payload, {
        ok: true,
        state: "added",
        noteId,
        noteIds: ankiDisplayNoteIds([noteId]),
        message: "Added Anki card.",
      });
    } catch (error) {
      postAnkiCardStateForBridgePayload(payload, {
        ok: false,
        state: "error",
        message: compactError(error),
      });
    } finally {
      finishAnkiBridgeRequest("anki-card-add", payload);
    }
  })();
}
