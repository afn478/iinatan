#include "ass_geometry.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <memory>
#include <optional>
#include <sstream>
#include <utility>
#include <vector>

#ifdef IINATAN_ASS_GEOMETRY
extern "C" {
#include <ass/ass.h>
}
#endif

namespace iinatan::ass {
namespace {

using protocol::GeometryRequest;
using protocol::GeometryUnitRequest;
using protocol::Json;
using GeometryClock = std::chrono::steady_clock;

int64_t elapsed_us(
    GeometryClock::time_point start, GeometryClock::time_point end) {
  return std::chrono::duration_cast<std::chrono::microseconds>(end - start)
      .count();
}

struct UnitRect {
  int position = -1;
  int left = std::numeric_limits<int>::max();
  int top = std::numeric_limits<int>::max();
  int right = std::numeric_limits<int>::min();
  int bottom = std::numeric_limits<int>::min();
  bool seen = false;
};

Json fail(
    const GeometryRequest& request, const std::string& reason,
    const std::string& detail = "") {
  return protocol::geometry_error(request.request_id, reason, detail);
}

bool close_time(int64_t left, int64_t right, int64_t tolerance = 150) {
  return left >= right - tolerance && left <= right + tolerance;
}

bool split_ass_packet(
    const std::string& packet, int& read_order, std::string& prefix,
    std::string& effect, std::string& text) {
  size_t offset = 0;
  for (int field = 0; field < 8; ++field) {
    const size_t comma = packet.find(',', offset);
    if (comma == std::string::npos) return false;
    if (field == 0) {
      const char* begin = packet.data() + offset;
      const char* end = packet.data() + comma;
      const auto parsed = std::from_chars(begin, end, read_order);
      if (parsed.ec != std::errc() || parsed.ptr != end) return false;
    }
    if (field == 7) effect = packet.substr(offset, comma - offset);
    offset = comma + 1;
  }
  prefix = packet.substr(0, offset);
  text = packet.substr(offset);
  return true;
}

bool simple_dialogue_text(const std::string& text) {
  if (text.empty() || text.size() > 64 * 1024) return false;
  if (text.find_first_of("{}\r\n") != std::string::npos) return false;
  for (size_t i = 0; i < text.size(); ++i) {
    if (text[i] != '\\') continue;
    if (i + 1 >= text.size() || (text[i + 1] != 'N' && text[i + 1] != 'n'))
      return false;
    ++i;
  }
  return true;
}

bool decode_utf8(
    const std::string& source, size_t offset, uint32_t& codepoint,
    size_t& length) {
  if (offset >= source.size()) return false;
  const unsigned char first = static_cast<unsigned char>(source[offset]);
  if (first < 0x80) {
    codepoint = first;
    length = 1;
    return true;
  }
  int continuation = 0;
  uint32_t value = 0;
  if ((first & 0xe0) == 0xc0) {
    continuation = 1;
    value = first & 0x1f;
  } else if ((first & 0xf0) == 0xe0) {
    continuation = 2;
    value = first & 0x0f;
  } else if ((first & 0xf8) == 0xf0) {
    continuation = 3;
    value = first & 0x07;
  } else {
    return false;
  }
  if (offset + static_cast<size_t>(continuation) >= source.size())
    return false;
  for (int i = 1; i <= continuation; ++i) {
    const unsigned char next =
        static_cast<unsigned char>(source[offset + static_cast<size_t>(i)]);
    if ((next & 0xc0) != 0x80) return false;
    value = (value << 6) | (next & 0x3f);
  }
  if ((continuation == 1 && value < 0x80) ||
      (continuation == 2 && value < 0x800) ||
      (continuation == 3 && value < 0x10000) || value > 0x10ffff ||
      (value >= 0xd800 && value <= 0xdfff))
    return false;
  codepoint = value;
  length = static_cast<size_t>(continuation + 1);
  return true;
}

struct TextIndex {
  std::vector<int> logical_boundary;
};

struct ActiveEvent {
  const SubtitlePacket* packet = nullptr;
  int read_order = -1;
  std::string prefix;
  std::string effect;
  std::string text;
  std::string plain_text;
  TextIndex index;
  int display_start = 0;
  int display_end = 0;
};

std::string dialogue_plain_text(const std::string& text) {
  std::string plain;
  plain.reserve(text.size());
  for (size_t index = 0; index < text.size(); ++index) {
    if (text[index] == '\\' && index + 1 < text.size() &&
        (text[index + 1] == 'N' || text[index + 1] == 'n')) {
      plain.push_back('\n');
      ++index;
    } else {
      plain.push_back(text[index]);
    }
  }
  return plain;
}

void find_plain_event_orders(
    const std::string& observed, std::vector<ActiveEvent>& events,
    size_t offset, std::vector<bool>& used, std::vector<ActiveEvent*>& current,
    std::vector<ActiveEvent*>& unique, int& matches, int& steps,
    bool& exhausted) {
  if (matches > 1 || exhausted) return;
  if (++steps > 4096) {
    exhausted = true;
    return;
  }
  if (current.size() == events.size()) {
    if (offset == observed.size()) {
      ++matches;
      if (matches == 1) unique = current;
    }
    return;
  }
  for (size_t index = 0; index < events.size(); ++index) {
    if (used[index]) continue;
    ActiveEvent& event = events[index];
    if (observed.compare(offset, event.plain_text.size(), event.plain_text) != 0)
      continue;
    const size_t next = offset + event.plain_text.size();
    const bool last = current.size() + 1 == events.size();
    if ((!last && (next >= observed.size() || observed[next] != '\n')) ||
        (last && next != observed.size()))
      continue;
    used[index] = true;
    current.push_back(&event);
    find_plain_event_orders(
        observed, events, last ? next : next + 1, used, current, unique,
        matches, steps, exhausted);
    current.pop_back();
    used[index] = false;
  }
}

bool build_text_index(const std::string& raw, TextIndex& result) {
  result.logical_boundary.clear();
  result.logical_boundary.push_back(0);
  size_t offset = 0;
  int logical = 0;
  while (offset < raw.size()) {
    if (raw[offset] == '\\' && offset + 1 < raw.size() &&
        (raw[offset + 1] == 'N' || raw[offset + 1] == 'n')) {
      offset += 2;
      result.logical_boundary.push_back(++logical);
      continue;
    }
    uint32_t codepoint = 0;
    size_t length = 0;
    if (!decode_utf8(raw, offset, codepoint, length)) return false;
    offset += length;
    if (codepoint > 0xffff) {
      result.logical_boundary.push_back(-1);
    }
    result.logical_boundary.push_back(++logical);
  }
  return true;
}

bool build_lookup_units(
    std::vector<ActiveEvent*>& events,
    const std::vector<GeometryUnitRequest>& units,
    std::vector<ASS_IinatanLookupUnit>& result) {
  int display_offset = 0;
  for (size_t event_index = 0; event_index < events.size(); ++event_index) {
    ActiveEvent& event = *events[event_index];
    if (!build_text_index(event.text, event.index)) return false;
    event.display_start = display_offset;
    const size_t logical_length = event.index.logical_boundary.size() - 1;
    if (logical_length >
        static_cast<size_t>(
            std::numeric_limits<int>::max() - display_offset))
      return false;
    event.display_end = display_offset + static_cast<int>(logical_length);
    display_offset = event.display_end;
    if (event_index + 1 < events.size()) {
      if (display_offset == std::numeric_limits<int>::max()) return false;
      ++display_offset;
    }
  }

  result.clear();
  result.reserve(units.size());
  for (size_t unit_index = 0; unit_index < units.size(); ++unit_index) {
    const GeometryUnitRequest& unit = units[unit_index];
    if (unit.display_start_utf16 < 0 ||
        unit.display_end_utf16 <= unit.display_start_utf16)
      return false;

    ActiveEvent* owner = nullptr;
    for (ActiveEvent* event : events) {
      if (unit.display_start_utf16 >= event->display_start &&
          unit.display_end_utf16 <= event->display_end) {
        if (owner) return false;
        owner = event;
      }
    }
    if (!owner) return false;

    const size_t local_start = static_cast<size_t>(
        unit.display_start_utf16 - owner->display_start);
    const size_t local_end =
        static_cast<size_t>(unit.display_end_utf16 - owner->display_start);
    if (local_end >= owner->index.logical_boundary.size()) return false;
    const int start = owner->index.logical_boundary[local_start];
    const int end = owner->index.logical_boundary[local_end];
    if (start < 0 || end <= start) return false;
    result.push_back(ASS_IinatanLookupUnit{
        owner->read_order, start, end, static_cast<int>(unit_index)});
  }
  return true;
}

std::vector<std::string> split_observed_events(const std::string& observed) {
  std::vector<std::string> events;
  size_t offset = 0;
  while (true) {
    const size_t newline = observed.find('\n', offset);
    if (newline == std::string::npos) {
      events.push_back(observed.substr(offset));
      break;
    }
    events.push_back(observed.substr(offset, newline - offset));
    offset = newline + 1;
  }
  return events;
}

#ifdef IINATAN_ASS_GEOMETRY
struct TrackOwner {
  ASS_Track* value = nullptr;
  ~TrackOwner() {
    if (value) ass_free_track(value);
  }
};

void ignore_ass_message(int, const char*, va_list, void*) {}

void configure_renderer(
    ASS_Renderer* renderer, const protocol::GeometryRendererRequest& options) {
  ass_set_frame_size(renderer, options.width, options.height);
  if (options.use_storage_size)
    ass_set_storage_size(
        renderer, options.storage_width, options.storage_height);
  else
    ass_set_storage_size(renderer, 0, 0);
  ass_set_margins(
      renderer, options.margin_top, options.margin_bottom,
      options.margin_left, options.margin_right);
  ass_set_use_margins(renderer, options.force_margins ? 1 : 0);
  ass_set_pixel_aspect(renderer, options.pixel_aspect);
  ass_set_font_scale(renderer, options.font_scale);
  ass_set_line_spacing(renderer, options.line_spacing);
  ass_set_line_position(renderer, options.line_position);
  ass_set_shaper(
      renderer, options.shaper == "simple" ? ASS_SHAPING_SIMPLE
                                            : ASS_SHAPING_COMPLEX);
  ASS_Hinting hinting = ASS_HINTING_NONE;
  if (options.hinting == "light") hinting = ASS_HINTING_LIGHT;
  else if (options.hinting == "normal") hinting = ASS_HINTING_NORMAL;
  else if (options.hinting == "native") hinting = ASS_HINTING_NATIVE;
  ass_set_hinting(renderer, hinting);
  ass_set_selective_style_override_enabled(
      renderer,
      options.override_mode == "scale"
          ? ASS_OVERRIDE_BIT_SELECTIVE_FONT_SCALE
          : 0);
  ass_set_fonts(
      renderer, nullptr, options.default_family.c_str(),
      ASS_FONTPROVIDER_AUTODETECT, nullptr, 1);
}

bool populate_track(
    ASS_Library* library, const DemuxedAss& media,
    const std::vector<ActiveEvent>& events, TrackOwner& track) {
  track.value = ass_new_track(library);
  if (!track.value) return false;
  ass_process_codec_private(
      track.value,
      reinterpret_cast<char*>(
          const_cast<uint8_t*>(media.codec_private.data())),
      static_cast<int>(media.codec_private.size()));
  for (const ActiveEvent& event : events) {
    const SubtitlePacket& packet = *event.packet;
    ass_process_chunk(
        track.value, const_cast<char*>(packet.data.data()),
        static_cast<int>(packet.data.size()), packet.start_ms,
        packet.duration_ms);
  }
  return track.value->n_events == static_cast<int>(events.size());
}

int image_plane(const ASS_Image* image) {
  switch (image->type) {
    case ASS_Image::IMAGE_TYPE_CHARACTER: return 0;
    case ASS_Image::IMAGE_TYPE_OUTLINE: return 1;
    case ASS_Image::IMAGE_TYPE_SHADOW: return 2;
    default: return -1;
  }
}

using AlphaPlanes = std::array<std::vector<uint8_t>, 3>;

bool compose_alpha(
    ASS_Image* images, int width, int height, AlphaPlanes& planes) {
  const size_t pixels = static_cast<size_t>(width) * height;
  for (auto& plane : planes) plane.assign(pixels, 0);
  for (const ASS_Image* image = images; image; image = image->next) {
    const int plane_index = image_plane(image);
    if (plane_index < 0 || !image->bitmap || image->stride < image->w ||
        image->w < 0 || image->h < 0)
      return false;
    const unsigned color_alpha = image->color & 0xff;
    for (int row = 0; row < image->h; ++row) {
      const int64_t y = static_cast<int64_t>(image->dst_y) + row;
      if (y < 0 || y >= height) continue;
      for (int column = 0; column < image->w; ++column) {
        const int64_t x = static_cast<int64_t>(image->dst_x) + column;
        if (x < 0 || x >= width) continue;
        const unsigned bitmap =
            image->bitmap[static_cast<size_t>(row) * image->stride + column];
        const unsigned source_alpha =
            (bitmap * (255 - color_alpha) + 127) / 255;
        uint8_t& destination =
            planes[plane_index][static_cast<size_t>(y) * width +
                                static_cast<size_t>(x)];
        destination = static_cast<uint8_t>(
            source_alpha +
            (static_cast<unsigned>(destination) * (255 - source_alpha) + 127) /
                255);
      }
    }
  }
  return true;
}

std::string base64_encode(const std::vector<uint8_t>& source) {
  static constexpr char alphabet[] =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string output;
  output.reserve(((source.size() + 2) / 3) * 4);
  for (size_t offset = 0; offset < source.size(); offset += 3) {
    const unsigned first = source[offset];
    const unsigned second =
        offset + 1 < source.size() ? source[offset + 1] : 0;
    const unsigned third =
        offset + 2 < source.size() ? source[offset + 2] : 0;
    const unsigned value = (first << 16) | (second << 8) | third;
    output.push_back(alphabet[(value >> 18) & 63]);
    output.push_back(alphabet[(value >> 12) & 63]);
    output.push_back(
        offset + 1 < source.size() ? alphabet[(value >> 6) & 63] : '=');
    output.push_back(offset + 2 < source.size() ? alphabet[value & 63] : '=');
  }
  return output;
}

std::optional<Json> encode_alpha_mask(
    const std::vector<uint8_t>& alpha, int plane_width, int plane_height,
    int origin_x = 0, int origin_y = 0) {
  int left = plane_width;
  int top = plane_height;
  int right = 0;
  int bottom = 0;
  for (int y = 0; y < plane_height; ++y) {
    for (int x = 0; x < plane_width; ++x) {
      if (!alpha[static_cast<size_t>(y) * plane_width + x]) continue;
      left = std::min(left, x);
      top = std::min(top, y);
      right = std::max(right, x + 1);
      bottom = std::max(bottom, y + 1);
    }
  }
  if (right <= left || bottom <= top) return std::nullopt;
  constexpr size_t kMaxMaskPixels = 262144;
  if (static_cast<size_t>(right - left) * (bottom - top) > kMaxMaskPixels)
    return std::nullopt;

  std::vector<uint8_t> rle;
  rle.reserve(static_cast<size_t>(right - left) * (bottom - top) / 2);
  uint8_t current =
      alpha[static_cast<size_t>(top) * plane_width + left];
  unsigned run = 0;
  const auto flush = [&] {
    rle.push_back(static_cast<uint8_t>(run));
    rle.push_back(current);
  };
  for (int y = top; y < bottom; ++y) {
    for (int x = left; x < right; ++x) {
      const uint8_t value =
          alpha[static_cast<size_t>(y) * plane_width + x];
      if (value == current && run < 255) {
        ++run;
      } else {
        flush();
        current = value;
        run = 1;
      }
    }
  }
  if (run) flush();
  if (rle.size() > 512 * 1024) return std::nullopt;
  return Json::Object{
      {"x", origin_x + left},
      {"y", origin_y + top},
      {"w", right - left},
      {"h", bottom - top},
      {"encoding", "rle-u8-base64"},
      {"data", base64_encode(rle)},
  };
}

struct CroppedAlpha {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  std::vector<uint8_t> pixels;
};

bool compose_character_alpha_crop(
    ASS_Image* images, int frame_width, int frame_height,
    CroppedAlpha& result) {
  int left = frame_width;
  int top = frame_height;
  int right = 0;
  int bottom = 0;
  for (const ASS_Image* image = images; image; image = image->next) {
    const int plane_index = image_plane(image);
    if (plane_index < 0 || !image->bitmap || image->stride < image->w ||
        image->w < 0 || image->h < 0)
      return false;
    if (plane_index != 0) continue;
    const int64_t image_right =
        static_cast<int64_t>(image->dst_x) + image->w;
    const int64_t image_bottom =
        static_cast<int64_t>(image->dst_y) + image->h;
    left = std::min(left, std::max(0, image->dst_x));
    top = std::min(top, std::max(0, image->dst_y));
    right = std::max(
        right,
        static_cast<int>(
            std::max<int64_t>(0, std::min<int64_t>(frame_width, image_right))));
    bottom = std::max(
        bottom,
        static_cast<int>(std::max<int64_t>(
            0, std::min<int64_t>(frame_height, image_bottom))));
  }
  if (right <= left || bottom <= top) return true;
  const int width = right - left;
  const int height = bottom - top;
  const size_t pixels = static_cast<size_t>(width) * height;
  if (pixels > 16'000'000) return false;
  result.x = left;
  result.y = top;
  result.width = width;
  result.height = height;
  result.pixels.assign(pixels, 0);
  for (const ASS_Image* image = images; image; image = image->next) {
    if (image_plane(image) != 0) continue;
    const unsigned color_alpha = image->color & 0xff;
    for (int row = 0; row < image->h; ++row) {
      const int64_t y = static_cast<int64_t>(image->dst_y) + row;
      if (y < top || y >= bottom) continue;
      for (int column = 0; column < image->w; ++column) {
        const int64_t x = static_cast<int64_t>(image->dst_x) + column;
        if (x < left || x >= right) continue;
        const unsigned bitmap =
            image->bitmap[static_cast<size_t>(row) * image->stride + column];
        const unsigned source_alpha =
            (bitmap * (255 - color_alpha) + 127) / 255;
        uint8_t& destination =
            result.pixels[static_cast<size_t>(y - top) * width +
                          static_cast<size_t>(x - left)];
        destination = static_cast<uint8_t>(
            source_alpha +
            (static_cast<unsigned>(destination) * (255 - source_alpha) + 127) /
                255);
      }
    }
  }
  return true;
}

#endif

}  // namespace

struct GeometryService::State {
#ifdef IINATAN_ASS_GEOMETRY
  // One worker-owned session deliberately retains only the active source
  // window and libass font/renderer caches. Cue tracks remain request-owned so
  // seeking or event replacement cannot leak mutable ASS events.
  DemuxedAss media;
  bool media_valid = false;
  std::string source_path;
  int source_ff_index = -1;
  bool source_external = false;
  int64_t window_start_ms = 0;
  int64_t window_end_ms = 0;
  ASS_Library* library = nullptr;
  ASS_Renderer* instrumented_renderer = nullptr;
  ASS_Renderer* original_renderer = nullptr;
  bool embedded_fonts = true;
  bool session_valid = false;
  uint64_t request_count = 0;
  uint64_t demux_hit_count = 0;
  uint64_t demux_miss_count = 0;
  uint64_t session_creation_count = 0;
  uint64_t session_destruction_count = 0;
  bool diagnostics_requested = false;

  ~State() { destroy_session(); }

  void destroy_session() {
    if (original_renderer) ass_renderer_done(original_renderer);
    if (instrumented_renderer) ass_renderer_done(instrumented_renderer);
    if (library) ass_library_done(library);
    original_renderer = nullptr;
    instrumented_renderer = nullptr;
    library = nullptr;
    if (session_valid) ++session_destruction_count;
    session_valid = false;
  }

  bool open_session(const protocol::GeometryRendererRequest& renderer) {
    destroy_session();
    ASS_Library* next_library = ass_library_init();
    if (!next_library) return false;
    ass_set_message_cb(next_library, ignore_ass_message, nullptr);
    ass_set_extract_fonts(next_library, renderer.embedded_fonts ? 1 : 0);
    if (renderer.embedded_fonts) {
      for (const FontAttachment& font : media.fonts)
        ass_add_font(
            next_library, const_cast<char*>(font.name.c_str()),
            reinterpret_cast<char*>(const_cast<uint8_t*>(font.data.data())),
            static_cast<int>(font.data.size()));
    }
    ASS_Renderer* next_renderer = ass_renderer_init(next_library);
    if (!next_renderer) {
      ass_library_done(next_library);
      return false;
    }
    library = next_library;
    instrumented_renderer = next_renderer;
    embedded_fonts = renderer.embedded_fonts;
    session_valid = true;
    ++session_creation_count;
    return true;
  }

  bool ensure_original_renderer() {
    if (original_renderer) return true;
    original_renderer = ass_renderer_init(library);
    return original_renderer != nullptr;
  }
#endif
};

GeometryService::GeometryService() : state_(std::make_unique<State>()) {}
GeometryService::~GeometryService() {
#ifdef IINATAN_ASS_GEOMETRY
  if (state_ && state_->request_count && state_->diagnostics_requested) {
    const uint64_t destroyed =
        state_->session_destruction_count + (state_->session_valid ? 1 : 0);
    std::cerr
        << "ass geometry lifecycle {\"requests\":" << state_->request_count
        << ",\"demuxHits\":" << state_->demux_hit_count
        << ",\"demuxMisses\":" << state_->demux_miss_count
        << ",\"sessionCreations\":" << state_->session_creation_count
        << ",\"sessionDestructions\":" << destroyed << "}\n";
  }
#endif
}

protocol::Json GeometryService::handle(const GeometryRequest& request) {
#ifndef IINATAN_ASS_GEOMETRY
  return fail(
      request, "ass-geometry-unavailable",
      "helper was built without the pinned FFmpeg/libass stack");
#else
  const GeometryClock::time_point total_started = GeometryClock::now();
  State& state = *state_;
  ++state.request_count;
  state.diagnostics_requested =
      state.diagnostics_requested || request.diagnostics;
  if (request.renderer.ass_justify)
    return fail(request, "unsupported-renderer-option", "sub-ass-justify");
  if (request.renderer.font_provider != "auto" &&
      request.renderer.font_provider != "autodetect")
    return fail(request, "unsupported-renderer-option", "sub-font-provider");
  const GeometryClock::time_point demux_started = GeometryClock::now();
  const int64_t needed_start_ms =
      std::max<int64_t>(0, request.cue.start_ms - 30'000);
  const int64_t needed_end_ms = request.cue.end_ms + 30'000;
  const bool same_source =
      state.media_valid && state.source_path == request.source.path &&
      state.source_ff_index == request.source.ff_index &&
      state.source_external == request.source.external &&
      demuxed_source_unchanged(state.media, request.source);
  const bool demux_hit =
      same_source && needed_start_ms >= state.window_start_ms &&
      needed_end_ms <= state.window_end_ms;
  if (demux_hit) {
    ++state.demux_hit_count;
  } else {
    ++state.demux_miss_count;
    DemuxResult demux =
        demux_ass_source(
            request.source, request.cue.start_ms, request.cue.end_ms);
    if (!demux.ok) return fail(request, demux.reason, demux.detail);
    if (!same_source) state.destroy_session();
    state.media = std::move(demux.media);
    state.media_valid = true;
    state.source_path = request.source.path;
    state.source_ff_index = request.source.ff_index;
    state.source_external = request.source.external;
    state.window_start_ms = needed_start_ms;
    state.window_end_ms = needed_end_ms;
  }
  const GeometryClock::time_point demux_finished = GeometryClock::now();
  DemuxedAss& media = state.media;

  std::vector<const SubtitlePacket*> active_packets;
  for (const SubtitlePacket& packet : media.packets) {
    const int64_t end =
        packet.start_ms + std::max<int64_t>(packet.duration_ms, 1);
    if (packet.start_ms <= request.cue.time_ms &&
        end > request.cue.time_ms)
      active_packets.push_back(&packet);
  }
  if (active_packets.empty()) return fail(request, "cue-not-found");

  std::vector<ActiveEvent> active_events;
  active_events.reserve(active_packets.size());
  for (const SubtitlePacket* packet : active_packets) {
    ActiveEvent event;
    event.packet = packet;
    if (!split_ass_packet(
            packet->data, event.read_order, event.prefix, event.effect,
            event.text))
      return fail(request, "ambiguous-ass-event");
    if (!simple_dialogue_text(event.text))
      return fail(request, "complex-ass-tags");
    if (event.effect.find_first_not_of(" \t") != std::string::npos)
      return fail(request, "complex-ass-tags", "animated-effect");
    for (const ActiveEvent& existing : active_events) {
      if (existing.read_order == event.read_order)
        return fail(request, "ambiguous-ass-event");
    }
    event.plain_text = dialogue_plain_text(event.text);
    active_events.push_back(std::move(event));
  }

  if (active_events.size() == 1) {
    const SubtitlePacket& packet = *active_events.front().packet;
    if (!close_time(packet.start_ms, request.cue.start_ms) ||
        (packet.duration_ms > 0 &&
         !close_time(
             packet.start_ms + packet.duration_ms, request.cue.end_ms, 250)))
      return fail(request, "cue-timing-mismatch");
  }

  std::vector<ActiveEvent*> ordered_events;
  ordered_events.reserve(active_events.size());
  if (request.cue.uses_observed_plain) {
    std::vector<bool> used(active_events.size(), false);
    std::vector<ActiveEvent*> current;
    int matches = 0;
    int steps = 0;
    bool exhausted = false;
    find_plain_event_orders(
        request.cue.observed_plain, active_events, 0, used, current,
        ordered_events, matches, steps, exhausted);
    if (exhausted) return fail(request, "ambiguous-ass-event");
    if (matches == 0) return fail(request, "cue-text-mismatch");
    if (matches > 1) return fail(request, "ambiguous-ass-event");
  } else {
    const std::vector<std::string> observed_events =
        split_observed_events(request.cue.observed_ass);
    if (observed_events.size() != active_events.size())
      return fail(request, "cue-text-mismatch");
    std::vector<bool> matched(active_events.size(), false);
    for (const std::string& observed : observed_events) {
      ActiveEvent* match = nullptr;
      for (size_t index = 0; index < active_events.size(); ++index) {
        if (matched[index] || active_events[index].text != observed) continue;
        if (match) return fail(request, "ambiguous-ass-event");
        match = &active_events[index];
      }
      if (!match) return fail(request, "cue-text-mismatch");
      matched[static_cast<size_t>(match - active_events.data())] = true;
      ordered_events.push_back(match);
    }
  }

  std::vector<ASS_IinatanLookupUnit> lookup_units;
  if (!build_lookup_units(ordered_events, request.units, lookup_units))
    return fail(request, "text-index-map-failed");
  const GeometryClock::time_point event_match_finished = GeometryClock::now();

  const GeometryClock::time_point library_started = GeometryClock::now();
  if (!state.session_valid ||
      state.embedded_fonts != request.renderer.embedded_fonts)
    if (!state.open_session(request.renderer))
      return fail(request, "libass-init-failed");
  if (request.validate_instrumentation && !state.ensure_original_renderer())
    return fail(request, "libass-init-failed");
  const GeometryClock::time_point library_finished = GeometryClock::now();

  const GeometryClock::time_point track_started = GeometryClock::now();
  TrackOwner original_track;
  TrackOwner instrumented_track;
  if ((request.validate_instrumentation &&
       !populate_track(
           state.library, media, active_events, original_track)) ||
      !populate_track(
          state.library, media, active_events, instrumented_track))
    return fail(request, "ambiguous-ass-event");
  const GeometryClock::time_point track_finished = GeometryClock::now();

  const GeometryClock::time_point renderer_started = GeometryClock::now();
  if (request.validate_instrumentation)
    configure_renderer(state.original_renderer, request.renderer);
  configure_renderer(state.instrumented_renderer, request.renderer);
  ass_iinatan_set_lookup_units(
      state.instrumented_renderer, lookup_units.data(),
      static_cast<int>(lookup_units.size()));
  const GeometryClock::time_point renderer_finished = GeometryClock::now();

  int original_change = 0;
  int instrumented_change = 0;
  const GeometryClock::time_point original_render_started =
      GeometryClock::now();
  ASS_Image* original_images =
      request.validate_instrumentation
          ? ass_render_frame(
                state.original_renderer, original_track.value,
                request.cue.time_ms, &original_change)
          : nullptr;
  const GeometryClock::time_point original_render_finished =
      GeometryClock::now();
  ASS_Image* instrumented_images = ass_render_frame(
      state.instrumented_renderer, instrumented_track.value,
      request.cue.time_ms, &instrumented_change);
  const GeometryClock::time_point instrumented_render_finished =
      GeometryClock::now();
  if (!ass_iinatan_lookup_units_valid(state.instrumented_renderer))
    return fail(request, "cross-unit-cluster");
  if (!instrumented_images ||
      (request.validate_instrumentation && !original_images))
    return fail(request, "empty-render");

  AlphaPlanes original_alpha;
  AlphaPlanes instrumented_alpha;
  CroppedAlpha cropped_alpha;
  int64_t alpha_composed_pixels = 0;
  const GeometryClock::time_point alpha_started = GeometryClock::now();
  if (request.validate_instrumentation) {
    if (!compose_alpha(
            original_images, request.renderer.width, request.renderer.height,
            original_alpha) ||
        !compose_alpha(
            instrumented_images, request.renderer.width,
            request.renderer.height, instrumented_alpha))
      return fail(request, "unsupported-libass-image");
    alpha_composed_pixels =
        static_cast<int64_t>(request.renderer.width) *
        request.renderer.height * 6;
  } else if (
      request.request_alpha_mask &&
      !compose_character_alpha_crop(
          instrumented_images, request.renderer.width,
          request.renderer.height, cropped_alpha)) {
    return fail(request, "unsupported-libass-image");
  } else if (request.request_alpha_mask) {
    alpha_composed_pixels =
        static_cast<int64_t>(cropped_alpha.width) * cropped_alpha.height;
  }
  const GeometryClock::time_point alpha_finished = GeometryClock::now();
  if (request.validate_instrumentation &&
      original_alpha != instrumented_alpha) {
    for (size_t plane = 0; plane < original_alpha.size(); ++plane) {
      size_t different = 0;
      unsigned maximum_delta = 0;
      for (size_t index = 0; index < original_alpha[plane].size(); ++index) {
        const unsigned left = original_alpha[plane][index];
        const unsigned right = instrumented_alpha[plane][index];
        if (left == right) continue;
        ++different;
        maximum_delta =
            std::max(maximum_delta, left > right ? left - right : right - left);
      }
      if (different)
        return fail(
            request, "instrumentation-alpha-mismatch",
            "plane=" + std::to_string(plane) +
                " pixels=" + std::to_string(different) +
                " maxDelta=" + std::to_string(maximum_delta));
    }
  }
  const GeometryClock::time_point validation_finished = GeometryClock::now();

  std::vector<UnitRect> rects(request.units.size());
  for (size_t index = 0; index < request.units.size(); ++index)
    rects[index].position = request.units[index].position;
  std::array<ASS_IinatanLookupRect, 256> lookup_rects{};
  const int lookup_rect_count = ass_iinatan_get_lookup_rects(
      state.instrumented_renderer, lookup_rects.data(),
      static_cast<int>(lookup_rects.size()));
  if (lookup_rect_count < 0 ||
      lookup_rect_count > static_cast<int>(lookup_rects.size()))
    return fail(request, "invalid-unit-geometry");
  for (int index = 0; index < lookup_rect_count; ++index) {
    const ASS_IinatanLookupRect& source =
        lookup_rects[static_cast<size_t>(index)];
    if (source.id < 0 ||
        source.id >= static_cast<int>(rects.size()) || source.x < 0 ||
        source.y < 0 || source.w <= 0 || source.h <= 0)
      return fail(request, "invalid-unit-geometry");
    UnitRect& target = rects[static_cast<size_t>(source.id)];
    const int64_t right = static_cast<int64_t>(source.x) + source.w;
    const int64_t bottom = static_cast<int64_t>(source.y) + source.h;
    if (right > request.renderer.width ||
        bottom > request.renderer.height)
      return fail(request, "invalid-unit-geometry");
    target.seen = true;
    target.left = source.x;
    target.top = source.y;
    target.right = static_cast<int>(right);
    target.bottom = static_cast<int>(bottom);
  }
  Json::Array response_units;
  for (const UnitRect& rect : rects) {
    if (!rect.seen || rect.right <= rect.left || rect.bottom <= rect.top)
      return fail(request, "missing-unit-fill");
    Json::Array unit_rects;
    unit_rects.emplace_back(Json::Object{
        {"x", rect.left},
        {"y", rect.top},
        {"w", rect.right - rect.left},
        {"h", rect.bottom - rect.top},
    });
    response_units.emplace_back(Json::Object{
        {"position", rect.position},
        {"rects", std::move(unit_rects)},
    });
  }
  Json::Object response{
      {"ok", true},
      {"protocol", kAssGeometryProtocol},
      {"requestId", request.request_id},
      {"units", std::move(response_units)},
      {"rendererWidth", request.renderer.width},
      {"rendererHeight", request.renderer.height},
  };
  const GeometryClock::time_point mask_started = GeometryClock::now();
  int64_t alpha_mask_scanned_pixels = 0;
  if (request.request_alpha_mask) {
    std::optional<Json> mask;
    if (request.validate_instrumentation) {
      mask = encode_alpha_mask(
          original_alpha[0], request.renderer.width,
          request.renderer.height);
      alpha_mask_scanned_pixels =
          static_cast<int64_t>(request.renderer.width) *
          request.renderer.height;
    } else {
      mask = encode_alpha_mask(
          cropped_alpha.pixels, cropped_alpha.width, cropped_alpha.height,
          cropped_alpha.x, cropped_alpha.y);
      alpha_mask_scanned_pixels =
          static_cast<int64_t>(cropped_alpha.width) * cropped_alpha.height;
    }
    if (mask) response.emplace("alphaMask", *mask);
  }
  const GeometryClock::time_point mask_finished = GeometryClock::now();
  if (request.diagnostics) {
    response.emplace(
        "diagnostics",
        Json::Object{
            {"validationEnabled", request.validate_instrumentation},
            {"alphaMaskRequested", request.request_alpha_mask},
            {"demuxCacheHit", demux_hit},
            {"requestCount", static_cast<int64_t>(state.request_count)},
            {"demuxHitCount", static_cast<int64_t>(state.demux_hit_count)},
            {"demuxMissCount", static_cast<int64_t>(state.demux_miss_count)},
            {"sessionCreationCount",
             static_cast<int64_t>(state.session_creation_count)},
            {"sessionDestructionCount",
             static_cast<int64_t>(state.session_destruction_count)},
            {"demuxUs", elapsed_us(demux_started, demux_finished)},
            {"eventMatchUs",
             elapsed_us(demux_finished, event_match_finished)},
            {"librarySetupUs",
             elapsed_us(library_started, library_finished)},
            {"trackBuildUs", elapsed_us(track_started, track_finished)},
            {"rendererSetupUs",
             elapsed_us(renderer_started, renderer_finished)},
            {"originalRenderUs",
             elapsed_us(original_render_started, original_render_finished)},
            {"instrumentedRenderUs",
             elapsed_us(
                 original_render_finished, instrumented_render_finished)},
            {"alphaCompositionUs", elapsed_us(alpha_started, alpha_finished)},
            {"validationCompareUs",
             elapsed_us(alpha_finished, validation_finished)},
            {"alphaMaskEncodingUs", elapsed_us(mask_started, mask_finished)},
            {"alphaComposedPixels", alpha_composed_pixels},
            {"alphaMaskScannedPixels", alpha_mask_scanned_pixels},
            {"totalUs", elapsed_us(total_started, mask_finished)},
        });
  }
  return response;
#endif
}

const char* libass_geometry_version() {
#ifdef IINATAN_ASS_GEOMETRY
  static std::string version = [] {
    const unsigned raw = ass_library_version();
    const auto bcd = [](unsigned value) {
      return static_cast<unsigned>(((value >> 4) & 0xf) * 10 + (value & 0xf));
    };
    std::ostringstream out;
    out << ((raw >> 28) & 0xf) << "." << bcd((raw >> 20) & 0xff) << "."
        << bcd((raw >> 12) & 0xff);
    return out.str();
  }();
  return version.c_str();
#else
  return "unavailable";
#endif
}

}  // namespace iinatan::ass
