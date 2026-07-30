#!/usr/bin/env node

const { spawn } = require("child_process");

const DEFAULT_TIMEOUT_MS = 180000;
const TESTS = [
  ["media", "tests/media_source.test.js"],
  ["language", "tests/languages.test.js"],
  ["dictionary", "tests/import_validation.test.js"],
  ["dictionary", "tests/dictionary_pipeline.test.js"],
  ["settings", "tests/profile_settings.test.js"],
  ["overlay", "tests/experimental_native_subtitle_hit_layer.test.js"],
  ["overlay", "tests/native_overlay_lifecycle.test.js"],
  ["settings", "tests/dictionary_import_manifest.test.js"],
  ["lookup", "tests/lookup_candidate_selection.test.js"],
  ["overlay", "tests/overlay_word_units.test.js"],
  ["overlay", "tests/overlay_dictionary_formatting.test.js"],
  ["overlay", "tests/overlay_nested_popups.test.js"],
  ["audio", "tests/overlay_audio.test.js"],
  ["anki", "tests/overlay_anki.test.js"],
  ["audio", "tests/audio_bridge.test.js"],
  ["anki", "tests/anki_card_context.test.js"],
  ["anki", "tests/anki_templates.test.js"],
  ["anki", "tests/anki_duplicates.test.js"],
  ["anki", "tests/anki_media_names.test.js"],
  ["anki", "tests/anki_note_actions.test.js"],
  ["anki", "tests/anki_connect.test.js"],
  ["anki", "tests/anki_integration.test.js"],
  ["bridge", "tests/overlay_bridge_latency.test.js"],
  ["bridge", "tests/worker_queue_publication.test.js"],
  ["overlay", "tests/popup_pause_preference.test.js"],
  ["settings", "tests/dictionary_manager_bridge.test.js"],
  ["settings", "tests/settings_menu_layout.test.js"],
  ["native-static", "tests/native_backend_schema.test.js"],
  ["native", "tests/native_ass_geometry.test.js"],
  ["diagnostics", "tests/debug_log_performance.test.js"],
  ["release", "tests/release_notes.test.js"],
  ["build", "tests/check_generated_syntax.js"],
  [
    "build",
    "scripts/build_plugin.py",
    ["--check-generated", "--validate"],
    "python3",
  ],
];

function parseArguments(argv) {
  const options = { groups: [], excludedGroups: [], list: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--list") options.list = true;
    else if (argument === "--group" && argv[index + 1])
      options.groups.push(argv[++index]);
    else if (argument === "--exclude-group" && argv[index + 1])
      options.excludedGroups.push(argv[++index]);
    else throw new Error("Unknown test-runner argument: " + argument);
  }
  return options;
}

function runOne(entry) {
  const [group, file, args = [], executable = process.execPath] = entry;
  const startedAt = process.hrtime.bigint();
  return new Promise((resolve) => {
    const child = spawn(executable, [file, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    let timedOut = false;
    let forceKillTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 2000);
    }, DEFAULT_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ group, file, ok: false, elapsedMs: 0, error });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      resolve({
        group,
        file,
        ok: code === 0 && !timedOut,
        elapsedMs,
        error: timedOut
          ? new Error("timed out")
          : code === 0
            ? null
            : new Error("exit " + String(code) + (signal ? "/" + signal : "")),
      });
    });
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const included = options.groups.length
    ? TESTS.filter(([group]) => options.groups.includes(group))
    : TESTS;
  const selected = included.filter(
    ([group]) => !options.excludedGroups.includes(group),
  );
  if (options.list) {
    selected.forEach(([group, file]) => console.log(group + "\t" + file));
    return;
  }
  if (!selected.length)
    throw new Error("No tests matched groups: " + options.groups.join(", "));

  const results = [];
  for (const entry of selected) {
    const result = await runOne(entry);
    results.push(result);
    console.log(
      "[" +
        (result.ok ? "pass" : "FAIL") +
        "] " +
        result.group +
        " " +
        result.file +
        " " +
        result.elapsedMs.toFixed(0) +
        "ms",
    );
  }

  const failures = results.filter((result) => !result.ok);
  const elapsedMs = results.reduce(
    (total, result) => total + result.elapsedMs,
    0,
  );
  console.log(
    "\n" +
      String(results.length - failures.length) +
      "/" +
      String(results.length) +
      " tests passed in " +
      (elapsedMs / 1000).toFixed(2) +
      "s",
  );
  if (failures.length) {
    failures.forEach((failure) => {
      console.error(
        "FAILED " +
          failure.group +
          " " +
          failure.file +
          ": " +
          failure.error.message,
      );
    });
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
