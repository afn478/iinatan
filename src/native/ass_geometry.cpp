#include "ass_geometry.hpp"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
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
    const std::string& packet, std::string& prefix, std::string& effect,
    std::string& text) {
  size_t offset = 0;
  for (int field = 0; field < 8; ++field) {
    const size_t comma = packet.find(',', offset);
    if (comma == std::string::npos) return false;
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
    const std::string& raw, const std::vector<GeometryUnitRequest>& units,
    std::vector<ASS_IinatanLookupUnit>& result) {
  TextIndex index;
  if (!build_text_index(raw, index)) return false;
  result.clear();
  result.reserve(units.size());
  for (size_t unit_index = 0; unit_index < units.size(); ++unit_index) {
    const GeometryUnitRequest& unit = units[unit_index];
    if (unit.display_start_utf16 < 0 ||
        unit.display_end_utf16 <= unit.display_start_utf16 ||
        static_cast<size_t>(unit.display_end_utf16) >=
            index.logical_boundary.size())
      return false;
    const int start =
        index.logical_boundary[static_cast<size_t>(unit.display_start_utf16)];
    const int end =
        index.logical_boundary[static_cast<size_t>(unit.display_end_utf16)];
    if (start < 0 || end <= start) return false;
    result.push_back(
        ASS_IinatanLookupUnit{start, end, static_cast<int>(unit_index)});
  }
  return true;
}

#ifdef IINATAN_ASS_GEOMETRY
struct LibraryOwner {
  ASS_Library* value = nullptr;
  ~LibraryOwner() {
    if (value) ass_library_done(value);
  }
};
struct RendererOwner {
  ASS_Renderer* value = nullptr;
  ~RendererOwner() {
    if (value) ass_renderer_done(value);
  }
};
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
      renderer, options.override_mode == "scale"
                    ? ASS_OVERRIDE_BIT_SELECTIVE_FONT_SCALE
                    : 0);
  ass_set_fonts(
      renderer, nullptr, options.default_family.c_str(),
      ASS_FONTPROVIDER_AUTODETECT, nullptr, 1);
}

bool populate_track(
    ASS_Library* library, const DemuxedAss& media,
    const SubtitlePacket& packet, const std::string& packet_data,
    TrackOwner& track) {
  track.value = ass_new_track(library);
  if (!track.value) return false;
  ass_process_codec_private(
      track.value,
      reinterpret_cast<char*>(
          const_cast<uint8_t*>(media.codec_private.data())),
      static_cast<int>(media.codec_private.size()));
  ass_process_chunk(
      track.value, const_cast<char*>(packet_data.data()),
      static_cast<int>(packet_data.size()), packet.start_ms,
      packet.duration_ms);
  return track.value->n_events == 1;
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
      const int y = image->dst_y + row;
      if (y < 0 || y >= height) continue;
      for (int column = 0; column < image->w; ++column) {
        const int x = image->dst_x + column;
        if (x < 0 || x >= width) continue;
        const unsigned bitmap =
            image->bitmap[static_cast<size_t>(row) * image->stride + column];
        const unsigned source_alpha =
            (bitmap * (255 - color_alpha) + 127) / 255;
        uint8_t& destination =
            planes[plane_index][static_cast<size_t>(y) * width + x];
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

std::optional<Json> make_alpha_mask(
    const std::vector<uint8_t>& alpha, int frame_width, int frame_height) {
  int left = frame_width;
  int top = frame_height;
  int right = 0;
  int bottom = 0;
  for (int y = 0; y < frame_height; ++y) {
    for (int x = 0; x < frame_width; ++x) {
      if (!alpha[static_cast<size_t>(y) * frame_width + x]) continue;
      left = std::min(left, x);
      top = std::min(top, y);
      right = std::max(right, x + 1);
      bottom = std::max(bottom, y + 1);
    }
  }
  if (right <= left || bottom <= top) return std::nullopt;
  const int width = right - left;
  const int height = bottom - top;
  constexpr size_t kMaxMaskPixels = 262144;
  if (static_cast<size_t>(width) * height > kMaxMaskPixels)
    return std::nullopt;

  std::vector<uint8_t> rle;
  rle.reserve(static_cast<size_t>(width) * height / 2);
  uint8_t current = alpha[static_cast<size_t>(top) * frame_width + left];
  unsigned run = 0;
  const auto flush = [&] {
    rle.push_back(static_cast<uint8_t>(run));
    rle.push_back(current);
  };
  for (int y = top; y < bottom; ++y) {
    for (int x = left; x < right; ++x) {
      const uint8_t value =
          alpha[static_cast<size_t>(y) * frame_width + x];
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
      {"x", left},
      {"y", top},
      {"w", width},
      {"h", height},
      {"encoding", "rle-u8-base64"},
      {"data", base64_encode(rle)},
  };
}

#endif

}  // namespace

protocol::Json GeometryService::handle(const GeometryRequest& request) {
#ifndef IINATAN_ASS_GEOMETRY
  return fail(
      request, "ass-geometry-unavailable",
      "helper was built without the pinned FFmpeg/libass stack");
#else
  if (request.renderer.ass_justify)
    return fail(request, "unsupported-renderer-option", "sub-ass-justify");
  if (request.renderer.font_provider != "auto" &&
      request.renderer.font_provider != "autodetect")
    return fail(request, "unsupported-renderer-option", "sub-font-provider");
  const DemuxResult demux =
      demux_ass_source(request.source, request.cue.start_ms, request.cue.end_ms);
  if (!demux.ok) return fail(request, demux.reason, demux.detail);

  std::vector<const SubtitlePacket*> active;
  for (const SubtitlePacket& packet : demux.media.packets) {
    const int64_t end =
        packet.start_ms + std::max<int64_t>(packet.duration_ms, 1);
    if (packet.start_ms <= request.cue.time_ms &&
        end > request.cue.time_ms)
      active.push_back(&packet);
  }
  if (active.empty()) return fail(request, "cue-not-found");
  if (active.size() != 1) return fail(request, "overlapping-events");
  const SubtitlePacket& packet = *active.front();
  if (!close_time(packet.start_ms, request.cue.start_ms) ||
      (packet.duration_ms > 0 &&
       !close_time(
           packet.start_ms + packet.duration_ms, request.cue.end_ms, 250)))
    return fail(request, "cue-timing-mismatch");

  std::string packet_prefix;
  std::string event_effect;
  std::string event_text;
  if (!split_ass_packet(
          packet.data, packet_prefix, event_effect, event_text))
    return fail(request, "ambiguous-ass-event");
  if (event_text != request.cue.observed_ass)
    return fail(request, "cue-text-mismatch");
  if (!simple_dialogue_text(event_text))
    return fail(request, "complex-ass-tags");
  if (event_effect.find_first_not_of(" \t") != std::string::npos)
    return fail(request, "complex-ass-tags", "animated-effect");
  std::vector<ASS_IinatanLookupUnit> lookup_units;
  if (!build_lookup_units(event_text, request.units, lookup_units))
    return fail(request, "text-index-map-failed");

  LibraryOwner library;
  library.value = ass_library_init();
  if (!library.value) return fail(request, "libass-init-failed");
  ass_set_message_cb(library.value, ignore_ass_message, nullptr);
  ass_set_extract_fonts(
      library.value, request.renderer.embedded_fonts ? 1 : 0);
  if (request.renderer.embedded_fonts) {
    for (const FontAttachment& font : demux.media.fonts)
      ass_add_font(
          library.value, const_cast<char*>(font.name.c_str()),
          reinterpret_cast<char*>(
              const_cast<uint8_t*>(font.data.data())),
          static_cast<int>(font.data.size()));
  }

  TrackOwner original_track;
  TrackOwner instrumented_track;
  if (!populate_track(
          library.value, demux.media, packet, packet.data, original_track) ||
      !populate_track(
          library.value, demux.media, packet, packet.data,
          instrumented_track))
    return fail(request, "ambiguous-ass-event");

  RendererOwner original_renderer;
  RendererOwner instrumented_renderer;
  original_renderer.value = ass_renderer_init(library.value);
  instrumented_renderer.value = ass_renderer_init(library.value);
  if (!original_renderer.value || !instrumented_renderer.value)
    return fail(request, "libass-init-failed");
  configure_renderer(original_renderer.value, request.renderer);
  configure_renderer(instrumented_renderer.value, request.renderer);
  ass_iinatan_set_lookup_units(
      instrumented_renderer.value, lookup_units.data(),
      static_cast<int>(lookup_units.size()));

  int original_change = 0;
  int instrumented_change = 0;
  ASS_Image* original_images = ass_render_frame(
      original_renderer.value, original_track.value, request.cue.time_ms,
      &original_change);
  ASS_Image* instrumented_images = ass_render_frame(
      instrumented_renderer.value, instrumented_track.value,
      request.cue.time_ms, &instrumented_change);
  if (!ass_iinatan_lookup_units_valid(instrumented_renderer.value))
    return fail(request, "cross-unit-cluster");
  if (!original_images || !instrumented_images)
    return fail(request, "empty-render");

  AlphaPlanes original_alpha;
  AlphaPlanes instrumented_alpha;
  if (!compose_alpha(
          original_images, request.renderer.width, request.renderer.height,
          original_alpha) ||
      !compose_alpha(
          instrumented_images, request.renderer.width,
          request.renderer.height, instrumented_alpha))
    return fail(request, "unsupported-libass-image");
  if (original_alpha != instrumented_alpha) {
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

  std::vector<UnitRect> rects(request.units.size());
  for (size_t index = 0; index < request.units.size(); ++index)
    rects[index].position = request.units[index].position;
  std::array<ASS_IinatanLookupRect, 256> lookup_rects{};
  const int lookup_rect_count = ass_iinatan_get_lookup_rects(
      instrumented_renderer.value, lookup_rects.data(),
      static_cast<int>(lookup_rects.size()));
  if (lookup_rect_count < 0 ||
      lookup_rect_count > static_cast<int>(lookup_rects.size()))
    return fail(request, "invalid-unit-geometry");
  for (int index = 0; index < lookup_rect_count; ++index) {
    const ASS_IinatanLookupRect& source =
        lookup_rects[static_cast<size_t>(index)];
    if (source.id < 0 ||
        source.id >= static_cast<int>(rects.size()) || source.w <= 0 ||
        source.h <= 0)
      return fail(request, "invalid-unit-geometry");
    UnitRect& target = rects[static_cast<size_t>(source.id)];
    target.seen = true;
    target.left = source.x;
    target.top = source.y;
    target.right = source.x + source.w;
    target.bottom = source.y + source.h;
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
  if (const std::optional<Json> mask = make_alpha_mask(
          original_alpha[0], request.renderer.width,
          request.renderer.height))
    response.emplace("alphaMask", *mask);
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
