const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  assert,
  loadOverlayForTest,
  root,
} = require("./helpers/overlay_test_context");

const { context, overlay } = loadOverlayForTest([
  "state",
  "applyConfig",
  "showPopup",
  "nestedLookupSourceFromEvent",
  "openNestedPopup",
  "placeNestedPopup",
  "clearNestedPopups",
]);

overlay.applyConfig({
  nestedPopupMode: "click",
  nestedPopupMaxDepth: 2,
  popupScale: 1,
  popupMaxHeightVh: 34,
  popupSubtitleGapPx: 96,
  overlayBridgePort: 19741,
  anki: { enabled: true, configured: true },
});
overlay.state.enabled = true;
overlay.state.lineId = 41;
overlay.state.text = "字幕の文";

const anchor = context.document.createElement("span");
overlay.showPopup(
  anchor,
  "食べる",
  '<div class="gloss">毎日使っている。</div>',
);
const popup = context.__elements.popup;
const body = popup.querySelector(".body");
const gloss = context.document.createElement("span");
gloss.className = "gloss";
const textNode = context.document.createTextNode("毎日使っている。");
gloss.appendChild(textNode);
body.appendChild(gloss);

const source = overlay.nestedLookupSourceFromEvent(popup, {
  currentTarget: popup,
  target: gloss,
  lookupRange: {
    startContainer: textNode,
    startOffset: 2,
  },
});
assert(source, "Clicking definition text should create a nested lookup source");
assert(
  source.text === "毎日使っている。" && source.position === 2,
  "Nested lookup should retain the definition text and clicked character position",
);

assert(
  overlay.openNestedPopup(popup, source) === true,
  "The first child popup should open",
);
assert(
  overlay.state.nestedPopups.length === 1,
  "Opening a nested lookup should retain the root popup and add one child",
);
const first = overlay.state.nestedPopups[0];
assert(
  Number.parseFloat(first.element.style.top) ===
    source.sentenceRect.bottom + 10,
  "Child placement should prefer the space below its definition sentence",
);
assert(
  first.highlight &&
    first.highlight.classList.contains("nested-popup-highlight"),
  "The looked-up definition should remain highlighted",
);
const request = context.__sent.find(
  (message) => message.type === "nested-lookup",
);
assert(
  request &&
    request.text === "毎日使っている。" &&
    request.position === 2 &&
    request.depth === 1,
  "Nested lookup requests should carry their own text, position, and depth",
);

context.__handlers["nested-lookup-ack"]({
  requestId: request.requestId,
  lineId: 41,
  depth: 1,
});
context.__handlers["nested-lookup-result"]({
  requestId: request.requestId,
  lineId: 41,
  depth: 1,
  position: 2,
  ok: true,
  result: {
    text: "毎日使っている。",
    language: "ja",
    lookupStart: 2,
    lookupEnd: 4,
    results: [
      {
        matched: "使って",
        deinflected: "使う",
        term: {
          expression: "使う",
          reading: "つかう",
          glossaries: [{ dict: "Test", glossary: "to use" }],
        },
      },
    ],
  },
});
assert(
  /<ruby>使/.test(first.element.querySelector(".head").innerHTML) &&
    /to use/.test(first.element.querySelector(".body").innerHTML),
  "Child popups should use the same headword and dictionary-entry renderer as the root",
);
assert(
  Number.parseFloat(first.highlight.style.width) === 30,
  "The nested highlight should expand from the clicked character to the full matched word",
);
assert(
  Number.parseFloat(first.element.style.top) >= source.sentenceRect.bottom + 10,
  "The child popup should remain below the source sentence after the full match is known",
);
const nestedAnkiContext = Object.values(overlay.state.ankiCardContexts).find(
  (candidate) => candidate.expression === "使う",
);
assert(
  nestedAnkiContext &&
    nestedAnkiContext.allowCurrentMedia === false &&
    nestedAnkiContext.sentence === "毎日使っている。",
  "Child Anki contexts should use popup text and opt out of current-media metadata",
);

const rubySentence = context.document.createElement("span");
const ruby = context.document.createElement("ruby");
const rubyBase = context.document.createTextNode("使");
const rubyParenOpen = context.document.createElement("rp");
const rubyParenClose = context.document.createElement("rp");
const rubyReading = context.document.createElement("rt");
const rubyReadingText = context.document.createTextNode("つ");
rubyParenOpen.appendChild(context.document.createTextNode("（"));
rubyParenClose.appendChild(context.document.createTextNode("）"));
rubyReading.appendChild(rubyReadingText);
ruby.appendChild(rubyBase);
ruby.appendChild(rubyParenOpen);
ruby.appendChild(rubyReading);
ruby.appendChild(rubyParenClose);
rubySentence.appendChild(ruby);
rubySentence.appendChild(context.document.createTextNode("う"));
body.appendChild(rubySentence);
const rubySource = overlay.nestedLookupSourceFromEvent(popup, {
  currentTarget: popup,
  target: rubyReading,
  lookupRange: {
    startContainer: rubyReadingText,
    startOffset: 1,
  },
});
assert(
  rubySource &&
    rubySource.text === "使う" &&
    rubySource.position === 0 &&
    !rubySource.text.includes("つ"),
  "Furigana hits should retain adjacent okurigana while filtering out the rt reading",
);

assert(
  overlay.openNestedPopup(first.element, source) === true &&
    overlay.state.nestedPopups.length === 2,
  "A child popup should be able to open another child up to the configured depth",
);
const second = overlay.state.nestedPopups[1];
assert(
  overlay.openNestedPopup(second.element, source) === false &&
    overlay.state.nestedPopups.length === 2,
  "Nested popup creation should stop at the configured depth",
);

first.element.listeners.click({
  currentTarget: first.element,
  target: first.element.querySelector(".body"),
  clientX: 40,
  clientY: 40,
});
assert(
  overlay.state.nestedPopups.length === 1 &&
    overlay.state.nestedPopups[0] === first,
  "Empty-space dismissal in a child should retain that child and every ancestor",
);
overlay.openNestedPopup(first.element, source);

const childAction = context.document.createElement("button");
first.element.querySelector(".body").appendChild(childAction);
first.element.listeners.click({
  currentTarget: first.element,
  target: childAction,
  clientX: 40,
  clientY: 40,
});
assert(
  overlay.state.nestedPopups.length === 2,
  "Popup action controls should not be treated as empty dismissal space",
);

popup.listeners.click({
  currentTarget: popup,
  target: gloss,
  lookupRange: {
    startContainer: textNode,
    startOffset: 3,
  },
});
assert(
  overlay.state.nestedPopups.length === 0,
  "Clicking any part of the root popup word that opened its child should dismiss that child and every descendant",
);

overlay.openNestedPopup(popup, source);
const originalChild = overlay.state.nestedPopups[0].element;
popup.listeners.click({
  currentTarget: popup,
  target: gloss,
  lookupRange: {
    startContainer: textNode,
    startOffset: 0,
  },
});
assert(
  overlay.state.nestedPopups.length === 1 &&
    overlay.state.nestedPopups[0].element !== originalChild &&
    overlay.state.nestedPopups[0].source.position === 0,
  "Clicking a different word should replace the direct child instead of only dismissing it",
);

overlay.openNestedPopup(overlay.state.nestedPopups[0].element, source);
popup.listeners.click({
  currentTarget: popup,
  target: body,
  clientX: 40,
  clientY: 40,
});
assert(
  overlay.state.nestedPopups.length === 0,
  "Clicking empty root-popup space should dismiss every descendant without dismissing the root",
);

overlay.applyConfig({ nestedPopupMode: "hover" });
overlay.openNestedPopup(popup, source);
popup.listeners.click({
  currentTarget: popup,
  target: gloss,
  lookupRange: {
    startContainer: textNode,
    startOffset: 0,
  },
});
assert(
  overlay.state.nestedPopups.length === 1 &&
    overlay.state.nestedPopups[0].source.position === 0,
  "Clicking a different word should replace a hover-activated child as well",
);
popup.listeners.click({
  currentTarget: popup,
  target: body,
  clientX: 40,
  clientY: 40,
});
assert(
  overlay.state.nestedPopups.length === 0,
  "Empty-space dismissal should also work while hover activation is configured",
);

overlay.applyConfig({ nestedPopupMode: "shift-hover" });
popup.listeners.mousemove({
  currentTarget: popup,
  target: gloss,
  shiftKey: false,
  lookupRange: {
    startContainer: textNode,
    startOffset: 0,
  },
});
assert(
  overlay.state.nestedHoverTimer === null &&
    overlay.state.nestedPopups.length === 0,
  "Shift-hover nested mode should ignore an unmodified hover",
);
popup.listeners.mousemove({
  currentTarget: popup,
  target: gloss,
  shiftKey: true,
  lookupRange: {
    startContainer: textNode,
    startOffset: 0,
  },
});
assert(
  overlay.state.nestedHoverTimer !== null,
  "Shift-hover nested mode should schedule lookup while Shift is held",
);
clearTimeout(overlay.state.nestedHoverTimer);
overlay.state.nestedHoverTimer = null;
overlay.state.nestedHoverKey = "";

overlay.clearNestedPopups(0);
assert(
  overlay.state.nestedPopups.length === 0 &&
    context.__elements["nested-popup-layer"].children.length === 0,
  "Closing the nested stack should remove child windows and source highlights",
);

overlay.applyConfig({
  nestedPopupMode: "unexpected",
  nestedPopupMaxDepth: 100000,
});
assert(
  overlay.state.config.nestedPopupMode === "off" &&
    overlay.state.config.nestedPopupMaxDepth === 99999,
  "Invalid nested popup settings should normalize to off and a safe depth",
);

const bridgeSource = fs.readFileSync(
  path.join(root, "src/main/50_overlay_bridge_pause.js"),
  "utf8",
);
assert(
  /"nested-lookup"\(payload\)/.test(bridgeSource) &&
    /lookupAtPosition\(text, position, requestId\)/.test(bridgeSource),
  "The overlay bridge should route child text through the existing lookup pipeline",
);

const posted = [];
const bridgeLookups = [];
const bridgeContext = vm.createContext({
  requestSerial: 0,
  currentSubtitleLineId: 41,
  enabled: true,
  charsOf: Array.from,
  activeProfilePreferenceValue() {
    return "click";
  },
  postToOverlay(type, payload) {
    posted.push({ type, payload });
  },
  lookupAtPosition(text, position, requestId) {
    bridgeLookups.push({ text, position, requestId });
    return Promise.resolve({ text, position, results: [] });
  },
  compactError(error) {
    return String(error);
  },
});
vm.runInContext(
  bridgeSource +
    "\nglobalThis.__handleBridgeNestedLookup = handleBridgeNestedLookup;",
  bridgeContext,
);
bridgeContext.__handleBridgeNestedLookup({
  requestId: "nested-bridge-test",
  lineId: 41,
  text: "毎日使っている。",
  position: 2,
  depth: 1,
});

setImmediate(() => {
  try {
    assert(
      bridgeLookups.length === 1 &&
        bridgeLookups[0].text === "毎日使っている。" &&
        bridgeLookups[0].position === 2,
      "The plugin bridge should execute nested text through lookupAtPosition",
    );
    assert(
      posted.some(
        (message) =>
          message.type === "nested-lookup-ack" &&
          message.payload.requestId === "nested-bridge-test",
      ) &&
        posted.some(
          (message) =>
            message.type === "nested-lookup-result" &&
            message.payload.ok === true,
        ),
      "The plugin bridge should acknowledge and return nested lookup results",
    );
    console.log("overlay nested popup tests passed");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
});
