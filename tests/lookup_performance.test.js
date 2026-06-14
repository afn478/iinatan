const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { performance } = require("perf_hooks");
const { loadOverlayForTest } = require("./helpers/overlay_test_context");

const root = path.resolve(__dirname, "..");
const defaultDataRoot = path.join(
  os.homedir(),
  "Library/Application Support/com.colliderli.iina/plugins/.data/com.afn478.iinatan",
);
const defaultSrtPath =
  "/Volumes/Media Files/anime/MARRIAGETOXIN/Season 01/MARRIAGETOXIN (2026) - S01E01 - The Poison Masters Search for a Bride [HDTV-1080p][AAC 2.0][x265]-DKB.ja.hi.srt";

const FIRST_MINUTE_SRT = String.raw`1
00:00:16,739 --> 00:00:17,657
（社長）フウ…

2
00:00:18,157 --> 00:00:20,451
人のぬくもりを
モットーに

3
00:00:21,077 --> 00:00:22,370
（人間椅子）
うぐっ…

4
00:00:22,453 --> 00:00:25,873
人間家具を創設し
15年

5
00:00:25,957 --> 00:00:28,501
幾度も倒産の危機に
陥ったが

6
00:00:28,584 --> 00:00:30,044
その度に

7
00:00:30,127 --> 00:00:31,879
あらゆる
非道な手を尽くして

8
00:00:31,963 --> 00:00:33,255
立て直した

9
00:00:33,339 --> 00:00:35,049
（拍手）
（社長）その積み重ねが

10
00:00:35,132 --> 00:00:37,885
今日という日に
結実したんだ

11
00:00:37,969 --> 00:00:38,928
（毒見役）うん

12
00:00:40,012 --> 00:00:41,097
デリシャス

13
00:00:41,180 --> 00:00:42,556
毒物は ありません

14
00:00:42,640 --> 00:00:45,017
ノープロブレムです
プレジデント

15
00:00:45,601 --> 00:00:47,853
（社長）
タモツ それからナツミさん

16
00:00:48,354 --> 00:00:49,730
結婚おめでとう

17
00:00:49,814 --> 00:00:53,359
丈夫な後継ぎの男の子を
ドバドバ産んでくれ

18
00:00:53,442 --> 00:00:54,276
（客たちの笑い声）

19
00:00:54,360 --> 00:00:55,736
乾杯！

20
00:00:55,820 --> 00:00:57,405
（客たち）乾杯！

21
00:00:59,490 --> 00:01:00,366
（社長）ん？`;

const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u9fff々〆ヵヶー]/;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function charsOf(text) {
  return Array.from(String(text || ""));
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanSubtitleText(text) {
  return decodeEntities(String(text || ""))
    .replace(/\uFEFF/g, "")
    .replace(/\{\\[^}]+\}/g, "")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+\n/g, "\n")
    .replace(/\n[ \t\f\v]+/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/[ \t\f\v]{2,}/g, " ")
    .trim();
}

function parseTimeMs(raw) {
  const match = String(raw || "").match(/^(\d+):(\d+):(\d+),(\d+)$/);
  if (!match) return 0;
  return (
    ((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) *
      1000 +
    Number(match[4])
  );
}

function parseSrtCues(text, cutoffMs) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) return null;
      const start = parseTimeMs(lines[timingIndex].split(/\s+-->\s+/)[0]);
      const cueText = cleanSubtitleText(
        lines.slice(timingIndex + 1).join("\n"),
      );
      return cueText ? { start, text: cueText } : null;
    })
    .filter((cue) => cue && cue.start < cutoffMs);
}

function readSubtitleFixture() {
  const requested = process.env.IINATAN_PERF_SRT || defaultSrtPath;
  if (requested && fs.existsSync(requested))
    return fs.readFileSync(requested, "utf8");
  return FIRST_MINUTE_SRT;
}

function lookupTextForCase(text, position, scanLength) {
  const chars = charsOf(text);
  const pos = Math.max(0, Math.min(Number(position) || 0, chars.length));
  const length = Math.min(
    chars.length - pos,
    Math.max(1, Number(scanLength) || 24),
  );
  return chars.slice(pos, pos + length).join("");
}

function buildLookupCases(cues, scanLength) {
  const limit = Math.max(1, Number(process.env.IINATAN_PERF_CASE_LIMIT || 240));
  const out = [];
  for (let cueIndex = 0; cueIndex < cues.length; cueIndex++) {
    const cue = cues[cueIndex];
    const chars = charsOf(cue.text);
    for (let position = 0; position < chars.length; position++) {
      if (!JAPANESE_RE.test(chars[position])) continue;
      out.push({
        cueIndex,
        lineId: cueIndex + 1,
        text: cue.text,
        position,
        char: chars[position],
        lookupText: lookupTextForCase(cue.text, position, scanLength),
      });
      if (out.length >= limit) break;
    }
    if (out.length >= limit) break;
  }
  return out;
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function activeDictionaryPaths(dataRoot) {
  const dictRoot = path.join(dataRoot, "dictionaries");
  if (!fs.existsSync(dictRoot)) return [];
  const installed = fs
    .readdirSync(dictRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const installedSet = new Set(installed);
  const manifest = readJsonFile(path.join(dataRoot, "manifest.json"), {});
  const activeProfile =
    manifest.profiles &&
    manifest.profiles[manifest.activeProfileId || "default"];
  const disabled =
    (activeProfile && activeProfile.disabled) || manifest.disabled || {};
  const requestedOrder =
    (activeProfile && activeProfile.dictionaryOrder) ||
    manifest.dictionaryOrder ||
    [];
  const ordered = [];
  const used = new Set();
  requestedOrder.forEach((name) => {
    if (installedSet.has(name) && !used.has(name)) {
      used.add(name);
      ordered.push(name);
    }
  });
  installed.forEach((name) => {
    if (!used.has(name)) ordered.push(name);
  });
  return ordered
    .filter((name) => !disabled[name])
    .map((name) => path.join(dictRoot, name));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p)),
  );
  return sorted[index];
}

function summarize(label, samples) {
  const ok = samples.filter((sample) => sample.ok);
  const failed = samples.filter((sample) => !sample.ok);
  const times = ok.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const total = times.reduce((sum, value) => sum + value, 0);
  return {
    label,
    total: samples.length,
    ok: ok.length,
    failed: failed.length,
    min: times.length ? Math.round(times[0]) : 0,
    median: Math.round(percentile(times, 0.5)),
    p90: Math.round(percentile(times, 0.9)),
    p95: Math.round(percentile(times, 0.95)),
    max: times.length ? Math.round(times[times.length - 1]) : 0,
    avg: times.length ? Math.round(total / times.length) : 0,
    resultCountAvg: ok.length
      ? Math.round(
          ok.reduce((sum, sample) => sum + (sample.resultCount || 0), 0) /
            ok.length,
        )
      : 0,
    bytesAvg: ok.length
      ? Math.round(
          ok.reduce((sum, sample) => sum + (sample.bytes || 0), 0) / ok.length,
        )
      : 0,
  };
}

function printSummary(summary) {
  console.log(
    `${summary.label}: total=${summary.total} ok=${summary.ok} failed=${summary.failed}` +
      ` min=${summary.min}ms median=${summary.median}ms avg=${summary.avg}ms` +
      ` p90=${summary.p90}ms p95=${summary.p95}ms max=${summary.max}ms` +
      ` avgResults=${summary.resultCountAvg} avgBytes=${summary.bytesAvg}`,
  );
}

class HoshiWorker {
  constructor(binary, dicts) {
    this.binary = binary;
    this.dicts = dicts;
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-perf-worker-"));
    this.proc = null;
    this.stderr = "";
  }

  async start() {
    fs.mkdirSync(path.join(this.root, "queue"), { recursive: true });
    fs.mkdirSync(path.join(this.root, "responses"), { recursive: true });
    fs.mkdirSync(path.join(this.root, "state"), { recursive: true });
    const config =
      [
        "version\tperf-test",
        "fingerprint\tperf-test",
        "language\tja",
        `home\t${os.homedir()}`,
        "path\t/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Xcode.app/Contents/Developer/usr/bin",
        ...this.dicts.map((dict) => `dict\t${dict}`),
      ].join("\n") + "\n";
    fs.writeFileSync(path.join(this.root, "config.tsv"), config);
    this.proc = spawn(this.binary, ["worker", this.root, "--sleep-ms", "1"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.proc.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-8000);
    });
    this.proc.on("exit", (code) => {
      if (code !== 0 && code !== null)
        this.stderr += `\nworker exited with ${code}`;
    });
    const readyPath = path.join(this.root, "state", "ready.json");
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (fs.existsSync(readyPath)) return readJsonFile(readyPath, null);
      if (this.proc.exitCode !== null)
        throw new Error(`worker exited before ready: ${this.stderr}`);
      await delay(10);
    }
    throw new Error(`worker did not become ready: ${this.stderr}`);
  }

  async lookup(testCase, mode, scanLength) {
    const requestId = `n${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const reqPath = path.join(this.root, "queue", `${requestId}.json`);
    const respPath = path.join(this.root, "responses", `${requestId}.json`);
    const payload = {
      requestId,
      text: testCase.lookupText,
      scanLength: Math.max(
        1,
        charsOf(testCase.lookupText).length || scanLength,
      ),
      maxResults: 3,
      maxGlossaries: 4,
      mode,
    };
    fs.writeFileSync(reqPath, JSON.stringify(payload) + "\n");
    const started = performance.now();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (fs.existsSync(respPath)) {
        const raw = fs.readFileSync(respPath, "utf8");
        fs.rmSync(respPath, { force: true });
        fs.rmSync(reqPath, { force: true });
        const parsed = JSON.parse(raw);
        return {
          ok: parsed && parsed.ok !== false,
          elapsedMs: performance.now() - started,
          result: parsed,
          resultCount:
            parsed && Array.isArray(parsed.results) ? parsed.results.length : 0,
          bytes: raw.length,
        };
      }
      if (this.proc.exitCode !== null)
        throw new Error(`worker exited during lookup: ${this.stderr}`);
      await delay(1);
    }
    fs.rmSync(reqPath, { force: true });
    throw new Error(
      `lookup timed out for ${JSON.stringify(testCase.lookupText)}: ${this.stderr}`,
    );
  }

  async stop() {
    try {
      fs.writeFileSync(path.join(this.root, "stop"), "stop\n");
    } catch (_) {}
    if (this.proc && this.proc.exitCode === null) {
      await Promise.race([
        new Promise((resolve) => this.proc.once("exit", resolve)),
        delay(1200).then(() => {
          try {
            this.proc.kill("SIGTERM");
          } catch (_) {}
        }),
      ]);
    }
    fs.rmSync(this.root, { recursive: true, force: true });
  }
}

function pluginResultForCase(nativeResult, testCase, mode) {
  const chars = charsOf(testCase.text);
  const lookupChars = charsOf(testCase.lookupText);
  const hasResult = !!(
    nativeResult &&
    Array.isArray(nativeResult.results) &&
    nativeResult.results.length
  );
  const candidate = {
    text: testCase.lookupText,
    source: "lookupText",
    reason: "single lookup text",
    language: "ja",
    displayText: testCase.lookupText,
  };
  return Object.assign({}, nativeResult, {
    ok: true,
    text: testCase.text,
    position: testCase.position,
    suffix: chars.slice(testCase.position).join(""),
    lookupText: testCase.lookupText,
    lookupCandidates: [candidate],
    candidateUsed: hasResult ? candidate : null,
    lookupStart: testCase.position,
    lookupEnd: testCase.position + lookupChars.length,
    matchStart: testCase.position,
    language: "ja",
    backendMode: mode,
    noResult: !hasResult,
    noResultReason: hasResult ? "" : "all-candidates-empty",
    lookupCacheKey: `char:${testCase.position}:${testCase.lookupText}`,
  });
}

async function runBackendPass(worker, cases, mode, scanLength, label) {
  const samples = [];
  for (const testCase of cases) {
    try {
      const sample = await worker.lookup(testCase, mode, scanLength);
      samples.push(sample);
    } catch (error) {
      samples.push({ ok: false, elapsedMs: 0, error: error.message });
    }
  }
  const summary = summarize(label, samples);
  printSummary(summary);
  return { summary, samples };
}

async function runOverlayPass(worker, cases, scanLength) {
  const { context, overlay } = loadOverlayForTest([
    "state",
    "applyConfig",
    "renderSubtitle",
    "subtitleEl",
    "popupEl",
  ]);
  overlay.applyConfig({
    language: {
      id: "ja",
      label: "Japanese",
      lookupUnit: "character",
      wordMode: "rightward-prefix",
    },
    overlayBridgePort: 19741,
    maxEntries: 3,
    maxGlossesPerEntry: 4,
    scanLength,
    debugLogVerbose: false,
  });
  context.__handlers.enabled({ enabled: true });
  const samples = [];
  let currentCueIndex = -1;
  for (const testCase of cases) {
    try {
      if (testCase.cueIndex !== currentCueIndex) {
        overlay.renderSubtitle(testCase.text, testCase.lineId);
        currentCueIndex = testCase.cueIndex;
      }
      const el = overlay.subtitleEl.querySelector(
        `.char.lookupable[data-pos="${testCase.position}"]`,
      );
      if (!el || !el.listeners.mouseenter)
        throw new Error(`no hoverable element at ${testCase.position}`);
      const sentBefore = context.__sent.length;
      const started = performance.now();
      el.listeners.mouseenter({ currentTarget: el });
      const lookupMessage = context.__sent
        .slice(sentBefore)
        .find((message) => message.type === "lookup");
      if (!lookupMessage)
        throw new Error("overlay did not send lookup message");
      const nativeSample = await worker.lookup(
        testCase,
        "yomitan-japanese",
        scanLength,
      );
      const result = pluginResultForCase(
        nativeSample.result,
        testCase,
        "yomitan-japanese",
      );
      context.__handlers["line-lookup-result"]({
        lineId: lookupMessage.lineId,
        position: lookupMessage.position,
        ok: true,
        result,
        hover: true,
        requestId: lookupMessage.requestId,
      });
      samples.push({
        ok: true,
        elapsedMs: performance.now() - started,
        resultCount: nativeSample.resultCount,
        bytes: nativeSample.bytes,
      });
    } catch (error) {
      samples.push({ ok: false, elapsedMs: 0, error: error.message });
    }
  }
  const summary = summarize("overlay-to-render simulated", samples);
  printSummary(summary);
  return { summary, samples };
}

async function main() {
  const dataRoot = process.env.IINATAN_PERF_DATA_ROOT || defaultDataRoot;
  const binary =
    process.env.IINATAN_PERF_BIN || path.join(root, "bin", "iina-hoshi-dicts");
  if (!fs.existsSync(binary)) {
    console.log(
      `lookup performance tests skipped: missing backend binary at ${binary}`,
    );
    return;
  }
  if (!fs.existsSync(dataRoot)) {
    console.log(
      `lookup performance tests skipped: missing IINA data root at ${dataRoot}`,
    );
    return;
  }
  const dicts = activeDictionaryPaths(dataRoot);
  if (!dicts.length) {
    console.log(
      `lookup performance tests skipped: no enabled dictionaries in ${dataRoot}`,
    );
    return;
  }
  const scanLength = Math.max(
    1,
    Number(process.env.IINATAN_PERF_SCAN_LENGTH || 24),
  );
  const cues = parseSrtCues(readSubtitleFixture(), 60000);
  const cases = buildLookupCases(cues, scanLength);
  if (!cases.length)
    throw new Error(
      "no Japanese lookup cases were parsed from the first-minute subtitles",
    );

  console.log(
    `lookup performance fixture: ${cues.length} first-minute cues, ${cases.length} hover cases, ${dicts.length} enabled dictionaries`,
  );
  const worker = new HoshiWorker(binary, dicts);
  try {
    const ready = await worker.start();
    console.log(`worker ready: dictCount=${ready && ready.dictCount}`);
    await worker.lookup(cases[0], "yomitan-japanese", scanLength);
    const backend = await runBackendPass(
      worker,
      cases,
      "yomitan-japanese",
      scanLength,
      "backend worker yomitan-japanese",
    );
    await runBackendPass(
      worker,
      cases,
      "prefix",
      scanLength,
      "backend worker prefix probe",
    );
    const overlay = await runOverlayPass(
      worker,
      cases.slice(0, Math.min(cases.length, 60)),
      scanLength,
    );

    if (backend.summary.ok && backend.summary.p95 > 1000) {
      throw new Error(`backend p95 exceeded 1000ms (${backend.summary.p95}ms)`);
    }
    if (overlay.summary.ok && overlay.summary.p95 > 1500) {
      throw new Error(
        `simulated overlay p95 exceeded 1500ms (${overlay.summary.p95}ms)`,
      );
    }
  } finally {
    await worker.stop();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
