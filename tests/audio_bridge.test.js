const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const sourceUrl =
  "http://audio-source.invalid/?term=%E8%AA%AD%E3%82%80&reading=%E3%82%88%E3%82%80";
const execCalls = [];
const nativeHttpCalls = [];

const context = {
  console,
  EXTERNAL_PROCESS_PRIORITY_INTERACTIVE: 10,
  execExternalProcess(command, args, cwd) {
    return context.utils.exec(command, args, cwd);
  },
  dataRoot() {
    return "/data";
  },
  compactError(error) {
    return error && error.message ? error.message : String(error);
  },
  debugVerbose() {},
  debugWarn() {},
  postToOverlay() {},
  scheduleOneShot(callback, delay) {
    return setTimeout(callback, delay);
  },
  cancelOneShot(timer) {
    clearTimeout(timer);
  },
  http: {
    async get(url, options) {
      nativeHttpCalls.push({ url, options });
      return {
        statusCode: 200,
        text: JSON.stringify({
          type: "audioSourceList",
          audioSources: [{ name: "local", url: "/audio/local.opus" }],
        }),
      };
    },
  },
  utils: {
    async exec(command, args, cwd) {
      execCalls.push({ command, args, cwd });
      return {
        status: 0,
        stdout: JSON.stringify({
          type: "audioSourceList",
          audioSources: [
            { name: "NHK16", url: "/nhk16/audio/reading.opus" },
            { name: "bad", url: "ftp://example.invalid/audio.mp3" },
            { url: "https://audio-cdn.invalid/jpod/audio.mp3" },
          ],
        }),
        stderr: "",
      };
    },
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

vm.createContext(context);
vm.runInContext(
  fs.readFileSync(
    path.join(root, "src/main/50_overlay_bridge_pause.js"),
    "utf8",
  ),
  context,
);

(async () => {
  const [candidates, sharedCandidates] = await Promise.all([
    context.fetchAudioSourceCandidates(sourceUrl),
    context.fetchAudioSourceCandidates(sourceUrl),
  ]);
  assert(
    execCalls.length === 1,
    "Concurrent resolution of one audio source should share one curl request",
  );
  assert(
    JSON.stringify(candidates) === JSON.stringify(sharedCandidates),
    "Shared audio-source requests should return the same candidates",
  );
  assert(
    execCalls[0].command === "/usr/bin/curl",
    "Audio source resolution should use curl from the plugin process",
  );
  assert(
    execCalls[0].args[execCalls[0].args.length - 1] === sourceUrl,
    "Audio source resolution should pass the fixture URL to the mocked exec call",
  );
  assert(
    execCalls[0].args.includes("--location"),
    "Audio source resolution should follow redirects",
  );
  assert(
    execCalls[0].args.includes("--max-time"),
    "Audio source resolution should have a network timeout",
  );
  assert(
    execCalls[0].args.includes("--proto-redir") &&
      execCalls[0].args.includes("=http,https"),
    "Audio source redirects should stay on HTTP or HTTPS",
  );
  assert(
    execCalls[0].args.includes("--max-filesize") &&
      execCalls[0].args.includes("4194304"),
    "Audio source metadata responses should have a size limit",
  );
  assert(
    candidates.length === 2,
    "Audio source resolution should keep only playable http/https candidates",
  );
  assert(
    candidates[0].name === "NHK16",
    "Audio source resolution should preserve candidate names",
  );
  assert(
    candidates[0].url ===
      "http://audio-source.invalid/nhk16/audio/reading.opus",
    "Relative audio URLs should resolve against the source URL",
  );
  assert(
    candidates[1].url === "https://audio-cdn.invalid/jpod/audio.mp3",
    "Absolute audio URLs should pass through",
  );
  const localCandidates = await context.fetchAudioSourceCandidates(
    "http://127.0.0.1:5050/?term=test",
  );
  assert(
    nativeHttpCalls.length === 1 && execCalls.length === 1,
    "Loopback audio sources should use native HTTP without launching curl",
  );
  assert(
    localCandidates.length === 1 &&
      localCandidates[0].url === "http://127.0.0.1:5050/audio/local.opus",
    "Native loopback audio responses should retain normal candidate parsing",
  );
  try {
    context.audioCandidatesFromSourceJson("not json", sourceUrl);
    assert(false, "Non-JSON audio responses should reject");
  } catch (error) {
    assert(
      error && error.audioSourceResponseNotJson === true,
      "Non-JSON audio responses should be marked as possible direct audio",
    );
  }

  console.log("audio bridge tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
