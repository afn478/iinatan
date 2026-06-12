function mockLongestRightwardLookup(text, position, dictionary, scanLength) {
  const chars = charsOf(text);
  const suffix = chars.slice(position).join("");
  let best = "";
  const maxChars = Math.min(scanLength || 24, charsOf(suffix).length);
  for (let len = maxChars; len >= 1; len--) {
    const candidate = charsOf(suffix).slice(0, len).join("");
    if (dictionary.indexOf(candidate) >= 0) { best = candidate; break; }
  }
  return best;
}
function runLookupParserUnitTests() {
  const tests = [
    { text: "何回見てもきれいだ", pos: 0, dict: ["何", "何回", "回", "見る"], expected: "何回" },
    { text: "魔法をかけられるのは魔法使いだけだ", pos: 0, dict: ["魔法", "魔法使い", "使い"], expected: "魔法" },
    { text: "魔法をかけられるのは魔法使いだけだ", pos: 10, dict: ["魔法", "魔法使い", "使い"], expected: "魔法使い" },
    { text: "スポーツ選手は生まれたときからスポーツ選手？", pos: 0, dict: ["スポーツ", "選手", "スポーツ選手"], expected: "スポーツ選手" },
    { text: "掛けられる前に逃げる", pos: 0, dict: ["掛け", "掛ける", "掛けられる"], expected: "掛けられる" }
  ];
  const failures = [];
  for (const t of tests) {
    const got = mockLongestRightwardLookup(t.text, t.pos, t.dict, 24);
    if (got !== t.expected) failures.push(t.text + " @" + t.pos + " expected " + t.expected + " got " + got);
  }
  if (failures.length) alert("Lookup parser unit tests failed:\n" + failures.join("\n"));
  else alert("Lookup parser unit tests passed: " + tests.length + "/" + tests.length + ".");
}
function runLanguageUnitTests() {
  const failures = [];
  function check(ok, message) { if (!ok) failures.push(message); }
  const ja = languageModuleById("ja");
  const en = languageModuleById("en");
  const fr = languageModuleById("fr");
  const de = languageModuleById("de");
  const zh = languageModuleById("zh");
  const ko = languageModuleById("ko");
  check(ja.isHoverableChar("魔"), "Japanese kanji should be hoverable");
  check(!ja.isHoverableChar("r"), "Latin should not be Japanese-hoverable");
  check(en.isHoverableChar("r"), "Latin should be English-hoverable");
  check(ja.lookupMode === "yomitan-japanese", "Japanese should declare Yomitan/HoshiDicts mode");
  check(en.lookupMode === "exact", "English should declare exact lookup mode");
  check(fr.lookupMode === "exact", "French should declare exact lookup mode");
  check(de.lookupMode === "exact", "German should declare exact lookup mode");
  check(zh.lookupMode === "prefix", "Chinese should declare prefix lookup mode");
  check(ko.lookupMode === "exact", "Korean should declare exact lookup mode");
  check(typeof en.dictionaryMatches === "function", "English should expose dictionary compatibility checks");
  check(typeof fr.dictionaryMatches === "function", "French should expose dictionary compatibility checks");
  check(typeof de.dictionaryMatches === "function", "German should expose dictionary compatibility checks");
  check(ja.lookupUnit === "character", "Japanese should use character lookup units");
  check(en.lookupUnit === "word", "English should use word lookup units");
  check(fr.lookupUnit === "word", "French should use word lookup units");
  check(de.lookupUnit === "word", "German should use word lookup units");
  check(zh.lookupUnit === "character", "Chinese should use character lookup units");
  const englishText = "I am running fast";
  const enReq = en.lookupRequest(englishText, charsOf(englishText).indexOf("n"), 24);
  check(enReq && enReq.lookupText === "running", "English hover inside running should query running");
  check(enReq && enReq.suffix !== "nning", "English should not query partial rightward suffixes");
  check(enReq && enReq.backendMode === "exact", "English should use exact lookup");
  check(enReq && enReq.cacheStrategy === "word-span", "English should use word-span cache semantics");
  check(en.lookupRequest("RUNNING", 1, 24).lookupText === "running", "English should lowercase lookup text");
  check(en.lookupRequest("Don't", 1, 24).lookupText === "don't", "English should preserve apostrophes while lowercasing");
  const frReq = fr.lookupRequest("L’Homme", 2, 24);
  check(frReq && frReq.candidates.some(c => c.text === "homme"), "French should generate elision-tail candidates");
  const deReq = de.lookupRequest("Ich stehe morgen früh auf.", 5, 24);
  check(deReq && deReq.candidates.some(c => c.text === "aufstehen"), "German should generate split-verb candidates");
  check(fr.lookupRequest("mangent", 2, 24).candidates.some(c => c.text === "manger"), "French should load Yomitan present-indicative rules");
  check(de.lookupRequest("Die Sammlung ist groß", 5, 24).candidates.some(c => c.text === "sammeln"), "German should load Yomitan -lung rules");
  const zhReq = zh.lookupRequest("我喜欢中文", 0, 4);
  check(zhReq && zhReq.lookupText === "我喜欢中" && zhReq.backendMode === "prefix", "Chinese should use bounded prefix lookup");
  const jaReq = ja.lookupRequest("魔法使い", 1, 24);
  check(jaReq && jaReq.lookupText === "法使い", "Japanese should keep rightward-prefix lookup");
  check(jaReq && jaReq.cacheStrategy === "exact-position", "Japanese should keep exact-position cache semantics");
  const koReq = ko.lookupRequest("한국어 공부", 1, 24);
  check(koReq && koReq.lookupText === "한국어", "Korean should query the contiguous Hangul run");
  if (failures.length) alert("Language unit tests failed:\n" + failures.join("\n"));
  else alert("Language unit tests passed.");
}
function runSettingsAuditChecks() {
  const failures = [];
  function check(ok, message) { if (!ok) failures.push(message); }
  const cfg = overlayConfig();
  check(cfg.language && cfg.language.id, "language config should be present");
  check(Number.isFinite(Number(cfg.scanLength)) && cfg.scanLength >= 1, "scanLength should be numeric");
  check(Number.isFinite(Number(cfg.maxEntries)) && cfg.maxEntries >= 1, "maxEntries should be numeric");
  check(Number.isFinite(Number(cfg.maxGlossesPerEntry)) && cfg.maxGlossesPerEntry >= 1, "maxGlossesPerEntry should be numeric");
  check(Number.isFinite(Number(cfg.popupMaxHeightVh)) && cfg.popupMaxHeightVh >= 20, "popupMaxHeightVh should be sent to overlay");
  check(Number.isFinite(Number(cfg.popupSubtitleGapPx)) && cfg.popupSubtitleGapPx >= 12, "popupSubtitleGapPx should be sent to overlay");
  check(cfg.etymologyCollapseDefault === "collapsed" || cfg.etymologyCollapseDefault === "expanded", "etymologyCollapseDefault should be sent to overlay");
  check(["collapsed", "expanded", "inherit"].indexOf(cfg.wiktionaryEtymologyCollapseOverride) >= 0, "wiktionaryEtymologyCollapseOverride should be sent to overlay");
  check(typeof cfg.customPopupCss === "string", "customPopupCss should be sent to overlay as a string");
  check(typeof prefBool("directWorkerIpc", true) === "boolean", "directWorkerIpc should be boolean-readable");
  check(typeof prefBool("fallbackToClientExec", true) === "boolean", "fallbackToClientExec should be boolean-readable");
  check(Number.isFinite(prefNumber("directIpcPollMs", 2)), "directIpcPollMs should be numeric");
  check(Number.isFinite(prefNumber("workerIdleSleepMs", 2)), "workerIdleSleepMs should be numeric");
  if (failures.length) alert("Settings audit checks failed:\n" + failures.join("\n"));
  else alert("Settings audit checks passed.");
}
function testBackendLookup() {
  (async () => {
    try {
      const result = await lookupAtPosition("魔法をかけられるのは魔法使いだけだ", 0);
      const count = result && result.results ? result.results.length : 0;
      alert("Lookup test returned " + count + " result(s). Top match: " + (count ? result.results[0].matched : "none"));
    } catch (error) { alert("Lookup test failed: " + compactError(error)); }
  })();
}
function restartBackendWorkerFromMenu() {
  (async () => {
    try {
      const language = selectedLanguageModule();
      await stopBackendWorker();
      await ensureBackendWorker(activeDictionaryPaths(language), language);
      alert("Dictionary lookup restarted for " + language.label + ".");
    } catch (error) { alert("Could not restart dictionary lookup: " + compactError(error)); }
  })();
}
function stopBackendWorkerFromMenu() {
  (async () => { await stopBackendWorker(); alert("Dictionary lookup stopped."); })();
}
function showInstalledDictionaries() {
  const dicts = dictionaryDirs();
  const disabled = disabledDictionaryMap();
  if (!dicts.length) { alert("No dictionaries installed yet. Download recommended dictionaries or import a Yomitan dictionary ZIP."); return; }
  alert("Installed dictionaries:\n\n" + dicts.map(d => (disabled[d.name] ? "[off] " : "[on] ") + d.name).join("\n"));
}
function emitDebugLogTestMessage() {
  debugLog("DEBUG TEST: plugin main log path works; enabled=" + String(enabled) + " lineId=" + currentSubtitleLineId + " bridgePort=" + overlayBridgePort);
  debugWarn("DEBUG TEST: warning level message");
  debugError("DEBUG TEST: error level message");
  showOSD("iinatan debug test emitted");
}
function revealDebugLogFile() {
  try {
    const p = dataPath("debug.log");
    flushDebugLogBuffer();
    if (!file.exists(p)) file.write(p, "");
    file.showInFinder(p);
  } catch (error) {
    notify("Could not reveal debug.log: " + compactError(error), "error", 8000);
  }
}

function lookupBenchmarkCases() {
  const sentences = [
    "魔法使いにはなれないのだ",
    "いいなぁ 魔法使いに生まれた人は。",
    "シーツよ　シーツ。",
    "煙色の布が欲しいんですが 忙しいならあとでも…。",
    "正確には彼女の記憶だけが頼りだった。",
    "昨日からずっと雨が降り続いている。",
    "この世界では魔法を使える者だけが選ばれる。",
    "彼は何も言わずに部屋を出て行った。",
    "知らない町で道に迷ってしまった。",
    "それでも私は諦めるつもりはない。",
    "本当に必要なものは目に見えない。",
    "急に風が強くなって窓が揺れた。",
    "明日の朝までに準備しておいてください。",
    "子供のころから星を見るのが好きだった。",
    "彼女は小さな声でありがとうと言った。"
  ];
  const out = [];
  sentences.forEach(sentence => {
    const chars = charsOf(cleanSubtitleText(sentence));
    for (let i = 0; i < chars.length; i++) {
      if (isJapaneseish(chars[i])) out.push({ sentence, position: i, char: chars[i] });
      if (out.length >= 80) break;
    }
  });
  return out.slice(0, 80);
}
function summarizeTimings(label, samples) {
  const ok = samples.filter(s => s.ok);
  const failed = samples.filter(s => !s.ok);
  const times = ok.map(s => s.elapsedMs).sort((a, b) => a - b);
  const pick = p => times.length ? times[Math.min(times.length - 1, Math.max(0, Math.floor((times.length - 1) * p)))] : 0;
  const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  return {
    label,
    total: samples.length,
    ok: ok.length,
    failed: failed.length,
    min: times[0] || 0,
    median: pick(0.5),
    p95: pick(0.95),
    max: times[times.length - 1] || 0,
    avg
  };
}
function logTimingSummary(summary) {
  debugLog("BENCH " + summary.label + " total=" + summary.total + " ok=" + summary.ok + " failed=" + summary.failed + " min=" + summary.min + "ms median=" + summary.median + "ms avg=" + summary.avg + "ms p95=" + summary.p95 + "ms max=" + summary.max + "ms");
}
async function runLookupPerformanceBenchmark() {
  try {
    debugLog("BENCH starting lookup performance benchmark directIpc=" + String(prefBool("directWorkerIpc", true)) + " fallback=" + String(prefBool("fallbackToClientExec", true)));
    showOSD("iinatan lookup benchmark started");
    const language = selectedLanguageModule();
    const dicts = activeDictionaryPaths(language);
    if (!dicts.length) throw new Error("No enabled dictionaries installed.");
    await ensureBackendWorker(dicts, language);
    lookupCache = Object.create(null);

    const cases = lookupBenchmarkCases();
    const seqSamples = [];
    const seqStart = Date.now();
    for (let i = 0; i < Math.min(30, cases.length); i++) {
      const c = cases[i];
      const started = Date.now();
      try {
        const r = await lookupAtPosition(c.sentence, c.position, "bench-seq-" + i);
        seqSamples.push({ ok: true, elapsedMs: Date.now() - started, count: r && r.results ? r.results.length : 0 });
      } catch (error) {
        seqSamples.push({ ok: false, elapsedMs: Date.now() - started, error: compactError(error) });
      }
    }
    const seqSummary = summarizeTimings("sequential", seqSamples);
    seqSummary.wallMs = Date.now() - seqStart;
    logTimingSummary(seqSummary);
    debugLog("BENCH sequential wallMs=" + seqSummary.wallMs);

    lookupCache = Object.create(null);
    const burstCases = cases.slice(0, 40);
    const burstStart = Date.now();
    const burstSamples = await Promise.all(burstCases.map(async (c, i) => {
      const started = Date.now();
      try {
        const r = await lookupAtPosition(c.sentence, c.position, "bench-burst-" + i);
        return { ok: true, elapsedMs: Date.now() - started, count: r && r.results ? r.results.length : 0 };
      } catch (error) {
        return { ok: false, elapsedMs: Date.now() - started, error: compactError(error) };
      }
    }));
    const burstSummary = summarizeTimings("burst40", burstSamples);
    burstSummary.wallMs = Date.now() - burstStart;
    logTimingSummary(burstSummary);
    debugLog("BENCH burst40 wallMs=" + burstSummary.wallMs);

    const failed = seqSamples.concat(burstSamples).filter(s => !s.ok).slice(0, 5);
    if (failed.length) debugWarn("BENCH failures sample=" + JSON.stringify(failed));
    showOSD("iinatan benchmark done: seq median " + seqSummary.median + "ms, burst p95 " + burstSummary.p95 + "ms");
    alert("Lookup benchmark complete.\n\nSequential median: " + seqSummary.median + " ms\nSequential p95: " + seqSummary.p95 + " ms\nBurst p95: " + burstSummary.p95 + " ms\n\nSee debug.log / IINA Log Viewer for full details.");
  } catch (error) {
    const msg = "Lookup benchmark failed: " + compactError(error);
    debugError(msg);
    alert(msg);
  }
}

function showTaskPanelTest() {
  const id = startOverlayTask("debug-task", "Task panel test", "This is where dictionary progress appears.");
  updateOverlayTask(id, { title: "Task panel test", message: "Visible at top-center of the video overlay.", detail: "If you can see this panel, dictionary downloads and imports can show progress here." });
  setTimeout(() => finishOverlayTask(id, true, "Task panel test complete.", "The task panel will auto-hide shortly."), 4500);
}

function rebuildMenu() {
  try { menu.removeAllItems(); } catch (_) {}
  try {
    addMenuItemSafe(menu.item("Settings...", () => { openDictionaryManager(); }));
    addMenuItemSafe(menu.separator());
    const profiles = profileSummaries(readManifest());
    if (profiles.length) {
      if (profiles.length === 1) {
        addMenuItemSafe(menu.item(profiles[0].name, null, { selected: true, enabled: false }));
      } else {
        profiles.forEach(profile => {
          addMenuItemSafe(menu.item(profile.name, () => { setActiveDictionaryProfile(profile.id); }, { selected: !!profile.active }));
        });
      }
    }

    addMenuItemSafe(menu.separator());
    addMenuItemSafe(menu.item("Toggle iinatan (Shift+H)", () => setEnabled(!enabled), { selected: enabled }));

    const debugMenu = menu.item("Debug");
    addSubMenuItemCompat(debugMenu, menu.item("Run Lookup Performance Benchmark", () => runLookupPerformanceBenchmark()));
    addSubMenuItemCompat(debugMenu, menu.item("Run Lookup Parser Unit Tests", () => runLookupParserUnitTests()));
    addSubMenuItemCompat(debugMenu, menu.item("Run Language Unit Tests", () => runLanguageUnitTests()));
    addSubMenuItemCompat(debugMenu, menu.item("Run Settings Audit Checks", () => runSettingsAuditChecks()));
    addSubMenuItemCompat(debugMenu, menu.item("Test File Picker API", () => testFilePickerApiFromMenu()));
    addSubMenuItemCompat(debugMenu, menu.item("Test Dictionary Lookup", () => testBackendLookup()));
    addSubMenuItemCompat(debugMenu, menu.item("Restart Dictionary Lookup", () => restartBackendWorkerFromMenu()));
    addSubMenuItemCompat(debugMenu, menu.item("Stop Dictionary Lookup", () => stopBackendWorkerFromMenu()));
    addSubMenuItemCompat(debugMenu, menu.item("Show Task Panel Test", () => showTaskPanelTest()));
    addSubMenuItemCompat(debugMenu, menu.item("Emit Debug Log Test Message", () => emitDebugLogTestMessage()));
    addSubMenuItemCompat(debugMenu, menu.item("Reveal Debug Log File", () => revealDebugLogFile()));
    addSubMenuItemCompat(debugMenu, menu.item("Reveal Plugin Data Folder", () => { try { file.showInFinder(dataRoot()); } catch (_) { utils.open(dataRoot()); } }));
    addMenuItemSafe(debugMenu);
  } catch (error) {
    console.error("Could not rebuild iinatan menu: " + compactError(error));
  }
}
