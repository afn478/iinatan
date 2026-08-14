(function () {
  const fixtures = Array.isArray(window.IINATAN_POPUP_PREVIEW_FIXTURES)
    ? window.IINATAN_POPUP_PREVIEW_FIXTURES
    : [];
  const api = window.IINATAN_POPUP_PREVIEW_API;
  if (!api || !fixtures.length) {
    document.body.dataset.previewState = "error";
    document.getElementById("preview-error").textContent =
      "Preview assets are missing. Run npm run preview:data, then reload.";
    return;
  }

  const elements = {
    fixture: document.getElementById("fixture-select"),
    theme: document.getElementById("theme-select"),
    width: document.getElementById("width-input"),
    widthValue: document.getElementById("width-value"),
    height: document.getElementById("height-input"),
    heightValue: document.getElementById("height-value"),
    entries: document.getElementById("entries-input"),
    glosses: document.getElementById("glosses-input"),
    description: document.getElementById("fixture-description"),
    resultSummary: document.getElementById("result-summary"),
    css: document.getElementById("custom-css"),
    cssStyle: document.getElementById("preview-user-css"),
    resetCss: document.getElementById("reset-css"),
    rawData: document.getElementById("raw-data"),
    rawDataText: document.getElementById("raw-data-text"),
  };
  const storageKey = "iinatan-popup-preview-css";

  fixtures.forEach((fixture) => {
    const option = document.createElement("option");
    option.value = fixture.id;
    option.textContent = fixture.label;
    elements.fixture.appendChild(option);
  });

  function activeFixture() {
    return (
      fixtures.find((fixture) => fixture.id === elements.fixture.value) ||
      fixtures[0]
    );
  }

  function popupConfig() {
    return {
      popupTheme: elements.theme.value,
      popupScale: 1,
      popupMaxWidth: Number(elements.width.value),
      popupMaxHeightVh: Number(elements.height.value),
      maxEntries: Number(elements.entries.value),
      maxGlossesPerEntry: Number(elements.glosses.value),
      nestedPopupMode: "off",
      experimentalNativeSubtitleHitLayer: false,
      audioAutoPlay: false,
      audioSources: [
        {
          url: "https://preview.invalid/audio?term={term}&reading={reading}",
        },
      ],
      anki: {
        enabled: true,
        configured: true,
        duplicateCheck: false,
        duplicateMode: "allow",
      },
    };
  }

  function render() {
    const fixture = activeFixture();
    api.applyConfig(popupConfig());
    document.documentElement.style.setProperty(
      "--popup-max-height",
      `${elements.height.value}vh`,
    );
    const result = api.renderLookup(fixture.payload);
    elements.description.textContent = fixture.description;
    elements.resultSummary.textContent = `${result.resultCount} lookup result${result.resultCount === 1 ? "" : "s"} · ${fixture.payload.results.reduce((count, entry) => count + ((entry.term && entry.term.glossaries) || []).length, 0)} dictionary entries in fixture`;
    elements.rawDataText.textContent = JSON.stringify(fixture.payload, null, 2);
    elements.widthValue.textContent = `${elements.width.value}px`;
    elements.heightValue.textContent = `${elements.height.value}vh`;
  }

  function applyCustomCss(value) {
    elements.cssStyle.textContent = value;
    try {
      localStorage.setItem(storageKey, value);
    } catch (_) {}
  }

  elements.fixture.addEventListener("change", render);
  elements.theme.addEventListener("change", render);
  elements.width.addEventListener("input", render);
  elements.height.addEventListener("input", render);
  elements.entries.addEventListener("change", render);
  elements.glosses.addEventListener("change", render);
  elements.css.addEventListener("input", () =>
    applyCustomCss(elements.css.value),
  );
  elements.resetCss.addEventListener("click", () => {
    elements.css.value = "";
    applyCustomCss("");
  });

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest(".audio-button, .anki-button");
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (button.classList.contains("anki-button")) {
        const added = button.dataset.ankiState === "added";
        button.dataset.ankiState = added ? "ready" : "added";
        button.title = added ? "Add Anki card" : "Preview card added";
      } else {
        button.dataset.audioState =
          button.dataset.audioState === "playing" ? "ready" : "playing";
      }
    },
    true,
  );

  let savedCss = "";
  try {
    savedCss = localStorage.getItem(storageKey) || "";
  } catch (_) {}
  elements.css.value = savedCss;
  elements.cssStyle.textContent = savedCss;
  elements.fixture.value = fixtures[0].id;
  render();
  document.body.dataset.previewState = "ready";
})();
