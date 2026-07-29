#pragma once

#include <cstdint>
#include <map>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>

namespace iinatan::protocol {

class Json {
 public:
  using Array = std::vector<Json>;
  using Object = std::map<std::string, Json>;
  using Value =
      std::variant<std::nullptr_t, bool, double, std::string, Array, Object>;

  Json() : value_(nullptr) {}
  Json(std::nullptr_t) : value_(nullptr) {}
  Json(bool value) : value_(value) {}
  Json(double value) : value_(value) {}
  Json(int value) : value_(static_cast<double>(value)) {}
  Json(int64_t value) : value_(static_cast<double>(value)) {}
  Json(std::string value) : value_(std::move(value)) {}
  Json(const char* value) : value_(std::string(value)) {}
  Json(Array value) : value_(std::move(value)) {}
  Json(Object value) : value_(std::move(value)) {}

  static Json parse(const std::string& source);
  std::string dump() const;

  bool is_null() const;
  bool is_bool() const;
  bool is_number() const;
  bool is_string() const;
  bool is_array() const;
  bool is_object() const;

  bool boolean() const;
  double number() const;
  int64_t integer() const;
  const std::string& string() const;
  const Array& array() const;
  const Object& object() const;

  const Json* find(const std::string& key) const;
  std::string string_or(const std::string& fallback = "") const;
  int64_t integer_or(int64_t fallback) const;
  double number_or(double fallback) const;
  bool boolean_or(bool fallback) const;

 private:
  Value value_;
};

struct GeometryUnitRequest {
  int position = -1;
  int display_start_utf16 = -1;
  int display_end_utf16 = -1;
};

struct GeometrySourceRequest {
  std::string path;
  int ff_index = -1;
  bool external = false;
};

struct GeometryCueRequest {
  int64_t time_ms = -1;
  int64_t start_ms = -1;
  int64_t end_ms = -1;
  std::string observed_ass;
  std::string observed_plain;
  bool uses_observed_plain = false;
};

struct GeometryRendererRequest {
  int width = 0;
  int height = 0;
  int storage_width = 0;
  int storage_height = 0;
  int margin_left = 0;
  int margin_right = 0;
  int margin_top = 0;
  int margin_bottom = 0;
  double pixel_aspect = 1.0;
  double font_scale = 1.0;
  double line_spacing = 0.0;
  bool force_margins = false;
  bool embedded_fonts = true;
  bool use_storage_size = true;
  double line_position = 100.0;
  std::string override_mode = "yes";
  std::string default_family;
  std::string font_provider = "auto";
  bool ass_justify = false;
  std::string hinting = "none";
  std::string shaper = "complex";
};

struct GeometryRequest {
  int protocol = 0;
  std::string request_id;
  bool diagnostics = false;
  bool validate_instrumentation = true;
  bool request_alpha_mask = true;
  GeometrySourceRequest source;
  GeometryCueRequest cue;
  GeometryRendererRequest renderer;
  std::vector<GeometryUnitRequest> units;
};

bool is_geometry_request(const Json& root);
GeometryRequest parse_geometry_request(const Json& root);
Json geometry_error(
    const std::string& request_id, const std::string& reason,
    const std::string& detail = "");

}  // namespace iinatan::protocol
