#include "media_demux.hpp"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <limits.h>
#include <memory>
#include <string_view>
#include <sys/stat.h>
#include <unistd.h>

#ifdef IINATAN_ASS_GEOMETRY
extern "C" {
#include <libavcodec/codec_id.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
#include <libavutil/log.h>
#include <libavutil/mem.h>
#include <libavutil/mathematics.h>
}
#endif

namespace iinatan::ass {
namespace {

constexpr size_t kMaxCodecPrivate = 4 * 1024 * 1024;
constexpr size_t kMaxPacketBytes = 2 * 1024 * 1024;
constexpr size_t kMaxSubtitlePacketTotal = 16 * 1024 * 1024;
constexpr size_t kMaxAttachmentBytes = 32 * 1024 * 1024;
constexpr size_t kMaxAttachmentTotal = 64 * 1024 * 1024;
constexpr int kMaxStreams = 128;
constexpr int kMaxPackets = 50000;
constexpr int kMaxSelectedSubtitlePackets = 4096;
constexpr int kMaxObservedEvents = 32;

DemuxResult failure(const std::string& reason, const std::string& detail = "") {
  DemuxResult result;
  result.reason = reason;
  result.detail = detail;
  return result;
}

#ifdef IINATAN_ASS_GEOMETRY
struct FileHandle {
  int fd = -1;
  ~FileHandle() {
    if (fd >= 0) close(fd);
  }
};

struct AvioOwner {
  AVIOContext* context = nullptr;
  ~AvioOwner() {
    if (context) avio_context_free(&context);
  }
};

struct FormatOwner {
  AVFormatContext* context = nullptr;
  bool custom_io = false;
  ~FormatOwner() {
    if (!context) return;
    if (custom_io) context->pb = nullptr;
    avformat_close_input(&context);
  }
};

bool network_source(const std::string& path) {
  return path.starts_with("http://") || path.starts_with("https://");
}

bool safe_network_source(const std::string& path) {
  return network_source(path) &&
      std::none_of(path.begin(), path.end(), [](unsigned char value) {
        return value <= 0x20 || value == 0x7f ||
            value == '<' || value == '>' || value == '"' || value == '\'';
      });
}

bool ass_timestamp_ms(const std::string& value, int64_t& result) {
  int hours = 0;
  int minutes = 0;
  int seconds = 0;
  int centiseconds = 0;
  int consumed = 0;
  if (std::sscanf(
          value.c_str(), "%d:%d:%d.%d%n", &hours, &minutes, &seconds,
          &centiseconds, &consumed) != 4 ||
      consumed != static_cast<int>(value.size()) ||
      hours < 0 || minutes < 0 || minutes > 59 ||
      seconds < 0 || seconds > 59 ||
      centiseconds < 0 || centiseconds > 99)
    return false;
  result =
      ((static_cast<int64_t>(hours) * 60 + minutes) * 60 + seconds) *
          1000 +
      centiseconds * 10;
  return true;
}

bool observed_ass_packets(
    DemuxedAss& media, const std::string& ass_extradata,
    const std::string& ass_full) {
  if (ass_extradata.empty() || ass_full.empty()) return false;
  std::vector<SubtitlePacket> packets;
  size_t offset = 0;
  int read_order = 0;
  while (offset < ass_full.size()) {
    const size_t newline = ass_full.find('\n', offset);
    const size_t end =
        newline == std::string::npos ? ass_full.size() : newline;
    std::string line = ass_full.substr(offset, end - offset);
    if (!line.empty() && line.back() == '\r') line.pop_back();
    offset = newline == std::string::npos ? ass_full.size() : newline + 1;
    if (line.empty()) continue;
    constexpr char prefix[] = "Dialogue:";
    if (!line.starts_with(prefix)) return false;
    size_t field_start = sizeof(prefix) - 1;
    while (field_start < line.size() && line[field_start] == ' ')
      ++field_start;
    std::vector<std::string> fields;
    fields.reserve(10);
    for (int field = 0; field < 9; ++field) {
      const size_t comma = line.find(',', field_start);
      if (comma == std::string::npos) return false;
      fields.push_back(line.substr(field_start, comma - field_start));
      field_start = comma + 1;
    }
    fields.push_back(line.substr(field_start));
    int64_t start_ms = 0;
    int64_t end_ms = 0;
    if (!ass_timestamp_ms(fields[1], start_ms) ||
        !ass_timestamp_ms(fields[2], end_ms) || end_ms <= start_ms ||
        ++read_order > kMaxObservedEvents)
      return false;
    SubtitlePacket packet;
    packet.start_ms = start_ms;
    packet.duration_ms = end_ms - start_ms;
    packet.data =
        std::to_string(read_order) + "," + fields[0] + "," + fields[3] +
        "," + fields[4] + "," + fields[5] + "," + fields[6] + "," +
        fields[7] + "," + fields[8] + "," + fields[9];
    packets.push_back(std::move(packet));
  }
  if (packets.empty()) return false;
  media.codec_private.assign(ass_extradata.begin(), ass_extradata.end());
  media.packets = std::move(packets);
  return true;
}

struct MetadataDeadline {
  std::chrono::steady_clock::time_point value;
};

int interrupt_after_deadline(void* opaque) {
  const auto* deadline = static_cast<const MetadataDeadline*>(opaque);
  return deadline && std::chrono::steady_clock::now() >= deadline->value;
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

std::string attachment_name(const AVStream* stream, int index) {
  const AVDictionaryEntry* filename =
      av_dict_get(stream->metadata, "filename", nullptr, 0);
  std::string result =
      filename && filename->value ? filename->value : "attachment-" +
          std::to_string(index);
  const size_t slash = result.find_last_of("/\\");
  if (slash != std::string::npos) result = result.substr(slash + 1);
  if (result.empty()) result = "attachment-" + std::to_string(index);
  if (result.size() > 255) result.resize(255);
  return result;
}

bool ass_stream_header_ready(
    const AVFormatContext* format, int stream_index) {
  if (!format || stream_index < 0 ||
      stream_index >= static_cast<int>(format->nb_streams))
    return false;
  const AVStream* stream = format->streams[stream_index];
  return stream && stream->codecpar &&
      stream->codecpar->codec_type == AVMEDIA_TYPE_SUBTITLE &&
      (stream->codecpar->codec_id == AV_CODEC_ID_ASS ||
       stream->codecpar->codec_id == AV_CODEC_ID_SSA) &&
      stream->codecpar->extradata_size > 0;
}

std::string_view ass_packet_text(const std::string& packet) {
  size_t offset = 0;
  for (int field = 0; field < 8; ++field) {
    offset = packet.find(',', offset);
    if (offset == std::string::npos) return {};
    ++offset;
  }
  return std::string_view(packet).substr(offset);
}
#endif

}  // namespace

DemuxResult demux_ass_source(
    const protocol::GeometrySourceRequest& source,
    int64_t cue_start_ms, int64_t cue_end_ms,
    const std::string& observed_ass_text,
    const std::string& ass_extradata, const std::string& ass_full) {
#ifndef IINATAN_ASS_GEOMETRY
  (void)source;
  (void)cue_start_ms;
  (void)cue_end_ms;
  (void)observed_ass_text;
  (void)ass_extradata;
  (void)ass_full;
  return failure("ass-geometry-unavailable", "native dependency stack absent");
#else
  av_log_set_level(AV_LOG_QUIET);
  const bool network = network_source(source.path);
  const bool observed_ass =
      can_apply_ass_observation(source, ass_extradata, ass_full);
  const bool observed_network_ass = observed_ass && network;
  if (source.path.empty() ||
      (source.path[0] != '/' && !network && !observed_ass) ||
      (network && !safe_network_source(source.path)) ||
      (source.auto_ass_stream &&
       (network || source.ff_index != -1 || !source.cache_excerpt)) ||
      source.path.find('\0') != std::string::npos)
    return failure("unsafe-media-path");

  if (observed_ass && !network) {
    DemuxedAss media;
    media.canonical_path = source.path;
    media.observation_only_source = true;
    media.stream_index = source.ff_index;
    if (!observed_ass_packets(media, ass_extradata, ass_full))
      return failure("invalid-ass-observation");
    DemuxResult result;
    result.ok = true;
    result.media = std::move(media);
    return result;
  }

  FileHandle file;
  struct stat status {};
  AvioOwner avio;
  FormatOwner format;
  format.context = avformat_alloc_context();
  if (!format.context) return failure("out-of-memory");
  format.context->probesize = 8 * 1024 * 1024;
  format.context->max_analyze_duration = 5 * AV_TIME_BASE;
  MetadataDeadline metadata_deadline{
      std::chrono::steady_clock::now() + std::chrono::milliseconds(500)};
  if (observed_network_ass) {
    format.context->interrupt_callback.callback = interrupt_after_deadline;
    format.context->interrupt_callback.opaque = &metadata_deadline;
  }
  std::string canonical = source.path;
  int code = 0;
  if (network) {
    AVDictionary* options = nullptr;
    av_dict_set(
        &options, "protocol_whitelist", "http,https,tcp,tls", 0);
    av_dict_set(&options, "rw_timeout", "15000000", 0);
    code = avformat_open_input(
        &format.context, source.path.c_str(), nullptr, &options);
    av_dict_free(&options);
  } else {
    char resolved[PATH_MAX] = {};
    if (!realpath(source.path.c_str(), resolved))
      return failure("media-open-failed", std::strerror(errno));
    canonical = resolved;
    file.fd = open(canonical.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
    if (file.fd < 0)
      return failure("media-open-failed", std::strerror(errno));
    if (fstat(file.fd, &status) != 0)
      return failure("media-stat-failed", std::strerror(errno));
    if (!S_ISREG(status.st_mode))
      return failure("unsafe-media-path", "source is not a regular file");
    uint8_t* avio_buffer = static_cast<uint8_t*>(av_malloc(64 * 1024));
    if (!avio_buffer) return failure("out-of-memory");
    avio.context = avio_alloc_context(
        avio_buffer, 64 * 1024, 0, &file.fd, read_packet, nullptr, seek_file);
    if (!avio.context) {
      av_free(avio_buffer);
      return failure("out-of-memory");
    }
    avio.context->seekable = AVIO_SEEKABLE_NORMAL;
    format.context->pb = avio.context;
    format.context->flags |= AVFMT_FLAG_CUSTOM_IO;
    format.context->probesize =
        std::min<int64_t>(8 * 1024 * 1024, status.st_size);
    format.custom_io = true;
    code = avformat_open_input(&format.context, nullptr, nullptr, nullptr);
  }
  if (code < 0 && !observed_network_ass)
    return failure("unsupported-container", av_error(code));

  DemuxedAss media;
  media.canonical_path = canonical;
  media.network_source = network;
  media.device = static_cast<uint64_t>(status.st_dev);
  media.inode = static_cast<uint64_t>(status.st_ino);
  media.size = static_cast<uint64_t>(status.st_size);
#if defined(__APPLE__)
  media.modified_ns =
      static_cast<int64_t>(status.st_mtimespec.tv_sec) * 1'000'000'000 +
      status.st_mtimespec.tv_nsec;
#else
  media.modified_ns =
      static_cast<int64_t>(status.st_mtim.tv_sec) * 1'000'000'000 +
      status.st_mtim.tv_nsec;
#endif
  media.stream_index = source.ff_index;
  if (observed_network_ass &&
      !observed_ass_packets(media, ass_extradata, ass_full))
    return failure("invalid-ass-observation");
  if (code < 0) {
    DemuxResult result;
    result.ok = true;
    result.media = std::move(media);
    return result;
  }
  if (!observed_network_ass &&
      (!network ||
       !ass_stream_header_ready(format.context, source.ff_index))) {
    code = avformat_find_stream_info(format.context, nullptr);
    if (code < 0) return failure("stream-info-failed", av_error(code));
  }
  if (format.context->nb_streams > kMaxStreams)
    return failure("stream-limit-exceeded");
  int subtitle_index = source.ff_index;
  if (!observed_network_ass && source.auto_ass_stream) {
    subtitle_index = -1;
    for (unsigned index = 0; index < format.context->nb_streams; ++index) {
      const AVStream* candidate = format.context->streams[index];
      if (!candidate || !candidate->codecpar ||
          candidate->codecpar->codec_type != AVMEDIA_TYPE_SUBTITLE ||
          (candidate->codecpar->codec_id != AV_CODEC_ID_ASS &&
           candidate->codecpar->codec_id != AV_CODEC_ID_SSA))
        continue;
      if (subtitle_index >= 0)
        return failure("ambiguous-stream-map");
      subtitle_index = static_cast<int>(index);
    }
  }
  if (!observed_network_ass &&
      (subtitle_index < 0 ||
       subtitle_index >= static_cast<int>(format.context->nb_streams)))
    return failure("ambiguous-stream-map");

  const AVStream* subtitle =
      subtitle_index >= 0 &&
          subtitle_index < static_cast<int>(format.context->nb_streams)
      ? format.context->streams[subtitle_index]
      : nullptr;
  if (!observed_network_ass &&
      (!subtitle || !subtitle->codecpar ||
       subtitle->codecpar->codec_type != AVMEDIA_TYPE_SUBTITLE ||
       (subtitle->codecpar->codec_id != AV_CODEC_ID_ASS &&
        subtitle->codecpar->codec_id != AV_CODEC_ID_SSA)))
    return failure("unsupported-codec");
  if (!observed_network_ass &&
      (subtitle->codecpar->extradata_size <= 0 ||
       static_cast<size_t>(subtitle->codecpar->extradata_size) >
           kMaxCodecPrivate))
    return failure("invalid-codec-private");

  if (!observed_network_ass)
    media.codec_private.assign(
        subtitle->codecpar->extradata,
        subtitle->codecpar->extradata + subtitle->codecpar->extradata_size);
  media.stream_index = subtitle_index;

  size_t attachment_total = 0;
  for (unsigned index = 0; index < format.context->nb_streams; ++index) {
    const AVStream* stream = format.context->streams[index];
    if (!stream || !stream->codecpar ||
        stream->codecpar->codec_type != AVMEDIA_TYPE_ATTACHMENT)
      continue;
    const size_t size =
        stream->codecpar->extradata_size > 0
            ? static_cast<size_t>(stream->codecpar->extradata_size)
            : 0;
    if (!size) continue;
    if (size > kMaxAttachmentBytes ||
        attachment_total > kMaxAttachmentTotal - size) {
      if (observed_network_ass) {
        media.fonts.clear();
        break;
      }
      return failure("attachment-limit-exceeded");
    }
    FontAttachment font;
    font.name = attachment_name(stream, static_cast<int>(index));
    font.data.assign(
        stream->codecpar->extradata, stream->codecpar->extradata + size);
    attachment_total += size;
    media.fonts.push_back(std::move(font));
  }
  if (observed_network_ass) {
    DemuxResult result;
    result.ok = true;
    result.media = std::move(media);
    return result;
  }

  const int64_t preroll_ms = ass_demux_preroll_ms(source);
  const int64_t postroll_ms = ass_demux_postroll_ms(source);
  if (!source.cache_excerpt) {
    const int64_t seek_target =
        av_rescale_q(
            std::max<int64_t>(0, cue_start_ms - preroll_ms),
            AVRational{1, 1000}, subtitle->time_base);
    avformat_seek_file(
        format.context, subtitle_index, std::numeric_limits<int64_t>::min(),
        seek_target, seek_target, AVSEEK_FLAG_BACKWARD);
  }

  AVPacket* packet = av_packet_alloc();
  if (!packet) return failure("out-of-memory");
  int packet_count = 0;
  int selected_packet_count = 0;
  size_t selected_packet_bytes = 0;
  bool cue_packet_found = false;
  while ((code = av_read_frame(format.context, packet)) >= 0) {
    if (++packet_count > kMaxPackets) {
      av_packet_free(&packet);
      return failure("packet-limit-exceeded");
    }
    if (network && cue_packet_found && packet->stream_index >= 0 &&
        packet->stream_index <
            static_cast<int>(format.context->nb_streams)) {
      const AVStream* packet_stream =
          format.context->streams[packet->stream_index];
      const int64_t timestamp =
          packet->dts != AV_NOPTS_VALUE ? packet->dts : packet->pts;
      if (packet_stream && timestamp != AV_NOPTS_VALUE &&
          av_rescale_q(
              timestamp, packet_stream->time_base,
              AVRational{1, 1000}) >
              cue_end_ms + postroll_ms) {
        av_packet_unref(packet);
        break;
      }
    }
    if (packet->stream_index == subtitle_index) {
      const int64_t start =
          packet->pts == AV_NOPTS_VALUE
              ? -1
              : av_rescale_q(
                    packet->pts, subtitle->time_base, AVRational{1, 1000});
      const int64_t duration =
          packet->duration > 0
              ? av_rescale_q(
                    packet->duration, subtitle->time_base,
                    AVRational{1, 1000})
              : 0;
      if (!source.cache_excerpt && start > cue_end_ms + postroll_ms) {
        av_packet_unref(packet);
        break;
      }
      if (start >= 0 &&
          (source.cache_excerpt ||
           start + std::max<int64_t>(duration, 1) >=
               cue_start_ms - preroll_ms)) {
        if (packet->size <= 0 ||
            static_cast<size_t>(packet->size) > kMaxPacketBytes) {
          av_packet_free(&packet);
          return failure("subtitle-packet-limit-exceeded");
        }
        const size_t packet_size = static_cast<size_t>(packet->size);
        if (++selected_packet_count > kMaxSelectedSubtitlePackets ||
            selected_packet_bytes > kMaxSubtitlePacketTotal - packet_size) {
          av_packet_free(&packet);
          return failure("subtitle-packet-limit-exceeded");
        }
        selected_packet_bytes += packet_size;
        SubtitlePacket item;
        item.start_ms = start;
        item.duration_ms = duration;
        item.data.assign(
            reinterpret_cast<const char*>(packet->data),
            packet_size);
        media.packets.push_back(std::move(item));
        if (start <= cue_end_ms + 150 &&
            start + std::max<int64_t>(duration, 1) >= cue_start_ms - 150)
          cue_packet_found = true;
      }
    }
    av_packet_unref(packet);
  }
  av_packet_free(&packet);
  if (code < 0 && code != AVERROR_EOF)
    return failure("media-read-failed", av_error(code));
  if (media.packets.empty()) return failure("cue-not-found");
  if (source.cache_excerpt) {
    const auto matching = std::find_if(
        media.packets.begin(), media.packets.end(),
        [&observed_ass_text](const SubtitlePacket& packet) {
          return !observed_ass_text.empty() &&
              ass_packet_text(packet.data) == observed_ass_text;
        });
    const SubtitlePacket& reference =
        matching == media.packets.end() ? media.packets.front() : *matching;
    const bool timestamps_preserved =
        reference.start_ms <= cue_end_ms &&
        reference.start_ms +
                std::max<int64_t>(reference.duration_ms, 1) >=
            cue_start_ms;
    if (!timestamps_preserved) {
      const int64_t offset_ms = cue_start_ms - reference.start_ms;
      for (SubtitlePacket& packet : media.packets)
        packet.start_ms += offset_ms;
    }
  }
  media.packets_read = packet_count;

  DemuxResult result;
  result.ok = true;
  result.media = std::move(media);
  return result;
#endif
}

bool apply_ass_observation(
    DemuxedAss& media, const std::string& ass_extradata,
    const std::string& ass_full) {
#ifndef IINATAN_ASS_GEOMETRY
  (void)media;
  (void)ass_extradata;
  (void)ass_full;
  return false;
#else
  return observed_ass_packets(media, ass_extradata, ass_full);
#endif
}

bool can_apply_ass_observation(
    const protocol::GeometrySourceRequest& source,
    const std::string& ass_extradata, const std::string& ass_full) {
  return !source.path.empty() && source.path[0] != '/' &&
      !ass_extradata.empty() && !ass_full.empty();
}

int64_t ass_demux_preroll_ms(
    const protocol::GeometrySourceRequest& source) {
  return network_source(source.path) ? 250 : 30'000;
}

int64_t ass_demux_postroll_ms(
    const protocol::GeometrySourceRequest& source) {
  return network_source(source.path) ? 250 : 30'000;
}

bool demuxed_source_unchanged(
    const DemuxedAss& media,
    const protocol::GeometrySourceRequest& source) {
#ifndef IINATAN_ASS_GEOMETRY
  (void)media;
  (void)source;
  return false;
#else
  if (source.path.empty() || source.ff_index != media.stream_index)
    return false;
  if (media.observation_only_source)
    return media.canonical_path == source.path;
  if (network_source(source.path))
    return media.network_source && media.canonical_path == source.path;
  if (source.path[0] != '/' || media.network_source) return false;
  char resolved[PATH_MAX] = {};
  if (!realpath(source.path.c_str(), resolved) ||
      media.canonical_path != resolved)
    return false;
  struct stat status {};
  if (stat(resolved, &status) != 0 || !S_ISREG(status.st_mode))
    return false;
#if defined(__APPLE__)
  const int64_t modified_ns =
      static_cast<int64_t>(status.st_mtimespec.tv_sec) * 1'000'000'000 +
      status.st_mtimespec.tv_nsec;
#else
  const int64_t modified_ns =
      static_cast<int64_t>(status.st_mtim.tv_sec) * 1'000'000'000 +
      status.st_mtim.tv_nsec;
#endif
  return media.device == static_cast<uint64_t>(status.st_dev) &&
      media.inode == static_cast<uint64_t>(status.st_ino) &&
      media.size == static_cast<uint64_t>(status.st_size) &&
      media.modified_ns == modified_ns;
#endif
}

const char* ffmpeg_geometry_version() {
#ifdef IINATAN_ASS_GEOMETRY
  return av_version_info();
#else
  return "unavailable";
#endif
}

}  // namespace iinatan::ass
