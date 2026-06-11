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
      maxEntries: 3,
      maxGlossesPerEntry: 4,
      scanLength: 24,
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
    popupVisibilitySeq: 0,
    lookupRequestSeq: 0,
    pendingLookupTimers: Object.create(null),
    pendingLookupRequests: Object.create(null),
    task: null,
    taskTimer: null
  };

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
    if (lang.id === 'en') return /[A-Za-zÀ-ÖØ-öø-ÿ0-9'’-]/.test(s);
    if (lang.id === 'ko') return /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(s);
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
    const len = Math.max(1, state.config.scanLength || 24);
    return { start: pos, end: Math.min(state.chars.length, pos + len), text: state.chars.slice(pos, pos + len).join('') };
  }

  function lookupUnitForPosition(pos) {
    const preview = lookupPreviewForPosition(pos);
    const run = findLookupRun(pos);
    const canonicalPos = run ? run.start : pos;
    return {
      pos: canonicalPos,
      key: String(canonicalPos),
      preview,
      isWord: !!run
    };
  }

  function lookupAnchorForUnit(unit, fallback) {
    if (unit && unit.isWord) {
      const el = subtitleEl.querySelector('.char.lookupable[data-pos="' + String(unit.pos) + '"]');
      if (el) return el;
    }
    return fallback || null;
  }

  function applyConfig(config) {
    state.config = Object.assign({}, state.config, config || {});
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
    if (state.config.overlayBridgePort) {
      state.bridgePort = Number(state.config.overlayBridgePort);
      ensureBridgeSocket();
    }
    overlayDebug("config applied bridgePort=" + String(state.bridgePort) + " popupScale=" + String(state.config.popupScale));
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
    state.lookupByPos = Object.create(null);
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
      const el = subtitleEl.querySelector('.char.lookupable[data-pos="' + String(start + i) + '"]');
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
    overlayDebug("char enter rawPos=" + rawPos + " unitPos=" + pos + " word=" + String(unit.isWord) + " char=" + JSON.stringify(target.textContent || "") + " cached=" + String(!!state.lookupByPos[pos]));
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
    showPopup(anchor, preview.text, '<div class="loading">' + escapeHtml('Looking up…') + '</div>');
    requestLookupFromPlugin(pos);
  }

  function scheduleHidePopup() {
    if (state.hideTimer) clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => hidePopup(), 240);
  }
  popupEl.addEventListener('mouseenter', () => { if (state.hideTimer) clearTimeout(state.hideTimer); });
  popupEl.addEventListener('mouseleave', scheduleHidePopup);
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
          sendBridgePopupVisibility(true);
          if (state.currentPos !== null && state.currentPos !== undefined && !state.lookupByPos[state.currentPos]) requestLookupFromPlugin(state.currentPos);
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
    return sendBridgeMessage({ type: 'popup', visible: !!visible, seq: state.popupVisibilitySeq, at: Date.now() });
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

    const trySend = () => {
      if (!state.pendingLookupRequests[pos] || req.sent || state.lookupByPos[pos] || state.currentPos !== pos || state.lineId !== req.lineId) {
        if (!req.sent) cancelPendingLookupRequest(pos);
        return;
      }
      req.attempts++;
      overlayDebug("lookup send attempt requestId=" + req.requestId + " pos=" + pos + " attempt=" + req.attempts);
      req.sent = sendLookupRequestPayload(req);
      if (req.sent && req.retryTimer) {
        clearInterval(req.retryTimer);
        req.retryTimer = null;
      }
    };

    trySend();
    if (!req.sent) {
      req.retryTimer = setInterval(() => {
        trySend();
        if (req.sent || req.attempts >= 6) {
          if (req.retryTimer) clearInterval(req.retryTimer);
          req.retryTimer = null;
        }
      }, 200);
    }

    req.timeoutTimer = setTimeout(() => {
      cancelPendingLookupRequest(pos);
      if (!state.lookupByPos[pos] && state.currentPos === pos && state.lineId === req.lineId && !popupEl.classList.contains('hidden')) {
        setPopupBody('<div class="error">Lookup timed out. Move off the word and hover again to retry.</div>');
      }
    }, Math.max(5000, Number(state.config.hoverRequestTimeoutMs || 9000)));
  }

  function postLookupPopupVisibility(visible) {
    sendBridgePopupVisibility(visible);
    try { iina.postMessage('lookup-popup-visibility', visible ? 'show' : 'hide'); } catch (_) {}
    try { iina.postMessage('lookup-popup-visible', { visible: !!visible, seq: state.popupVisibilitySeq }); } catch (_) {}
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
    // v1.5.4 pause-only mode: send only the transition event. Heartbeats and
    // repeated hide packets were only needed for resume tracking and created
    // bridge traffic that could compete with lookup messages.
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

  function showPopup(anchor, heading, bodyHtml) {
    state.currentAnchor = anchor || null;
    popupEl.innerHTML = '<div class="head"><span class="term">' + escapeHtml(heading || '') + '</span></div><div class="body">' + bodyHtml + '</div>';
    markPopupClickable();
    popupEl.classList.remove('hidden');
    setLookupPopupVisibility(true);
    placePopup(anchor);
  }
  function setPopupBody(bodyHtml, heading, reading) {
    const head = popupEl.querySelector('.head');
    const body = popupEl.querySelector('.body');
    if (head && heading !== undefined) {
      head.innerHTML = '<span class="term">' + escapeHtml(heading || '') + '</span>' + (reading ? '<span class="reading">' + escapeHtml(reading) + '</span>' : '');
    }
    if (body) body.innerHTML = bodyHtml;
    markPopupClickable();
    if (state.currentAnchor && !popupEl.classList.contains('hidden')) placePopup(state.currentAnchor);
  }
  function markPopupClickable() {
    popupEl.setAttribute('data-clickable', 'true');
    popupEl.querySelectorAll('*').forEach(el => el.setAttribute('data-clickable', 'true'));
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
    const scale = Number(state.config.popupScale || 0.92);
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
    document.documentElement.style.setProperty('--popup-max-height', String(Math.floor(cappedHeight)) + 'px');

    popupEl.style.left = '0px';
    popupEl.style.top = '0px';
    const pr = popupEl.getBoundingClientRect();
    const popupW = pr.width / scale;
    const popupH = Math.min(pr.height / scale, cappedHeight);

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
      document.documentElement.style.setProperty('--popup-max-height', String(Math.floor(safeHeight)) + 'px');
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
  function renderInlineNode(node) {
    if (node == null) return '';
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return escapeHtml(String(node));
    if (Array.isArray(node)) return node.map(renderInlineNode).join('');
    if (typeof node === 'object') {
      if (node.type === 'structured-content') return renderInlineNode(node.content);
      const tag = node.tag || '';
      if (tag === 'ruby') return renderRubyNode(node);
      if (tag === 'rt') return '';
      if (tag === 'a') return '<span class="xref-link">' + renderInlineNode(node.content) + '</span>';
      return renderInlineNode(node.content);
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
  function renderExampleBox(node) {
    const jaNode = findNodes(node, n => n && n.data && n.data.content === 'example-sentence-a')[0];
    const enNode = findNodes(node, n => n && n.data && n.data.content === 'example-sentence-b')[0];
    const ja = jaNode ? renderInlineNode(jaNode.content) : '';
    const en = enNode ? renderInlineNode(enNode.content) : '';
    if (!ja && !en) return '';
    return '<div class="example-card">' + (ja ? '<div class="example-ja">' + ja + '</div>' : '') + (en ? '<div class="example-en">' + en + '</div>' : '') + '</div>';
  }
  function renderXrefBox(node) {
    const labelNode = findNodes(node, n => n && n.data && n.data.content === 'reference-label')[0];
    const glossNode = findNodes(node, n => n && n.data && n.data.content === 'xref-glossary')[0];
    const linkNodes = findNodes(node, n => n && n.tag === 'a');
    const label = labelNode ? plainTextFromNode(labelNode.content) : 'See also';
    const links = linkNodes.map(n => renderInlineNode(n.content)).filter(Boolean);
    const gloss = glossNode ? renderInlineNode(glossNode.content) : '';
    if (!links.length && !gloss) return '';
    return '<div class="xref-card">' + '<span class="xref-label">' + escapeHtml(label || 'See also') + '</span>' + (links.length ? '<div>' + links.join(' · ') + '</div>' : '') + (gloss ? '<div class="xref-glossary">' + gloss + '</div>' : '') + '</div>';
  }
  function renderStructuredNode(node) {
    if (node == null) return '';
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return escapeHtml(String(node));
    if (Array.isArray(node)) return node.map(renderStructuredNode).join('');
    if (typeof node !== 'object') return '';
    if (node.type === 'structured-content') return renderStructuredNode(node.content);
    const tag = node.tag || '';
    const data = node.data || {};
    const kind = data.content || '';
    const cls = data.class || '';
    if (kind === 'attribution') return '';
    if (kind === 'part-of-speech-info') return '<span class="pos-pill">' + escapeHtml(plainTextFromNode(node.content)) + '</span>';
    if (cls === 'extra-box' && kind === 'example-sentence') return renderExampleBox(node);
    if (cls === 'extra-box' && kind === 'xref') return renderXrefBox(node);
    if (kind === 'sense-groups') return '<div class="sense-groups">' + renderStructuredNode(node.content) + '</div>';
    if (kind === 'sense-group') return '<div class="sense-group">' + renderStructuredNode(node.content) + '</div>';
    if (kind === 'sense') return '<div class="sense-body">' + renderStructuredNode(node.content) + '</div>';
    if (kind === 'glossary' && (tag === 'ul' || tag === 'ol')) {
      return '<ol class="glossary-list tight">' + toArray(node.content).map(item => '<li>' + renderStructuredNode(item.content !== undefined ? item.content : item) + '</li>').join('') + '</ol>';
    }
    if (kind === 'extra-info') return '<div class="extra-info">' + renderStructuredNode(node.content) + '</div>';
    if (tag === 'ruby') return renderRubyNode(node);
    if (tag === 'rt') return '';
    if (tag === 'a') return '<span class="xref-link">' + renderStructuredNode(node.content) + '</span>';
    if (tag === 'ul') return '<ul class="glossary-list">' + toArray(node.content).map(item => '<li>' + renderStructuredNode(item.content !== undefined ? item.content : item) + '</li>').join('') + '</ul>';
    if (tag === 'ol') return '<ol class="glossary-list">' + toArray(node.content).map(item => '<li>' + renderStructuredNode(item.content !== undefined ? item.content : item) + '</li>').join('') + '</ol>';
    if (tag === 'li') return '<div>' + renderStructuredNode(node.content) + '</div>';
    return renderStructuredNode(node.content);
  }
  function renderGlossaryPayload(glossaryItem) {
    const parsed = parseGlossaryJson(glossaryItem && glossaryItem.glossary);
    const metaBits = [];
    if (glossaryItem && glossaryItem.definitionTags) metaBits.push('<span class="badge-star">' + escapeHtml(glossaryItem.definitionTags) + '</span>');
    if (glossaryItem && glossaryItem.termTags) metaBits.push('<span class="pos-pill">' + escapeHtml(glossaryItem.termTags) + '</span>');
    const metaRow = metaBits.length ? '<div class="note-row">' + metaBits.join(' ') + '</div>' : '';
    if (!parsed) {
      return metaRow + '<div class="gloss">' + escapeHtml(fallbackGlossaryText((glossaryItem && glossaryItem.glossary) || '')).replace(/\n/g, '<br>') + '</div>';
    }
    return metaRow + renderStructuredNode(parsed);
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
      setPopupBody('<div class="empty">No dictionary entry found from this ' + label + '.</div>');
      return;
    }
    const first = entries[0];
    const heading = first.matched || (first.term && first.term.expression) || '';
    if (state.currentPos !== null && state.currentPos !== undefined) {
      activateStoredMatch(stored, lookupPreviewForPosition(state.currentPos));
    }
    const reading = first.term && first.term.reading ? first.term.reading : '';
    const maxEntries = Math.max(1, state.config.maxEntries || 3);
    const maxGlosses = Math.max(1, state.config.maxGlossesPerEntry || 4);
    let html = '';
    entries.slice(0, maxEntries).forEach(entry => {
      const term = entry.term || {};
      html += '<div class="entry">';
      if (term.expression || term.reading) {
        html += '<div class="dict-term">' + escapeHtml(term.expression || entry.matched || '') + (term.reading ? '<span class="dict-reading">' + escapeHtml(term.reading) + '</span>' : '') + '</div>';
      }
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
    setPopupBody(html, heading, reading);
  }

  function updateCharReady(pos) {
    const run = findLookupRun(pos);
    const start = run && Number.isFinite(Number(run.start)) ? Number(run.start) : pos;
    const end = run && Number.isFinite(Number(run.end)) ? Number(run.end) : pos + 1;
    for (let i = start; i < end; i++) {
      const el = subtitleEl.querySelector('.char.lookupable[data-pos="' + String(i) + '"]');
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
    if (!payload || Number(payload.lineId || 0) === state.lineId) { state.lookupByPos = Object.create(null); state.progress = null; }
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
    overlayDebug("lookup result received pos=" + pos + " ok=" + String(!!payload.ok) + " currentPos=" + String(state.currentPos));
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
  try { iina.postMessage('ready', 'ready'); } catch (_) {}
})();
