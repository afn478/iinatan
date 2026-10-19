const {
  assert,
  loadOverlayForTest,
} = require("./helpers/overlay_test_context");

const { context, overlay } = loadOverlayForTest(["state", "applyConfig"]);
overlay.applyConfig({ popupScale: 1, overlayBridgePort: 19743 });
overlay.state.enabled = true;

const popup = context.__elements.popup;
popup.scrollTop = 0;
// The real popup is drawn with transform: scale(0.92), so client rects are
// scaled while scrollTop is not. The fake popup rect is 120px tall on screen.
const scale = 0.92;
popup.offsetHeight = 120 / scale;
// Content offsets inside the popup; the popup head occupies 0-76px. Entry
// rects follow scrollTop so the test sees the layout a real scroll produces.
const layout = [
  [76, 290],
  [300, 800],
  [810, 1400],
];
const entries = layout.map(([top, bottom]) => {
  const entry = context.document.createElement("div");
  entry.classList.add("entry");
  Object.defineProperty(entry, "_rect", {
    get() {
      const offset = Number(popup.scrollTop || 0);
      return {
        left: 0,
        right: 260,
        top: (top - offset) * scale,
        bottom: (bottom - offset) * scale,
        width: 260,
        height: (bottom - top) * scale,
      };
    },
  });
  popup.appendChild(entry);
  return entry;
});
popup.classList.remove("hidden");
overlay.state.lookupPopupVisible = true;

const keydown = context.__handlers["document:keydown"];
function press(key, modifiers) {
  let prevented = false;
  keydown(
    Object.assign(
      {
        key,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        preventDefault() {
          prevented = true;
        },
      },
      modifiers || {},
    ),
  );
  return prevented;
}
function selected() {
  assert(
    entries.every(
      (entry) => !entry.classList.contains("controller-selected-entry"),
    ),
    "Keyboard entry navigation must not draw the gamepad selection outline",
  );
  return overlay.state.selectedEntryIndex;
}
// Browsers snap scrollTop to device pixels; the fake DOM keeps float error.
const near = (expected) => Math.abs(popup.scrollTop - expected) < 0.5;
const down = () => press("ArrowDown", { altKey: true });
const up = () => press("ArrowUp", { altKey: true });

assert(
  !press("ArrowDown") && selected() === -1,
  "A plain arrow key should keep native scrolling",
);
assert(
  down() && selected() === 1 && near(300),
  "Option+Down should pin the next entry's headword to the popup top",
);
assert(
  down() && selected() === 2 && near(810),
  "Option+Down should keep stepping entry by entry",
);
assert(
  up() && selected() === 1 && near(300),
  "Option+Up should return to the previous entry's headword",
);
assert(
  up() && selected() === 0 && near(0),
  "Option+Up to the first entry should reveal its headword at the very top",
);
assert(
  up() && selected() === 0 && near(0),
  "Option+Up should stop at the first entry",
);

popup.scrollTop = 550;
assert(
  up() && selected() === 1 && near(300),
  "Option+Up from inside an entry should return to that entry's headword",
);
popup.scrollTop = 0;
assert(
  down() && selected() === 1 && near(300),
  "After a manual scroll back up, Option+Down should step from the view",
);
popup.scrollTop = 1000;
assert(
  down() && selected() === 2 && near(1000),
  "Option+Down inside the last entry should not scroll back to its headword",
);

overlay.state.lookupPopupVisible = false;
assert(
  !down(),
  "Option+Down should not be captured while the popup is closed",
);
