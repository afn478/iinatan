const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const binary = path.join(root, "bin", "iina-hoshi-dicts");
const fixture = path.join(
  root,
  "tests",
  "fixtures",
  "native_ass_geometry_multilingual.ass",
);
const matroskaFixture = path.join(
  root,
  "tests",
  "fixtures",
  "native_ass_geometry_multilingual.mkv",
);
const attachmentFixture = path.join(
  root,
  "tests",
  "fixtures",
  "native_font_attachment.txt",
);
const assFixtureText = fs.readFileSync(fixture, "utf8");
const assExtradata = assFixtureText.slice(
  0,
  assFixtureText.indexOf("Dialogue:"),
);

function assFullAt(startMs) {
  const seconds = Math.floor(startMs / 1000);
  const timestamp = `0:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.00`;
  const line = assFixtureText
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`Dialogue: 0,${timestamp},`));
  assert.ok(line, `fixture has an ASS event at ${timestamp}`);
  return line;
}
const systemFontFixture = "/System/Library/Fonts/Symbol.ttf";
assert.ok(
  fs.existsSync(systemFontFixture),
  "macOS Symbol.ttf is required for native attachment-limit tests",
);

const version = JSON.parse(
  execFileSync(binary, ["version"], { encoding: "utf8" }),
);
assert.strictEqual(version.assGeometry.available, true);
assert.strictEqual(version.assGeometry.observedPlain, true);
assert.strictEqual(version.assGeometry.protocol, 1);
assert.strictEqual(version.assGeometry.ffmpeg, "7.0.1");
assert.strictEqual(version.assGeometry.libass, "0.17.2");
assert.strictEqual(version.assGeometry.architecture, "arm64");
assert.strictEqual(
  version.assGeometry.patch,
  "libass-0.17.2-iinatan-unit-ids-v2",
);
assert.strictEqual(version.bitmapOcr.available, true);
assert.strictEqual(version.bitmapOcr.protocol, 1);
assert.strictEqual(version.bitmapOcr.screenshotDiff, true);
assert.ok(version.bitmapOcr.languages.includes("ja-JP"));
assert.ok(version.bitmapOcr.languages.includes("ko-KR"));
assert.deepStrictEqual(version.bitmapOcr.decoders.slice().sort(), [
  "dvbsub",
  "dvdsub",
  "pgs",
  "xsub",
]);
assert.deepStrictEqual(version.mouseIntent, {
  protocol: 1,
  source: "coregraphics-counter",
});

const cases = [
  {
    id: "en",
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
    id: "fr",
    start: 4000,
    end: 6000,
    text: "Ça fonctionne très bien",
    units: [
      [0, 0, 2],
      [3, 3, 13],
      [14, 14, 18],
      [19, 19, 23],
    ],
  },
  {
    id: "de",
    start: 7000,
    end: 9000,
    text: "Grüße aus Berlin",
    units: [
      [0, 0, 5],
      [6, 6, 9],
      [10, 10, 16],
    ],
  },
  {
    id: "ja",
    start: 10000,
    end: 12000,
    text: "日本語辞書",
    units: Array.from({ length: 5 }, (_, index) => [index, index, index + 1]),
  },
  {
    id: "zh",
    start: 13000,
    end: 15000,
    text: "这是中文测试",
    units: Array.from({ length: 6 }, (_, index) => [index, index, index + 1]),
  },
  {
    id: "ko",
    start: 16000,
    end: 18000,
    text: "한국어 사전",
    units: [
      [0, 0, 3],
      [4, 4, 6],
    ],
  },
];

function request(testCase) {
  const observedCue =
    testCase.observedPlain === undefined
      ? {
          observedAss:
            testCase.observedAss === undefined
              ? testCase.text
              : testCase.observedAss,
        }
      : { observedFormat: "plain", observedPlain: testCase.observedPlain };
  return {
    type: "ass-geometry",
    protocol: 1,
    requestId: "fixture-" + testCase.id,
    ...(testCase.diagnostics === undefined
      ? {}
      : { diagnostics: testCase.diagnostics }),
    ...(testCase.validateInstrumentation === undefined
      ? {}
      : { validateInstrumentation: testCase.validateInstrumentation }),
    ...(testCase.requestAlphaMask === undefined
      ? {}
      : { requestAlphaMask: testCase.requestAlphaMask }),
    source: {
      path: testCase.source || fixture,
      ffIndex: testCase.ffIndex === undefined ? 0 : Number(testCase.ffIndex),
      external: true,
      ...(testCase.autoAssStream ? { autoAssStream: true } : {}),
      ...(testCase.cacheExcerpt ? { cacheExcerpt: true } : {}),
    },
    cue: {
      timeMs: testCase.start + 500,
      startMs: testCase.start,
      endMs: testCase.end,
      ...(testCase.assObservation
        ? {
            assExtradata,
            assFull: assFullAt(testCase.start),
          }
        : {}),
      ...observedCue,
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
      overrideMode: "yes",
      defaultFamily: "sans-serif",
      fontProvider: "auto",
      assJustify: false,
      linePosition: 100,
      hinting: "none",
      shaper: "complex",
      ...(testCase.renderer || {}),
    },
  };
}

function invoke(payload) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-ass-"));
  const requestPath = path.join(directory, "request.json");
  try {
    fs.writeFileSync(requestPath, JSON.stringify(payload));
    return JSON.parse(
      execFileSync(binary, ["ass-geometry", requestPath], { encoding: "utf8" }),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function invokeBatch(payloads) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "iinatan-ass-batch-"),
  );
  try {
    const requestPaths = payloads.map((payload, index) => {
      const requestPath = path.join(directory, `request-${index}.json`);
      fs.writeFileSync(requestPath, JSON.stringify(payload));
      return requestPath;
    });
    return execFileSync(binary, ["ass-geometry", ...requestPaths], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function withHttpFixture(mediaPath, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "iinatan-ass-http-"));
  const portPath = path.join(directory, "port");
  const server = spawn(
    "/usr/bin/python3",
    [
      "-u",
      "-c",
      [
        "import http.server, os, sys",
        "os.chdir(sys.argv[1])",
        "class Quiet(http.server.SimpleHTTPRequestHandler):",
        "  def log_message(self, *args): pass",
        "server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Quiet)",
        "open(sys.argv[2], 'w').write(str(server.server_port))",
        "server.serve_forever()",
      ].join("\n"),
      path.dirname(mediaPath),
      portPath,
    ],
    { stdio: "ignore" },
  );
  try {
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(portPath) && Date.now() < deadline)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    assert.ok(
      fs.existsSync(portPath),
      "local HTTP fixture server did not start",
    );
    const port = fs.readFileSync(portPath, "utf8").trim();
    callback(`http://127.0.0.1:${port}/${path.basename(mediaPath)}?token=test`);
  } finally {
    server.kill("SIGTERM");
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function withGeneratedMuxedMedia(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "iinatan-ass-muxed-"),
  );
  const output = path.join(directory, "muxed.mkv");
  try {
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=black:size=320x180:rate=10:duration=60",
        "-f",
        "ass",
        "-i",
        fixture,
        "-map",
        "0:v:0",
        "-map",
        "1:s:0",
        "-c:v",
        "mpeg4",
        "-q:v",
        "8",
        "-g",
        "20",
        "-c:s",
        "copy",
        output,
      ],
      { stdio: "pipe" },
    );
    callback(output);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function withGeneratedCacheExcerpt(callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "iinatan-ass-cache-"),
  );
  const output = path.join(directory, "excerpt.mkv");
  try {
    execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-ss",
        "13",
        "-to",
        "15",
        "-i",
        matroskaFixture,
        "-map",
        "0:s:0",
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        output,
      ],
      { stdio: "pipe" },
    );
    callback(output);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function withGeneratedAttachments(attachments, callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "iinatan-ass-attachment-"),
  );
  const output = path.join(directory, "boundary.mkv");
  try {
    const seeds = new Map();
    const args = [
      "-v",
      "error",
      "-y",
      "-f",
      "ass",
      "-i",
      fixture,
      "-map",
      "0:s:0",
      "-c:s",
      "copy",
    ];
    attachments.forEach((attachment, index) => {
      const name = attachment.name || `boundary-font-${index}.ttf`;
      const attachmentPath = path.join(directory, name);
      const source = attachment.source || attachmentFixture;
      if (!seeds.has(source)) seeds.set(source, fs.readFileSync(source));
      const seed = seeds.get(source);
      fs.writeFileSync(attachmentPath, seed);
      if (attachment.size !== undefined)
        fs.truncateSync(attachmentPath, attachment.size);
      args.push(
        "-attach",
        attachmentPath,
        `-metadata:s:t:${index}`,
        "mimetype=application/x-truetype-font",
        `-metadata:s:t:${index}`,
        `filename=${name}`,
      );
    });
    args.push(output);
    execFileSync("ffmpeg", args, { stdio: "pipe" });
    return callback(output);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

for (const testCase of cases) {
  const response = invoke(request(testCase));
  assert.strictEqual(
    response.ok,
    true,
    `${testCase.id}: ${JSON.stringify(response)}`,
  );
  assert.strictEqual(response.units.length, testCase.units.length);
  for (const unit of response.units) {
    assert.ok(unit.rects.length);
    for (const rect of unit.rects) {
      assert.ok(rect.w > 0 && rect.h > 0);
      assert.ok(rect.x >= 0 && rect.y >= 0);
      assert.ok(rect.x + rect.w <= 1280 && rect.y + rect.h <= 720);
    }
  }
  assert.strictEqual(response.alphaMask.encoding, "rle-u8-base64");
  const encodedMask = Buffer.from(response.alphaMask.data, "base64");
  let decodedPixels = 0;
  for (let offset = 0; offset < encodedMask.length; offset += 2) {
    assert.ok(encodedMask[offset] > 0, "alpha mask has no empty RLE runs");
    decodedPixels += encodedMask[offset];
  }
  assert.strictEqual(
    decodedPixels,
    response.alphaMask.w * response.alphaMask.h,
    "alpha mask exactly covers its declared crop",
  );
}

withHttpFixture(matroskaFixture, (source) => {
  const responses = invokeBatch(
    [cases[4], cases[5]].map((testCase) =>
      request({
        ...testCase,
        id: `${testCase.id}-http-observation`,
        source,
        diagnostics: true,
        assObservation: true,
      }),
    ),
  );
  responses.forEach((response, index) => {
    assert.strictEqual(response.ok, true, JSON.stringify(response));
    assert.strictEqual(response.units.length, cases[index + 4].units.length);
  });
  assert.strictEqual(responses[0].diagnostics.demuxCacheHit, false);
  assert.strictEqual(responses[0].diagnostics.assObservation, true);
  assert.strictEqual(
    responses[1].diagnostics.demuxCacheHit,
    true,
    "the next URL cue reuses source metadata and replaces only mpv's current ASS event",
  );
});

withGeneratedCacheExcerpt((excerpt) => {
  const response = invoke(
    request({
      ...cases[4],
      id: "zh-cached-excerpt",
      source: excerpt,
      ffIndex: -1,
      autoAssStream: true,
      cacheExcerpt: true,
      diagnostics: true,
    }),
  );
  assert.strictEqual(
    response.ok,
    true,
    "a rebased mpv cache excerpt selects its ASS stream and aligns it to the live cue: " +
      JSON.stringify(response),
  );
  assert.strictEqual(response.diagnostics.assObservation, false);
});

withGeneratedMuxedMedia((muxedMedia) => {
  withHttpFixture(muxedMedia, (source) => {
    const response = invoke(
      request({
        ...cases[4],
        id: "zh-http-muxed-fallback",
        source,
        ffIndex: 1,
        diagnostics: true,
      }),
    );
    assert.strictEqual(response.ok, true, JSON.stringify(response));
    assert.strictEqual(response.diagnostics.assObservation, false);
    assert.ok(
      response.diagnostics.demuxPacketsRead < 150,
      "mpv 0.38 fallback reads only the current HTTP cluster, not a broad multiplexed window: " +
        JSON.stringify(response.diagnostics),
    );
  });
});

const unavailableObservedStream = invoke(
  request({
    ...cases[4],
    id: "zh-unavailable-observed-stream",
    source: "http://127.0.0.1:9/unavailable.mkv",
    assObservation: true,
  }),
);
assert.strictEqual(
  unavailableObservedStream.ok,
  true,
  "mpv's decoded ASS observation remains usable when a stream cannot be independently reopened: " +
    JSON.stringify(unavailableObservedStream),
);

const opaqueObservedStream = invoke(
  request({
    ...cases[4],
    id: "zh-opaque-observed-stream",
    source: "memory://mpv-owned-stream",
    assObservation: true,
  }),
);
assert.strictEqual(
  opaqueObservedStream.ok,
  true,
  "an mpv-only source uses the decoded ASS observation without reopening the pseudo-URL: " +
    JSON.stringify(opaqueObservedStream),
);

const productionRequests = [0, 1].map((iteration) =>
  request({
    ...cases[0],
    id: "production-" + iteration,
    diagnostics: true,
    validateInstrumentation: false,
    requestAlphaMask: false,
  }),
);
const productionResponses = invokeBatch(productionRequests);
productionResponses.forEach((response) => {
  assert.strictEqual(response.ok, true, JSON.stringify(response));
  assert.strictEqual(response.alphaMask, undefined);
  assert.strictEqual(response.diagnostics.validationEnabled, false);
  assert.strictEqual(response.diagnostics.alphaMaskRequested, false);
  assert.strictEqual(response.diagnostics.alphaComposedPixels, 0);
  assert.strictEqual(response.diagnostics.alphaMaskScannedPixels, 0);
});
assert.strictEqual(productionResponses[0].diagnostics.demuxCacheHit, false);
assert.strictEqual(productionResponses[1].diagnostics.demuxCacheHit, true);
assert.strictEqual(productionResponses[1].diagnostics.requestCount, 2);
assert.strictEqual(productionResponses[1].diagnostics.sessionCreationCount, 1);
assert.strictEqual(
  productionResponses[1].diagnostics.sessionDestructionCount,
  0,
);

const validatedMaskResponse = invoke(
  request({
    ...cases[0],
    id: "validated-mask",
    validateInstrumentation: true,
    requestAlphaMask: true,
  }),
);
const croppedMaskResponse = invoke(
  request({
    ...cases[0],
    id: "cropped-mask",
    diagnostics: true,
    validateInstrumentation: false,
    requestAlphaMask: true,
  }),
);
assert.deepStrictEqual(
  croppedMaskResponse.alphaMask,
  validatedMaskResponse.alphaMask,
  "demand-driven cropped mask encoding remains byte-identical",
);
assert.ok(
  croppedMaskResponse.diagnostics.alphaComposedPixels < 1280 * 720,
  "mask-only production rendering composes only subtitle bounds",
);

withGeneratedAttachments([{ size: 23275812 }], (source) => {
  const response = invoke(
    request({
      ...cases[0],
      id: "large-live-font",
      source,
    }),
  );
  assert.strictEqual(response.ok, true, JSON.stringify(response));
});

withGeneratedAttachments(
  Array.from({ length: 33 }, (_, index) => ({
    name: `small-font-${index}.ttf`,
    source: systemFontFixture,
  })),
  (source) => {
    const response = invoke(
      request({
        ...cases[0],
        id: "thirty-three-fonts",
        source,
      }),
    );
    assert.strictEqual(response.ok, true, JSON.stringify(response));
  },
);

withGeneratedAttachments([{ size: 32 * 1024 * 1024 + 1 }], (source) => {
  const response = invoke(
    request({
      ...cases[0],
      id: "oversized-font",
      source,
    }),
  );
  assert.strictEqual(response.ok, false, JSON.stringify(response));
  assert.strictEqual(response.reason, "attachment-limit-exceeded");
});

withGeneratedAttachments(
  Array.from({ length: 3 }, (_, index) => ({
    name: `cumulative-font-${index}.ttf`,
    size: 22 * 1024 * 1024,
  })),
  (source) => {
    const response = invoke(
      request({
        ...cases[0],
        id: "cumulative-font-limit",
        source,
      }),
    );
    assert.strictEqual(response.ok, false, JSON.stringify(response));
    assert.strictEqual(response.reason, "attachment-limit-exceeded");
  },
);

withGeneratedAttachments(
  Array.from({ length: 128 }, (_, index) => ({
    name: `stream-limit-font-${index}.ttf`,
    size: 1,
  })),
  (source) => {
    const response = invoke(
      request({
        ...cases[0],
        id: "stream-limit",
        source,
      }),
    );
    assert.strictEqual(response.ok, false, JSON.stringify(response));
    assert.strictEqual(response.reason, "stream-limit-exceeded");
  },
);

const complex = request({
  id: "complex",
  start: 19000,
  end: 21000,
  text: "{\\pos(100,100)}Rejected",
  units: [[0, 0, 8]],
});
const rejected = invoke(complex);
assert.strictEqual(rejected.ok, false);
assert.strictEqual(rejected.reason, "complex-ass-tags");

const animatedEffect = invoke(
  request({
    id: "animated-effect",
    start: 37000,
    end: 39000,
    text: "Animated plain text",
    units: [[0, 0, 8]],
  }),
);
assert.strictEqual(animatedEffect.ok, false);
assert.strictEqual(animatedEffect.reason, "complex-ass-tags");
assert.strictEqual(animatedEffect.detail, "animated-effect");

const overlappingEvents = invoke(
  request({
    id: "overlapping-events",
    start: 40000,
    end: 43000,
    text: "Top\nBottom\\Nline",
    units: [
      [0, 0, 3],
      [1, 4, 10],
      [2, 11, 15],
    ],
    renderer: {
      overrideMode: "no",
      fontScale: 1,
      lineSpacing: 0,
      linePosition: 0,
      hinting: "none",
    },
  }),
);
assert.strictEqual(
  overlappingEvents.ok,
  true,
  JSON.stringify(overlappingEvents),
);
assert.strictEqual(overlappingEvents.units.length, 3);
const topRect = overlappingEvents.units[0].rects[0];
const bottomRect = overlappingEvents.units[1].rects[0];
assert.ok(
  topRect.y + topRect.h < bottomRect.y,
  "independently positioned overlapping events retain distinct vertical geometry: " +
    JSON.stringify(overlappingEvents.units),
);

const plainOverlappingEvents = invoke(
  request({
    id: "plain-overlapping-events",
    start: 40000,
    end: 43000,
    text: "",
    observedPlain: "Top\nBottom\nline",
    units: [
      [10, 0, 3],
      [14, 4, 10],
      [21, 11, 15],
    ],
  }),
);
assert.strictEqual(
  plainOverlappingEvents.ok,
  true,
  JSON.stringify(plainOverlappingEvents),
);
assert.deepStrictEqual(
  plainOverlappingEvents.units.map((unit) => unit.position),
  [10, 14, 21],
  "plain observations preserve caller-global positions",
);

const plainDemuxIndependentOrder = invoke(
  request({
    id: "plain-demux-independent-order",
    start: 40000,
    end: 43000,
    text: "",
    observedPlain: "Bottom\nline\nTop",
    units: [
      [0, 0, 6],
      [7, 7, 11],
      [12, 12, 15],
    ],
  }),
);
assert.strictEqual(
  plainDemuxIndependentOrder.ok,
  true,
  JSON.stringify(plainDemuxIndependentOrder),
);

[
  ["wrong-event", "Wrong\nBottom\\Nline"],
  ["missing-event", "Top"],
  ["extra-event", "Top\nBottom\\Nline\nExtra"],
].forEach(([id, text]) => {
  const response = invoke(
    request({
      id,
      start: 40000,
      end: 43000,
      text,
      units: [[0, 0, Math.min(3, text.length)]],
    }),
  );
  assert.strictEqual(response.ok, false, JSON.stringify(response));
  assert.strictEqual(response.reason, "cue-text-mismatch");
});

const duplicateAmbiguous = invoke(
  request({
    id: "duplicate-ambiguous",
    start: 44000,
    end: 47000,
    text: "Duplicate\nDuplicate",
    units: [
      [0, 0, 9],
      [1, 10, 19],
    ],
  }),
);
assert.strictEqual(duplicateAmbiguous.ok, false);
assert.strictEqual(duplicateAmbiguous.reason, "ambiguous-ass-event");

const duplicatePlainAmbiguous = invoke(
  request({
    id: "duplicate-plain-ambiguous",
    start: 44000,
    end: 47000,
    text: "",
    observedPlain: "Duplicate\nDuplicate",
    units: [
      [0, 0, 9],
      [10, 10, 19],
    ],
  }),
);
assert.strictEqual(duplicatePlainAmbiguous.ok, false);
assert.strictEqual(duplicatePlainAmbiguous.reason, "ambiguous-ass-event");

const complexPeer = invoke(
  request({
    id: "complex-peer",
    start: 48000,
    end: 51000,
    text: "Simple peer\n{\\pos(100,100)}Complex peer",
    units: [[0, 0, 6]],
  }),
);
assert.strictEqual(complexPeer.ok, false);
assert.strictEqual(complexPeer.reason, "complex-ass-tags");

const animatedPeer = invoke(
  request({
    id: "animated-peer",
    start: 52000,
    end: 55000,
    text: "Simple peer\nAnimated peer",
    units: [[0, 0, 6]],
  }),
);
assert.strictEqual(animatedPeer.ok, false);
assert.strictEqual(animatedPeer.reason, "complex-ass-tags");
assert.strictEqual(animatedPeer.detail, "animated-effect");

const crossEventRange = invoke(
  request({
    id: "cross-event-range",
    start: 40000,
    end: 43000,
    text: "Top\nBottom\\Nline",
    units: [[0, 2, 5]],
  }),
);
assert.strictEqual(crossEventRange.ok, false);
assert.strictEqual(crossEventRange.reason, "text-index-map-failed");

const plainCrossEventRange = invoke(
  request({
    id: "plain-cross-event-range",
    start: 40000,
    end: 43000,
    text: "",
    observedPlain: "Top\nBottom\nline",
    units: [[0, 2, 5]],
  }),
);
assert.strictEqual(plainCrossEventRange.ok, false);
assert.strictEqual(plainCrossEventRange.reason, "text-index-map-failed");

const plainMismatch = invoke(
  request({
    id: "plain-mismatch",
    start: 40000,
    end: 43000,
    text: "",
    observedPlain: "Top\nWrong",
    units: [[0, 0, 3]],
  }),
);
assert.strictEqual(plainMismatch.ok, false);
assert.strictEqual(plainMismatch.reason, "cue-text-mismatch");

[
  { base: cases[0], start: 22000, end: 24000 },
  { base: cases[1], start: 25000, end: 27000 },
  { base: cases[2], start: 28000, end: 30000 },
  { base: cases[4], start: 31000, end: 33000 },
].forEach(({ base, start, end }) => {
  const liveShaped = request({
    ...base,
    id: base.id + "-outlined",
    start,
    end,
  });
  const response = invoke(liveShaped);
  assert.strictEqual(response.ok, true, JSON.stringify(response));
  assert.strictEqual(response.units.length, base.units.length);
  response.units.forEach((unit) => {
    assert.ok(unit.rects.length);
    unit.rects.forEach((rect) => assert.ok(rect.w > 0 && rect.h > 0));
  });
});

const splitCluster = invoke(
  request({
    id: "split-cluster",
    start: 34000,
    end: 36000,
    text: "é",
    units: [
      [0, 0, 1],
      [1, 1, 2],
    ],
  }),
);
assert.strictEqual(splitCluster.ok, false);
assert.strictEqual(splitCluster.reason, "cross-unit-cluster");

const inlineItalic = invoke(
  request({
    id: "inline-italic",
    start: 56000,
    end: 60000,
    text: "someone who's into you\n is bound to turn up.",
    observedAss: "someone who's into you\\N is {\\i1}bound{\\i0} to turn up.",
    units: [
      [0, 0, 7],
      [8, 8, 13],
      [14, 14, 18],
      [19, 19, 22],
      [24, 24, 26],
      [27, 27, 32],
      [33, 33, 35],
      [36, 36, 40],
      [41, 41, 43],
    ],
  }),
);
assert.strictEqual(inlineItalic.ok, true, JSON.stringify(inlineItalic));
assert.strictEqual(inlineItalic.units.length, 9);
inlineItalic.units.forEach((unit) => assert.ok(unit.rects.length));

const rendererParity = invoke(
  request({
    ...cases[0],
    id: "renderer-parity",
    renderer: {
      width: 1024,
      height: 768,
      storageWidth: 720,
      storageHeight: 480,
      marginLeft: 80,
      marginRight: 80,
      marginTop: 24,
      marginBottom: 40,
      pixelAspect: 1.2,
      forceMargins: true,
      linePosition: 85,
    },
  }),
);
assert.strictEqual(rendererParity.ok, true, JSON.stringify(rendererParity));
assert.strictEqual(rendererParity.rendererWidth, 1024);
assert.strictEqual(rendererParity.rendererHeight, 768);

const supportedScaleMode = invoke(
  request({
    ...cases[0],
    id: "supported-scale-mode",
    renderer: { overrideMode: "scale" },
  }),
);
assert.strictEqual(
  supportedScaleMode.ok,
  true,
  JSON.stringify(supportedScaleMode),
);

const supportedNoMode = invoke(
  request({
    ...cases[0],
    id: "supported-no-mode",
    renderer: {
      overrideMode: "no",
      fontScale: 1,
      lineSpacing: 0,
      linePosition: 0,
      hinting: "none",
    },
  }),
);
assert.strictEqual(supportedNoMode.ok, true, JSON.stringify(supportedNoMode));

[
  ["unsupported-font-provider", { fontProvider: "fontconfig" }],
  ["unsupported-ass-justify", { assJustify: true }],
].forEach(([id, renderer]) => {
  const response = invoke(
    request({
      ...cases[0],
      id,
      renderer,
    }),
  );
  assert.strictEqual(response.ok, false, JSON.stringify(response));
  assert.strictEqual(response.reason, "unsupported-renderer-option");
});

const matroskaAttachment = invoke(
  request({
    ...cases[0],
    id: "matroska-attachment",
    source: matroskaFixture,
  }),
);
assert.strictEqual(
  matroskaAttachment.ok,
  true,
  JSON.stringify(matroskaAttachment),
);

console.log("native ASS geometry tests passed");
