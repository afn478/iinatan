const fs = require("fs");
const os = require("os");
const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const nativeSource = fs.readFileSync(
  path.join(root, "src/native/iina_hoshi.cpp"),
  "utf8",
);
assert(
  /append_term_metadata_json/.test(nativeSource),
  "Native bridge should serialize term metadata",
);
assert(
  /\\?"frequencies\\?"/.test(nativeSource),
  "Native bridge should emit frequency metadata",
);
assert(
  /\\?"pitches\\?"/.test(nativeSource),
  "Native bridge should emit pitch metadata",
);
assert(
  /add_freq_dict/.test(nativeSource),
  "Native bridge should load frequency dictionaries",
);
assert(
  /add_pitch_dict/.test(nativeSource),
  "Native bridge should load pitch dictionaries",
);
assert(
  /prefix_lookup_to_json/.test(nativeSource),
  "Native bridge should expose prefix lookup",
);
assert(
  /"prefix"/.test(nativeSource),
  "Native version/mode handling should include prefix mode",
);
assert(
  /--owner-pid/.test(nativeSource) && /process_exists/.test(nativeSource),
  "Native worker should exit when its owner process disappears",
);
assert(
  /valid_worker_request_id/.test(nativeSource) &&
    /requestId must match the queue filename/.test(nativeSource),
  "Native worker request IDs should be bounded and unable to redirect responses",
);
assert(
  /read_file_limited\(body_path, 4 \* 1024 \* 1024\)/.test(nativeSource),
  "Native worker should reject oversized queue requests before reading them",
);
assert(
  /idle_sleep_ms = std::max\(active_sleep_ms, 16\)/.test(nativeSource) &&
    /current_sleep_ms \* 2/.test(nativeSource),
  "Native worker should back off directory scans while its queue is idle",
);
assert(
  /WRAPPER_VERSION = "1\.9\.0"/.test(nativeSource) &&
    /command == "font-metrics"/.test(nativeSource),
  "Native wrapper 1.9 should preserve the read-only font-metrics command",
);
assert(
  /CTFontCreateWithName/.test(nativeSource) &&
    /CTFontCopyTable/.test(nativeSource) &&
    /kCTFontTableHead/.test(nativeSource) &&
    /kCTFontTableOS2/.test(nativeSource),
  "Font metrics should resolve through CoreText and read OpenType tables",
);
assert(
  /read_be_u16[\s\S]*18/.test(nativeSource) &&
    /read_be_u16[\s\S]*74/.test(nativeSource) &&
    /read_be_u16[\s\S]*76/.test(nativeSource) &&
    /units_per_em[\s\S]*win_height/.test(nativeSource),
  "Font metric scale should use head.unitsPerEm over OS/2 Win height",
);
assert(
  /font-metrics-font-not-found/.test(nativeSource) &&
    /font-metrics-cue-not-covered/.test(nativeSource) &&
    /font-metrics-provider-unverified/.test(nativeSource) &&
    /libass_name_can_select_face/.test(nativeSource) &&
    /libass_coretext_font_substitution/.test(nativeSource),
  "CoreText fallback, libass selector mismatches, and uncovered glyphs should fail closed",
);
assert(
  /--cue-file/.test(nativeSource) &&
    /group_all[\s\S]*others_all/.test(nativeSource) &&
    /Unlink immediately after opening/.test(nativeSource),
  "Font metric cue text should use a private, immediately unlinked payload",
);

const workerSource = fs.readFileSync(
  path.join(root, "src/main/30_backend_import_worker_lookup.js"),
  "utf8",
);
assert(
  /--owner-pid "\$OWNER_PID"/.test(workerSource),
  "Worker launch script should pass IINA's owner pid to the native worker",
);
assert(
  workerSource.indexOf("file.write(bodyPath") <
    workerSource.indexOf('file.write(workerRequestPath(requestId, ".json")'),
  "JavaScript worker requests should publish a marker only after writing the body",
);

const bootstrapSource = fs.readFileSync(
  path.join(root, "src/main/99_bootstrap.js"),
  "utf8",
);
assert(
  /iina\.window-will-close[\s\S]*requestBackendWorkerStop\(\)/.test(
    bootstrapSource,
  ),
  "IINA window close should synchronously request worker shutdown",
);

const buildScript = fs.readFileSync(
  path.join(root, "scripts/build_plugin.py"),
  "utf8",
);
const nativeBuildScript = fs.readFileSync(
  path.join(root, "scripts/build_native_backend.sh"),
  "utf8",
);
assert(
  /find_library\(CORETEXT_FRAMEWORK CoreText REQUIRED\)/.test(
    nativeBuildScript,
  ) && /COREFOUNDATION_FRAMEWORK/.test(nativeBuildScript),
  "Native backend build should link CoreText and CoreFoundation",
);
assert(
  /validate_hoshidicts_submodule/.test(buildScript),
  "Package validation should check the HoshiDicts submodule",
);
assert(
  /"observedPlain": True/.test(buildScript),
  "Release validation should require the secondary ASS plain-observation capability",
);
assert(
  /vendor\/hoshidicts\/include\/hoshidicts\/query\.hpp/.test(buildScript),
  "Submodule validation should check HoshiDicts headers",
);
assert(
  /git submodule update --init --recursive/.test(buildScript),
  "Submodule validation should give the initialization command",
);

const gitmodules = fs.readFileSync(path.join(root, ".gitmodules"), "utf8");
assert(
  /path = vendor\/hoshidicts/.test(gitmodules),
  ".gitmodules should define vendor/hoshidicts",
);
assert(
  /github\.com\/afn478\/hoshidicts\.git/.test(gitmodules),
  ".gitmodules should point at afn478/hoshidicts",
);

const nativeBinary = path.join(root, "bin/iina-hoshi-dicts");
if (
  process.platform === "darwin" &&
  process.arch === "arm64" &&
  fs.existsSync(nativeBinary)
) {
  function runFontMetrics(requested, bold, italic, cue) {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "iinatan-native-metrics-"),
    );
    fs.chmodSync(tempRoot, 0o700);
    const cuePath = path.join(tempRoot, "iinatan-font-metrics-cue-test.txt");
    fs.writeFileSync(cuePath, cue, { mode: 0o600 });
    let result;
    try {
      result = childProcess.spawnSync(
        nativeBinary,
        [
          "font-metrics",
          "--font",
          requested,
          "--bold",
          bold ? "yes" : "no",
          "--italic",
          italic ? "yes" : "no",
          "--cue-file",
          cuePath,
        ],
        { encoding: "utf8" },
      );
      assert(
        !fs.existsSync(cuePath),
        "Native helper should unlink the private cue immediately",
      );
      return result;
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
  [
    ["HiraginoSans-W4", "HiraginoSans-W4"],
    ["YuMin-Medium", "YuMin-Medium"],
    ["YuKyo-Medium", "YuKyo-Medium"],
  ].forEach(([requested, resolved]) => {
    const fontMetrics = runFontMetrics(requested, false, false, "日本");
    assert(
      fontMetrics.status === 0,
      "Packaged native helper should resolve " + requested + " metrics",
    );
    const metrics = JSON.parse(fontMetrics.stdout);
    assert(
      metrics.resolvedPostScriptName === resolved &&
        metrics.libassProviderVerified === true &&
        Number.isInteger(metrics.resolvedFontFormat) &&
        Math.abs(
          metrics.fontMetricScale -
            metrics.unitsPerEm / (metrics.usWinAscent + metrics.usWinDescent),
        ) < 1e-9,
      requested + " should resolve the exact face and table formula",
    );
  });
  [
    ["sans-serif", false, false, "Helvetica"],
    ["Arial", true, false, "Arial-BoldMT"],
    ["Helvetica", true, true, "Helvetica-BoldOblique"],
    ["Times", false, true, "Times-Italic"],
  ].forEach(([requested, bold, italic, resolved]) => {
    const fontMetrics = runFontMetrics(
      requested,
      bold,
      italic,
      "Private Latin cue",
    );
    assert(
      fontMetrics.status === 0,
      requested + " should resolve through libass-compatible family matching",
    );
    const metrics = JSON.parse(fontMetrics.stdout);
    assert(
      metrics.resolvedPostScriptName === resolved &&
        metrics.resolvedBold === !!bold &&
        metrics.resolvedItalic === !!italic &&
        metrics.syntheticBold === false &&
        metrics.syntheticItalic === false,
      requested + " should resolve and verify its requested family traits",
    );
  });
  const syntheticYuMin = runFontMetrics("YuMin-Medium", true, false, "日本");
  assert(
    syntheticYuMin.status === 0,
    "An exact PostScript face should retain its metrics under synthetic bold",
  );
  const syntheticYuMinMetrics = JSON.parse(syntheticYuMin.stdout);
  assert(
    syntheticYuMinMetrics.resolvedPostScriptName === "YuMin-Medium" &&
      syntheticYuMinMetrics.resolvedBold === false &&
      syntheticYuMinMetrics.syntheticBold === true,
    "Exact-face results should report libass-compatible synthetic styling",
  );
  const extendedYuMinFamily = runFontMetrics("YuMincho", false, false, "日本");
  assert(
    extendedYuMinFamily.status !== 0 &&
      /font-metrics-provider-unverified/.test(extendedYuMinFamily.stdout),
    "A CoreText extended-family-only match should fail closed like normal libass selection",
  );
  const bizPostScript = runFontMetrics(
    "BIZUDMincho-Regular",
    false,
    false,
    "日本",
  );
  assert(
    bizPostScript.status !== 0 &&
      /font-metrics-provider-unverified/.test(bizPostScript.stdout),
    "TrueType PostScript-name-only requests should fail closed like libass",
  );
  const bizFamily = runFontMetrics("BIZ UDMincho", false, false, "日本");
  assert(
    bizFamily.status === 0 &&
      JSON.parse(bizFamily.stdout).resolvedPostScriptName ===
        "BIZUDMincho-Regular",
    "The same TrueType face remains available through its libass-selectable family name",
  );
  [
    ["NotoSerifCJKjp-Regular", "NotoSerifCJK.ttc"],
    ["HanaMinExA1", "HanaMinExA1.otf"],
  ].forEach(([requested, filename]) => {
    if (!fs.existsSync(path.join(os.homedir(), "Library/Fonts", filename)))
      return;
    const result = runFontMetrics(requested, false, false, "日本");
    assert(
      result.status === 0 &&
        JSON.parse(result.stdout).resolvedPostScriptName === requested,
      requested +
        " should remain accepted as a real libass-selectable user font",
    );
  });
  const privateCue = "字幕PRIVATE";
  const failedMetrics = runFontMetrics(
    "DefinitelyMissingFont",
    false,
    false,
    privateCue,
  );
  assert(
    failedMetrics.status !== 0 &&
      !String(failedMetrics.stdout || "").includes(privateCue) &&
      !String(failedMetrics.stderr || "").includes(privateCue),
    "Native font metric failures should never echo cue text",
  );
}

console.log("native backend schema and submodule validation tests passed");
