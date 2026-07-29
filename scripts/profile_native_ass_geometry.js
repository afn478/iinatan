#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { performance } = require("perf_hooks");

const root = path.resolve(__dirname, "..");
const binary = path.join(root, "bin", "iina-hoshi-dicts");
const fixture = path.join(
  root,
  "tests",
  "fixtures",
  "native_ass_geometry_multilingual.ass",
);
const iterations = Math.max(1, Number(process.argv[2]) || 7);
const productionMode = process.argv.includes("--production");
const batchMode = process.argv.includes("--batch");

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function request(testCase, iteration) {
  return {
    type: "ass-geometry",
    protocol: 1,
    requestId: `profile-${testCase.id}-${iteration}`,
    diagnostics: true,
    validateInstrumentation: !productionMode,
    requestAlphaMask: !productionMode,
    source: {
      path: fixture,
      ffIndex: 0,
      external: true,
    },
    cue: {
      timeMs: testCase.start + 500,
      startMs: testCase.start,
      endMs: testCase.end,
      observedAss: testCase.text,
    },
    units: testCase.units.map(([position, start, end]) => ({
      position,
      displayStartUtf16: start,
      displayEndUtf16: end,
    })),
    renderer: {
      width: 1280,
      height: 720,
      storageWidth: 1920,
      storageHeight: 1080,
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      marginBottom: 0,
      pixelAspect: 1,
      fontScale: 1,
      lineSpacing: 0,
      forceMargins: false,
      embeddedFonts: true,
      useStorageSize: true,
      overrideMode: testCase.overrideMode || "yes",
      defaultFamily: "sans-serif",
      fontProvider: "auto",
      assJustify: false,
      linePosition: testCase.overrideMode === "no" ? 0 : 100,
      hinting: "none",
      shaper: "complex",
    },
  };
}

const cases = [
  {
    id: "plain-en",
    start: 1000,
    end: 3000,
    text: "A careful reader",
    units: [
      [0, 0, 1],
      [2, 2, 9],
      [10, 10, 16],
    ],
  },
  {
    id: "multiline",
    start: 40000,
    end: 43000,
    text: "Top\nBottom\\Nline",
    overrideMode: "no",
    units: [
      [0, 0, 3],
      [1, 4, 10],
      [2, 11, 15],
    ],
  },
  {
    id: "cjk",
    start: 10000,
    end: 12000,
    text: "日本語辞書",
    units: Array.from({ length: 5 }, (_, index) => [index, index, index + 1]),
  },
];

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-profile-"));
try {
  const output = [];
  for (const testCase of cases) {
    const samples = [];
    const requestPaths = [];
    for (let iteration = 0; iteration < iterations; iteration++) {
      const requestPath = path.join(
        directory,
        `${testCase.id}-${iteration}.json`,
      );
      fs.writeFileSync(
        requestPath,
        JSON.stringify(request(testCase, iteration)),
      );
      requestPaths.push(requestPath);
      if (batchMode) continue;
      const started = performance.now();
      const response = JSON.parse(
        execFileSync(binary, ["ass-geometry", requestPath], {
          encoding: "utf8",
        }),
      );
      const wallUs = Math.round((performance.now() - started) * 1000);
      if (!response.ok || !response.diagnostics)
        throw new Error(JSON.stringify(response));
      samples.push({
        ...response.diagnostics,
        wallUs,
        processAndIpcUs: Math.max(0, wallUs - response.diagnostics.totalUs),
      });
    }
    if (batchMode) {
      const started = performance.now();
      const responses = execFileSync(
        binary,
        ["ass-geometry", ...requestPaths],
        {
          encoding: "utf8",
        },
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const wallUs = Math.round((performance.now() - started) * 1000);
      const wallPerRequestUs = Math.round(wallUs / responses.length);
      for (const response of responses) {
        if (!response.ok || !response.diagnostics)
          throw new Error(JSON.stringify(response));
        samples.push({
          ...response.diagnostics,
          wallUs: wallPerRequestUs,
          processAndIpcUs: Math.max(
            0,
            wallPerRequestUs - response.diagnostics.totalUs,
          ),
        });
      }
    }
    const keys = Object.keys(samples[0]);
    output.push(
      Object.fromEntries([
        ["case", testCase.id],
        ...keys.map((key) => [
          key,
          median(samples.map((sample) => sample[key])),
        ]),
      ]),
    );
  }
  process.stdout.write(
    JSON.stringify(
      { iterations, productionMode, batchMode, cases: output },
      null,
      2,
    ),
  );
  process.stdout.write("\n");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
