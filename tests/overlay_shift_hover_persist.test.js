const {
  assert,
  loadOverlayForTest,
} = require("./helpers/overlay_test_context");

function load(mode) {
  const loaded = loadOverlayForTest([
    "state",
    "applyConfig",
    "showPopup",
    "hidePopup",
  ]);
  loaded.overlay.applyConfig({
    subtitleLookupMode: mode,
    popupScale: 1,
    overlayBridgePort: 19743,
  });
  loaded.overlay.state.enabled = true;
  return loaded;
}

function show(context, overlay) {
  overlay.showPopup(
    context.document.createElement("span"),
    "食べる",
    '<div class="gloss">to eat</div>',
  );
}

const { context, overlay } = load("shift-hover");
const popup = context.__elements.popup;
const guard = context.__elements["popup-dismiss-guard"];
const mousedown = context.__handlers["document:mousedown"];
const keydown = context.__handlers["document:keydown"];
assert(
  typeof mousedown === "function",
  "Shift-hover dismissal needs a document mousedown listener",
);

show(context, overlay);
popup.listeners.mouseleave({ target: popup });
guard.listeners.mouseenter({ target: guard });
guard.listeners.mousemove({ target: guard });
assert(
  overlay.state.hideTimer === null,
  "Leaving a Shift-hover popup after releasing Shift must not schedule dismissal",
);

setTimeout(() => {
  assert(
    !popup.classList.contains("hidden") && overlay.state.lookupPopupVisible,
    "A Shift-hover popup should stay open, keeping playback paused, after hover-away",
  );

  mousedown({ target: popup, shiftKey: false });
  assert(
    overlay.state.lookupPopupVisible,
    "Clicking inside the popup must not dismiss it",
  );

  const word = context.document.createElement("div");
  word.dataset.pos = "3";
  mousedown({ target: word, shiftKey: true });
  assert(
    overlay.state.lookupPopupVisible,
    "A Shift-click on a subtitle word is a lookup and must not dismiss the popup",
  );

  mousedown({ target: word, shiftKey: false });
  assert(
    popup.classList.contains("hidden") && !overlay.state.lookupPopupVisible,
    "A plain click on a subtitle word should dismiss the Shift-hover popup",
  );

  show(context, overlay);
  mousedown({ target: guard, shiftKey: false });
  assert(
    !overlay.state.lookupPopupVisible && guard.classList.contains("hidden"),
    "Clicking the video should dismiss the Shift-hover popup and drop the guard",
  );

  show(context, overlay);
  popup.listeners.mouseleave({ target: popup, shiftKey: true });
  assert(
    overlay.state.hideTimer,
    "Leaving the popup while holding Shift should still schedule dismissal",
  );
  overlay.hidePopup();

  show(context, overlay);
  guard.listeners.mousemove({ target: guard, shiftKey: false });
  assert(
    overlay.state.hideTimer === null,
    "Moving over empty space without Shift should keep the popup",
  );
  guard.listeners.mousemove({ target: guard, shiftKey: true });
  assert(
    overlay.state.hideTimer,
    "Pressing Shift over empty space should dismiss a popup kept open earlier",
  );
  overlay.hidePopup();

  show(context, overlay);
  keydown({ key: "Escape" });
  assert(
    !overlay.state.lookupPopupVisible,
    "Escape should dismiss the Shift-hover popup",
  );

  const hover = load("hover");
  show(hover.context, hover.overlay);
  hover.context.__elements.popup.listeners.mouseleave({});
  assert(
    hover.overlay.state.hideTimer,
    "Plain hover mode should keep dismissing on hover-away",
  );
  hover.context.__handlers["document:mousedown"]({
    target: hover.context.__elements["subtitle"],
    shiftKey: false,
  });
  assert(
    hover.overlay.state.lookupPopupVisible,
    "Plain hover mode should not add click-away dismissal on subtitle clicks",
  );
  hover.overlay.hidePopup();
  console.log("overlay Shift-hover persistence tests passed");
}, 300);
