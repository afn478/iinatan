const {
  assert,
  loadOverlayForTest,
} = require("./helpers/overlay_test_context");

const { context, overlay } = loadOverlayForTest([
  "state",
  "applyConfig",
  "showPopup",
  "hidePopup",
]);

overlay.applyConfig({ popupScale: 1, overlayBridgePort: 19742 });
overlay.state.enabled = true;

const popup = context.__elements.popup;
const guard = context.__elements["popup-dismiss-guard"];
assert(
  guard.getAttribute("data-clickable") === "true",
  "The dismiss guard must be clickable so IINA routes off-popup moves to the overlay",
);
assert(
  guard.classList.contains("hidden"),
  "The dismiss guard should start hidden so video clicks pass through",
);

function show() {
  overlay.showPopup(
    context.document.createElement("span"),
    "食べる",
    '<div class="gloss">to eat</div>',
  );
}

show();
assert(
  !guard.classList.contains("hidden"),
  "Showing the popup should raise the dismiss guard",
);
overlay.hidePopup();
assert(
  guard.classList.contains("hidden"),
  "Hiding the popup should drop the dismiss guard",
);

show();
guard.listeners.mousedown({ target: guard });
assert(
  popup.classList.contains("hidden") && guard.classList.contains("hidden"),
  "Clicking the video while the popup is open should dismiss it immediately",
);

show();
guard.listeners.mouseenter({ target: guard });
assert(
  overlay.state.hideTimer,
  "Moving off the popup onto the video should schedule the hover dismissal",
);
setTimeout(() => {
  assert(
    popup.classList.contains("hidden") && guard.classList.contains("hidden"),
    "The hover dismissal should hide the popup and the guard",
  );
  assert(
    overlay.state.hideTimer === null,
    "A fired hover dismissal should clear its timer",
  );

  show();
  guard.listeners.mousemove({ target: guard });
  assert(
    overlay.state.hideTimer,
    "A move over the guard without a prior enter should still schedule dismissal",
  );
  const pending = overlay.state.hideTimer;
  guard.listeners.mousemove({ target: guard });
  assert(
    overlay.state.hideTimer === pending,
    "Continued movement over the video must not keep postponing dismissal",
  );
  overlay.hidePopup();
  console.log("overlay popup dismiss guard tests passed");
}, 300);
