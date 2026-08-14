const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "dev/popup-preview.html"), "utf8");
const previewJs = fs.readFileSync(
  path.join(root, "dev/popup-preview.js"),
  "utf8",
);
const overlayJs = fs.readFileSync(
  path.join(root, "src/overlay/overlay.js"),
  "utf8",
);
const dataJs = fs.readFileSync(
  path.join(root, "dev/popup-preview-data.js"),
  "utf8",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  /href="\.\.\/src\/overlay\/overlay\.css"/.test(html) &&
    /src="\.\.\/src\/overlay\/overlay\.js"/.test(html),
  "Popup preview should load the production overlay CSS and renderer directly",
);
assert(
  /src="popup-preview-data\.js"/.test(html) &&
    /src="popup-preview\.js"/.test(html),
  "Popup preview should load its hardcoded fixtures and browser controls",
);
assert(
  /window\.__IINATAN_POPUP_PREVIEW__ = true/.test(html) &&
    /function installPopupPreviewApi\(\)/.test(overlayJs) &&
    /window\.IINATAN_POPUP_PREVIEW_API = Object\.freeze/.test(overlayJs),
  "Production renderer should expose an explicitly gated preview entry point",
);
assert(
  /function scheduleHidePopup\(\) \{\s*if \(window\.__IINATAN_POPUP_PREVIEW__\) return;/.test(
    overlayJs,
  ),
  "Popup preview should remain visible when the pointer moves to its controls",
);
assert(
  /api\.applyConfig\(popupConfig\(\)\)/.test(previewJs) &&
    /api\.renderLookup\(fixture\.payload\)/.test(previewJs),
  "Preview controls should render fixtures through the production API",
);
assert(
  /localStorage\.setItem\(storageKey, value\)/.test(previewJs) &&
    /preview-user-css/.test(html),
  "Temporary CSS overrides should apply live and persist locally",
);

const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
assert(
  new Set(ids).size === ids.length,
  "Popup preview element IDs should remain unique",
);

const fixtureContext = { window: {} };
vm.createContext(fixtureContext);
vm.runInContext(dataJs, fixtureContext);
const fixtures = fixtureContext.window.IINATAN_POPUP_PREVIEW_FIXTURES;
assert(
  Array.isArray(fixtures) && fixtures.length >= 4,
  "Popup preview should include several hardcoded lookup fixtures",
);
fixtures.forEach((fixture) => {
  assert(
    fixture &&
      fixture.payload &&
      fixture.payload.ok === true &&
      Array.isArray(fixture.payload.results) &&
      fixture.payload.results.length > 0,
    `Popup preview fixture ${String(fixture && fixture.id)} should contain usable HoshiDicts results`,
  );
});
assert(
  fixtures.some((fixture) => fixture.word === "掛ける") &&
    fixtures.some((fixture) => fixture.word === "適度"),
  "Popup preview should cover both a dense polysemous word and structured POS chips",
);

console.log("popup preview tests passed");
