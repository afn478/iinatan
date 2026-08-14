#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const { performance } = require("perf_hooks");

const root = path.resolve(__dirname, "..");
const [baselineRef = "main", candidateRef = "WORKTREE"] = process.argv.slice(2);
const scale = Number(process.env.IINATAN_ANKI_PERF_SCALE) || 0.05;
const samples = Number(process.env.IINATAN_ANKI_PERF_SAMPLES) || 5;
const coldMountedMediaMs =
  Number(process.env.IINATAN_ANKI_COLD_MEDIA_MS) || 5670;
const cachedExcerptMs = Number(process.env.IINATAN_ANKI_CACHED_MEDIA_MS) || 120;
const runtimeFiles = [
  "src/main/05_media_source.js",
  "src/main/15_profile_settings.js",
  "src/main/50_overlay_bridge_pause.js",
  "src/main/51_anki_connect.js",
  "src/main/52_anki_card_context.js",
  "src/main/52_anki_templates.js",
  "src/main/53_anki_duplicates.js",
  "src/main/54_anki_media_names.js",
  "src/main/54_anki_note_actions.js",
  "src/main/55_anki_integration.js",
];

function source(ref, file) {
  if (ref === "WORKTREE") return fs.readFileSync(path.join(root, file), "utf8");
  return execFileSync("git", ["show", `${ref}:${file}`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 24 * 1024 * 1024,
  });
}

function revision(ref) {
  if (ref === "WORKTREE") return ref;
  return execFileSync("git", ["rev-parse", "--short", ref], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function virtualDelay(milliseconds) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, Number(milliseconds) * scale)),
  );
}

function makeHarness(ref, scenario) {
  const storedFiles = Object.create(null);
  const existingFiles = new Set(["/opt/homebrew/bin/ffmpeg"]);
  const events = [];
  const terminalWaiters = [];
  const templates = scenario.media
    ? {
        Expression: "{expression}",
        ExpressionAudio: "{audio}",
        MainDefinition: "{selected-glossary}",
        SentenceAudio: "{sentence-audio}",
        Picture: "{screenshot}",
      }
    : { Expression: "{expression}", MainDefinition: "{selected-glossary}" };
  const prefs = {
    ankiEnabled: true,
    ankiConnectUrl: "http://127.0.0.1:8765",
    ankiConnectTimeoutSeconds: 3,
    ankiDeckName: "Performance fixture",
    ankiModelName: "Lapis",
    ankiFieldTemplatesJson: JSON.stringify(templates),
    ankiTags: "iinatan",
    ankiAudioFormat: "opus",
    ankiAudioBitrateKbps: 96,
    ankiImageQuality: 85,
    ankiDuplicateCheck: true,
    ankiDuplicateMode: scenario.allowDuplicates ? "allow" : "prevent",
    ankiDuplicateScope: "deck",
    ankiSentenceAudioPaddingMs: 250,
    audioSourcesJson:
      '[{"url":"http://127.0.0.1:5050/?term={term}&reading={reading}"}]',
    lookupLanguage: "ja",
  };

  function record(kind, name, milliseconds) {
    events.push({ kind, name, milliseconds });
    return virtualDelay(milliseconds);
  }

  function actionResult(payload) {
    const action = String((payload && payload.action) || "");
    if (action === "multi")
      return ((payload.params && payload.params.actions) || []).map(
        (nested) => ({ result: actionResult(nested), error: null }),
      );
    if (action === "version") return 6;
    if (action === "modelFieldNames") return Object.keys(templates);
    if (action === "canAddNotesWithErrorDetail")
      return [
        scenario.duplicate
          ? {
              canAdd: false,
              error: "cannot create note because it is a duplicate",
            }
          : { canAdd: true, error: null },
      ];
    if (action === "findNotes") return scenario.duplicate ? [7654321] : [];
    if (action === "guiBrowse") return null;
    if (action === "storeMediaFile")
      return String(payload.params && payload.params.filename);
    if (action === "addNote") return 1234567;
    return null;
  }

  function actionDelay(payload, transport) {
    const action = String((payload && payload.action) || "");
    const server =
      action === "storeMediaFile"
        ? payload.params && payload.params.url
          ? 40
          : 20
        : action === "addNote"
          ? 20
          : action === "multi" ||
              action === "canAddNotesWithErrorDetail" ||
              action === "findNotes"
            ? 10
            : 5;
    return (transport === "curl" ? 25 : 2) + server;
  }

  async function invokeAnki(payload, transport) {
    await record(
      "anki",
      String(payload.action || ""),
      actionDelay(payload, transport),
    );
    return {
      statusCode: 200,
      data: { result: actionResult(payload), error: null },
    };
  }

  const mpvProperties = {
    "ab-loop-a": "no",
    "ab-loop-b": "no",
  };
  const context = {
    console,
    Date,
    Math,
    JSON,
    URL,
    Promise,
    setTimeout(callback, delay) {
      if (Number(delay) >= 50000) return { ignored: true };
      return setTimeout(callback, Math.max(0, Number(delay) * scale));
    },
    clearTimeout(timer) {
      if (!timer || timer.ignored) return;
      clearTimeout(timer);
    },
    scheduleOneShot(callback, delay) {
      return context.setTimeout(callback, delay);
    },
    cancelOneShot(timer) {
      context.clearTimeout(timer);
    },
    sleep: virtualDelay,
    putBoundedCache(cache, key, value) {
      cache[key] = value;
    },
    compactError(error) {
      return error && error.message ? error.message : String(error);
    },
    debugLog() {},
    debugVerbose() {},
    debugWarn() {},
    normalizePopupThemePreference(value) {
      return value;
    },
    preferences: { get: () => undefined },
    lastSubtitle: "その猫を見つけた。",
    dataRoot: () => "/fixture",
    dataPath: (...parts) => ["/fixture"].concat(parts).join("/"),
    file: {
      write(filePath, value) {
        storedFiles[filePath] = String(value || "");
        existingFiles.add(filePath);
      },
      read: (filePath) => storedFiles[filePath] || "",
      exists: (filePath) => existingFiles.has(String(filePath)),
      delete(filePath) {
        existingFiles.delete(String(filePath));
        delete storedFiles[filePath];
      },
    },
    safeDelete(filePath) {
      existingFiles.delete(String(filePath));
    },
    http: {
      post: (url, options) => invokeAnki(options.data || {}, "native"),
    },
    utils: {
      async exec(command, args) {
        const values = Array.from(args || []);
        if (command === "/usr/bin/curl") {
          const requestArg = values[values.indexOf("--data-binary") + 1] || "";
          if (String(requestArg).charAt(0) === "@") {
            const payload = JSON.parse(
              storedFiles[String(requestArg).slice(1)] || "{}",
            );
            const response = await invokeAnki(payload, "curl");
            return {
              status: 0,
              stdout: JSON.stringify(response.data),
              stderr: "",
            };
          }
          await record("process", "audio-source curl", 35);
          return {
            status: 0,
            stdout: JSON.stringify({
              type: "audioSourceList",
              audioSources: [
                { name: "fixture", url: "http://127.0.0.1:5050/audio.opus" },
              ],
            }),
            stderr: "",
          };
        }
        if (command === "/bin/mkdir") {
          await record("process", "mkdir", 5);
          return { status: 0, stdout: "", stderr: "" };
        }
        if (command === "/usr/bin/shasum" || command === "/sbin/md5") {
          await record(
            "process",
            path.basename(command),
            command.endsWith("md5") ? 2.4 : 10.6,
          );
          return {
            status: 0,
            stdout: "31e7209b34fb0123456789abcdef\n",
            stderr: "",
          };
        }
        if (/ffmpeg$/.test(command)) {
          const inputIndex = values.indexOf("-i");
          const input = inputIndex >= 0 ? values[inputIndex + 1] : "";
          const cached = String(input).startsWith("/fixture/anki-media/");
          await record(
            "process",
            cached ? "ffmpeg cached excerpt" : "ffmpeg mounted file",
            cached ? cachedExcerptMs : coldMountedMediaMs,
          );
          existingFiles.add(String(values[values.length - 1] || ""));
          return { status: 0, stdout: "", stderr: "" };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
    },
    mpv: {
      getString(name) {
        if (name === "media-title") return "MARRIAGETOXIN";
        if (name === "path") return "/Volumes/Media/MARRIAGETOXIN.mkv";
        if (name === "screenshot-jpeg-quality") return "85";
        if (Object.prototype.hasOwnProperty.call(mpvProperties, name))
          return mpvProperties[name];
        return "";
      },
      getNumber(name) {
        if (name === "time-pos") return 159;
        if (name === "sub-start") return 158;
        if (name === "sub-end") return 160.634;
        return 0;
      },
      set(name, value) {
        mpvProperties[name] = String(value);
      },
      command(name, args) {
        if (name === "ab-loop-align-cache") {
          mpvProperties["ab-loop-a"] = "156";
          mpvProperties["ab-loop-b"] = "161";
        }
        if (name === "screenshot-to-file")
          existingFiles.add(String(args[0] || ""));
        if (name === "dump-cache") existingFiles.add(String(args[2] || ""));
      },
    },
    postToOverlayBridge() {},
    postToDictionaryManager() {},
    postToOverlay(_name, payload) {
      if (payload && ["added", "opened", "error"].includes(payload.state))
        terminalWaiters.splice(0).forEach((resolve) => resolve(payload));
    },
  };

  vm.createContext(context);
  vm.runInContext(
    runtimeFiles.map((file) => source(ref, file)).join("\n"),
    context,
  );
  context.ankiActiveProfilePreferences = () =>
    context.normalizeProfilePreferences(prefs);
  context.currentMediaSourceSnapshot = () => ({
    display: { raw: "/Volumes/Media/MARRIAGETOXIN.mkv" },
    audio: {
      kind: "local-file",
      origin: "stream-open-filename",
      locator: "/Volumes/Media/MARRIAGETOXIN.mkv",
      ffmpegReadable: true,
    },
  });

  const payload = {
    requestId: "performance",
    popupSessionId: "performance-popup",
    context: {
      expression: "猫",
      reading: "ねこ",
      sentence: "その猫を見つけた。",
      position: 2,
      entry: { term: { expression: "猫", glossaries: [{ glossary: "cat" }] } },
    },
  };

  async function timed(operation) {
    const started = performance.now();
    await operation();
    return (performance.now() - started) / scale;
  }

  return {
    events,
    async run() {
      let preflightMs = 0;
      if (scenario.preflight)
        preflightMs = await timed(() =>
          context.ankiCardStatusForContext(payload),
        );
      events.length = 0;
      const exportMs = await timed(
        () =>
          new Promise((resolve, reject) => {
            terminalWaiters.push((result) =>
              result.state === "error"
                ? reject(new Error(result.message))
                : resolve(result),
            );
            context.handleBridgeAnkiCardAdd(payload);
          }),
      );
      return { preflightMs, exportMs, events: events.slice() };
    },
  };
}

async function benchmark(ref, scenario) {
  const results = [];
  for (let sample = 0; sample < samples; sample++)
    results.push(await makeHarness(ref, scenario).run());
  const representative = results.sort(
    (left, right) => left.exportMs - right.exportMs,
  )[Math.floor(results.length / 2)];
  return {
    preflightMs: median(results.map((result) => result.preflightMs)),
    exportMs: median(results.map((result) => result.exportMs)),
    ankiCalls: representative.events.filter((event) => event.kind === "anki")
      .length,
    processes: representative.events.filter((event) => event.kind === "process")
      .length,
    criticalMedia:
      representative.events
        .filter((event) => /ffmpeg/.test(event.name))
        .map((event) => event.name)
        .join(", ") || "none",
  };
}

(async () => {
  const scenarios = [
    { name: "full card after popup preflight", preflight: true, media: true },
    { name: "full card, cold direct click", preflight: false, media: true },
    { name: "text-only card after preflight", preflight: true, media: false },
    {
      name: "allow-duplicate full card",
      preflight: true,
      media: true,
      allowDuplicates: true,
    },
    {
      name: "prevented duplicate",
      preflight: false,
      media: true,
      duplicate: true,
    },
  ];
  console.log(
    `Anki export benchmark (simulated timing scale ${scale}, ${samples} samples)`,
  );
  console.log(`Baseline ${baselineRef} (${revision(baselineRef)})`);
  console.log(`Candidate ${candidateRef} (${revision(candidateRef)})`);
  for (const scenario of scenarios) {
    const baseline = await benchmark(baselineRef, scenario);
    const candidate = await benchmark(candidateRef, scenario);
    const improvement =
      ((baseline.exportMs - candidate.exportMs) / baseline.exportMs) * 100;
    console.log(`\n${scenario.name}`);
    console.log(
      `  baseline  preflight=${baseline.preflightMs.toFixed(0)}ms export=${baseline.exportMs.toFixed(0)}ms total=${(baseline.preflightMs + baseline.exportMs).toFixed(0)}ms calls=${baseline.ankiCalls} processes=${baseline.processes} media=${baseline.criticalMedia}`,
    );
    console.log(
      `  candidate preflight=${candidate.preflightMs.toFixed(0)}ms export=${candidate.exportMs.toFixed(0)}ms total=${(candidate.preflightMs + candidate.exportMs).toFixed(0)}ms calls=${candidate.ankiCalls} processes=${candidate.processes} media=${candidate.criticalMedia}`,
    );
    console.log(`  export improvement=${improvement.toFixed(1)}%`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
