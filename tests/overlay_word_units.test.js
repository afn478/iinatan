const {
  assert,
  loadOverlayForTest,
} = require("./helpers/overlay_test_context");

const { context, overlay } = loadOverlayForTest([
  "state",
  "applyConfig",
  "renderSubtitle",
  "lookupPreviewForPosition",
  "lookupUnitForPosition",
  "subtitleEl",
  "popupEl",
]);
overlay.state.enabled = true;

function enter(pos) {
  const el = overlay.subtitleEl.querySelector(
    '.char.lookupable[data-pos="' + String(pos) + '"]',
  );
  assert(el, "Expected hoverable element at " + pos);
  el.listeners.mouseenter({ currentTarget: el });
  return el;
}

function lookupMessages() {
  return context.__sent.filter((message) => message.type === "lookup");
}
function activeMatchPositions() {
  return overlay.subtitleEl
    .querySelectorAll(".char.active-match")
    .map((el) => Number(el.dataset.pos));
}

overlay.applyConfig({
  language: {
    id: "en",
    label: "English",
    lookupUnit: "word",
    wordMode: "latin-word",
  },
  overlayBridgePort: 19741,
  scanLength: 24,
  hoverRequestTimeoutMs: 5000,
});
overlay.renderSubtitle("I was running quickly", 1);

const runningStart = "I was ".length;
const runningEnd = runningStart + "running".length;
const quicklyStart = "I was running ".length;

for (let i = runningStart; i < runningEnd; i++) {
  const unit = overlay.lookupUnitForPosition(i);
  assert(
    unit.pos === runningStart,
    "Every running character should resolve to the word start",
  );
  assert(
    unit.preview.start === runningStart && unit.preview.end === runningEnd,
    "Every running character should resolve to the full word span",
  );
}

const firstAnchor = enter(runningStart);
assert(
  lookupMessages().length === 1,
  "First hover inside running should dispatch one lookup",
);
assert(
  lookupMessages()[0].position === runningStart,
  "Running lookup should be anchored at the word start",
);
assert(
  overlay.state.currentAnchor === firstAnchor,
  "Popup anchor should be the first character of running",
);
context.__handlers["line-lookup-result"]({
  lineId: 1,
  position: runningStart,
  ok: true,
  result: {
    ok: true,
    results: [],
    lookupStart: runningStart,
    lookupEnd: runningEnd,
    noResult: true,
    noResultReason: "all-candidates-empty",
  },
});
assert(
  activeMatchPositions().length === "running".length,
  "Latin no-result should highlight the whole word span",
);

enter(runningStart + 1);
enter(runningStart + 4);
enter(runningEnd - 1);
assert(
  lookupMessages().length === 1,
  "Moving within running after no-result should not dispatch another lookup",
);
assert(
  overlay.state.currentAnchor === firstAnchor,
  "Moving within running should keep the same popup anchor",
);

const quicklyAnchor = enter(quicklyStart);
assert(
  lookupMessages().length === 2,
  "Moving to a different word should dispatch a new lookup",
);
assert(
  lookupMessages()[1].position === quicklyStart,
  "Quickly lookup should be anchored at its word start",
);
assert(
  overlay.state.currentAnchor === quicklyAnchor,
  "Popup anchor should move for a different word",
);

overlay.renderSubtitle("Witches gather", 10);
const witchesEnd = "Witches".length;
const beforeWitches = lookupMessages().length;
enter(0);
assert(
  lookupMessages().length === beforeWitches + 1,
  "English deinflected word should dispatch one lookup from the word start",
);
context.__handlers["line-lookup-result"]({
  lineId: 10,
  position: 0,
  ok: true,
  result: {
    ok: true,
    text: "Witches gather",
    position: 0,
    lookupStart: 0,
    lookupEnd: witchesEnd,
    matchStart: 0,
    lookupText: "witch",
    candidateUsed: {
      text: "witch",
      displayText: "Witches",
      source: "deinflection",
    },
    language: "en",
    results: [
      {
        matched: "witch",
        deinflected: "witch",
        term: {
          expression: "witch",
          reading: "",
          glossaries: [{ dict: "Test", glossary: "plural witches" }],
        },
      },
    ],
  },
});
assert(
  activeMatchPositions().join(",") === "0,1,2,3,4,5,6",
  "English deinflected result should highlight the whole source word",
);
enter(witchesEnd - 1);
assert(
  lookupMessages().length === beforeWitches + 1,
  "Hovering filtered suffix letters should stay in the same lookup unit",
);
assert(
  activeMatchPositions().join(",") === "0,1,2,3,4,5,6",
  "Filtered suffix letters should not split the active highlight",
);

overlay.applyConfig({
  language: {
    id: "fr",
    label: "French",
    lookupUnit: "word",
    wordMode: "latin-word",
  },
  overlayBridgePort: 19741,
  scanLength: 24,
});
overlay.renderSubtitle("L’Homme arrive", 11);
const frenchStart = 0;
const frenchUnit = overlay.lookupUnitForPosition(2);
assert(
  frenchUnit.pos === frenchStart,
  "French apostrophe word should resolve to the word start",
);
assert(
  frenchUnit.preview.text === "L’Homme",
  "French apostrophe word should stay one hover unit",
);

overlay.applyConfig({
  language: {
    id: "de",
    label: "German",
    lookupUnit: "word",
    wordMode: "latin-word",
  },
  overlayBridgePort: 19741,
  scanLength: 24,
});
overlay.renderSubtitle("Die Häuser stehen", 12);
const germanStart = "Die ".length;
const germanUnit = overlay.lookupUnitForPosition(germanStart + 2);
assert(
  germanUnit.pos === germanStart,
  "German umlaut word should resolve to the word start",
);
assert(
  germanUnit.preview.text === "Häuser",
  "German umlaut word should stay one hover unit",
);

overlay.applyConfig({
  language: {
    id: "ja",
    label: "Japanese",
    lookupUnit: "character",
    wordMode: "rightward-prefix",
  },
  overlayBridgePort: 19741,
  scanLength: 24,
});
overlay.renderSubtitle("魔法使い", 21);
enter(0);
context.__handlers["line-lookup-result"]({
  lineId: 21,
  position: 0,
  ok: true,
  result: {
    ok: true,
    text: "魔法使い",
    position: 0,
    lookupStart: 0,
    lookupEnd: 4,
    matchStart: 0,
    language: "ja",
    results: [
      {
        matched: "魔法",
        deinflected: "魔法",
        term: {
          expression: "魔法",
          reading: "",
          glossaries: [{ dict: "Test", glossary: "magic" }],
        },
      },
    ],
  },
});
assert(
  activeMatchPositions().join(",") === "0,1",
  "Japanese successful prefix highlight should stay on the matched text",
);

overlay.renderSubtitle("魔法使い", 2);
const beforeJapanese = lookupMessages().length;
enter(0);
assert(
  activeMatchPositions().join(",") === "0",
  "Japanese loading highlight should stay on the exact character",
);
context.__handlers["line-lookup-result"]({
  lineId: 2,
  position: 0,
  ok: true,
  result: {
    ok: true,
    results: [],
    lookupStart: 0,
    lookupEnd: 1,
    noResult: true,
    noResultReason: "all-candidates-empty",
  },
});
assert(
  activeMatchPositions().join(",") === "0",
  "Japanese no-result should stay on the exact character",
);
enter(0);
assert(
  lookupMessages().length === beforeJapanese + 1,
  "Japanese no-result should be cached for the exact position",
);
enter(1);
const japaneseMessages = lookupMessages().slice(beforeJapanese);
assert(
  japaneseMessages.length === 2,
  "Japanese adjacent characters should remain separate lookup targets",
);
assert(
  japaneseMessages[0].position === 0 && japaneseMessages[1].position === 1,
  "Japanese should send exact character positions",
);

overlay.applyConfig({
  language: {
    id: "zh",
    label: "Chinese",
    lookupUnit: "character",
    wordMode: "rightward-prefix",
  },
  overlayBridgePort: 19741,
  scanLength: 24,
});
overlay.renderSubtitle("我喜欢中文", 3);
const beforeChinese = lookupMessages().length;
enter(0);
assert(
  activeMatchPositions().join(",") === "0",
  "Chinese loading highlight should stay on the exact character",
);
enter(1);
const chineseMessages = lookupMessages().slice(beforeChinese);
assert(
  chineseMessages.length === 2,
  "Chinese adjacent characters should remain separate lookup targets",
);
assert(
  chineseMessages[0].position === 0 && chineseMessages[1].position === 1,
  "Chinese should send exact character positions to the plugin",
);

Object.keys(overlay.state.pendingLookupRequests || {}).forEach((key) => {
  const req = overlay.state.pendingLookupRequests[key];
  if (req.retryTimer) clearInterval(req.retryTimer);
  if (req.timeoutTimer) clearTimeout(req.timeoutTimer);
});

console.log("overlay word unit tests passed");
