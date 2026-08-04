#pragma once

#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace iinatan::bitmap {

struct SourceRequest {
  std::string path;
  int ff_index = -1;
  bool auto_stream = false;
  bool cache_excerpt = false;
};

struct Frame {
  int width = 0;
  int height = 0;
  int canvas_width = 0;
  int canvas_height = 0;
  int origin_x = 0;
  int origin_y = 0;
  int64_t start_ms = -1;
  int64_t end_ms = -1;
  std::vector<uint8_t> rgba;
};

struct DecodeMetrics {
  int64_t open_ms = 0;
  int64_t probe_ms = 0;
  int64_t seek_ms = 0;
  int64_t demux_ms = 0;
  int64_t compose_ms = 0;
  int packets = 0;
  int64_t packet_bytes = 0;
  bool session_reused = false;
  bool cache_hit = false;
  bool cancelled = false;
  std::string strategy;
};

struct DecodeResult {
  bool ok = false;
  std::string reason;
  std::string detail;
  std::string codec;
  int stream_index = -1;
  Frame frame;
  DecodeMetrics metrics;
};

DecodeResult decode_subtitle_at(
    const SourceRequest& source, int64_t time_ms, int64_t cue_start_ms,
    int64_t cue_end_ms,
    const std::function<bool()>& cancelled = {});
std::vector<std::string> available_decoders();

}  // namespace iinatan::bitmap
