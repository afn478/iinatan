(function () {
  const subtitleEl = document.getElementById('subtitle');
  const popupEl = document.getElementById('popup');
  const statusEl = document.getElementById('status');
  const taskEl = document.getElementById('task');

  const state = {
    enabled: false,
    text: '',
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
      popupTheme: 'inherit',
	      maxEntries: 3,
	      maxGlossesPerEntry: 4,
	      scanLength: 24,
	      audioAutoPlay: false,
	      audioSources: [],
	      etymologyCollapseDefault: 'collapsed',
	      wiktionaryEtymologyCollapseOverride: 'collapsed',
	      customPopupCss: '',
	      language: {
        id: 'ja',
        label: 'Japanese',
        lookupUnit: 'character',
        wordMode: 'rightward-prefix'
      },
      hoverRequestTimeoutMs: 15000,
	      debugLogVerbose: false
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
    popupSessionId: String(Date.now()) + '-' + Math.random().toString(36).slice(2),
    popupVisibilitySeq: 0,
    lookupRequestSeq: 0,
    audioPlaying: null,
    audioCache: Object.create(null),
    audioAutoPlayed: Object.create(null),
    pendingLookupTimers: Object.create(null),
    pendingLookupRequests: Object.create(null),
    charByPos: Object.create(null),
    task: null,
	    taskTimer: null
	  };
  const LOOKUP_RETRY_INTERVAL_MS = 60;
	  let customPopupStyleEl = null;
	  let lastCustomPopupCss = null;
	  let popupThemeHintQuery = null;
	  let popupThemeHintListenerRegistered = false;

	  function escapeHtml(s) {
	    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
	      .replace(/"/g, '&quot;')
	      .replace(/'/g, '&#39;');
	  }
	  function normalizeWhitespace(s) {
	    return String(s || '').replace(/\s+/g, ' ').trim();
	  }
	  function compareTextKey(s) {
	    const raw = normalizeWhitespace(s).toLowerCase();
	    try { return raw.normalize('NFKC'); } catch (_) { return raw; }
	  }
	  function safeExternalUrl(raw) {
	    const value = String(raw || '').trim();
	    if (!value || !/^https?:\/\//i.test(value)) {
	      if (value) overlayDebug("source URL rejected scheme=" + JSON.stringify(value.slice(0, 160)));
	      return '';
	    }
	    try {
	      if (typeof URL === 'function') {
	        const url = new URL(value);
	        if (url.protocol === 'http:' || url.protocol === 'https:') {
	          overlayDebug("source URL accepted=" + JSON.stringify(url.href.slice(0, 180)));
	          return url.href;
	        }
	      } else if (/^https?:\/\/[^\s<>"']+$/i.test(value)) {
	        overlayDebug("source URL accepted=" + JSON.stringify(value.slice(0, 180)));
	        return value;
	      }
	    } catch (_) {}
	    overlayDebug("source URL rejected invalid=" + JSON.stringify(value.slice(0, 160)));
	    return '';
	  }
	  function safeAudioUrl(raw, baseUrl) {
	    const value = String(raw || '').trim();
	    if (!value) return '';
	    try {
	      const url = typeof URL === 'function' ? new URL(value, baseUrl || undefined) : null;
	      if (url && (url.protocol === 'http:' || url.protocol === 'https:')) return url.href;
	    } catch (_) {}
	    if (!baseUrl && /^https?:\/\/[^\s<>"']+$/i.test(value)) return value;
	    return '';
	  }
	  function normalizeAudioSourceUrl(value) {
	    return safeAudioUrl(value, '');
	  }
	  function normalizeAudioSourceItem(source) {
	    const raw = typeof source === 'string' ? { url: source } : (source && typeof source === 'object' ? source : {});
	    const url = normalizeAudioSourceUrl(raw.url);
	    if (!url) return null;
	    const name = normalizeWhitespace(raw.name || '');
	    return name ? { name, url } : { url };
	  }
	  function normalizeAudioSources(value) {
	    let raw = value;
	    if (typeof raw === 'string') {
	      const text = raw.trim();
	      if (!text) return [];
	      try { raw = JSON.parse(text); } catch (_) { raw = text; }
	    }
	    if (raw && typeof raw === 'object' && Array.isArray(raw.audioSources)) raw = raw.audioSources;
	    const values = Array.isArray(raw) ? raw : (raw ? [raw] : []);
	    const seen = Object.create(null);
	    const out = [];
	    values.forEach(item => {
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
	  function audioSourcesSignature(sources) {
	    return JSON.stringify((sources || []).map(source => ({ name: source.name || '', url: source.url || '' })));
	  }
	  function audioLanguageCode() {
	    const lang = activeLanguage();
	    return String((lang && lang.id) || (state.config && state.config.lookupLanguage) || 'ja');
	  }
	  function audioTermReadingKey(term, reading) {
	    return JSON.stringify([String(term || ''), String(reading || '')]);
	  }
	  function audioCacheKey(term, reading, sources) {
	    return JSON.stringify([String(term || ''), String(reading || ''), audioLanguageCode(), audioSourcesSignature(sources || activeAudioSources())]);
	  }
	  function audioUrlFromTemplate(template, term, reading) {
	    const values = {
	      term: String(term || ''),
	      reading: String(reading || ''),
	      language: audioLanguageCode()
	    };
	    return String(template || '').replace(/\{([^}]*)\}/g, (match, key) => {
	      if (!Object.prototype.hasOwnProperty.call(values, key)) return match;
	      try { return encodeURIComponent(values[key]); } catch (_) { return values[key]; }
	    });
	  }
	  function parseAudioSourceListJson(value, sourceUrl) {
	    const data = value && typeof value === 'object' ? value : null;
	    if (!data || data.type !== 'audioSourceList' || !Array.isArray(data.audioSources)) return null;
	    const urls = [];
	    data.audioSources.forEach(item => {
	      const audioUrl = safeAudioUrl(item && item.url, sourceUrl);
	      if (audioUrl) urls.push({ url: audioUrl, name: normalizeWhitespace(item && item.name || '') });
	    });
	    return urls;
	  }
	  function fetchTextWithTimeout(url, timeoutMs) {
	    if (typeof fetch !== 'function') return Promise.reject(new Error('fetch unavailable'));
	    let timer = null;
	    let controller = null;
	    const init = { method: 'GET', cache: 'default', credentials: 'omit', redirect: 'follow' };
	    try {
	      if (typeof AbortController === 'function') {
	        controller = new AbortController();
	        init.signal = controller.signal;
	      }
	    } catch (_) {}
	    return Promise.race([
	      fetch(url, init).then(response => {
	        if (!response || !response.ok) throw new Error('audio source returned ' + String(response && response.status));
	        return response.text();
	      }),
	      new Promise((_, reject) => {
	        timer = setTimeout(() => {
	          try { if (controller) controller.abort(); } catch (_) {}
	          reject(new Error('audio source timed out'));
	        }, Math.max(1000, Number(timeoutMs) || 5000));
	      })
	    ]).finally(() => {
	      if (timer !== null) clearTimeout(timer);
	    });
	  }
	  function urlLooksLikeAudioFile(url) {
	    return /\.(?:mp3|m4a|aac|ogg|oga|opus|wav|webm)(?:[?#]|$)/i.test(String(url || ''));
	  }
	  async function resolveAudioCandidateUrls(source, term, reading) {
	    const sourceUrl = safeAudioUrl(audioUrlFromTemplate(source && source.url, term, reading), '');
	    if (!sourceUrl) return [];
	    if (urlLooksLikeAudioFile(sourceUrl)) return [{ url: sourceUrl, name: normalizeWhitespace(source && source.name || '') }];
	    try {
	      const text = await fetchTextWithTimeout(sourceUrl, Math.min(8000, Math.max(2500, Number(state.config.hoverRequestTimeoutMs || 5000))));
	      let parsed = null;
	      try { parsed = JSON.parse(text); } catch (_) {}
	      const jsonUrls = parseAudioSourceListJson(parsed, sourceUrl);
	      if (jsonUrls) {
	        overlayDebug("audio source JSON resolved url=" + JSON.stringify(sourceUrl) + " candidates=" + jsonUrls.length);
	        return jsonUrls;
	      }
	    } catch (error) {
	      overlayDebug("audio source JSON fetch failed url=" + JSON.stringify(sourceUrl) + " error=" + String(error && error.message ? error.message : error));
	    }
	    return [{ url: sourceUrl, name: normalizeWhitespace(source && source.name || '') }];
	  }
	  function waitForAudioData(audio, timeoutMs) {
	    return new Promise((resolve, reject) => {
	      let done = false;
	      let timer = null;
	      const cleanup = () => {
	        if (timer !== null) clearTimeout(timer);
	        try { audio.removeEventListener('loadeddata', onLoaded); } catch (_) {}
	        try { audio.removeEventListener('canplaythrough', onLoaded); } catch (_) {}
	        try { audio.removeEventListener('error', onError); } catch (_) {}
	        try { audio.removeEventListener('stalled', onError); } catch (_) {}
	      };
	      const finish = (ok, error) => {
	        if (done) return;
	        done = true;
	        cleanup();
	        if (ok) resolve();
	        else reject(error || new Error('audio unavailable'));
	      };
	      const onLoaded = () => finish(true);
	      const onError = () => finish(false, audio && audio.error ? audio.error : new Error('audio unavailable'));
	      timer = setTimeout(() => finish(false, new Error('audio timed out')), Math.max(1000, Number(timeoutMs) || 5000));
	      try { audio.addEventListener('loadeddata', onLoaded); } catch (_) {}
	      try { audio.addEventListener('canplaythrough', onLoaded); } catch (_) {}
	      try { audio.addEventListener('error', onError); } catch (_) {}
	      try { audio.addEventListener('stalled', onError); } catch (_) {}
	      try {
	        if (Number.isFinite(Number(audio.readyState)) && Number(audio.readyState) >= 2) finish(true);
	        else if (typeof audio.load === 'function') audio.load();
	      } catch (error) {
	        finish(false, error);
	      }
	    });
	  }
	  async function createPlayableAudio(url) {
	    if (typeof Audio !== 'function') throw new Error('Audio playback unavailable');
	    const audio = new Audio(url);
	    try { audio.preload = 'auto'; } catch (_) {}
	    await waitForAudioData(audio, Math.min(9000, Math.max(2500, Number(state.config.hoverRequestTimeoutMs || 5000))));
	    return audio;
	  }
	  function stopCurrentAudio() {
	    const audio = state.audioPlaying;
	    if (!audio) return;
	    try { audio.pause(); } catch (_) {}
	    state.audioPlaying = null;
	  }
	  function setAudioButtonsStateForKey(key, status, title) {
	    try {
	      popupEl.querySelectorAll('.audio-button').forEach(button => {
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
	    for (let sourceIndex = 0; sourceIndex < configuredSources.length; sourceIndex++) {
	      const source = configuredSources[sourceIndex];
	      const candidates = await resolveAudioCandidateUrls(source, term, reading);
	      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
	        const candidate = candidates[candidateIndex];
	        try {
	          const audio = await createPlayableAudio(candidate.url);
	          const sourceName = candidate.name || source.name || ('Source ' + String(sourceIndex + 1));
	          const result = { url: candidate.url, sourceIndex, candidateIndex, sourceName };
	          state.audioCache[cacheKey] = result;
	          return Object.assign({}, result, { audio });
	        } catch (error) {
	          overlayDebug("audio candidate failed url=" + JSON.stringify(candidate.url) + " error=" + String(error && error.message ? error.message : error));
	        }
	      }
	    }
	    return null;
	  }
	  async function playAudioForTerm(term, reading, button, options) {
	    term = String(term || '').trim();
	    reading = String(reading || '').trim();
	    const sources = activeAudioSources();
	    if (!term || !sources.length) return false;
	    const key = audioTermReadingKey(term, reading);
	    if (button) button.dataset.audioKey = key;
	    setAudioButtonsStateForKey(key, 'loading', 'Finding audio...');
	    try {
	      const result = await findPlayableAudio(term, reading, sources);
	      if (!result || !result.audio) {
	        setAudioButtonsStateForKey(key, 'missing', 'Could not find audio');
	        return false;
	      }
	      stopCurrentAudio();
	      const audio = result.audio;
	      try { audio.currentTime = 0; } catch (_) {}
	      try { audio.volume = 1; } catch (_) {}
	      state.audioPlaying = audio;
	      setAudioButtonsStateForKey(key, 'ready', 'Play audio\nFrom ' + String(result.sourceName || 'audio source'));
	      const playPromise = audio.play();
	      if (playPromise && typeof playPromise.then === 'function') {
	        await playPromise.catch(error => {
	          overlayDebug("audio play promise rejected " + String(error && error.message ? error.message : error));
	        });
	      }
	      return true;
	    } catch (error) {
	      overlayDebug("audio playback failed term=" + JSON.stringify(term) + " reading=" + JSON.stringify(reading) + " error=" + String(error && error.message ? error.message : error));
	      setAudioButtonsStateForKey(key, 'missing', 'Could not find audio');
	      return false;
	    } finally {
	      try {
	        if (button && button.dataset.audioState === 'loading') delete button.dataset.audioState;
	      } catch (_) {}
	    }
	  }
	  function nodeHref(node) {
	    if (!node || typeof node !== 'object') return '';
	    const data = node.data || {};
	    const attrs = node.attributes || node.attrs || {};
	    return node.href || node.url || data.href || data.url || attrs.href || attrs.url || '';
	  }
	  function externalLinkHtml(url, innerHtml) {
	    const safe = safeExternalUrl(url);
	    if (!safe) return '';
	    const body = innerHtml || escapeHtml(safe);
	    return '<a class="xref-link external-source-link" href="' + escapeHtml(safe) + '" data-external-url="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + body + '</a>';
	  }
	  function escapeAndLinkifyText(raw) {
	    const text = String(raw || '');
	    const re = /https?:\/\/[^\s<>"']+/gi;
	    let out = '';
	    let last = 0;
	    let match;
	    while ((match = re.exec(text))) {
	      out += escapeHtml(text.slice(last, match.index));
	      let url = match[0];
	      let trailing = '';
	      while (/[.,;:!?)\]}]$/.test(url)) {
	        trailing = url.slice(-1) + trailing;
	        url = url.slice(0, -1);
	      }
	      const safe = safeExternalUrl(url);
	      out += safe ? externalLinkHtml(safe, escapeHtml(url)) : escapeHtml(match[0]);
	      out += escapeHtml(trailing);
	      last = match.index + match[0].length;
	    }
	    out += escapeHtml(text.slice(last));
	    return out;
	  }
	  function applyCustomPopupCss(cssText) {
	    const css = String(cssText || '');
	    if (css === lastCustomPopupCss) return;
	    lastCustomPopupCss = css;
	    if (!css.trim()) {
	      if (customPopupStyleEl) customPopupStyleEl.textContent = '';
	      overlayDebug("custom popup CSS skipped empty");
	      return;
	    }
	    try {
	      if (!customPopupStyleEl) {
	        customPopupStyleEl = document.createElement('style');
	        customPopupStyleEl.id = 'iinatan-custom-popup-css';
	        const host = document.head || document.documentElement;
	        if (host && host.appendChild) host.appendChild(customPopupStyleEl);
	      }
	      customPopupStyleEl.textContent = css.slice(0, 50000);
	      overlayDebug("custom popup CSS applied bytes=" + String(customPopupStyleEl.textContent.length));
	    } catch (error) {
	      overlayDebug("custom popup CSS apply failed " + String(error && error.message ? error.message : error));
	    }
	  }
  function normalizePopupTheme(value) {
    const theme = String(value || '').trim().toLowerCase();
    if (theme === 'dark' || theme === 'light' || theme === 'inherit') return theme;
    return 'inherit';
  }
  function inheritedPopupThemeHint() {
    const configuredHint = String((state.config && state.config.popupThemeHint) || '').trim().toLowerCase();
    if (configuredHint === 'light' || configuredHint === 'dark') return configuredHint;
    try {
      if (window && typeof window.matchMedia === 'function') {
        const lightQuery = window.matchMedia('(prefers-color-scheme: light)');
        if (lightQuery && lightQuery.matches) return 'light';
        const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
        if (darkQuery && darkQuery.matches) return 'dark';
      }
    } catch (_) {}
    return 'dark';
  }
  function resolvePopupTheme(value) {
    const theme = normalizePopupTheme(value);
    return theme === 'inherit' ? inheritedPopupThemeHint() : theme;
  }
  function applyPopupTheme(value) {
    const requestedTheme = normalizePopupTheme(value);
    const theme = resolvePopupTheme(requestedTheme);
    const root = document.documentElement;
    if (!root) return;
    try {
      if (root.classList) {
        root.classList.remove('theme-dark', 'theme-light');
        root.classList.add('theme-' + theme);
      } else {
        const next = String(root.className || '')
          .replace(/\btheme-(?:dark|light)\b/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        root.className = (next ? next + ' ' : '') + 'theme-' + theme;
      }
      if (typeof root.setAttribute === 'function') {
        root.setAttribute('data-popup-theme', theme);
        root.setAttribute('data-popup-theme-requested', requestedTheme);
      } else {
        root.dataset = Object.assign(root.dataset || {}, { popupTheme: theme, popupThemeRequested: requestedTheme });
      }
    } catch (_) {}
  }
  function ensurePopupThemeHintListener() {
    if (popupThemeHintListenerRegistered) return;
    popupThemeHintListenerRegistered = true;
    try {
      if (!window || typeof window.matchMedia !== 'function') return;
      popupThemeHintQuery = window.matchMedia('(prefers-color-scheme: light)');
      if (!popupThemeHintQuery) return;
      const handler = function () {
        if (normalizePopupTheme(state.config && state.config.popupTheme) === 'inherit') applyPopupTheme('inherit');
      };
      if (typeof popupThemeHintQuery.addEventListener === 'function') popupThemeHintQuery.addEventListener('change', handler);
      else if (typeof popupThemeHintQuery.addListener === 'function') popupThemeHintQuery.addListener(handler);
    } catch (_) {}
  }
  function overlayDebug(message) {
    try {
      if (!state.config || state.config.debugLogVerbose === false) return;
      sendBridgeMessage({ type: 'overlay-log', message: String(message || ''), lineId: state.lineId, currentPos: state.currentPos, at: Date.now() });
    } catch (_) {}
    try { console.log('[iinatan overlay] ' + String(message || '')); } catch (_) {}
  }
  function flattenSubtitleText(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/\n+/g, ' ')
      .replace(/[ \t\f\v]{2,}/g, ' ')
      .trim();
  }

  function activeLanguage() {
    return state.config.language || { id: state.config.lookupLanguage || 'ja', wordMode: 'rightward-prefix' };
  }

  function isLookupableChar(ch) {
    const lang = activeLanguage();
    const s = String(ch || '');
    if (lang.wordMode === 'latin-word' || lang.id === 'en' || lang.id === 'fr' || lang.id === 'de') return /[A-Za-zÀ-ÖØ-öø-ÿ0-9'’ʼ＇‘‛\-‐‑‒–—]/.test(s);
    if (lang.id === 'ko') return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(s);
    if (lang.id === 'zh') return /[\u3400-\u9fff\uf900-\ufaff]/.test(s);
    return /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶー]/.test(s);
  }

  function findLookupRun(pos) {
    const lang = activeLanguage();
    const isWholeWordMode = lang.lookupUnit === 'word' || lang.wordMode === 'latin-word' || lang.wordMode === 'korean-run';
    if (!isWholeWordMode) return null;
    if (!state.chars.length || pos < 0 || pos >= state.chars.length || !isLookupableChar(state.chars[pos])) return null;
    let start = pos;
    let end = pos + 1;
    while (start > 0 && isLookupableChar(state.chars[start - 1])) start--;
    while (end < state.chars.length && isLookupableChar(state.chars[end])) end++;
    return { start, end, text: state.chars.slice(start, end).join('') };
  }

  function lookupPreviewForPosition(pos) {
    const run = findLookupRun(pos);
    if (run) return run;
    return { start: pos, end: Math.min(state.chars.length, pos + 1), text: state.chars.slice(pos, pos + 1).join('') };
  }

  function lookupUnitForPosition(pos) {
    const preview = lookupPreviewForPosition(pos);
    const run = findLookupRun(pos);
    const canonicalPos = run ? run.start : pos;
    return {
      pos: canonicalPos,
      key: run ? ('word:' + run.start + ':' + run.end + ':' + run.text) : ('char:' + canonicalPos),
      preview,
      isWord: !!run
    };
  }

  function lookupAnchorForUnit(unit, fallback) {
    if (unit && unit.isWord) {
      const el = charElementAt(unit.pos);
      if (el) return el;
    }
    return fallback || null;
  }

  function applyConfig(config) {
    const previousAudioSignature = audioSourcesSignature(activeAudioSources());
    state.config = Object.assign({}, state.config, config || {});
    state.config.popupTheme = normalizePopupTheme(state.config.popupTheme);
    state.config.audioSources = normalizeAudioSources(state.config.audioSources);
    if (previousAudioSignature !== audioSourcesSignature(state.config.audioSources)) {
      state.audioCache = Object.create(null);
    }
    ensurePopupThemeHintListener();
    applyPopupTheme(state.config.popupTheme);
    document.documentElement.style.setProperty('--subtitle-scale', String(state.config.fontScale || 1));
    document.documentElement.style.setProperty('--popup-scale', String(state.config.popupScale || 0.92));
    document.documentElement.style.setProperty('--popup-max-width', String(state.config.popupMaxWidth || 440) + 'px');
    if (state.config.subtitleFontFamily) document.documentElement.style.setProperty('--subtitle-font-family', String(state.config.subtitleFontFamily));
    if (state.config.subtitleFontSize) document.documentElement.style.setProperty('--subtitle-font-size', String(state.config.subtitleFontSize));
    if (state.config.subtitleFontWeight) document.documentElement.style.setProperty('--subtitle-font-weight', String(state.config.subtitleFontWeight));
    if (state.config.subtitleFontStyle) document.documentElement.style.setProperty('--subtitle-font-style', String(state.config.subtitleFontStyle));
    if (state.config.subtitleColor) document.documentElement.style.setProperty('--subtitle-color', String(state.config.subtitleColor));
    if (state.config.subtitleBorderColor) document.documentElement.style.setProperty('--subtitle-border-color', String(state.config.subtitleBorderColor));
	    if (state.config.subtitleOutlineWidth) document.documentElement.style.setProperty('--subtitle-outline-width', String(state.config.subtitleOutlineWidth));
	    if (state.config.subtitleShadowColor) document.documentElement.style.setProperty('--subtitle-shadow-color', String(state.config.subtitleShadowColor));
	    if (state.config.subtitleShadowOffset) document.documentElement.style.setProperty('--subtitle-shadow-offset', String(state.config.subtitleShadowOffset));
	    if (state.config.subtitleShadowBlur) document.documentElement.style.setProperty('--subtitle-shadow-blur', String(state.config.subtitleShadowBlur));
	    applyCustomPopupCss(state.config.customPopupCss || '');
	    if (state.config.overlayBridgePort) {
	      state.bridgePort = Number(state.config.overlayBridgePort);
	      ensureBridgeSocket();
	    }
	    overlayDebug("config applied bridgePort=" + String(state.bridgePort) + " popupScale=" + String(state.config.popupScale) + " popupTheme=" + String(state.config.popupTheme || "inherit") + " etymologyCollapseDefault=" + String(state.config.etymologyCollapseDefault || "collapsed") + " wiktionaryOverride=" + String(state.config.wiktionaryEtymologyCollapseOverride || "inherit"));
	  }

  function renderSubtitle(text, lineId) {
    state.text = flattenSubtitleText(text);
    overlayDebug("renderSubtitle lineId=" + state.lineId + " chars=" + Array.from(state.text || '').length + " text=" + JSON.stringify(String(state.text || '').slice(0, 80)));
    state.chars = Array.from(state.text);
    state.lineId = Number(lineId || 0);
    Object.keys(state.pendingLookupTimers || {}).forEach(k => clearTimeout(state.pendingLookupTimers[k]));
    Object.keys(state.pendingLookupRequests || {}).forEach(k => cancelPendingLookupRequest(k));
    state.pendingLookupTimers = Object.create(null);
    state.pendingLookupRequests = Object.create(null);
    state.charByPos = Object.create(null);
    state.lookupByPos = Object.create(null);
    state.audioAutoPlayed = Object.create(null);
    state.progress = null;
    state.currentPos = null;
    state.activeMatchStart = null;
    state.activeMatchLength = 0;
    subtitleEl.textContent = '';
    if (!state.enabled || !state.text) {
      subtitleEl.classList.add('hidden');
      hidePopup();
      return;
    }
    subtitleEl.classList.remove('hidden');
    const frag = document.createDocumentFragment();
    for (let i = 0; i < state.chars.length; i++) {
      const ch = state.chars[i];
      if (ch === '\n') { frag.appendChild(document.createTextNode(' ')); continue; }
      if (/\s/.test(ch)) { frag.appendChild(document.createTextNode(' ')); continue; }
      const span = document.createElement('span');
      const lookupable = isLookupableChar(ch);
      span.className = 'char ' + (lookupable ? 'lookupable' : 'nonlookup');
      span.textContent = ch;
      if (lookupable) {
        span.setAttribute('data-clickable', 'true');
        span.dataset.pos = String(i);
        state.charByPos[i] = span;
        span.addEventListener('mouseenter', onCharEnter);
        span.addEventListener('click', onCharEnter);
        span.addEventListener('mouseleave', scheduleHidePopup);
      }
      frag.appendChild(span);
    }
    subtitleEl.appendChild(frag);
  }

  function removeMatchBackgrounds() {
    subtitleEl.querySelectorAll('.match-bg').forEach(el => el.remove());
  }

  function clearActiveMatch() {
    subtitleEl.querySelectorAll('.char.active-match').forEach(el => {
      el.classList.remove('active-match');
    });
    removeMatchBackgrounds();
    state.activeMatchStart = null;
    state.activeMatchLength = 0;
  }

  function charsCount(s) { return Array.from(String(s || '')).length; }

  function topMatchedText(stored) {
    const result = stored && stored.result ? stored.result : {};
    const entries = Array.isArray(result.results) ? result.results : [];
    const first = entries[0] || {};
    return String(first.matched || (first.term && first.term.expression) || '');
  }

  function lookupMatchLength(stored) {
    const matched = topMatchedText(stored);
    return Math.max(1, charsCount(matched || ''));
  }

  function resultMatchStart(stored, fallback) {
    const result = stored && stored.result ? stored.result : {};
    const n = Number(result.matchStart);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
  }

  function activateStoredMatch(stored, preview) {
    const fallbackStart = preview && Number.isFinite(Number(preview.start)) ? Number(preview.start) : (state.currentPos || 0);
    const start = resultMatchStart(stored, fallbackStart);
    const matched = topMatchedText(stored) || (preview && preview.text) || '';
    activateMatchRange(start, matched);
  }
  function activateNoResultMatch(stored) {
    const result = stored && stored.result ? stored.result : {};
    const fallback = lookupPreviewForPosition(state.currentPos || 0);
    const start = Number.isFinite(Number(result.lookupStart)) ? Number(result.lookupStart) : fallback.start;
    const end = Number.isFinite(Number(result.lookupEnd)) ? Number(result.lookupEnd) : fallback.end;
    const text = state.chars.slice(start, Math.max(start + 1, end)).join('') || fallback.text || '';
    activateMatchRange(start, text);
  }

  // Deliberately do not reuse cached lookup results across later character
  // positions. HoshiDicts/Yomitan lookup is rightward-prefix based, but the
  // returned "matched" surface may include enough context that broad range
  // reuse can show an earlier word when hovering a later word.
  function addMatchBackgroundForRects(rects) {
    const subRect = subtitleEl.getBoundingClientRect();
    const groups = [];
    rects.forEach(rect => {
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      let group = groups.find(g => Math.abs(g.top - rect.top) < Math.max(3, rect.height * 0.35));
      if (!group) {
        group = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
        groups.push(group);
      } else {
        group.top = Math.min(group.top, rect.top);
        group.bottom = Math.max(group.bottom, rect.bottom);
        group.left = Math.min(group.left, rect.left);
        group.right = Math.max(group.right, rect.right);
      }
    });
    groups.forEach(g => {
      const bg = document.createElement('span');
      bg.className = 'match-bg';
      bg.style.left = (g.left - subRect.left - 5) + 'px';
      bg.style.top = (g.top - subRect.top - 3) + 'px';
      bg.style.width = Math.max(1, g.right - g.left + 10) + 'px';
      bg.style.height = Math.max(1, g.bottom - g.top + 6) + 'px';
      subtitleEl.insertBefore(bg, subtitleEl.firstChild);
    });
  }

  function activateMatchRange(start, matchedText) {
    clearActiveMatch();
    const len = Math.max(1, charsCount(matchedText));
    state.activeMatchStart = start;
    state.activeMatchLength = len;
    const rects = [];
    for (let i = 0; i < len; i++) {
      const el = charElementAt(start + i);
      if (!el) continue;
      el.classList.add('active-match');
      const r = el.getBoundingClientRect();
      rects.push(r);
    }
    addMatchBackgroundForRects(rects);
  }

  function onCharEnter(ev) {
    if (state.hideTimer) clearTimeout(state.hideTimer);
    const target = ev.currentTarget;
    const rawPos = Number(target.dataset.pos || 0);
    const unit = lookupUnitForPosition(rawPos);
    const pos = unit.pos;
    const preview = unit.preview;
    const anchor = lookupAnchorForUnit(unit, target);
    const sameUnitVisible = state.currentPos === pos && !popupEl.classList.contains('hidden');
    overlayDebug("char enter rawPos=" + rawPos + " unitPos=" + pos + " unitKey=" + unit.key + " word=" + String(unit.isWord) + " char=" + JSON.stringify(target.textContent || "") + " cached=" + String(!!state.lookupByPos[pos]));
    state.currentPos = pos;
    const stored = state.lookupByPos[pos];
    if (sameUnitVisible) {
      if (stored) renderStoredLookup(stored);
      else activateMatchRange(preview.start, preview.text || anchor.textContent || '');
      return;
    }
    if (stored) {
      activateStoredMatch(stored, preview);
      showPopup(anchor, preview.text, '<div class="loading">Rendering…</div>');
      renderStoredLookup(stored);
      return;
    }
    activateMatchRange(preview.start, preview.text || anchor.textContent || '');
    requestLookupFromPlugin(pos);
    showPopup(anchor, preview.text, '<div class="loading">' + escapeHtml('Looking up…') + '</div>');
  }

	  function scheduleHidePopup() {
	    if (state.hideTimer) clearTimeout(state.hideTimer);
	    state.hideTimer = setTimeout(() => hidePopup(), 240);
	  }
	  function closestExternalLink(target) {
	    let el = target;
	    while (el && el !== popupEl) {
	      if (el.getAttribute && el.getAttribute('data-external-url')) return el;
	      el = el.parentNode;
	    }
	    return null;
	  }
	  function onPopupClick(ev) {
	    const link = closestExternalLink(ev.target);
	    if (!link) return;
	    const url = safeExternalUrl(link.getAttribute('data-external-url') || link.getAttribute('href') || '');
	    ev.preventDefault();
	    ev.stopPropagation();
	    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
	    if (!url) {
	      overlayDebug("source link click rejected");
	      return;
	    }
	    const sent = sendBridgeMessage({ type: 'open-url', url, at: Date.now() });
	    try { iina.postMessage('open-external-url', { url }); } catch (_) {}
	    overlayDebug("source link click url=" + JSON.stringify(url.slice(0, 180)) + " bridgeSent=" + String(sent));
	  }
	  popupEl.addEventListener('mouseenter', () => { if (state.hideTimer) clearTimeout(state.hideTimer); });
	  popupEl.addEventListener('mouseleave', scheduleHidePopup);
	  popupEl.addEventListener('click', onPopupClick, true);
  function trapPopupWheel(ev) {
    if (popupEl.classList.contains('hidden')) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    const dx = Number(ev.deltaX || 0);
    const dy = Number(ev.deltaY || 0);
    // Manually scroll so the gesture is consumed by the overlay instead of being
    // interpreted by IINA as seek/fast-forward.
    if (Math.abs(dy) >= Math.abs(dx)) popupEl.scrollTop += dy;
    else popupEl.scrollLeft += dx;
  }
  popupEl.addEventListener('wheel', trapPopupWheel, { passive: false, capture: true });
  popupEl.addEventListener('mousewheel', trapPopupWheel, { passive: false, capture: true });
  popupEl.addEventListener('DOMMouseScroll', trapPopupWheel, { passive: false, capture: true });
  document.addEventListener('wheel', ev => {
    if (!popupEl.classList.contains('hidden')) {
      const path = ev.composedPath ? ev.composedPath() : [];
      if (path.includes(popupEl)) trapPopupWheel(ev);
    }
  }, { passive: false, capture: true });
  function ensureBridgeSocket() {
    if (!state.bridgePort) return;
    if (state.bridgeSocket && (state.bridgeSocket.readyState === WebSocket.OPEN || state.bridgeSocket.readyState === WebSocket.CONNECTING)) return;
    try {
      const socket = new WebSocket('ws://127.0.0.1:' + String(state.bridgePort) + '/overlay');
      state.bridgeSocket = socket;
      socket.onopen = () => {
        overlayDebug("bridge socket open");
        try { socket.send(JSON.stringify({ type: 'hello', source: 'overlay' })); } catch (_) {}
        if (state.lookupPopupVisible) {
          if (state.currentPos !== null && state.currentPos !== undefined && !state.lookupByPos[state.currentPos] && !state.pendingLookupRequests[state.currentPos]) {
            requestLookupFromPlugin(state.currentPos);
          }
          flushPendingLookupRequests();
          sendBridgePopupVisibility(true);
        }
      };
      socket.onclose = () => {
        try { console.log('[iinatan overlay] bridge socket close'); } catch (_) {}
        if (state.bridgeSocket === socket) state.bridgeSocket = null;
        if (state.bridgeReconnectTimer) clearTimeout(state.bridgeReconnectTimer);
        state.bridgeReconnectTimer = setTimeout(() => {
          state.bridgeReconnectTimer = null;
          ensureBridgeSocket();
        }, 700);
      };
      socket.onerror = () => {
        try { console.log('[iinatan overlay] bridge socket error'); } catch (_) {}
        try { socket.close(); } catch (_) {}
      };
    } catch (_) {}
  }

  function sendBridgeMessage(payload) {
    ensureBridgeSocket();
    const socket = state.bridgeSocket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify(payload)); return true; } catch (error) { try { console.log('[iinatan overlay] bridge send failed ' + String(error)); } catch (_) {} }
    }
    return false;
  }

  function sendBridgePopupVisibility(visible) {
    return sendBridgeMessage({
      type: 'popup',
      visible: !!visible,
      seq: state.popupVisibilitySeq,
      popupSessionId: state.popupSessionId,
      at: Date.now()
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
    Object.keys(state.pendingLookupRequests || {}).forEach(k => {
      if (String(k) !== String(keepPos)) cancelPendingLookupRequest(k);
    });
    Object.keys(state.pendingLookupTimers || {}).forEach(k => {
      if (String(k) !== String(keepPos)) {
        clearTimeout(state.pendingLookupTimers[k]);
        delete state.pendingLookupTimers[k];
      }
    });
  }

  function sendLookupRequestPayload(req) {
    return sendBridgeMessage({
      type: 'lookup',
      requestId: req.requestId,
      lineId: req.lineId,
      position: req.pos,
      at: Date.now(),
      attempt: req.attempts
    });
  }

  function lookupRequestIsCurrent(req) {
    if (!req) return false;
    const pos = req.pos;
    return !!state.pendingLookupRequests[pos] &&
      state.pendingLookupRequests[pos] === req &&
      !req.sent &&
      !state.lookupByPos[pos] &&
      state.currentPos === pos &&
      state.lineId === req.lineId;
  }

  function trySendLookupRequest(req) {
    if (!lookupRequestIsCurrent(req)) {
      if (req && !req.sent) cancelPendingLookupRequest(req.pos);
      return false;
    }
    req.attempts++;
    overlayDebug("lookup send attempt requestId=" + req.requestId + " pos=" + req.pos + " attempt=" + req.attempts);
    req.sent = sendLookupRequestPayload(req);
    if (req.sent && req.retryTimer) {
      clearInterval(req.retryTimer);
      req.retryTimer = null;
    }
    return req.sent;
  }

  function flushPendingLookupRequests() {
    Object.keys(state.pendingLookupRequests || {}).forEach(key => {
      const req = state.pendingLookupRequests[key];
      if (req && !req.sent) trySendLookupRequest(req);
    });
  }

  function requestLookupFromPlugin(pos) {
    overlayDebug("requestLookupFromPlugin pos=" + String(pos) + " lineId=" + state.lineId + " hasCached=" + String(!!state.lookupByPos[pos]));
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
      timeoutTimer: null
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

    req.timeoutTimer = setTimeout(() => {
      cancelPendingLookupRequest(pos);
      if (!state.lookupByPos[pos] && state.currentPos === pos && state.lineId === req.lineId && !popupEl.classList.contains('hidden')) {
        setPopupBody('<div class="error">Lookup timed out. Move off the word and hover again to retry.</div>');
      }
    }, Math.max(5000, Number(state.config.hoverRequestTimeoutMs || 9000)));
  }

  function postLookupPopupVisibility(visible) {
    const bridgeSent = sendBridgePopupVisibility(visible);
    if (!bridgeSent) {
      try { iina.postMessage('lookup-popup-visibility', visible ? 'show' : 'hide'); } catch (_) {}
      try { iina.postMessage('lookup-popup-visible', { visible: !!visible, seq: state.popupVisibilitySeq, popupSessionId: state.popupSessionId, at: Date.now() }); } catch (_) {}
    }
  }
  function setLookupPopupVisibility(visible) {
    visible = !!visible;
    overlayDebug("popup visibility set visible=" + String(visible) + " current=" + String(state.lookupPopupVisible) + " pos=" + String(state.currentPos));
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
    setLookupPopupVisibility(false);
    popupEl.classList.add('hidden');
    state.currentPos = null;
    state.currentAnchor = null;
    Object.keys(state.pendingLookupTimers || {}).forEach(k => clearTimeout(state.pendingLookupTimers[k]));
    Object.keys(state.pendingLookupRequests || {}).forEach(k => cancelPendingLookupRequest(k));
    state.pendingLookupTimers = Object.create(null);
    state.pendingLookupRequests = Object.create(null);
    clearActiveMatch();
  }

	  function renderAudioButtonHtml(term, reading) {
	    const audioTerm = String(term || '').trim();
	    if (!audioTerm || !activeAudioSources().length) return '';
	    const audioReading = String(reading || '').trim();
	    const key = audioTermReadingKey(audioTerm, audioReading);
	    return '<button type="button" class="audio-button" data-audio-key="' + escapeHtml(key) + '" data-audio-term="' + escapeHtml(audioTerm) + '" data-audio-reading="' + escapeHtml(audioReading) + '" title="Play audio" aria-label="Play audio"><span class="audio-icon" aria-hidden="true"></span></button>';
	  }
	  function bindPopupAudioButtons() {
	    try {
	      popupEl.querySelectorAll('.audio-button').forEach(button => {
	        if (button.dataset.audioBound === 'true') return;
	        button.dataset.audioBound = 'true';
	        button.addEventListener('click', event => {
	          try { event.preventDefault(); event.stopPropagation(); } catch (_) {}
	          playAudioForTerm(button.dataset.audioTerm || '', button.dataset.audioReading || '', button, { userGesture: true }).catch(() => {});
	        });
	      });
	    } catch (_) {}
	  }
	  function renderPopupHead(heading, reading, secondaryText, audioData) {
	    const audioHtml = audioData ? renderAudioButtonHtml(audioData.term, audioData.reading) : '';
	    return '<div class="head-main"><div class="head-title"><span class="term">' + escapeHtml(heading || '') + '</span>' +
	      (reading ? '<span class="reading">' + escapeHtml(reading) + '</span>' : '') + '</div>' +
	      audioHtml + '</div>' +
	      (secondaryText ? '<div class="lookup-source">' + escapeHtml(secondaryText) + '</div>' : '');
	  }
	  function showPopup(anchor, heading, bodyHtml) {
	    state.currentAnchor = anchor || null;
	    popupEl.innerHTML = '<div class="head">' + renderPopupHead(heading || '', '', '', null) + '</div><div class="body">' + bodyHtml + '</div>';
	    markPopupClickable();
	    popupEl.classList.remove('hidden');
	    setLookupPopupVisibility(true);
	    placePopup(anchor);
	  }
	  function setPopupBody(bodyHtml, heading, reading, secondaryText, audioData) {
	    const head = popupEl.querySelector('.head');
	    const body = popupEl.querySelector('.body');
	    if (head && heading !== undefined) {
	      head.innerHTML = renderPopupHead(heading || '', reading || '', secondaryText || '', audioData || null);
	    }
    if (body) body.innerHTML = bodyHtml;
    markPopupClickable();
    bindPopupAudioButtons();
    if (state.currentAnchor && !popupEl.classList.contains('hidden')) placePopup(state.currentAnchor);
  }
  function markPopupClickable() {
    popupEl.setAttribute('data-clickable', 'true');
    popupEl.querySelectorAll('*').forEach(el => el.setAttribute('data-clickable', 'true'));
  }
  function charElementAt(pos) {
    return state.charByPos && state.charByPos[pos] ? state.charByPos[pos] : null;
  }

  function visibleSubtitleRect() {
    const rect = subtitleEl.getBoundingClientRect();
    if (subtitleEl.classList.contains('hidden') || !rect.width || !rect.height) {
      return { top: window.innerHeight * 0.72, bottom: window.innerHeight * 0.92, left: 0, right: window.innerWidth, width: window.innerWidth, height: window.innerHeight * 0.20 };
    }
    return rect;
  }

  function placePopup(anchor) {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const sub = visibleSubtitleRect();
    const margin = 12;
    const gap = Math.max(12, Number(state.config.popupSubtitleGapPx || 34));
    const scale = Math.max(0.1, Number(state.config.popupScale || 0.92) || 0.92);
    const desiredVh = Math.max(20, Math.min(60, Number(state.config.popupMaxHeightVh || 34)));
    const desiredMax = Math.floor(window.innerHeight * desiredVh / 100);

    // Hard rule: choose a non-subtitle region first, then cap the popup height to
    // that region. v1.3.2 accidentally let max-height fall back to the whole
    // window, which could make a tall popup overlap the subtitle band.
    const availableAbove = Math.max(0, sub.top - margin - gap);
    const availableBelow = Math.max(0, window.innerHeight - sub.bottom - margin - gap);
    let placeAbove = true;
    if (availableAbove < 90 && availableBelow > availableAbove) placeAbove = false;
    else if (availableAbove < 160 && availableBelow > 220) placeAbove = false;
    else placeAbove = true; // subtitles are usually at the bottom; keep the popup above.

    let regionTop = placeAbove ? margin : sub.bottom + gap;
    let regionBottom = placeAbove ? sub.top - gap : window.innerHeight - margin;
    if (regionBottom - regionTop < 80) {
      // Fallback: use the larger side, still outside the subtitle if possible.
      if (availableBelow > availableAbove) {
        placeAbove = false;
        regionTop = Math.min(window.innerHeight - 80, sub.bottom + gap);
        regionBottom = window.innerHeight - margin;
      } else {
        placeAbove = true;
        regionTop = margin;
        regionBottom = Math.max(margin + 80, sub.top - gap);
      }
    }

    const regionHeight = Math.max(80, regionBottom - regionTop);
    const cappedHeight = Math.max(80, Math.min(desiredMax, regionHeight));
    document.documentElement.style.setProperty('--popup-max-height', String(Math.floor(cappedHeight / scale)) + 'px');

    popupEl.style.left = '0px';
    popupEl.style.top = '0px';
    const pr = popupEl.getBoundingClientRect();
    const popupW = Math.min(Math.max(0, pr.width), Math.max(0, window.innerWidth - margin * 2));
    const popupH = Math.min(Math.max(0, pr.height), cappedHeight);

    let left = rect.left + rect.width / 2 - popupW / 2;
    const maxLeft = window.innerWidth - popupW - margin;
    left = Math.max(margin, Math.min(left, Math.max(margin, maxLeft)));

    // Stable vertical docking: keep the popup adjacent to the subtitle-safe region
    // rather than pinning it to the very top of the video. This keeps it close to
    // the word being studied while still leaving the subtitle band unobstructed.
    let top = placeAbove ? (regionBottom - popupH) : regionTop;
    top = Math.max(regionTop, Math.min(top, regionBottom - popupH));
    top = Math.max(margin, Math.min(top, window.innerHeight - popupH - margin));

    // Absolute last safety check: if the computed rect still overlaps subtitles,
    // shrink to fit the upper region and keep its bottom above the subtitle.
    const overlaps = !(top + popupH <= sub.top - gap / 2 || top >= sub.bottom + gap / 2);
    if (overlaps && availableAbove > 80) {
      const safeHeight = Math.max(80, Math.min(desiredMax, availableAbove));
      document.documentElement.style.setProperty('--popup-max-height', String(Math.floor(safeHeight / scale)) + 'px');
      top = Math.max(margin, sub.top - gap - safeHeight);
    }

    popupEl.style.left = left + 'px';
    popupEl.style.top = top + 'px';
  }


  function toArray(v) { return Array.isArray(v) ? v : (v == null ? [] : [v]); }
  function plainTextFromNode(node) {
    if (node == null) return '';
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node);
    if (Array.isArray(node)) return node.map(plainTextFromNode).join('');
    if (typeof node === 'object') {
      if (node.tag === 'rt') return '';
      if (node.tag === 'ruby') {
        return toArray(node.content).filter(part => !(part && typeof part === 'object' && part.tag === 'rt')).map(plainTextFromNode).join('');
      }
      return plainTextFromNode(node.content);
    }
    return '';
  }
  function renderRubyNode(node) {
    const parts = toArray(node && node.content);
    let base = '';
    let rt = '';
    parts.forEach(part => {
      if (part && typeof part === 'object' && part.tag === 'rt') rt += plainTextFromNode(part.content);
      else base += plainTextFromNode(part);
    });
    return '<ruby>' + escapeHtml(base) + (rt ? '<rt>' + escapeHtml(rt) + '</rt>' : '') + '</ruby>';
  }
	  function renderInlineNode(node, ctx) {
	    if (node == null) return '';
	    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return escapeHtml(String(node)).replace(/\n/g, '<br>');
	    if (Array.isArray(node)) return node.map(part => renderInlineNode(part, ctx)).join('');
	    if (typeof node === 'object') {
	      if (node.type === 'structured-content') return renderInlineNode(node.content, ctx);
	      const tag = node.tag || '';
		      if (tag === 'ruby') return renderRubyNode(node);
		      if (tag === 'rt') return '';
		      if (tag === 'br') return '<br>';
		      if (tag === 'a') {
		        const inner = renderInlineNode(node.content, ctx) || escapeHtml(nodeHref(node));
		        const linked = externalLinkHtml(nodeHref(node), inner);
		        return linked || '<span class="xref-link">' + inner + '</span>';
		      }
		      if (tag === 'span') return renderStructuredSpan(node, ctx);
		      return renderInlineNode(node.content, ctx);
		    }
	    return '';
	  }
  function findNodes(node, predicate, out) {
    out = out || [];
    if (node == null) return out;
    if (Array.isArray(node)) { node.forEach(n => findNodes(n, predicate, out)); return out; }
    if (typeof node === 'object') {
      if (predicate(node)) out.push(node);
      if (node.content !== undefined) findNodes(node.content, predicate, out);
    }
    return out;
  }
  function parseGlossaryJson(raw) {
    if (typeof raw !== 'string') return null;
    const s = raw.trim();
    if (!s || (s[0] !== '[' && s[0] !== '{')) return null;
    try { return JSON.parse(s); } catch (_) { return null; }
  }
  function fallbackGlossaryText(raw) {
    const s = String(raw || '');
    if (!s) return '';
    if (s.trim()[0] !== '[' && s.trim()[0] !== '{') return s;
    const bits = [];
    const re = /"content"\s*:\s*"((?:\\.|[^"\\])*)"/g;
    let match;
    while ((match = re.exec(s)) && bits.length < 12) {
      try {
        const text = JSON.parse('"' + match[1] + '"');
        if (text && !/^(sense|sense-group|sense-groups|glossary|extra-info|part-of-speech-info|example-sentence|tag)$/i.test(text)) bits.push(text);
      } catch (_) {}
    }
    return bits.length ? bits.join('\n') : s;
  }
	  function nodeDataContent(node) {
	    const data = node && node.data ? node.data : {};
	    return String(data.content || data['data-content'] || node.dataContent || node.kind || '');
	  }
	  function nodeClassName(node) {
	    const data = node && node.data ? node.data : {};
	    const attrs = node && (node.attributes || node.attrs) ? (node.attributes || node.attrs) : {};
	    return String(data.class || data.className || attrs.class || node.className || '');
	  }
	  function nodeDataMap(node) {
	    return (node && typeof node === 'object' && node.data && typeof node.data === 'object') ? node.data : {};
	  }
	  function hasDataFlag(node, name) {
	    const data = nodeDataMap(node);
	    return Object.prototype.hasOwnProperty.call(data, name);
	  }
	  function nodeTitle(node) {
	    const data = nodeDataMap(node);
	    const attrs = node && (node.attributes || node.attrs) ? (node.attributes || node.attrs) : {};
	    return String((node && node.title) || data.title || attrs.title || '');
	  }
	  function directContent(node) {
	    return toArray(node && node.content);
	  }
	  function isSummaryNode(node) {
	    return !!(node && typeof node === 'object' && node.tag === 'summary');
	  }
	  function detailsSummaryText(node) {
	    const parts = directContent(node);
	    const summary = parts.find(isSummaryNode);
	    const text = normalizeWhitespace(summary ? plainTextFromNode(summary.content) : '');
	    if (text) return text;
	    const kind = nodeDataContent(node);
	    if (/grammar/i.test(kind)) return 'Grammar';
	    if (/etymology/i.test(kind)) return 'Etymology';
	    return 'Details';
	  }
	  function detailsBody(node) {
	    return directContent(node).filter(part => !isSummaryNode(part));
	  }
	  function isGrammarDetails(node) {
	    const kind = nodeDataContent(node);
	    if (/details-entry-grammar/i.test(kind)) return true;
	    return (node && node.tag === 'details' && /^grammar\b/i.test(detailsSummaryText(node)));
	  }
	  function isEtymologyDetails(node) {
	    const kind = nodeDataContent(node);
	    if (/details-entry-etymology/i.test(kind)) return true;
	    return (node && node.tag === 'details' && /^etymology\b/i.test(detailsSummaryText(node)));
	  }
	  function detectDictionarySource(glossaryItem, parsed) {
	    const dictName = String((glossaryItem && glossaryItem.dict) || '');
	    const raw = String((glossaryItem && glossaryItem.glossary) || '');
	    const hay = (dictName + ' ' + raw.slice(0, 1600)).toLowerCase();
	    if (hay.indexOf('kaikki') >= 0) return 'kaikki';
	    if (hay.indexOf('wiktionary') >= 0 || /(^|[^a-z])wty[-_]/.test(hay)) return 'wiktionary';
	    if (/details-entry-(grammar|etymology)/i.test(raw) || findNodes(parsed, n => isGrammarDetails(n) || isEtymologyDetails(n)).length) return 'wiktionary-style';
	    return 'generic';
	  }
	  function isWiktionaryLike(ctx) {
	    const kind = ctx && ctx.sourceKind ? String(ctx.sourceKind) : '';
	    return /^(wiktionary|kaikki|wiktionary-style)$/.test(kind);
	  }
	  function etymologyShouldOpen(ctx) {
	    let mode = String((state.config && state.config.etymologyCollapseDefault) || 'collapsed');
	    const override = String((state.config && state.config.wiktionaryEtymologyCollapseOverride) || 'inherit');
	    if (isWiktionaryLike(ctx) && override && override !== 'inherit') {
	      overlayDebug("dictionary-specific etymology collapse override source=" + String(ctx.sourceKind || "") + " mode=" + override);
	      mode = override;
	    }
	    overlayDebug("etymology collapsibility applied source=" + String(ctx && ctx.sourceKind || "generic") + " mode=" + mode);
	    return mode === 'expanded';
	  }
	  function renderGrammarHtml(content, ctx) {
	    const inline = normalizeWhitespace(renderInlineNode(content, ctx).replace(/<br\s*\/?>/gi, ' '));
	    if (!inline) return '';
	    overlayDebug("detected grammar section source=" + String(ctx && ctx.sourceKind || "generic"));
	    return '<div class="grammar-row"><b>Grammar</b>: <span>' + inline + '</span></div>';
	  }
	  function renderGrammarText(text, ctx) {
	    const value = normalizeWhitespace(String(text || '').replace(/^[:\s]+/, ''));
	    if (!value) return '';
	    overlayDebug("detected grammar section source=" + String(ctx && ctx.sourceKind || "generic"));
	    return '<div class="grammar-row"><b>Grammar</b>: <span>' + escapeAndLinkifyText(value) + '</span></div>';
	  }
	  const NONLEMMA_GRAMMAR_START = '(?:nominative|genitive|dative|accusative|ablative|vocative|instrumental|locative|ergative|absolutive|masculine|feminine|neuter|common|animate|inanimate|singular|plural|dual|definite|indefinite|comparative|superlative|infinitive|participle|present|past|preterite|imperfect|subjunctive|conditional|imperative|first|second|third)';
	  const NONLEMMA_GRAMMAR_WORD_RE = /\b(?:nominative|genitive|dative|accusative|ablative|vocative|instrumental|locative|ergative|absolutive|masculine|feminine|neuter|common|singular|plural|dual|definite|indefinite|comparative|superlative|infinitive|participle|present|past|preterite|imperfect|subjunctive|conditional|imperative|first|second|third)\b/i;
	  function containsWiktionaryPathFragment(text) {
	    const withoutUrls = String(text || '').replace(/https?:\/\/[^\s<>"']+/gi, '');
	    return /(?:\b[a-z]{2,4}|[a-z])\/(?:languages|appendix|wiki|dictionary|thesaurus|wikipedia|wikisource)\b/i.test(withoutUrls);
	  }
	  function isNonLemmaText(text, ctx) {
	    const raw = String(text || '');
	    if (!isWiktionaryLike(ctx) && !containsWiktionaryPathFragment(raw)) return false;
	    if (containsWiktionaryPathFragment(raw)) return true;
	    if (/\b(?:non-lemma|nonlemma|form-of|inflection of|inflected form of|plural of|singular of|comparative of|superlative of|past participle of|present participle of|conjugation of|declension of)\b/i.test(raw)) return true;
	    const grammarHits = raw.match(new RegExp(NONLEMMA_GRAMMAR_START, 'gi')) || [];
	    return grammarHits.length >= 3 && !/\b(?:Etymology|Grammar)\b/i.test(raw);
	  }
	  function cleanupNonLemmaText(text) {
	    const urls = [];
	    let raw = String(text || '').replace(/\r/g, '\n').replace(/https?:\/\/[^\s<>"']+/gi, url => {
	      const token = '__IINATAN_URL_' + urls.length + '__';
	      urls.push(url);
	      return token;
	    });
	    raw = raw.replace(new RegExp('(?:\\b[a-z]{2,4}|[a-z])\\/(?:languages|appendix|wiki|dictionary|thesaurus|wikipedia|wikisource)[A-Za-z0-9 _.-]*?(?=' + NONLEMMA_GRAMMAR_START + '\\b|$)', 'gi'), '');
	    raw = raw.replace(/([a-zà-öø-ÿ])([A-ZÀ-Ö])/g, '$1\n$2');
	    raw = raw.replace(new RegExp('\\b(singular|plural|dual|definite|indefinite|masculine|feminine|neuter|common)(?=' + NONLEMMA_GRAMMAR_START + '\\b)', 'gi'), '$1\n');
	    raw = raw.replace(/\b(non-lemma|form-of|inflection of|inflected form of|plural of|singular of|comparative of|superlative of|past participle of|present participle of|conjugation of|declension of)\b\s*:?\s*/gi, '\n$1: ');
	    return raw.split(/\n+/).map(part => {
	      let restored = normalizeWhitespace(part);
	      urls.forEach((url, index) => { restored = restored.replace('__IINATAN_URL_' + index + '__', url); });
	      return restored;
	    }).filter(Boolean);
	  }
	  function renderNonLemmaText(text, ctx) {
	    if (!isNonLemmaText(text, ctx)) return '';
	    const rows = cleanupNonLemmaText(text).filter(part => !containsWiktionaryPathFragment(part));
	    if (!rows.length) return '';
	    overlayDebug("detected non-lemma entry source=" + String(ctx && ctx.sourceKind || "generic") + " rows=" + rows.length);
	    return rows.map(part => {
	      const label = NONLEMMA_GRAMMAR_WORD_RE.test(part) ? 'Inflection' : 'Definition';
	      return '<div class="nonlemma-row"><b>' + label + '</b>: <span>' + escapeAndLinkifyText(part) + '</span></div>';
	    }).join('');
	  }
	  function isWiktionaryNonLemmaGlossary(glossaryItem, ctx) {
	    if (!isWiktionaryLike(ctx)) return false;
	    const tags = normalizeWhitespace(String((glossaryItem && glossaryItem.definitionTags) || '') + ' ' + String((glossaryItem && glossaryItem.termTags) || '')).toLowerCase();
	    return /\bnon[-\s]?lemma\b/.test(tags);
	  }
	  function wiktionaryPairTupleRows(parsed) {
	    if (!Array.isArray(parsed) || !parsed.length) return [];
	    function tupleScalar(value) {
	      return value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
	    }
	    const rows = [];
	    for (let i = 0; i < parsed.length; i++) {
	      const row = parsed[i];
	      if (!Array.isArray(row) || row.length < 2) return [];
	      if (!tupleScalar(row[0])) return [];
	      const lemma = normalizeWhitespace(row[0]);
	      const descriptions = Array.isArray(row[1]) ? row[1] : [row[1]];
	      if (descriptions.some(description => !tupleScalar(description))) return [];
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
	    if (!isWiktionaryNonLemmaGlossary(glossaryItem, ctx)) return '';
	    const rows = wiktionaryPairTupleRows(parsed);
	    if (!rows.length) return '';
	    overlayDebug("detected Wiktionary tuple non-lemma dict=" + JSON.stringify(ctx && ctx.dictName || "") + " rows=" + rows.length);
	    return '<div class="nonlemma-list">' + rows.map(row =>
	      '<div class="nonlemma-row"><b>Form of</b>: <span>' +
	      (row.lemma ? '<span class="nonlemma-lemma">' + escapeHtml(row.lemma) + '</span>' : '') +
	      (row.lemma && row.description ? '<span class="nonlemma-arrow"> - </span>' : '') +
	      (row.description ? '<span class="nonlemma-desc">' + escapeHtml(row.description) + '</span>' : '') +
	      '</span></div>'
	    ).join('') + '</div>';
	  }
	  function renderCollapsibleSection(label, bodyHtml, open, className) {
	    const body = bodyHtml || '';
	    if (!body) return '';
	    const cls = className ? ' ' + className : '';
	    return '<details class="dict-details' + cls + '"' + (open ? ' open' : '') + '><summary>' + escapeHtml(label || 'Details') + '</summary><div class="details-body">' + body + '</div></details>';
	  }
	  function renderEtymologyHtml(content, ctx, label) {
	    const body = renderStructuredNode(content, ctx);
	    if (!normalizeWhitespace(plainTextFromNode(content)) && !body) return '';
	    overlayDebug("detected etymology section source=" + String(ctx && ctx.sourceKind || "generic") + " label=" + String(label || "Etymology"));
	    return renderCollapsibleSection(label || 'Etymology', body, etymologyShouldOpen(ctx), 'etymology-section');
	  }
	  function renderEtymologyText(text, ctx, label) {
	    const value = String(text || '').replace(/^[:\s]+/, '').trim();
	    if (!value) return '';
	    overlayDebug("detected etymology section source=" + String(ctx && ctx.sourceKind || "generic") + " label=" + String(label || "Etymology"));
	    return renderCollapsibleSection(label || 'Etymology', '<div class="gloss">' + escapeAndLinkifyText(value).replace(/\n/g, '<br>') + '</div>', etymologyShouldOpen(ctx), 'etymology-section');
	  }
	  function renderDetailsNode(node, ctx) {
	    const summary = detailsSummaryText(node);
	    const body = detailsBody(node);
	    if (isGrammarDetails(node)) return renderGrammarHtml(body, ctx);
	    if (isEtymologyDetails(node)) return renderEtymologyHtml(body, ctx, summary || 'Etymology');
	    const kind = nodeDataContent(node);
	    const cls = /details-entry-examples/i.test(kind) || /^(?:\d+\s+examples?|examples?|例文)/i.test(summary) ? 'example-section' : 'nested-details';
	    return renderCollapsibleSection(summary, renderStructuredNode(body, ctx), false, cls);
	  }
	  function renderBacklinkRow(node, ctx) {
	    const linkNodes = findNodes(node, n => n && n.tag === 'a');
	    const links = linkNodes.map(n => renderInlineNode(n, ctx)).filter(Boolean);
	    const text = normalizeWhitespace(plainTextFromNode(node.content));
	    const body = links.length ? links.join(' · ') : escapeAndLinkifyText(text);
	    if (!body) return '';
	    overlayDebug("detected source/backlink row source=" + String(ctx && ctx.sourceKind || "generic"));
	    return '<div class="source-row"><span class="source-label">Source</span> ' + body + '</div>';
	  }
	  function renderAttributionRow(node, ctx) {
	    const linkNodes = findNodes(node, n => n && n.tag === 'a');
	    const links = linkNodes.map(n => renderInlineNode(n, ctx)).filter(Boolean);
	    const text = normalizeWhitespace(plainTextFromNode(node.content));
	    const body = links.length ? links.join(' | ') : escapeAndLinkifyText(text);
	    if (!body) return '';
	    return '<div class="attribution-row">' + body + '</div>';
	  }
	  function isPriorityTag(label) {
	    const cleaned = normalizeWhitespace(label).replace(/^[\u2605*]\s*/, '');
	    return /^(priority[\s_-]*form|popular[\s_-]*form)$/i.test(cleaned);
	  }
	  function tagLabels(value) {
	    const raw = String(value || '').trim();
	    if (!raw) return [];
	    if (isPriorityTag(raw)) return [raw];
	    return raw.split(/[;,|]+/).map(s => normalizeWhitespace(s)).filter(Boolean);
	  }
	  function renderOneTag(label, kind) {
	    if (isPriorityTag(label)) {
	      return '<span class="tag-chip tag-priority" title="priority form" aria-label="priority form">&#9733;</span>';
	    }
	    return '<span class="tag-chip tag-' + escapeHtml(kind || 'tag') + '">' + escapeHtml(label) + '</span>';
	  }
	  function renderTagChips(glossaryItem) {
	    const tags = [];
	    tagLabels(glossaryItem && glossaryItem.definitionTags).forEach(label => tags.push(renderOneTag(label, 'definition')));
	    tagLabels(glossaryItem && glossaryItem.termTags).forEach(label => tags.push(renderOneTag(label, 'term')));
	    return tags.length ? '<div class="tag-row">' + tags.join('') + '</div>' : '';
	  }
	  function shouldCleanupPlainWiktionary(text, ctx) {
	    const raw = String(text || '');
	    if (isWiktionaryLike(ctx)) return true;
	    return /\bGrammar\b[\s\S]{0,800}\bEtymology\b/i.test(raw) || /^\s*(Grammar|Etymology)\b/i.test(raw);
	  }
	  function renderPlainWiktionarySections(text, ctx) {
	    let raw = String(text || '').replace(/\r/g, '').trim();
	    const nonLemma = renderNonLemmaText(raw, ctx);
	    if (nonLemma) return nonLemma;
	    raw = raw.replace(/\bGrammar\s*(?=\{)/i, 'Grammar: ');
	    raw = raw.replace(/([}\]])\s*(Etymology)/gi, '$1\n$2');
	    raw = raw.replace(/\b(Etymology)(?=Etymology\b)/gi, '$1\n');
	    const re = /\b(Grammar|Etymology(?:\s+\d+)?)\b\s*:?\s*/gi;
	    const matches = [];
	    let match;
	    while ((match = re.exec(raw))) matches.push({ label: match[1], start: match.index, contentStart: re.lastIndex });
	    if (!matches.length) return '<div class="gloss">' + escapeAndLinkifyText(raw).replace(/\n/g, '<br>') + '</div>';
	    let html = '';
	    const before = raw.slice(0, matches[0].start).trim();
	    if (before) html += '<div class="gloss">' + escapeAndLinkifyText(before).replace(/\n/g, '<br>') + '</div>';
	    matches.forEach((m, index) => {
	      const end = index + 1 < matches.length ? matches[index + 1].start : raw.length;
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
	    if (shouldCleanupPlainWiktionary(text, ctx)) return renderPlainWiktionarySections(text, ctx);
	    return '<div class="gloss">' + escapeAndLinkifyText(text).replace(/\n/g, '<br>') + '</div>';
	  }
	  function hasStructuredBlockContent(node) {
	    return findNodes(node && node.content, n => n && /^(div|details|ul|ol|table)$/i.test(String(n.tag || ''))).length > 0;
	  }
	  function renderStructuredSpan(node, ctx) {
	    const kind = nodeDataContent(node);
	    const cls = nodeClassName(node);
	    const data = nodeDataMap(node);
	    const text = normalizeWhitespace(plainTextFromNode(node.content));
	    const blocky = hasStructuredBlockContent(node);
	    const body = blocky ? renderStructuredNode(node.content, ctx) : renderInlineNode(node.content, ctx);
	    if (kind === 'bold-text') return '<b>' + body + '</b>';
	    if (kind === 'example-keyword' || hasDataFlag(node, 'spellout')) return '<span class="example-keyword">' + body + '</span>';
	    if (kind === 'tag') return renderOneTag(text, data.category || 'tag');
	    if (kind === 'forms-label') return '<span class="forms-label" title="' + escapeHtml(nodeTitle(node) || 'forms') + '">' + escapeHtml(text || 'forms') + '</span>';
	    if (hasDataFlag(node, 'POS') || hasDataFlag(node, 'pos') || hasDataFlag(node, 'hinshi') || kind === 'part-of-speech-info') return '<span class="pos-pill" title="' + escapeHtml(nodeTitle(node)) + '">' + body + '</span>';
	    if (kind === 'misc-info') return '<span class="pos-pill misc-pill misc-' + escapeHtml(String(data.code || 'info')) + '" title="' + escapeHtml(nodeTitle(node)) + '">' + body + '</span>';
	    if (hasDataFlag(node, 'katsuyo')) return '<span class="grammar-inline">' + body + '</span>';
	    if (hasDataFlag(node, 'num') || hasDataFlag(node, 'bc') || hasDataFlag(node, 'rect') || /(?:^|\s)(?:FM|gaiji)(?:\s|$)/i.test(cls)) return '<span class="sense-number">' + body + '</span>';
	    if (hasDataFlag(node, 'sup')) return '<span class="usage-marker">' + body + '</span>';
	    if (hasDataFlag(node, 'logo') || hasDataFlag(node, '補足ロゴ')) return '<span class="section-label">' + body + '</span>';
	    if (hasDataFlag(node, 'ex') || hasDataFlag(node, 'ExG') || hasDataFlag(node, 'example')) return '<span class="dict-inline-example">' + body + '</span>';
	    if (hasDataFlag(node, 'headword') || /(?:見出|headword|カナ|かな|表記)/.test(cls)) return '<span class="dict-headword-inline">' + body + '</span>';
	    return body;
	  }
	  function renderExampleBox(node, ctx) {
	    const jaNode = findNodes(node, n => n && n.data && n.data.content === 'example-sentence-a')[0];
	    const enNode = findNodes(node, n => n && n.data && n.data.content === 'example-sentence-b')[0];
	    const citeNode = findNodes(node, n => n && n.data && n.data.content === 'example-sentence-c')[0];
	    const ja = jaNode ? renderInlineNode(jaNode.content, ctx) : '';
	    const en = enNode ? renderInlineNode(enNode.content, ctx) : '';
	    const cite = citeNode ? renderInlineNode(citeNode.content, ctx) : '';
	    if (!ja && !en && !cite) return '';
	    const primaryClass = en ? 'example-ja' : 'example-text';
	    return '<div class="example-card">' + (ja ? '<div class="' + primaryClass + '">' + ja + '</div>' : '') + (en ? '<div class="example-en">' + en + '</div>' : '') + (cite ? '<div class="example-cite">' + cite + '</div>' : '') + '</div>';
	  }
	  function renderSenseNoteBox(node, ctx) {
	    const labelNode = findNodes(node, n => n && n.data && n.data.content === 'sense-note-label')[0];
	    const contentNode = findNodes(node, n => n && n.data && n.data.content === 'sense-note-content')[0];
	    const label = labelNode ? renderInlineNode(labelNode.content, ctx) : 'Note';
	    const content = contentNode ? renderInlineNode(contentNode.content, ctx) : renderInlineNode(node.content, ctx);
	    if (!content) return '';
	    return '<div class="note-card"><div class="note-label">' + (label || 'Note') + '</div><div class="note-content">' + content + '</div></div>';
	  }
	  function renderXrefBox(node, ctx) {
	    const labelNode = findNodes(node, n => n && n.data && n.data.content === 'reference-label')[0];
	    const glossNode = findNodes(node, n => n && n.data && n.data.content === 'xref-glossary')[0];
	    const linkNodes = findNodes(node, n => n && n.tag === 'a');
	    const label = labelNode ? plainTextFromNode(labelNode.content) : 'See also';
	    const links = linkNodes.map(n => renderInlineNode(n, ctx)).filter(Boolean);
	    const gloss = glossNode ? renderInlineNode(glossNode.content, ctx) : '';
	    if (!links.length && !gloss) return '';
	    return '<div class="xref-card">' + '<span class="xref-label">' + escapeHtml(label || 'See also') + '</span>' + (links.length ? '<div>' + links.join(' · ') + '</div>' : '') + (gloss ? '<div class="xref-glossary">' + gloss + '</div>' : '') + '</div>';
	  }
	  function renderListMarker(item) {
	    const style = item && item.style ? item.style : {};
	    const marker = normalizeWhitespace(String(style.listStyleType || '').replace(/^['"]|['"]$/g, ''));
	    return marker && marker !== 'disc' && marker !== 'decimal' ? marker : '';
	  }
	  function renderListNode(node, ctx, ordered, className) {
	    const tag = ordered ? 'ol' : 'ul';
	    const items = toArray(node.content);
	    return '<' + tag + ' class="glossary-list ' + className + '">' + items.map(item => {
	      const marker = renderListMarker(item);
	      const content = item && typeof item === 'object' && item.tag === 'li' ? item.content : item;
	      const body = renderStructuredNode(content, ctx);
	      if (marker) return '<li class="custom-marker"><span class="sense-number">' + escapeHtml(marker) + '</span>' + body + '</li>';
	      return '<li>' + body + '</li>';
	    }).join('') + '</' + tag + '>';
	  }
	  function renderGlossaryLinesNode(node, ctx) {
	    const items = toArray(node.content).map(item => {
	      const content = item && typeof item === 'object' && item.tag === 'li' ? item.content : item;
	      return renderStructuredNode(content, ctx);
	    }).filter(Boolean);
	    return '<div class="glossary-lines">' + items.map(html => '<div class="glossary-line">' + html + '</div>').join('') + '</div>';
	  }
	  function formMarkerForCell(node) {
	    const cls = nodeClassName(node);
	    const title = nodeTitle(node) || findNodes(node, n => !!nodeTitle(n)).map(nodeTitle)[0] || '';
	    const hay = (cls + ' ' + title).toLowerCase();
	    if (/form-pri|high priority|priority/.test(hay)) return { className: 'form-pri', label: title || 'high priority form', symbol: '&#9651;' };
	    if (/form-rare|rare/.test(hay)) return { className: 'form-rare', label: title || 'rarely used form', symbol: '&#9661;' };
	    if (/form-out|archaic|obsolete|outdated/.test(hay)) return { className: 'form-out', label: title || 'archaic or obsolete form', symbol: '&#21476;' };
	    if (/form-invalid|invalid|not valid/.test(hay)) return { className: 'form-invalid', label: title || 'invalid form/reading combination', symbol: '&#8709;' };
	    if (/form-valid|valid form/.test(hay)) return { className: 'form-valid', label: title || 'valid form/reading combination', symbol: '&#9671;' };
	    return null;
	  }
	  function renderTableCell(node, ctx) {
	    const tag = node.tag === 'th' ? 'th' : 'td';
	    const marker = formMarkerForCell(node);
	    let body = marker
	      ? '<span class="form-marker ' + marker.className + '" title="' + escapeHtml(marker.label) + '" aria-label="' + escapeHtml(marker.label) + '">' + marker.symbol + '</span>'
	      : renderStructuredNode(node.content, ctx);
	    if (!body && tag === 'th') body = '&nbsp;';
	    const cls = nodeClassName(node);
	    const classAttr = cls ? ' class="' + escapeHtml(cls) + '"' : '';
	    return '<' + tag + classAttr + '>' + body + '</' + tag + '>';
	  }
	  function renderTableNode(node, ctx) {
	    return '<table class="forms-table">' + toArray(node.content).map(row => renderStructuredNode(row, ctx)).join('') + '</table>';
	  }
	  function renderFormsNode(node, ctx) {
	    return '<div class="forms-block">' + renderStructuredNode(node.content, ctx) + '</div>';
	  }
	  function renderEntryIndexNode(node, ctx) {
	    const items = toArray(node.content).map(item => {
	      const content = item && typeof item === 'object' && item.content !== undefined ? item.content : item;
	      return normalizeWhitespace(plainTextFromNode(content)) ? renderInlineNode(content, ctx) : '';
	    }).filter(Boolean);
	    if (!items.length) return '';
	    return '<div class="entry-index">' + items.map(html => '<span class="entry-index-item">' + html + '</span>').join('') + '</div>';
	  }
	  function renderBlockNode(node, ctx) {
	    const data = nodeDataMap(node);
	    const kind = nodeDataContent(node);
	    const cls = nodeClassName(node);
	    if (hasDataFlag(node, 'entry-index')) return renderEntryIndexNode(node, ctx);
	    const body = renderStructuredNode(node.content, ctx);
	    if (!body) return '';
	    let outClass = 'structured-block';
	    if (kind === 'preamble') outClass += ' preamble-block';
	    if (hasDataFlag(node, 'head') || hasDataFlag(node, 'head2') || hasDataFlag(node, '見出G')) outClass += ' dictionary-head-block';
	    if (hasDataFlag(node, 'meaning') || hasDataFlag(node, 'level0') || hasDataFlag(node, 'level1') || /(?:level|L3|no|MG|meaning)/.test(cls)) outClass += ' meaning-block';
	    if (hasDataFlag(node, '活用') || hasDataFlag(node, '参考') || hasDataFlag(node, 'column') || hasDataFlag(node, 'コラム') || hasDataFlag(node, '表現')) outClass += ' info-block';
	    if (hasDataFlag(node, 'title2')) outClass += ' subsection-title';
	    if (kind === 'extra-info') outClass += ' extra-info';
	    return '<div class="' + outClass + '">' + body + '</div>';
	  }
	  function renderStructuredNode(node, ctx) {
	    if (node == null) return '';
	    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return escapeHtml(String(node)).replace(/\n/g, '<br>');
	    if (Array.isArray(node)) return node.map(part => renderStructuredNode(part, ctx)).join('');
	    if (typeof node !== 'object') return '';
	    if (node.type === 'structured-content') return renderStructuredNode(node.content, ctx);
	    const tag = node.tag || '';
	    const kind = nodeDataContent(node);
	    const cls = nodeClassName(node);
	    if (hasDataFlag(node, 'entry-index')) return renderEntryIndexNode(node, ctx);
	    if (kind === 'attribution') return renderAttributionRow(node, ctx);
	    if (tag === 'details' || isGrammarDetails(node) || isEtymologyDetails(node)) return renderDetailsNode(node, ctx);
	    if (kind === 'backlink') return renderBacklinkRow(node, ctx);
	    if (kind === 'tags') return '<span class="inline-tag-row">' + renderStructuredNode(node.content, ctx) + '</span>';
	    if (kind === 'tag') return renderOneTag(plainTextFromNode(node.content), nodeDataMap(node).category || 'tag');
	    if (kind === 'part-of-speech-info') return '<span class="pos-pill">' + escapeHtml(plainTextFromNode(node.content)) + '</span>';
	    if (kind === 'misc-info') return renderStructuredSpan(node, ctx);
	    if ((cls === 'extra-box' && kind === 'example-sentence') || kind === 'example-sentence') return renderExampleBox(node, ctx);
	    if (cls === 'extra-box' && kind === 'sense-note') return renderSenseNoteBox(node, ctx);
	    if (cls === 'extra-box' && kind === 'xref') return renderXrefBox(node, ctx);
	    if (kind === 'sense-groups') return '<div class="sense-groups">' + renderStructuredNode(node.content, ctx) + '</div>';
	    if (kind === 'sense-group') return '<div class="sense-group">' + renderStructuredNode(node.content, ctx) + '</div>';
	    if (kind === 'sense') return '<div class="sense-body">' + renderStructuredNode(node.content, ctx) + '</div>';
	    if (kind === 'forms') return renderFormsNode(node, ctx);
	    if (kind === 'glossary' && (tag === 'ul' || tag === 'ol')) return renderGlossaryLinesNode(node, ctx);
	    if (kind === 'glosses' && (tag === 'ul' || tag === 'ol')) return renderListNode(node, ctx, true, 'glosses-list');
	    if (kind === 'extra-info') return renderBlockNode(node, ctx);
	    if (tag === 'ruby') return renderRubyNode(node);
	    if (tag === 'rt') return '';
	    if (tag === 'br') return '<br>';
	    if (tag === 'a') return renderInlineNode(node, ctx);
	    if (tag === 'table') return renderTableNode(node, ctx);
	    if (tag === 'tr') return '<tr>' + renderStructuredNode(node.content, ctx) + '</tr>';
	    if (tag === 'th' || tag === 'td') return renderTableCell(node, ctx);
	    if (tag === 'thead' || tag === 'tbody') return renderStructuredNode(node.content, ctx);
	    if (tag === 'span') return renderStructuredSpan(node, ctx);
	    if (tag === 'ul') return renderListNode(node, ctx, false, '');
	    if (tag === 'ol') return renderListNode(node, ctx, true, '');
	    if (tag === 'li') return '<div class="list-item-body">' + renderStructuredNode(node.content, ctx) + '</div>';
	    if (tag === 'div') return renderBlockNode(node, ctx);
	    return renderStructuredNode(node.content, ctx);
	  }
	  function renderGlossaryPayload(glossaryItem) {
	    const parsed = parseGlossaryJson(glossaryItem && glossaryItem.glossary);
	    const ctx = {
	      dictName: String((glossaryItem && glossaryItem.dict) || ''),
	      sourceKind: detectDictionarySource(glossaryItem, parsed)
	    };
	    if (ctx.sourceKind !== 'generic') overlayDebug("detected dictionary source/type dict=" + JSON.stringify(ctx.dictName) + " source=" + ctx.sourceKind);
	    const metaRow = renderTagChips(glossaryItem);
	    if (!parsed) {
	      return metaRow + renderPlainGlossaryText((glossaryItem && glossaryItem.glossary) || '', ctx);
	    }
	    const tupleNonLemma = renderWiktionaryPairTupleNonLemma(parsed, glossaryItem, ctx);
	    if (tupleNonLemma) return metaRow + tupleNonLemma;
	    return metaRow + renderStructuredNode(parsed, ctx);
	  }
	  function splitJapaneseMoras(text) {
	    const chars = Array.from(String(text || '').replace(/\s+/g, ''));
	    const small = /[ゃゅょぁぃぅぇぉャュョァィゥェォㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ]/;
	    const out = [];
	    chars.forEach(ch => {
	      if (small.test(ch) && out.length) out[out.length - 1] += ch;
	      else out.push(ch);
	    });
	    return out;
	  }
	  function pitchMoraClass(index, position) {
	    const i = index + 1;
	    if (position === 0) return i === 1 ? 'pitch-low' : 'pitch-high';
	    if (i === 1) return position === 1 ? 'pitch-high pitch-drop' : 'pitch-low';
	    if (i <= position) return 'pitch-high' + (i === position ? ' pitch-drop' : '');
	    return 'pitch-low';
	  }
	  function renderPitchPattern(reading, position) {
	    const pos = Number(position);
	    if (!Number.isFinite(pos)) return '';
	    const moras = splitJapaneseMoras(reading);
	    if (!moras.length) return '<span class="pitch-number">[' + escapeHtml(String(pos)) + ']</span>';
	    return '<span class="pitch-pattern" title="' + escapeHtml(String(reading) + ' pitch ' + String(pos)) + '"><span class="pitch-reading">' +
	      moras.map((mora, index) => '<span class="pitch-mora ' + pitchMoraClass(index, pos) + '">' + escapeHtml(mora) + '</span>').join('') +
	      '</span><span class="pitch-number">[' + escapeHtml(String(pos)) + ']</span></span>';
	  }
	  function renderEntryMetadata(term) {
	    const chips = [];
	    const frequencies = Array.isArray(term && term.frequencies) ? term.frequencies : [];
	    frequencies.forEach(entry => {
	      const dict = String(entry.dict || entry.dictName || entry.dictionary || '');
	      const values = Array.isArray(entry.frequencies) ? entry.frequencies : [];
	      const display = values.map(v => normalizeWhitespace((v && (v.displayValue || v.display_value)) || (v && v.value !== undefined ? String(v.value) : ''))).filter(Boolean).join(', ');
	      if (!dict && !display) return;
	      overlayDebug("frequency metadata detected dict=" + JSON.stringify(dict) + " values=" + values.length);
	      chips.push('<span class="freq-chip" title="' + escapeHtml((dict || 'Frequency') + (display ? ' ' + display : '')) + '"><span class="meta-label">' + escapeHtml(dict || 'Frequency') + '</span>' + (display ? ' ' + escapeHtml(display) : '') + '</span>');
	    });
	    const pitches = Array.isArray(term && term.pitches) ? term.pitches : [];
	    pitches.forEach(entry => {
	      const dict = String(entry.dict || entry.dictName || entry.dictionary || '');
	      const positions = Array.isArray(entry.positions) ? entry.positions : (Array.isArray(entry.pitchPositions) ? entry.pitchPositions : (Array.isArray(entry.pitch_positions) ? entry.pitch_positions : []));
	      const transcriptions = Array.isArray(entry.transcriptions) ? entry.transcriptions : [];
	      const reading = String((term && term.reading) || (term && term.expression) || '');
	      const patterns = reading ? positions.slice(0, 4).map(pos => renderPitchPattern(reading, pos)).filter(Boolean) : [];
	      const bits = [];
	      if (!patterns.length && positions.length) bits.push(positions.map(v => String(v)).join(', '));
	      if (transcriptions.length) bits.push(transcriptions.map(v => normalizeWhitespace(v)).filter(Boolean).join(', '));
	      const display = patterns.length ? patterns.join('') + (positions.length > patterns.length ? '<span class="pitch-more">+' + escapeHtml(String(positions.length - patterns.length)) + '</span>' : '') : '<span class="pitch-text">' + escapeHtml(bits.filter(Boolean).join(' · ')) + '</span>';
	      const titleDisplay = positions.length ? positions.map(v => String(v)).join(', ') : bits.filter(Boolean).join(' · ');
	      if (!dict && !display) return;
	      overlayDebug("pitch accent metadata detected dict=" + JSON.stringify(dict) + " positions=" + positions.length + " transcriptions=" + transcriptions.length);
	      chips.push('<span class="pitch-group" title="' + escapeHtml((dict || 'Pitch') + (titleDisplay ? ' ' + titleDisplay : '')) + '"><span class="pitch-source-chip">' + escapeHtml(dict || 'Pitch') + '</span><span class="pitch-patterns">' + display + '</span></span>');
	    });
	    return chips.length ? '<div class="entry-meta-row">' + chips.join('') + '</div>' : '';
	  }
	  function displayHeadwordForEntry(entry) {
	    const term = entry && entry.term ? entry.term : {};
	    return String(term.expression || entry.deinflected || entry.matched || '');
	  }
	  function lookupSurfaceForResult(result, entry) {
	    if (result && /^(ja|zh)$/.test(String(result.language || '')) && entry && entry.matched) return String(entry.matched);
	    const candidate = result && result.candidateUsed ? result.candidateUsed : null;
	    if (candidate && candidate.displayText) return String(candidate.displayText);
	    if (result && typeof result.text === 'string') {
	      const start = Number(result.lookupStart);
	      const end = Number(result.lookupEnd);
	      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
	        const surface = Array.from(result.text).slice(start, end).join('');
	        if (surface) return surface;
	      }
	    }
	    if (entry && entry.matched) return String(entry.matched);
	    if (result && result.lookupText) return String(result.lookupText);
	    return '';
	  }
	  function displayHeaderForResult(result, firstEntry) {
	    const heading = displayHeadwordForEntry(firstEntry);
	    const term = firstEntry && firstEntry.term ? firstEntry.term : {};
	    const reading = term.reading ? String(term.reading) : '';
	    const surface = lookupSurfaceForResult(result, firstEntry);
	    const secondary = surface && compareTextKey(surface) !== compareTextKey(heading)
	      ? 'looked up from: ' + surface
	      : '';
	    overlayDebug("display headword selected heading=" + JSON.stringify(heading) + " surface=" + JSON.stringify(surface) + " secondary=" + JSON.stringify(secondary));
	    return { heading, reading, secondary };
	  }
	  function audioDataForEntry(entry) {
	    if (!entry) return null;
	    const term = entry.term || {};
	    const expression = displayHeadwordForEntry(entry);
	    if (!expression) return null;
	    return { term: expression, reading: String(term.reading || '') };
	  }
	  function maybeAutoPlayEntryAudio(stored, entry) {
	    if (!state.config || !state.config.audioAutoPlay) return;
	    const data = audioDataForEntry(entry);
	    if (!data || !activeAudioSources().length) return;
	    const key = String(state.lineId) + ':' + String(stored && stored.position !== undefined ? stored.position : state.currentPos) + ':' + audioTermReadingKey(data.term, data.reading);
	    if (state.audioAutoPlayed[key]) return;
	    state.audioAutoPlayed[key] = true;
	    playAudioForTerm(data.term, data.reading, null, { auto: true }).catch(() => {});
	  }
	  function renderStoredLookup(stored) {
    if (!stored || !stored.ok) {
      setPopupBody('<div class="error">' + escapeHtml((stored && stored.error) || 'Lookup failed') + '</div>');
      return;
    }
    const result = stored.result || {};
    const entries = Array.isArray(result.results) ? result.results : [];
    if (!entries.length) {
      const lang = activeLanguage();
      const label = lang.lookupUnit === 'word' || lang.wordMode === 'latin-word' || lang.wordMode === 'korean-run' ? 'word' : 'character';
      activateNoResultMatch(stored);
      overlayDebug("render no-result pos=" + String(state.currentPos) + " lookupStart=" + String(result.lookupStart) + " lookupEnd=" + String(result.lookupEnd) + " reason=" + String(result.noResultReason || "empty"));
      setPopupBody('<div class="empty">No dictionary entry found from this ' + label + '.</div>');
      return;
    }
	    const first = entries[0];
	    const header = displayHeaderForResult(result, first);
	    const headerAudio = audioDataForEntry(first);
	    if (state.currentPos !== null && state.currentPos !== undefined) {
	      activateStoredMatch(stored, lookupPreviewForPosition(state.currentPos));
	    }
	    const maxEntries = Math.max(1, state.config.maxEntries || 3);
	    const maxGlosses = Math.max(1, state.config.maxGlossesPerEntry || 4);
    let html = '';
	    entries.slice(0, maxEntries).forEach((entry, entryIndex) => {
	      const term = entry.term || {};
	      html += '<div class="entry">';
	      if (term.expression || term.reading) {
	        const entryHeadword = displayHeadwordForEntry(entry);
	        const repeatsHeader = entryIndex === 0 &&
	          compareTextKey(entryHeadword) === compareTextKey(header.heading) &&
	          compareTextKey(term.reading || '') === compareTextKey(header.reading || '');
	        if (!repeatsHeader) {
	          const entryAudio = audioDataForEntry(entry);
	          html += '<div class="dict-term"><span class="dict-term-text">' + escapeHtml(entryHeadword) + (term.reading ? '<span class="dict-reading">' + escapeHtml(term.reading) + '</span>' : '') + '</span>' + (entryAudio ? renderAudioButtonHtml(entryAudio.term, entryAudio.reading) : '') + '</div>';
	        }
	      }
	      html += renderEntryMetadata(term);
      const glossaries = Array.isArray(term.glossaries) ? term.glossaries : [];
      glossaries.slice(0, maxGlosses).forEach(g => {
        html += '<div class="dict-section">';
        html += '<div class="dict-header">';
        if (g.dict) html += '<span class="dict-name">' + escapeHtml(g.dict) + '</span>';
        html += '</div>';
        html += renderGlossaryPayload(g);
        html += '</div>';
      });
      if (Array.isArray(entry.trace) && entry.trace.length) html += '<div class="trace">' + escapeHtml(entry.trace.map(t => t.name || '').filter(Boolean).join(' → ')) + '</div>';
      html += '</div>';
    });
	    setPopupBody(html, header.heading, header.reading, header.secondary, headerAudio);
	    maybeAutoPlayEntryAudio(stored, first);
	  }

  function updateCharReady(pos) {
    const run = findLookupRun(pos);
    const start = run && Number.isFinite(Number(run.start)) ? Number(run.start) : pos;
    const end = run && Number.isFinite(Number(run.end)) ? Number(run.end) : pos + 1;
    for (let i = start; i < end; i++) {
      const el = charElementAt(i);
      if (el) el.classList.add('ready');
    }
  }
  function formatElapsed(ms) {
    ms = Math.max(0, Number(ms) || 0);
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? (String(m) + ':' + String(s).padStart(2, '0')) : (String(s) + 's');
  }

  function hideTaskPanel(delayMs) {
    if (state.taskTimer) { clearInterval(state.taskTimer); state.taskTimer = null; }
    const hide = () => { taskEl.classList.add('hidden'); taskEl.innerHTML = ''; state.task = null; };
    if (delayMs && delayMs > 0) setTimeout(hide, delayMs);
    else hide();
  }

  function renderTaskPanel() {
    const task = state.task;
    if (!task) { hideTaskPanel(0); return; }
    const elapsed = formatElapsed(Date.now() - (task.localStartedAt || Date.now()));
    const cls = task.done ? (task.success ? 'done' : 'error') : '';
    taskEl.className = cls;
    taskEl.innerHTML =
      '<div class="task-head"><div class="task-title">' + escapeHtml(task.title || 'Working…') + '</div><div class="task-elapsed">' + escapeHtml(elapsed) + '</div></div>' +
      '<div class="task-message">' + escapeHtml(task.message || '') + '</div>' +
      (task.detail ? '<div class="task-detail">' + escapeHtml(task.detail) + '</div>' : '') +
      '<div class="task-bar"><div class="task-fill"></div></div>';
  }

  function setTaskStatus(payload) {
    if (!payload) return;
    if (payload.active === false) {
      const existing = state.task || {};
      state.task = Object.assign({}, existing, payload, {
        done: true,
        title: existing.title || payload.title || (payload.success ? 'Done' : 'Failed'),
        message: payload.message || (payload.success ? 'Done.' : 'Failed.'),
        detail: payload.detail || existing.detail || '',
        localStartedAt: existing.localStartedAt || Date.now()
      });
      renderTaskPanel();
      hideTaskPanel(payload.success ? (payload.ttlMs || 6500) : 0);
      return;
    }
    const first = !state.task || state.task.id !== payload.id;
    state.task = Object.assign({}, first ? {} : state.task, payload, {
      done: false,
      localStartedAt: first ? Date.now() : (state.task.localStartedAt || Date.now())
    });
    renderTaskPanel();
    if (!state.taskTimer) {
      state.taskTimer = setInterval(renderTaskPanel, 1000);
    }
  }

  function setStatus(payload) {
    const msg = payload && payload.message ? String(payload.message) : '';
    if (!msg) { statusEl.classList.add('hidden'); statusEl.textContent = ''; return; }
    statusEl.textContent = msg;
    statusEl.className = payload.kind === 'error' ? 'error' : '';
    statusEl.classList.remove('hidden');
  }

  iina.onMessage('config', payload => applyConfig(payload));
  iina.onMessage('enabled', payload => {
    state.enabled = !!(payload && payload.enabled);
    if (!state.enabled) renderSubtitle('', state.lineId);
    else renderSubtitle(state.text, state.lineId);
  });
  iina.onMessage('subtitle', payload => {
    if (payload && payload.config) applyConfig(payload.config);
    renderSubtitle(payload && payload.text ? payload.text : '', payload && payload.lineId ? payload.lineId : 0);
  });
  iina.onMessage('line-lookup-reset', payload => {
    if (!payload || Number(payload.lineId || 0) === state.lineId) { state.lookupByPos = Object.create(null); state.progress = null; state.audioAutoPlayed = Object.create(null); }
  });
  iina.onMessage('line-lookup-progress', payload => {
    if (!payload || Number(payload.lineId || 0) !== state.lineId) return;
    state.progress = payload;
    if (payload.message && payload.ok === false) setStatus({ message: payload.message, kind: 'error' });
  });
  iina.onMessage('lookup-request-ack', payload => {
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

  iina.onMessage('line-lookup-result', payload => {
    if (!payload || Number(payload.lineId || 0) !== state.lineId) return;
    const pos = Number(payload.position || 0);
    if (state.pendingLookupTimers[pos]) {
      clearTimeout(state.pendingLookupTimers[pos]);
      delete state.pendingLookupTimers[pos];
    }
    cancelPendingLookupRequest(pos);
    overlayDebug("lookup result received pos=" + pos + " ok=" + String(!!payload.ok) + " currentPos=" + String(state.currentPos) + " noResult=" + String(!!(payload.result && payload.result.noResult)));
    state.lookupByPos[pos] = payload;
    updateCharReady(pos);
    if (state.currentPos === pos && !popupEl.classList.contains('hidden')) renderStoredLookup(payload);
  });
  iina.onMessage('status', setStatus);
  iina.onMessage('task-status', setTaskStatus);

  window.addEventListener('resize', () => {
    if (state.currentAnchor && !popupEl.classList.contains('hidden')) placePopup(state.currentAnchor);
  });

  // Keep the documented ready message, but v1.3.0 no longer depends on it.
  try { iina.postMessage('ready', { ready: true, popupSessionId: state.popupSessionId, at: Date.now() }); } catch (_) {}
})();
