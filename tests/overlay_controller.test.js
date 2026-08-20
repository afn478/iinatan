const {
  assert,
  loadOverlayForTest,
  lookupCharacterPolicies,
} = require("./helpers/overlay_test_context");

const { context, overlay } = loadOverlayForTest([
  "state",
  "applyConfig",
  "renderSubtitle",
  "normalizeControllerGamepad",
  "controllerActionForButton",
  "dispatchControllerButton",
  "controllerDirectionFromAxes",
  "processControllerSnapshot",
  "resetControllerInput",
  "resetControllerEntrySelection",
  "startControllerHold",
  "updateControllerHold",
  "finishControllerHold",
  "hidePopup",
]);

function snapshot(buttons, axes) {
  return {
    buttons: Object.assign({}, buttons || {}),
    axes: Object.assign({ leftY: 0, rightX: 0, rightY: 0 }, axes || {}),
  };
}

function controllerMessages() {
  return context.__sent.filter(
    (message) => message.type === "controller-subtitle-seek",
  );
}

overlay.state.enabled = true;
overlay.applyConfig({
  language: {
    id: "en",
    lookupUnit: "word",
    wordMode: "latin-word",
    lookupCharacterPolicy: lookupCharacterPolicies.latinWord,
  },
  experimentalNativeSubtitleHitLayer: false,
  controllerWindowActive: true,
  controllerEnabled: true,
  overlayBridgePort: 19741,
  audioSources: [{ name: "Test audio", url: "https://audio/{term}.mp3" }],
});
overlay.state.controller.suppressUntilNeutral = false;

overlay.applyConfig({
  controllerBindings: {
    noPopup: { faceSouth: "togglePause" },
    withPopup: { back: "close-popup" },
    audioList: { primary: "audio-activate" },
  },
});
assert(
  overlay.controllerActionForButton("faceSouth", "noPopup") === "togglePause" &&
    overlay.controllerActionForButton("faceSouth", "withPopup") ===
      "selectEntry" &&
    overlay.controllerActionForButton("faceSouth", "audioList") ===
      "audioActivate",
  "Controller assignments should accept profile button and action names independently for each context",
);
assert(
  overlay.controllerActionForButton("faceEast", "withPopup") === "closePopup",
  "Legacy profile button names should map to canonical face buttons",
);
overlay.applyConfig({
  controllerBindings: { withPopup: { primary: "lookup" } },
});
assert(
  overlay.controllerActionForButton("faceSouth", "withPopup") === "selectEntry",
  "Popup lookup assignment should dispatch the selected-entry action",
);
overlay.applyConfig({ controllerBindings: undefined });

const standardButtons = Array.from({ length: 16 }, () => ({
  pressed: false,
  value: 0,
}));
standardButtons[0] = { pressed: true, value: 1 };
standardButtons[4] = { pressed: true, value: 1 };
const normalized = overlay.normalizeControllerGamepad({
  connected: true,
  mapping: "standard",
  buttons: standardButtons,
  axes: [0.1, -0.75, 0.8, -0.9],
});
assert(
  normalized.buttons.primary && normalized.buttons.leftShoulder,
  "The standard mapping should normalize face and shoulder buttons",
);
assert(
  overlay.normalizeControllerGamepad({
    mapping: "standard",
    connected: true,
    buttons: standardButtons.map((button, index) =>
      index === 2 ? { pressed: true, value: 1 } : button,
    ),
    axes: [0, 0, 0, 0],
  }).buttons.square,
  "The standard mapping should normalize Square separately from Cross",
);
assert(
  normalized.axes.leftY === -0.75 && normalized.axes.rightX === 0.8,
  "The standard mapping should normalize both sticks",
);
assert(
  overlay.normalizeControllerGamepad({ mapping: "", connected: true }) === null,
  "Non-standard controllers should be ignored",
);
const rawMacosControllerButtons = Array.from({ length: 16 }, () => ({
  pressed: false,
  value: 0,
}));
assert(
  overlay.normalizeControllerGamepad({
    id: "Generic macOS Controller",
    mapping: "",
    connected: true,
    buttons: rawMacosControllerButtons,
    axes: [0, 0, 0, 0],
  }),
  "WebKit should accept a raw macOS controller layout when it omits mapping",
);
assert(
  overlay.controllerDirectionFromAxes(0.2, 0.2) === "" &&
    overlay.controllerDirectionFromAxes(-0.8, 0.1) === "left" &&
    overlay.controllerDirectionFromAxes(0.1, 0.9) === "down",
  "Right-stick direction should honor the dead zone and dominant axis",
);

overlay.renderSubtitle("Hello, world", 1);
assert(
  context.__elements.popup.querySelectorAll(".controller-selected-entry")
    .length === 0,
  "Rendering a popup must not expose an implicit controller selection",
);
overlay.processControllerSnapshot(snapshot({ primary: true }), 100, 16);
assert(
  overlay.state.currentPos === 0,
  "Cross should open the first lookupable word when the popup is closed",
);
assert(
  context.__sent.some(
    (message) => message.type === "lookup" && message.position === 0,
  ),
  "Cross lookup should use the existing lookup bridge",
);
overlay.processControllerSnapshot(snapshot(), 116, 16);
overlay.processControllerSnapshot(snapshot({ square: true }), 124, 8);
assert(
  context.__sent.some((message) => message.type === "controller-toggle-pause"),
  "Square should request a plain playback pause/resume toggle",
);
overlay.processControllerSnapshot(snapshot(), 128, 4);
overlay.processControllerSnapshot(snapshot({}, { rightX: 0.9 }), 132, 16);
assert(
  overlay.state.currentPos === 7,
  "Right stick right should advance to the next Latin word",
);
overlay.processControllerSnapshot(snapshot({}, { rightX: 0.9 }), 160, 28);
assert(
  overlay.state.currentPos === 7,
  "A held right stick should wait for the repeat delay",
);

overlay.processControllerSnapshot(snapshot(), 180, 20);
overlay.processControllerSnapshot(snapshot({ leftShoulder: true }), 200, 20);
overlay.processControllerSnapshot(snapshot({ leftShoulder: true }), 240, 40);
assert(
  controllerMessages().length === 1 && controllerMessages()[0].direction === -1,
  "L1 should send one previous-subtitle action per press",
);
assert(
  !overlay.state.lookupPopupVisible,
  "A shoulder subtitle seek should dismiss the lookup popup first",
);
overlay.processControllerSnapshot(snapshot(), 260, 20);
overlay.processControllerSnapshot(snapshot({ rightShoulder: true }), 280, 20);
assert(
  controllerMessages().length === 2 && controllerMessages()[1].direction === 1,
  "R1 should send the next-subtitle action",
);

overlay.renderSubtitle("Alpha beta", 2);
overlay.processControllerSnapshot(snapshot(), 300, 20);
overlay.processControllerSnapshot(snapshot({ primary: true }), 320, 20);
const entry0 = context.document.createElement("div");
const entry1 = context.document.createElement("div");
entry0.className = "entry";
entry1.className = "entry";
context.__elements.popup.appendChild(entry0);
context.__elements.popup.appendChild(entry1);
overlay.resetControllerEntrySelection();
overlay.processControllerSnapshot(snapshot(), 340, 20);
overlay.processControllerSnapshot(snapshot({ dpadRight: true }), 360, 20);
assert(
  overlay.state.controller.selectedEntryIndex === 1 &&
    entry1.classList.contains("controller-selected-entry"),
  "D-pad right should select the next entry without depending on scroll",
);
const beforeScroll = Number(context.__elements.popup.scrollTop || 0);
overlay.processControllerSnapshot(snapshot(), 380, 20);
overlay.processControllerSnapshot(snapshot({ dpadDown: true }), 400, 20);
assert(
  context.__elements.popup.scrollTop === beforeScroll + 52 &&
    overlay.state.controller.selectedEntryIndex === 1,
  "D-pad down should scroll one notch without changing the selected entry",
);

const head = context.__elements.popup.querySelector(".head");
const audioButton = context.document.createElement("button");
audioButton.className = "audio-button";
audioButton.dataset.audioTerm = "Alpha";
audioButton.dataset.audioReading = "";
let shortAudioPresses = 0;
audioButton.addEventListener("click", () => shortAudioPresses++);
head.appendChild(audioButton);
overlay.state.controller.selectedEntryIndex = 0;
assert(
  overlay.startControllerHold("audio-menu", 1000),
  "Triangle should start a hold when selected-entry audio exists",
);
overlay.updateControllerHold(1500);
overlay.finishControllerHold("audio-menu");
assert(
  shortAudioPresses === 1,
  "Releasing Triangle before 650 ms should play selected-entry audio",
);
assert(
  overlay.startControllerHold("audio-menu", 2000),
  "Triangle should support another hold after release",
);
overlay.updateControllerHold(2650);
assert(
  overlay.state.audioSourceMenu,
  "Holding Triangle for 650 ms should open the audio-source menu",
);
overlay.finishControllerHold("audio-menu");
assert(
  shortAudioPresses === 1,
  "Completing a Triangle hold should suppress the short-press action",
);

overlay.state.config.controllerWindowActive = false;
overlay.state.controller.suppressUntilNeutral = false;
const lookupCount = context.__sent.filter(
  (message) => message.type === "lookup",
).length;
overlay.processControllerSnapshot(snapshot({ primary: true }), 3000, 16);
overlay.state.config.controllerWindowActive = true;
overlay.processControllerSnapshot(snapshot({ primary: true }), 3016, 16);
assert(
  context.__sent.filter((message) => message.type === "lookup").length ===
    lookupCount,
  "Controller input should remain gated until release after an inactive window",
);
overlay.hidePopup();

overlay.resetControllerInput();
overlay.processControllerSnapshot(snapshot(), 3080, 16);
overlay.processControllerSnapshot(snapshot({ dpadLeft: true }), 3100, 20);
overlay.processControllerSnapshot(snapshot(), 3120, 20);
overlay.processControllerSnapshot(snapshot({ dpadRight: true }), 3140, 20);
const videoSeeks = context.__sent.filter(
  (message) => message.type === "controller-video-seek",
);
assert(
  videoSeeks.some((message) => message.seconds === -5) &&
    videoSeeks.some((message) => message.seconds === 5),
  "No-popup d-pad left and right should request short video seeks",
);

overlay.applyConfig({
  controllerBindings: {
    noPopup: { dpadLeft: "seekBackwardLong" },
    withPopup: { dpadLeft: "closePopup" },
    audioList: { dpadLeft: "audioNextColumn" },
  },
});
overlay.state.audioSourceMenu = {};
assert(
  overlay.controllerActionForButton("faceSouth") === "audioActivate",
  "The audio-list context should override the same button assignment from broader contexts",
);
overlay.state.audioSourceMenu = null;
overlay.resetControllerInput();
overlay.processControllerSnapshot(snapshot(), 3160, 16);
overlay.processControllerSnapshot(snapshot({ dpadLeft: true }), 3180, 20);
assert(
  context.__sent.some(
    (message) =>
      message.type === "controller-video-seek" && message.seconds === -60,
  ),
  "A custom no-popup binding should dispatch its configured video seek",
);

overlay.state.config.controllerWindowActive = true;
overlay.resetControllerInput();
overlay.processControllerSnapshot(snapshot(), 3100, 16);
overlay.processControllerSnapshot(snapshot({ back: true }), 3120, 20);
assert(
  context.__sent.some(
    (message) => message.type === "controller-resume-playback",
  ),
  "Circle should request playback resume when no popup context is open",
);

console.log("overlay controller tests passed");
