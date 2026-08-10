const FFMPEG_MEDIA_URL_SCHEMES = Object.freeze({
  ftp: true,
  ftps: true,
  http: true,
  https: true,
  rtmp: true,
  rtmps: true,
  rtp: true,
  rtsp: true,
  rtsps: true,
  smb: true,
  srt: true,
  tcp: true,
  udp: true,
});

const IINA_ONLINE_MEDIA_SUBTITLE_EDL_PREFIX =
  "edl://!no_clip;!delay_open,media_type=sub";
const IINA_ONLINE_MEDIA_SUBTITLE_EDL_MAX_LENGTH = 64 * 1024;

function mediaFileUrlPath(value) {
  let path = String(value || "")
    .replace(/^file:\/\/localhost/i, "file://")
    .replace(/^file:\/\//i, "");
  try {
    path = decodeURIComponent(path);
  } catch (_) {}
  return path;
}

function mediaSourceDescriptor(rawValue, origin) {
  const raw = String(rawValue || "").trim();
  const source = {
    raw,
    locator: raw,
    origin: String(origin || ""),
    kind: "unusable",
    ffmpegReadable: false,
    nativeAssReadable: false,
  };
  if (!raw) return source;
  if (raw.charAt(0) === "/") {
    source.kind = "local-file";
    source.ffmpegReadable = true;
    source.nativeAssReadable = true;
    return source;
  }
  if (/^file:\/\/(?:localhost)?\//i.test(raw)) {
    source.locator = mediaFileUrlPath(raw);
    if (source.locator.charAt(0) === "/") {
      source.kind = "local-file";
      source.ffmpegReadable = true;
      source.nativeAssReadable = true;
    }
    return source;
  }
  const match = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (!match) return source;
  const scheme = match[1].toLowerCase();
  if (scheme === "http" || scheme === "https") {
    if (/[\s<>"']/.test(raw)) return source;
    source.kind = "http-url";
    source.ffmpegReadable = true;
    source.nativeAssReadable = true;
    return source;
  }
  if (FFMPEG_MEDIA_URL_SCHEMES[scheme]) {
    source.kind = "ffmpeg-url";
    source.ffmpegReadable = true;
    return source;
  }
  source.kind = "mpv-only";
  return source;
}

function subtitleFormatName(value) {
  const format = String(value || "")
    .trim()
    .toLowerCase();
  if (format === "srt" || format === "subrip") return "srt";
  if (format === "vtt" || format === "webvtt") return "webvtt";
  if (format === "ass" || format === "ssa") return "ass";
  return "";
}

function subtitleFormatFromHttpUrl(value) {
  const raw = String(value || "");
  const path = raw.split(/[?#]/, 1)[0].toLowerCase();
  if (path.endsWith(".srt")) return "srt";
  if (path.endsWith(".vtt")) return "webvtt";
  if (path.endsWith(".ass") || path.endsWith(".ssa")) return "ass";
  const queryStart = raw.indexOf("?");
  if (queryStart < 0) return "";
  const fragmentStart = raw.indexOf("#", queryStart + 1);
  const query = raw.slice(
    queryStart + 1,
    fragmentStart < 0 ? raw.length : fragmentStart,
  );
  for (const field of query.split("&")) {
    const separator = field.indexOf("=");
    if (separator < 0) continue;
    let key = field.slice(0, separator);
    try {
      key = decodeURIComponent(key);
    } catch (_) {}
    if (key.toLowerCase() !== "fmt") continue;
    let format = field.slice(separator + 1);
    try {
      format = decodeURIComponent(format);
    } catch (_) {}
    return subtitleFormatName(format);
  }
  return "";
}

function iinaOnlineMediaSubtitleEdlSource(rawValue) {
  // Online Media uses one length-delimited subtitle URL behind these two EDL
  // headers. Keep this exact so arbitrary mpv EDL programs stay opaque.
  const raw = String(rawValue || "");
  if (
    !raw.startsWith(IINA_ONLINE_MEDIA_SUBTITLE_EDL_PREFIX) ||
    raw.length > IINA_ONLINE_MEDIA_SUBTITLE_EDL_MAX_LENGTH
  )
    return null;
  let cursor = IINA_ONLINE_MEDIA_SUBTITLE_EDL_PREFIX.length;
  let declaredCodec = "";
  if (raw.startsWith(",codec=", cursor)) {
    const end = raw.indexOf(";", cursor);
    if (end < 0) return null;
    declaredCodec = raw.slice(cursor + 7, end);
    if (!/^[a-z0-9_.+-]{1,32}$/i.test(declaredCodec)) return null;
    cursor = end;
  }
  if (raw.charAt(cursor) !== ";" || raw.charAt(cursor + 1) !== "%") return null;
  const lengthEnd = raw.indexOf("%", cursor + 2);
  if (lengthEnd < 0) return null;
  const lengthText = raw.slice(cursor + 2, lengthEnd);
  if (!/^[1-9][0-9]{0,5}$/.test(lengthText)) return null;
  const locator = raw.slice(lengthEnd + 1);
  if (Number(lengthText) !== locator.length) return null;
  const source = mediaSourceDescriptor(locator, "subtitle-track");
  if (source.kind !== "http-url") return null;
  const declaredFormat = subtitleFormatName(declaredCodec);
  return {
    format: declaredFormat || subtitleFormatFromHttpUrl(source.locator),
    source,
  };
}

function mediaSourceTrackList() {
  try {
    const value = mpv.getNative("track-list");
    if (Array.isArray(value)) return value;
  } catch (_) {}
  try {
    const value = JSON.parse(String(mpv.getString("track-list") || "[]"));
    if (Array.isArray(value)) return value;
  } catch (_) {}
  return [];
}

function mediaSourceProperty(name) {
  try {
    return String(mpv.getString(name) || "").trim();
  } catch (_) {
    return "";
  }
}

function mediaSourceSnapshot(values) {
  const input = values && typeof values === "object" ? values : {};
  const original = mediaSourceDescriptor(input.path, "path");
  const effective = mediaSourceDescriptor(
    input.streamOpenFilename,
    "stream-open-filename",
  );
  // A nonempty effective source is authoritative even when only mpv can open
  // it. Falling back to an original webpage URL would hand HTML to FFmpeg.
  const primary = effective.raw ? effective : original;
  const tracks = Array.isArray(input.trackList) ? input.trackList : [];
  const selectedAudio = tracks.find(
    (track) =>
      track &&
      String(track.type || "").toLowerCase() === "audio" &&
      !!track.selected,
  );
  const externalAudio = selectedAudio
    ? String(
        selectedAudio.externalFilename ||
          selectedAudio["external-filename"] ||
          "",
      ).trim()
    : "";
  const audio = externalAudio
    ? mediaSourceDescriptor(externalAudio, "selected-audio-track")
    : primary;
  return {
    original,
    effective,
    primary,
    audio,
    display: original.raw ? original : primary,
  };
}

function currentMediaSourceSnapshot() {
  return mediaSourceSnapshot({
    path: mediaSourceProperty("path"),
    streamOpenFilename: mediaSourceProperty("stream-open-filename"),
    trackList: mediaSourceTrackList(),
  });
}

function mediaSourceDiagnosticClass(source) {
  const value = source && typeof source === "object" ? source : {};
  if (value.origin === "subtitle-track")
    return value.kind === "local-file"
      ? "external-subtitle-file"
      : value.kind === "http-url"
        ? "external-subtitle-url"
        : "external-subtitle-unsupported";
  if (value.kind === "local-file")
    return String(value.locator || "").indexOf("/Volumes/") === 0
      ? "mounted-share"
      : "local-file";
  if (value.kind === "http-url")
    return value.origin === "stream-open-filename"
      ? "resolved-url"
      : "direct-url";
  if (value.kind === "mpv-only") return "pseudo-url";
  return value.kind === "ffmpeg-url" ? "ffmpeg-url" : "unavailable";
}
