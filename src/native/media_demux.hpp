#pragma once

#include <cstdint>
#include <string>
#include <vector>

#include "worker_protocol.hpp"

namespace iinatan::ass {

struct SubtitlePacket {
  int64_t start_ms = 0;
  int64_t duration_ms = 0;
  std::string data;
};

struct FontAttachment {
  std::string name;
  std::vector<uint8_t> data;
};

struct DemuxedAss {
  std::string canonical_path;
  uint64_t device = 0;
  uint64_t inode = 0;
  uint64_t size = 0;
  int64_t modified_ns = 0;
  int stream_index = -1;
  std::vector<uint8_t> codec_private;
  std::vector<FontAttachment> fonts;
  std::vector<SubtitlePacket> packets;
};

struct DemuxResult {
  bool ok = false;
  std::string reason;
  std::string detail;
  DemuxedAss media;
};

DemuxResult demux_ass_source(
    const protocol::GeometrySourceRequest& source,
    int64_t cue_start_ms, int64_t cue_end_ms);
const char* ffmpeg_geometry_version();

}  // namespace iinatan::ass
