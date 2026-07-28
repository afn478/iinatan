const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

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

const version = JSON.parse(
  execFileSync(binary, ["version"], { encoding: "utf8" }),
);
assert.strictEqual(version.assGeometry.available, true);
assert.strictEqual(version.assGeometry.protocol, 1);
assert.strictEqual(version.assGeometry.ffmpeg, "7.0.1");
assert.strictEqual(version.assGeometry.libass, "0.17.2");
assert.strictEqual(version.assGeometry.architecture, "arm64");

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
  return {
    type: "ass-geometry",
    protocol: 1,
    requestId: "fixture-" + testCase.id,
    source: {
      path: testCase.source || fixture,
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

function withGeneratedAttachment(size, callback) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "iinatan-ass-attachment-"),
  );
  const attachment = path.join(directory, "boundary-font.ttf");
  const output = path.join(directory, "boundary.mkv");
  try {
    fs.writeFileSync(attachment, Buffer.alloc(1));
    fs.truncateSync(attachment, size);
    execFileSync(
      "ffmpeg",
      [
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
        "-attach",
        attachment,
        "-metadata:s:t",
        "mimetype=application/x-truetype-font",
        output,
      ],
      { stdio: "pipe" },
    );
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

withGeneratedAttachment(23275812, (source) => {
  const response = invoke(
    request({
      ...cases[0],
      id: "large-live-font",
      source,
    }),
  );
  assert.strictEqual(response.ok, true, JSON.stringify(response));
});

withGeneratedAttachment(32 * 1024 * 1024 + 1, (source) => {
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
