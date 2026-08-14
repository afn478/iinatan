(function () {
  const subtitleEl = document.getElementById("subtitle");
  let nativeSubtitleHostEl = null;
  let nativeSubtitleShadowRoot = null;
  let nativeSubtitleCopyEl = null;
  let nativeSubtitleMatchHighlightsEl = null;
  let nativeSubtitleHitBoxesEl = null;
  let nativeSubtitleFontFingerprint = "";
  let nativeSubtitleLocalFont = null;
  let nativeSubtitleLocalFontGeneration = 0;
  const popupEl = document.getElementById("popup");
  const nestedPopupLayerEl = document.getElementById("nested-popup-layer");
  const popupSafetyZoneEl = document.getElementById("popup-safety-zone");
  const popupRowSafetyZoneEl = document.getElementById("popup-row-safety-zone");
  const statusEl = document.getElementById("status");
  const bitmapOcrStatusEl = document.getElementById("bitmap-ocr-status");
  const taskEl = document.getElementById("task");

  const state = {
    enabled: false,
    text: "",
    chars: [],
    lineId: 0,
    lookupByPos: Object.create(null),
    progress: null,
    currentPos: null,
    config: {
      fontScale: 1,
      popupScale: 0.92,
      popupMaxWidth: 440,
      popupMaxHeightVh: 34,
      popupSubtitleGapPx: 34,
      nestedPopupMode: "off",
      nestedPopupMaxDepth: 3,
      flattenSubtitleLineBreaks: false,
      experimentalNativeSubtitleHitLayer: true,
      experimentalNativeSubtitleLookupHighlight: true,
      experimentalNativeSubtitleHitBoxes: false,
      experimentalNativeSubtitleTextOpacity: 0,
      popupTheme: "inherit",
      maxEntries: 3,
      maxGlossesPerEntry: 4,
      scanLength: 24,
      audioAutoPlay: false,
      audioSources: [],
      anki: {
        enabled: false,
        configured: false,
        duplicateCheck: true,
        duplicateMode: "prevent",
      },
      etymologyCollapseDefault: "collapsed",
      wiktionaryEtymologyCollapseOverride: "collapsed",
      customPopupCss: "",
      language: {
        id: "ja",
        label: "Japanese",
        lookupUnit: "character",
        wordMode: "rightward-prefix",
        lookupCharacterPolicy:
          IINATAN_LOOKUP_CHARACTER_POLICY.policies.japanese,
      },
      hoverRequestTimeoutMs: 15000,
      debugLogVerbose: false,
    },
    hideTimer: null,
    currentAnchor: null,
    activeMatchStart: null,
    activeMatchLength: 0,
    lookupPopupVisible: false,
    lookupPopupNotifyTimer: null,
    bridgeSocket: null,
    bridgePort: null,
    bridgeReconnectTimer: null,
    popupSessionId:
      String(Date.now()) + "-" + Math.random().toString(36).slice(2),
    popupVisibilitySeq: 0,
    lookupRequestSeq: 0,
    audioPlaying: null,
    audioCache: Object.create(null),
    audioAutoPlayed: Object.create(null),
    audioSourceRequestSeq: 0,
    pendingAudioSourceRequests: Object.create(null),
    audioSourceMenu: null,
    ankiCardRequestSeq: 0,
    ankiCardContexts: Object.create(null),
    pendingAnkiMessages: Object.create(null),
    pendingAnkiStatusTimers: Object.create(null),
    pendingLookupTimers: Object.create(null),
    pendingLookupRequests: Object.create(null),
    nestedPopups: [],
    nestedLookupRequestSeq: 0,
    pendingNestedLookupRequests: Object.create(null),
    nestedHoverTimer: null,
    nestedHoverKey: "",
    charByPos: Object.create(null),
    task: null,
    taskTimer: null,
    statusClearTimer: null,
    nativeHitGeneration: 0,
    nativeDisplayText: "",
    nativeReason: "",
    nativeLookupSpans: [],
    nativeLayout: null,
    nativeSurfaces: [],
    bitmapOcrStatus: null,
    nativeDiagnosticKey: "",
    nativeAcceptedDiagnosticKey: "",
  };
  const LOOKUP_RETRY_INTERVAL_MS = 60;
  const AUDIO_CACHE_MAX_ENTRIES = 32;
  const JAPANESE_KANJI_RANGE = "\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u3005";
  const JAPANESE_KANJI_PATTERN = new RegExp("[" + JAPANESE_KANJI_RANGE + "]");
  const JAPANESE_KANJI_SEGMENT_PATTERN = new RegExp(
    "[" + JAPANESE_KANJI_RANGE + "]+|[^" + JAPANESE_KANJI_RANGE + "]+",
    "g",
  );
  const JAPANESE_KANA_PATTERN = /[\u3040-\u30ff\uff66-\uff9f]/;
  let frequencyDisclosureSeq = 0;
  let customPopupStyleEl = null;
  let lastCustomPopupCss = null;
  let popupThemeHintQuery = null;
  let popupThemeHintListenerRegistered = false;

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function rememberAudioCache(key, value) {
    if (!Object.prototype.hasOwnProperty.call(state.audioCache, key)) {
      const keys = Object.keys(state.audioCache);
      while (keys.length >= AUDIO_CACHE_MAX_ENTRIES)
        delete state.audioCache[keys.shift()];
    }
    state.audioCache[key] = value;
  }
  function normalizeWhitespace(s) {
    return String(s || "")
      .replace(/\s+/g, " ")
      .trim();
  }
  function compareTextKey(s) {
    const raw = normalizeWhitespace(s).toLowerCase();
    try {
      return raw.normalize("NFKC");
    } catch (_) {
      return raw;
    }
  }
  function toHiragana(s) {
    return String(s || "").replace(/[\u30a1-\u30f6]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60),
    );
  }
  function createFuriganaSegment(text, reading) {
    return { text, reading };
  }
  function splitKanaFuriganaSegments(text, reading) {
    const textLength = text.length;
    const segments = [];
    let start = 0;
    let matching = reading[0] === text[0];
    for (let i = 1; i < textLength; i++) {
      const nextMatching = reading[i] === text[i];
      if (matching === nextMatching) continue;
      segments.push(
        createFuriganaSegment(
          text.substring(start, i),
          matching ? "" : reading.substring(start, i),
        ),
      );
      matching = nextMatching;
      start = i;
    }
    segments.push(
      createFuriganaSegment(
        text.substring(start, textLength),
        matching ? "" : reading.substring(start, textLength),
      ),
    );
    return segments;
  }
  function segmentizeFurigana(reading, readingNormalized, groups, groupIndex) {
    const remainingGroups = groups.length - groupIndex;
    if (remainingGroups <= 0) return reading.length === 0 ? [] : null;
    const group = groups[groupIndex];
    const text = group.text;
    const textLength = text.length;
    if (group.isKana) {
      if (
        group.textNormalized &&
        readingNormalized.startsWith(group.textNormalized)
      ) {
        const tail = segmentizeFurigana(
          reading.substring(textLength),
          readingNormalized.substring(textLength),
          groups,
          groupIndex + 1,
        );
        if (tail) {
          if (reading.startsWith(text))
            tail.unshift(createFuriganaSegment(text, ""));
          else tail.unshift(...splitKanaFuriganaSegments(text, reading));
          return tail;
        }
      }
      return null;
    }
    let result = null;
    for (let i = reading.length; i >= textLength; i--) {
      const tail = segmentizeFurigana(
        reading.substring(i),
        readingNormalized.substring(i),
        groups,
        groupIndex + 1,
      );
      if (tail) {
        if (result) return null;
        tail.unshift(createFuriganaSegment(text, reading.substring(0, i)));
        result = tail;
      }
      if (remainingGroups === 1) break;
    }
    return result;
  }
  function segmentFurigana(expression, reading) {
    const headword = String(expression || "");
    const displayReading = String(reading || "");
    if (
      !headword ||
      !displayReading ||
      compareTextKey(headword) === compareTextKey(displayReading)
    )
      return [[headword, ""]];
    if (
      !JAPANESE_KANJI_PATTERN.test(headword) ||
      !JAPANESE_KANA_PATTERN.test(displayReading)
    )
      return [[headword, displayReading]];
    const groups = [];
    const matches = headword.match(JAPANESE_KANJI_SEGMENT_PATTERN) || [];
    matches.forEach((text) => {
      const isKana = !JAPANESE_KANJI_PATTERN.test(text[0]);
      groups.push({
        text,
        isKana,
        textNormalized: isKana ? toHiragana(text) : null,
      });
    });
    const segments = segmentizeFurigana(
      displayReading,
      toHiragana(displayReading),
      groups,
      0,
    );
    return segments
      ? segments.map((segment) => [segment.text, segment.reading])
      : [[headword, displayReading]];
  }
  function renderFuriganaHtml(expression, reading) {
    return segmentFurigana(expression, reading)
      .map((segment) => {
        const text = segment[0];
        const furigana = segment[1];
        return furigana
          ? "<ruby>" +
              escapeHtml(text) +
              "<rt>" +
              escapeHtml(furigana) +
              "</rt></ruby>"
          : escapeHtml(text);
      })
      .join("");
  }
  function shouldRenderFurigana(expression, reading) {
    return !!(
      expression &&
      reading &&
      JAPANESE_KANJI_PATTERN.test(String(expression)) &&
      JAPANESE_KANA_PATTERN.test(String(reading))
    );
  }
  function shouldRenderWholeReadingRuby(expression, reading) {
    return !!(
      expression &&
      reading &&
      JAPANESE_KANJI_PATTERN.test(String(expression)) &&
      !JAPANESE_KANA_PATTERN.test(String(reading))
    );
  }
  function renderWholeReadingRubyHtml(expression, reading) {
    return (
      "<ruby>" +
      escapeHtml(expression || "") +
      "<rt>" +
      escapeHtml(reading || "") +
      "</rt></ruby>"
    );
  }
  function renderHeadwordStackHtml(headword, reading, options) {
    const termClass = options && options.termClass ? options.termClass : "term";
    const readingClass =
      options && options.readingClass ? options.readingClass : "reading";
    const rubyReading =
      shouldRenderFurigana(headword, reading) ||
      shouldRenderWholeReadingRuby(headword, reading);
    const termHtml = shouldRenderFurigana(headword, reading)
      ? renderFuriganaHtml(headword, reading)
      : shouldRenderWholeReadingRuby(headword, reading)
        ? renderWholeReadingRubyHtml(headword, reading)
        : escapeHtml(headword || "");
    return (
      '<span class="headword-stack">' +
      (!rubyReading && reading
        ? '<span class="' +
          escapeHtml(readingClass) +
          '">' +
          escapeHtml(reading) +
          "</span>"
        : "") +
      '<span class="' +
      escapeHtml(termClass) +
      '">' +
      termHtml +
      "</span></span>"
    );
  }
  function safeExternalUrl(raw) {
    const value = String(raw || "").trim();
    if (!value || !/^https?:\/\//i.test(value)) {
      if (value)
        overlayDebug(
          "source URL rejected scheme=" + JSON.stringify(value.slice(0, 160)),
        );
      return "";
    }
    try {
      if (typeof URL === "function") {
        const url = new URL(value);
        if (url.protocol === "http:" || url.protocol === "https:") {
          overlayDebug(
            "source URL accepted=" + JSON.stringify(url.href.slice(0, 180)),
          );
          return url.href;
        }
      } else if (/^https?:\/\/[^\s<>"']+$/i.test(value)) {
        overlayDebug(
          "source URL accepted=" + JSON.stringify(value.slice(0, 180)),
        );
        return value;
      }
    } catch (_) {}
    overlayDebug(
      "source URL rejected invalid=" + JSON.stringify(value.slice(0, 160)),
    );
    return "";
  }
  function safeAudioUrl(raw, baseUrl) {
    const value = String(raw || "").trim();
    if (!value) return "";
    try {
      const url =
        typeof URL === "function" ? new URL(value, baseUrl || undefined) : null;
      if (url && (url.protocol === "http:" || url.protocol === "https:"))
        return url.href;
    } catch (_) {}
    if (!baseUrl && /^https?:\/\/[^\s<>"']+$/i.test(value)) return value;
    return "";
  }
  function normalizeAudioSourceUrl(value) {
    return safeAudioUrl(value, "");
  }
  function normalizeAudioSourceItem(source) {
    const raw =
      typeof source === "string"
        ? { url: source }
        : source && typeof source === "object"
          ? source
          : {};
    const url = normalizeAudioSourceUrl(raw.url);
    if (!url) return null;
    const name = normalizeWhitespace(raw.name || "");
    return name ? { name, url } : { url };
  }
  function normalizeAudioSources(value) {
    let raw = value;
    if (typeof raw === "string") {
      const text = raw.trim();
      if (!text) return [];
      try {
        raw = JSON.parse(text);
      } catch (_) {
        raw = text;
      }
    }
    if (raw && typeof raw === "object" && Array.isArray(raw.audioSources))
      raw = raw.audioSources;
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const seen = Object.create(null);
    const out = [];
    values.forEach((item) => {
      const normalized = normalizeAudioSourceItem(item);
      if (!normalized || seen[normalized.url]) return;
      seen[normalized.url] = true;
      out.push(normalized);
    });
    return out;
  }
  function activeAudioSources() {
    return normalizeAudioSources(state.config && state.config.audioSources);
  }
  function normalizeAnkiConfig(config) {
    const raw = config && typeof config === "object" ? config : {};
    return {
      enabled: !!raw.enabled,
      configured: !!raw.configured,
      duplicateCheck: raw.duplicateCheck !== false,
      duplicateMode:
        String(raw.duplicateMode || "prevent") === "allow"
          ? "allow"
          : "prevent",
      duplicateScope:
        String(raw.duplicateScope || "deck") === "collection"
          ? "collection"
          : "deck",
      deckName: String(raw.deckName || ""),
      modelName: String(raw.modelName || ""),
    };
  }
  function activeAnkiConfig() {
    return normalizeAnkiConfig(state.config && state.config.anki);
  }
  function ankiButtonVisibleForPopup() {
    const config = activeAnkiConfig();
    return !!config.enabled;
  }
  function ankiEnabledForPopup() {
    const config = activeAnkiConfig();
    return !!(config.enabled && config.configured);
  }
  function audioSourceDisplayLabel(source, index) {
    const name = normalizeWhitespace((source && source.name) || "");
    if (name) return name;
    const url = String((source && source.url) || "");
    if (
      /^(?:https?:\/\/)?(?:127\.0\.0\.1|localhost):5050(?:[/?#]|$)/i.test(url)
    )
      return "Local audio";
    try {
      if (typeof URL === "function") {
        const parsed = new URL(url);
        const host = parsed.hostname
          .replace(/^www\./i, "")
          .replace(/^assets\./i, "");
        return host
          ? host + (parsed.port ? ":" + parsed.port : "")
          : "Source " + String(Number(index || 0) + 1);
      }
    } catch (_) {}
    return "Source " + String(Number(index || 0) + 1);
  }
  function audioSourcesSignature(sources) {
    return JSON.stringify(
      (sources || []).map((source) => ({
        name: source.name || "",
        url: source.url || "",
      })),
    );
  }
  function audioLanguageCode() {
    const lang = activeLanguage();
    return String(
      (lang && lang.id) ||
        (state.config && state.config.lookupLanguage) ||
        "ja",
    );
  }
  function audioTermReadingKey(term, reading) {
    return JSON.stringify([String(term || ""), String(reading || "")]);
  }
  function audioCacheKey(term, reading, sources) {
    return JSON.stringify([
      String(term || ""),
      String(reading || ""),
      audioLanguageCode(),
      audioSourcesSignature(sources || activeAudioSources()),
    ]);
  }
  function audioUrlFromTemplate(template, term, reading) {
    const values = {
      term: String(term || ""),
      reading: String(reading || ""),
      language: audioLanguageCode(),
    };
    return String(template || "").replace(/\{([^}]*)\}/g, (match, key) => {
      if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
      try {
        return encodeURIComponent(values[key]);
      } catch (_) {
        return values[key];
      }
    });
  }
  function parseAudioSourceListJson(value, sourceUrl) {
    const data = value && typeof value === "object" ? value : null;
    if (
      !data ||
      data.type !== "audioSourceList" ||
      !Array.isArray(data.audioSources)
    )
      return null;
    const urls = [];
    data.audioSources.forEach((item) => {
      const audioUrl = safeAudioUrl(item && item.url, sourceUrl);
      if (audioUrl)
        urls.push({
          url: audioUrl,
          name: normalizeWhitespace((item && item.name) || ""),
        });
    });
    return urls;
  }
  function normalizeAudioCandidateList(candidates, sourceUrl) {
    const out = [];
    (Array.isArray(candidates) ? candidates : []).forEach((item) => {
      const audioUrl = safeAudioUrl(item && item.url, sourceUrl);
      if (audioUrl)
        out.push({
          url: audioUrl,
          name: normalizeWhitespace((item && item.name) || ""),
        });
    });
    return out;
  }
  function requestAudioCandidatesFromPlugin(sourceUrl) {
    return new Promise((resolve) => {
      const requestId = "audio-" + String(++state.audioSourceRequestSeq);
      const timeoutMs = Math.min(
        9000,
        Math.max(2500, Number(state.config.hoverRequestTimeoutMs || 5000)),
      );
      let timer = null;
      const finish = (result) => {
        if (timer !== null) clearTimeout(timer);
        delete state.pendingAudioSourceRequests[requestId];
        resolve(result || null);
      };
      state.pendingAudioSourceRequests[requestId] = { finish, sourceUrl };
      const payload = {
        type: "audio-source",
        requestId,
        url: sourceUrl,
        at: Date.now(),
      };
      const sent = sendBridgeMessage(payload) || postPluginMessage(payload);
      if (!sent) {
        delete state.pendingAudioSourceRequests[requestId];
        resolve(null);
        return;
      }
      timer = setTimeout(() => {
        overlayDebug(
          "audio source bridge request timed out requestId=" +
            requestId +
            " url=" +
            JSON.stringify(sourceUrl),
        );
        finish(null);
      }, timeoutMs);
    });
  }
  function fetchTextWithTimeout(url, timeoutMs) {
    if (typeof fetch !== "function")
      return Promise.reject(new Error("fetch unavailable"));
    let timer = null;
    let controller = null;
    const init = {
      method: "GET",
      cache: "default",
      credentials: "omit",
      redirect: "follow",
    };
    try {
      if (typeof AbortController === "function") {
        controller = new AbortController();
        init.signal = controller.signal;
      }
    } catch (_) {}
    return Promise.race([
      fetch(url, init).then((response) => {
        if (!response || !response.ok)
          throw new Error(
            "audio source returned " + String(response && response.status),
          );
        return response.text();
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => {
            try {
              if (controller) controller.abort();
            } catch (_) {}
            reject(new Error("audio source timed out"));
          },
          Math.max(1000, Number(timeoutMs) || 5000),
        );
      }),
    ]).finally(() => {
      if (timer !== null) clearTimeout(timer);
    });
  }
  function urlLooksLikeAudioFile(url) {
    return /\.(?:mp3|m4a|aac|ogg|oga|opus|wav|webm)(?:[?#]|$)/i.test(
      String(url || ""),
    );
  }
  function directAudioCandidateForSource(source, sourceUrl) {
    return [
      {
        url: sourceUrl,
        name: normalizeWhitespace((source && source.name) || ""),
      },
    ];
  }
  async function resolveAudioCandidateUrls(source, term, reading) {
    const sourceUrl = safeAudioUrl(
      audioUrlFromTemplate(source && source.url, term, reading),
      "",
    );
    if (!sourceUrl) return [];
    if (urlLooksLikeAudioFile(sourceUrl))
      return directAudioCandidateForSource(source, sourceUrl);
    const bridgeResult = await requestAudioCandidatesFromPlugin(sourceUrl);
    if (
      bridgeResult &&
      bridgeResult.ok &&
      Array.isArray(bridgeResult.candidates)
    ) {
      const candidates = normalizeAudioCandidateList(
        bridgeResult.candidates,
        sourceUrl,
      );
      overlayDebug(
        "audio source bridge resolved url=" +
          JSON.stringify(sourceUrl) +
          " candidates=" +
          candidates.length,
      );
      return candidates;
    }
    if (bridgeResult && bridgeResult.ok === false) {
      overlayDebug(
        "audio source bridge failed url=" +
          JSON.stringify(sourceUrl) +
          " error=" +
          JSON.stringify(String(bridgeResult.error || "")),
      );
      return directAudioCandidateForSource(source, sourceUrl);
    }
    try {
      const text = await fetchTextWithTimeout(
        sourceUrl,
        Math.min(
          8000,
          Math.max(2500, Number(state.config.hoverRequestTimeoutMs || 5000)),
        ),
      );
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (_) {}
      const jsonUrls = parseAudioSourceListJson(parsed, sourceUrl);
      if (jsonUrls) {
        overlayDebug(
          "audio source JSON resolved url=" +
            JSON.stringify(sourceUrl) +
            " candidates=" +
            jsonUrls.length,
        );
        return jsonUrls;
      }
    } catch (error) {
      overlayDebug(
        "audio source JSON fetch failed url=" +
          JSON.stringify(sourceUrl) +
          " error=" +
          String(error && error.message ? error.message : error),
      );
    }
    return directAudioCandidateForSource(source, sourceUrl);
  }
  function waitForAudioData(audio, timeoutMs) {
    return new Promise((resolve, reject) => {
      let done = false;
      let timer = null;
      const cleanup = () => {
        if (timer !== null) clearTimeout(timer);
        try {
          audio.removeEventListener("loadeddata", onLoaded);
        } catch (_) {}
        try {
          audio.removeEventListener("canplaythrough", onLoaded);
        } catch (_) {}
        try {
          audio.removeEventListener("error", onError);
        } catch (_) {}
        try {
          audio.removeEventListener("stalled", onError);
        } catch (_) {}
      };
      const finish = (ok, error) => {
        if (done) return;
        done = true;
        cleanup();
        if (ok) resolve();
        else reject(error || new Error("audio unavailable"));
      };
      const onLoaded = () => finish(true);
      const onError = () =>
        finish(
          false,
          audio && audio.error ? audio.error : new Error("audio unavailable"),
        );
      timer = setTimeout(
        () => finish(false, new Error("audio timed out")),
        Math.max(1000, Number(timeoutMs) || 5000),
      );
      try {
        audio.addEventListener("loadeddata", onLoaded);
      } catch (_) {}
      try {
        audio.addEventListener("canplaythrough", onLoaded);
      } catch (_) {}
      try {
        audio.addEventListener("error", onError);
      } catch (_) {}
      try {
        audio.addEventListener("stalled", onError);
      } catch (_) {}
      try {
        if (
          Number.isFinite(Number(audio.readyState)) &&
          Number(audio.readyState) >= 2
        )
          finish(true);
        else if (typeof audio.load === "function") audio.load();
      } catch (error) {
        finish(false, error);
      }
    });
  }
  async function createPlayableAudio(url) {
    if (typeof Audio !== "function")
      throw new Error("Audio playback unavailable");
    const audio = new Audio(url);
    try {
      audio.preload = "auto";
    } catch (_) {}
    await waitForAudioData(
      audio,
      Math.min(
        9000,
        Math.max(2500, Number(state.config.hoverRequestTimeoutMs || 5000)),
      ),
    );
    return audio;
  }
  function stopCurrentAudio() {
    const audio = state.audioPlaying;
    if (!audio) return;
    try {
      audio.pause();
    } catch (_) {}
    state.audioPlaying = null;
  }
  function cancelPendingAudioSourceRequests() {
    Object.keys(state.pendingAudioSourceRequests || {}).forEach((requestId) => {
      const req = state.pendingAudioSourceRequests[requestId];
      delete state.pendingAudioSourceRequests[requestId];
      try {
        if (req && typeof req.finish === "function") req.finish(null);
      } catch (_) {}
    });
  }
  function setAudioButtonsStateForKey(key, status, title) {
    try {
      popupEl.querySelectorAll(".audio-button").forEach((button) => {
        if (button.dataset.audioKey !== key) return;
        if (status) button.dataset.audioState = status;
        else delete button.dataset.audioState;
        if (title) button.title = title;
      });
    } catch (_) {}
  }
  async function findPlayableAudio(term, reading, sources) {
    const configuredSources = sources || activeAudioSources();
    const cacheKey = audioCacheKey(term, reading, configuredSources);
    const cached = state.audioCache[cacheKey];
    if (cached && cached.url) {
      const audio = await createPlayableAudio(cached.url);
      return Object.assign({}, cached, { audio });
    }
    for (
      let sourceIndex = 0;
      sourceIndex < configuredSources.length;
      sourceIndex++
    ) {
      const source = configuredSources[sourceIndex];
      const candidates = await resolveAudioCandidateUrls(source, term, reading);
      for (
        let candidateIndex = 0;
        candidateIndex < candidates.length;
        candidateIndex++
      ) {
        const candidate = candidates[candidateIndex];
        try {
          const audio = await createPlayableAudio(candidate.url);
          const sourceName =
            candidate.name ||
            source.name ||
            "Source " + String(sourceIndex + 1);
          const result = {
            url: candidate.url,
            sourceIndex,
            candidateIndex,
            sourceName,
          };
          rememberAudioCache(cacheKey, result);
          return Object.assign({}, result, { audio });
        } catch (error) {
          overlayDebug(
            "audio candidate failed url=" +
              JSON.stringify(candidate.url) +
              " error=" +
              String(error && error.message ? error.message : error),
          );
        }
      }
    }
    return null;
  }
  async function playAudioForTerm(term, reading, button, options) {
    options = options || {};
    term = String(term || "").trim();
    reading = String(reading || "").trim();
    const sources = Array.isArray(options.sources)
      ? normalizeAudioSources(options.sources)
      : activeAudioSources();
    if (!term || !sources.length) return false;
    const key = audioTermReadingKey(term, reading);
    if (button) button.dataset.audioKey = key;
    setAudioButtonsStateForKey(key, "loading", "Finding audio...");
    try {
      const result = await findPlayableAudio(term, reading, sources);
      if (!result || !result.audio) {
        setAudioButtonsStateForKey(key, "missing", "Could not find audio");
        return false;
      }
      stopCurrentAudio();
      const audio = result.audio;
      try {
        audio.currentTime = 0;
      } catch (_) {}
      try {
        audio.volume = 1;
      } catch (_) {}
      state.audioPlaying = audio;
      setAudioButtonsStateForKey(
        key,
        "ready",
        "Play audio\nFrom " + String(result.sourceName || "audio source"),
      );
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        await playPromise.catch((error) => {
          overlayDebug(
            "audio play promise rejected " +
              String(error && error.message ? error.message : error),
          );
        });
      }
      return true;
    } catch (error) {
      overlayDebug(
        "audio playback failed term=" +
          JSON.stringify(term) +
          " reading=" +
          JSON.stringify(reading) +
          " error=" +
          String(error && error.message ? error.message : error),
      );
      setAudioButtonsStateForKey(key, "missing", "Could not find audio");
      return false;
    } finally {
      try {
        if (button && button.dataset.audioState === "loading")
          delete button.dataset.audioState;
      } catch (_) {}
    }
  }
  function nodeContains(parent, child) {
    let node = child;
    while (node) {
      if (node === parent) return true;
      node = node.parentNode || null;
    }
    return false;
  }
  function hideAudioSourceMenu() {
    const menu = state.audioSourceMenu;
    state.audioSourceMenu = null;
    try {
      if (menu && typeof menu.remove === "function") menu.remove();
    } catch (_) {}
  }
  function cancelHidePopupTimer() {
    if (state.hideTimer) clearTimeout(state.hideTimer);
    state.hideTimer = null;
  }
  function audioSourceMenuContainer() {
    try {
      if (document.body && typeof document.body.appendChild === "function")
        return document.body;
    } catch (_) {}
    return popupEl;
  }
  function placeAudioSourceMenu(menu, button, event, inPopup) {
    const buttonRect =
      button && typeof button.getBoundingClientRect === "function"
        ? button.getBoundingClientRect()
        : null;
    const popupRect =
      popupEl && typeof popupEl.getBoundingClientRect === "function"
        ? popupEl.getBoundingClientRect()
        : null;
    const clientX =
      event && Number.isFinite(Number(event.clientX))
        ? Number(event.clientX)
        : buttonRect
          ? buttonRect.right
          : 24;
    const clientY =
      event && Number.isFinite(Number(event.clientY))
        ? Number(event.clientY)
        : buttonRect
          ? buttonRect.bottom
          : 24;
    const maxWidth = 260;
    if (inPopup && popupRect) {
      const scale = Math.max(0.1, Number(state.config.popupScale || 1) || 1);
      const left = Math.max(
        8,
        Math.min(
          popupRect.width / scale - maxWidth - 8,
          (clientX - popupRect.left) / scale,
        ),
      );
      const top = Math.max(8, (clientY - popupRect.top) / scale + 4);
      menu.style.position = "absolute";
      menu.style.left = String(Math.max(8, left)) + "px";
      menu.style.top = String(top) + "px";
      return;
    }
    const winWidth = Number((window && window.innerWidth) || 1280);
    const winHeight = Number((window && window.innerHeight) || 720);
    menu.style.position = "fixed";
    menu.style.left =
      String(Math.max(8, Math.min(winWidth - maxWidth - 8, clientX))) + "px";
    menu.style.top =
      String(Math.max(8, Math.min(winHeight - 48, clientY + 4))) + "px";
  }
  function showAudioSourceMenu(button, event) {
    try {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
    } catch (_) {}
    const term = String(
      (button && button.dataset && button.dataset.audioTerm) || "",
    ).trim();
    const reading = String(
      (button && button.dataset && button.dataset.audioReading) || "",
    ).trim();
    const sources = activeAudioSources();
    if (!term || !sources.length) return false;
    hideAudioSourceMenu();
    const menu = document.createElement("div");
    menu.className = "audio-source-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Audio sources");
    menu.setAttribute("data-clickable", "true");
    sources.forEach((source, index) => {
      const label = audioSourceDisplayLabel(source, index);
      const item = document.createElement("button");
      item.type = "button";
      item.className = "audio-source-menu-item";
      item.textContent = label;
      item.title = source.url || label;
      item.dataset.audioSourceIndex = String(index);
      item.setAttribute("role", "menuitem");
      item.setAttribute("data-clickable", "true");
      item.addEventListener("click", (clickEvent) => {
        try {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
        } catch (_) {}
        hideAudioSourceMenu();
        playAudioForTerm(term, reading, button, {
          userGesture: true,
          sources: [Object.assign({}, source, { name: label })],
        }).catch(() => {});
      });
      menu.appendChild(item);
    });
    menu.addEventListener("click", (clickEvent) => {
      try {
        clickEvent.stopPropagation();
      } catch (_) {}
    });
    menu.addEventListener("contextmenu", (menuEvent) => {
      try {
        menuEvent.preventDefault();
        menuEvent.stopPropagation();
      } catch (_) {}
    });
    menu.addEventListener("mouseenter", cancelHidePopupTimer);
    menu.addEventListener("mouseleave", scheduleHidePopup);
    const container = audioSourceMenuContainer();
    const inPopup = container === popupEl;
    container.appendChild(menu);
    state.audioSourceMenu = menu;
    placeAudioSourceMenu(menu, button, event, inPopup);
    return true;
  }
  function nodeHref(node) {
    if (!node || typeof node !== "object") return "";
    const data = node.data || {};
    const attrs = node.attributes || node.attrs || {};
    return (
      node.href ||
      node.url ||
      data.href ||
      data.url ||
      attrs.href ||
      attrs.url ||
      ""
    );
  }
  function externalLinkHtml(url, innerHtml) {
    const safe = safeExternalUrl(url);
    if (!safe) return "";
    const body = innerHtml || escapeHtml(safe);
    return (
      '<a class="xref-link external-source-link" href="' +
      escapeHtml(safe) +
      '" data-external-url="' +
      escapeHtml(safe) +
      '" target="_blank" rel="noopener noreferrer">' +
      body +
      "</a>"
    );
  }
  function escapeAndLinkifyText(raw) {
    const text = String(raw || "");
    const re = /https?:\/\/[^\s<>"']+/gi;
    let out = "";
    let last = 0;
    let match;
    while ((match = re.exec(text))) {
      out += escapeHtml(text.slice(last, match.index));
      let url = match[0];
      let trailing = "";
      while (/[.,;:!?)\]}]$/.test(url)) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
      }
      const safe = safeExternalUrl(url);
      out += safe
        ? externalLinkHtml(safe, escapeHtml(url))
        : escapeHtml(match[0]);
      out += escapeHtml(trailing);
      last = match.index + match[0].length;
    }
    out += escapeHtml(text.slice(last));
    return out;
  }
  function applyCustomPopupCss(cssText) {
    const css = String(cssText || "");
    if (css === lastCustomPopupCss) return;
    lastCustomPopupCss = css;
    if (!css.trim()) {
      if (customPopupStyleEl) customPopupStyleEl.textContent = "";
      overlayDebug("custom popup CSS skipped empty");
      return;
    }
    try {
      if (!customPopupStyleEl) {
        customPopupStyleEl = document.createElement("style");
        customPopupStyleEl.id = "iinatan-custom-popup-css";
        const host = document.head || document.documentElement;
        if (host && host.appendChild) host.appendChild(customPopupStyleEl);
      }
      customPopupStyleEl.textContent = css
        .slice(0, 50000)
        .replace(/#popup(?![-_a-zA-Z0-9])/g, ":is(#popup, .nested-popup)");
      overlayDebug(
        "custom popup CSS applied bytes=" +
          String(customPopupStyleEl.textContent.length),
      );
    } catch (error) {
      overlayDebug(
        "custom popup CSS apply failed " +
          String(error && error.message ? error.message : error),
      );
    }
  }
  function normalizePopupTheme(value) {
    const theme = String(value || "")
      .trim()
      .toLowerCase();
    if (theme === "dark" || theme === "light" || theme === "inherit")
      return theme;
    return "inherit";
  }
  function inheritedPopupThemeHint() {
    const configuredHint = String(
      (state.config && state.config.popupThemeHint) || "",
    )
      .trim()
      .toLowerCase();
    if (configuredHint === "light" || configuredHint === "dark")
      return configuredHint;
    try {
      if (window && typeof window.matchMedia === "function") {
        const lightQuery = window.matchMedia("(prefers-color-scheme: light)");
        if (lightQuery && lightQuery.matches) return "light";
        const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
        if (darkQuery && darkQuery.matches) return "dark";
      }
    } catch (_) {}
    return "dark";
  }
  function resolvePopupTheme(value) {
    const theme = normalizePopupTheme(value);
    return theme === "inherit" ? inheritedPopupThemeHint() : theme;
  }
  function applyPopupTheme(value) {
    const requestedTheme = normalizePopupTheme(value);
    const theme = resolvePopupTheme(requestedTheme);
    const root = document.documentElement;
    if (!root) return;
    try {
      if (root.classList) {
        root.classList.remove("theme-dark", "theme-light");
        root.classList.add("theme-" + theme);
      } else {
        const next = String(root.className || "")
          .replace(/\btheme-(?:dark|light)\b/g, "")
          .replace(/\s+/g, " ")
          .trim();
        root.className = (next ? next + " " : "") + "theme-" + theme;
      }
      if (typeof root.setAttribute === "function") {
        root.setAttribute("data-popup-theme", theme);
        root.setAttribute("data-popup-theme-requested", requestedTheme);
      } else {
        root.dataset = Object.assign(root.dataset || {}, {
          popupTheme: theme,
          popupThemeRequested: requestedTheme,
        });
      }
    } catch (_) {}
  }
  function ensurePopupThemeHintListener() {
    if (popupThemeHintListenerRegistered) return;
    popupThemeHintListenerRegistered = true;
    try {
      if (!window || typeof window.matchMedia !== "function") return;
      popupThemeHintQuery = window.matchMedia("(prefers-color-scheme: light)");
      if (!popupThemeHintQuery) return;
      const handler = function () {
        if (
          normalizePopupTheme(state.config && state.config.popupTheme) ===
          "inherit"
        )
          applyPopupTheme("inherit");
      };
      if (typeof popupThemeHintQuery.addEventListener === "function")
        popupThemeHintQuery.addEventListener("change", handler);
      else if (typeof popupThemeHintQuery.addListener === "function")
        popupThemeHintQuery.addListener(handler);
    } catch (_) {}
  }
  function overlayDebugEnabled() {
    return !!state.config && state.config.debugLogVerbose !== false;
  }
  function overlayDebug(message) {
    try {
      if (!overlayDebugEnabled()) return;
      sendBridgeMessage({
        type: "overlay-log",
        message: String(message || ""),
        lineId: state.lineId,
        currentPos: state.currentPos,
        at: Date.now(),
      });
    } catch (_) {}
    try {
      console.log("[iinatan overlay] " + String(message || ""));
    } catch (_) {}
  }
  function flattenSubtitleText(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .replace(/\n+/g, " ")
      .replace(/[ \t\f\v]{2,}/g, " ")
      .trim();
  }

  function activeLanguage() {
    return (
      state.config.language || {
        id: state.config.lookupLanguage || "ja",
        wordMode: "rightward-prefix",
      }
    );
  }

  function isLookupableChar(ch) {
    const lang = activeLanguage();
    const policy =
      lang.lookupCharacterPolicy ||
      (lang.id === "ja"
        ? IINATAN_LOOKUP_CHARACTER_POLICY.policies.japanese
        : null);
    return IINATAN_LOOKUP_CHARACTER_POLICY.matches(policy, ch);
  }

  function findLookupRun(pos) {
    const lang = activeLanguage();
    const isWholeWordMode =
      lang.lookupUnit === "word" ||
      lang.wordMode === "latin-word" ||
      lang.wordMode === "korean-run";
    if (!isWholeWordMode) return null;
    if (
      !state.chars.length ||
      pos < 0 ||
      pos >= state.chars.length ||
      !isLookupableChar(state.chars[pos])
    )
      return null;
    let start = pos;
    let end = pos + 1;
    while (start > 0 && isLookupableChar(state.chars[start - 1])) start--;
    while (end < state.chars.length && isLookupableChar(state.chars[end]))
      end++;
    return { start, end, text: state.chars.slice(start, end).join("") };
  }

  function lookupPreviewForPosition(pos) {
    const run = findLookupRun(pos);
    if (run) return run;
    return {
      start: pos,
      end: Math.min(state.chars.length, pos + 1),
      text: state.chars.slice(pos, pos + 1).join(""),
    };
  }

  function lookupUnitForPosition(pos) {
    const run = findLookupRun(pos);
    const canonicalPos = run ? run.start : pos;
    const preview = run || {
      start: pos,
      end: Math.min(state.chars.length, pos + 1),
      text: state.chars.slice(pos, pos + 1).join(""),
    };
    return {
      pos: canonicalPos,
      key: run
        ? "word:" + run.start + ":" + run.end + ":" + run.text
        : "char:" + canonicalPos,
      preview,
      isWord: !!run,
    };
  }

  function lookupAnchorForUnit(unit, fallback) {
    if (state.config.experimentalNativeSubtitleHitLayer)
      return fallback || null;
    if (unit && unit.isWord) {
      const el = charElementAt(unit.pos);
      if (el) return el;
    }
    return fallback || null;
  }

  function applyConfig(config) {
    const previousAudioSignature = audioSourcesSignature(activeAudioSources());
    const previousNativeLookupHighlight =
      !!state.config.experimentalNativeSubtitleLookupHighlight;
    state.config = Object.assign({}, state.config, config || {});
    state.config.popupTheme = normalizePopupTheme(state.config.popupTheme);
    const nestedPopupMode = String(state.config.nestedPopupMode || "")
      .trim()
      .toLowerCase();
    state.config.nestedPopupMode =
      nestedPopupMode === "hover" || nestedPopupMode === "click"
        ? nestedPopupMode
        : "off";
    state.config.nestedPopupMaxDepth = Math.max(
      1,
      Math.min(
        99999,
        Math.round(Number(state.config.nestedPopupMaxDepth) || 3),
      ),
    );
    state.config.audioSources = normalizeAudioSources(
      state.config.audioSources,
    );
    state.config.anki = normalizeAnkiConfig(state.config.anki);
    if (
      previousAudioSignature !==
      audioSourcesSignature(state.config.audioSources)
    ) {
      state.audioCache = Object.create(null);
    }
    if (
      previousNativeLookupHighlight !==
        !!state.config.experimentalNativeSubtitleLookupHighlight &&
      state.config.experimentalNativeSubtitleHitLayer &&
      nativeSubtitleMatchHighlightsEl
    ) {
      nativeSubtitleMatchHighlightsEl.textContent = "";
      if (
        state.config.experimentalNativeSubtitleLookupHighlight &&
        state.activeMatchStart !== null &&
        state.activeMatchLength > 0
      ) {
        activateMatchRange(
          state.activeMatchStart,
          state.chars
            .slice(
              state.activeMatchStart,
              state.activeMatchStart + state.activeMatchLength,
            )
            .join(""),
        );
      }
    }
    ensurePopupThemeHintListener();
    applyPopupTheme(state.config.popupTheme);
    document.documentElement.style.setProperty(
      "--subtitle-scale",
      String(state.config.fontScale || 1),
    );
    document.documentElement.style.setProperty(
      "--popup-scale",
      String(state.config.popupScale || 0.92),
    );
    document.documentElement.style.setProperty(
      "--popup-max-width",
      String(state.config.popupMaxWidth || 440) + "px",
    );
    if (state.config.subtitleFontFamily)
      document.documentElement.style.setProperty(
        "--subtitle-font-family",
        String(state.config.subtitleFontFamily),
      );
    if (state.config.subtitleFontSize)
      document.documentElement.style.setProperty(
        "--subtitle-font-size",
        String(state.config.subtitleFontSize),
      );
    if (state.config.subtitleFontWeight)
      document.documentElement.style.setProperty(
        "--subtitle-font-weight",
        String(state.config.subtitleFontWeight),
      );
    if (state.config.subtitleFontStyle)
      document.documentElement.style.setProperty(
        "--subtitle-font-style",
        String(state.config.subtitleFontStyle),
      );
    if (state.config.subtitleColor)
      document.documentElement.style.setProperty(
        "--subtitle-color",
        String(state.config.subtitleColor),
      );
    if (state.config.subtitleBorderColor)
      document.documentElement.style.setProperty(
        "--subtitle-border-color",
        String(state.config.subtitleBorderColor),
      );
    if (state.config.subtitleOutlineWidth)
      document.documentElement.style.setProperty(
        "--subtitle-outline-width",
        String(state.config.subtitleOutlineWidth),
      );
    if (state.config.subtitleShadowColor)
      document.documentElement.style.setProperty(
        "--subtitle-shadow-color",
        String(state.config.subtitleShadowColor),
      );
    if (state.config.subtitleShadowOffset)
      document.documentElement.style.setProperty(
        "--subtitle-shadow-offset",
        String(state.config.subtitleShadowOffset),
      );
    if (state.config.subtitleShadowBlur)
      document.documentElement.style.setProperty(
        "--subtitle-shadow-blur",
        String(state.config.subtitleShadowBlur),
      );
    applyCustomPopupCss(state.config.customPopupCss || "");
    updateNestedPopupScanningState();
    const configuredBridgePort = Number(state.config.overlayBridgePort);
    if (Number.isFinite(configuredBridgePort) && configuredBridgePort > 0) {
      if (configuredBridgePort !== state.bridgePort) {
        const previousSocket = state.bridgeSocket;
        state.bridgePort = configuredBridgePort;
        state.bridgeSocket = null;
        if (state.bridgeReconnectTimer) {
          clearTimeout(state.bridgeReconnectTimer);
          state.bridgeReconnectTimer = null;
        }
        if (previousSocket) {
          try {
            previousSocket.close();
          } catch (_) {}
        }
      }
      ensureBridgeSocket();
    }
    overlayDebug(
      "config applied bridgePort=" +
        String(state.bridgePort) +
        " popupScale=" +
        String(state.config.popupScale) +
        " popupTheme=" +
        String(state.config.popupTheme || "inherit") +
        " nestedPopupMode=" +
        String(state.config.nestedPopupMode || "off") +
        " nestedPopupMaxDepth=" +
        String(state.config.nestedPopupMaxDepth || 3) +
        " etymologyCollapseDefault=" +
        String(state.config.etymologyCollapseDefault || "collapsed") +
        " wiktionaryOverride=" +
        String(state.config.wiktionaryEtymologyCollapseOverride || "inherit"),
    );
  }

  function nativeGeometryContextReason() {
    if (
      !document.documentElement ||
      !document.body ||
      typeof window.getComputedStyle !== "function"
    )
      return "non-coextensive-overlay";
    const overlayRoot = document.getElementById("root");
    if (!overlayRoot) return "non-coextensive-overlay";
    const viewport = nativeOverlayViewport();
    if (
      viewport.width < 64 ||
      viewport.height < 64 ||
      Number(window.scrollX || 0) !== 0 ||
      Number(window.scrollY || 0) !== 0
    )
      return "non-coextensive-overlay";
    const required = [
      ["transform", "transform", ["none"]],
      ["filter", "filter", ["none"]],
      ["perspective", "perspective", ["none"]],
      ["zoom", "zoom", ["1", "normal"]],
      ["writingMode", "writing-mode", ["horizontal-tb"]],
      ["direction", "direction", ["ltr"]],
      ["contain", "contain", ["none"]],
      ["clip", "clip", ["auto"]],
      ["clipPath", "clip-path", ["none"]],
      ["willChange", "will-change", ["auto"]],
      ["transformStyle", "transform-style", ["flat"]],
      ["contentVisibility", "content-visibility", ["visible"]],
    ];
    const optional = [
      ["translate", "translate", ["", "none"]],
      ["rotate", "rotate", ["", "none"]],
      ["scale", "scale", ["", "none"]],
      ["backdropFilter", "backdrop-filter", ["", "none"]],
      ["webkitBackdropFilter", "-webkit-backdrop-filter", ["", "none"]],
      ["maskImage", "mask-image", ["", "none"]],
      ["webkitMaskImage", "-webkit-mask-image", ["", "none"]],
    ];
    const readStyle = (computed, camelName, cssName) => {
      const direct = computed[camelName];
      if (direct !== undefined && direct !== null && String(direct).trim())
        return String(direct).trim().toLowerCase();
      if (typeof computed.getPropertyValue === "function")
        return String(computed.getPropertyValue(cssName) || "")
          .trim()
          .toLowerCase();
      return "";
    };
    for (const element of [
      document.documentElement,
      document.body,
      overlayRoot,
    ]) {
      let computed;
      let rect;
      try {
        computed = window.getComputedStyle(element);
        rect = element.getBoundingClientRect();
      } catch (_) {
        return "non-coextensive-overlay";
      }
      if (!computed || !rect) return "non-coextensive-overlay";
      for (const [camelName, cssName, allowed] of required.concat(optional)) {
        if (allowed.indexOf(readStyle(computed, camelName, cssName)) < 0)
          return "non-coextensive-overlay";
      }
      const values = [
        Number(rect.left),
        Number(rect.top),
        Number(rect.width),
        Number(rect.height),
      ];
      if (
        values.some((value) => !Number.isFinite(value)) ||
        Math.abs(values[0]) > 1.5 ||
        Math.abs(values[1]) > 1.5 ||
        Math.abs(values[2] - viewport.width) > 1.5 ||
        Math.abs(values[3] - viewport.height) > 1.5
      )
        return "non-coextensive-overlay";
    }
    try {
      const rootStyle = window.getComputedStyle(overlayRoot);
      const rootZIndex = Number(readStyle(rootStyle, "zIndex", "z-index"));
      if (
        readStyle(rootStyle, "position", "position") !== "fixed" ||
        readStyle(rootStyle, "pointerEvents", "pointer-events") !== "none" ||
        !Number.isFinite(rootZIndex) ||
        rootZIndex <= 2
      )
        return "non-coextensive-overlay";
    } catch (_) {
      return "non-coextensive-overlay";
    }
    return "";
  }

  function createNativeSubtitleCopyElement() {
    const copy = document.createElement("div");
    copy.id = "native-subtitle-copy";
    copy.className = "hidden";
    copy.setAttribute("aria-hidden", "true");
    return copy;
  }

  function refreshNativeSubtitleCopyForFont(options) {
    const value = options && typeof options === "object" ? options : {};
    const fingerprint = JSON.stringify([
      value.effectiveFont || value.font || "",
      value.runtimeFont || "",
      value.optionFont || "",
      value.resolvedPostScriptName || "",
      value.fontVersion || "",
      value.fontMetricScale || 0,
      value.fontMetricSource || "",
      value.fontMetricResolverVersion || 0,
      value.libassProviderVerified === true,
      value.resolvedFontFormat || 0,
      value.resolvedBold === true,
      value.resolvedItalic === true,
      value.syntheticBold === true,
      value.syntheticItalic === true,
    ]);
    if (!nativeSubtitleFontFingerprint) {
      nativeSubtitleFontFingerprint = fingerprint;
      return;
    }
    if (fingerprint === nativeSubtitleFontFingerprint) return;
    releaseNativeSubtitleLocalFont();
    nativeSubtitleFontFingerprint = fingerprint;
    if (nativeSubtitleCopyEl) nativeSubtitleCopyEl.remove();
    nativeSubtitleCopyEl = createNativeSubtitleCopyElement();
    nativeSubtitleShadowRoot.appendChild(nativeSubtitleCopyEl);
  }

  function ensureNativeSubtitleDom() {
    if (
      nativeSubtitleHostEl &&
      nativeSubtitleShadowRoot &&
      nativeSubtitleCopyEl &&
      nativeSubtitleMatchHighlightsEl &&
      nativeSubtitleHitBoxesEl
    )
      return true;
    nativeSubtitleHostEl = document.createElement("div");
    nativeSubtitleHostEl.id = "native-subtitle-layer-host";
    nativeSubtitleHostEl.setAttribute("aria-hidden", "true");
    if (typeof nativeSubtitleHostEl.attachShadow !== "function") {
      nativeSubtitleHostEl = null;
      nativeSubtitleShadowRoot = null;
      nativeSubtitleCopyEl = null;
      nativeSubtitleHitBoxesEl = null;
      return false;
    }
    try {
      nativeSubtitleShadowRoot = nativeSubtitleHostEl.attachShadow({
        mode: "open",
      });
    } catch (_) {
      nativeSubtitleShadowRoot = null;
    }
    if (!nativeSubtitleShadowRoot) {
      nativeSubtitleHostEl = null;
      nativeSubtitleCopyEl = null;
      nativeSubtitleHitBoxesEl = null;
      return false;
    }
    nativeSubtitleCopyEl = createNativeSubtitleCopyElement();
    nativeSubtitleMatchHighlightsEl = document.createElement("div");
    nativeSubtitleMatchHighlightsEl.id = "native-subtitle-match-highlights";
    nativeSubtitleHitBoxesEl = document.createElement("div");
    nativeSubtitleHitBoxesEl.id = "native-subtitle-hit-boxes";
    nativeSubtitleHitBoxesEl.className = "hidden";
    nativeSubtitleHitBoxesEl.setAttribute("aria-hidden", "true");
    nativeSubtitleShadowRoot.appendChild(nativeSubtitleCopyEl);
    nativeSubtitleShadowRoot.appendChild(nativeSubtitleMatchHighlightsEl);
    document.body.appendChild(nativeSubtitleHostEl);
    document.body.appendChild(nativeSubtitleHitBoxesEl);
    setImportantStyle(nativeSubtitleHostEl, "all", "initial");
    setImportantStyle(nativeSubtitleHostEl, "position", "fixed");
    setImportantStyle(nativeSubtitleHostEl, "inset", "0");
    setImportantStyle(nativeSubtitleHostEl, "display", "block");
    setImportantStyle(nativeSubtitleHostEl, "width", "auto");
    setImportantStyle(nativeSubtitleHostEl, "height", "auto");
    setImportantStyle(nativeSubtitleHostEl, "min-width", "0");
    setImportantStyle(nativeSubtitleHostEl, "max-width", "none");
    setImportantStyle(nativeSubtitleHostEl, "min-height", "0");
    setImportantStyle(nativeSubtitleHostEl, "max-height", "none");
    setImportantStyle(nativeSubtitleHostEl, "margin", "0");
    setImportantStyle(nativeSubtitleHostEl, "padding", "0");
    setImportantStyle(nativeSubtitleHostEl, "border", "0");
    setImportantStyle(nativeSubtitleHostEl, "box-sizing", "border-box");
    setImportantStyle(nativeSubtitleHostEl, "transform", "none");
    setImportantStyle(nativeSubtitleHostEl, "translate", "none");
    setImportantStyle(nativeSubtitleHostEl, "rotate", "none");
    setImportantStyle(nativeSubtitleHostEl, "scale", "none");
    setImportantStyle(nativeSubtitleHostEl, "transform-origin", "0 0");
    setImportantStyle(nativeSubtitleHostEl, "perspective", "none");
    setImportantStyle(nativeSubtitleHostEl, "filter", "none");
    setImportantStyle(nativeSubtitleHostEl, "backdrop-filter", "none");
    setImportantStyle(nativeSubtitleHostEl, "zoom", "1");
    setImportantStyle(nativeSubtitleHostEl, "opacity", "1");
    setImportantStyle(nativeSubtitleHostEl, "visibility", "visible");
    setImportantStyle(nativeSubtitleHostEl, "clip", "auto");
    setImportantStyle(nativeSubtitleHostEl, "clip-path", "none");
    setImportantStyle(nativeSubtitleHostEl, "contain", "layout style");
    setImportantStyle(nativeSubtitleHostEl, "isolation", "isolate");
    setImportantStyle(nativeSubtitleHostEl, "mix-blend-mode", "normal");
    setImportantStyle(nativeSubtitleHostEl, "writing-mode", "horizontal-tb");
    setImportantStyle(nativeSubtitleHostEl, "direction", "ltr");
    setImportantStyle(nativeSubtitleHostEl, "pointer-events", "none");
    setImportantStyle(nativeSubtitleHostEl, "overflow", "visible");
    // The body-level host stays below the overlay-root (z-index 10) and its
    // popup (z-index 20), so WebKit's elementFromPoint sees popup controls
    // during overlap. Real cascade and elementFromPoint behavior remain part
    // of the manual IINA matrix.
    setImportantStyle(nativeSubtitleHostEl, "z-index", "2");
    setImportantStyle(nativeSubtitleMatchHighlightsEl, "all", "initial");
    setImportantStyle(nativeSubtitleMatchHighlightsEl, "position", "fixed");
    setImportantStyle(nativeSubtitleMatchHighlightsEl, "inset", "0");
    setImportantStyle(nativeSubtitleMatchHighlightsEl, "display", "block");
    setImportantStyle(
      nativeSubtitleMatchHighlightsEl,
      "pointer-events",
      "none",
    );
    setImportantStyle(nativeSubtitleMatchHighlightsEl, "overflow", "visible");
    setImportantStyle(nativeSubtitleMatchHighlightsEl, "z-index", "2");
    setImportantStyle(nativeSubtitleHitBoxesEl, "all", "initial");
    setImportantStyle(nativeSubtitleHitBoxesEl, "position", "fixed");
    setImportantStyle(nativeSubtitleHitBoxesEl, "inset", "0");
    setImportantStyle(nativeSubtitleHitBoxesEl, "display", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "width", "auto");
    setImportantStyle(nativeSubtitleHitBoxesEl, "height", "auto");
    setImportantStyle(nativeSubtitleHitBoxesEl, "min-width", "0");
    setImportantStyle(nativeSubtitleHitBoxesEl, "max-width", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "min-height", "0");
    setImportantStyle(nativeSubtitleHitBoxesEl, "max-height", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "margin", "0");
    setImportantStyle(nativeSubtitleHitBoxesEl, "padding", "0");
    setImportantStyle(nativeSubtitleHitBoxesEl, "border", "0");
    setImportantStyle(nativeSubtitleHitBoxesEl, "box-sizing", "border-box");
    setImportantStyle(nativeSubtitleHitBoxesEl, "transform", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "translate", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "rotate", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "scale", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "transform-origin", "0 0");
    setImportantStyle(nativeSubtitleHitBoxesEl, "perspective", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "filter", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "backdrop-filter", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "zoom", "1");
    setImportantStyle(nativeSubtitleHitBoxesEl, "opacity", "1");
    setImportantStyle(nativeSubtitleHitBoxesEl, "visibility", "visible");
    setImportantStyle(nativeSubtitleHitBoxesEl, "clip", "auto");
    setImportantStyle(nativeSubtitleHitBoxesEl, "clip-path", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "contain", "layout style");
    setImportantStyle(nativeSubtitleHitBoxesEl, "isolation", "isolate");
    setImportantStyle(nativeSubtitleHitBoxesEl, "mix-blend-mode", "normal");
    setImportantStyle(
      nativeSubtitleHitBoxesEl,
      "writing-mode",
      "horizontal-tb",
    );
    setImportantStyle(nativeSubtitleHitBoxesEl, "direction", "ltr");
    setImportantStyle(nativeSubtitleHitBoxesEl, "pointer-events", "none");
    setImportantStyle(nativeSubtitleHitBoxesEl, "overflow", "visible");
    setImportantStyle(nativeSubtitleHitBoxesEl, "z-index", "2");
    return true;
  }

  function destroyNativeSubtitleDom() {
    state.nativeHitGeneration++;
    releaseNativeSubtitleLocalFont();
    if (nativeSubtitleHostEl) nativeSubtitleHostEl.remove();
    if (nativeSubtitleHitBoxesEl) nativeSubtitleHitBoxesEl.remove();
    nativeSubtitleHostEl = null;
    nativeSubtitleShadowRoot = null;
    nativeSubtitleCopyEl = null;
    nativeSubtitleMatchHighlightsEl = null;
    nativeSubtitleHitBoxesEl = null;
    nativeSubtitleFontFingerprint = "";
  }

  function clearNativeSubtitleHitLayer() {
    state.nativeHitGeneration++;
    if (!nativeSubtitleCopyEl || !nativeSubtitleHitBoxesEl) return;
    nativeSubtitleCopyEl.textContent = "";
    if (nativeSubtitleMatchHighlightsEl)
      nativeSubtitleMatchHighlightsEl.textContent = "";
    setImportantStyle(nativeSubtitleCopyEl, "display", "none");
    nativeSubtitleCopyEl.classList.add("hidden");
    nativeSubtitleHitBoxesEl.textContent = "";
    setImportantStyle(nativeSubtitleHitBoxesEl, "display", "none");
    nativeSubtitleHitBoxesEl.classList.add("hidden");
  }

  function invalidateNativeSubtitleHitLayer(reason) {
    clearNativeSubtitleHitLayer();
    hidePopup();
    state.currentAnchor = null;
    state.currentPos = null;
    popupSafetyZoneEl.classList.add("hidden");
    popupRowSafetyZoneEl.classList.add("hidden");
    if (reason) {
      overlayDebug("native subtitle hit layer invalidated: " + reason);
      const viewport = nativeOverlayViewport();
      const fontState = nativeLayoutFontState(state.nativeLayout);
      const key = JSON.stringify([state.lineId, reason, viewport, fontState]);
      if (key !== state.nativeDiagnosticKey) {
        state.nativeDiagnosticKey = key;
        const diagnostic = {
          type: "native-layout-diagnostic",
          lineId: state.lineId,
          reason,
          viewport,
          osd: state.nativeLayout && state.nativeLayout.osd,
          fontState,
          dpr: Number(window.devicePixelRatio || 0),
          hidpiScale: Number(
            (state.nativeLayout && state.nativeLayout.hidpiScale) || 0,
          ),
        };
        sendBridgeMessage(diagnostic);
        try {
          iina.postMessage("native-layout-diagnostic", diagnostic);
        } catch (_) {}
      }
    }
  }

  function nativeLayoutFontState(nativeLayout) {
    const options =
      nativeLayout &&
      nativeLayout.options &&
      typeof nativeLayout.options === "object"
        ? nativeLayout.options
        : {};
    return {
      effectiveFont: String(options.effectiveFont || options.font || ""),
      runtimeFont: String(options.runtimeFont || ""),
      optionFont: String(options.optionFont || ""),
      resolvedPostScriptName: String(options.resolvedPostScriptName || ""),
      resolvedFamilyName: String(options.resolvedFamilyName || ""),
      resolvedFullName: String(options.resolvedFullName || ""),
      fontVersion: String(options.fontVersion || ""),
      fontMetricScale: Number(options.fontMetricScale || 0),
      fontMetricSource: String(options.fontMetricSource || ""),
      fontMetricResolverVersion: Number(options.fontMetricResolverVersion || 0),
      libassProviderVerified: options.libassProviderVerified === true,
      resolvedFontFormat: Number(options.resolvedFontFormat || 0),
      resolvedBold: options.resolvedBold === true,
      resolvedItalic: options.resolvedItalic === true,
      syntheticBold: options.syntheticBold === true,
      syntheticItalic: options.syntheticItalic === true,
    };
  }

  function publishAcceptedNativeLayoutDiagnostic(
    layout,
    geometry,
    viewport,
    nativeLayout,
  ) {
    const diagnostic = {
      lineId: state.lineId,
      reason: "accepted-layout",
      accepted: true,
      viewport,
      osd: nativeLayout && nativeLayout.osd,
      fontState: nativeLayoutFontState(nativeLayout),
      ratios: {
        scaleX: Number(geometry.scaleX),
        scaleY: Number(geometry.scaleY),
      },
      layoutMetrics: {
        mode: layout ? "html-text" : "native-ass-mask",
        fontSize: Number((layout && layout.fontSize) || 0),
        lineHeight: Number((layout && layout.lineHeight) || 0),
        letterSpacing: Number((layout && layout.letterSpacing) || 0),
        fontFamily: String((layout && layout.fontFamily) || ""),
        fontWeight: String((layout && layout.fontWeight) || ""),
        fontStyle: String((layout && layout.fontStyle) || ""),
        maxWidth: Number((layout && layout.maxWidth) || 0),
        textAlign: String((layout && layout.textAlign) || ""),
      },
      dpr: Number(window.devicePixelRatio || 0),
      hidpiScale: Number((nativeLayout && nativeLayout.hidpiScale) || 0),
    };
    const key = JSON.stringify(diagnostic);
    if (key === state.nativeAcceptedDiagnosticKey) return;
    state.nativeAcceptedDiagnosticKey = key;
    sendBridgeMessage({
      type: "native-layout-diagnostic",
      ...diagnostic,
    });
    try {
      // Deliberately excludes display/lookup text so ordinary diagnostics do
      // not leak caption contents.
      iina.postMessage("native-layout-diagnostic", diagnostic);
    } catch (_) {}
  }

  function nativeSubtitleDomNow() {
    return window.performance && typeof window.performance.now === "function"
      ? window.performance.now()
      : Date.now();
  }

  function publishNativeSubtitleDomPerformance(
    startedAt,
    mode,
    hitTargetCount,
  ) {
    if (!state.config || state.config.debugLogVerbose !== true) return;
    const diagnostic = {
      type: "native-layout-performance",
      mode: String(mode || ""),
      domUpdateMs: Math.max(0, nativeSubtitleDomNow() - startedAt),
      hitTargetCount: Math.max(0, Number(hitTargetCount) || 0),
    };
    sendBridgeMessage(diagnostic);
    try {
      iina.postMessage("native-layout-performance", diagnostic);
    } catch (_) {}
  }

  function setImportantStyle(element, name, value) {
    if (element.style && typeof element.style.setProperty === "function") {
      element.style.setProperty(name, String(value), "important");
    } else {
      element.style[name] = String(value);
    }
  }

  function renderNativeAssAlphaMask(mask, geometry, opacity, copyElement) {
    const target = copyElement || nativeSubtitleCopyEl;
    if (
      !mask ||
      mask.encoding !== "rle-u8-base64" ||
      typeof mask.data !== "string"
    )
      return false;
    let encoded;
    try {
      const decode =
        typeof window.atob === "function"
          ? window.atob.bind(window)
          : typeof atob === "function"
            ? atob
            : null;
      if (!decode) return false;
      encoded = decode(mask.data);
    } catch (_) {
      return false;
    }
    const pixelCount = Number(mask.w) * Number(mask.h);
    if (!Number.isInteger(pixelCount) || pixelCount <= 0 || pixelCount > 262144)
      return false;
    const alpha = new Uint8ClampedArray(pixelCount);
    let pixelOffset = 0;
    for (let offset = 0; offset + 1 < encoded.length; offset += 2) {
      const run = encoded.charCodeAt(offset);
      const value = encoded.charCodeAt(offset + 1);
      if (!run || pixelOffset + run > pixelCount) return false;
      alpha.fill(value, pixelOffset, pixelOffset + run);
      pixelOffset += run;
    }
    if (pixelOffset !== pixelCount || encoded.length % 2) return false;
    const canvas = document.createElement("canvas");
    canvas.width = mask.w;
    canvas.height = mask.h;
    const context =
      typeof canvas.getContext === "function"
        ? canvas.getContext("2d", { alpha: true })
        : null;
    if (!context || typeof context.createImageData !== "function") return false;
    const image = context.createImageData(mask.w, mask.h);
    for (let index = 0; index < pixelCount; index++) {
      const rgba = index * 4;
      image.data[rgba] = 255;
      image.data[rgba + 1] = 255;
      image.data[rgba + 2] = 255;
      image.data[rgba + 3] = alpha[index];
    }
    context.putImageData(image, 0, 0);
    target.textContent = "";
    target.appendChild(canvas);
    setImportantStyle(target, "all", "initial");
    setImportantStyle(target, "display", "block");
    setImportantStyle(target, "position", "fixed");
    setImportantStyle(target, "inset", "0");
    setImportantStyle(target, "pointer-events", "none");
    setImportantStyle(target, "opacity", opacity);
    setImportantStyle(target, "z-index", "1");
    setImportantStyle(canvas, "all", "initial");
    setImportantStyle(canvas, "display", "block");
    setImportantStyle(canvas, "position", "fixed");
    setImportantStyle(canvas, "left", mask.x * geometry.scaleX + "px");
    setImportantStyle(canvas, "top", mask.y * geometry.scaleY + "px");
    setImportantStyle(canvas, "width", mask.w * geometry.scaleX + "px");
    setImportantStyle(canvas, "height", mask.h * geometry.scaleY + "px");
    setImportantStyle(canvas, "pointer-events", "none");
    target.classList.remove("hidden");
    return true;
  }

  function nativeRangeRects(lookupSpans, start, end, copyElement) {
    const target = copyElement || nativeSubtitleCopyEl;
    if (!document.createRange) return [];
    const node = target.firstChild;
    const displayStart = lookupSpans[start];
    const displayEnd = lookupSpans[Math.max(start, end - 1)];
    if (
      !node ||
      !displayStart ||
      !displayEnd ||
      displayEnd.endUtf16 < displayStart.startUtf16
    )
      return [];
    try {
      const range = document.createRange();
      range.setStart(node, displayStart.startUtf16);
      range.setEnd(node, displayEnd.endUtf16);
      return Array.prototype.slice.call(range.getClientRects());
    } catch (_) {
      return [];
    }
  }

  function nativeCopyLineRects(copyElement) {
    if (!document.createRange || !copyElement || !copyElement.firstChild)
      return [];
    try {
      const range = document.createRange();
      range.setStart(copyElement.firstChild, 0);
      range.setEnd(
        copyElement.firstChild,
        String(copyElement.textContent || "").length,
      );
      return Array.prototype.slice.call(range.getClientRects());
    } catch (_) {
      return [];
    }
  }

  function nativeCopyRequiresAutomaticWrap(displayText) {
    if (!document.createRange || !nativeSubtitleCopyEl.firstChild) return true;
    const lines = String(displayText || "").split("\n");
    const node = nativeSubtitleCopyEl.firstChild;
    let offset = 0;
    try {
      for (const line of lines) {
        if (line.length) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + line.length);
          if (
            IINATAN_NATIVE_SUBTITLE_HIT_LAYER.rectanglesSpanMultipleLines(
              Array.prototype.slice.call(range.getClientRects()),
            )
          )
            return true;
        }
        offset += line.length + 1;
      }
    } catch (_) {
      return true;
    }
    return false;
  }

  function nativeOverlayViewport() {
    const root = document.documentElement || {};
    return {
      width: Number(root.clientWidth || window.innerWidth || 0),
      height: Number(root.clientHeight || window.innerHeight || 0),
    };
  }

  function nativePrimaryFontFamily(value) {
    const first = String(value || "sans-serif")
      .split(",")[0]
      .trim();
    return first.replace(/^['"]|['"]$/g, "");
  }

  function nativeFontProbeSamples(text) {
    const cue = String(text || "")
      .replace(/\s+/g, "")
      .slice(0, 24);
    if (/[\u3040-\u30ff\u31f0-\u31ff\u3400-\u9fff\uf900-\ufaff]/.test(cue))
      return [cue || "あいう漢字", "あいうえお漢字日本語"];
    if (/[\uac00-\ud7af]/.test(cue))
      return [cue || "한글", "가나다라마바사한글"];
    if (/[\u0400-\u04ff]/.test(cue)) return [cue || "Кириллица", "ЖЩЮя"];
    return [cue || "mmmmmmmmmmlliWW@#", "mmmmmmmmmmlliWW@#"];
  }

  function nativeFontMetricSignature(context, sample) {
    const metrics = context.measureText(sample);
    return [
      metrics.width,
      metrics.actualBoundingBoxLeft,
      metrics.actualBoundingBoxRight,
      metrics.actualBoundingBoxAscent,
      metrics.actualBoundingBoxDescent,
      metrics.fontBoundingBoxAscent,
      metrics.fontBoundingBoxDescent,
    ]
      .map((value) => {
        const number = Number(value);
        return Number.isFinite(number) ? number.toFixed(3) : "";
      })
      .join(":");
  }

  function nativeFontFamilyAvailable(value, text) {
    const family = nativePrimaryFontFamily(value);
    if (
      /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|-apple-system)$/i.test(
        family,
      )
    )
      return true;
    if (!family || /[;{}]/.test(family)) return false;
    const canvas = document.createElement("canvas");
    const context =
      canvas && typeof canvas.getContext === "function"
        ? canvas.getContext("2d")
        : null;
    if (!context || typeof context.measureText !== "function") return false;
    return nativeFontProbeSamples(text).some((sample) =>
      ["monospace", "serif", "sans-serif"].some((fallback) => {
        context.font = "72px " + fallback;
        const baseline = nativeFontMetricSignature(context, sample);
        context.font =
          '72px "' +
          family.replace(/\\/g, "\\\\").replace(/"/g, '\\"') +
          '", ' +
          fallback;
        return nativeFontMetricSignature(context, sample) !== baseline;
      }),
    );
  }

  function releaseNativeSubtitleLocalFont() {
    const current = nativeSubtitleLocalFont;
    nativeSubtitleLocalFont = null;
    if (
      current &&
      current.added &&
      document.fonts &&
      typeof document.fonts.delete === "function"
    ) {
      try {
        document.fonts.delete(current.face);
      } catch (_) {}
    }
  }

  function nativeSubtitleFontFamilyForMeasurement(
    requestedFamily,
    isCurrentCueGeneration,
    resolvedFace,
    copyElement,
  ) {
    const target = copyElement || nativeSubtitleCopyEl;
    const family = nativePrimaryFontFamily(requestedFamily);
    if (
      /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|-apple-system)$/i.test(
        family,
      )
    )
      return Promise.resolve({
        cssFamily: requestedFamily,
        localFontVerified: true,
      });
    const FontFaceConstructor = window.FontFace;
    const fontSet = document.fonts;
    if (
      !family ||
      /[;{}\r\n]/.test(family) ||
      typeof FontFaceConstructor !== "function" ||
      !fontSet ||
      typeof fontSet.add !== "function"
    )
      return Promise.resolve({
        cssFamily: requestedFamily,
        localFontVerified: false,
      });
    if (
      nativeSubtitleLocalFont &&
      nativeSubtitleLocalFont.requestedFamily === family
    ) {
      return nativeSubtitleLocalFont.ready.then((record) => {
        if (!record || !isCurrentCueGeneration()) return null;
        setImportantStyle(target, "font-family", '"' + record.alias + '"');
        return {
          cssFamily: '"' + record.alias + '"',
          localFontVerified: true,
        };
      });
    }
    releaseNativeSubtitleLocalFont();
    const alias =
      "iinatan-native-subtitle-font-" + ++nativeSubtitleLocalFontGeneration;
    const source =
      'local("' + family.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '")';
    let face;
    try {
      face = new FontFaceConstructor(alias, source, {
        weight: resolvedFace && resolvedFace.resolvedBold ? "700" : "400",
        style:
          resolvedFace && resolvedFace.resolvedItalic ? "italic" : "normal",
      });
    } catch (_) {
      return Promise.reject(new Error("font-unavailable"));
    }
    const record = {
      requestedFamily: family,
      alias,
      face,
      added: false,
      ready: null,
    };
    nativeSubtitleLocalFont = record;
    record.ready = Promise.resolve(face.load()).then((loadedFace) => {
      if (nativeSubtitleLocalFont !== record) return null;
      record.face = loadedFace || face;
      fontSet.add(record.face);
      record.added = true;
      return record;
    });
    return record.ready.then((loadedRecord) => {
      if (!loadedRecord || !isCurrentCueGeneration()) return null;
      setImportantStyle(target, "font-family", '"' + loadedRecord.alias + '"');
      return {
        cssFamily: '"' + loadedRecord.alias + '"',
        localFontVerified: true,
      };
    });
  }

  function applyNativeLayout(layout, balanceWrapSupported) {
    setImportantStyle(nativeSubtitleCopyEl, "all", "initial");
    setImportantStyle(nativeSubtitleCopyEl, "position", "absolute");
    setImportantStyle(nativeSubtitleCopyEl, "display", "block");
    setImportantStyle(
      nativeSubtitleCopyEl,
      "left",
      layout.left === undefined ? "auto" : layout.left + "px",
    );
    setImportantStyle(
      nativeSubtitleCopyEl,
      "right",
      layout.right === undefined ? "auto" : layout.right + "px",
    );
    setImportantStyle(nativeSubtitleCopyEl, "width", layout.width);
    setImportantStyle(nativeSubtitleCopyEl, "min-width", "0");
    setImportantStyle(
      nativeSubtitleCopyEl,
      "max-width",
      layout.maxWidth + "px",
    );
    setImportantStyle(nativeSubtitleCopyEl, "height", "auto");
    setImportantStyle(nativeSubtitleCopyEl, "min-height", "0");
    setImportantStyle(nativeSubtitleCopyEl, "max-height", "none");
    setImportantStyle(
      nativeSubtitleCopyEl,
      "font-size",
      layout.fontSize + "px",
    );
    setImportantStyle(
      nativeSubtitleCopyEl,
      "line-height",
      layout.lineHeight + "px",
    );
    setImportantStyle(
      nativeSubtitleCopyEl,
      "letter-spacing",
      layout.letterSpacing + "px",
    );
    setImportantStyle(nativeSubtitleCopyEl, "word-spacing", "0");
    setImportantStyle(nativeSubtitleCopyEl, "text-align", layout.textAlign);
    setImportantStyle(nativeSubtitleCopyEl, "font-family", layout.fontFamily);
    setImportantStyle(nativeSubtitleCopyEl, "font-weight", layout.fontWeight);
    setImportantStyle(nativeSubtitleCopyEl, "font-style", layout.fontStyle);
    setImportantStyle(nativeSubtitleCopyEl, "color", "var(--subtitle-color)");
    setImportantStyle(nativeSubtitleCopyEl, "white-space", "pre-wrap");
    setImportantStyle(
      nativeSubtitleCopyEl,
      "text-wrap",
      balanceWrapSupported ? "balance" : "wrap",
    );
    setImportantStyle(
      nativeSubtitleCopyEl,
      "text-wrap-style",
      balanceWrapSupported ? "balance" : "auto",
    );
    setImportantStyle(nativeSubtitleCopyEl, "overflow-wrap", "normal");
    setImportantStyle(nativeSubtitleCopyEl, "word-break", "normal");
    setImportantStyle(nativeSubtitleCopyEl, "writing-mode", "horizontal-tb");
    setImportantStyle(nativeSubtitleCopyEl, "direction", "ltr");
    setImportantStyle(nativeSubtitleCopyEl, "unicode-bidi", "plaintext");
    setImportantStyle(nativeSubtitleCopyEl, "text-orientation", "mixed");
    setImportantStyle(nativeSubtitleCopyEl, "font-kerning", "auto");
    setImportantStyle(nativeSubtitleCopyEl, "font-feature-settings", "normal");
    setImportantStyle(nativeSubtitleCopyEl, "font-variant", "normal");
    setImportantStyle(nativeSubtitleCopyEl, "font-synthesis", "weight style");
    setImportantStyle(nativeSubtitleCopyEl, "box-sizing", "content-box");
    setImportantStyle(nativeSubtitleCopyEl, "margin", "0");
    setImportantStyle(nativeSubtitleCopyEl, "padding", "0");
    setImportantStyle(nativeSubtitleCopyEl, "border", "0");
    setImportantStyle(nativeSubtitleCopyEl, "text-indent", "0");
    setImportantStyle(nativeSubtitleCopyEl, "text-transform", "none");
    setImportantStyle(nativeSubtitleCopyEl, "text-decoration", "none");
    setImportantStyle(nativeSubtitleCopyEl, "text-overflow", "clip");
    setImportantStyle(nativeSubtitleCopyEl, "text-shadow", "none");
    setImportantStyle(
      nativeSubtitleCopyEl,
      "-webkit-text-stroke",
      "0 transparent",
    );
    setImportantStyle(nativeSubtitleCopyEl, "pointer-events", "none");
    setImportantStyle(nativeSubtitleCopyEl, "overflow", "visible");
    setImportantStyle(nativeSubtitleCopyEl, "filter", "none");
    setImportantStyle(nativeSubtitleCopyEl, "backdrop-filter", "none");
    setImportantStyle(nativeSubtitleCopyEl, "perspective", "none");
    setImportantStyle(nativeSubtitleCopyEl, "translate", "none");
    setImportantStyle(nativeSubtitleCopyEl, "rotate", "none");
    setImportantStyle(nativeSubtitleCopyEl, "scale", "none");
    setImportantStyle(nativeSubtitleCopyEl, "zoom", "1");
    setImportantStyle(nativeSubtitleCopyEl, "visibility", "visible");
    setImportantStyle(nativeSubtitleCopyEl, "clip", "auto");
    setImportantStyle(nativeSubtitleCopyEl, "clip-path", "none");
    setImportantStyle(nativeSubtitleCopyEl, "contain", "style");
    setImportantStyle(nativeSubtitleCopyEl, "isolation", "isolate");
    setImportantStyle(nativeSubtitleCopyEl, "mix-blend-mode", "normal");
    setImportantStyle(nativeSubtitleCopyEl, "z-index", "1");
    setImportantStyle(nativeSubtitleCopyEl, "transform-origin", "0 0");
    setImportantStyle(
      nativeSubtitleCopyEl,
      "transform",
      layout.transform || "none",
    );
    setImportantStyle(
      nativeSubtitleCopyEl,
      "top",
      layout.top === undefined ? "auto" : layout.top + "px",
    );
    setImportantStyle(
      nativeSubtitleCopyEl,
      "bottom",
      layout.bottom === undefined ? "auto" : layout.bottom + "px",
    );
  }

  function renderNativeSurfaceHitBoxes(measured, viewport) {
    const boxes = IINATAN_NATIVE_SUBTITLE_HIT_LAYER.resolveHitBoxOverlaps(
      measured,
      2,
    );
    boxes.forEach((box) => {
      if (
        box.left < -3 ||
        box.top < -3 ||
        box.left + box.width > viewport.width + 3 ||
        box.top + box.height > viewport.height + 3
      )
        return;
      const hit = document.createElement("div");
      hit.className =
        "native-subtitle-hit-box" +
        (state.config.experimentalNativeSubtitleHitBoxes ? " debug" : "");
      hit.setAttribute("data-clickable", "true");
      hit.dataset.pos = String(box.position);
      if (box.surface) hit.dataset.surface = String(box.surface);
      setImportantStyle(hit, "all", "initial");
      setImportantStyle(hit, "display", "block");
      setImportantStyle(hit, "position", "fixed");
      setImportantStyle(hit, "left", Math.max(0, box.left) + "px");
      setImportantStyle(hit, "top", Math.max(0, box.top) + "px");
      setImportantStyle(hit, "width", box.width + "px");
      setImportantStyle(hit, "height", box.height + "px");
      setImportantStyle(hit, "box-sizing", "border-box");
      setImportantStyle(hit, "pointer-events", "auto");
      setImportantStyle(hit, "z-index", "3");
      setImportantStyle(
        hit,
        "border",
        state.config.experimentalNativeSubtitleHitBoxes
          ? "1px solid rgba(80, 190, 255, .9)"
          : "0 solid transparent",
      );
      setImportantStyle(
        hit,
        "background",
        state.config.experimentalNativeSubtitleHitBoxes
          ? "rgba(80, 190, 255, .14)"
          : "transparent",
      );
      hit.addEventListener("mouseenter", onCharEnter);
      hit.addEventListener("click", onCharEnter);
      hit.addEventListener("mouseleave", scheduleHidePopup);
      nativeSubtitleHitBoxesEl.appendChild(hit);
      if (!state.charByPos[box.position]) state.charByPos[box.position] = hit;
    });
    if (nativeSubtitleHitBoxesEl.children.length) {
      setImportantStyle(nativeSubtitleHitBoxesEl, "display", "block");
      nativeSubtitleHitBoxesEl.classList.remove("hidden");
    } else {
      invalidateNativeSubtitleHitLayer("missing-unit-fill");
    }
  }

  function renderNativeSubtitleSurfaces(surfaces) {
    const domUpdateStartedAt = nativeSubtitleDomNow();
    const list = Array.isArray(surfaces)
      ? surfaces.filter(
          (surface) => surface && !surface.reason && surface.layout,
        )
      : [];
    if (!list.length) {
      invalidateNativeSubtitleHitLayer("empty-subtitle");
      return;
    }
    if (
      surfaces.length === 1 &&
      list.length === 1 &&
      String(list[0].surface || list[0].role) === "primary" &&
      (!Array.isArray(list[0].layout.eventBlocks) ||
        list[0].layout.eventBlocks.length <= 1)
    ) {
      renderNativeSubtitleHitLayer(
        String(list[0].displayText || ""),
        "",
        list[0].lookupSpans,
        list[0].layout,
      );
      return;
    }
    const contextReason = nativeGeometryContextReason();
    if (contextReason || !ensureNativeSubtitleDom()) {
      invalidateNativeSubtitleHitLayer(
        contextReason || "non-coextensive-overlay",
      );
      return;
    }
    nativeSubtitleCopyEl.textContent = "";
    setImportantStyle(nativeSubtitleCopyEl, "all", "initial");
    setImportantStyle(nativeSubtitleCopyEl, "display", "block");
    setImportantStyle(nativeSubtitleCopyEl, "position", "fixed");
    setImportantStyle(nativeSubtitleCopyEl, "inset", "0");
    setImportantStyle(nativeSubtitleCopyEl, "pointer-events", "none");
    setImportantStyle(nativeSubtitleCopyEl, "overflow", "visible");
    nativeSubtitleCopyEl.classList.remove("hidden");
    nativeSubtitleHitBoxesEl.textContent = "";
    state.charByPos = Object.create(null);
    const viewport = nativeOverlayViewport();
    const measured = [];
    const plainRecords = [];
    const fontReadiness = [];
    const generation = state.nativeHitGeneration;
    const cueLineId = state.lineId;
    const cueText = state.text;
    const cueSurfaces = state.nativeSurfaces;
    const cueCopyRoot = nativeSubtitleCopyEl;
    const cueHitRoot = nativeSubtitleHitBoxesEl;
    const isCurrent = () =>
      generation === state.nativeHitGeneration &&
      state.enabled &&
      state.lineId === cueLineId &&
      state.text === cueText &&
      state.nativeSurfaces === cueSurfaces &&
      nativeSubtitleCopyEl === cueCopyRoot &&
      nativeSubtitleHitBoxesEl === cueHitRoot;
    const copyOpacity = Math.max(
      0,
      Math.min(
        1,
        Number(state.config.experimentalNativeSubtitleTextOpacity) || 0,
      ),
    );
    list.forEach((surface, surfaceIndex) => {
      const role = String(surface.surface || surface.role || surfaceIndex);
      const layout = surface.layout;
      const geometry = IINATAN_NATIVE_SUBTITLE_HIT_LAYER.validateGeometry(
        layout.osd,
        viewport,
      );
      if (!geometry.ok) return;
      if (Array.isArray(layout.directRects)) {
        const copy = createNativeSubtitleCopyElement();
        copy.id = "native-subtitle-copy-" + role;
        copy.dataset.surface = role;
        nativeSubtitleCopyEl.appendChild(copy);
        if (copyOpacity > 0)
          renderNativeAssAlphaMask(
            layout.alphaMask,
            geometry,
            copyOpacity,
            copy,
          );
        layout.directRects.forEach((unit) => {
          (unit.rects || []).forEach((rect) => {
            const left = Number(rect.x) * geometry.scaleX;
            const top = Number(rect.y) * geometry.scaleY;
            const width = Number(rect.w) * geometry.scaleX;
            const height = Number(rect.h) * geometry.scaleY;
            if (
              ![left, top, width, height].every(Number.isFinite) ||
              width <= 0 ||
              height <= 0
            )
              return;
            measured.push({
              left,
              top,
              right: left + width,
              bottom: top + height,
              width,
              height,
              position: Number(unit.position),
              surface: role,
            });
          });
        });
        return;
      }
      const calculated =
        IINATAN_NATIVE_SUBTITLE_HIT_LAYER.calculatePlainTextLayout(
          geometry,
          layout.options,
        );
      if (!calculated.ok) return;
      const eventBlocks =
        Array.isArray(layout.eventBlocks) && layout.eventBlocks.length > 1
          ? layout.eventBlocks
          : [
              {
                displayText: surface.displayText,
                lookupText: surface.lookupText,
                lookupStart: surface.lookupStart,
                lookupLength: surface.lookupLength,
                lookupSpans: surface.lookupSpans,
                stackIndex: 0,
              },
            ];
      eventBlocks.forEach((block, blockIndex) => {
        const copy = createNativeSubtitleCopyElement();
        copy.id =
          "native-subtitle-copy-" +
          role +
          (eventBlocks.length > 1 ? "-" + blockIndex : "");
        copy.dataset.surface = role;
        if (eventBlocks.length > 1)
          copy.dataset.eventIndex = String(blockIndex);
        nativeSubtitleCopyEl.appendChild(copy);
        const previousCopy = nativeSubtitleCopyEl;
        nativeSubtitleCopyEl = copy;
        applyNativeLayout(
          calculated,
          IINATAN_NATIVE_SUBTITLE_HIT_LAYER.balancedTextWrapSupported(
            window.CSS,
            document.createElement("span").style,
          ),
        );
        nativeSubtitleCopyEl = previousCopy;
        copy.textContent = String(block.displayText || "");
        setImportantStyle(copy, "opacity", copyOpacity);
        copy.classList.remove("hidden");
        const record = {
          surface,
          role,
          block,
          copy,
          calculated,
          baseTransform: calculated.transform || "none",
          fontReady: true,
          stacked: eventBlocks.length > 1,
        };
        plainRecords.push(record);
        const fontSet = document.fonts;
        if (
          fontSet &&
          typeof fontSet.load === "function" &&
          typeof fontSet.check === "function"
        ) {
          fontReadiness.push(
            nativeSubtitleFontFamilyForMeasurement(
              layout.options.effectiveFont || layout.options.font,
              isCurrent,
              layout.options,
              copy,
            )
              .then((fontResolution) => {
                if (!fontResolution || !isCurrent()) {
                  record.fontReady = false;
                  return null;
                }
                const fontSpec =
                  String(Math.max(1, calculated.fontSize)) +
                  "px " +
                  String(fontResolution.cssFamily || "sans-serif");
                return Promise.resolve(
                  fontSet.load(fontSpec, String(block.displayText || "")),
                ).then(() => ({ fontResolution, fontSpec }));
              })
              .then((fontLoad) => {
                if (!fontLoad) return;
                record.fontReady =
                  isCurrent() &&
                  fontSet.check(
                    fontLoad.fontSpec,
                    String(block.displayText || ""),
                  ) &&
                  (fontLoad.fontResolution.localFontVerified ||
                    nativeFontFamilyAvailable(
                      calculated.fontFamily,
                      String(block.displayText || ""),
                    ));
              })
              .catch(() => {
                record.fontReady = false;
              }),
          );
        }
      });
    });
    const stackEventBlocks = () => {
      const groups = Object.create(null);
      plainRecords.forEach((record) => {
        if (!record.stacked || !record.fontReady) return;
        if (!groups[record.role]) groups[record.role] = [];
        groups[record.role].push(record);
      });
      Object.keys(groups).forEach((role) => {
        const records = groups[role].sort(
          (left, right) =>
            Number(left.block.stackIndex) - Number(right.block.stackIndex),
        );
        let rowOffset = 0;
        records.forEach((record) => {
          if (rowOffset > 0) {
            const base =
              record.baseTransform && record.baseTransform !== "none"
                ? record.baseTransform + " "
                : "";
            setImportantStyle(
              record.copy,
              "transform",
              base + "translateY(-" + rowOffset + "px)",
            );
          }
          const rows = [];
          nativeCopyLineRects(record.copy).forEach((rect) => {
            if (
              rect &&
              Number.isFinite(Number(rect.top)) &&
              !rows.some((top) => Math.abs(top - Number(rect.top)) <= 1.5)
            )
              rows.push(Number(rect.top));
          });
          rowOffset +=
            Math.max(
              1,
              rows.length ||
                String(record.block.displayText || "").split("\n").length,
            ) * record.calculated.lineHeight;
        });
      });
    };
    const finish = () => {
      if (!isCurrent()) return;
      plainRecords.forEach((record) => {
        if (!record.fontReady) return;
        const lookupStart = Number(record.block.lookupStart) || 0;
        const localLength = Array.from(
          String(record.block.lookupText || ""),
        ).length;
        for (
          let globalPosition = lookupStart;
          globalPosition < lookupStart + localLength;
          globalPosition++
        ) {
          if (!isLookupableChar(state.chars[globalPosition])) continue;
          const unit = lookupUnitForPosition(globalPosition);
          if (
            unit.pos !== globalPosition ||
            unit.preview.start < lookupStart ||
            unit.preview.end > lookupStart + localLength
          )
            continue;
          nativeRangeRects(
            record.block.lookupSpans,
            unit.preview.start - lookupStart,
            unit.preview.end - lookupStart,
            record.copy,
          ).forEach((rect) => {
            if (!rect || rect.width <= 0 || rect.height <= 0) return;
            measured.push({
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              width: rect.width,
              height: rect.height,
              position: globalPosition,
              surface: record.role,
            });
          });
        }
      });
      renderNativeSurfaceHitBoxes(measured, viewport);
      publishNativeSubtitleDomPerformance(
        domUpdateStartedAt,
        "combined-surfaces",
        nativeSubtitleHitBoxesEl ? nativeSubtitleHitBoxesEl.children.length : 0,
      );
    };
    const scheduleFinish = () => {
      if (!isCurrent()) return;
      stackEventBlocks();
      if (
        plainRecords.length &&
        typeof window.requestAnimationFrame === "function"
      )
        window.requestAnimationFrame(finish);
      else finish();
    };
    if (fontReadiness.length) Promise.all(fontReadiness).then(scheduleFinish);
    else scheduleFinish();
  }

  function renderNativeSubtitleHitLayer(
    displayText,
    reason,
    lookupSpans,
    nativeLayout,
  ) {
    const domUpdateStartedAt = nativeSubtitleDomNow();
    state.nativeDisplayText = displayText;
    state.nativeReason = reason;
    state.nativeLookupSpans = Array.isArray(lookupSpans)
      ? lookupSpans.slice()
      : [];
    state.nativeLayout = nativeLayout || null;
    const contextReason = nativeGeometryContextReason();
    if (contextReason) {
      destroyNativeSubtitleDom();
      invalidateNativeSubtitleHitLayer(contextReason);
      return;
    }
    if (!ensureNativeSubtitleDom()) {
      invalidateNativeSubtitleHitLayer("non-coextensive-overlay");
      return;
    }
    if (
      reason ||
      !displayText ||
      state.nativeLookupSpans.length !== state.chars.length ||
      !nativeLayout
    ) {
      if (reason) overlayDebug("native subtitle hit layer skipped: " + reason);
      else
        overlayDebug(
          "native subtitle hit layer skipped: text-index-map-failed",
        );
      invalidateNativeSubtitleHitLayer(reason || "text-index-map-failed");
      return;
    }
    const viewport = nativeOverlayViewport();
    const geometry = IINATAN_NATIVE_SUBTITLE_HIT_LAYER.validateGeometry(
      nativeLayout.osd,
      viewport,
    );
    if (geometry.ok && Array.isArray(nativeLayout.directRects)) {
      const copyOpacity = Math.max(
        0,
        Math.min(
          1,
          Number(state.config.experimentalNativeSubtitleTextOpacity) || 0,
        ),
      );
      const maskRendered =
        copyOpacity > 0 &&
        renderNativeAssAlphaMask(nativeLayout.alphaMask, geometry, copyOpacity);
      if (copyOpacity > 0 && !maskRendered)
        overlayDebug(
          "native subtitle copied-text mask is unavailable for this native ASS cue; character-box diagnostics remain available",
        );
      if (!maskRendered) {
        nativeSubtitleCopyEl.textContent = "";
        setImportantStyle(nativeSubtitleCopyEl, "display", "none");
        nativeSubtitleCopyEl.classList.add("hidden");
      }
      nativeSubtitleHitBoxesEl.textContent = "";
      state.charByPos = Object.create(null);
      const measured = [];
      nativeLayout.directRects.forEach((unit) => {
        if (!unit || !Number.isInteger(Number(unit.position))) return;
        (unit.rects || []).forEach((rect) => {
          const left = Number(rect.x) * geometry.scaleX;
          const top = Number(rect.y) * geometry.scaleY;
          const width = Number(rect.w) * geometry.scaleX;
          const height = Number(rect.h) * geometry.scaleY;
          if (
            ![left, top, width, height].every(Number.isFinite) ||
            width <= 0 ||
            height <= 0
          )
            return;
          measured.push({
            left,
            top,
            right: left + width,
            bottom: top + height,
            width,
            height,
            position: Number(unit.position),
          });
        });
      });
      const boxes = IINATAN_NATIVE_SUBTITLE_HIT_LAYER.resolveHitBoxOverlaps(
        measured,
        2,
      );
      boxes.forEach((box) => {
        if (
          box.left < -3 ||
          box.top < -3 ||
          box.left + box.width > viewport.width + 3 ||
          box.top + box.height > viewport.height + 3
        )
          return;
        const hit = document.createElement("div");
        hit.className =
          "native-subtitle-hit-box" +
          (state.config.experimentalNativeSubtitleHitBoxes ? " debug" : "");
        hit.setAttribute("data-clickable", "true");
        hit.dataset.pos = String(box.position);
        setImportantStyle(hit, "all", "initial");
        setImportantStyle(hit, "display", "block");
        setImportantStyle(hit, "position", "fixed");
        setImportantStyle(hit, "left", Math.max(0, box.left) + "px");
        setImportantStyle(hit, "top", Math.max(0, box.top) + "px");
        setImportantStyle(hit, "width", box.width + "px");
        setImportantStyle(hit, "height", box.height + "px");
        setImportantStyle(hit, "box-sizing", "border-box");
        setImportantStyle(hit, "pointer-events", "auto");
        setImportantStyle(hit, "margin", "0");
        setImportantStyle(hit, "padding", "0");
        setImportantStyle(hit, "z-index", "3");
        setImportantStyle(hit, "opacity", "1");
        setImportantStyle(hit, "visibility", "visible");
        setImportantStyle(hit, "contain", "strict");
        setImportantStyle(hit, "overflow", "visible");
        setImportantStyle(hit, "font-size", "0");
        setImportantStyle(
          hit,
          "border",
          state.config.experimentalNativeSubtitleHitBoxes
            ? "1px solid rgba(80, 190, 255, .9)"
            : "0 solid transparent",
        );
        setImportantStyle(
          hit,
          "background",
          state.config.experimentalNativeSubtitleHitBoxes
            ? "rgba(80, 190, 255, .14)"
            : "transparent",
        );
        hit.addEventListener("mouseenter", onCharEnter);
        hit.addEventListener("click", onCharEnter);
        hit.addEventListener("mouseleave", scheduleHidePopup);
        nativeSubtitleHitBoxesEl.appendChild(hit);
        if (!state.charByPos[box.position]) state.charByPos[box.position] = hit;
      });
      if (nativeSubtitleHitBoxesEl.children.length) {
        setImportantStyle(nativeSubtitleHitBoxesEl, "display", "block");
        nativeSubtitleHitBoxesEl.classList.remove("hidden");
        publishAcceptedNativeLayoutDiagnostic(
          null,
          geometry,
          viewport,
          nativeLayout,
        );
        publishNativeSubtitleDomPerformance(
          domUpdateStartedAt,
          "native-ass",
          nativeSubtitleHitBoxesEl.children.length,
        );
      } else {
        invalidateNativeSubtitleHitLayer("missing-unit-fill");
      }
      return;
    }
    const layout = IINATAN_NATIVE_SUBTITLE_HIT_LAYER.calculatePlainTextLayout(
      geometry,
      nativeLayout.options,
    );
    if (!geometry.ok || !layout.ok) {
      invalidateNativeSubtitleHitLayer(
        geometry.reason || layout.reason || "non-coextensive-overlay",
      );
      return;
    }
    refreshNativeSubtitleCopyForFont(nativeLayout.options);
    const balanceWrapSupported =
      IINATAN_NATIVE_SUBTITLE_HIT_LAYER.balancedTextWrapSupported(
        window.CSS,
        document.createElement("span").style,
      );
    overlayDebug(
      "native subtitle geometry scaleX=" +
        geometry.scaleX +
        " scaleY=" +
        geometry.scaleY +
        " dpr=" +
        Number(window.devicePixelRatio || 0) +
        " hidpiScale=" +
        Number(nativeLayout.hidpiScale || 0),
    );
    const generation = state.nativeHitGeneration;
    const cueLineId = state.lineId;
    const cueText = state.text;
    const cueDisplayText = state.nativeDisplayText;
    const cueLayout = state.nativeLayout;
    const cueCopyElement = nativeSubtitleCopyEl;
    const cueHitBoxesElement = nativeSubtitleHitBoxesEl;
    const isCurrentCueGeneration = () =>
      generation === state.nativeHitGeneration &&
      state.enabled &&
      state.config.experimentalNativeSubtitleHitLayer &&
      state.lineId === cueLineId &&
      state.text === cueText &&
      state.nativeDisplayText === cueDisplayText &&
      state.nativeLayout === cueLayout &&
      nativeSubtitleCopyEl === cueCopyElement &&
      nativeSubtitleHitBoxesEl === cueHitBoxesElement;
    nativeSubtitleCopyEl.textContent = displayText;
    applyNativeLayout(layout, balanceWrapSupported);
    setImportantStyle(nativeSubtitleCopyEl, "opacity", "0");
    nativeSubtitleCopyEl.classList.remove("hidden");
    const measure = () => {
      if (!isCurrentCueGeneration()) return;
      const liveContextReason = nativeGeometryContextReason();
      if (liveContextReason) {
        destroyNativeSubtitleDom();
        invalidateNativeSubtitleHitLayer(liveContextReason);
        return;
      }
      const nextViewport = nativeOverlayViewport();
      if (
        nextViewport.width !== viewport.width ||
        nextViewport.height !== viewport.height
      ) {
        invalidateNativeSubtitleHitLayer("stale-layout");
        return;
      }
      if (
        !balanceWrapSupported &&
        nativeCopyRequiresAutomaticWrap(displayText)
      ) {
        invalidateNativeSubtitleHitLayer("unsupported-writing-mode");
        return;
      }
      setImportantStyle(
        nativeSubtitleCopyEl,
        "opacity",
        Math.max(
          0,
          Math.min(
            1,
            Number(state.config.experimentalNativeSubtitleTextOpacity) || 0,
          ),
        ),
      );
      publishAcceptedNativeLayoutDiagnostic(
        layout,
        geometry,
        viewport,
        nativeLayout,
      );
      nativeSubtitleHitBoxesEl.textContent = "";
      state.charByPos = Object.create(null);
      const measured = [];
      for (let pos = 0; pos < state.chars.length; pos++) {
        if (!isLookupableChar(state.chars[pos])) continue;
        const unit = lookupUnitForPosition(pos);
        if (unit.pos !== pos) continue;
        const rects = nativeRangeRects(
          state.nativeLookupSpans,
          unit.preview.start,
          unit.preview.end,
        );
        rects.forEach((rect) => {
          if (!rect || rect.width <= 0 || rect.height <= 0) return;
          measured.push({
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            position: pos,
          });
        });
      }
      const boxes = IINATAN_NATIVE_SUBTITLE_HIT_LAYER.resolveHitBoxOverlaps(
        measured,
        2,
      );
      boxes.forEach((box) => {
        if (
          box.left < -3 ||
          box.top < -3 ||
          box.left + box.width > viewport.width + 3 ||
          box.top + box.height > viewport.height + 3
        )
          return;
        const hit = document.createElement("div");
        hit.className =
          "native-subtitle-hit-box" +
          (state.config.experimentalNativeSubtitleHitBoxes ? " debug" : "");
        hit.setAttribute("data-clickable", "true");
        hit.dataset.pos = String(box.position);
        setImportantStyle(hit, "all", "initial");
        setImportantStyle(hit, "display", "block");
        setImportantStyle(hit, "position", "fixed");
        setImportantStyle(hit, "left", Math.max(0, box.left) + "px");
        setImportantStyle(hit, "top", Math.max(0, box.top) + "px");
        setImportantStyle(hit, "width", box.width + "px");
        setImportantStyle(hit, "height", box.height + "px");
        setImportantStyle(hit, "min-width", "0");
        setImportantStyle(hit, "max-width", "none");
        setImportantStyle(hit, "min-height", "0");
        setImportantStyle(hit, "max-height", "none");
        setImportantStyle(hit, "box-sizing", "border-box");
        setImportantStyle(hit, "pointer-events", "auto");
        setImportantStyle(hit, "margin", "0");
        setImportantStyle(hit, "padding", "0");
        setImportantStyle(hit, "z-index", "3");
        setImportantStyle(hit, "transform", "none");
        setImportantStyle(hit, "translate", "none");
        setImportantStyle(hit, "rotate", "none");
        setImportantStyle(hit, "scale", "none");
        setImportantStyle(hit, "transform-origin", "0 0");
        setImportantStyle(hit, "perspective", "none");
        setImportantStyle(hit, "filter", "none");
        setImportantStyle(hit, "backdrop-filter", "none");
        setImportantStyle(hit, "zoom", "1");
        setImportantStyle(hit, "opacity", "1");
        setImportantStyle(hit, "visibility", "visible");
        setImportantStyle(hit, "clip", "auto");
        setImportantStyle(hit, "clip-path", "none");
        setImportantStyle(hit, "contain", "strict");
        setImportantStyle(hit, "isolation", "isolate");
        setImportantStyle(hit, "mix-blend-mode", "normal");
        setImportantStyle(hit, "writing-mode", "horizontal-tb");
        setImportantStyle(hit, "direction", "ltr");
        setImportantStyle(hit, "overflow", "visible");
        setImportantStyle(hit, "outline", "none");
        setImportantStyle(hit, "box-shadow", "none");
        setImportantStyle(hit, "border-radius", "0");
        setImportantStyle(hit, "font-size", "0");
        setImportantStyle(
          hit,
          "border",
          state.config.experimentalNativeSubtitleHitBoxes
            ? "1px solid rgba(80, 190, 255, .9)"
            : "0 solid transparent",
        );
        setImportantStyle(
          hit,
          "background",
          state.config.experimentalNativeSubtitleHitBoxes
            ? "rgba(80, 190, 255, .14)"
            : "transparent",
        );
        hit.addEventListener("mouseenter", onCharEnter);
        hit.addEventListener("click", onCharEnter);
        hit.addEventListener("mouseleave", scheduleHidePopup);
        nativeSubtitleHitBoxesEl.appendChild(hit);
        if (!state.charByPos[box.position]) state.charByPos[box.position] = hit;
      });
      if (
        isCurrentCueGeneration() &&
        nativeSubtitleHitBoxesEl.children.length
      ) {
        setImportantStyle(nativeSubtitleHitBoxesEl, "display", "block");
        nativeSubtitleHitBoxesEl.classList.remove("hidden");
        publishNativeSubtitleDomPerformance(
          domUpdateStartedAt,
          "plain-subtitle",
          nativeSubtitleHitBoxesEl.children.length,
        );
      }
    };
    const afterFonts = () => {
      if (!isCurrentCueGeneration()) return;
      measure();
    };
    const fontSet = document.fonts;
    if (
      fontSet &&
      fontSet.ready &&
      typeof fontSet.load === "function" &&
      typeof fontSet.check === "function"
    ) {
      Promise.resolve(fontSet.ready)
        .then(() => {
          if (!isCurrentCueGeneration()) return null;
          return nativeSubtitleFontFamilyForMeasurement(
            layout.fontFamily,
            isCurrentCueGeneration,
            nativeLayout.options,
          );
        })
        .then((fontResolution) => {
          if (!fontResolution || !isCurrentCueGeneration()) return null;
          const fontSpec =
            String(Math.max(1, layout.fontSize)) +
            "px " +
            String(fontResolution.cssFamily || "sans-serif");
          return Promise.resolve(fontSet.load(fontSpec, displayText)).then(
            () => ({ fontResolution, fontSpec }),
          );
        })
        .then((fontLoad) => {
          if (!fontLoad || !isCurrentCueGeneration()) return;
          const fontSetAccepted = fontSet.check(fontLoad.fontSpec, displayText);
          const cueIsCurrent = isCurrentCueGeneration();
          const fontFamilyAvailable =
            fontLoad.fontResolution.localFontVerified ||
            nativeFontFamilyAvailable(layout.fontFamily, displayText);
          if (!cueIsCurrent) return;
          if (!fontSetAccepted || !fontFamilyAvailable) {
            if (isCurrentCueGeneration()) {
              releaseNativeSubtitleLocalFont();
              invalidateNativeSubtitleHitLayer("font-unavailable");
            }
            return;
          }
          afterFonts();
        })
        .catch(() => {
          if (isCurrentCueGeneration()) {
            releaseNativeSubtitleLocalFont();
            invalidateNativeSubtitleHitLayer("font-unavailable");
          }
        });
    } else {
      if (isCurrentCueGeneration())
        invalidateNativeSubtitleHitLayer("font-unavailable");
    }
  }

  function renderSubtitle(
    text,
    lineId,
    displayText,
    nativeReason,
    nativeLookupSpans,
    nativeLayout,
    nativeSurfaces,
    bitmapOcrStatus,
  ) {
    const nextLineId = Number(lineId || 0);
    const lineChanged = nextLineId !== state.lineId;
    state.text = state.config.flattenSubtitleLineBreaks
      ? flattenSubtitleText(text)
      : String(text || "");
    state.lineId = nextLineId;
    if (overlayDebugEnabled())
      overlayDebug(
        "renderSubtitle lineId=" +
          state.lineId +
          " chars=" +
          Array.from(state.text || "").length +
          " text=" +
          JSON.stringify(String(state.text || "").slice(0, 80)),
      );
    state.chars = Array.from(state.text);
    state.nativeSurfaces = Array.isArray(nativeSurfaces)
      ? nativeSurfaces.slice()
      : [];
    if (lineChanged && state.lookupPopupVisible) hidePopup();
    renderBitmapOcrStatus(bitmapOcrStatus);
    Object.keys(state.pendingLookupTimers || {}).forEach((k) =>
      clearTimeout(state.pendingLookupTimers[k]),
    );
    Object.keys(state.pendingLookupRequests || {}).forEach((k) =>
      cancelPendingLookupRequest(k),
    );
    cancelPendingAudioSourceRequests();
    state.pendingLookupTimers = Object.create(null);
    state.pendingLookupRequests = Object.create(null);
    state.charByPos = Object.create(null);
    state.lookupByPos = Object.create(null);
    state.audioAutoPlayed = Object.create(null);
    state.progress = null;
    state.currentPos = null;
    state.activeMatchStart = null;
    state.activeMatchLength = 0;
    clearNestedPopups(0);
    const experimentalMode =
      state.enabled && state.config.experimentalNativeSubtitleHitLayer;
    if (experimentalMode) {
      invalidateNativeSubtitleHitLayer("");
    } else {
      destroyNativeSubtitleDom();
    }
    subtitleEl.textContent = "";
    if (!state.enabled || !state.text) {
      subtitleEl.classList.add("hidden");
      hidePopup();
      return;
    }
    if (experimentalMode) {
      subtitleEl.classList.add("hidden");
      if (state.nativeSurfaces.length)
        renderNativeSubtitleSurfaces(state.nativeSurfaces);
      else
        renderNativeSubtitleHitLayer(
          String(displayText || ""),
          String(nativeReason || ""),
          nativeLookupSpans,
          nativeLayout,
        );
      return;
    }
    subtitleEl.classList.remove("hidden");
    const frag = document.createDocumentFragment();
    for (let i = 0; i < state.chars.length; i++) {
      const ch = state.chars[i];
      if (ch === "\n") {
        frag.appendChild(document.createElement("br"));
        continue;
      }
      if (/\s/.test(ch)) {
        frag.appendChild(document.createTextNode(" "));
        continue;
      }
      const span = document.createElement("span");
      const lookupable = isLookupableChar(ch);
      span.className = "char " + (lookupable ? "lookupable" : "nonlookup");
      span.textContent = ch;
      if (lookupable) {
        span.setAttribute("data-clickable", "true");
        span.dataset.pos = String(i);
        state.charByPos[i] = span;
        span.addEventListener("mouseenter", onCharEnter);
        span.addEventListener("click", onCharEnter);
        span.addEventListener("mouseleave", scheduleHidePopup);
      }
      frag.appendChild(span);
    }
    subtitleEl.appendChild(frag);
  }

  function removeMatchBackgrounds() {
    subtitleEl.querySelectorAll(".match-bg").forEach((el) => el.remove());
  }

  function clearActiveMatch() {
    subtitleEl.querySelectorAll(".char.active-match").forEach((el) => {
      el.classList.remove("active-match");
    });
    if (nativeSubtitleHitBoxesEl) {
      Array.from(nativeSubtitleHitBoxesEl.children || []).forEach((el) => {
        el.classList.remove("active-match");
      });
    }
    if (nativeSubtitleMatchHighlightsEl)
      nativeSubtitleMatchHighlightsEl.textContent = "";
    removeMatchBackgrounds();
    state.activeMatchStart = null;
    state.activeMatchLength = 0;
  }

  function charsCount(s) {
    return Array.from(String(s || "")).length;
  }

  function topMatchedText(stored) {
    const result = stored && stored.result ? stored.result : {};
    const entries = Array.isArray(result.results) ? result.results : [];
    const first = entries[0] || {};
    return String(first.matched || (first.term && first.term.expression) || "");
  }

  function lookupMatchLength(stored) {
    const matched = topMatchedText(stored);
    return Math.max(1, charsCount(matched || ""));
  }

  function resultMatchStart(stored, fallback) {
    const result = stored && stored.result ? stored.result : {};
    const n = Number(result.matchStart);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
  }

  function isWordLookupMode(lang) {
    return (
      !!lang &&
      (lang.lookupUnit === "word" ||
        lang.wordMode === "latin-word" ||
        lang.wordMode === "korean-run")
    );
  }

  function lookupSurfaceRange(stored, preview) {
    if (!isWordLookupMode(activeLanguage())) return null;
    const result = stored && stored.result ? stored.result : {};
    const start = Number(result.lookupStart);
    const end = Number(result.lookupEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      const boundedStart = Math.max(0, start);
      const boundedEnd = Math.min(state.chars.length, end);
      const text = state.chars
        .slice(boundedStart, Math.max(boundedStart + 1, boundedEnd))
        .join("");
      if (text) return { start: boundedStart, text };
    }
    if (
      preview &&
      Number.isFinite(Number(preview.start)) &&
      Number.isFinite(Number(preview.end)) &&
      Number(preview.end) > Number(preview.start)
    ) {
      return {
        start: Math.max(0, Number(preview.start)),
        text: String(preview.text || ""),
      };
    }
    return null;
  }

  function activateStoredMatch(stored, preview) {
    const surfaceRange = lookupSurfaceRange(stored, preview);
    if (surfaceRange && surfaceRange.text) {
      activateMatchRange(surfaceRange.start, surfaceRange.text);
      return;
    }
    const fallbackStart =
      preview && Number.isFinite(Number(preview.start))
        ? Number(preview.start)
        : state.currentPos || 0;
    const start = resultMatchStart(stored, fallbackStart);
    const matched = topMatchedText(stored) || (preview && preview.text) || "";
    activateMatchRange(start, matched);
  }
  function activateNoResultMatch(stored) {
    const result = stored && stored.result ? stored.result : {};
    const fallback = lookupPreviewForPosition(state.currentPos || 0);
    const start = Number.isFinite(Number(result.lookupStart))
      ? Number(result.lookupStart)
      : fallback.start;
    const end = Number.isFinite(Number(result.lookupEnd))
      ? Number(result.lookupEnd)
      : fallback.end;
    const text =
      state.chars.slice(start, Math.max(start + 1, end)).join("") ||
      fallback.text ||
      "";
    activateMatchRange(start, text);
  }

  // Deliberately do not reuse cached lookup results across later character
  // positions. HoshiDicts/Yomitan lookup is rightward-prefix based, but the
  // returned "matched" surface may include enough context that broad range
  // reuse can show an earlier word when hovering a later word.
  function groupMatchRects(rects) {
    const groups = [];
    rects.forEach((rect) => {
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      let group = groups.find(
        (item) =>
          Math.abs(item.top - rect.top) < Math.max(3, rect.height * 0.35),
      );
      if (!group) {
        group = {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        };
        groups.push(group);
      } else {
        group.top = Math.min(group.top, rect.top);
        group.bottom = Math.max(group.bottom, rect.bottom);
        group.left = Math.min(group.left, rect.left);
        group.right = Math.max(group.right, rect.right);
      }
    });
    return groups;
  }

  function addMatchBackgroundForRects(rects) {
    if (
      state.config.experimentalNativeSubtitleHitLayer &&
      nativeSubtitleMatchHighlightsEl
    ) {
      addNativeMatchBackgroundForRects(rects);
      return;
    }
    const subRect = subtitleEl.getBoundingClientRect();
    groupMatchRects(rects).forEach((g) => {
      const bg = document.createElement("span");
      bg.className = "match-bg";
      bg.style.left = g.left - subRect.left - 5 + "px";
      bg.style.top = g.top - subRect.top - 3 + "px";
      bg.style.width = Math.max(1, g.right - g.left + 10) + "px";
      bg.style.height = Math.max(1, g.bottom - g.top + 6) + "px";
      subtitleEl.insertBefore(bg, subtitleEl.firstChild);
    });
  }

  function addNativeMatchBackgroundForRects(rects) {
    if (
      !state.config.experimentalNativeSubtitleLookupHighlight ||
      !nativeSubtitleMatchHighlightsEl
    )
      return;
    groupMatchRects(rects).forEach((group) => {
      const bg = document.createElement("div");
      bg.className = "native-match-bg";
      setImportantStyle(bg, "all", "initial");
      setImportantStyle(bg, "display", "block");
      setImportantStyle(bg, "position", "fixed");
      setImportantStyle(bg, "left", group.left - 5 + "px");
      setImportantStyle(bg, "top", group.top - 3 + "px");
      setImportantStyle(
        bg,
        "width",
        Math.max(1, group.right - group.left + 10) + "px",
      );
      setImportantStyle(
        bg,
        "height",
        Math.max(1, group.bottom - group.top + 6) + "px",
      );
      setImportantStyle(bg, "box-sizing", "border-box");
      setImportantStyle(bg, "pointer-events", "none");
      setImportantStyle(bg, "background", "rgba(255,255,255,0.22)");
      setImportantStyle(bg, "border", "1px solid rgba(255,255,255,0.36)");
      setImportantStyle(bg, "border-radius", "4px");
      setImportantStyle(
        bg,
        "box-shadow",
        "0 0 0 1px rgba(255,255,255,0.14) inset",
      );
      nativeSubtitleMatchHighlightsEl.appendChild(bg);
    });
  }

  function activeMatchElements(start, len) {
    if (
      state.config.experimentalNativeSubtitleHitLayer &&
      nativeSubtitleHitBoxesEl
    ) {
      const end = start + len;
      return Array.from(nativeSubtitleHitBoxesEl.children || []).filter(
        (el) => {
          const pos = Number(el.dataset && el.dataset.pos);
          return Number.isFinite(pos) && pos >= start && pos < end;
        },
      );
    }
    const elements = [];
    for (let i = 0; i < len; i++) {
      const el = charElementAt(start + i);
      if (el) elements.push(el);
    }
    return elements;
  }

  function activateMatchRange(start, matchedText) {
    clearActiveMatch();
    const len = Math.max(1, charsCount(matchedText));
    state.activeMatchStart = start;
    state.activeMatchLength = len;
    const rects = [];
    activeMatchElements(start, len).forEach((el) => {
      el.classList.add("active-match");
      const r = el.getBoundingClientRect();
      rects.push(r);
    });
    addMatchBackgroundForRects(rects);
  }

  function onCharEnter(ev) {
    cancelHidePopupTimer();
    const target = ev.currentTarget;
    const rawPos = Number(target.dataset.pos || 0);
    const unit = lookupUnitForPosition(rawPos);
    const pos = unit.pos;
    const preview = unit.preview;
    const anchor = lookupAnchorForUnit(unit, target);
    const sameUnitVisible =
      state.currentPos === pos && !popupEl.classList.contains("hidden");
    overlayDebug(
      "char enter rawPos=" +
        rawPos +
        " unitPos=" +
        pos +
        " unitKey=" +
        unit.key +
        " word=" +
        String(unit.isWord) +
        " char=" +
        JSON.stringify(target.textContent || "") +
        " cached=" +
        String(!!state.lookupByPos[pos]),
    );
    state.currentPos = pos;
    const stored = state.lookupByPos[pos];
    if (sameUnitVisible) {
      if (stored) renderStoredLookup(stored);
      else
        activateMatchRange(
          preview.start,
          preview.text || anchor.textContent || "",
        );
      return;
    }
    if (stored) {
      activateStoredMatch(stored, preview);
      showPopup(anchor, preview.text, '<div class="loading">Rendering…</div>');
      renderStoredLookup(stored);
      return;
    }
    activateMatchRange(preview.start, preview.text || anchor.textContent || "");
    requestLookupFromPlugin(pos);
    showPopup(
      anchor,
      preview.text,
      '<div class="loading">' + escapeHtml("Looking up…") + "</div>",
    );
  }

  function scheduleHidePopup() {
    if (window.__IINATAN_POPUP_PREVIEW__) return;
    if (state.hideTimer) clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => hidePopup(), 240);
  }
  function closestExternalLink(target) {
    let el = target;
    const popup = popupContainerForNode(target);
    while (el && el !== popup) {
      if (el.getAttribute && el.getAttribute("data-external-url")) return el;
      el = el.parentNode;
    }
    return null;
  }
  function onPopupClick(ev) {
    const link = closestExternalLink(ev.target);
    if (!link) return;
    const url = safeExternalUrl(
      link.getAttribute("data-external-url") || link.getAttribute("href") || "",
    );
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function")
      ev.stopImmediatePropagation();
    if (!url) {
      overlayDebug("source link click rejected");
      return;
    }
    const sent = sendBridgeMessage({ type: "open-url", url, at: Date.now() });
    try {
      iina.postMessage("open-external-url", { url });
    } catch (_) {}
    overlayDebug(
      "source link click url=" +
        JSON.stringify(url.slice(0, 180)) +
        " bridgeSent=" +
        String(sent),
    );
  }
  popupSafetyZoneEl.addEventListener("mouseenter", cancelHidePopupTimer);
  popupSafetyZoneEl.addEventListener("mouseleave", scheduleHidePopup);
  popupRowSafetyZoneEl.addEventListener("mouseenter", cancelHidePopupTimer);
  popupRowSafetyZoneEl.addEventListener("mouseleave", scheduleHidePopup);
  function trapPopupWheel(ev, explicitPopup) {
    const popup =
      explicitPopup ||
      popupContainerForNode(ev && ev.currentTarget) ||
      popupContainerForNode(ev && ev.target);
    if (!popup || popup.classList.contains("hidden")) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === "function")
      ev.stopImmediatePropagation();
    const dx = Number(ev.deltaX || 0);
    const dy = Number(ev.deltaY || 0);
    // Manually scroll so the gesture is consumed by the overlay instead of being
    // interpreted by IINA as seek/fast-forward.
    if (Math.abs(dy) >= Math.abs(dx)) popup.scrollTop += dy;
    else popup.scrollLeft += dx;
  }
  bindPopupContainerEvents(popupEl);
  document.addEventListener(
    "wheel",
    (ev) => {
      const path = ev.composedPath ? ev.composedPath() : [];
      const popup = path.find(
        (node) =>
          node === popupEl ||
          (node && node.classList && node.classList.contains("nested-popup")),
      );
      if (popup && !popup.classList.contains("hidden"))
        trapPopupWheel(ev, popup);
    },
    { passive: false, capture: true },
  );
  function decodeBridgeUtf8(bytes) {
    const view =
      bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(
            bytes.buffer || bytes,
            bytes.byteOffset || 0,
            bytes.byteLength,
          );
    if (typeof TextDecoder === "function")
      return new TextDecoder("utf-8").decode(view);
    let binary = "";
    for (let index = 0; index < view.length; index++)
      binary += String.fromCharCode(view[index]);
    try {
      return decodeURIComponent(escape(binary));
    } catch (_) {
      return binary;
    }
  }
  function bridgeMessageText(data) {
    if (typeof data === "string") return Promise.resolve(data);
    if (typeof ArrayBuffer === "function" && data instanceof ArrayBuffer)
      return Promise.resolve(decodeBridgeUtf8(new Uint8Array(data)));
    if (
      typeof ArrayBuffer === "function" &&
      ArrayBuffer.isView &&
      ArrayBuffer.isView(data)
    )
      return Promise.resolve(decodeBridgeUtf8(data));
    if (data && typeof data.text === "function")
      return Promise.resolve(data.text());
    if (typeof Blob === "function" && data instanceof Blob)
      return new Promise((resolve, reject) => {
        try {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () =>
            reject(reader.error || new Error("read failed"));
          reader.readAsText(data);
        } catch (error) {
          reject(error);
        }
      });
    return Promise.reject(new Error("Unsupported bridge message payload"));
  }
  function handleBridgeSocketMessage(event) {
    const data = event && event.data !== undefined ? event.data : event;
    bridgeMessageText(data)
      .then((text) => {
        let payload = null;
        try {
          payload = JSON.parse(String(text || ""));
        } catch (_) {
          return;
        }
        if (!payload || typeof payload !== "object") return;
        if (payload.type === "anki-card-state") updateAnkiCardState(payload);
      })
      .catch((error) => {
        overlayDebug("bridge message decode failed: " + String(error || ""));
      });
  }
  function ensureBridgeSocket() {
    if (!state.bridgePort) return;
    if (
      state.bridgeSocket &&
      (state.bridgeSocket.readyState === WebSocket.OPEN ||
        state.bridgeSocket.readyState === WebSocket.CONNECTING)
    )
      return;
    try {
      const socket = new WebSocket(
        "ws://127.0.0.1:" + String(state.bridgePort) + "/overlay",
      );
      try {
        socket.binaryType = "arraybuffer";
      } catch (_) {}
      state.bridgeSocket = socket;
      socket.onopen = () => {
        overlayDebug("bridge socket open");
        try {
          socket.send(JSON.stringify({ type: "hello", source: "overlay" }));
        } catch (_) {}
        if (state.lookupPopupVisible) {
          if (
            state.currentPos !== null &&
            state.currentPos !== undefined &&
            !state.lookupByPos[state.currentPos] &&
            !state.pendingLookupRequests[state.currentPos]
          ) {
            requestLookupFromPlugin(state.currentPos);
          }
          flushPendingLookupRequests();
          sendBridgePopupVisibility(true);
        }
      };
      socket.onmessage = handleBridgeSocketMessage;
      socket.onclose = () => {
        try {
          console.log("[iinatan overlay] bridge socket close");
        } catch (_) {}
        if (state.bridgeSocket !== socket) return;
        state.bridgeSocket = null;
        if (state.bridgeReconnectTimer)
          clearTimeout(state.bridgeReconnectTimer);
        state.bridgeReconnectTimer = setTimeout(() => {
          state.bridgeReconnectTimer = null;
          ensureBridgeSocket();
        }, 700);
      };
      socket.onerror = () => {
        try {
          console.log("[iinatan overlay] bridge socket error");
        } catch (_) {}
        try {
          socket.close();
        } catch (_) {}
      };
    } catch (_) {}
  }

  function sendBridgeMessage(payload) {
    ensureBridgeSocket();
    const socket = state.bridgeSocket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify(payload));
        return true;
      } catch (error) {
        try {
          console.log("[iinatan overlay] bridge send failed " + String(error));
        } catch (_) {}
      }
    }
    return false;
  }
  function sendBridgeMessageWhenReady(payload, timeoutMs, onFailure, onSent) {
    const startedAt = Date.now();
    const timeout = Math.max(250, Number(timeoutMs || 2500) || 2500);
    const attempt = () => {
      if (sendBridgeMessage(payload)) {
        if (typeof onSent === "function") onSent();
        return;
      }
      if (Date.now() - startedAt >= timeout) {
        if (typeof onFailure === "function") onFailure();
        return;
      }
      setTimeout(attempt, 60);
    };
    attempt();
    return true;
  }
  function postPluginMessage(payload) {
    if (!payload || !payload.type) return false;
    try {
      iina.postMessage(String(payload.type), payload);
      return true;
    } catch (error) {
      try {
        console.log(
          "[iinatan overlay] plugin postMessage failed " + String(error),
        );
      } catch (_) {}
      return false;
    }
  }

  function sendBridgePopupVisibility(visible) {
    return sendBridgeMessage({
      type: "popup",
      visible: !!visible,
      seq: state.popupVisibilitySeq,
      popupSessionId: state.popupSessionId,
      at: Date.now(),
    });
  }

  function cancelPendingLookupRequest(pos) {
    const req = state.pendingLookupRequests && state.pendingLookupRequests[pos];
    if (!req) return;
    if (req.retryTimer) clearInterval(req.retryTimer);
    if (req.timeoutTimer) clearTimeout(req.timeoutTimer);
    delete state.pendingLookupRequests[pos];
  }

  function cancelPendingLookupRequestsExcept(keepPos) {
    Object.keys(state.pendingLookupRequests || {}).forEach((k) => {
      if (String(k) !== String(keepPos)) cancelPendingLookupRequest(k);
    });
    Object.keys(state.pendingLookupTimers || {}).forEach((k) => {
      if (String(k) !== String(keepPos)) {
        clearTimeout(state.pendingLookupTimers[k]);
        delete state.pendingLookupTimers[k];
      }
    });
  }

  function sendLookupRequestPayload(req) {
    const payload = {
      type: "lookup",
      requestId: req.requestId,
      lineId: req.lineId,
      position: req.pos,
      at: Date.now(),
      attempt: req.attempts,
    };
    if (sendBridgeMessage(payload)) return true;
    if (req.attempts < 6) return false;
    payload.type = "line-lookup";
    return postPluginMessage(payload);
  }

  function lookupRequestIsCurrent(req) {
    if (!req) return false;
    const pos = req.pos;
    return (
      !!state.pendingLookupRequests[pos] &&
      state.pendingLookupRequests[pos] === req &&
      !req.sent &&
      !state.lookupByPos[pos] &&
      state.currentPos === pos &&
      state.lineId === req.lineId
    );
  }

  function trySendLookupRequest(req) {
    if (!lookupRequestIsCurrent(req)) {
      if (req && !req.sent) cancelPendingLookupRequest(req.pos);
      return false;
    }
    req.attempts++;
    overlayDebug(
      "lookup send attempt requestId=" +
        req.requestId +
        " pos=" +
        req.pos +
        " attempt=" +
        req.attempts,
    );
    req.sent = sendLookupRequestPayload(req);
    if (req.sent && req.retryTimer) {
      clearInterval(req.retryTimer);
      req.retryTimer = null;
    }
    return req.sent;
  }

  function flushPendingLookupRequests() {
    Object.keys(state.pendingLookupRequests || {}).forEach((key) => {
      const req = state.pendingLookupRequests[key];
      if (req && !req.sent) trySendLookupRequest(req);
    });
  }

  function requestLookupFromPlugin(pos) {
    overlayDebug(
      "requestLookupFromPlugin pos=" +
        String(pos) +
        " lineId=" +
        state.lineId +
        " hasCached=" +
        String(!!state.lookupByPos[pos]),
    );
    cancelPendingLookupRequestsExcept(pos);
    if (state.lookupByPos[pos]) return;

    const existing = state.pendingLookupRequests[pos];
    if (existing && existing.lineId === state.lineId) return;

    const requestId = String(++state.lookupRequestSeq);
    const req = {
      requestId,
      lineId: state.lineId,
      pos,
      sent: false,
      attempts: 0,
      retryTimer: null,
      timeoutTimer: null,
    };
    state.pendingLookupRequests[pos] = req;

    trySendLookupRequest(req);
    if (!req.sent) {
      req.retryTimer = setInterval(() => {
        trySendLookupRequest(req);
        if (req.sent || req.attempts >= 6) {
          if (req.retryTimer) clearInterval(req.retryTimer);
          req.retryTimer = null;
        }
      }, LOOKUP_RETRY_INTERVAL_MS);
    }

    req.timeoutTimer = setTimeout(
      () => {
        cancelPendingLookupRequest(pos);
        if (
          !state.lookupByPos[pos] &&
          state.currentPos === pos &&
          state.lineId === req.lineId &&
          !popupEl.classList.contains("hidden")
        ) {
          setPopupBody(
            '<div class="error">Lookup timed out. Move off the word and hover again to retry.</div>',
          );
        }
      },
      Math.max(5000, Number(state.config.hoverRequestTimeoutMs || 9000)),
    );
  }

  function postLookupPopupVisibility(visible) {
    const bridgeSent = sendBridgePopupVisibility(visible);
    if (!bridgeSent) {
      try {
        iina.postMessage("lookup-popup-visibility", visible ? "show" : "hide");
      } catch (_) {}
      try {
        iina.postMessage("lookup-popup-visible", {
          visible: !!visible,
          seq: state.popupVisibilitySeq,
          popupSessionId: state.popupSessionId,
          at: Date.now(),
        });
      } catch (_) {}
    }
  }
  function setLookupPopupVisibility(visible) {
    visible = !!visible;
    overlayDebug(
      "popup visibility set visible=" +
        String(visible) +
        " current=" +
        String(state.lookupPopupVisible) +
        " pos=" +
        String(state.currentPos),
    );
    if (state.lookupPopupVisible === visible) return;
    state.lookupPopupVisible = visible;
    state.popupVisibilitySeq++;
    postLookupPopupVisibility(visible);
    if (state.lookupPopupNotifyTimer) {
      clearInterval(state.lookupPopupNotifyTimer);
      state.lookupPopupNotifyTimer = null;
    }
    // Send only transition events. The plugin side resumes from the explicit
    // hide transition and uses sequence/session guards to reject stale packets.
  }

  function hidePopup() {
    hideAudioSourceMenu();
    clearNestedPopups(0);
    setLookupPopupVisibility(false);
    popupEl.classList.add("hidden");
    popupSafetyZoneEl.classList.add("hidden");
    popupRowSafetyZoneEl.classList.add("hidden");
    state.currentPos = null;
    state.currentAnchor = null;
    Object.keys(state.pendingLookupTimers || {}).forEach((k) =>
      clearTimeout(state.pendingLookupTimers[k]),
    );
    Object.keys(state.pendingLookupRequests || {}).forEach((k) =>
      cancelPendingLookupRequest(k),
    );
    state.pendingLookupTimers = Object.create(null);
    state.pendingLookupRequests = Object.create(null);
    state.ankiCardContexts = Object.create(null);
    clearActiveMatch();
  }

  function renderAudioButtonHtml(term, reading) {
    const audioTerm = String(term || "").trim();
    if (!audioTerm || !activeAudioSources().length) return "";
    const audioReading = String(reading || "").trim();
    const key = audioTermReadingKey(audioTerm, audioReading);
    return (
      '<button type="button" class="audio-button" data-clickable="true" data-audio-key="' +
      escapeHtml(key) +
      '" data-audio-term="' +
      escapeHtml(audioTerm) +
      '" data-audio-reading="' +
      escapeHtml(audioReading) +
      '" title="Play audio" aria-label="Play audio"><svg class="audio-icon" data-clickable="true" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path data-clickable="true" class="audio-speaker-body" d="M3 9v6h4l5 4V5L7 9H3z"></path><path data-clickable="true" class="audio-wave" d="M16 8.5a5 5 0 0 1 0 7"></path><path data-clickable="true" class="audio-wave" d="M19 5a9 9 0 0 1 0 14"></path></svg></button>'
    );
  }
  function ankiIconSvg(kind) {
    if (kind === "book")
      return '<svg class="anki-icon" data-clickable="true" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path data-clickable="true" d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H7a3 3 0 0 0-3 3V5.5z"></path><path data-clickable="true" d="M7 18h13"></path><path data-clickable="true" d="M7 6h9"></path></svg>';
    if (kind === "check")
      return '<svg class="anki-icon" data-clickable="true" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path data-clickable="true" d="M5 12.5l4.2 4.2L19 7"></path></svg>';
    if (kind === "error")
      return '<svg class="anki-icon" data-clickable="true" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path data-clickable="true" d="M12 5v8"></path><path data-clickable="true" d="M12 18h.01"></path><path data-clickable="true" d="M4.5 20h15L12 4 4.5 20z"></path></svg>';
    return '<svg class="anki-icon" data-clickable="true" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path data-clickable="true" d="M12 5v14"></path><path data-clickable="true" d="M5 12h14"></path></svg>';
  }
  function renderAnkiButtonHtml(contextId) {
    if (!contextId || !ankiButtonVisibleForPopup()) return "";
    const config = activeAnkiConfig();
    const stateName = config.configured ? "ready" : "disabled";
    const title = config.configured
      ? "Add Anki card"
      : "Configure Anki export in settings";
    const icon = config.configured ? ankiIconSvg("plus") : ankiIconSvg("error");
    const action = config.configured ? "add" : "disabled";
    return (
      '<span class="anki-action-group" data-clickable="true" data-anki-context-id="' +
      escapeHtml(contextId) +
      '" data-anki-state="' +
      stateName +
      '" data-anki-note-ids="[]"><button type="button" class="anki-button anki-add-anyway-button" data-clickable="true" data-anki-role="force-add" data-anki-state="ready" data-anki-action="add" title="Add another Anki card despite the duplicate" aria-label="Add another Anki card despite the duplicate" hidden disabled>' +
      ankiIconSvg("plus") +
      '</button><button type="button" class="anki-button anki-primary-button" data-clickable="true" data-anki-role="primary" data-anki-state="' +
      stateName +
      '" data-anki-action="' +
      action +
      '" title="' +
      escapeHtml(title) +
      '" aria-label="' +
      escapeHtml(title) +
      '">' +
      icon +
      "</button></span>"
    );
  }
  function markElementClickable(element) {
    if (!element || typeof element.setAttribute !== "function") return;
    element.setAttribute("data-clickable", "true");
    try {
      element
        .querySelectorAll("*")
        .forEach((el) => el.setAttribute("data-clickable", "true"));
    } catch (_) {}
  }
  function ankiActionGroupForControl(control) {
    let current = control;
    while (current) {
      if (current.classList && current.classList.contains("anki-action-group"))
        return current;
      current = current.parentNode || null;
    }
    return control && control.dataset ? control : null;
  }
  function ankiPrimaryButtonForGroup(group) {
    if (!group) return null;
    if (group.classList && group.classList.contains("anki-button"))
      return group;
    return group.querySelector(".anki-primary-button");
  }
  function ankiForceAddButtonForGroup(group) {
    if (!group || (group.classList && group.classList.contains("anki-button")))
      return null;
    return group.querySelector(".anki-add-anyway-button");
  }
  function setNoteIdsForAnkiButton(control, noteIds) {
    const group = ankiActionGroupForControl(control);
    if (!group || !group.dataset) return;
    group.dataset.ankiNoteIds = JSON.stringify(
      Array.isArray(noteIds) ? noteIds : [],
    );
  }
  function setAnkiControlDisabled(control, disabled) {
    if (!control) return;
    control.disabled = !!disabled;
    if (disabled) control.setAttribute("aria-disabled", "true");
    else control.setAttribute("aria-disabled", "false");
  }
  function updateAnkiForceAddLayout(group, visible) {
    const forceButton = ankiForceAddButtonForGroup(group);
    const visibilityChanged = !!forceButton && forceButton.hidden === !!visible;
    if (forceButton) forceButton.hidden = !visible;
    let current = group && group.parentNode;
    let ownerPopup = null;
    while (current) {
      if (current.classList && current.classList.contains("dict-term")) {
        if (visible) current.classList.add("has-add-anyway");
        else current.classList.remove("has-add-anyway");
      }
      if (
        current === popupEl ||
        (current.classList && current.classList.contains("nested-popup"))
      ) {
        ownerPopup = current;
        break;
      }
      current = current.parentNode || null;
    }
    if (visibilityChanged && ownerPopup)
      setTimeout(() => {
        if (!popupContainsNode(group)) return;
        if (ownerPopup === popupEl) {
          if (state.currentAnchor) placePopup(state.currentAnchor);
          return;
        }
        const item = nestedPopupItemForElement(ownerPopup);
        if (item) placeNestedPopup(item);
      }, 0);
  }
  function setAnkiButtonState(control, status) {
    const group = ankiActionGroupForControl(control);
    const button = ankiPrimaryButtonForGroup(group);
    const forceButton = ankiForceAddButtonForGroup(group);
    if (!group || !button) return;
    const stateName = String((status && status.state) || "ready");
    const duplicate = !!(status && status.duplicate);
    const statusNoteIds = Array.isArray(status && status.noteIds)
      ? status.noteIds
      : null;
    const config = activeAnkiConfig();
    group.dataset.ankiState = stateName;
    group.dataset.ankiBusyRole = "";
    button.dataset.ankiState = stateName;
    setAnkiControlDisabled(button, false);
    if (forceButton) {
      forceButton.dataset.ankiState = "ready";
      setAnkiControlDisabled(forceButton, false);
    }
    if (stateName === "duplicate" && duplicate) {
      group.dataset.ankiDuplicateKnown = "duplicate";
      setNoteIdsForAnkiButton(button, statusNoteIds || []);
      button.dataset.ankiAction = "open";
      button.innerHTML = ankiIconSvg("book");
      button.title = "Duplicate found. Open existing note in Anki.";
      button.setAttribute("aria-label", "Open existing Anki note");
      updateAnkiForceAddLayout(
        group,
        config.duplicateCheck && config.duplicateMode === "allow",
      );
    } else if (stateName === "added") {
      const addedNoteIds =
        statusNoteIds ||
        (status && status.noteId !== undefined && status.noteId !== null
          ? [status.noteId]
          : []);
      if (addedNoteIds.length) {
        group.dataset.ankiDuplicateKnown = "duplicate";
        setNoteIdsForAnkiButton(button, addedNoteIds);
        button.dataset.ankiAction = "open";
        button.innerHTML = ankiIconSvg("book");
        button.title = "Added to Anki. Open note in Anki.";
        button.setAttribute("aria-label", "Open added Anki note");
        updateAnkiForceAddLayout(
          group,
          config.duplicateCheck && config.duplicateMode === "allow",
        );
      } else {
        group.dataset.ankiDuplicateKnown = "";
        setNoteIdsForAnkiButton(button, []);
        button.dataset.ankiAction = "add";
        button.innerHTML = ankiIconSvg("check");
        button.title = "Added to Anki";
        button.setAttribute("aria-label", "Added to Anki");
        updateAnkiForceAddLayout(group, false);
      }
    } else if (stateName === "opened") {
      group.dataset.ankiDuplicateKnown = "duplicate";
      if (statusNoteIds) setNoteIdsForAnkiButton(button, statusNoteIds);
      button.dataset.ankiAction = "open";
      button.innerHTML = ankiIconSvg("book");
      button.title = String((status && status.message) || "Opened in Anki");
      button.setAttribute("aria-label", "Open existing Anki note");
      updateAnkiForceAddLayout(
        group,
        config.duplicateCheck && config.duplicateMode === "allow",
      );
    } else if (stateName === "error") {
      group.dataset.ankiDuplicateKnown = "";
      setNoteIdsForAnkiButton(button, []);
      button.dataset.ankiAction = "add";
      button.innerHTML = ankiIconSvg("error");
      button.title = String((status && status.message) || "Anki add failed");
      button.setAttribute("aria-label", "Anki add failed");
      updateAnkiForceAddLayout(group, false);
    } else if (stateName === "disabled") {
      group.dataset.ankiDuplicateKnown = "";
      setNoteIdsForAnkiButton(button, []);
      button.dataset.ankiAction = "disabled";
      button.innerHTML = ankiIconSvg("error");
      button.title = String(
        (status && status.message) || "Configure Anki export in settings",
      );
      button.setAttribute("aria-label", "Configure Anki export in settings");
      setAnkiControlDisabled(button, true);
      updateAnkiForceAddLayout(group, false);
    } else if (stateName === "checking" || stateName === "deferred") {
      group.dataset.ankiDuplicateKnown = "";
      setNoteIdsForAnkiButton(button, []);
      button.dataset.ankiState = "checking";
      button.dataset.ankiAction = "disabled";
      button.innerHTML = ankiIconSvg("plus");
      button.title = String(
        (status && status.message) || "Checking Anki for duplicates...",
      );
      button.setAttribute("aria-label", "Checking Anki for duplicates");
      setAnkiControlDisabled(button, true);
      updateAnkiForceAddLayout(group, false);
    } else {
      group.dataset.ankiDuplicateKnown = stateName === "ready" ? "ready" : "";
      setNoteIdsForAnkiButton(button, []);
      button.dataset.ankiAction = "add";
      button.innerHTML = ankiIconSvg("plus");
      button.title = String((status && status.message) || "Add Anki card");
      button.setAttribute("aria-label", "Add Anki card");
      updateAnkiForceAddLayout(group, false);
    }
    markElementClickable(group);
  }
  function ankiContextForButton(control) {
    const group = ankiActionGroupForControl(control);
    const contextId = group && group.dataset ? group.dataset.ankiContextId : "";
    return contextId ? state.ankiCardContexts[contextId] : null;
  }
  function noteIdsForButton(control) {
    const group = ankiActionGroupForControl(control);
    try {
      const ids = JSON.parse(
        String(
          group && group.dataset ? group.dataset.ankiNoteIds || "[]" : "[]",
        ),
      );
      return Array.isArray(ids) ? ids : [];
    } catch (_) {
      return [];
    }
  }
  function popupContainsNode(node) {
    let current = node;
    while (current) {
      if (
        current === popupEl ||
        (current.classList && current.classList.contains("nested-popup"))
      )
        return true;
      current = current.parentNode || current.host || null;
    }
    return false;
  }
  function selectionIsInsidePopup(selection) {
    if (!selection) return false;
    if (selection.anchorNode || selection.focusNode)
      return (
        popupContainsNode(selection.anchorNode) &&
        popupContainsNode(selection.focusNode)
      );
    if (
      selection.rangeCount > 0 &&
      typeof selection.getRangeAt === "function"
    ) {
      for (let i = 0; i < selection.rangeCount; i++) {
        const range = selection.getRangeAt(i);
        if (!range || !popupContainsNode(range.commonAncestorContainer))
          return false;
      }
      return true;
    }
    return false;
  }
  function popupSelectionText() {
    let selection = null;
    try {
      if (window && typeof window.getSelection === "function")
        selection = window.getSelection();
      else if (document && typeof document.getSelection === "function")
        selection = document.getSelection();
    } catch (_) {
      selection = null;
    }
    if (!selection || selection.isCollapsed) return "";
    const text = normalizeWhitespace(
      typeof selection.toString === "function" ? selection.toString() : "",
    );
    if (!text || !selectionIsInsidePopup(selection)) return "";
    return text;
  }
  function cachePopupSelectionForAnkiButton(control) {
    const group = ankiActionGroupForControl(control);
    if (!group || !group.dataset) return;
    group.dataset.ankiPopupSelectionText = popupSelectionText();
  }
  function ankiPayloadContext(context, control) {
    const group = ankiActionGroupForControl(control);
    const selected =
      popupSelectionText() ||
      normalizeWhitespace(
        group && group.dataset
          ? group.dataset.ankiPopupSelectionText || ""
          : "",
      );
    if (group && group.dataset) group.dataset.ankiPopupSelectionText = "";
    return Object.assign({}, context || {}, {
      popupSelectionText: selected,
    });
  }
  function ankiGroupSnapshot(group) {
    return {
      state: String(
        (group && group.dataset && group.dataset.ankiState) || "ready",
      ),
      duplicate:
        !!group &&
        !!group.dataset &&
        group.dataset.ankiDuplicateKnown === "duplicate",
      noteIds: noteIdsForButton(group),
    };
  }
  function restoreAnkiGroupSnapshot(group, snapshot) {
    if (!group || !snapshot) return;
    setAnkiButtonState(group, {
      state: snapshot.state,
      duplicate: snapshot.duplicate,
      noteIds: snapshot.noteIds,
    });
  }
  function clearPendingAnkiMessage(requestId) {
    const key = String(requestId || "");
    if (!key || !state.pendingAnkiMessages[key]) return;
    const pending = state.pendingAnkiMessages[key];
    if (pending.retryTimer) clearTimeout(pending.retryTimer);
    if (pending.finalTimer) clearTimeout(pending.finalTimer);
    delete state.pendingAnkiMessages[key];
  }
  function pendingAnkiStatusIsAttached(pending) {
    return !!(
      pending &&
      pending.group &&
      (pending.type !== "anki-card-status" || popupContainsNode(pending.group))
    );
  }
  function ankiTransportPayload(payload, transport) {
    return Object.assign({}, payload || {}, {
      bridgeTransport: String(transport || "unknown"),
    });
  }
  function sendPendingAnkiWebSocket(pending) {
    if (!pending || pending.transports.websocket) return false;
    const sent = sendBridgeMessage(
      ankiTransportPayload(pending.payload, "websocket"),
    );
    if (!sent) return false;
    pending.transports.websocket = true;
    overlayDebug(
      "Anki request dispatched transport=websocket requestId=" +
        pending.requestId,
    );
    return true;
  }
  function sendPendingAnkiNative(pending) {
    if (!pending || pending.transports.native) return false;
    pending.transports.native = true;
    const dispatched = postPluginMessage(
      ankiTransportPayload(pending.payload, "native"),
    );
    overlayDebug(
      "Anki request dispatched transport=native requestId=" +
        pending.requestId +
        " bestEffort=" +
        String(dispatched),
    );
    return dispatched;
  }
  function schedulePendingAnkiAlternate(pending, preferredTransport) {
    const attemptStartedAt = Date.now();
    const attempt = () => {
      if (!state.pendingAnkiMessages[pending.requestId] || pending.acked)
        return;
      if (!pendingAnkiStatusIsAttached(pending)) {
        clearPendingAnkiMessage(pending.requestId);
        return;
      }
      if (preferredTransport === "websocket") {
        sendPendingAnkiNative(pending);
        return;
      }
      if (sendPendingAnkiWebSocket(pending)) return;
      if (Date.now() - attemptStartedAt >= 2000) return;
      pending.retryTimer = setTimeout(attempt, 60);
    };
    pending.retryTimer = setTimeout(attempt, 750);
  }
  function failPendingAnkiMessage(pending, message) {
    if (!pending || !pending.requestId) return;
    overlayDebug(
      "Anki request failed requestId=" +
        pending.requestId +
        " acknowledged=" +
        String(!!pending.acked) +
        " message=" +
        String(message || ""),
    );
    clearPendingAnkiMessage(pending.requestId);
    if (
      pending.group &&
      pending.group.dataset &&
      pending.group.dataset.ankiRequestId === pending.requestId
    ) {
      if (
        pending.role === "force-add" ||
        (pending.type === "anki-card-open" && pending.snapshot)
      )
        restoreAnkiGroupSnapshot(pending.group, pending.snapshot);
      else
        setAnkiButtonState(pending.group, {
          state: "error",
          message: message || "Anki request timed out",
        });
    }
    if (pending.type !== "anki-card-status")
      setStatus({
        message: message || "Anki request timed out",
        kind: "error",
        ttlMs: 8000,
      });
  }
  function markPendingAnkiMessageAcked(requestId) {
    const pending = state.pendingAnkiMessages[String(requestId || "")];
    if (!pending) return;
    pending.acked = true;
    overlayDebug("Anki request acknowledged requestId=" + pending.requestId);
    if (pending.retryTimer) {
      clearTimeout(pending.retryTimer);
      pending.retryTimer = null;
    }
  }
  function clearPendingAnkiStatusForButton(control) {
    const group = ankiActionGroupForControl(control);
    const key =
      group && group.dataset ? String(group.dataset.ankiContextId || "") : "";
    if (!key || !state.pendingAnkiStatusTimers[key]) return;
    clearTimeout(state.pendingAnkiStatusTimers[key]);
    delete state.pendingAnkiStatusTimers[key];
  }
  function trackAnkiBridgeMessage(group, payload, type, role, snapshot) {
    const requestId = String((payload && payload.requestId) || "");
    if (!requestId) return false;
    clearPendingAnkiMessage(requestId);
    const pending = {
      requestId,
      group,
      payload,
      type,
      role,
      snapshot,
      acked: false,
      transports: { websocket: false, native: false },
      retryTimer: null,
      finalTimer: null,
    };
    state.pendingAnkiMessages[requestId] = pending;
    const finalDelay =
      type === "anki-card-status"
        ? 12000
        : type === "anki-card-open"
          ? 30000
          : 45000;
    pending.finalTimer = setTimeout(() => {
      if (!state.pendingAnkiMessages[requestId]) return;
      if (!pendingAnkiStatusIsAttached(pending)) {
        clearPendingAnkiMessage(requestId);
        return;
      }
      failPendingAnkiMessage(
        pending,
        pending.acked
          ? "Anki request timed out"
          : "IINA message transport did not respond",
      );
    }, finalDelay);
    const preferredTransport = sendPendingAnkiWebSocket(pending)
      ? "websocket"
      : "native";
    if (preferredTransport === "native") sendPendingAnkiNative(pending);
    schedulePendingAnkiAlternate(pending, preferredTransport);
    return true;
  }
  function sendAnkiCardMessage(control, type) {
    const group = ankiActionGroupForControl(control);
    const button = ankiPrimaryButtonForGroup(group);
    const forceButton = ankiForceAddButtonForGroup(group);
    const role = String(
      (control && control.dataset && control.dataset.ankiRole) || "primary",
    );
    const context = ankiContextForButton(group);
    if (!context) return false;
    if (type !== "anki-card-status") clearPendingAnkiStatusForButton(group);
    if (group.dataset.ankiBusyRole) {
      setStatus({
        message:
          type === "anki-card-open"
            ? "Opening in Anki..."
            : "Adding Anki card...",
        kind: "info",
      });
      return true;
    }
    const snapshot = ankiGroupSnapshot(group);
    const requestId = "anki-" + String(++state.ankiCardRequestSeq);
    group.dataset.ankiRequestId = requestId;
    group.dataset.ankiBusyRole = role;
    if (type === "anki-card-status") {
      setAnkiButtonState(group, {
        state: "checking",
        message: "Checking Anki for duplicates...",
      });
      group.dataset.ankiBusyRole = "status";
    } else if (type === "anki-card-open") {
      button.dataset.ankiState = "opening";
      setAnkiControlDisabled(button, true);
      setAnkiControlDisabled(forceButton, true);
    } else if (role === "force-add") {
      forceButton.dataset.ankiState = "adding";
      setAnkiControlDisabled(forceButton, true);
      setAnkiControlDisabled(button, true);
    } else {
      button.dataset.ankiState = "adding";
      setAnkiControlDisabled(button, true);
      setAnkiControlDisabled(forceButton, true);
    }
    if (type === "anki-card-add")
      setStatus({ message: "Adding Anki card...", kind: "info" });
    else if (type === "anki-card-open")
      setStatus({ message: "Opening in Anki...", kind: "info" });
    const payload = {
      type,
      requestId,
      popupSessionId: state.popupSessionId,
      context: ankiPayloadContext(context, group),
      noteIds: noteIdsForButton(group),
      duplicateKnown:
        group && group.dataset
          ? String(group.dataset.ankiDuplicateKnown || "")
          : "",
      forceDuplicate: type === "anki-card-add" && role === "force-add",
      at: Date.now(),
    };
    return trackAnkiBridgeMessage(group, payload, type, role, snapshot);
  }
  function requestAnkiCardStatus(control, requestedDelay) {
    const group = ankiActionGroupForControl(control);
    if (!group || group.dataset.ankiStatusRequested === "true") return;
    group.dataset.ankiStatusRequested = "true";
    const key =
      group && group.dataset ? String(group.dataset.ankiContextId || "") : "";
    if (!key) return;
    state.pendingAnkiStatusTimers[key] = setTimeout(
      () => {
        delete state.pendingAnkiStatusTimers[key];
        if (!popupContainsNode(group)) return;
        if (group.dataset.ankiBusyRole) return;
        if (!sendAnkiCardMessage(group, "anki-card-status"))
          setAnkiButtonState(group, {
            state: "error",
            message: "Anki bridge unavailable",
          });
      },
      Math.max(0, Number(requestedDelay) || 220),
    );
  }
  function bindPopupAnkiButtons(container) {
    const popup = container || popupEl;
    try {
      popup.querySelectorAll(".anki-action-group").forEach((group) => {
        group.querySelectorAll(".anki-button").forEach((button) => {
          if (button.dataset.ankiBound === "true") return;
          button.dataset.ankiBound = "true";
          button.addEventListener("pointerdown", () => {
            cachePopupSelectionForAnkiButton(group);
          });
          button.addEventListener("mousedown", () => {
            cachePopupSelectionForAnkiButton(group);
          });
          button.addEventListener("click", (event) => {
            try {
              event.preventDefault();
              event.stopPropagation();
            } catch (_) {}
            if (
              button.dataset.ankiAction === "disabled" ||
              button.dataset.ankiState === "disabled" ||
              button.disabled
            ) {
              return;
            }
            const type =
              button.dataset.ankiAction === "open"
                ? "anki-card-open"
                : "anki-card-add";
            if (!sendAnkiCardMessage(button, type))
              setAnkiButtonState(group, {
                state: "error",
                message: "Anki bridge unavailable",
              });
          });
          button.addEventListener("contextmenu", (event) => {
            try {
              event.preventDefault();
              event.stopPropagation();
            } catch (_) {}
            if (
              button.dataset.ankiRole !== "primary" ||
              !noteIdsForButton(group).length
            )
              return;
            if (!sendAnkiCardMessage(button, "anki-card-open"))
              setAnkiButtonState(group, {
                state: "error",
                message: "Anki bridge unavailable",
              });
          });
        });
        requestAnkiCardStatus(group);
      });
    } catch (_) {}
  }
  function bindPopupAudioButtons(container) {
    const popup = container || popupEl;
    try {
      popup.querySelectorAll(".audio-button").forEach((button) => {
        if (button.dataset.audioBound === "true") return;
        button.dataset.audioBound = "true";
        button.addEventListener("click", (event) => {
          try {
            event.preventDefault();
            event.stopPropagation();
          } catch (_) {}
          hideAudioSourceMenu();
          playAudioForTerm(
            button.dataset.audioTerm || "",
            button.dataset.audioReading || "",
            button,
            { userGesture: true },
          ).catch(() => {});
        });
        button.addEventListener("contextmenu", (event) => {
          showAudioSourceMenu(button, event);
        });
      });
    } catch (_) {}
  }
  function renderPopupHead(
    heading,
    reading,
    secondaryText,
    audioData,
    ankiData,
    primaryPitchHtml,
  ) {
    const audioHtml = audioData
      ? renderAudioButtonHtml(audioData.term, audioData.reading)
      : "";
    const ankiHtml = ankiData ? renderAnkiButtonHtml(ankiData.contextId) : "";
    const actionHtml =
      audioHtml || ankiHtml
        ? '<div class="head-actions">' + ankiHtml + audioHtml + "</div>"
        : "";
    return (
      '<div class="head-main"><div class="head-title">' +
      renderHeadwordStackHtml(heading || "", reading || "", {
        termClass: "term",
        readingClass: "reading",
      }) +
      (primaryPitchHtml || "") +
      "</div>" +
      actionHtml +
      "</div>" +
      (secondaryText
        ? '<div class="lookup-source">' + escapeHtml(secondaryText) + "</div>"
        : "")
    );
  }
  function showPopup(anchor, heading, bodyHtml) {
    hideAudioSourceMenu();
    clearNestedPopups(0);
    state.currentAnchor = anchor || null;
    popupEl.innerHTML =
      '<div class="head">' +
      renderPopupHead(heading || "", "", "", null, null) +
      '</div><div class="body">' +
      bodyHtml +
      "</div>";
    markPopupClickable();
    popupEl.classList.remove("hidden");
    setLookupPopupVisibility(true);
    placePopup(anchor);
  }
  function setPopupBodyFor(
    popup,
    bodyHtml,
    heading,
    reading,
    secondaryText,
    audioData,
    ankiData,
    primaryPitchHtml,
  ) {
    hideAudioSourceMenu();
    const head = popup.querySelector(".head");
    const body = popup.querySelector(".body");
    if (head && heading !== undefined) {
      head.innerHTML = renderPopupHead(
        heading || "",
        reading || "",
        secondaryText || "",
        audioData || null,
        ankiData || null,
        primaryPitchHtml || "",
      );
    }
    if (body) body.innerHTML = bodyHtml;
    markElementClickable(popup);
    bindPopupAudioButtons(popup);
    bindPopupAnkiButtons(popup);
    updateNestedPopupScanningState();
    if (
      popup === popupEl &&
      state.currentAnchor &&
      !popupEl.classList.contains("hidden")
    )
      placePopup(state.currentAnchor);
    else if (popup !== popupEl) {
      const item = nestedPopupItemForElement(popup);
      if (item) placeNestedPopup(item);
    }
  }
  function setPopupBody(
    bodyHtml,
    heading,
    reading,
    secondaryText,
    audioData,
    ankiData,
    primaryPitchHtml,
  ) {
    setPopupBodyFor(
      popupEl,
      bodyHtml,
      heading,
      reading,
      secondaryText,
      audioData,
      ankiData,
      primaryPitchHtml,
    );
  }
  function markPopupClickable() {
    markElementClickable(popupEl);
  }
  function charElementAt(pos) {
    return state.charByPos && state.charByPos[pos]
      ? state.charByPos[pos]
      : null;
  }

  function placePopup(anchor) {
    popupSafetyZoneEl.classList.add("hidden");
    popupRowSafetyZoneEl.classList.add("hidden");
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const margin = 12;
    const gap = Math.max(12, Number(state.config.popupSubtitleGapPx || 34));
    const scale = Math.max(
      0.1,
      Number(state.config.popupScale || 0.92) || 0.92,
    );
    const desiredVh = Math.max(
      20,
      Math.min(60, Number(state.config.popupMaxHeightVh || 34)),
    );
    const desiredMax = Math.floor((window.innerHeight * desiredVh) / 100);

    // Use the selected row rather than the complete subtitle band. A popup for a
    // lower row can therefore cover earlier rows, preventing them from replacing
    // the active popup while the pointer moves into it.
    const availableAbove = Math.max(0, rect.top - margin - gap);
    const availableBelow = Math.max(
      0,
      window.innerHeight - rect.bottom - margin - gap,
    );
    let placeAbove = true;
    if (availableAbove < 90 && availableBelow > availableAbove)
      placeAbove = false;
    else if (availableAbove < 160 && availableBelow > 220) placeAbove = false;
    else placeAbove = true; // Subtitles are usually at the bottom; keep popups above.

    let regionTop = placeAbove ? margin : rect.bottom + gap;
    let regionBottom = placeAbove
      ? rect.top - gap
      : window.innerHeight - margin;
    if (regionBottom - regionTop < 80) {
      // Fallback: use the larger side, still clear of the selected row.
      if (availableBelow > availableAbove) {
        placeAbove = false;
        regionTop = Math.min(window.innerHeight - 80, rect.bottom + gap);
        regionBottom = window.innerHeight - margin;
      } else {
        placeAbove = true;
        regionTop = margin;
        regionBottom = Math.max(margin + 80, rect.top - gap);
      }
    }

    const regionHeight = Math.max(80, regionBottom - regionTop);
    const cappedHeight = Math.max(80, Math.min(desiredMax, regionHeight));
    document.documentElement.style.setProperty(
      "--popup-max-height",
      String(Math.floor(cappedHeight / scale)) + "px",
    );

    popupEl.style.left = "0px";
    popupEl.style.top = "0px";
    const pr = popupEl.getBoundingClientRect();
    const popupW = Math.min(
      Math.max(0, pr.width),
      Math.max(0, window.innerWidth - margin * 2),
    );
    const popupH = Math.min(Math.max(0, pr.height), cappedHeight);

    let left = rect.left + rect.width / 2 - popupW / 2;
    const maxLeft = window.innerWidth - popupW - margin;
    left = Math.max(margin, Math.min(left, Math.max(margin, maxLeft)));

    // Keep the popup adjacent to the selected subtitle row rather than pinning it
    // to the very top of the video.
    let top = placeAbove ? regionBottom - popupH : regionTop;
    top = Math.max(regionTop, Math.min(top, regionBottom - popupH));
    top = Math.max(margin, Math.min(top, window.innerHeight - popupH - margin));

    // Absolute last safety check: keep the popup clear of the selected row.
    const overlaps = !(
      top + popupH <= rect.top - gap / 2 || top >= rect.bottom + gap / 2
    );
    if (overlaps && availableAbove > 80) {
      const safeHeight = Math.max(80, Math.min(desiredMax, availableAbove));
      document.documentElement.style.setProperty(
        "--popup-max-height",
        String(Math.floor(safeHeight / scale)) + "px",
      );
      top = Math.max(margin, rect.top - gap - safeHeight);
    }

    popupEl.style.left = left + "px";
    popupEl.style.top = top + "px";

    // The popup is CSS-scaled, so use its final rendered bounds rather than
    // unscaled layout dimensions. Protect the gap up to the selected row, then
    // cover only the active word so adjacent words on that row remain usable.
    const popupRect = popupEl.getBoundingClientRect();
    const safetyTop = placeAbove ? popupRect.bottom : rect.bottom;
    const safetyBottom = placeAbove ? rect.top : popupRect.top;
    const safetyLeft = Math.min(popupRect.left, rect.left);
    const safetyRight = Math.max(popupRect.right, rect.right);
    if (
      [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) &&
      rect.right > rect.left &&
      rect.bottom > rect.top
    ) {
      popupRowSafetyZoneEl.style.left = rect.left + "px";
      popupRowSafetyZoneEl.style.top = rect.top + "px";
      popupRowSafetyZoneEl.style.width = rect.right - rect.left + "px";
      popupRowSafetyZoneEl.style.height = rect.bottom - rect.top + "px";
      popupRowSafetyZoneEl.classList.remove("hidden");
    }
    if (
      ![safetyTop, safetyBottom, safetyLeft, safetyRight].every(
        Number.isFinite,
      ) ||
      safetyBottom <= safetyTop ||
      safetyRight <= safetyLeft
    )
      return;
    popupSafetyZoneEl.style.left = safetyLeft + "px";
    popupSafetyZoneEl.style.top = safetyTop + "px";
    popupSafetyZoneEl.style.width = safetyRight - safetyLeft + "px";
    popupSafetyZoneEl.style.height = safetyBottom - safetyTop + "px";
    popupSafetyZoneEl.classList.remove("hidden");
  }

  function popupDepth(popup) {
    return Math.max(
      0,
      Number(
        popup && popup.dataset && popup.dataset.popupDepth
          ? popup.dataset.popupDepth
          : 0,
      ) || 0,
    );
  }
  function allPopupContainers() {
    return [popupEl].concat(
      state.nestedPopups.map((item) => item.element).filter(Boolean),
    );
  }
  function nestedPopupItemForElement(element) {
    return state.nestedPopups.find((item) => item.element === element) || null;
  }
  function cancelPendingNestedLookup(requestId) {
    const key = String(requestId || "");
    const req = state.pendingNestedLookupRequests[key];
    if (!req) return;
    if (req.retryTimer) clearInterval(req.retryTimer);
    if (req.timeoutTimer) clearTimeout(req.timeoutTimer);
    delete state.pendingNestedLookupRequests[key];
  }
  function clearNestedPopups(keepDepth) {
    const depth = Math.max(0, Number(keepDepth) || 0);
    if (state.nestedHoverTimer) clearTimeout(state.nestedHoverTimer);
    state.nestedHoverTimer = null;
    state.nestedHoverKey = "";
    const retained = [];
    state.nestedPopups.forEach((item) => {
      if (item.depth <= depth) {
        retained.push(item);
        return;
      }
      cancelPendingNestedLookup(item.requestId);
      try {
        const highlights =
          Array.isArray(item.highlights) && item.highlights.length
            ? item.highlights
            : [item.highlight];
        highlights.forEach((highlight) => {
          if (highlight && typeof highlight.remove === "function")
            highlight.remove();
        });
        if (item.element && typeof item.element.remove === "function")
          item.element.remove();
      } catch (_) {}
    });
    state.nestedPopups = retained;
  }
  function updateNestedPopupScanningState() {
    const enabled =
      state.config.nestedPopupMode === "hover" ||
      state.config.nestedPopupMode === "click";
    allPopupContainers().forEach((popup) => {
      if (!popup || typeof popup.setAttribute !== "function") return;
      popup.setAttribute("data-nested-enabled", enabled ? "true" : "false");
      popup.setAttribute(
        "data-nested-mode",
        enabled ? state.config.nestedPopupMode : "off",
      );
    });
    if (!enabled) clearNestedPopups(0);
    else if (
      state.nestedPopups.some(
        (item) => item.depth > state.config.nestedPopupMaxDepth,
      )
    )
      clearNestedPopups(state.config.nestedPopupMaxDepth);
  }
  function normalizedRect(rect) {
    if (!rect) return null;
    const left = Number(rect.left);
    const top = Number(rect.top);
    const right = Number(rect.right);
    const bottom = Number(rect.bottom);
    if (![left, top, right, bottom].every(Number.isFinite)) return null;
    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(1, Number(rect.width) || right - left),
      height: Math.max(1, Number(rect.height) || bottom - top),
    };
  }
  function rectIntersectionArea(a, b) {
    if (!a || !b) return 0;
    const width = Math.max(
      0,
      Math.min(a.right, b.right) - Math.max(a.left, b.left),
    );
    const height = Math.max(
      0,
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top),
    );
    return width * height;
  }
  function combinedRect(rects) {
    const normalized = (rects || []).map(normalizedRect).filter(Boolean);
    if (!normalized.length) return null;
    const left = Math.min(...normalized.map((rect) => rect.left));
    const top = Math.min(...normalized.map((rect) => rect.top));
    const right = Math.max(...normalized.map((rect) => rect.right));
    const bottom = Math.max(...normalized.map((rect) => rect.bottom));
    return normalizedRect({ left, top, right, bottom });
  }
  function placeNestedPopup(item) {
    if (!item || !item.element || !item.anchorRect) return;
    const element = item.element;
    const anchor = item.anchorRect;
    const margin = 12;
    const gap = 10;
    const scale = Math.max(
      0.1,
      Number(state.config.popupScale || 0.92) || 0.92,
    );
    const desiredVh = Math.max(
      20,
      Math.min(60, Number(state.config.popupMaxHeightVh || 34)),
    );
    const maxRenderedHeight = Math.max(
      120,
      Math.floor((window.innerHeight * desiredVh) / 100),
    );
    element.style.maxHeight =
      String(Math.floor(maxRenderedHeight / scale)) + "px";
    element.style.left = "0px";
    element.style.top = "0px";
    const measured = normalizedRect(element.getBoundingClientRect()) || {
      width: Math.min(440, window.innerWidth - margin * 2),
      height: Math.min(maxRenderedHeight, 260),
    };
    const width = Math.min(measured.width, window.innerWidth - margin * 2);
    const height = Math.min(measured.height, maxRenderedHeight);
    const sentence = item.sentenceRect || anchor;
    const centeredLeft = anchor.left + anchor.width / 2 - width / 2;
    const candidates = [
      { left: centeredLeft, top: sentence.bottom + gap },
      { left: centeredLeft, top: sentence.top - height - gap },
    ];
    const fits = (candidate) =>
      candidate.left >= margin &&
      candidate.top >= margin &&
      candidate.left + width <= window.innerWidth - margin &&
      candidate.top + height <= window.innerHeight - margin;
    let position = candidates.find(fits);
    if (!position) {
      const clamped = candidates.map((candidate, index) => {
        const left = Math.max(
          margin,
          Math.min(candidate.left, window.innerWidth - width - margin),
        );
        const top = Math.max(
          margin,
          Math.min(candidate.top, window.innerHeight - height - margin),
        );
        const rect = {
          left,
          top,
          right: left + width,
          bottom: top + height,
        };
        return {
          left,
          top,
          index,
          anchorOverlap: rectIntersectionArea(rect, anchor),
        };
      });
      clamped.sort(
        (a, b) => a.anchorOverlap - b.anchorOverlap || a.index - b.index,
      );
      position = clamped[0];
    }
    element.style.left = String(Math.round(position.left)) + "px";
    element.style.top = String(Math.round(position.top)) + "px";
    element.style.zIndex = String(30 + item.depth);
  }
  function nodeIsText(node) {
    return !!node && (node.nodeType === 3 || node.tagName === "#text");
  }
  function nodeTagName(node) {
    return String((node && node.tagName) || "").toLowerCase();
  }
  function nodeHasClass(node, name) {
    return !!(
      node &&
      node.classList &&
      typeof node.classList.contains === "function" &&
      node.classList.contains(name)
    );
  }
  function ancestorWithClass(node, name, stop) {
    let current = nodeIsText(node) ? node.parentNode : node;
    while (current && current !== stop) {
      if (nodeHasClass(current, name)) return current;
      current = current.parentNode;
    }
    return null;
  }
  function ancestorWithTag(node, tagName, stop) {
    const expected = String(tagName || "").toLowerCase();
    let current = nodeIsText(node) ? node.parentNode : node;
    while (current && current !== stop) {
      if (nodeTagName(current) === expected) return current;
      current = current.parentNode;
    }
    return null;
  }
  function firstNestedLookupTextNode(root) {
    if (!root) return null;
    const tag = nodeTagName(root);
    if (
      tag === "rt" ||
      tag === "rp" ||
      tag === "button" ||
      tag === "svg" ||
      tag === "path"
    )
      return null;
    if (nodeIsText(root) && String(root.textContent || "").trim()) return root;
    const children = Array.from(root.childNodes || root.children || []);
    for (let i = 0; i < children.length; i++) {
      const found = firstNestedLookupTextNode(children[i]);
      if (found) return found;
    }
    return null;
  }
  function nestedRubyBasePoint(node, popup) {
    const rt = ancestorWithTag(node, "rt", popup);
    if (!rt) return null;
    const ruby = ancestorWithTag(rt.parentNode, "ruby", popup);
    if (!ruby) return null;
    const baseNode = firstNestedLookupTextNode(ruby);
    return baseNode ? { node: baseNode, offset: 0 } : null;
  }
  function nestedLookupExcluded(node, popup) {
    let current = nodeIsText(node) ? node.parentNode : node;
    while (current && current !== popup) {
      const tag = nodeTagName(current);
      if (
        tag === "a" ||
        tag === "button" ||
        tag === "summary" ||
        tag === "rt" ||
        tag === "svg" ||
        tag === "path" ||
        nodeHasClass(current, "scan-disable")
      )
        return true;
      current = current.parentNode;
    }
    return false;
  }
  function collectNestedLookupText(root, targetNode, targetOffset) {
    let text = "";
    let charLength = 0;
    let utf16Offset = null;
    const segments = [];
    const visit = (node) => {
      if (!node) return;
      const tag = nodeTagName(node);
      if (
        tag === "rt" ||
        tag === "rp" ||
        tag === "button" ||
        tag === "svg" ||
        tag === "path"
      )
        return;
      if (nodeIsText(node)) {
        const value = String(node.textContent || "");
        if (node === targetNode)
          utf16Offset =
            text.length +
            Math.max(0, Math.min(value.length, Number(targetOffset) || 0));
        const valueLength = Array.from(value).length;
        segments.push({
          node,
          text: value,
          start: charLength,
          end: charLength + valueLength,
        });
        text += value;
        charLength += valueLength;
        return;
      }
      Array.from(node.childNodes || node.children || []).forEach(visit);
    };
    visit(root);
    if (utf16Offset === null) return null;
    return {
      text,
      position: Array.from(text.slice(0, utf16Offset)).length,
      segments,
    };
  }
  function caretRangeForPopupEvent(event) {
    if (event && event.lookupRange) return event.lookupRange;
    const x = Number(event && event.clientX);
    const y = Number(event && event.clientY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    try {
      if (typeof document.caretRangeFromPoint === "function")
        return document.caretRangeFromPoint(x, y);
      if (typeof document.caretPositionFromPoint === "function") {
        const caret = document.caretPositionFromPoint(x, y);
        if (!caret) return null;
        return {
          startContainer: caret.offsetNode,
          startOffset: caret.offset,
        };
      }
    } catch (_) {}
    return null;
  }
  function nestedLookupAnchorRect(range, node, offset) {
    try {
      const value = String((node && node.textContent) || "");
      if (!value) return null;
      const start = Math.max(0, Math.min(value.length, Number(offset) || 0));
      const anchorStart =
        start < value.length ? start : Math.max(0, value.length - 1);
      const end = Math.min(
        value.length,
        anchorStart + (value.codePointAt(anchorStart) > 0xffff ? 2 : 1),
      );
      const anchorRange =
        typeof document.createRange === "function"
          ? document.createRange()
          : range;
      if (anchorRange && typeof anchorRange.setStart === "function") {
        anchorRange.setStart(node, anchorStart);
        anchorRange.setEnd(node, Math.max(anchorStart + 1, end));
      }
      const rects =
        anchorRange && typeof anchorRange.getClientRects === "function"
          ? anchorRange.getClientRects()
          : [];
      return normalizedRect(rects && rects[0]);
    } catch (_) {
      return null;
    }
  }
  function nestedLookupSourceFromEvent(popup, event) {
    if (!popup || state.config.nestedPopupMode === "off") return null;
    const range = caretRangeForPopupEvent(event);
    let node = range && (range.startContainer || range.offsetNode);
    let offset =
      range &&
      (range.startOffset !== undefined ? range.startOffset : range.offset);
    const rubyBase = nestedRubyBasePoint(node, popup);
    if (rubyBase) {
      node = rubyBase.node;
      offset = rubyBase.offset;
    }
    if (
      !node ||
      !popupContainsNode(node) ||
      !ancestorWithClass(node, "body", popup) ||
      nestedLookupExcluded(node, popup)
    )
      return null;
    const ruby = ancestorWithTag(node, "ruby", popup);
    const boundary =
      ruby && ruby.parentNode
        ? ruby.parentNode
        : nodeIsText(node)
          ? node.parentNode
          : node;
    const source = collectNestedLookupText(boundary, node, offset);
    if (!source || !source.text.trim()) return null;
    let chars = Array.from(source.text);
    let position = Math.max(
      0,
      Math.min(chars.length ? chars.length - 1 : 0, source.position),
    );
    if (!isLookupableChar(chars[position]) && position > 0) position -= 1;
    if (!isLookupableChar(chars[position])) return null;
    let lookupText = source.text;
    let sourceCharOffset = 0;
    if (chars.length > 2000) {
      const sliceStart = Math.max(0, position - 256);
      chars = chars.slice(sliceStart, sliceStart + 2000);
      lookupText = chars.join("");
      position -= sliceStart;
      sourceCharOffset = sliceStart;
    }
    const anchorRect =
      nestedLookupAnchorRect(range, node, offset) ||
      normalizedRect(
        event &&
          event.target &&
          typeof event.target.getBoundingClientRect === "function"
          ? event.target.getBoundingClientRect()
          : null,
      );
    if (!anchorRect) return null;
    const sentenceRect = normalizedRect(
      boundary && typeof boundary.getBoundingClientRect === "function"
        ? boundary.getBoundingClientRect()
        : null,
    );
    return {
      text: lookupText,
      position,
      anchorRect,
      sentenceRect: sentenceRect || anchorRect,
      root: boundary,
      sourceCharOffset,
      segments: source.segments,
      key:
        String(popupDepth(popup)) + ":" + String(position) + ":" + lookupText,
    };
  }
  function nestedLookupPreview(source) {
    const chars = Array.from(String((source && source.text) || ""));
    const position = Math.max(
      0,
      Math.min(chars.length ? chars.length - 1 : 0, source.position || 0),
    );
    let start = position;
    let end = position + 1;
    while (start > 0 && isLookupableChar(chars[start - 1])) start--;
    while (end < chars.length && isLookupableChar(chars[end])) end++;
    const run = chars.slice(start, end).join("").trim();
    return run || chars.slice(position, position + 1).join("");
  }
  function createNestedPopupHighlights(rects, depth) {
    if (!nestedPopupLayerEl) return [];
    return groupMatchRects(rects || []).map((rect) => {
      const highlight = document.createElement("div");
      highlight.className = "nested-popup-highlight";
      highlight.setAttribute("aria-hidden", "true");
      highlight.style.left = String(rect.left) + "px";
      highlight.style.top = String(rect.top) + "px";
      highlight.style.width =
        String(Math.max(1, rect.right - rect.left)) + "px";
      highlight.style.height =
        String(Math.max(1, rect.bottom - rect.top)) + "px";
      highlight.style.zIndex = String(29 + depth);
      nestedPopupLayerEl.appendChild(highlight);
      return highlight;
    });
  }
  function nestedLookupRangeRects(source, start, end) {
    const rects = [];
    const sourceOffset = Math.max(
      0,
      Number((source && source.sourceCharOffset) || 0) || 0,
    );
    const rangeStart = sourceOffset + Math.max(0, Number(start) || 0);
    const rangeEnd = sourceOffset + Math.max(rangeStart + 1, Number(end) || 0);
    (source && Array.isArray(source.segments) ? source.segments : []).forEach(
      (segment) => {
        const overlapStart = Math.max(rangeStart, Number(segment.start) || 0);
        const overlapEnd = Math.min(rangeEnd, Number(segment.end) || 0);
        if (overlapEnd <= overlapStart || !segment.node) return;
        const chars = Array.from(String(segment.text || ""));
        const localStart = chars
          .slice(0, overlapStart - segment.start)
          .join("").length;
        const localEnd = chars
          .slice(0, overlapEnd - segment.start)
          .join("").length;
        try {
          const range = document.createRange();
          range.setStart(segment.node, localStart);
          range.setEnd(segment.node, localEnd);
          Array.from(range.getClientRects() || []).forEach((rect) => {
            const normalized = normalizedRect(rect);
            if (normalized) rects.push(normalized);
          });
        } catch (_) {}
      },
    );
    return rects;
  }
  function nestedLookupResultRange(stored, fallbackPosition) {
    const result = stored && stored.result ? stored.result : {};
    const lookupStart = Number(result.lookupStart);
    const lookupEnd = Number(result.lookupEnd);
    if (
      isWordLookupMode(activeLanguage()) &&
      Number.isFinite(lookupStart) &&
      Number.isFinite(lookupEnd) &&
      lookupEnd > lookupStart
    )
      return { start: lookupStart, end: lookupEnd };
    const matchedLength = charsCount(topMatchedText(stored));
    const matchStart = Number(result.matchStart);
    const start = Number.isFinite(matchStart)
      ? Math.max(0, matchStart)
      : Number.isFinite(lookupStart)
        ? Math.max(0, lookupStart)
        : Math.max(0, Number(fallbackPosition) || 0);
    if (matchedLength > 0) return { start, end: start + matchedLength };
    if (Number.isFinite(lookupEnd) && lookupEnd > start)
      return { start, end: lookupEnd };
    return { start, end: start + 1 };
  }
  function updateNestedPopupHighlight(item, stored, fallbackPosition) {
    if (!item || !item.source) return;
    const match = nestedLookupResultRange(stored, fallbackPosition);
    item.lookupRange = match;
    const rects = nestedLookupRangeRects(item.source, match.start, match.end);
    if (!rects.length) return;
    const matchRect = combinedRect(rects);
    if (matchRect) item.anchorRect = matchRect;
    const oldHighlights =
      Array.isArray(item.highlights) && item.highlights.length
        ? item.highlights
        : [item.highlight];
    oldHighlights.forEach((highlight) => {
      if (highlight && typeof highlight.remove === "function")
        highlight.remove();
    });
    item.highlights = createNestedPopupHighlights(rects, item.depth);
    item.highlight = item.highlights[0] || null;
    placeNestedPopup(item);
  }
  function sendNestedLookupRequest(req) {
    req.attempts += 1;
    const payload = {
      type: "nested-lookup",
      requestId: req.requestId,
      popupSessionId: state.popupSessionId,
      lineId: req.lineId,
      text: req.text,
      position: req.position,
      depth: req.depth,
      at: Date.now(),
      attempt: req.attempts,
    };
    const sent =
      sendBridgeMessage(payload) ||
      (req.attempts >= 6 && postPluginMessage(payload));
    if (sent && req.retryTimer) {
      clearInterval(req.retryTimer);
      req.retryTimer = null;
    }
    return sent;
  }
  function requestNestedLookup(item, source) {
    const requestId =
      "nested-" +
      state.popupSessionId +
      "-" +
      String(++state.nestedLookupRequestSeq);
    const req = {
      requestId,
      popupId: item.id,
      lineId: state.lineId,
      text: source.text,
      position: source.position,
      depth: item.depth,
      attempts: 0,
      acked: false,
      retryTimer: null,
      timeoutTimer: null,
    };
    item.requestId = requestId;
    state.pendingNestedLookupRequests[requestId] = req;
    if (!sendNestedLookupRequest(req)) {
      req.retryTimer = setInterval(() => {
        if (req.acked || sendNestedLookupRequest(req) || req.attempts >= 6) {
          if (req.retryTimer) clearInterval(req.retryTimer);
          req.retryTimer = null;
        }
      }, LOOKUP_RETRY_INTERVAL_MS);
    }
    req.timeoutTimer = setTimeout(
      () => {
        cancelPendingNestedLookup(requestId);
        const current = state.nestedPopups.find(
          (candidate) => candidate.id === item.id,
        );
        if (current)
          setPopupBodyFor(
            current.element,
            '<div class="error">Nested lookup timed out. Try the word again.</div>',
          );
      },
      Math.max(5000, Number(state.config.hoverRequestTimeoutMs || 9000)),
    );
  }
  function openNestedPopup(parentPopup, source) {
    const parentDepth = popupDepth(parentPopup);
    const depth = parentDepth + 1;
    if (depth > state.config.nestedPopupMaxDepth) return false;
    clearNestedPopups(parentDepth);
    state.nestedHoverKey = source.key || "";
    const element = document.createElement("div");
    const id =
      "nested-popup-" +
      String(depth) +
      "-" +
      String(state.nestedLookupRequestSeq + 1);
    element.className = "lookup-popup nested-popup";
    element.dataset.popupId = id;
    element.dataset.popupDepth = String(depth);
    element.setAttribute("data-clickable", "true");
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-label", "Nested dictionary lookup");
    element.innerHTML =
      '<div class="head">' +
      renderPopupHead(nestedLookupPreview(source), "", "", null, null) +
      '</div><div class="body"><div class="loading">Looking up…</div></div>';
    const item = {
      id,
      depth,
      element,
      parentPopup,
      anchorRect: source.anchorRect,
      sentenceRect: source.sentenceRect || source.anchorRect,
      source,
      lookupRange: {
        start: source.position,
        end: source.position + 1,
      },
      highlights: createNestedPopupHighlights([source.anchorRect], depth),
      requestId: "",
    };
    item.highlight = item.highlights[0] || null;
    state.nestedPopups.push(item);
    (nestedPopupLayerEl || document.body).appendChild(element);
    bindPopupContainerEvents(element);
    markElementClickable(element);
    updateNestedPopupScanningState();
    placeNestedPopup(item);
    requestNestedLookup(item, source);
    return true;
  }
  function popupSelectionIsActive() {
    try {
      const selection =
        typeof window.getSelection === "function"
          ? window.getSelection()
          : document.getSelection();
      return !!(
        selection &&
        !selection.isCollapsed &&
        normalizeWhitespace(selection.toString())
      );
    } catch (_) {
      return false;
    }
  }
  function nestedPopupClickIsInteractive(target, popup) {
    let current = nodeIsText(target) ? target.parentNode : target;
    while (current && current !== popup) {
      const tag = nodeTagName(current);
      if (
        tag === "a" ||
        tag === "button" ||
        tag === "summary" ||
        tag === "input" ||
        tag === "select" ||
        tag === "textarea"
      )
        return true;
      current = current.parentNode;
    }
    return false;
  }
  function nestedPopupClickHitsSource(event, source) {
    if (!source) return false;
    if (event && event.lookupRange) return true;
    const x = Number(event && event.clientX);
    const y = Number(event && event.clientY);
    const rect = source.anchorRect;
    if (
      !rect ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      ![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
    )
      return false;
    return (
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }
  function nestedPopupSourceMatches(item, parentPopup, source) {
    if (
      !item ||
      item.parentPopup !== parentPopup ||
      !item.source ||
      !source ||
      item.source.root !== source.root ||
      item.source.text !== source.text
    )
      return false;
    const range = item.lookupRange || {
      start: item.source.position,
      end: item.source.position + 1,
    };
    return source.position >= range.start && source.position < range.end;
  }
  function onNestedPopupClick(event) {
    if (state.config.nestedPopupMode === "off" || popupSelectionIsActive())
      return;
    const popup = popupContainerForNode(event && event.currentTarget);
    if (!popup || nestedPopupClickIsInteractive(event && event.target, popup))
      return;
    let source = nestedLookupSourceFromEvent(popup, event);
    if (!nestedPopupClickHitsSource(event, source)) source = null;
    const child = state.nestedPopups.find(
      (item) =>
        item.parentPopup === popup && item.depth === popupDepth(popup) + 1,
    );
    if (!source || nestedPopupSourceMatches(child, popup, source)) {
      clearNestedPopups(popupDepth(popup));
      return;
    }
    openNestedPopup(popup, source);
  }
  function onPopupContainerClick(event) {
    if (closestExternalLink(event && event.target)) {
      onPopupClick(event);
      return;
    }
    onNestedPopupClick(event);
  }
  function onNestedPopupMouseMove(event) {
    if (state.config.nestedPopupMode !== "hover") return;
    const popup = popupContainerForNode(event && event.currentTarget);
    const source = nestedLookupSourceFromEvent(popup, event);
    if (!source || source.key === state.nestedHoverKey) return;
    state.nestedHoverKey = source.key;
    if (state.nestedHoverTimer) clearTimeout(state.nestedHoverTimer);
    state.nestedHoverTimer = setTimeout(() => {
      state.nestedHoverTimer = null;
      if (state.config.nestedPopupMode === "hover")
        openNestedPopup(popup, source);
    }, 180);
  }
  function popupContainerForNode(node) {
    let current = node;
    while (current) {
      if (
        current === popupEl ||
        (current.classList && current.classList.contains("nested-popup"))
      )
        return current;
      current = current.parentNode;
    }
    return null;
  }
  function bindPopupContainerEvents(popup) {
    if (!popup || (popup.dataset && popup.dataset.popupEventsBound === "true"))
      return;
    if (popup.dataset) popup.dataset.popupEventsBound = "true";
    popup.addEventListener("mouseenter", cancelHidePopupTimer);
    popup.addEventListener("mouseleave", scheduleHidePopup);
    popup.addEventListener("click", onPopupContainerClick, true);
    popup.addEventListener("mousemove", onNestedPopupMouseMove);
    popup.addEventListener("wheel", trapPopupWheel, {
      passive: false,
      capture: true,
    });
    popup.addEventListener("mousewheel", trapPopupWheel, {
      passive: false,
      capture: true,
    });
    popup.addEventListener("DOMMouseScroll", trapPopupWheel, {
      passive: false,
      capture: true,
    });
  }

  function toArray(v) {
    return Array.isArray(v) ? v : v == null ? [] : [v];
  }
  function plainTextFromNode(node) {
    if (node == null) return "";
    if (
      typeof node === "string" ||
      typeof node === "number" ||
      typeof node === "boolean"
    )
      return String(node);
    if (Array.isArray(node)) return node.map(plainTextFromNode).join("");
    if (typeof node === "object") {
      if (node.tag === "rt") return "";
      if (node.tag === "ruby") {
        return toArray(node.content)
          .filter(
            (part) => !(part && typeof part === "object" && part.tag === "rt"),
          )
          .map(plainTextFromNode)
          .join("");
      }
      return plainTextFromNode(node.content);
    }
    return "";
  }
  function renderRubyNode(node) {
    const parts = toArray(node && node.content);
    let base = "";
    let rt = "";
    parts.forEach((part) => {
      if (part && typeof part === "object" && part.tag === "rt")
        rt += plainTextFromNode(part.content);
      else base += plainTextFromNode(part);
    });
    return (
      "<ruby>" +
      escapeHtml(base) +
      (rt ? "<rt>" + escapeHtml(rt) + "</rt>" : "") +
      "</ruby>"
    );
  }
  function renderInlineNode(node, ctx) {
    if (node == null) return "";
    if (
      typeof node === "string" ||
      typeof node === "number" ||
      typeof node === "boolean"
    )
      return escapeHtml(String(node)).replace(/\n/g, "<br>");
    if (Array.isArray(node))
      return node.map((part) => renderInlineNode(part, ctx)).join("");
    if (typeof node === "object") {
      if (node.type === "structured-content")
        return renderInlineNode(node.content, ctx);
      const tag = node.tag || "";
      if (tag === "ruby") return renderRubyNode(node);
      if (tag === "rt") return "";
      if (tag === "br") return "<br>";
      if (tag === "a") {
        const inner =
          renderInlineNode(node.content, ctx) || escapeHtml(nodeHref(node));
        const linked = externalLinkHtml(nodeHref(node), inner);
        return linked || '<span class="xref-link">' + inner + "</span>";
      }
      if (tag === "span") return renderStructuredSpan(node, ctx);
      return renderInlineNode(node.content, ctx);
    }
    return "";
  }
  function findNodes(node, predicate, out) {
    out = out || [];
    if (node == null) return out;
    if (Array.isArray(node)) {
      node.forEach((n) => findNodes(n, predicate, out));
      return out;
    }
    if (typeof node === "object") {
      if (predicate(node)) out.push(node);
      if (node.content !== undefined) findNodes(node.content, predicate, out);
    }
    return out;
  }
  function parseGlossaryJson(raw) {
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    if (!s || (s[0] !== "[" && s[0] !== "{")) return null;
    try {
      return JSON.parse(s);
    } catch (_) {
      return null;
    }
  }
  function fallbackGlossaryText(raw) {
    const s = String(raw || "");
    if (!s) return "";
    if (s.trim()[0] !== "[" && s.trim()[0] !== "{") return s;
    const bits = [];
    const re = /"content"\s*:\s*"((?:\\.|[^"\\])*)"/g;
    let match;
    while ((match = re.exec(s)) && bits.length < 12) {
      try {
        const text = JSON.parse('"' + match[1] + '"');
        if (
          text &&
          !/^(sense|sense-group|sense-groups|glossary|extra-info|part-of-speech-info|example-sentence|tag)$/i.test(
            text,
          )
        )
          bits.push(text);
      } catch (_) {}
    }
    return bits.length ? bits.join("\n") : s;
  }
  function nodeDataContent(node) {
    const data = node && node.data ? node.data : {};
    return String(
      data.content ||
        data["data-content"] ||
        node.dataContent ||
        node.kind ||
        "",
    );
  }
  function nodeClassName(node) {
    const data = node && node.data ? node.data : {};
    const attrs =
      node && (node.attributes || node.attrs)
        ? node.attributes || node.attrs
        : {};
    return String(
      data.class || data.className || attrs.class || node.className || "",
    );
  }
  function nodeDataMap(node) {
    return node &&
      typeof node === "object" &&
      node.data &&
      typeof node.data === "object"
      ? node.data
      : {};
  }
  function hasDataFlag(node, name) {
    const data = nodeDataMap(node);
    return Object.prototype.hasOwnProperty.call(data, name);
  }
  function nodeTitle(node) {
    const data = nodeDataMap(node);
    const attrs =
      node && (node.attributes || node.attrs)
        ? node.attributes || node.attrs
        : {};
    return String((node && node.title) || data.title || attrs.title || "");
  }
  function directContent(node) {
    return toArray(node && node.content);
  }
  function isSummaryNode(node) {
    return !!(node && typeof node === "object" && node.tag === "summary");
  }
  function detailsSummaryText(node) {
    const parts = directContent(node);
    const summary = parts.find(isSummaryNode);
    const text = normalizeWhitespace(
      summary ? plainTextFromNode(summary.content) : "",
    );
    if (text) return text;
    const kind = nodeDataContent(node);
    if (/grammar/i.test(kind)) return "Grammar";
    if (/etymology/i.test(kind)) return "Etymology";
    return "Details";
  }
  function detailsBody(node) {
    return directContent(node).filter((part) => !isSummaryNode(part));
  }
  function isGrammarDetails(node) {
    const kind = nodeDataContent(node);
    if (/details-entry-grammar/i.test(kind)) return true;
    return (
      node &&
      node.tag === "details" &&
      /^grammar\b/i.test(detailsSummaryText(node))
    );
  }
  function isEtymologyDetails(node) {
    const kind = nodeDataContent(node);
    if (/details-entry-etymology/i.test(kind)) return true;
    return (
      node &&
      node.tag === "details" &&
      /^etymology\b/i.test(detailsSummaryText(node))
    );
  }
  function detectDictionarySource(glossaryItem, parsed) {
    const dictName = String((glossaryItem && glossaryItem.dict) || "");
    const raw = String((glossaryItem && glossaryItem.glossary) || "");
    const hay = (dictName + " " + raw.slice(0, 1600)).toLowerCase();
    if (hay.indexOf("kaikki") >= 0) return "kaikki";
    if (hay.indexOf("wiktionary") >= 0 || /(^|[^a-z])wty[-_]/.test(hay))
      return "wiktionary";
    if (
      /details-entry-(grammar|etymology)/i.test(raw) ||
      findNodes(parsed, (n) => isGrammarDetails(n) || isEtymologyDetails(n))
        .length
    )
      return "wiktionary-style";
    return "generic";
  }
  function isWiktionaryLike(ctx) {
    const kind = ctx && ctx.sourceKind ? String(ctx.sourceKind) : "";
    return /^(wiktionary|kaikki|wiktionary-style)$/.test(kind);
  }
  function etymologyShouldOpen(ctx) {
    let mode = String(
      (state.config && state.config.etymologyCollapseDefault) || "collapsed",
    );
    const override = String(
      (state.config && state.config.wiktionaryEtymologyCollapseOverride) ||
        "inherit",
    );
    if (isWiktionaryLike(ctx) && override && override !== "inherit") {
      overlayDebug(
        "dictionary-specific etymology collapse override source=" +
          String(ctx.sourceKind || "") +
          " mode=" +
          override,
      );
      mode = override;
    }
    overlayDebug(
      "etymology collapsibility applied source=" +
        String((ctx && ctx.sourceKind) || "generic") +
        " mode=" +
        mode,
    );
    return mode === "expanded";
  }
  function renderGrammarHtml(content, ctx) {
    const inline = normalizeWhitespace(
      renderInlineNode(content, ctx).replace(/<br\s*\/?>/gi, " "),
    );
    if (!inline) return "";
    overlayDebug(
      "detected grammar section source=" +
        String((ctx && ctx.sourceKind) || "generic"),
    );
    return (
      '<div class="grammar-row"><b>Grammar</b>: <span>' +
      inline +
      "</span></div>"
    );
  }
  function renderGrammarText(text, ctx) {
    const value = normalizeWhitespace(
      String(text || "").replace(/^[:\s]+/, ""),
    );
    if (!value) return "";
    overlayDebug(
      "detected grammar section source=" +
        String((ctx && ctx.sourceKind) || "generic"),
    );
    return (
      '<div class="grammar-row"><b>Grammar</b>: <span>' +
      escapeAndLinkifyText(value) +
      "</span></div>"
    );
  }
  const NONLEMMA_GRAMMAR_START =
    "(?:nominative|genitive|dative|accusative|ablative|vocative|instrumental|locative|ergative|absolutive|masculine|feminine|neuter|common|animate|inanimate|singular|plural|dual|definite|indefinite|comparative|superlative|infinitive|participle|present|past|preterite|imperfect|subjunctive|conditional|imperative|first|second|third)";
  const NONLEMMA_GRAMMAR_WORD_RE =
    /\b(?:nominative|genitive|dative|accusative|ablative|vocative|instrumental|locative|ergative|absolutive|masculine|feminine|neuter|common|singular|plural|dual|definite|indefinite|comparative|superlative|infinitive|participle|present|past|preterite|imperfect|subjunctive|conditional|imperative|first|second|third)\b/i;
  function containsWiktionaryPathFragment(text) {
    const withoutUrls = String(text || "").replace(
      /https?:\/\/[^\s<>"']+/gi,
      "",
    );
    return /(?:\b[a-z]{2,4}|[a-z])\/(?:languages|appendix|wiki|dictionary|thesaurus|wikipedia|wikisource)\b/i.test(
      withoutUrls,
    );
  }
  function isNonLemmaText(text, ctx) {
    const raw = String(text || "");
    if (!isWiktionaryLike(ctx) && !containsWiktionaryPathFragment(raw))
      return false;
    if (containsWiktionaryPathFragment(raw)) return true;
    if (
      /\b(?:non-lemma|nonlemma|form-of|inflection of|inflected form of|plural of|singular of|comparative of|superlative of|past participle of|present participle of|conjugation of|declension of)\b/i.test(
        raw,
      )
    )
      return true;
    const grammarHits =
      raw.match(new RegExp(NONLEMMA_GRAMMAR_START, "gi")) || [];
    return grammarHits.length >= 3 && !/\b(?:Etymology|Grammar)\b/i.test(raw);
  }
  function cleanupNonLemmaText(text) {
    const urls = [];
    let raw = String(text || "")
      .replace(/\r/g, "\n")
      .replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
        const token = "__IINATAN_URL_" + urls.length + "__";
        urls.push(url);
        return token;
      });
    raw = raw.replace(
      new RegExp(
        "(?:\\b[a-z]{2,4}|[a-z])\\/(?:languages|appendix|wiki|dictionary|thesaurus|wikipedia|wikisource)[A-Za-z0-9 _.-]*?(?=" +
          NONLEMMA_GRAMMAR_START +
          "\\b|$)",
        "gi",
      ),
      "",
    );
    raw = raw.replace(/([a-zà-öø-ÿ])([A-ZÀ-Ö])/g, "$1\n$2");
    raw = raw.replace(
      new RegExp(
        "\\b(singular|plural|dual|definite|indefinite|masculine|feminine|neuter|common)(?=" +
          NONLEMMA_GRAMMAR_START +
          "\\b)",
        "gi",
      ),
      "$1\n",
    );
    raw = raw.replace(
      /\b(non-lemma|form-of|inflection of|inflected form of|plural of|singular of|comparative of|superlative of|past participle of|present participle of|conjugation of|declension of)\b\s*:?\s*/gi,
      "\n$1: ",
    );
    return raw
      .split(/\n+/)
      .map((part) => {
        let restored = normalizeWhitespace(part);
        urls.forEach((url, index) => {
          restored = restored.replace("__IINATAN_URL_" + index + "__", url);
        });
        return restored;
      })
      .filter(Boolean);
  }
  function renderNonLemmaText(text, ctx) {
    if (!isNonLemmaText(text, ctx)) return "";
    const rows = cleanupNonLemmaText(text).filter(
      (part) => !containsWiktionaryPathFragment(part),
    );
    if (!rows.length) return "";
    overlayDebug(
      "detected non-lemma entry source=" +
        String((ctx && ctx.sourceKind) || "generic") +
        " rows=" +
        rows.length,
    );
    return rows
      .map((part) => {
        const label = NONLEMMA_GRAMMAR_WORD_RE.test(part)
          ? "Inflection"
          : "Definition";
        return (
          '<div class="nonlemma-row"><b>' +
          label +
          "</b>: <span>" +
          escapeAndLinkifyText(part) +
          "</span></div>"
        );
      })
      .join("");
  }
  function isWiktionaryNonLemmaGlossary(glossaryItem, ctx) {
    if (!isWiktionaryLike(ctx)) return false;
    const tags = normalizeWhitespace(
      String((glossaryItem && glossaryItem.definitionTags) || "") +
        " " +
        String((glossaryItem && glossaryItem.termTags) || ""),
    ).toLowerCase();
    return /\bnon[-\s]?lemma\b/.test(tags);
  }
  function wiktionaryPairTupleRows(parsed) {
    if (!Array.isArray(parsed) || !parsed.length) return [];
    function tupleScalar(value) {
      return (
        value == null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      );
    }
    const rows = [];
    for (let i = 0; i < parsed.length; i++) {
      const row = parsed[i];
      if (!Array.isArray(row) || row.length < 2) return [];
      if (!tupleScalar(row[0])) return [];
      const lemma = normalizeWhitespace(row[0]);
      const descriptions = Array.isArray(row[1]) ? row[1] : [row[1]];
      if (descriptions.some((description) => !tupleScalar(description)))
        return [];
      if (!lemma && !descriptions.length) return [];
      for (let j = 0; j < descriptions.length; j++) {
        const description = normalizeWhitespace(descriptions[j]);
        if (!lemma && !description) continue;
        rows.push({ lemma, description });
      }
    }
    return rows;
  }
  function renderWiktionaryPairTupleNonLemma(parsed, glossaryItem, ctx) {
    if (!isWiktionaryNonLemmaGlossary(glossaryItem, ctx)) return "";
    const rows = wiktionaryPairTupleRows(parsed);
    if (!rows.length) return "";
    overlayDebug(
      "detected Wiktionary tuple non-lemma dict=" +
        JSON.stringify((ctx && ctx.dictName) || "") +
        " rows=" +
        rows.length,
    );
    return (
      '<div class="nonlemma-list">' +
      rows
        .map(
          (row) =>
            '<div class="nonlemma-row"><b>Form of</b>: <span>' +
            (row.lemma
              ? '<span class="nonlemma-lemma">' +
                escapeHtml(row.lemma) +
                "</span>"
              : "") +
            (row.lemma && row.description
              ? '<span class="nonlemma-arrow"> - </span>'
              : "") +
            (row.description
              ? '<span class="nonlemma-desc">' +
                escapeHtml(row.description) +
                "</span>"
              : "") +
            "</span></div>",
        )
        .join("") +
      "</div>"
    );
  }
  function renderCollapsibleSection(label, bodyHtml, open, className) {
    const body = bodyHtml || "";
    if (!body) return "";
    const cls = className ? " " + className : "";
    return (
      '<details class="dict-details' +
      cls +
      '"' +
      (open ? " open" : "") +
      "><summary>" +
      escapeHtml(label || "Details") +
      '</summary><div class="details-body">' +
      body +
      "</div></details>"
    );
  }
  function renderEtymologyHtml(content, ctx, label) {
    const body = renderStructuredNode(content, ctx);
    if (!normalizeWhitespace(plainTextFromNode(content)) && !body) return "";
    overlayDebug(
      "detected etymology section source=" +
        String((ctx && ctx.sourceKind) || "generic") +
        " label=" +
        String(label || "Etymology"),
    );
    return renderCollapsibleSection(
      label || "Etymology",
      body,
      etymologyShouldOpen(ctx),
      "etymology-section",
    );
  }
  function renderEtymologyText(text, ctx, label) {
    const value = String(text || "")
      .replace(/^[:\s]+/, "")
      .trim();
    if (!value) return "";
    overlayDebug(
      "detected etymology section source=" +
        String((ctx && ctx.sourceKind) || "generic") +
        " label=" +
        String(label || "Etymology"),
    );
    return renderCollapsibleSection(
      label || "Etymology",
      '<div class="gloss">' +
        escapeAndLinkifyText(value).replace(/\n/g, "<br>") +
        "</div>",
      etymologyShouldOpen(ctx),
      "etymology-section",
    );
  }
  function renderDetailsNode(node, ctx) {
    const summary = detailsSummaryText(node);
    const body = detailsBody(node);
    if (isGrammarDetails(node)) return renderGrammarHtml(body, ctx);
    if (isEtymologyDetails(node))
      return renderEtymologyHtml(body, ctx, summary || "Etymology");
    const kind = nodeDataContent(node);
    const cls =
      /details-entry-examples/i.test(kind) ||
      /^(?:\d+\s+examples?|examples?|例文)/i.test(summary)
        ? "example-section"
        : "nested-details";
    return renderCollapsibleSection(
      summary,
      renderStructuredNode(body, ctx),
      false,
      cls,
    );
  }
  function renderBacklinkRow(node, ctx) {
    const linkNodes = findNodes(node, (n) => n && n.tag === "a");
    const links = linkNodes
      .map((n) => renderInlineNode(n, ctx))
      .filter(Boolean);
    const text = normalizeWhitespace(plainTextFromNode(node.content));
    const body = links.length ? links.join(" · ") : escapeAndLinkifyText(text);
    if (!body) return "";
    overlayDebug(
      "detected source/backlink row source=" +
        String((ctx && ctx.sourceKind) || "generic"),
    );
    return (
      '<div class="source-row"><span class="source-label">Source</span> ' +
      body +
      "</div>"
    );
  }
  function renderAttributionRow(node, ctx) {
    const linkNodes = findNodes(node, (n) => n && n.tag === "a");
    const links = linkNodes
      .map((n) => renderInlineNode(n, ctx))
      .filter(Boolean);
    const text = normalizeWhitespace(plainTextFromNode(node.content));
    const body = links.length ? links.join(" | ") : escapeAndLinkifyText(text);
    if (!body) return "";
    return '<div class="attribution-row">' + body + "</div>";
  }
  function isPriorityTag(label) {
    const cleaned = normalizeWhitespace(label).replace(/^[\u2605*]\s*/, "");
    return /^(priority[\s_-]*form|popular[\s_-]*form)$/i.test(cleaned);
  }
  function tagLabels(value) {
    const raw = String(value || "").trim();
    if (!raw) return [];
    if (isPriorityTag(raw)) return [raw];
    return raw
      .split(/[;,|]+/)
      .map((s) => normalizeWhitespace(s))
      .filter(Boolean);
  }
  function renderOneTag(label, kind) {
    if (isPriorityTag(label)) {
      return '<span class="tag-chip tag-priority" title="priority form" aria-label="priority form">&#9733;</span>';
    }
    return (
      '<span class="tag-chip tag-' +
      escapeHtml(kind || "tag") +
      '">' +
      escapeHtml(label) +
      "</span>"
    );
  }
  function renderTagChips(glossaryItem) {
    const tags = [];
    tagLabels(glossaryItem && glossaryItem.definitionTags).forEach((label) =>
      tags.push(renderOneTag(label, "definition")),
    );
    tagLabels(glossaryItem && glossaryItem.termTags).forEach((label) =>
      tags.push(renderOneTag(label, "term")),
    );
    return tags.length
      ? '<div class="tag-row">' + tags.join("") + "</div>"
      : "";
  }
  function shouldCleanupPlainWiktionary(text, ctx) {
    const raw = String(text || "");
    if (isWiktionaryLike(ctx)) return true;
    return (
      /\bGrammar\b[\s\S]{0,800}\bEtymology\b/i.test(raw) ||
      /^\s*(Grammar|Etymology)\b/i.test(raw)
    );
  }
  function renderPlainWiktionarySections(text, ctx) {
    let raw = String(text || "")
      .replace(/\r/g, "")
      .trim();
    const nonLemma = renderNonLemmaText(raw, ctx);
    if (nonLemma) return nonLemma;
    raw = raw.replace(/\bGrammar\s*(?=\{)/i, "Grammar: ");
    raw = raw.replace(/([}\]])\s*(Etymology)/gi, "$1\n$2");
    raw = raw.replace(/\b(Etymology)(?=Etymology\b)/gi, "$1\n");
    const re = /\b(Grammar|Etymology(?:\s+\d+)?)\b\s*:?\s*/gi;
    const matches = [];
    let match;
    while ((match = re.exec(raw)))
      matches.push({
        label: match[1],
        start: match.index,
        contentStart: re.lastIndex,
      });
    if (!matches.length)
      return (
        '<div class="gloss">' +
        escapeAndLinkifyText(raw).replace(/\n/g, "<br>") +
        "</div>"
      );
    let html = "";
    const before = raw.slice(0, matches[0].start).trim();
    if (before)
      html +=
        '<div class="gloss">' +
        escapeAndLinkifyText(before).replace(/\n/g, "<br>") +
        "</div>";
    matches.forEach((m, index) => {
      const end =
        index + 1 < matches.length ? matches[index + 1].start : raw.length;
      const content = raw.slice(m.contentStart, end).trim();
      if (/^grammar$/i.test(m.label)) html += renderGrammarText(content, ctx);
      else html += renderEtymologyText(content, ctx, m.label);
    });
    return html;
  }
  function renderPlainGlossaryText(raw, ctx) {
    const text = fallbackGlossaryText(raw);
    const nonLemma = renderNonLemmaText(text, ctx);
    if (nonLemma) return nonLemma;
    if (shouldCleanupPlainWiktionary(text, ctx))
      return renderPlainWiktionarySections(text, ctx);
    return (
      '<div class="gloss">' +
      escapeAndLinkifyText(text).replace(/\n/g, "<br>") +
      "</div>"
    );
  }
  function hasStructuredBlockContent(node) {
    return (
      findNodes(
        node && node.content,
        (n) => n && /^(div|details|ul|ol|table)$/i.test(String(n.tag || "")),
      ).length > 0
    );
  }
  function isSelfFramedMarker(text) {
    const value = String(text || "").trim();
    const enclosurePairs = {
      "（": "）",
      "［": "］",
      "【": "】",
      "〔": "〕",
      "〘": "〙",
      "〚": "〛",
      "〈": "〉",
      "《": "》",
    };
    return value.length >= 2 && enclosurePairs[value[0]] === value.at(-1);
  }
  function structuredPosClass(text) {
    return isSelfFramedMarker(text)
      ? "pos-pill self-framed-inline-chip"
      : "pos-pill";
  }
  function renderStructuredSpan(node, ctx) {
    const kind = nodeDataContent(node);
    const cls = nodeClassName(node);
    const data = nodeDataMap(node);
    const text = normalizeWhitespace(plainTextFromNode(node.content));
    const blocky = hasStructuredBlockContent(node);
    const body = blocky
      ? renderStructuredNode(node.content, ctx)
      : renderInlineNode(node.content, ctx);
    if (kind === "bold-text") return "<b>" + body + "</b>";
    if (kind === "example-keyword" || hasDataFlag(node, "spellout"))
      return '<span class="example-keyword">' + body + "</span>";
    if (kind === "tag") return renderOneTag(text, data.category || "tag");
    if (kind === "forms-label")
      return (
        '<span class="forms-label" title="' +
        escapeHtml(nodeTitle(node) || "forms") +
        '">' +
        escapeHtml(text || "forms") +
        "</span>"
      );
    if (
      hasDataFlag(node, "POS") ||
      hasDataFlag(node, "pos") ||
      hasDataFlag(node, "hinshi") ||
      kind === "part-of-speech-info"
    ) {
      const posClass = structuredPosClass(text);
      return (
        '<span class="' +
        posClass +
        '" title="' +
        escapeHtml(nodeTitle(node)) +
        '">' +
        body +
        "</span>"
      );
    }
    if (kind === "misc-info")
      return (
        '<span class="pos-pill misc-pill misc-' +
        escapeHtml(String(data.code || "info")) +
        '" title="' +
        escapeHtml(nodeTitle(node)) +
        '">' +
        body +
        "</span>"
      );
    if (hasDataFlag(node, "katsuyo"))
      return '<span class="grammar-inline">' + body + "</span>";
    if (
      hasDataFlag(node, "num") ||
      hasDataFlag(node, "bc") ||
      hasDataFlag(node, "rect") ||
      /(?:^|\s)(?:FM|gaiji)(?:\s|$)/i.test(cls)
    )
      return '<span class="sense-number">' + body + "</span>";
    if (hasDataFlag(node, "sup")) {
      const usageClass = isSelfFramedMarker(text)
        ? "usage-marker self-framed-inline-chip"
        : "usage-marker";
      return '<span class="' + usageClass + '">' + body + "</span>";
    }
    if (hasDataFlag(node, "logo") || hasDataFlag(node, "補足ロゴ"))
      return '<span class="section-label">' + body + "</span>";
    if (
      hasDataFlag(node, "ex") ||
      hasDataFlag(node, "ExG") ||
      hasDataFlag(node, "example")
    )
      return '<span class="dict-inline-example">' + body + "</span>";
    if (
      hasDataFlag(node, "headword") ||
      /(?:見出|headword|カナ|かな|表記)/.test(cls)
    )
      return '<span class="dict-headword-inline">' + body + "</span>";
    return body;
  }
  function renderExampleBox(node, ctx) {
    const jaNode = findNodes(
      node,
      (n) => n && n.data && n.data.content === "example-sentence-a",
    )[0];
    const enNode = findNodes(
      node,
      (n) => n && n.data && n.data.content === "example-sentence-b",
    )[0];
    const citeNode = findNodes(
      node,
      (n) => n && n.data && n.data.content === "example-sentence-c",
    )[0];
    const ja = jaNode ? renderInlineNode(jaNode.content, ctx) : "";
    const en = enNode ? renderInlineNode(enNode.content, ctx) : "";
    const cite = citeNode ? renderInlineNode(citeNode.content, ctx) : "";
    if (!ja && !en && !cite) return "";
    const primaryClass = en ? "example-ja" : "example-text";
    return (
      '<div class="example-card">' +
      (ja ? '<div class="' + primaryClass + '">' + ja + "</div>" : "") +
      (en ? '<div class="example-en">' + en + "</div>" : "") +
      (cite ? '<div class="example-cite">' + cite + "</div>" : "") +
      "</div>"
    );
  }
  function renderSenseNoteBox(node, ctx) {
    const labelNode = findNodes(
      node,
      (n) => n && n.data && n.data.content === "sense-note-label",
    )[0];
    const contentNode = findNodes(
      node,
      (n) => n && n.data && n.data.content === "sense-note-content",
    )[0];
    const label = labelNode ? renderInlineNode(labelNode.content, ctx) : "Note";
    const content = contentNode
      ? renderInlineNode(contentNode.content, ctx)
      : renderInlineNode(node.content, ctx);
    if (!content) return "";
    return (
      '<div class="note-card"><div class="note-label">' +
      (label || "Note") +
      '</div><div class="note-content">' +
      content +
      "</div></div>"
    );
  }
  function renderXrefBox(node, ctx) {
    const labelNode = findNodes(
      node,
      (n) => n && n.data && n.data.content === "reference-label",
    )[0];
    const glossNode = findNodes(
      node,
      (n) => n && n.data && n.data.content === "xref-glossary",
    )[0];
    const linkNodes = findNodes(node, (n) => n && n.tag === "a");
    const label = labelNode ? plainTextFromNode(labelNode.content) : "See also";
    const links = linkNodes
      .map((n) => renderInlineNode(n, ctx))
      .filter(Boolean);
    const gloss = glossNode ? renderInlineNode(glossNode.content, ctx) : "";
    if (!links.length && !gloss) return "";
    return (
      '<div class="xref-card">' +
      '<span class="xref-label">' +
      escapeHtml(label || "See also") +
      "</span>" +
      (links.length ? "<div>" + links.join(" · ") + "</div>" : "") +
      (gloss ? '<div class="xref-glossary">' + gloss + "</div>" : "") +
      "</div>"
    );
  }
  function renderListMarker(item) {
    const style = item && item.style ? item.style : {};
    const marker = normalizeWhitespace(
      String(style.listStyleType || "").replace(/^['"]|['"]$/g, ""),
    );
    return marker && marker !== "disc" && marker !== "decimal" ? marker : "";
  }
  function renderListNode(node, ctx, ordered, className) {
    const tag = ordered ? "ol" : "ul";
    const items = toArray(node.content);
    return (
      "<" +
      tag +
      ' class="glossary-list ' +
      className +
      '">' +
      items
        .map((item) => {
          const marker = renderListMarker(item);
          const content =
            item && typeof item === "object" && item.tag === "li"
              ? item.content
              : item;
          const body = renderStructuredNode(content, ctx);
          if (marker)
            return (
              '<li class="custom-marker"><span class="sense-number">' +
              escapeHtml(marker) +
              "</span>" +
              body +
              "</li>"
            );
          return "<li>" + body + "</li>";
        })
        .join("") +
      "</" +
      tag +
      ">"
    );
  }
  function renderGlossaryLinesNode(node, ctx) {
    const items = toArray(node.content)
      .map((item) => {
        const content =
          item && typeof item === "object" && item.tag === "li"
            ? item.content
            : item;
        return renderStructuredNode(content, ctx);
      })
      .filter(Boolean);
    return (
      '<div class="glossary-lines">' +
      items
        .map((html) => '<div class="glossary-line">' + html + "</div>")
        .join("") +
      "</div>"
    );
  }
  function formMarkerForCell(node) {
    const cls = nodeClassName(node);
    const title =
      nodeTitle(node) ||
      findNodes(node, (n) => !!nodeTitle(n)).map(nodeTitle)[0] ||
      "";
    const hay = (cls + " " + title).toLowerCase();
    if (/form-pri|high priority|priority/.test(hay))
      return {
        className: "form-pri",
        label: title || "high priority form",
        symbol: "&#9651;",
      };
    if (/form-rare|rare/.test(hay))
      return {
        className: "form-rare",
        label: title || "rarely used form",
        symbol: "&#9661;",
      };
    if (/form-out|archaic|obsolete|outdated/.test(hay))
      return {
        className: "form-out",
        label: title || "archaic or obsolete form",
        symbol: "&#21476;",
      };
    if (/form-invalid|invalid|not valid/.test(hay))
      return {
        className: "form-invalid",
        label: title || "invalid form/reading combination",
        symbol: "&#8709;",
      };
    if (/form-valid|valid form/.test(hay))
      return {
        className: "form-valid",
        label: title || "valid form/reading combination",
        symbol: "&#9671;",
      };
    return null;
  }
  function renderTableCell(node, ctx) {
    const tag = node.tag === "th" ? "th" : "td";
    const marker = formMarkerForCell(node);
    let body = marker
      ? '<span class="form-marker ' +
        marker.className +
        '" title="' +
        escapeHtml(marker.label) +
        '" aria-label="' +
        escapeHtml(marker.label) +
        '">' +
        marker.symbol +
        "</span>"
      : renderStructuredNode(node.content, ctx);
    if (!body && tag === "th") body = "&nbsp;";
    const cls = nodeClassName(node);
    const classAttr = cls ? ' class="' + escapeHtml(cls) + '"' : "";
    return "<" + tag + classAttr + ">" + body + "</" + tag + ">";
  }
  function renderTableNode(node, ctx) {
    return (
      '<table class="forms-table">' +
      toArray(node.content)
        .map((row) => renderStructuredNode(row, ctx))
        .join("") +
      "</table>"
    );
  }
  function renderFormsNode(node, ctx) {
    return (
      '<div class="forms-block">' +
      renderStructuredNode(node.content, ctx) +
      "</div>"
    );
  }
  function renderEntryIndexNode(node, ctx) {
    const items = toArray(node.content)
      .map((item) => {
        const content =
          item && typeof item === "object" && item.content !== undefined
            ? item.content
            : item;
        return normalizeWhitespace(plainTextFromNode(content))
          ? renderInlineNode(content, ctx)
          : "";
      })
      .filter(Boolean);
    if (!items.length) return "";
    return (
      '<div class="entry-index">' +
      items
        .map((html) => '<span class="entry-index-item">' + html + "</span>")
        .join("") +
      "</div>"
    );
  }
  function renderBlockNode(node, ctx) {
    const data = nodeDataMap(node);
    const kind = nodeDataContent(node);
    const cls = nodeClassName(node);
    if (hasDataFlag(node, "entry-index"))
      return renderEntryIndexNode(node, ctx);
    const body = renderStructuredNode(node.content, ctx);
    if (!body) return "";
    let outClass = "structured-block";
    if (kind === "preamble") outClass += " preamble-block";
    if (
      hasDataFlag(node, "head") ||
      hasDataFlag(node, "head2") ||
      hasDataFlag(node, "見出G")
    )
      outClass += " dictionary-head-block";
    if (
      hasDataFlag(node, "meaning") ||
      hasDataFlag(node, "level0") ||
      hasDataFlag(node, "level1") ||
      /(?:level|L3|no|MG|meaning)/.test(cls)
    )
      outClass += " meaning-block";
    if (
      hasDataFlag(node, "活用") ||
      hasDataFlag(node, "参考") ||
      hasDataFlag(node, "column") ||
      hasDataFlag(node, "コラム") ||
      hasDataFlag(node, "表現")
    )
      outClass += " info-block";
    if (hasDataFlag(node, "title2")) outClass += " subsection-title";
    if (kind === "extra-info") outClass += " extra-info";
    return '<div class="' + outClass + '">' + body + "</div>";
  }
  function renderStructuredNode(node, ctx) {
    if (node == null) return "";
    if (
      typeof node === "string" ||
      typeof node === "number" ||
      typeof node === "boolean"
    )
      return escapeHtml(String(node)).replace(/\n/g, "<br>");
    if (Array.isArray(node))
      return node.map((part) => renderStructuredNode(part, ctx)).join("");
    if (typeof node !== "object") return "";
    if (node.type === "structured-content")
      return renderStructuredNode(node.content, ctx);
    const tag = node.tag || "";
    const kind = nodeDataContent(node);
    const cls = nodeClassName(node);
    if (hasDataFlag(node, "entry-index"))
      return renderEntryIndexNode(node, ctx);
    if (kind === "attribution") return renderAttributionRow(node, ctx);
    if (tag === "details" || isGrammarDetails(node) || isEtymologyDetails(node))
      return renderDetailsNode(node, ctx);
    if (kind === "backlink") return renderBacklinkRow(node, ctx);
    if (kind === "tags")
      return (
        '<span class="inline-tag-row">' +
        renderStructuredNode(node.content, ctx) +
        "</span>"
      );
    if (kind === "tag")
      return renderOneTag(
        plainTextFromNode(node.content),
        nodeDataMap(node).category || "tag",
      );
    if (kind === "part-of-speech-info")
      return (
        '<span class="' +
        structuredPosClass(plainTextFromNode(node.content)) +
        '">' +
        escapeHtml(plainTextFromNode(node.content)) +
        "</span>"
      );
    if (kind === "misc-info") return renderStructuredSpan(node, ctx);
    if (
      (cls === "extra-box" && kind === "example-sentence") ||
      kind === "example-sentence"
    )
      return renderExampleBox(node, ctx);
    if (cls === "extra-box" && kind === "sense-note")
      return renderSenseNoteBox(node, ctx);
    if (cls === "extra-box" && kind === "xref") return renderXrefBox(node, ctx);
    if (kind === "sense-groups")
      return (
        '<div class="sense-groups">' +
        renderStructuredNode(node.content, ctx) +
        "</div>"
      );
    if (kind === "sense-group")
      return (
        '<div class="sense-group">' +
        renderStructuredNode(node.content, ctx) +
        "</div>"
      );
    if (kind === "sense")
      return (
        '<div class="sense-body">' +
        renderStructuredNode(node.content, ctx) +
        "</div>"
      );
    if (kind === "forms") return renderFormsNode(node, ctx);
    if (kind === "glossary" && (tag === "ul" || tag === "ol"))
      return renderGlossaryLinesNode(node, ctx);
    if (kind === "glosses" && (tag === "ul" || tag === "ol"))
      return renderListNode(node, ctx, true, "glosses-list");
    if (kind === "extra-info") return renderBlockNode(node, ctx);
    if (tag === "ruby") return renderRubyNode(node);
    if (tag === "rt") return "";
    if (tag === "br") return "<br>";
    if (tag === "a") return renderInlineNode(node, ctx);
    if (tag === "table") return renderTableNode(node, ctx);
    if (tag === "tr")
      return "<tr>" + renderStructuredNode(node.content, ctx) + "</tr>";
    if (tag === "th" || tag === "td") return renderTableCell(node, ctx);
    if (tag === "thead" || tag === "tbody")
      return renderStructuredNode(node.content, ctx);
    if (tag === "span") return renderStructuredSpan(node, ctx);
    if (tag === "ul") return renderListNode(node, ctx, false, "");
    if (tag === "ol") return renderListNode(node, ctx, true, "");
    if (tag === "li")
      return (
        '<div class="list-item-body">' +
        renderStructuredNode(node.content, ctx) +
        "</div>"
      );
    if (tag === "div") return renderBlockNode(node, ctx);
    return renderStructuredNode(node.content, ctx);
  }
  function renderGlossaryPayload(glossaryItem) {
    const parsed = parseGlossaryJson(glossaryItem && glossaryItem.glossary);
    const ctx = {
      dictName: String((glossaryItem && glossaryItem.dict) || ""),
      sourceKind: detectDictionarySource(glossaryItem, parsed),
    };
    if (ctx.sourceKind !== "generic" && overlayDebugEnabled())
      overlayDebug(
        "detected dictionary source/type dict=" +
          JSON.stringify(ctx.dictName) +
          " source=" +
          ctx.sourceKind,
      );
    const metaRow = renderTagChips(glossaryItem);
    if (!parsed) {
      return (
        metaRow +
        renderPlainGlossaryText(
          (glossaryItem && glossaryItem.glossary) || "",
          ctx,
        )
      );
    }
    const tupleNonLemma = renderWiktionaryPairTupleNonLemma(
      parsed,
      glossaryItem,
      ctx,
    );
    if (tupleNonLemma) return metaRow + tupleNonLemma;
    return metaRow + renderStructuredNode(parsed, ctx);
  }
  function splitJapaneseMoras(text) {
    const chars = Array.from(String(text || "").replace(/\s+/g, ""));
    const small =
      /[ゃゅょぁぃぅぇぉャュョァィゥェォㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ]/;
    const out = [];
    chars.forEach((ch) => {
      if (small.test(ch) && out.length) out[out.length - 1] += ch;
      else out.push(ch);
    });
    return out;
  }
  function pitchMoraClass(index, position) {
    const i = index + 1;
    if (position === 0) return i === 1 ? "pitch-low" : "pitch-high";
    if (i === 1) return position === 1 ? "pitch-high pitch-drop" : "pitch-low";
    if (i <= position)
      return "pitch-high" + (i === position ? " pitch-drop" : "");
    return "pitch-low";
  }
  function renderPitchPattern(reading, position) {
    const pos = Number(position);
    if (!Number.isFinite(pos)) return "";
    const moras = splitJapaneseMoras(reading);
    if (!moras.length)
      return (
        '<span class="pitch-number">[' + escapeHtml(String(pos)) + "]</span>"
      );
    return (
      '<span class="pitch-pattern" title="' +
      escapeHtml(String(reading) + " pitch " + String(pos)) +
      '"><span class="pitch-reading">' +
      moras
        .map(
          (mora, index) =>
            '<span class="pitch-mora ' +
            pitchMoraClass(index, pos) +
            '">' +
            escapeHtml(mora) +
            "</span>",
        )
        .join("") +
      '</span><span class="pitch-number">[' +
      escapeHtml(String(pos)) +
      "]</span></span>"
    );
  }
  function renderPitchMetadata(entry, term, options) {
    const dict = String(entry.dict || entry.dictName || entry.dictionary || "");
    const positions = Array.isArray(entry.positions)
      ? entry.positions
      : Array.isArray(entry.pitchPositions)
        ? entry.pitchPositions
        : Array.isArray(entry.pitch_positions)
          ? entry.pitch_positions
          : [];
    const transcriptions = Array.isArray(entry.transcriptions)
      ? entry.transcriptions
      : [];
    const reading = String(
      (term && term.reading) || (term && term.expression) || "",
    );
    const patterns = reading
      ? positions
          .slice(0, 4)
          .map((pos) => renderPitchPattern(reading, pos))
          .filter(Boolean)
      : [];
    const bits = [];
    if (!patterns.length && positions.length)
      bits.push(positions.map((v) => String(v)).join(", "));
    if (transcriptions.length)
      bits.push(
        transcriptions
          .map((v) => normalizeWhitespace(v))
          .filter(Boolean)
          .join(", "),
      );
    const display = patterns.length
      ? patterns.join("") +
        (positions.length > patterns.length
          ? '<span class="pitch-more">+' +
            escapeHtml(String(positions.length - patterns.length)) +
            "</span>"
          : "")
      : '<span class="pitch-text">' +
        escapeHtml(bits.filter(Boolean).join(" · ")) +
        "</span>";
    const titleDisplay = positions.length
      ? positions.map((v) => String(v)).join(", ")
      : bits.filter(Boolean).join(" · ");
    if (!dict && !display) return "";
    if (overlayDebugEnabled())
      overlayDebug(
        "pitch accent metadata detected dict=" +
          JSON.stringify(dict) +
          " positions=" +
          positions.length +
          " transcriptions=" +
          transcriptions.length,
      );
    const patternsHtml = '<span class="pitch-patterns">' + display + "</span>";
    if (options && options.prominent) {
      return (
        '<span class="primary-pitch" title="' +
        escapeHtml(
          (dict || "Pitch") + (titleDisplay ? " " + titleDisplay : ""),
        ) +
        '">' +
        patternsHtml +
        "</span>"
      );
    }
    return (
      '<span class="pitch-group" title="' +
      escapeHtml((dict || "Pitch") + (titleDisplay ? " " + titleDisplay : "")) +
      '"><span class="pitch-source-chip">' +
      escapeHtml(dict || "Pitch") +
      "</span>" +
      patternsHtml +
      "</span>"
    );
  }
  function renderPrimaryPitchMetadata(term) {
    const pitches = Array.isArray(term && term.pitches) ? term.pitches : [];
    return pitches.length
      ? renderPitchMetadata(pitches[0], term, { prominent: true })
      : "";
  }
  function renderEntryMetadata(term) {
    const chips = [];
    const frequencyChips = [];
    const frequencies = Array.isArray(term && term.frequencies)
      ? term.frequencies
      : [];
    frequencies.forEach((entry) => {
      const dict = String(
        entry.dict || entry.dictName || entry.dictionary || "",
      );
      const values = Array.isArray(entry.frequencies) ? entry.frequencies : [];
      const display = values
        .map((v) =>
          normalizeWhitespace(
            (v && (v.displayValue || v.display_value)) ||
              (v && v.value !== undefined ? String(v.value) : ""),
          ),
        )
        .filter(Boolean)
        .join(", ");
      if (!dict && !display) return;
      if (overlayDebugEnabled())
        overlayDebug(
          "frequency metadata detected dict=" +
            JSON.stringify(dict) +
            " values=" +
            values.length,
        );
      frequencyChips.push(
        '<span class="freq-chip" title="' +
          escapeHtml((dict || "Frequency") + (display ? " " + display : "")) +
          '"><span class="meta-label">' +
          escapeHtml(dict || "Frequency") +
          "</span>" +
          (display
            ? '<span class="freq-values">' + escapeHtml(display) + "</span>"
            : "") +
          "</span>",
      );
    });
    if (frequencyChips.length > 1) {
      const disclosureId =
        "freq-disclosure-" + String(++frequencyDisclosureSeq);
      chips.push(frequencyChips[0]);
      chips.push(
        '<input type="checkbox" class="freq-toggle-input" id="' +
          disclosureId +
          '"><label class="freq-toggle" data-clickable="true" for="' +
          disclosureId +
          '" title="Show or hide frequencies" aria-label="Show or hide frequencies"><span class="freq-toggle-icon" aria-hidden="true"></span></label>',
      );
      chips.push(
        frequencyChips
          .slice(1)
          .map((html) =>
            html.replace(
              'class="freq-chip"',
              'class="freq-chip freq-chip-extra"',
            ),
          )
          .join(""),
      );
    } else chips.push.apply(chips, frequencyChips);
    const pitches = Array.isArray(term && term.pitches) ? term.pitches : [];
    pitches.slice(1).forEach((entry) => {
      const pitchHtml = renderPitchMetadata(entry, term);
      if (pitchHtml) chips.push(pitchHtml);
    });
    return chips.length
      ? '<div class="entry-meta-row">' + chips.join("") + "</div>"
      : "";
  }
  function displayHeadwordForEntry(entry) {
    const term = entry && entry.term ? entry.term : {};
    return String(term.expression || entry.deinflected || entry.matched || "");
  }
  function displayReadingForTerm(term, headword) {
    const reading = normalizeWhitespace(
      term && term.reading !== undefined ? String(term.reading) : "",
    );
    const expression = normalizeWhitespace(
      headword !== undefined
        ? String(headword || "")
        : String((term && term.expression) || ""),
    );
    if (
      !reading ||
      (expression && compareTextKey(reading) === compareTextKey(expression))
    )
      return "";
    return reading;
  }
  function lookupSurfaceForResult(result, entry) {
    if (
      result &&
      /^(ja|zh)$/.test(String(result.language || "")) &&
      entry &&
      entry.matched
    )
      return String(entry.matched);
    const candidate =
      result && result.candidateUsed ? result.candidateUsed : null;
    if (candidate && candidate.displayText)
      return String(candidate.displayText);
    if (result && typeof result.text === "string") {
      const start = Number(result.lookupStart);
      const end = Number(result.lookupEnd);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        const surface = Array.from(result.text).slice(start, end).join("");
        if (surface) return surface;
      }
    }
    if (entry && entry.matched) return String(entry.matched);
    if (result && result.lookupText) return String(result.lookupText);
    return "";
  }
  function displayHeaderForResult(result, firstEntry) {
    const heading = displayHeadwordForEntry(firstEntry);
    const term = firstEntry && firstEntry.term ? firstEntry.term : {};
    const reading = displayReadingForTerm(term, heading);
    const surface = lookupSurfaceForResult(result, firstEntry);
    const secondary =
      surface && compareTextKey(surface) !== compareTextKey(heading)
        ? "looked up from: " + surface
        : "";
    if (overlayDebugEnabled())
      overlayDebug(
        "display headword selected heading=" +
          JSON.stringify(heading) +
          " surface=" +
          JSON.stringify(surface) +
          " secondary=" +
          JSON.stringify(secondary),
      );
    return { heading, reading, secondary };
  }
  function audioDataForEntry(entry) {
    if (!entry) return null;
    const term = entry.term || {};
    const expression = displayHeadwordForEntry(entry);
    if (!expression) return null;
    return { term: expression, reading: String(term.reading || "") };
  }
  function buildAnkiCardContext(stored, entry, header, allowCurrentMedia) {
    if (!ankiButtonVisibleForPopup() || !entry) return null;
    const result = stored && stored.result ? stored.result : {};
    const expression =
      (header && header.heading) || displayHeadwordForEntry(entry);
    const reading =
      (header && header.reading) ||
      displayReadingForTerm(entry.term || {}, expression);
    const surface = lookupSurfaceForResult(result, entry);
    const useCurrentMedia = allowCurrentMedia !== false;
    return {
      lineId: state.lineId,
      position:
        stored && stored.position !== undefined
          ? stored.position
          : state.currentPos,
      sentence: useCurrentMedia
        ? state.text || ""
        : String(result.text || "").trim(),
      allowCurrentMedia: useCurrentMedia,
      expression,
      heading: expression,
      reading,
      surface,
      entry,
      result: {
        text: result.text || (useCurrentMedia ? state.text : "") || "",
        language:
          result.language ||
          (state.config && state.config.lookupLanguage) ||
          "",
        lookupStart: result.lookupStart,
        lookupEnd: result.lookupEnd,
        lookupText: result.lookupText,
        candidateUsed: result.candidateUsed || null,
      },
    };
  }
  function registerAnkiCardContext(context) {
    if (!context) return null;
    const contextId =
      String(state.lineId) +
      ":" +
      String(
        context.position === undefined || context.position === null
          ? ""
          : context.position,
      ) +
      ":" +
      String(++state.ankiCardRequestSeq);
    state.ankiCardContexts[contextId] = context;
    return { contextId };
  }
  function maybeAutoPlayEntryAudio(stored, entry) {
    if (!state.config || !state.config.audioAutoPlay) return;
    const data = audioDataForEntry(entry);
    if (!data || !activeAudioSources().length) return;
    const key =
      String(state.lineId) +
      ":" +
      String(
        stored && stored.position !== undefined
          ? stored.position
          : state.currentPos,
      ) +
      ":" +
      audioTermReadingKey(data.term, data.reading);
    if (state.audioAutoPlayed[key]) return;
    state.audioAutoPlayed[key] = true;
    playAudioForTerm(data.term, data.reading, null, { auto: true }).catch(
      () => {},
    );
  }
  function renderStoredLookupInto(popup, stored, isRootPopup) {
    if (!stored || !stored.ok) {
      setPopupBodyFor(
        popup,
        '<div class="error">' +
          escapeHtml((stored && stored.error) || "Lookup failed") +
          "</div>",
      );
      return;
    }
    const result = stored.result || {};
    const entries = Array.isArray(result.results) ? result.results : [];
    if (!entries.length) {
      const lang = activeLanguage();
      const label =
        lang.lookupUnit === "word" ||
        lang.wordMode === "latin-word" ||
        lang.wordMode === "korean-run"
          ? "word"
          : "character";
      if (isRootPopup) activateNoResultMatch(stored);
      overlayDebug(
        "render no-result pos=" +
          String(state.currentPos) +
          " lookupStart=" +
          String(result.lookupStart) +
          " lookupEnd=" +
          String(result.lookupEnd) +
          " reason=" +
          String(result.noResultReason || "empty"),
      );
      setPopupBodyFor(
        popup,
        '<div class="empty">No dictionary entry found from this ' +
          label +
          ".</div>",
      );
      return;
    }
    const first = entries[0];
    const header = displayHeaderForResult(result, first);
    const headerPrimaryPitch = renderPrimaryPitchMetadata(first.term || {});
    const headerAudio = audioDataForEntry(first);
    const headerAnki = registerAnkiCardContext(
      buildAnkiCardContext(stored, first, header, isRootPopup),
    );
    if (
      isRootPopup &&
      state.currentPos !== null &&
      state.currentPos !== undefined
    ) {
      activateStoredMatch(stored, lookupPreviewForPosition(state.currentPos));
    }
    const maxEntries = Math.max(1, state.config.maxEntries || 3);
    const maxGlosses = Math.max(1, state.config.maxGlossesPerEntry || 4);
    let html = "";
    entries.slice(0, maxEntries).forEach((entry, entryIndex) => {
      const term = entry.term || {};
      html += '<div class="entry">';
      if (term.expression || term.reading) {
        const entryHeadword = displayHeadwordForEntry(entry);
        const entryReading = displayReadingForTerm(term, entryHeadword);
        const repeatsHeader =
          entryIndex === 0 &&
          compareTextKey(entryHeadword) === compareTextKey(header.heading) &&
          compareTextKey(entryReading) === compareTextKey(header.reading || "");
        if (!repeatsHeader) {
          const entryAudio = audioDataForEntry(entry);
          const entryAnki = registerAnkiCardContext(
            buildAnkiCardContext(stored, entry, null, isRootPopup),
          );
          const entryAudioHtml = entryAudio
            ? renderAudioButtonHtml(entryAudio.term, entryAudio.reading)
            : "";
          const entryAnkiHtml = entryAnki
            ? renderAnkiButtonHtml(entryAnki.contextId)
            : "";
          const entryActionHtml =
            entryAudioHtml || entryAnkiHtml
              ? '<span class="dict-term-actions">' +
                entryAnkiHtml +
                entryAudioHtml +
                "</span>"
              : "";
          html +=
            '<div class="dict-term' +
            (entryActionHtml ? " has-actions" : "") +
            '"><span class="dict-term-text">' +
            renderHeadwordStackHtml(entryHeadword, entryReading, {
              termClass: "dict-headword",
              readingClass: "dict-reading",
            }) +
            renderPrimaryPitchMetadata(term) +
            "</span>" +
            entryActionHtml +
            "</div>";
        }
      }
      html += renderEntryMetadata(term);
      const glossaries = Array.isArray(term.glossaries) ? term.glossaries : [];
      glossaries.slice(0, maxGlosses).forEach((g) => {
        html += '<div class="dict-section">';
        html += '<div class="dict-header">';
        if (g.dict)
          html += '<span class="dict-name">' + escapeHtml(g.dict) + "</span>";
        html += "</div>";
        html += renderGlossaryPayload(g);
        html += "</div>";
      });
      if (Array.isArray(entry.trace) && entry.trace.length)
        html +=
          '<div class="trace">' +
          escapeHtml(
            entry.trace
              .map((t) => t.name || "")
              .filter(Boolean)
              .join(" → "),
          ) +
          "</div>";
      html += "</div>";
    });
    setPopupBodyFor(
      popup,
      html,
      header.heading,
      header.reading,
      header.secondary,
      headerAudio,
      headerAnki,
      headerPrimaryPitch,
    );
    maybeAutoPlayEntryAudio(stored, first);
  }
  function renderStoredLookup(stored) {
    renderStoredLookupInto(popupEl, stored, true);
  }

  function installPopupPreviewApi() {
    if (!window.__IINATAN_POPUP_PREVIEW__) return;
    window.IINATAN_POPUP_PREVIEW_API = Object.freeze({
      applyConfig,
      renderLookup(payload) {
        if (!payload || !Array.isArray(payload.results))
          throw new Error("Preview lookup payload must contain results");
        const lookupString = String(payload.lookupString || "");
        const lookupLength = charsCount(lookupString);
        state.lineId++;
        state.text = lookupString;
        state.chars = Array.from(lookupString);
        state.currentPos = 0;
        state.currentAnchor = null;
        popupEl.innerHTML = '<div class="head"></div><div class="body"></div>';
        popupEl.classList.remove("hidden");
        renderStoredLookupInto(
          popupEl,
          {
            ok: payload.ok !== false,
            position: 0,
            result: Object.assign({}, payload, {
              language: "ja",
              text: lookupString,
              lookupText: lookupString,
              lookupStart: 0,
              lookupEnd: lookupLength,
            }),
          },
          true,
        );
        return {
          lookupString,
          resultCount: payload.results.length,
        };
      },
    });
  }
  installPopupPreviewApi();

  function updateCharReady(pos) {
    const run = findLookupRun(pos);
    const start =
      run && Number.isFinite(Number(run.start)) ? Number(run.start) : pos;
    const end =
      run && Number.isFinite(Number(run.end)) ? Number(run.end) : pos + 1;
    for (let i = start; i < end; i++) {
      const el = charElementAt(i);
      if (el) el.classList.add("ready");
    }
  }
  function formatElapsed(ms) {
    ms = Math.max(0, Number(ms) || 0);
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0
      ? String(m) + ":" + String(s).padStart(2, "0")
      : String(s) + "s";
  }

  function hideTaskPanel(delayMs) {
    if (state.taskTimer) {
      clearInterval(state.taskTimer);
      state.taskTimer = null;
    }
    const hide = () => {
      taskEl.classList.add("hidden");
      taskEl.innerHTML = "";
      state.task = null;
    };
    if (delayMs && delayMs > 0) setTimeout(hide, delayMs);
    else hide();
  }

  function renderTaskPanel() {
    const task = state.task;
    if (!task) {
      hideTaskPanel(0);
      return;
    }
    const elapsed = formatElapsed(
      Date.now() - (task.localStartedAt || Date.now()),
    );
    const cls = task.done ? (task.success ? "done" : "error") : "";
    taskEl.className = cls;
    taskEl.innerHTML =
      '<div class="task-head"><div class="task-title">' +
      escapeHtml(task.title || "Working…") +
      '</div><div class="task-elapsed">' +
      escapeHtml(elapsed) +
      "</div></div>" +
      '<div class="task-message">' +
      escapeHtml(task.message || "") +
      "</div>" +
      (task.detail
        ? '<div class="task-detail">' + escapeHtml(task.detail) + "</div>"
        : "") +
      '<div class="task-bar"><div class="task-fill"></div></div>';
  }

  function setTaskStatus(payload) {
    if (!payload) return;
    if (payload.active === false) {
      const existing = state.task || {};
      state.task = Object.assign({}, existing, payload, {
        done: true,
        title:
          existing.title ||
          payload.title ||
          (payload.success ? "Done" : "Failed"),
        message: payload.message || (payload.success ? "Done." : "Failed."),
        detail: payload.detail || existing.detail || "",
        localStartedAt: existing.localStartedAt || Date.now(),
      });
      renderTaskPanel();
      hideTaskPanel(payload.success ? payload.ttlMs || 6500 : 0);
      return;
    }
    const first = !state.task || state.task.id !== payload.id;
    state.task = Object.assign({}, first ? {} : state.task, payload, {
      done: false,
      localStartedAt: first
        ? Date.now()
        : state.task.localStartedAt || Date.now(),
    });
    renderTaskPanel();
    if (!state.taskTimer) {
      state.taskTimer = setInterval(renderTaskPanel, 1000);
    }
  }

  function setStatus(payload) {
    const msg = payload && payload.message ? String(payload.message) : "";
    if (state.statusClearTimer) {
      clearTimeout(state.statusClearTimer);
      state.statusClearTimer = null;
    }
    if (!msg) {
      statusEl.classList.add("hidden");
      statusEl.textContent = "";
      return;
    }
    statusEl.textContent = msg;
    statusEl.className =
      payload.kind === "error"
        ? "error"
        : payload.kind === "success"
          ? "success"
          : "";
    statusEl.classList.remove("hidden");
    const ttlMs = payload && Number(payload.ttlMs);
    if (Number.isFinite(ttlMs) && ttlMs > 0) {
      state.statusClearTimer = setTimeout(() => {
        state.statusClearTimer = null;
        if (statusEl.textContent !== msg) return;
        statusEl.classList.add("hidden");
        statusEl.textContent = "";
      }, ttlMs);
    }
  }
  function renderBitmapOcrStatus(payload) {
    const status = payload && typeof payload === "object" ? payload : null;
    state.bitmapOcrStatus = status;
    if (!bitmapOcrStatusEl) return;
    bitmapOcrStatusEl.className = "hidden";
    bitmapOcrStatusEl.textContent = "";
    bitmapOcrStatusEl.setAttribute("aria-label", "");
    bitmapOcrStatusEl.setAttribute("title", "");
    if (!state.enabled || !status || status.state !== "pending") return;
    if (status.state === "pending") {
      bitmapOcrStatusEl.textContent = "OCR";
      bitmapOcrStatusEl.setAttribute(
        "aria-label",
        "Recognizing bitmap subtitle",
      );
      bitmapOcrStatusEl.setAttribute("title", "Recognizing bitmap subtitle");
      bitmapOcrStatusEl.className = "pending";
    }
  }

  function updateAnkiCardState(payload) {
    const requestId = String((payload && payload.requestId) || "");
    if (!requestId) return;
    const popupSessionId =
      payload && payload.popupSessionId !== undefined
        ? String(payload.popupSessionId || "")
        : "";
    if (popupSessionId && popupSessionId !== state.popupSessionId) return;
    const isAck = !!(payload && payload.ack);
    if (isAck) {
      markPendingAnkiMessageAcked(requestId);
      return;
    }
    overlayDebug(
      "Anki request completed requestId=" +
        requestId +
        " state=" +
        String((payload && payload.state) || "unknown"),
    );
    const pending = state.pendingAnkiMessages[String(requestId || "")];
    const pendingType = pending && pending.type ? String(pending.type) : "";
    clearPendingAnkiMessage(requestId);
    let targetGroup = pending && pending.group ? pending.group : null;
    try {
      if (!targetGroup)
        allPopupContainers().some((popup) => {
          const groups = popup.querySelectorAll(".anki-action-group");
          for (let index = 0; index < groups.length; index++) {
            if (groups[index].dataset.ankiRequestId !== requestId) continue;
            targetGroup = groups[index];
            return true;
          }
          return false;
        });
    } catch (_) {}
    if (targetGroup) {
      if (payload && payload.state === "deferred") {
        setAnkiButtonState(targetGroup, {
          state: "checking",
          message: payload.message || "Waiting to check Anki...",
        });
        const retryCount = Math.max(
          0,
          Number(targetGroup.dataset.ankiStatusRetryCount) || 0,
        );
        const retryDelays = [300, 600, 1200, 1500];
        const retryDelay = Math.max(
          Number(payload.retryAfterMs) || 0,
          retryDelays[Math.min(retryCount, retryDelays.length - 1)],
        );
        targetGroup.dataset.ankiStatusRetryCount = String(retryCount + 1);
        targetGroup.dataset.ankiStatusRequested = "";
        requestAnkiCardStatus(targetGroup, retryDelay);
      } else if (payload && payload.ok === false && payload.staleNoteIds) {
        setAnkiButtonState(targetGroup, {
          state: "checking",
          message: "Refreshing Anki duplicate status...",
        });
        targetGroup.dataset.ankiStatusRequested = "";
        requestAnkiCardStatus(targetGroup, 300);
      } else if (
        payload &&
        payload.ok === false &&
        pending &&
        (pending.role === "force-add" || pending.type === "anki-card-open")
      ) {
        restoreAnkiGroupSnapshot(targetGroup, pending.snapshot);
      } else {
        targetGroup.dataset.ankiStatusRetryCount = "0";
        setAnkiButtonState(targetGroup, payload || {});
      }
    }
    if (
      payload &&
      payload.ok === false &&
      payload.message &&
      pendingType !== "anki-card-status"
    )
      setStatus({ message: payload.message, kind: "error", ttlMs: 8000 });
    else if (payload && payload.state === "added")
      setStatus({
        message: payload.message || "Added Anki card.",
        kind: "success",
        ttlMs: 2500,
      });
    else if (payload && payload.state === "opened")
      setStatus({
        message: payload.message || "Opened in Anki.",
        kind: "info",
        ttlMs: 2500,
      });
  }

  iina.onMessage("config", (payload) => applyConfig(payload));
  window.addEventListener("resize", () => {
    if (
      !state.enabled ||
      !state.config.experimentalNativeSubtitleHitLayer ||
      !nativeSubtitleHostEl
    )
      return;
    invalidateNativeSubtitleHitLayer("overlay-resize");
    try {
      iina.postMessage("native-layout-invalidated", {
        reason: "overlay-resize",
      });
    } catch (_) {}
  });
  if (typeof ResizeObserver === "function") {
    const nativeResizeObserver = new ResizeObserver(() => {
      if (
        !state.enabled ||
        !state.config.experimentalNativeSubtitleHitLayer ||
        !nativeSubtitleHostEl
      )
        return;
      invalidateNativeSubtitleHitLayer("overlay-resize");
      try {
        iina.postMessage("native-layout-invalidated", {
          reason: "overlay-resize",
        });
      } catch (_) {}
    });
    nativeResizeObserver.observe(document.documentElement);
  }
  iina.onMessage("native-layout-invalidate", (payload) => {
    if (!state.config.experimentalNativeSubtitleHitLayer) return;
    invalidateNativeSubtitleHitLayer(
      (payload && payload.reason) || "stale-layout",
    );
  });
  iina.onMessage("enabled", (payload) => {
    state.enabled = !!(payload && payload.enabled);
    if (!state.enabled) renderSubtitle("", state.lineId);
    else
      renderSubtitle(
        state.text,
        state.lineId,
        state.nativeDisplayText,
        state.nativeReason,
        state.nativeLookupSpans,
        state.nativeLayout,
        state.nativeSurfaces,
        state.bitmapOcrStatus,
      );
  });
  iina.onMessage("subtitle", (payload) => {
    if (payload && payload.config) applyConfig(payload.config);
    renderSubtitle(
      payload && payload.text ? payload.text : "",
      payload && payload.lineId ? payload.lineId : 0,
      payload && payload.displayText ? payload.displayText : "",
      payload && payload.nativeReason ? payload.nativeReason : "",
      payload && Array.isArray(payload.nativeLookupSpans)
        ? payload.nativeLookupSpans
        : [],
      payload && payload.nativeLayout ? payload.nativeLayout : null,
      payload && Array.isArray(payload.nativeSurfaces)
        ? payload.nativeSurfaces
        : [],
      payload && payload.bitmapOcrStatus ? payload.bitmapOcrStatus : null,
    );
  });
  iina.onMessage("line-lookup-reset", (payload) => {
    if (!payload || Number(payload.lineId || 0) === state.lineId) {
      state.lookupByPos = Object.create(null);
      state.progress = null;
      state.audioAutoPlayed = Object.create(null);
      state.ankiCardContexts = Object.create(null);
    }
  });
  iina.onMessage("line-lookup-progress", (payload) => {
    if (!payload || Number(payload.lineId || 0) !== state.lineId) return;
    state.progress = payload;
    if (payload.message && payload.ok === false)
      setStatus({ message: payload.message, kind: "error" });
  });
  iina.onMessage("lookup-request-ack", (payload) => {
    if (!payload || Number(payload.lineId || 0) !== state.lineId) return;
    const pos = Number(payload.position || 0);
    const req = state.pendingLookupRequests && state.pendingLookupRequests[pos];
    if (!req) return;
    req.acked = true;
    overlayDebug("lookup ack requestId=" + req.requestId + " pos=" + pos);
    if (req.retryTimer) {
      clearInterval(req.retryTimer);
      req.retryTimer = null;
    }
  });
  iina.onMessage("nested-lookup-ack", (payload) => {
    const requestId = String((payload && payload.requestId) || "");
    const req = state.pendingNestedLookupRequests[requestId];
    if (!req) return;
    req.acked = true;
    if (req.retryTimer) clearInterval(req.retryTimer);
    req.retryTimer = null;
  });
  iina.onMessage("audio-source-result", (payload) => {
    const requestId =
      payload && payload.requestId !== undefined
        ? String(payload.requestId)
        : "";
    const req = requestId ? state.pendingAudioSourceRequests[requestId] : null;
    if (!req || typeof req.finish !== "function") return;
    req.finish(payload || null);
  });

  iina.onMessage("line-lookup-result", (payload) => {
    if (!payload || Number(payload.lineId || 0) !== state.lineId) return;
    const pos = Number(payload.position || 0);
    if (state.pendingLookupTimers[pos]) {
      clearTimeout(state.pendingLookupTimers[pos]);
      delete state.pendingLookupTimers[pos];
    }
    cancelPendingLookupRequest(pos);
    overlayDebug(
      "lookup result received pos=" +
        pos +
        " ok=" +
        String(!!payload.ok) +
        " currentPos=" +
        String(state.currentPos) +
        " noResult=" +
        String(!!(payload.result && payload.result.noResult)),
    );
    state.lookupByPos[pos] = payload;
    updateCharReady(pos);
    if (state.currentPos === pos && !popupEl.classList.contains("hidden"))
      renderStoredLookup(payload);
  });
  iina.onMessage("nested-lookup-result", (payload) => {
    const requestId = String((payload && payload.requestId) || "");
    const req = state.pendingNestedLookupRequests[requestId];
    if (!req) return;
    cancelPendingNestedLookup(requestId);
    if (Number(payload.lineId || 0) !== state.lineId) return;
    const item = state.nestedPopups.find(
      (candidate) =>
        candidate.id === req.popupId && candidate.requestId === requestId,
    );
    if (!item) return;
    const stored = Object.assign({}, payload, {
      position:
        payload.position === undefined ? req.position : payload.position,
    });
    updateNestedPopupHighlight(item, stored, req.position);
    renderStoredLookupInto(item.element, stored, false);
  });
  iina.onMessage("status", setStatus);
  iina.onMessage("task-status", setTaskStatus);
  iina.onMessage("anki-card-state", updateAnkiCardState);

  document.addEventListener("click", (event) => {
    const menu = state.audioSourceMenu;
    if (!menu) return;
    if (nodeContains(menu, event && event.target)) return;
    hideAudioSourceMenu();
  });
  document.addEventListener("contextmenu", (event) => {
    const menu = state.audioSourceMenu;
    if (!menu) return;
    if (nodeContains(menu, event && event.target)) return;
    hideAudioSourceMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (!event || event.key !== "Escape") return;
    hideAudioSourceMenu();
    if (state.nestedPopups.length) {
      const deepest = state.nestedPopups[state.nestedPopups.length - 1];
      clearNestedPopups(Math.max(0, deepest.depth - 1));
    }
  });
  window.addEventListener("resize", () => {
    hideAudioSourceMenu();
    if (state.currentAnchor && !popupEl.classList.contains("hidden"))
      placePopup(state.currentAnchor);
    state.nestedPopups.forEach(placeNestedPopup);
  });

  // Keep the documented ready message, but v1.3.0 no longer depends on it.
  try {
    iina.postMessage("ready", {
      ready: true,
      popupSessionId: state.popupSessionId,
      at: Date.now(),
    });
  } catch (_) {}
})();
