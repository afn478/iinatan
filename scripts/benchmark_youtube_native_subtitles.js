#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFile, execFileSync } = require("child_process");
const { performance } = require("perf_hooks");

const [baselineRef = "main", candidateRef = "HEAD", videoUrl = ""] =
  process.argv.slice(2);
const iterations = Number(process.env.IINATAN_YOUTUBE_PERF_ITERATIONS) || 5000;
const samples = Number(process.env.IINATAN_YOUTUBE_PERF_SAMPLES) || 7;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function source(ref, file) {
  if (ref === "WORKTREE")
    return fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
  return execFileSync("git", ["show", `${ref}:${file}`], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

function revision(ref) {
  return ref === "WORKTREE" ? ref : git(["rev-parse", ref]);
}

function medianBenchmark(run) {
  run();
  run();
  const times = [];
  for (let sample = 0; sample < samples; sample++) {
    const started = performance.now();
    run();
    times.push(performance.now() - started);
  }
  times.sort((left, right) => left - right);
  return (times[Math.floor(times.length / 2)] * 1000) / iterations;
}

function edl(url) {
  return `edl://!no_clip;!delay_open,media_type=sub;%${url.length}%${url}`;
}

function track(index, selected, url) {
  const captionUrl =
    url ||
    `https://www.youtube.com/api/timedtext?v=fixture&lang=ja${index}&fmt=srt`;
  return {
    type: "sub",
    id: index + 1,
    selected,
    "main-selection": selected ? 0 : -1,
    codec: "null",
    "codec-desc": "Unknown",
    external: true,
    "external-filename": edl(captionUrl),
  };
}

function curlRequest(args, event) {
  return new Promise((resolve) => {
    const started = performance.now();
    execFile(
      "/usr/bin/curl",
      args,
      { encoding: "utf8", maxBuffer: 9 * 1024 * 1024 },
      (error, stdout, stderr) => {
        event.ms = performance.now() - started;
        event.bytes = Buffer.byteLength(stdout || "", "utf8");
        event.status = error ? Number(error.code) || 1 : 0;
        resolve({ status: event.status, stdout: stdout || "", stderr });
      },
    );
  });
}

function nativeHarness(ref, live) {
  const events = [];
  const pending = [];
  const context = {
    console,
    JSON,
    Object,
    String,
    Number,
    Math,
    Array,
    Intl,
    Promise,
    setTimeout,
    clearTimeout,
    Date,
    nativeExternalSrtCache: Object.create(null),
    nativeExternalSrtInFlight: Object.create(null),
    nativeExternalSrtGeneration: 0,
    utils: {
      exec(command, args) {
        const event = {
          command,
          args: Array.from(args || []),
          ms: 0,
          bytes: 0,
          status: 0,
        };
        events.push(event);
        const request =
          live && command === "/usr/bin/curl"
            ? curlRequest(event.args, event)
            : Promise.resolve({ status: 0, stdout: "", stderr: "" });
        pending.push(request);
        return request;
      },
    },
    dataRoot: () => "/tmp",
    putBoundedCache: (cache, key, value) => (cache[key] = value),
    file: { read: () => "" },
    scheduleExperimentalNativeLayoutRebuild() {},
    mpvNumberProp: () => 0,
    cleanNativeDisplayText: (value) => String(value || ""),
    normalizeExperimentalSubtitleText: (value) => String(value || ""),
    prefBool: (_name, fallback) => fallback,
    selectedLanguageModule: () => ({ id: "ja" }),
    IINATAN_LANGUAGE_COMMON: {
      normalizeBasic: (value) => String(value || "").normalize("NFKC"),
    },
    IINATAN_LOOKUP_CHARACTER_POLICY: { matches: () => true },
  };
  vm.createContext(context);
  vm.runInContext(
    source(ref, "src/main/05_media_source.js") +
      source(ref, "src/main/12_native_subtitle_hit_layer.js") +
      `
globalThis.benchmarkApi = {
  nativeSubtitleTrackEligibility,
  nativeExternalSrtEventBlocks,
};`,
    context,
  );
  return { api: context.benchmarkApi, events, pending };
}

function pollHarness(ref, eligibility, tracks) {
  const counts = { snapshots: 0, normalizations: 0 };
  const text = "字幕の性能測定";
  const context = {
    console,
    JSON,
    String,
    Array,
    enabled: true,
    lastSubtitle: null,
    lastSubtitleCueIdentity: null,
    lastNativeLayoutFingerprint: "",
    nativeLayoutStablePolls: 0,
    lastNativePollInputIdentity: "",
    lastNativeSnapshotSettled: false,
    nativeSubtitleLayoutInvalidated: false,
    mpv: { getString: (name) => (name === "sub-text" ? text : "") },
    mpvStringProp: (names, fallback) => (names[0] === "sid" ? "1" : fallback),
    refreshPollingInterval() {},
    syncNativeSubtitleVisibility() {},
    readCurrentSubtitle() {
      counts.normalizations++;
      return text;
    },
    readExperimentalLookupSubtitle: () => text,
    nativeSubtitleHitLayerMode: () => true,
    nativeSubtitleCombinedCueSnapshot() {
      counts.snapshots++;
      eligibility(tracks, 1, "no", "primary");
      return {
        kind: "srt",
        trackId: 1,
        displayText: text,
        lookupText: text,
        surfaces: [
          {
            kind: "srt",
            trackId: 1,
            layout: { width: 1920, height: 1080, fontSize: 55 },
          },
        ],
      };
    },
    nativeSubtitleCueSnapshot() {
      throw new Error("combined snapshot helper was not used");
    },
    currentSubtitleCueIdentity: (cue) =>
      `${cue.kind || cue.reason}:${cue.trackId || 0}`,
    reportNativeAssReadiness() {},
    scheduleExperimentalNativeLayoutRebuild() {},
    publishSubtitle() {},
  };
  const subtitleSource = source(ref, "src/main/10_subtitle_text_style.js");
  vm.createContext(context);
  vm.runInContext(
    subtitleSource.slice(
      subtitleSource.indexOf("function pollSubtitle"),
      subtitleSource.indexOf("function charsOf"),
    ) +
      `
globalThis.pollApi = {
  pollSubtitle,
  reset() {
    lastSubtitle = null;
    lastSubtitleCueIdentity = null;
    lastNativeLayoutFingerprint = "";
    nativeLayoutStablePolls = 0;
    lastNativePollInputIdentity = "";
    lastNativeSnapshotSettled = false;
  },
};`,
    context,
  );
  return { api: context.pollApi, counts };
}

function liveCaption(url) {
  const executable =
    process.env.IINATAN_YOUTUBE_DL ||
    "/Applications/IINA.app/Contents/MacOS/youtube-dl";
  if (!fs.existsSync(executable))
    throw new Error("IINA youtube-dl is required for a live measurement");
  const started = performance.now();
  const info = JSON.parse(
    execFileSync(
      executable,
      [
        "--no-warnings",
        "--no-playlist",
        "--skip-download",
        "--dump-single-json",
        url,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    ),
  );
  for (const language of ["ja-orig", "ja"]) {
    for (const [kind, captions] of [
      ["subtitles", info.subtitles],
      ["automatic-captions", info.automatic_captions],
    ]) {
      const format = ((captions && captions[language]) || []).find(
        (item) => item.ext === "srt",
      );
      if (format && format.url)
        return {
          url: format.url,
          videoId: info.id,
          language,
          kind,
          extractionMs: performance.now() - started,
        };
    }
  }
  throw new Error("video has no Japanese SRT captions");
}

async function startupMetrics(harness, subtitleTrack) {
  harness.api.nativeExternalSrtEventBlocks(
    subtitleTrack,
    "primary",
    "字幕の性能測定",
    "字幕の性能測定",
    0,
    "字幕の性能測定",
  );
  await Promise.resolve();
  await Promise.all(harness.pending);
  const curls = harness.events.filter(
    (event) => event.command === "/usr/bin/curl",
  );
  if (curls.some((event) => event.status !== 0))
    throw new Error("live caption transfer failed");
  return {
    downloads: curls.length,
    timeoutSeconds: curls.reduce((maximum, event) => {
      const index = event.args.indexOf("--max-time");
      return Math.max(maximum, Number(event.args[index + 1]) || 0);
    }, 0),
    ms: curls.reduce((total, event) => total + event.ms, 0),
    bytes: curls.reduce((total, event) => total + event.bytes, 0),
  };
}

async function measure(ref, live) {
  const tracks = Array.from({ length: 81 }, (_, index) =>
    track(index, index === 0),
  );
  const native = nativeHarness(ref, !!live);
  const eligibility = native.api.nativeSubtitleTrackEligibility;
  const selectionUs = medianBenchmark(() => {
    for (let index = 0; index < iterations; index++)
      eligibility(tracks, 1, "no", "primary");
  });
  const polling = pollHarness(ref, eligibility, tracks);
  const runPolls = () => {
    polling.api.reset();
    polling.counts.snapshots = 0;
    polling.counts.normalizations = 0;
    for (let index = 0; index < iterations; index++) polling.api.pollSubtitle();
  };
  const pollUs = medianBenchmark(runPolls);
  runPolls();
  return {
    commit: ref === "WORKTREE" ? ref : git(["rev-parse", "--short=12", ref]),
    startup: await startupMetrics(
      native,
      live ? track(0, true, live.url) : tracks[0],
    ),
    selectionUs,
    pollUs,
    ...polling.counts,
  };
}

function reduction(baseline, candidate) {
  return baseline ? `${((1 - candidate / baseline) * 100).toFixed(2)}%` : "n/a";
}

(async () => {
  if (revision(baselineRef) === revision(candidateRef))
    throw new Error("baseline and candidate revisions must differ");
  const live = videoUrl ? liveCaption(videoUrl) : null;
  const baseline = await measure(baselineRef, live);
  const candidate = await measure(candidateRef, live);
  console.log(
    `YouTube native subtitles: ${baseline.commit} -> ${candidate.commit}`,
  );
  console.table([
    {
      metric: "duplicate caption downloads",
      baseline: baseline.startup.downloads,
      candidate: candidate.startup.downloads,
      improvement: reduction(
        baseline.startup.downloads,
        candidate.startup.downloads,
      ),
    },
    {
      metric: "caption request timeout ceiling (s)",
      baseline: baseline.startup.timeoutSeconds,
      candidate: candidate.startup.timeoutSeconds,
      improvement: reduction(
        baseline.startup.timeoutSeconds,
        candidate.startup.timeoutSeconds,
      ),
    },
    ...(live
      ? [
          {
            metric: "live caption transfer (ms)",
            baseline: baseline.startup.ms.toFixed(1),
            candidate: candidate.startup.ms.toFixed(1),
            improvement: reduction(baseline.startup.ms, candidate.startup.ms),
          },
          {
            metric: "live duplicate caption bytes",
            baseline: baseline.startup.bytes,
            candidate: candidate.startup.bytes,
            improvement: reduction(
              baseline.startup.bytes,
              candidate.startup.bytes,
            ),
          },
        ]
      : []),
    {
      metric: `full snapshots / ${iterations} stable polls`,
      baseline: baseline.snapshots,
      candidate: candidate.snapshots,
      improvement: reduction(baseline.snapshots, candidate.snapshots),
    },
    {
      metric: `normalizations / ${iterations} stable polls`,
      baseline: baseline.normalizations,
      candidate: candidate.normalizations,
      improvement: reduction(baseline.normalizations, candidate.normalizations),
    },
    {
      metric: "selected-track median (us/call)",
      baseline: baseline.selectionUs.toFixed(3),
      candidate: candidate.selectionUs.toFixed(3),
      improvement: `${(baseline.selectionUs / candidate.selectionUs).toFixed(2)}x`,
    },
    {
      metric: "stable-poll median (us/poll)",
      baseline: baseline.pollUs.toFixed(3),
      candidate: candidate.pollUs.toFixed(3),
      improvement: `${(baseline.pollUs / candidate.pollUs).toFixed(2)}x`,
    },
  ]);
  console.log(
    `Fixture: 81 caption tracks, ${iterations} polls, median of ${samples} samples.`,
  );
  if (live)
    console.log(
      `Live video ${live.videoId}: ${live.language} ${live.kind}; shared yt-dlp extraction ${live.extractionMs.toFixed(1)} ms excluded.`,
    );
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
