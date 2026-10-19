const {
  assert,
  loadOverlayForTest,
} = require("./helpers/overlay_test_context");

const { context, overlay } = loadOverlayForTest(["state", "applyConfig"]);
overlay.applyConfig({ popupScale: 1, overlayBridgePort: 19743 });
overlay.state.enabled = true;

const popup = context.__elements.popup;
// The popup viewport spans 0-120px; the reader has scrolled past entry 0.
const rects = [
  [-220, -20],
  [0, 100],
  [110, 400],
];
const entries = rects.map(([top, bottom]) => {
  const entry = context.document.createElement("div");
  entry.classList.add("entry");
  entry._rect = {
    left: 0,
    right: 260,
    top,
    bottom,
    width: 260,
    height: bottom - top,
  };
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
  return entries.findIndex((entry) =>
    entry.classList.contains("controller-selected-entry"),
  );
}

assert(
  !press("ArrowDown") && selected() === -1,
  "A plain arrow key should keep native scrolling",
);
assert(
  press("ArrowDown", { altKey: true }) && selected() === 2,
  "Option+Down should jump from the most visible entry to the next one",
);
assert(
  popup.scrollTop === 110 && !entries[2].scrolledIntoView,
  "Option+Down should pin the next entry's top to the popup top",
);
assert(
  press("ArrowUp", { altKey: true }) && selected() === 1,
  "Option+Up should return to the previous entry",
);
assert(
  press("ArrowUp", { altKey: true }) && selected() === 0,
  "Option+Up should reach the first entry",
);
assert(
  popup.scrollTop === 0,
  "Returning to the first entry should scroll back to its headword at the very top",
);
assert(
  press("ArrowUp", { altKey: true }) && selected() === 0,
  "Option+Up should stop at the first entry",
);

overlay.state.lookupPopupVisible = false;
assert(
  !press("ArrowDown", { altKey: true }),
  "Option+Down should not be captured while the popup is closed",
);
