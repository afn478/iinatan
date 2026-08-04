#include "bitmap_subtitle.hpp"

#include <algorithm>
#include <chrono>
#include <cerrno>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <fcntl.h>
#include <limits.h>
#include <memory>
#include <sys/stat.h>
#include <unistd.h>

#ifdef IINATAN_ASS_GEOMETRY
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/log.h>
#include <libavutil/mathematics.h>
#include <libavutil/mem.h>
}
#endif

namespace iinatan::bitmap {
namespace {

using Clock = std::chrono::steady_clock;

int64_t elapsed_ms(Clock::time_point start) {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             Clock::now() - start)
      .count();
}

DecodeResult failure(
    const std::string& reason, const std::string& detail = "",
    DecodeMetrics metrics = {}) {
  DecodeResult result;
  result.reason = reason;
  result.detail = detail;
  result.metrics = std::move(metrics);
  return result;
}

#ifdef IINATAN_ASS_GEOMETRY
constexpr int kMaxStreams = 128;
constexpr int kMaxPackets = 100000;
constexpr size_t kMaxPacketBytes = 8 * 1024 * 1024;
constexpr size_t kMaxSelectedPacketBytes = 64 * 1024 * 1024;
constexpr size_t kMaxCachedFrameBytes = 16 * 1024 * 1024;
constexpr size_t kMaxCachedFrames = 8;
constexpr int64_t kNearPrerollMs = 1500;
constexpr int64_t kBroadPrerollMs = 12000;
constexpr int64_t kPostrollMs = 3000;
constexpr int64_t kNetworkForwardWindowMs = 5000;
constexpr int64_t kLocalForwardWindowMs = 30000;

struct FileHandle {
  int fd = -1;
  ~FileHandle() {
    if (fd >= 0) close(fd);
  }
};

struct AvioOwner {
  AVIOContext* value = nullptr;
  ~AvioOwner() {
    if (value) avio_context_free(&value);
  }
};

struct FormatOwner {
  AVFormatContext* value = nullptr;
  bool custom_io = false;
  ~FormatOwner() {
    if (!value) return;
    if (custom_io) value->pb = nullptr;
    avformat_close_input(&value);
  }
};

struct CodecOwner {
  AVCodecContext* value = nullptr;
  ~CodecOwner() { avcodec_free_context(&value); }
};

struct PacketOwner {
  AVPacket* value = av_packet_alloc();
  ~PacketOwner() { av_packet_free(&value); }
};

struct Deadline {
  Clock::time_point value;
  std::function<bool()> cancelled;
};

struct DecoderSession {
  SourceRequest source;
  Deadline deadline;
  FileHandle file;
  AvioOwner avio;
  FormatOwner format;
  CodecOwner codec;
  int stream_index = -1;
  const AVCodec* decoder = nullptr;
  int64_t cursor_ms = -1;
  std::deque<Frame> frames;
  size_t frame_bytes = 0;
};

int interrupt_request(void* opaque) {
  const auto* deadline = static_cast<const Deadline*>(opaque);
  return deadline &&
      (Clock::now() >= deadline->value ||
       (deadline->cancelled && deadline->cancelled()));
}

bool is_network(const std::string& path) {
  return path.starts_with("http://") || path.starts_with("https://");
}

bool safe_network(const std::string& path) {
  return is_network(path) && path.size() <= 4096 &&
      std::none_of(path.begin(), path.end(), [](unsigned char value) {
        return value <= 0x20 || value == 0x7f || value == '<' ||
            value == '>' || value == '"' || value == '\'';
      });
}

int read_packet(void* opaque, uint8_t* buffer, int size) {
  const int fd = *static_cast<int*>(opaque);
  while (true) {
    const ssize_t count = read(fd, buffer, static_cast<size_t>(size));
    if (count > 0) return static_cast<int>(count);
    if (count == 0) return AVERROR_EOF;
    if (errno != EINTR) return AVERROR(errno);
  }
}

int64_t seek_file(void* opaque, int64_t offset, int whence) {
  const int fd = *static_cast<int*>(opaque);
  if (whence == AVSEEK_SIZE) {
    struct stat status {};
    return fstat(fd, &status) == 0 ? status.st_size : AVERROR(errno);
  }
  const int base = whence & ~AVSEEK_FORCE;
  if (base != SEEK_SET && base != SEEK_CUR && base != SEEK_END)
    return AVERROR(EINVAL);
  const off_t result = lseek(fd, static_cast<off_t>(offset), base);
  return result < 0 ? AVERROR(errno) : static_cast<int64_t>(result);
}

std::string av_error(int code) {
  char buffer[AV_ERROR_MAX_STRING_SIZE] = {};
  av_strerror(code, buffer, sizeof(buffer));
  return buffer;
}

bool supported_codec(AVCodecID codec) {
  return codec == AV_CODEC_ID_HDMV_PGS_SUBTITLE ||
      codec == AV_CODEC_ID_DVD_SUBTITLE ||
      codec == AV_CODEC_ID_DVB_SUBTITLE || codec == AV_CODEC_ID_XSUB;
}

int choose_stream(AVFormatContext* format, const SourceRequest& source) {
  if (source.ff_index >= 0) {
    if (source.ff_index < static_cast<int>(format->nb_streams)) {
      const AVCodecParameters* parameters =
          format->streams[source.ff_index]->codecpar;
      if (parameters && parameters->codec_type == AVMEDIA_TYPE_SUBTITLE &&
          supported_codec(parameters->codec_id))
        return source.ff_index;
    }
    if (!source.auto_stream || !source.cache_excerpt) return -1;
  }
  if (!source.auto_stream || !source.cache_excerpt) return -1;
  int selected = -1;
  for (unsigned index = 0; index < format->nb_streams; ++index) {
    const AVCodecParameters* parameters = format->streams[index]->codecpar;
    if (!parameters || parameters->codec_type != AVMEDIA_TYPE_SUBTITLE ||
        !supported_codec(parameters->codec_id))
      continue;
    if (selected >= 0) return -2;
    selected = static_cast<int>(index);
  }
  return selected;
}

bool same_source(
    const DecoderSession& session, const SourceRequest& source) {
  return session.source.path == source.path &&
      session.source.ff_index == source.ff_index &&
      session.source.auto_stream == source.auto_stream &&
      session.source.cache_excerpt == source.cache_excerpt;
}

std::unique_ptr<DecoderSession> open_decoder_session(
    const SourceRequest& source, const Deadline& deadline,
    DecodeResult& error, DecodeMetrics& metrics) {
  const auto open_start = Clock::now();
  auto session = std::make_unique<DecoderSession>();
  session->source = source;
  session->deadline = deadline;
  session->format.value = avformat_alloc_context();
  if (!session->format.value) {
    error = failure("out-of-memory", "", metrics);
    return nullptr;
  }
  session->format.value->probesize = 4 * 1024 * 1024;
  session->format.value->max_analyze_duration = AV_TIME_BASE;
  session->format.value->interrupt_callback = {
      interrupt_request, &session->deadline};
  int code = 0;
  if (is_network(source.path)) {
    AVDictionary* options = nullptr;
    av_dict_set(&options, "protocol_whitelist", "http,https,tcp,tls", 0);
    av_dict_set(&options, "rw_timeout", "15000000", 0);
    code = avformat_open_input(
        &session->format.value, source.path.c_str(), nullptr, &options);
    av_dict_free(&options);
  } else {
    char resolved[PATH_MAX] = {};
    if (!realpath(source.path.c_str(), resolved)) {
      error = failure("media-open-failed", std::strerror(errno), metrics);
      return nullptr;
    }
    session->file.fd = open(resolved, O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (session->file.fd < 0) {
      error = failure("media-open-failed", std::strerror(errno), metrics);
      return nullptr;
    }
    struct stat status {};
    if (fstat(session->file.fd, &status) != 0 || !S_ISREG(status.st_mode)) {
      error = failure("unsafe-media-path", "", metrics);
      return nullptr;
    }
    uint8_t* buffer = static_cast<uint8_t*>(av_malloc(64 * 1024));
    if (!buffer) {
      error = failure("out-of-memory", "", metrics);
      return nullptr;
    }
    session->avio.value = avio_alloc_context(
        buffer, 64 * 1024, 0, &session->file.fd, read_packet, nullptr,
        seek_file);
    if (!session->avio.value) {
      av_free(buffer);
      error = failure("out-of-memory", "", metrics);
      return nullptr;
    }
    session->avio.value->seekable = AVIO_SEEKABLE_NORMAL;
    session->format.value->pb = session->avio.value;
    session->format.value->flags |= AVFMT_FLAG_CUSTOM_IO;
    session->format.custom_io = true;
    code = avformat_open_input(
        &session->format.value, nullptr, nullptr, nullptr);
  }
  metrics.open_ms += elapsed_ms(open_start);
  if (code < 0) {
    error = failure("unsupported-container", av_error(code), metrics);
    return nullptr;
  }
  if (session->format.value->nb_streams > kMaxStreams) {
    error = failure("stream-limit-exceeded", "", metrics);
    return nullptr;
  }

  session->stream_index = choose_stream(session->format.value, source);
  if (session->stream_index < 0) {
    const auto probe_start = Clock::now();
    code = avformat_find_stream_info(session->format.value, nullptr);
    metrics.probe_ms += elapsed_ms(probe_start);
    if (code < 0) {
      error = failure("stream-info-failed", av_error(code), metrics);
      return nullptr;
    }
    if (session->format.value->nb_streams > kMaxStreams) {
      error = failure("stream-limit-exceeded", "", metrics);
      return nullptr;
    }
    session->stream_index = choose_stream(session->format.value, source);
  }
  if (session->stream_index == -2) {
    error = failure("ambiguous-stream-map", "", metrics);
    return nullptr;
  }
  if (session->stream_index < 0) {
    error = failure("bitmap-stream-unavailable", "", metrics);
    return nullptr;
  }
  for (unsigned index = 0; index < session->format.value->nb_streams;
       ++index)
    session->format.value->streams[index]->discard =
        static_cast<int>(index) == session->stream_index
        ? AVDISCARD_DEFAULT
        : AVDISCARD_ALL;

  AVStream* stream = session->format.value->streams[session->stream_index];
  session->decoder = avcodec_find_decoder(stream->codecpar->codec_id);
  if (!session->decoder) {
    error = failure("bitmap-decoder-unavailable", "", metrics);
    return nullptr;
  }
  session->codec.value = avcodec_alloc_context3(session->decoder);
  if (!session->codec.value) {
    error = failure("out-of-memory", "", metrics);
    return nullptr;
  }
  code = avcodec_parameters_to_context(
      session->codec.value, stream->codecpar);
  if (code < 0) {
    error = failure("bitmap-decoder-init-failed", av_error(code), metrics);
    return nullptr;
  }
  code = avcodec_open2(session->codec.value, session->decoder, nullptr);
  if (code < 0) {
    error = failure("bitmap-decoder-init-failed", av_error(code), metrics);
    return nullptr;
  }
  return session;
}

bool valid_canvas(int width, int height) {
  return width >= 16 && height >= 16 &&
      static_cast<int64_t>(width) * height <= 16'000'000;
}

void blend_pixel(uint8_t* destination, uint8_t r, uint8_t g, uint8_t b,
                 uint8_t a) {
  if (a == 0) return;
  const int inverse = 255 - a;
  destination[0] = static_cast<uint8_t>(
      std::min(255, static_cast<int>(r) + destination[0] * inverse / 255));
  destination[1] = static_cast<uint8_t>(
      std::min(255, static_cast<int>(g) + destination[1] * inverse / 255));
  destination[2] = static_cast<uint8_t>(
      std::min(255, static_cast<int>(b) + destination[2] * inverse / 255));
  destination[3] = static_cast<uint8_t>(
      std::min(255, static_cast<int>(a) + destination[3] * inverse / 255));
}

bool copy_subtitle(
    const AVSubtitle& subtitle, int fallback_width, int fallback_height,
    int64_t start_ms, int64_t end_ms, Frame& frame) {
  int canvas_width = fallback_width;
  int canvas_height = fallback_height;
  int left = std::numeric_limits<int>::max();
  int top = std::numeric_limits<int>::max();
  int right = 0;
  int bottom = 0;
  for (unsigned index = 0; index < subtitle.num_rects; ++index) {
    const AVSubtitleRect* rect = subtitle.rects[index];
    if (!rect || rect->type != SUBTITLE_BITMAP || rect->w <= 0 ||
        rect->h <= 0)
      continue;
    canvas_width = std::max(canvas_width, rect->x + rect->w);
    canvas_height = std::max(canvas_height, rect->y + rect->h);
    left = std::min(left, rect->x);
    top = std::min(top, rect->y);
    right = std::max(right, rect->x + rect->w);
    bottom = std::max(bottom, rect->y + rect->h);
  }
  if (!valid_canvas(canvas_width, canvas_height) || right <= left ||
      bottom <= top)
    return false;
  left = std::max(0, left - 4);
  top = std::max(0, top - 4);
  right = std::min(canvas_width, right + 4);
  bottom = std::min(canvas_height, bottom + 4);
  if (!valid_canvas(right - left, bottom - top)) return false;

  Frame candidate;
  candidate.width = right - left;
  candidate.height = bottom - top;
  candidate.canvas_width = canvas_width;
  candidate.canvas_height = canvas_height;
  candidate.origin_x = left;
  candidate.origin_y = top;
  candidate.start_ms = start_ms;
  candidate.end_ms = end_ms;
  candidate.rgba.assign(
      static_cast<size_t>(candidate.width) * candidate.height * 4, 0);
  bool drew = false;
  for (unsigned index = 0; index < subtitle.num_rects; ++index) {
    const AVSubtitleRect* rect = subtitle.rects[index];
    if (!rect || rect->type != SUBTITLE_BITMAP || !rect->data[0] ||
        !rect->data[1] || rect->linesize[0] < rect->w || rect->nb_colors <= 0)
      continue;
    if (rect->x < 0 || rect->y < 0 ||
        rect->x + rect->w > canvas_width ||
        rect->y + rect->h > canvas_height)
      return false;
    const auto* palette = reinterpret_cast<const uint32_t*>(rect->data[1]);
    for (int y = 0; y < rect->h; ++y) {
      const uint8_t* row = rect->data[0] + y * rect->linesize[0];
      for (int x = 0; x < rect->w; ++x) {
        const int palette_index = row[x];
        if (palette_index >= rect->nb_colors) continue;
        const uint32_t color = palette[palette_index];
        const uint8_t alpha = static_cast<uint8_t>(color >> 24);
        const uint8_t red = static_cast<uint8_t>(color >> 16);
        const uint8_t green = static_cast<uint8_t>(color >> 8);
        const uint8_t blue = static_cast<uint8_t>(color);
        const int local_x = rect->x + x - candidate.origin_x;
        const int local_y = rect->y + y - candidate.origin_y;
        uint8_t* destination = candidate.rgba.data() +
            (static_cast<size_t>(local_y) * candidate.width + local_x) * 4;
        blend_pixel(destination, red, green, blue, alpha);
        drew = drew || alpha != 0;
      }
    }
  }
  if (!drew) return false;
  frame = std::move(candidate);
  return true;
}

void cache_frame(DecoderSession& session, Frame frame) {
  if (frame.rgba.empty()) return;
  for (auto iterator = session.frames.begin();
       iterator != session.frames.end(); ++iterator) {
    if (iterator->start_ms != frame.start_ms) continue;
    session.frame_bytes -= iterator->rgba.size();
    session.frames.erase(iterator);
    break;
  }
  session.frame_bytes += frame.rgba.size();
  session.frames.push_back(std::move(frame));
  while (session.frames.size() > kMaxCachedFrames ||
         session.frame_bytes > kMaxCachedFrameBytes) {
    session.frame_bytes -= session.frames.front().rgba.size();
    session.frames.pop_front();
  }
}

std::optional<Frame> cached_frame_at(
    const DecoderSession& session, int64_t time_ms, int64_t cue_start_ms,
    int64_t cue_end_ms) {
  for (auto iterator = session.frames.rbegin();
       iterator != session.frames.rend(); ++iterator) {
    if (cue_start_ms >= 0 &&
        std::abs(iterator->start_ms - cue_start_ms) > 500)
      continue;
    if (iterator->start_ms <= time_ms && time_ms < iterator->end_ms) {
      Frame result = *iterator;
      if (cue_end_ms > result.start_ms)
        result.end_ms = std::min(result.end_ms, cue_end_ms);
      return result;
    }
  }
  return std::nullopt;
}

int64_t packet_time_ms(const AVPacket& packet, AVFormatContext* format) {
  if (packet.pts == AV_NOPTS_VALUE || packet.stream_index < 0 ||
      packet.stream_index >= static_cast<int>(format->nb_streams))
    return -1;
  return av_rescale_q(
      packet.pts, format->streams[packet.stream_index]->time_base,
      AVRational{1, 1000});
}

bool seek_session(
    DecoderSession& session, int64_t seek_ms, DecodeMetrics& metrics) {
  const auto seek_start = Clock::now();
  AVStream* stream = session.format.value->streams[session.stream_index];
  const int64_t global_timestamp = av_rescale_q(
      seek_ms, AVRational{1, 1000}, AV_TIME_BASE_Q);
  int code = av_seek_frame(
      session.format.value, -1, global_timestamp, AVSEEK_FLAG_BACKWARD);
  if (code < 0) {
    const int64_t stream_timestamp = av_rescale_q(
        seek_ms, AVRational{1, 1000}, stream->time_base);
    code = av_seek_frame(
        session.format.value, session.stream_index, stream_timestamp,
        AVSEEK_FLAG_BACKWARD);
  }
  metrics.seek_ms += elapsed_ms(seek_start);
  if (code < 0) return false;
  avcodec_flush_buffers(session.codec.value);
  session.cursor_ms = seek_ms;
  return true;
}

DecodeResult decode_until(
    DecoderSession& session, int64_t time_ms, int64_t cue_start_ms,
    int64_t cue_end_ms, DecodeMetrics metrics) {
  const auto demux_start = Clock::now();
  PacketOwner packet;
  if (!packet.value) return failure("out-of-memory", "", metrics);
  size_t selected_bytes = 0;
  int decoded_subtitles = 0;
  int decoded_rects = 0;
  int copy_failures = 0;
  int64_t first_start_ms = -1;
  int64_t last_start_ms = -1;
  int64_t first_rect_start_ms = -1;
  int64_t first_rect_end_ms = -1;
  const int64_t stop_ms = std::max(time_ms, cue_end_ms) + kPostrollMs;

  while (++metrics.packets <= kMaxPackets &&
         !interrupt_request(&session.deadline)) {
    const int code = av_read_frame(session.format.value, packet.value);
    if (code < 0) break;
    const int64_t any_packet_ms =
        packet_time_ms(*packet.value, session.format.value);
    if (any_packet_ms >= 0)
      session.cursor_ms = std::max(session.cursor_ms, any_packet_ms);
    if (packet.value->stream_index != session.stream_index) {
      av_packet_unref(packet.value);
      if (session.cursor_ms > stop_ms) break;
      continue;
    }
    if (packet.value->size < 0 ||
        static_cast<size_t>(packet.value->size) > kMaxPacketBytes ||
        selected_bytes + static_cast<size_t>(packet.value->size) >
            kMaxSelectedPacketBytes)
      return failure("bitmap-packet-limit-exceeded", "", metrics);
    selected_bytes += static_cast<size_t>(packet.value->size);
    metrics.packet_bytes += packet.value->size;
    const int64_t subtitle_packet_ms = packet_time_ms(
        *packet.value, session.format.value);
    AVSubtitle subtitle {};
    int got_subtitle = 0;
    const int decoded = avcodec_decode_subtitle2(
        session.codec.value, &subtitle, &got_subtitle, packet.value);
    av_packet_unref(packet.value);
    if (decoded < 0) continue;
    if (got_subtitle) {
      ++decoded_subtitles;
      decoded_rects += static_cast<int>(subtitle.num_rects);
      const int64_t subtitle_ms = subtitle.pts == AV_NOPTS_VALUE
          ? -1
          : subtitle.pts / 1000;
      const int64_t base_ms = subtitle_ms >= 0
          ? subtitle_ms
          : subtitle_packet_ms;
      const int64_t start_ms = base_ms < 0
          ? -1
          : base_ms + static_cast<int64_t>(subtitle.start_display_time);
      int64_t end_ms = start_ms +
          static_cast<int64_t>(subtitle.end_display_time);
      if (end_ms <= start_ms || end_ms - start_ms > 10 * 60 * 1000)
        end_ms = start_ms + 60 * 1000;
      if (start_ms >= 0) {
        if (first_start_ms < 0) first_start_ms = start_ms;
        last_start_ms = start_ms;
      }
      if (subtitle.num_rects > 0 && first_rect_start_ms < 0) {
        first_rect_start_ms = start_ms;
        first_rect_end_ms = end_ms;
      }
      if (start_ms >= 0 && subtitle.num_rects > 0) {
        Frame candidate;
        const auto compose_start = Clock::now();
        const bool copied = copy_subtitle(
            subtitle, session.codec.value->width,
            session.codec.value->height, start_ms, end_ms, candidate);
        metrics.compose_ms += elapsed_ms(compose_start);
        if (copied)
          cache_frame(session, std::move(candidate));
        else
          ++copy_failures;
      }
      avsubtitle_free(&subtitle);
      if (std::optional<Frame> active = cached_frame_at(
              session, time_ms, cue_start_ms, cue_end_ms)) {
        if (last_start_ms > time_ms || session.cursor_ms > stop_ms) {
          metrics.demux_ms += elapsed_ms(demux_start);
          DecodeResult result;
          result.ok = true;
          result.codec = session.decoder->name ? session.decoder->name : "";
          result.stream_index = session.stream_index;
          result.frame = std::move(*active);
          result.metrics = std::move(metrics);
          return result;
        }
      }
    }
    if (session.cursor_ms > stop_ms) break;
  }
  metrics.demux_ms += elapsed_ms(demux_start);
  metrics.cancelled = session.deadline.cancelled &&
      session.deadline.cancelled();
  if (metrics.cancelled)
    return failure("bitmap-ocr-superseded", "", metrics);
  if (std::optional<Frame> active = cached_frame_at(
          session, time_ms, cue_start_ms, cue_end_ms)) {
    DecodeResult result;
    result.ok = true;
    result.codec = session.decoder->name ? session.decoder->name : "";
    result.stream_index = session.stream_index;
    result.frame = std::move(*active);
    result.metrics = std::move(metrics);
    return result;
  }
  return failure(
      "bitmap-cue-unavailable",
      "decoded=" + std::to_string(decoded_subtitles) +
          ",rects=" + std::to_string(decoded_rects) +
          ",copyFailures=" + std::to_string(copy_failures) +
          ",firstStartMs=" + std::to_string(first_start_ms) +
          ",firstRectStartMs=" + std::to_string(first_rect_start_ms) +
          ",firstRectEndMs=" + std::to_string(first_rect_end_ms) +
          ",lastStartMs=" + std::to_string(last_start_ms),
      metrics);
}
#endif

}  // namespace

DecodeResult decode_subtitle_at(
    const SourceRequest& source, int64_t time_ms, int64_t cue_start_ms,
    int64_t cue_end_ms, const std::function<bool()>& cancelled) {
#ifndef IINATAN_ASS_GEOMETRY
  (void)source;
  (void)time_ms;
  (void)cue_start_ms;
  (void)cue_end_ms;
  (void)cancelled;
  return failure("bitmap-ocr-unavailable", "native media stack absent");
#else
  av_log_set_level(AV_LOG_QUIET);
  if (time_ms < 0 || source.path.empty() || source.path.size() > 4096 ||
      source.path.find('\0') != std::string::npos ||
      (is_network(source.path) && !safe_network(source.path)) ||
      (!is_network(source.path) && source.path[0] != '/') ||
      (source.ff_index < 0 && !(source.auto_stream && source.cache_excerpt)))
    return failure("unsafe-media-path");

  DecodeMetrics metrics;
  const Deadline deadline{
      Clock::now() + std::chrono::seconds(is_network(source.path) ? 6 : 20),
      cancelled};
  static std::unique_ptr<DecoderSession> cached_session;
  if (!cached_session || !same_source(*cached_session, source)) {
    DecodeResult open_error;
    cached_session = open_decoder_session(
        source, deadline, open_error, metrics);
    if (!cached_session) return open_error;
  } else {
    metrics.session_reused = true;
    cached_session->deadline = deadline;
  }
  DecoderSession& session = *cached_session;
  if (cancelled && cancelled()) {
    metrics.cancelled = true;
    return failure("bitmap-ocr-superseded", "", metrics);
  }
  if (std::optional<Frame> cached = cached_frame_at(
          session, time_ms, cue_start_ms, cue_end_ms)) {
    metrics.cache_hit = true;
    metrics.strategy = "cache";
    DecodeResult result;
    result.ok = true;
    result.codec = session.decoder->name ? session.decoder->name : "";
    result.stream_index = session.stream_index;
    result.frame = std::move(*cached);
    result.metrics = std::move(metrics);
    return result;
  }

  const int64_t forward_window = is_network(source.path)
      ? kNetworkForwardWindowMs
      : kLocalForwardWindowMs;
  if (session.cursor_ms >= 0 && time_ms >= session.cursor_ms &&
      time_ms - session.cursor_ms <= forward_window) {
    metrics.strategy = "forward";
    DecodeResult forward = decode_until(
        session, time_ms, cue_start_ms, cue_end_ms, metrics);
    if (forward.ok || forward.reason == "bitmap-ocr-superseded")
      return forward;
    metrics = forward.metrics;
  }

  const int64_t anchor_ms = cue_start_ms >= 0 ? cue_start_ms : time_ms;
  const int64_t near_seek_ms =
      std::max<int64_t>(0, anchor_ms - kNearPrerollMs);
  metrics.strategy = "near-seek";
  if (!seek_session(session, near_seek_ms, metrics))
    return failure("media-seek-failed", "near seek failed", metrics);
  DecodeResult near = decode_until(
      session, time_ms, cue_start_ms, cue_end_ms, metrics);
  if (near.ok || near.reason == "bitmap-ocr-superseded") return near;

  metrics = near.metrics;
  const int64_t broad_seek_ms =
      std::max<int64_t>(0, anchor_ms - kBroadPrerollMs);
  if (broad_seek_ms == near_seek_ms || interrupt_request(&session.deadline))
    return near;
  metrics.strategy = "broad-seek";
  if (!seek_session(session, broad_seek_ms, metrics)) return near;
  return decode_until(
      session, time_ms, cue_start_ms, cue_end_ms, metrics);
#endif
}

std::vector<std::string> available_decoders() {
#ifdef IINATAN_ASS_GEOMETRY
  const std::pair<AVCodecID, const char*> codecs[] = {
      {AV_CODEC_ID_HDMV_PGS_SUBTITLE, "pgs"},
      {AV_CODEC_ID_DVD_SUBTITLE, "dvdsub"},
      {AV_CODEC_ID_DVB_SUBTITLE, "dvbsub"},
      {AV_CODEC_ID_XSUB, "xsub"},
  };
  std::vector<std::string> result;
  for (const auto& [id, name] : codecs)
    if (avcodec_find_decoder(id)) result.emplace_back(name);
  return result;
#else
  return {};
#endif
}

}  // namespace iinatan::bitmap
