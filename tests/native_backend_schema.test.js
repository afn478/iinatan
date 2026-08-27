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
const bitmapSubtitleSource = fs.readFileSync(
  path.join(root, "src/native/bitmap_subtitle.cpp"),
  "utf8",
);
const visionOcrSource = fs.readFileSync(
  path.join(root, "src/native/vision_ocr.mm"),
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
  /append_pitch_positions\(out, entry\.pitches\)/.test(nativeSource) &&
    /pitches\[i\]\.position/.test(nativeSource),
  "Native bridge should adapt HoshiDicts pitch objects to the existing positions contract",
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
  /const auto& counts = r\.summary\.counts/.test(nativeSource) &&
    /summary_meta_count\(counts\.termMeta, "total"\)/.test(nativeSource) &&
    /counts\.tagMeta\.total/.test(nativeSource) &&
    /if \(!r\.error\.empty\(\)\) errors\.push_back\(r\.error\)/.test(
      nativeSource,
    ),
  "Native import bridge should adapt the current HoshiDicts summary and error API",
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
  /WRAPPER_VERSION = "1\.11\.0"/.test(nativeSource) &&
    /command == "font-metrics"/.test(nativeSource),
  "Native wrapper 1.11 should preserve the read-only font-metrics command",
);
assert(
  /CGEventSourceCounterForEventType/.test(nativeSource) &&
    /mouse\.json/.test(nativeSource) &&
    /mouseIntent/.test(nativeSource),
  "Native worker should publish bounded CoreGraphics mouse-activity counters",
);
const controllerSource = fs.readFileSync(
  path.join(root, "src/native/controller_hid.cpp"),
  "utf8",
);
assert(
  /IOHIDManagerCreate/.test(controllerSource) &&
    /IOHIDManagerScheduleWithRunLoop/.test(controllerSource) &&
    /CFRunLoopRunInMode/.test(controllerSource) &&
    /IOHIDManagerUnscheduleFromRunLoop/.test(controllerSource) &&
    /IOHIDDeviceScheduleWithRunLoop/.test(controllerSource) &&
    /IOHIDDeviceUnscheduleFromRunLoop/.test(controllerSource) &&
    /kGamePadUsage/.test(controllerSource) &&
    /kJoystickUsage/.test(controllerSource) &&
    /controller_score/.test(controllerSource) &&
    /kIOHIDTransportKey/.test(controllerSource) &&
    /kIOHIDTransportVirtualValue/.test(controllerSource) &&
    /uses_dualsense_axis_layout/.test(controllerSource) &&
    /kDualSenseProductId/.test(controllerSource) &&
    !/is_dualsense/.test(controllerSource) &&
    /milliseconds\(250\)/.test(controllerSource) &&
    /updatedAt/.test(controllerSource) &&
    /next\.buttons\[index\] \|\| button_down/.test(controllerSource) &&
    /source\\\":\\\"native-hid/.test(controllerSource) &&
    /controller_monitor->poll/.test(nativeSource),
  "Native worker should poll and publish hot-plugged generic HID controller snapshots",
);
assert(
  /button_count < 4 \|\| axis_count < 2/.test(controllerSource) &&
    /if \(!has_controller_usage\) return -1/.test(controllerSource) &&
    !/!has_controller_usage && !has_hat && axis_count < 4/.test(
      controllerSource,
    ),
  "Generic HID controller fallback should not require a primary usage or hat descriptor",
);
assert(
  /"square"/.test(controllerSource) &&
    /case 1: index = 2/.test(controllerSource),
  "Native controller snapshots should preserve the west face button",
);
assert(
  /bitmap-subtitle-ocr/.test(nativeSource) &&
    /bitmapOcr/.test(nativeSource) &&
    /OcrService/.test(nativeSource),
  "Native wrapper 1.10 should expose bitmap subtitle OCR and its capability",
);
assert(
  /av_seek_frame\(\s*session\.format\.value, -1, global_timestamp/.test(
    bitmapSubtitleSource,
  ) && /stream_timestamp/.test(bitmapSubtitleSource),
  "Bitmap subtitle decoding should seek on the container timeline before falling back to a sparse subtitle stream",
);
assert(
  /struct DecoderSession/.test(bitmapSubtitleSource) &&
    /static std::unique_ptr<DecoderSession> cached_session/.test(
      bitmapSubtitleSource,
    ) &&
    /same_source\(\*cached_session, source\)/.test(bitmapSubtitleSource),
  "Bitmap OCR should reuse one matching media demux and decoder session across cues",
);
assert(
  /kNearPrerollMs = 1500/.test(bitmapSubtitleSource) &&
    /kBroadPrerollMs = 12000/.test(bitmapSubtitleSource) &&
    /metrics\.strategy = "forward"/.test(bitmapSubtitleSource) &&
    /cached_frame_at/.test(bitmapSubtitleSource),
  "Bitmap OCR should cache cues and prefer bounded forward or near-cue decoding before broad fallback",
);
assert(
  /candidate\.canvas_width = canvas_width/.test(bitmapSubtitleSource) &&
    /candidate\.origin_x = left/.test(bitmapSubtitleSource) &&
    /frame\.origin_x \+ unit\.x/.test(visionOcrSource),
  "Cropped bitmap frames should retain their authored canvas coordinates",
);
assert(
  /class AlphaPrefix/.test(visionOcrSource) &&
    /minimumTextHeight = 1\.0 \/ 32\.0/.test(visionOcrSource) &&
    /CGDataProviderCreateWithData/.test(visionOcrSource),
  "Vision OCR should reuse tight alpha bounds, ignore implausibly tiny text, and avoid copying its CGImage bytes",
);
assert(
  /class BitmapOcrExecutor/.test(nativeSource) &&
    /bitmap-ocr-superseded/.test(nativeSource) &&
    /bitmap_ocr_executor\.enqueue/.test(nativeSource),
  "Bitmap OCR should run on a superseding serial executor outside the lookup loop",
);
assert(
  /renderer\.margin_left/.test(visionOcrSource) &&
    /renderer\.margin_top/.test(visionOcrSource) &&
    /renderer\.width - renderer\.margin_left - renderer\.margin_right/.test(
      visionOcrSource,
    ),
  "Screenshot OCR boxes should map into the displayed video viewport",
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
    /fallbackRuns/.test(nativeSource) &&
    /font-metrics-provider-unverified/.test(nativeSource) &&
    /libass_name_can_select_face/.test(nativeSource) &&
    /libass_coretext_font_substitution/.test(nativeSource),
  "CoreText fallback, libass selector mismatches, and uncovered glyphs should be explicit",
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
  /--controller-enabled "\$CONTROLLER_ENABLED"/.test(workerSource) &&
    /prefBool\("controllerEnabled", false\)/.test(workerSource),
  "Worker launch should pass the opt-in controller preference to the native helper",
);
assert(
  /umask 077/.test(workerSource) &&
    /chmod 700 "\$WORKER_ROOT"/.test(workerSource),
  "Worker IPC containing media URLs should stay private to the current user",
);
assert(
  /WORKER_ROOT="\$2"/.test(workerSource) &&
    /\[\s*workerStartScriptPath\(\),\s*dataRoot\(\),\s*workerRoot\(\)/.test(
      workerSource,
    ),
  "Each player should launch its worker with an isolated runtime directory",
);
assert(
  /--controller-enabled bool/.test(nativeSource) &&
    /if \(controller_enabled\)/.test(nativeSource) &&
    /\\\"enabled\\\":/.test(nativeSource),
  "Native worker controller monitoring should be conditional and advertised",
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
  /incompatible mouse intent capability/.test(buildScript) &&
    /coregraphics-counter/.test(nativeBuildScript),
  "Release validation should reject a helper without native mouse intent",
);
assert(
  /incompatible controller capability/.test(buildScript) &&
    /controller\.get\("source"\) != "native-hid"/.test(nativeBuildScript),
  "Release validation should reject a helper without native controller input",
);
const nativeDependencyBuildScript = fs.readFileSync(
  path.join(root, "scripts/build_native_geometry_dependencies.sh"),
  "utf8",
);
const nativeDependencyLock = fs.readFileSync(
  path.join(root, "native-dependencies.lock.json"),
  "utf8",
);
assert(
  /find_library\(CORETEXT_FRAMEWORK CoreText REQUIRED\)/.test(
    nativeBuildScript,
  ) &&
    /COREFOUNDATION_FRAMEWORK/.test(nativeBuildScript) &&
    /find_library\(IOKIT_FRAMEWORK IOKit REQUIRED\)/.test(nativeBuildScript),
  "Native backend build should link CoreText, CoreFoundation, and IOKit",
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
assert(
  /--retry 5/.test(nativeDependencyBuildScript) &&
    /--retry-max-time 120/.test(nativeDependencyBuildScript) &&
    /-o "\$partial"[\s\S]*mv "\$partial" "\$archive"/.test(
      nativeDependencyBuildScript,
    ),
  "Pinned native dependency downloads should retry transient failures and publish archives atomically",
);
assert(
  /download-mirror\.savannah\.gnu\.org\/releases\/freetype/.test(
    nativeDependencyLock,
  ),
  "The pinned FreeType archive should use Savannah's working download mirror",
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
  fs.existsSync(nativeBinary) &&
  process.env.IINATAN_SKIP_NATIVE_FONT_METRICS !== "1"
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
        { encoding: "utf8", timeout: 15000 },
      );
      assert(
        !result.error,
        "Native font metric probe failed to complete: " +
          String(result.error || ""),
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
  const fallbackMetrics = runFontMetrics("YuMin-Medium", false, false, "日本➨");
  assert(
    fallbackMetrics.status === 0,
    "A cue with a primary-face miss should resolve through CoreText fallback",
  );
  const fallbackResult = JSON.parse(fallbackMetrics.stdout);
  assert(
    Array.isArray(fallbackResult.cueCoverage.fallbackRuns) &&
      fallbackResult.cueCoverage.fallbackRuns.some(
        (run) =>
          run.startUtf16 === 2 &&
          run.endUtf16 === 3 &&
          typeof run.postScriptName === "string" &&
          run.postScriptName.length > 0,
      ),
    "Fallback coverage should identify the exact uncovered UTF-16 run and face",
  );
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
