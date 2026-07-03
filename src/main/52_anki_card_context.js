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
    popupSelectionText,
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
