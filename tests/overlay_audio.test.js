const {
  assert,
  loadOverlayForTest,
} = require("./helpers/overlay_test_context");

const { context, overlay } = loadOverlayForTest([
  "state",
  "applyConfig",
  "showPopup",
  "renderStoredLookup",
  "audioTermReadingKey",
  "playAudioForTerm",
  "showAudioSourceMenu",
]);

let fetchCalled = false;
context.fetch = async function fetch() {
  fetchCalled = true;
  throw new Error(
    "overlay fetch should not be used when bridge resolves audio",
  );
};

const loaded = [];
const played = [];
context.Audio = function TestAudio(url) {
  this.url = String(url);
  this.readyState = 0;
  this.duration =
    this.url.indexOf(encodeURIComponent("どうしよう")) >= 0 ? 5.67 : 1;
  this.listeners = Object.create(null);
};
context.Audio.prototype.addEventListener = function addEventListener(
  type,
  handler,
) {
  if (!this.listeners[type]) this.listeners[type] = [];
  this.listeners[type].push(handler);
};
context.Audio.prototype.removeEventListener = function removeEventListener(
  type,
  handler,
) {
  if (!this.listeners[type]) return;
  this.listeners[type] = this.listeners[type].filter(
    (item) => item !== handler,
  );
};
context.Audio.prototype._emit = function emit(type) {
  (this.listeners[type] || []).slice().forEach((handler) => handler());
};
context.Audio.prototype.load = function load() {
  loaded.push(this.url);
  setTimeout(() => {
    if (this.url.indexOf("bad") >= 0) {
      this.error = new Error("bad audio");
      this._emit("error");
      return;
    }
    this.readyState = 2;
    this._emit("loadeddata");
  }, 0);
};
context.Audio.prototype.play = function play() {
  played.push(this.url);
  return Promise.resolve();
};
context.Audio.prototype.pause = function pause() {};

overlay.applyConfig({
  language: {
    id: "ja",
    label: "Japanese",
    lookupUnit: "character",
    wordMode: "rightward-prefix",
  },
  audioSources: [
    { url: "http://127.0.0.1:5050/?term={term}&reading={reading}" },
  ],
  overlayBridgePort: 19741,
  hoverRequestTimeoutMs: 5000,
  anki: { enabled: true, configured: true },
});

overlay.showPopup(
  context.document.createElement("span"),
  "読",
  '<div class="loading">Loading...</div>',
);
overlay.renderStoredLookup({
  ok: true,
  position: 0,
  result: {
    ok: true,
    language: "ja",
    results: [
      {
        matched: "読む",
        deinflected: "読む",
        term: { expression: "読む", reading: "よむ", glossaries: [] },
      },
    ],
  },
});

const headHtml = context.__elements.popup.children[0]._innerHTML;
assert(
  /class="audio-button"/.test(headHtml),
  "Lookup result header should render a speaker button when audio sources are configured",
);
assert(
  /data-audio-term="読む"/.test(headHtml),
  "Speaker button should carry the entry headword",
);
assert(
  /data-audio-reading="よむ"/.test(headHtml),
  "Speaker button should carry the entry reading",
);
assert(
  /<svg class="audio-icon"/.test(headHtml),
  "Speaker buttons should use a centered vector icon instead of an emoji glyph",
);

const key = overlay.audioTermReadingKey("読む", "よむ");
const button = context.document.createElement("button");
button.className = "audio-button";
button.dataset.audioKey = key;
context.__elements.popup.appendChild(button);

function respondToAudioSourceRequest(fromIndex, candidates, ok) {
  const message = context.__sent
    .slice(fromIndex)
    .find((item) => item.type === "audio-source");
  assert(
    message,
    "Audio playback should request source JSON over the WebSocket bridge",
  );
  context.__handlers["audio-source-result"]({
    requestId: message.requestId,
    ok: ok !== false,
    candidates: candidates || [],
  });
  return message;
}

(async () => {
  const beforeFirst = context.__sent.length;
  const playPromise = overlay.playAudioForTerm("読む", "よむ", button, {});
  const request = respondToAudioSourceRequest(beforeFirst, [
    { name: "Bad recording", url: "http://127.0.0.1:5050/bad.mp3" },
    { name: "Good recording", url: "http://127.0.0.1:5050/good.mp3" },
    {
      name: "Alternate recording",
      url: "http://127.0.0.1:5050/alternate.mp3",
    },
  ]);
  const ok = await playPromise;
  assert(ok, "Audio playback should succeed when a later candidate works");
  assert(
    request.url.indexOf("term=%E8%AA%AD%E3%82%80") >= 0,
    "Audio source URL should receive the encoded term",
  );
  assert(
    request.url.indexOf("reading=%E3%82%88%E3%82%80") >= 0,
    "Audio source URL should receive the encoded reading",
  );
  assert(
    !fetchCalled,
    "Overlay should not fetch source JSON directly when the bridge resolves audio",
  );
  assert(
    loaded[0].indexOf("bad.mp3") >= 0,
    "The first candidate should be tried before fallback candidates",
  );
  assert(
    played[0] === "http://127.0.0.1:5050/good.mp3",
    "The first working candidate should be played",
  );
  assert(
    button.dataset.audioState === "ready",
    "Successful audio should leave the button available without a missing badge",
  );

  button.dataset.audioTerm = "読む";
  button.dataset.audioReading = "よむ";
  assert(
    overlay.showAudioSourceMenu(button, {
      clientX: 220,
      clientY: 160,
      preventDefault() {},
      stopPropagation() {},
    }),
    "A loaded local source should still open its audio menu",
  );
  const localMenu = context.__body.querySelector(".audio-source-menu");
  const localCandidates = localMenu.querySelectorAll(
    ".audio-source-menu-candidate",
  );
  assert(
    localCandidates.length === 3 &&
      localCandidates[0].textContent === "Local audio 1: Bad recording" &&
      localCandidates[1].textContent === "Local audio 2: Good recording" &&
      localCandidates[2].textContent === "Local audio 3: Alternate recording",
    "The audio menu should expose every named local clip as a Yomitan-style source row",
  );
  const localExportButtons = localMenu.querySelectorAll(
    ".audio-source-menu-export",
  );
  assert(
    localExportButtons.length === 3,
    "Every named local clip should have its own Anki audio selector",
  );
  localExportButtons[2].listeners.click({
    preventDefault() {},
    stopPropagation() {},
  });
  assert(
    overlay.state.audioAnkiSelections[key].sourceIndex === 0 &&
      overlay.state.audioAnkiSelections[key].candidateIndex === 2 &&
      localExportButtons[2].dataset.selected === "true" &&
      context.__body.querySelector(".audio-source-menu") === localMenu,
    "Anki selectors should choose an exact clip without closing the menu",
  );
  localExportButtons[2].listeners.click({
    preventDefault() {},
    stopPropagation() {},
  });
  assert(
    !overlay.state.audioAnkiSelections[key] &&
      localExportButtons[2].dataset.selected === "false",
    "Clicking the selected Anki audio icon again should restore default selection",
  );
  const beforeCandidatePlay = context.__sent.length;
  localCandidates[2].listeners.click({
    preventDefault() {},
    stopPropagation() {},
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert(
    played[played.length - 1] === "http://127.0.0.1:5050/alternate.mp3",
    "Choosing a named local candidate should play that exact clip",
  );
  assert(
    overlay.state.audioAnkiSelections[key].candidateIndex === 2,
    "Playing a context-menu clip should make it the primary Anki audio like Yomitan",
  );
  assert(
    !context.__sent
      .slice(beforeCandidatePlay)
      .some((item) => item.type === "audio-source"),
    "Choosing a cached local candidate should not resolve the source again",
  );

  const missingKey = overlay.audioTermReadingKey("無音", "");
  const missingButton = context.document.createElement("button");
  missingButton.className = "audio-button";
  missingButton.dataset.audioKey = missingKey;
  context.__elements.popup.appendChild(missingButton);
  const beforeMissing = context.__sent.length;
  const missingPromise = overlay.playAudioForTerm(
    "無音",
    "",
    missingButton,
    {},
  );
  respondToAudioSourceRequest(beforeMissing, []);
  const missing = await missingPromise;
  assert(!missing, "Empty audio source JSON should report missing audio");
  assert(
    missingButton.dataset.audioState === "missing",
    "Missing audio should mark the speaker with the missing badge state",
  );

  overlay.applyConfig({
    audioSources: [
      {
        name: "LanguagePod101",
        url: "https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji={term}&kana={reading}",
      },
    ],
  });
  const directKey = overlay.audioTermReadingKey("読む", "よむ");
  const directButton = context.document.createElement("button");
  directButton.className = "audio-button";
  directButton.dataset.audioKey = directKey;
  context.__elements.popup.appendChild(directButton);
  const beforeDirect = context.__sent.length;
  const directPromise = overlay.playAudioForTerm(
    "読む",
    "よむ",
    directButton,
    {},
  );
  const directRequest = respondToAudioSourceRequest(beforeDirect, [], false);
  const direct = await directPromise;
  assert(direct, "Non-JSON source URLs should be tried directly as audio");
  assert(
    directRequest.url.indexOf("audiomp3.php") >= 0,
    "Direct audio source templates should be sent to the bridge before fallback",
  );
  assert(
    directRequest.url.indexOf("kanji=%E8%AA%AD%E3%82%80") >= 0,
    "Direct audio source URL should encode the term",
  );
  assert(
    directRequest.url.indexOf("kana=%E3%82%88%E3%82%80") >= 0,
    "Direct audio source URL should encode the reading",
  );
  assert(
    played[played.length - 1] === directRequest.url,
    "Direct audio fallback should play the templated source URL",
  );
  assert(
    directButton.dataset.audioState === "ready",
    "Direct audio fallback should leave the button ready",
  );

  overlay.applyConfig({
    audioSources: [
      {
        name: "JapanesePod101",
        url: "https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji={term}&kana={reading}",
      },
      { name: "Backup", url: "https://audio.invalid/{term}.mp3" },
    ],
  });
  const unavailableButton = context.document.createElement("button");
  unavailableButton.className = "audio-button";
  unavailableButton.dataset.audioKey = overlay.audioTermReadingKey(
    "どうしよう",
    "どうしよう",
  );
  context.__elements.popup.appendChild(unavailableButton);
  const beforeUnavailable = context.__sent.length;
  const unavailablePromise = overlay.playAudioForTerm(
    "どうしよう",
    "どうしよう",
    unavailableButton,
    {},
  );
  respondToAudioSourceRequest(beforeUnavailable, [], false);
  const usedBackup = await unavailablePromise;
  assert(
    usedBackup &&
      played[played.length - 1].indexOf("audio.invalid") >= 0 &&
      unavailableButton.dataset.audioState === "ready",
    "JapanesePod101's unavailable placeholder should fall through to the next source",
  );

  overlay.applyConfig({
    audioSources: [
      {
        name: "JapanesePod101",
        url: "https://japanese.example.invalid/audio.mp3?term={term}",
      },
      {
        url: "https://assets.languagepod101.com/dictionary/japanese/audiomp3.php?kanji={term}&kana={reading}",
      },
      { url: "http://127.0.0.1:5050/?term={term}&reading={reading}" },
    ],
  });
  const menuButton = context.document.createElement("button");
  menuButton.className = "audio-button";
  menuButton.dataset.audioTerm = "読む";
  menuButton.dataset.audioReading = "よむ";
  context.__elements.popup.appendChild(menuButton);
  let menuPrevented = false;
  const menuOpened = overlay.showAudioSourceMenu(menuButton, {
    clientX: 220,
    clientY: 160,
    preventDefault() {
      menuPrevented = true;
    },
    stopPropagation() {},
  });
  assert(
    menuOpened,
    "Right-clicking an audio button should open the source menu",
  );
  assert(
    menuPrevented,
    "Audio source menu should suppress the native context menu",
  );
  const menu = context.__body.querySelector(".audio-source-menu");
  assert(menu, "Audio source menu should be rendered");
  assert(
    !context.__elements.popup.querySelector(".audio-source-menu"),
    "Audio source menu should render outside the popup to avoid clipping",
  );
  assert(
    menu.getAttribute("data-clickable") === "true",
    "Floating audio source menus should be marked clickable for IINA",
  );
  const items = menu.querySelectorAll(".audio-source-menu-item");
  assert(
    items.length === 3,
    "Audio source menu should list configured sources",
  );
  assert(
    items[0].textContent === "JapanesePod101",
    "Named audio sources should use their configured name",
  );
  assert(
    items[1].textContent === "languagepod101.com",
    "Unnamed web audio sources should use a readable host label",
  );
  assert(
    items[2].textContent === "Local audio",
    "The local Anki source should use a readable label",
  );
  const exportButtons = menu.querySelectorAll(".audio-source-menu-export");
  exportButtons[2].listeners.click({
    preventDefault() {},
    stopPropagation() {},
  });
  const sourceSelection =
    overlay.state.audioAnkiSelections[
      overlay.audioTermReadingKey("読む", "よむ")
    ];
  assert(
    sourceSelection.sourceIndex === 2 &&
      sourceSelection.candidateIndex === null &&
      exportButtons[2].dataset.selected === "true",
    "An unresolved source-level Anki selector should choose its first available clip",
  );
  items.forEach((item) =>
    assert(
      item.getAttribute("data-clickable") === "true",
      "Floating audio source menu items should be marked clickable for IINA",
    ),
  );
  assert(
    !items[0].focused,
    "Opening the audio source menu should not keep the first item highlighted by focus",
  );
  context.__elements.popup.listeners.mouseleave({});
  assert(
    overlay.state.hideTimer,
    "Leaving the popup for the source menu should start the normal hide timer",
  );
  menu.listeners.mouseenter({});
  assert(
    !overlay.state.hideTimer,
    "Hovering the source menu should keep the popup open",
  );

  const beforeMenuPlay = context.__sent.length;
  items[1].listeners.click({ preventDefault() {}, stopPropagation() {} });
  const menuRequest = respondToAudioSourceRequest(beforeMenuPlay, [], false);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert(
    menuRequest.url.indexOf("languagepod101.com") >= 0,
    "Choosing a menu item should play only that source",
  );
  assert(
    played[played.length - 1] === menuRequest.url,
    "Chosen direct audio source should be played",
  );
  assert(
    !context.__body.querySelector(".audio-source-menu"),
    "Choosing a source should close the menu",
  );

  overlay.showPopup(
    context.document.createElement("span"),
    "新しい語",
    '<div class="loading">Loading...</div>',
  );
  assert(
    Object.keys(overlay.state.audioAnkiSelections).length === 0,
    "Opening a new popup should discard all primary Anki audio choices",
  );

  console.log("overlay audio tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
