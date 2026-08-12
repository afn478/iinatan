const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const context = { JSON, Object, String, Array };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(root, "src/main/05_media_source.js"), "utf8"),
  context,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function descriptor(value) {
  return context.mediaSourceDescriptor(value, "test");
}

assert(
  descriptor("/Movies/video.mkv").kind === "local-file" &&
    descriptor("/Volumes/NAS/video.mkv").nativeAssReadable,
  "local files and mounted shares remain native-ASS-readable paths",
);
assert(
  context.mediaSourceDiagnosticClass(
    context.mediaSourceDescriptor("/Volumes/NAS/video.mkv", "path"),
  ) === "mounted-share",
  "mounted shares remain distinguishable without exposing their path",
);
assert(
  descriptor("file:///Volumes/NAS/My%20Video.mkv").locator ===
    "/Volumes/NAS/My Video.mkv",
  "file URLs normalize to local filesystem paths",
);
assert(
  descriptor("https://media.example/video.mkv?token=private").kind ===
    "http-url" &&
    context.mediaSourceDiagnosticClass(
      context.mediaSourceDescriptor(
        "https://media.example/video.mkv?token=private",
        "path",
      ),
    ) === "direct-url",
  "direct HTTP(S) media are FFmpeg-readable stream sources",
);
assert(
  descriptor("rtsp://camera.example/live").ffmpegReadable &&
    !descriptor("rtsp://camera.example/live").nativeAssReadable,
  "non-HTTP FFmpeg streams stay distinct from the native ASS helper subset",
);
assert(
  descriptor("edl://%10%memory://video").kind === "mpv-only",
  "mpv pseudo-URLs are classified as mpv-only",
);

function onlineSubtitleEdl(locator, codec) {
  return (
    "edl://!no_clip;!delay_open,media_type=sub" +
    (codec ? ",codec=" + codec : "") +
    ";%" +
    locator.length +
    "%" +
    locator
  );
}

const youtubeSrtUrl =
  "https://www.youtube.com/api/timedtext?v=test&lang=ja&fmt=srt&signature=private";
const youtubeSrt = context.iinaOnlineMediaSubtitleEdlSource(
  onlineSubtitleEdl(youtubeSrtUrl),
);
assert(
  youtubeSrt &&
    youtubeSrt.format === "srt" &&
    youtubeSrt.source.kind === "http-url" &&
    youtubeSrt.source.locator === youtubeSrtUrl,
  "the exact Online Media subtitle EDL unwraps its length-delimited HTTPS SRT URL",
);
assert(
  context.iinaOnlineMediaSubtitleEdlSource(onlineSubtitleEdl(youtubeSrtUrl)) ===
    youtubeSrt,
  "validated Online Media subtitle EDLs are cached for the polling path",
);
const declaredSrt = context.iinaOnlineMediaSubtitleEdlSource(
  onlineSubtitleEdl("https://media.example/subtitle", "subrip"),
);
assert(
  declaredSrt && declaredSrt.format === "srt",
  "an Online Media EDL can identify SRT through a declared codec",
);
assert(
  context.iinaOnlineMediaSubtitleEdlSource(
    onlineSubtitleEdl(youtubeSrtUrl).replace(
      "%" + youtubeSrtUrl.length + "%",
      "%" + (youtubeSrtUrl.length + 1) + "%",
    ),
  ) === null &&
    context.iinaOnlineMediaSubtitleEdlSource(
      onlineSubtitleEdl("ftp://media.example/subtitle.srt"),
    ) === null &&
    context.iinaOnlineMediaSubtitleEdlSource(
      onlineSubtitleEdl(youtubeSrtUrl) + ";%4%more",
    ) === null,
  "malformed, non-HTTP, and multi-segment subtitle EDLs remain rejected",
);

const resolved = context.mediaSourceSnapshot({
  path: "https://video.example/watch/123",
  streamOpenFilename:
    "https://cdn.example/media/master.m3u8?signature=resolved",
  trackList: [],
});
assert(
  resolved.primary.locator.includes("master.m3u8") &&
    resolved.primary.origin === "stream-open-filename" &&
    context.mediaSourceDiagnosticClass(resolved.primary) === "resolved-url",
  "resolved playback prefers mpv's effective stream over the webpage path",
);
assert(
  resolved.display.raw === "https://video.example/watch/123",
  "user-facing source metadata preserves the original webpage URL",
);

const mpvOnly = context.mediaSourceSnapshot({
  path: "https://video.example/watch/123",
  streamOpenFilename: "edl://resolved-by-mpv",
  trackList: [],
});
assert(
  mpvOnly.primary.kind === "mpv-only",
  "an authoritative mpv-only effective source never falls back to webpage HTML",
);
assert(
  context.mediaSourceDiagnosticClass(mpvOnly.primary) === "pseudo-url",
  "unsupported mpv pseudo-URLs have a sanitized diagnostic class",
);

const separateAudio = context.mediaSourceSnapshot({
  path: "https://video.example/watch/123",
  streamOpenFilename: "edl://resolved-by-mpv",
  trackList: [
    {
      type: "audio",
      selected: true,
      external: true,
      "external-filename": "https://audio.example/track.m4a?sig=audio",
    },
  ],
});
assert(
  separateAudio.audio.origin === "selected-audio-track" &&
    separateAudio.audio.ffmpegReadable,
  "resolved separate audio tracks expose their actual playable URL",
);

console.log("media source resolution tests passed");
