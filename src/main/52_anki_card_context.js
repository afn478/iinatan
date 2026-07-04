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
const ANKI_STRUCTURED_CONTENT_CSS = `
.yomitan-glossary details[data-sc-details] { margin: 0.5em 0; padding-left: 0; }
.yomitan-glossary summary[data-sc-summary] { border-block-end: 1px dotted var(--link-color, var(--fg-link, rgb(26, 115, 232))); border-radius: 0.4em; color: var(--text-color-light4, var(--fg-subtle, currentColor)); cursor: pointer; display: list-item; font-size: 0.85em; font-weight: 700; list-style-position: inside; padding: 0.1em 0.2em; user-select: none; width: max-content; }
.yomitan-glossary summary[data-sc-summary]:hover { background: var(--notification-background-color-lighter, rgba(127, 127, 127, 0.14)); border-block-end-style: solid; color: var(--text-color, currentColor); }
.yomitan-glossary details[data-sc-details][open] > summary[data-sc-summary] { color: var(--text-color, currentColor); margin-block-end: 0.5em; }
`.trim();
const ANKI_JITENDEX_STRUCTURED_CSS = `
.yomitan-glossary [data-dictionary^="Jitendex"] span[title] { cursor: help; }
.yomitan-glossary [data-dictionary^="Jitendex"] [data-sc-class="tag"] { border-radius: 0.3em; font-size: 0.8em; font-weight: bold; margin-right: 0.5em; padding: 0.2em 0.3em; vertical-align: text-bottom; word-break: keep-all; }
.yomitan-glossary [data-dictionary^="Jitendex"] [data-sc-content="part-of-speech-info"] { background-color: rgb(86, 86, 86); color: white; }
.yomitan-glossary [data-dictionary^="Jitendex"] [data-sc-content="misc-info"] { background-color: brown; color: white; }
.yomitan-glossary [data-dictionary^="Jitendex"] [data-sc-content="field-info"] { background-color: purple; color: white; }
.yomitan-glossary [data-dictionary^="Jitendex"] [data-sc-content="dialect-info"] { background-color: green; color: white; }
.yomitan-glossary [data-dictionary^="Jitendex"] ul[data-sc-content="glossary"] { list-style-type: none; margin: 0.75em 0 0.4em; padding-left: 0; }
.yomitan-glossary [data-dictionary^="Jitendex"] ul[data-sc-content="glossary"] > li { display: inline; }
.yomitan-glossary [data-dictionary^="Jitendex"] ul[data-sc-content="glossary"] > li + li::before { content: " | "; }
.yomitan-glossary [data-dictionary^="Jitendex"] div[data-sc-content="extra-info"] { margin-left: 0.5em; }
.yomitan-glossary [data-dictionary^="Jitendex"] div[data-sc-class="extra-box"] { border-radius: 0.4rem; border-style: none none none solid; border-width: 0.35rem; margin: 0.5rem 0; padding: 0.5rem; width: fit-content; }
.yomitan-glossary [data-dictionary^="Jitendex"] div[data-sc-content="example-sentence"] { background: rgba(0, 0, 0, 0.05); border-color: currentColor; }
.yomitan-glossary [data-dictionary^="Jitendex"] div[data-sc-content="example-sentence-a"] { font-size: 1.3em; }
.yomitan-glossary [data-dictionary^="Jitendex"] div[data-sc-content="example-sentence-b"] { font-size: 0.8em; }
.yomitan-glossary [data-dictionary^="Jitendex"] span[data-sc-content="example-keyword"] { color: rgb(0, 128, 0); }
.yomitan-glossary [data-dictionary^="Jitendex"] div[data-sc-content="xref"] { background: rgba(26, 115, 232, 0.05); border-color: rgb(26, 115, 232); }
.yomitan-glossary [data-dictionary^="Jitendex"] div[data-sc-content="xref-content"] { font-size: 1.3em; }
.yomitan-glossary [data-dictionary^="Jitendex"] div[data-sc-content="xref-glossary"] { font-size: 0.8rem; margin-top: 0.4em; }
.yomitan-glossary [data-dictionary^="Jitendex"] span[data-sc-content="reference-label"] { color: rgb(26, 115, 232); font-size: 0.8em; margin-right: 0.5rem; }
.yomitan-glossary [data-dictionary^="Jitendex"] .gloss-link { color: rgb(0, 120, 215); text-decoration: none; }
.yomitan-glossary [data-dictionary^="Jitendex"] .gloss-link-external-icon { display: none; }
.yomitan-glossary [data-dictionary^="Jitendex"] div[data-sc-content="attribution"] { font-size: 0.7em; margin-top: 0.6rem; text-align: right; }
`.trim();
function ankiSafeTagName(value) {
  const tag = String(value || "")
    .trim()
    .toLowerCase();
  return ANKI_STRUCTURED_TAGS[tag] ? tag : "";
}
function ankiStructuredSpanNeedsTrailingSpace(node, tag) {
  if (tag !== "span") return false;
  const data = ankiDataMap(node);
  const kind = ankiNodeKind(node);
  const cls = String(data.class || data["data-class"] || "");
  return (
    kind === "part-of-speech-info" ||
    kind === "misc-info" ||
    kind === "tag" ||
    kind === "reference-label" ||
    cls === "tag"
  );
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
    const href = ankiSafeHref(rawHref);
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
  const attrs = ankiCommonAttributes(value, { extraAttrs });
  const element = ANKI_VOID_TAGS[tag]
    ? "<" + tag + attrs + ">"
    : "<" + tag + attrs + ">" + body + "</" + tag + ">";
  if (ankiStructuredSpanNeedsTrailingSpace(value, tag)) return element + " ";
  return tag === "table"
    ? '<div class="gloss-sc-table-container">' + element + "</div>"
    : element;
}
function ankiStructuredContentHtml(value, dictionary) {
  return (
    "<span>" +
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
function ankiDictionaryMarkerKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/g, "");
}
function ankiDictionaryMarkerMatches(dictionary, marker) {
  const dictKey = ankiDictionaryMarkerKey(dictionary);
  const markerKey = ankiDictionaryMarkerKey(marker);
  if (!dictKey || !markerKey) return false;
  return (
    dictKey === markerKey ||
    dictKey.indexOf(markerKey) === 0 ||
    markerKey.indexOf(dictKey) === 0
  );
}
function ankiDictionaryIsJitendex(value) {
  return /^Jitendex(?:\.org)?(?:\b|\s|\[)/i.test(
    ankiNormalizeWhitespace(value),
  );
}
function ankiStyleBlockHtml(css) {
  const text = String(css || "")
    .replace(/<\/style/gi, "<\\/style")
    .trim();
  return text ? "<style>" + text + "</style>" : "";
}
function ankiGlossaryContentIsStructured(value) {
  if (value === undefined || value === null) return false;
  const parsed = ankiParseGlossaryJson(value);
  if (parsed !== null) return ankiGlossaryContentIsStructured(parsed);
  if (Array.isArray(value)) return value.some(ankiGlossaryContentIsStructured);
  if (typeof value !== "object") return false;
  if (value.type === "structured-content" || value.tag) return true;
  if (value.content !== undefined)
    return ankiGlossaryContentIsStructured(value.content);
  if (value.glossary !== undefined)
    return ankiGlossaryContentIsStructured(value.glossary);
  return false;
}
function ankiGlossaryItemHasStructuredContent(item) {
  return ankiGlossaryContentList(item && item.glossary).some(
    ankiGlossaryContentIsStructured,
  );
}
function ankiGlossaryScopedStylesHtml(items) {
  const itemList = ankiToArray(items);
  const hasStructured = itemList.some(ankiGlossaryItemHasStructuredContent);
  if (!hasStructured) return "";
  const css = [ANKI_STRUCTURED_CONTENT_CSS];
  if (
    itemList.some(
      (item) =>
        ankiDictionaryIsJitendex(item && item.dict) &&
        ankiGlossaryItemHasStructuredContent(item),
    )
  ) {
    css.push(ANKI_JITENDEX_STRUCTURED_CSS);
  }
  return ankiStyleBlockHtml(css.filter(Boolean).join("\n"));
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
function ankiGlossaryItemsHtml(glossaryItems, options) {
  const opts = options || {};
  const items = glossaryItems.map(ankiGlossaryEntryHtml).filter(Boolean);
  if (!items.length) return "";
  const style = ankiGlossaryScopedStylesHtml(glossaryItems);
  const body =
    glossaryItems.length === 1 && !opts.forceList
      ? ankiGlossarySingleHtml(glossaryItems[0]) + style
      : "<ol>" + items.join("") + style + "</ol>";
  return (
    '<div style="text-align: left;" class="yomitan-glossary">' + body + "</div>"
  );
}
function ankiGlossaryHtml(entry) {
  return ankiGlossaryItemsHtml(ankiGlossaryItems(entry), { forceList: true });
}
function ankiFirstGlossary(entry) {
  const items = ankiGlossaryItems(entry);
  return items.length ? ankiPlainText(items[0] && items[0].glossary) : "";
}
function ankiFirstGlossaryHtml(entry) {
  const first = ankiGlossaryItems(entry)[0];
  return first ? ankiGlossaryItemsHtml([first]) : "";
}
function ankiMatchingGlossaryItems(entry, dictionary) {
  const items = ankiGlossaryItems(entry);
  const marker = ankiNormalizeWhitespace(dictionary);
  if (!marker) return [];
  return items.filter((item) =>
    ankiDictionaryMarkerMatches(item && item.dict, marker),
  );
}
function ankiFirstMatchingGlossaryDictionary(entry, dictionary) {
  const item = ankiMatchingGlossaryItems(entry, dictionary)[0];
  return ankiNormalizeWhitespace(item && item.dict);
}
function ankiSelectedGlossaryDictionary(entry, rawContext) {
  const items = ankiGlossaryItems(entry);
  if (!items.length) return "";
  const explicit = ankiNormalizeWhitespace(
    rawContext &&
      (rawContext.selectedDictionary ||
        rawContext.selectedGlossaryDictionary ||
        rawContext.dictionary),
  );
  const explicitMatch = explicit
    ? ankiFirstMatchingGlossaryDictionary(entry, explicit)
    : "";
  if (explicitMatch) return explicitMatch;
  const jitendex = items.find((item) =>
    ankiDictionaryIsJitendex(item && item.dict),
  );
  if (jitendex) return ankiNormalizeWhitespace(jitendex && jitendex.dict);
  return ankiNormalizeWhitespace(items[0] && items[0].dict);
}
function ankiGlossaryPlainForDictionary(entry, dictionary) {
  const item = ankiMatchingGlossaryItems(entry, dictionary)[0];
  if (!item) return "";
  return ankiGlossaryContentList(item && item.glossary)
    .map(ankiFormatGlossaryPlainText)
    .filter(Boolean)
    .join("\n");
}
function ankiGlossaryHtmlForDictionary(entry, dictionary) {
  const item = ankiMatchingGlossaryItems(entry, dictionary)[0];
  if (!item) return "";
  return ankiGlossaryItemsHtml([item], { forceList: true });
}
function ankiSelectedGlossaryHtml(entry, rawContext) {
  const selectedDictionary = ankiSelectedGlossaryDictionary(entry, rawContext);
  if (!selectedDictionary) return ankiFirstGlossaryHtml(entry);
  return (
    ankiGlossaryHtmlForDictionary(entry, selectedDictionary) ||
    ankiFirstGlossaryHtml(entry)
  );
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
function ankiLookupSurface(context, entry, fallbackSubtitle) {
  const candidate =
    context && context.result && context.result.candidateUsed
      ? context.result.candidateUsed
      : null;
  if (context && context.surface) return String(context.surface);
  if (entry && entry.matched) return String(entry.matched);
  if (candidate && candidate.displayText) return String(candidate.displayText);
  const result = context && context.result ? context.result : {};
  const text = String(
    result.text || context.sentence || fallbackSubtitle || "",
  );
  const start = Number(result.lookupStart);
  const end = Number(result.lookupEnd);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start)
    return Array.from(text).slice(start, end).join("");
  if (result.lookupText) return String(result.lookupText);
  return "";
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
function ankiBuildCardContext(payload, host) {
  const runtime = host && typeof host === "object" ? host : {};
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
    raw.sentence ||
      (raw.result && raw.result.text) ||
      runtime.lastSubtitle ||
      "",
  );
  const surface = ankiNormalizeWhitespace(
    raw.surface ||
      ankiLookupSurface(raw, entry, runtime.lastSubtitle) ||
      expression,
  );
  const popupSelectionText = ankiNormalizeWhitespace(
    raw.popupSelectionText || raw.selectionText || raw.selectedText || "",
  );
  const position = Number(
    raw.position !== undefined
      ? raw.position
      : payload && payload.position !== undefined
        ? payload.position
        : raw.result && raw.result.lookupStart,
  );
  const cloze = ankiClozeForSentence(sentence, surface || expression, position);
  const title = ankiNormalizeWhitespace(runtime.documentTitle || "");
  const sourcePath = String(runtime.sourcePath || "");
  const timePos = Number(runtime.timePos || 0);
  const selectedDictionary = ankiSelectedGlossaryDictionary(entry, raw);
  const glossaryFirst = ankiFirstGlossary(entry);
  const selectedGlossary =
    (selectedDictionary
      ? ankiGlossaryPlainForDictionary(entry, selectedDictionary)
      : "") || glossaryFirst;
  const glossaryFirstHtml = ankiFirstGlossaryHtml(entry);
  const selectedGlossaryHtml = ankiSelectedGlossaryHtml(entry, raw);
  return {
    requestId: String((payload && payload.requestId) || ""),
    entry,
    term,
    expression,
    word: expression,
    reading,
    sentence,
    surface,
    popupSelectionText,
    position: Number.isFinite(position) ? position : 0,
    clozePrefix: cloze.prefix,
    clozeBody: cloze.body,
    clozeSuffix: cloze.suffix,
    glossary: ankiGlossaryHtml(entry),
    glossaryPlain: ankiGlossaryPlain(entry),
    glossaryFirst,
    glossaryFirstHtml,
    selectedGlossary,
    selectedGlossaryHtml,
    selectedDictionary,
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
