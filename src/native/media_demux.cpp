#include "media_demux.hpp"

#include <algorithm>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <limits.h>
#include <memory>
#include <sys/stat.h>
#include <unistd.h>

#ifdef IINATAN_ASS_GEOMETRY
extern "C" {
#include <libavcodec/codec_id.h>
#include <libavformat/avformat.h>
#include <libavutil/avutil.h>
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
  ~FormatOwner() {
    if (!context) return;
    // Custom AVIO is owned separately.
    context->pb = nullptr;
    avformat_close_input(&context);
  }
};

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
#endif

}  // namespace

DemuxResult demux_ass_source(
    const protocol::GeometrySourceRequest& source,
    int64_t cue_start_ms, int64_t cue_end_ms) {
#ifndef IINATAN_ASS_GEOMETRY
  (void)source;
  (void)cue_start_ms;
  (void)cue_end_ms;
  return failure("ass-geometry-unavailable", "native dependency stack absent");
#else
  if (source.path.empty() || source.path[0] != '/' ||
      source.path.find('\0') != std::string::npos)
    return failure("unsafe-media-path");

  char resolved[PATH_MAX] = {};
  if (!realpath(source.path.c_str(), resolved))
    return failure("media-open-failed", std::strerror(errno));
  const std::string canonical(resolved);

  FileHandle file;
  file.fd = open(canonical.c_str(), O_RDONLY | O_CLOEXEC | O_NOFOLLOW);
  if (file.fd < 0)
    return failure("media-open-failed", std::strerror(errno));
  struct stat status {};
  if (fstat(file.fd, &status) != 0)
    return failure("media-stat-failed", std::strerror(errno));
  if (!S_ISREG(status.st_mode))
    return failure("unsafe-media-path", "source is not a regular file");

  uint8_t* avio_buffer = static_cast<uint8_t*>(av_malloc(64 * 1024));
  if (!avio_buffer) return failure("out-of-memory");
  AvioOwner avio;
  avio.context = avio_alloc_context(
      avio_buffer, 64 * 1024, 0, &file.fd, read_packet, nullptr, seek_file);
  if (!avio.context) {
    av_free(avio_buffer);
    return failure("out-of-memory");
  }
  avio.context->seekable = AVIO_SEEKABLE_NORMAL;

  FormatOwner format;
  format.context = avformat_alloc_context();
  if (!format.context) return failure("out-of-memory");
  format.context->pb = avio.context;
  format.context->flags |= AVFMT_FLAG_CUSTOM_IO;
  format.context->probesize = std::min<int64_t>(8 * 1024 * 1024, status.st_size);
  format.context->max_analyze_duration = 5 * AV_TIME_BASE;

  int code = avformat_open_input(&format.context, nullptr, nullptr, nullptr);
  if (code < 0) return failure("unsupported-container", av_error(code));
  code = avformat_find_stream_info(format.context, nullptr);
  if (code < 0) return failure("stream-info-failed", av_error(code));
  if (format.context->nb_streams > kMaxStreams)
    return failure("stream-limit-exceeded");
  if (source.ff_index < 0 ||
      source.ff_index >= static_cast<int>(format.context->nb_streams))
    return failure("ambiguous-stream-map");

  const AVStream* subtitle = format.context->streams[source.ff_index];
  if (!subtitle || !subtitle->codecpar ||
      subtitle->codecpar->codec_type != AVMEDIA_TYPE_SUBTITLE ||
      (subtitle->codecpar->codec_id != AV_CODEC_ID_ASS &&
       subtitle->codecpar->codec_id != AV_CODEC_ID_SSA))
    return failure("unsupported-codec");
  if (subtitle->codecpar->extradata_size <= 0 ||
      static_cast<size_t>(subtitle->codecpar->extradata_size) >
          kMaxCodecPrivate)
    return failure("invalid-codec-private");

  DemuxedAss media;
  media.canonical_path = canonical;
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
  media.codec_private.assign(
      subtitle->codecpar->extradata,
      subtitle->codecpar->extradata + subtitle->codecpar->extradata_size);

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
        attachment_total > kMaxAttachmentTotal - size)
      return failure("attachment-limit-exceeded");
    FontAttachment font;
    font.name = attachment_name(stream, static_cast<int>(index));
    font.data.assign(
        stream->codecpar->extradata, stream->codecpar->extradata + size);
    attachment_total += size;
    media.fonts.push_back(std::move(font));
  }

  const int64_t seek_target =
      av_rescale_q(
          std::max<int64_t>(0, cue_start_ms - 30'000),
          AVRational{1, 1000}, subtitle->time_base);
  avformat_seek_file(
      format.context, source.ff_index, std::numeric_limits<int64_t>::min(),
      seek_target, seek_target, AVSEEK_FLAG_BACKWARD);

  AVPacket* packet = av_packet_alloc();
  if (!packet) return failure("out-of-memory");
  int packet_count = 0;
  int selected_packet_count = 0;
  size_t selected_packet_bytes = 0;
  while ((code = av_read_frame(format.context, packet)) >= 0) {
    if (++packet_count > kMaxPackets) {
      av_packet_free(&packet);
      return failure("packet-limit-exceeded");
    }
    if (packet->stream_index == source.ff_index) {
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
      if (start > cue_end_ms + 30'000) {
        av_packet_unref(packet);
        break;
      }
      if (start >= 0 && start + std::max<int64_t>(duration, 1) >=
                            cue_start_ms - 30'000) {
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
      }
    }
    av_packet_unref(packet);
  }
  av_packet_free(&packet);
  if (code < 0 && code != AVERROR_EOF)
    return failure("media-read-failed", av_error(code));
  if (media.packets.empty()) return failure("cue-not-found");

  DemuxResult result;
  result.ok = true;
  result.media = std::move(media);
  return result;
#endif
}

bool demuxed_source_unchanged(
    const DemuxedAss& media,
    const protocol::GeometrySourceRequest& source) {
#ifndef IINATAN_ASS_GEOMETRY
  (void)media;
  (void)source;
  return false;
#else
  if (source.path.empty() || source.path[0] != '/' ||
      source.ff_index != media.stream_index)
    return false;
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
