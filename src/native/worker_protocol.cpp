#include "worker_protocol.hpp"

#include <charconv>
#include <cmath>
#include <iomanip>
#include <limits>
#include <sstream>

namespace iinatan::protocol {
namespace {

void append_utf8(std::string& output, uint32_t codepoint) {
  if (codepoint <= 0x7f) {
    output.push_back(static_cast<char>(codepoint));
  } else if (codepoint <= 0x7ff) {
    output.push_back(static_cast<char>(0xc0 | (codepoint >> 6)));
    output.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  } else if (codepoint <= 0xffff) {
    output.push_back(static_cast<char>(0xe0 | (codepoint >> 12)));
    output.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
    output.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  } else {
    output.push_back(static_cast<char>(0xf0 | (codepoint >> 18)));
    output.push_back(static_cast<char>(0x80 | ((codepoint >> 12) & 0x3f)));
    output.push_back(static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f)));
    output.push_back(static_cast<char>(0x80 | (codepoint & 0x3f)));
  }
}

class Parser {
 public:
  explicit Parser(const std::string& source) : source_(source) {}

  Json parse() {
    skip_space();
    Json result = value(0);
    skip_space();
    if (offset_ != source_.size()) fail("trailing data");
    return result;
  }

 private:
  static constexpr int kMaxDepth = 48;
  static constexpr size_t kMaxStringBytes = 4 * 1024 * 1024;
  const std::string& source_;
  size_t offset_ = 0;

  [[noreturn]] void fail(const std::string& message) const {
    throw std::runtime_error(
        "invalid JSON at byte " + std::to_string(offset_) + ": " + message);
  }

  void skip_space() {
    while (offset_ < source_.size()) {
      const char c = source_[offset_];
      if (c != ' ' && c != '\t' && c != '\r' && c != '\n') break;
      ++offset_;
    }
  }

  bool take(char expected) {
    if (offset_ < source_.size() && source_[offset_] == expected) {
      ++offset_;
      return true;
    }
    return false;
  }

  Json value(int depth) {
    if (depth > kMaxDepth) fail("nesting limit exceeded");
    skip_space();
    if (offset_ >= source_.size()) fail("expected value");
    switch (source_[offset_]) {
      case 'n':
        literal("null");
        return nullptr;
      case 't':
        literal("true");
        return true;
      case 'f':
        literal("false");
        return false;
      case '"':
        return string();
      case '[':
        return array(depth + 1);
      case '{':
        return object(depth + 1);
      default:
        return number();
    }
  }

  void literal(const char* text) {
    const std::string expected(text);
    if (source_.compare(offset_, expected.size(), expected) != 0)
      fail("invalid literal");
    offset_ += expected.size();
  }

  uint32_t hex4() {
    if (offset_ + 4 > source_.size()) fail("short unicode escape");
    uint32_t value = 0;
    for (int i = 0; i < 4; ++i) {
      const char c = source_[offset_++];
      value <<= 4;
      if (c >= '0' && c <= '9') value |= static_cast<uint32_t>(c - '0');
      else if (c >= 'a' && c <= 'f')
        value |= static_cast<uint32_t>(c - 'a' + 10);
      else if (c >= 'A' && c <= 'F')
        value |= static_cast<uint32_t>(c - 'A' + 10);
      else
        fail("invalid unicode escape");
    }
    return value;
  }

  std::string string() {
    if (!take('"')) fail("expected string");
    std::string output;
    while (offset_ < source_.size()) {
      const unsigned char c = static_cast<unsigned char>(source_[offset_++]);
      if (c == '"') return output;
      if (c < 0x20) fail("control character in string");
      if (c != '\\') {
        output.push_back(static_cast<char>(c));
      } else {
        if (offset_ >= source_.size()) fail("short escape");
        const char escaped = source_[offset_++];
        switch (escaped) {
          case '"': output.push_back('"'); break;
          case '\\': output.push_back('\\'); break;
          case '/': output.push_back('/'); break;
          case 'b': output.push_back('\b'); break;
          case 'f': output.push_back('\f'); break;
          case 'n': output.push_back('\n'); break;
          case 'r': output.push_back('\r'); break;
          case 't': output.push_back('\t'); break;
          case 'u': {
            uint32_t codepoint = hex4();
            if (codepoint >= 0xd800 && codepoint <= 0xdbff) {
              if (offset_ + 2 > source_.size() || source_[offset_] != '\\' ||
                  source_[offset_ + 1] != 'u')
                fail("unpaired high surrogate");
              offset_ += 2;
              const uint32_t low = hex4();
              if (low < 0xdc00 || low > 0xdfff)
                fail("unpaired high surrogate");
              codepoint =
                  0x10000 + ((codepoint - 0xd800) << 10) + (low - 0xdc00);
            } else if (codepoint >= 0xdc00 && codepoint <= 0xdfff) {
              fail("unpaired low surrogate");
            }
            append_utf8(output, codepoint);
            break;
          }
          default: fail("unknown escape");
        }
      }
      if (output.size() > kMaxStringBytes) fail("string limit exceeded");
    }
    fail("unterminated string");
  }

  Json number() {
    const size_t start = offset_;
    if (take('-') && offset_ >= source_.size()) fail("short number");
    if (take('0')) {
      if (offset_ < source_.size() && source_[offset_] >= '0' &&
          source_[offset_] <= '9')
        fail("leading zero");
    } else {
      if (offset_ >= source_.size() || source_[offset_] < '1' ||
          source_[offset_] > '9')
        fail("expected number");
      while (offset_ < source_.size() && source_[offset_] >= '0' &&
             source_[offset_] <= '9')
        ++offset_;
    }
    if (take('.')) {
      if (offset_ >= source_.size() || source_[offset_] < '0' ||
          source_[offset_] > '9')
        fail("invalid fraction");
      while (offset_ < source_.size() && source_[offset_] >= '0' &&
             source_[offset_] <= '9')
        ++offset_;
    }
    if (offset_ < source_.size() &&
        (source_[offset_] == 'e' || source_[offset_] == 'E')) {
      ++offset_;
      if (offset_ < source_.size() &&
          (source_[offset_] == '+' || source_[offset_] == '-'))
        ++offset_;
      if (offset_ >= source_.size() || source_[offset_] < '0' ||
          source_[offset_] > '9')
        fail("invalid exponent");
      while (offset_ < source_.size() && source_[offset_] >= '0' &&
             source_[offset_] <= '9')
        ++offset_;
    }
    const std::string token = source_.substr(start, offset_ - start);
    char* end = nullptr;
    errno = 0;
    const double parsed = std::strtod(token.c_str(), &end);
    if (errno || !end || *end || !std::isfinite(parsed))
      fail("number out of range");
    return parsed;
  }

  Json array(int depth) {
    take('[');
    Json::Array output;
    skip_space();
    if (take(']')) return output;
    while (true) {
      if (output.size() >= 4096) fail("array item limit exceeded");
      output.push_back(value(depth));
      skip_space();
      if (take(']')) return output;
      if (!take(',')) fail("expected comma");
    }
  }

  Json object(int depth) {
    take('{');
    Json::Object output;
    skip_space();
    if (take('}')) return output;
    while (true) {
      skip_space();
      if (offset_ >= source_.size() || source_[offset_] != '"')
        fail("expected object key");
      const std::string key = string();
      skip_space();
      if (!take(':')) fail("expected colon");
      if (!output.emplace(key, value(depth)).second)
        fail("duplicate object key");
      skip_space();
      if (take('}')) return output;
      if (!take(',')) fail("expected comma");
    }
  }
};

std::string escaped(const std::string& source) {
  std::ostringstream out;
  out << '"';
  for (const unsigned char c : source) {
    switch (c) {
      case '"': out << "\\\""; break;
      case '\\': out << "\\\\"; break;
      case '\b': out << "\\b"; break;
      case '\f': out << "\\f"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (c < 0x20)
          out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
              << static_cast<unsigned>(c) << std::dec;
        else
          out << static_cast<char>(c);
    }
  }
  out << '"';
  return out.str();
}

const Json& required(const Json& value, const std::string& key) {
  const Json* child = value.find(key);
  if (!child) throw std::runtime_error("missing field: " + key);
  return *child;
}

}  // namespace

Json Json::parse(const std::string& source) {
  if (source.size() > 4 * 1024 * 1024)
    throw std::runtime_error("JSON request exceeds 4 MiB");
  return Parser(source).parse();
}

std::string Json::dump() const {
  if (is_null()) return "null";
  if (is_bool()) return boolean() ? "true" : "false";
  if (is_number()) {
    std::ostringstream out;
    out << std::setprecision(15) << number();
    return out.str();
  }
  if (is_string()) return escaped(string());
  if (is_array()) {
    std::string out = "[";
    for (size_t i = 0; i < array().size(); ++i) {
      if (i) out += ",";
      out += array()[i].dump();
    }
    return out + "]";
  }
  std::string out = "{";
  bool first = true;
  for (const auto& [key, value] : object()) {
    if (!first) out += ",";
    first = false;
    out += escaped(key) + ":" + value.dump();
  }
  return out + "}";
}

bool Json::is_null() const {
  return std::holds_alternative<std::nullptr_t>(value_);
}
bool Json::is_bool() const { return std::holds_alternative<bool>(value_); }
bool Json::is_number() const { return std::holds_alternative<double>(value_); }
bool Json::is_string() const {
  return std::holds_alternative<std::string>(value_);
}
bool Json::is_array() const { return std::holds_alternative<Array>(value_); }
bool Json::is_object() const { return std::holds_alternative<Object>(value_); }
bool Json::boolean() const { return std::get<bool>(value_); }
double Json::number() const { return std::get<double>(value_); }
int64_t Json::integer() const {
  const double value = number();
  if (std::floor(value) != value ||
      value < static_cast<double>(std::numeric_limits<int64_t>::min()) ||
      value > static_cast<double>(std::numeric_limits<int64_t>::max()))
    throw std::runtime_error("expected integer");
  return static_cast<int64_t>(value);
}
const std::string& Json::string() const {
  return std::get<std::string>(value_);
}
const Json::Array& Json::array() const { return std::get<Array>(value_); }
const Json::Object& Json::object() const { return std::get<Object>(value_); }
const Json* Json::find(const std::string& key) const {
  if (!is_object()) return nullptr;
  const auto found = object().find(key);
  return found == object().end() ? nullptr : &found->second;
}
std::string Json::string_or(const std::string& fallback) const {
  return is_string() ? string() : fallback;
}
int64_t Json::integer_or(int64_t fallback) const {
  try {
    return is_number() ? integer() : fallback;
  } catch (...) {
    return fallback;
  }
}
double Json::number_or(double fallback) const {
  return is_number() ? number() : fallback;
}
bool Json::boolean_or(bool fallback) const {
  return is_bool() ? boolean() : fallback;
}

bool is_geometry_request(const Json& root) {
  const Json* type = root.find("type");
  return type && type->is_string() && type->string() == "ass-geometry";
}

GeometryRequest parse_geometry_request(const Json& root) {
  if (!root.is_object()) throw std::runtime_error("request must be an object");
  GeometryRequest request;
  request.protocol = static_cast<int>(required(root, "protocol").integer());
  if (request.protocol != 1)
    throw std::runtime_error("unsupported geometry protocol");
  request.request_id = required(root, "requestId").string();
  if (request.request_id.empty() || request.request_id.size() > 128)
    throw std::runtime_error("invalid requestId");
  if (const Json* diagnostics = root.find("diagnostics"))
    request.diagnostics = diagnostics->boolean();
  if (const Json* validation = root.find("validateInstrumentation"))
    request.validate_instrumentation = validation->boolean();
  if (const Json* alpha_mask = root.find("requestAlphaMask"))
    request.request_alpha_mask = alpha_mask->boolean();

  const Json& source = required(root, "source");
  request.source.path = required(source, "path").string();
  request.source.ff_index =
      static_cast<int>(required(source, "ffIndex").integer());
  request.source.external =
      source.find("external") && source.find("external")->boolean_or(false);

  const Json& cue = required(root, "cue");
  request.cue.time_ms = required(cue, "timeMs").integer();
  request.cue.start_ms = required(cue, "startMs").integer();
  request.cue.end_ms = required(cue, "endMs").integer();
  const Json* observed_ass = cue.find("observedAss");
  const Json* observed_plain = cue.find("observedPlain");
  const Json* observed_format = cue.find("observedFormat");
  if (!!observed_ass == !!observed_plain ||
      (observed_ass && !observed_ass->is_string()) ||
      (observed_plain && !observed_plain->is_string()) ||
      (observed_format && !observed_format->is_string()) ||
      (observed_plain &&
       (!observed_format || observed_format->string() != "plain")) ||
      (observed_ass && observed_format &&
       observed_format->string() != "ass"))
    throw std::runtime_error(
        "cue requires exactly one observedAss or observedPlain");
  request.cue.uses_observed_plain = observed_plain != nullptr;
  if (observed_plain)
    request.cue.observed_plain = observed_plain->string();
  else
    request.cue.observed_ass = observed_ass->string();

  const Json& renderer = required(root, "renderer");
  request.renderer.width =
      static_cast<int>(required(renderer, "width").integer());
  request.renderer.height =
      static_cast<int>(required(renderer, "height").integer());
  request.renderer.storage_width =
      static_cast<int>(required(renderer, "storageWidth").integer());
  request.renderer.storage_height =
      static_cast<int>(required(renderer, "storageHeight").integer());
  if (const Json* value = renderer.find("marginLeft"))
    request.renderer.margin_left = static_cast<int>(value->integer());
  if (const Json* value = renderer.find("marginRight"))
    request.renderer.margin_right = static_cast<int>(value->integer());
  if (const Json* value = renderer.find("marginTop"))
    request.renderer.margin_top = static_cast<int>(value->integer());
  if (const Json* value = renderer.find("marginBottom"))
    request.renderer.margin_bottom = static_cast<int>(value->integer());
  if (const Json* value = renderer.find("pixelAspect"))
    request.renderer.pixel_aspect = value->number();
  if (const Json* value = renderer.find("fontScale"))
    request.renderer.font_scale = value->number();
  if (const Json* value = renderer.find("lineSpacing"))
    request.renderer.line_spacing = value->number();
  if (const Json* value = renderer.find("forceMargins"))
    request.renderer.force_margins = value->boolean();
  if (const Json* value = renderer.find("embeddedFonts"))
    request.renderer.embedded_fonts = value->boolean();
  if (const Json* value = renderer.find("useStorageSize"))
    request.renderer.use_storage_size = value->boolean();
  if (const Json* value = renderer.find("linePosition"))
    request.renderer.line_position = value->number();
  request.renderer.override_mode =
      required(renderer, "overrideMode").string();
  request.renderer.default_family =
      required(renderer, "defaultFamily").string();
  request.renderer.font_provider =
      required(renderer, "fontProvider").string();
  request.renderer.ass_justify =
      required(renderer, "assJustify").boolean();
  if (const Json* value = renderer.find("hinting"))
    request.renderer.hinting = value->string();
  if (const Json* value = renderer.find("shaper"))
    request.renderer.shaper = value->string();

  const Json& units = required(root, "units");
  if (!units.is_array() || units.array().empty() || units.array().size() > 256)
    throw std::runtime_error("units must contain 1..256 entries");
  for (const Json& value : units.array()) {
    GeometryUnitRequest unit;
    unit.position = static_cast<int>(required(value, "position").integer());
    unit.display_start_utf16 =
        static_cast<int>(required(value, "displayStartUtf16").integer());
    unit.display_end_utf16 =
        static_cast<int>(required(value, "displayEndUtf16").integer());
    request.units.push_back(unit);
  }

  if (request.source.path.empty() || request.source.path.size() > 4096)
    throw std::runtime_error("invalid source path");
  if (request.source.ff_index < 0)
    throw std::runtime_error("invalid ffIndex");
  if (request.cue.time_ms < 0 || request.cue.start_ms < 0 ||
      request.cue.end_ms <= request.cue.start_ms ||
      request.cue.observed_ass.size() > 64 * 1024 ||
      request.cue.observed_plain.size() > 64 * 1024)
    throw std::runtime_error("invalid cue");
  if (request.renderer.width < 64 || request.renderer.height < 64 ||
      static_cast<int64_t>(request.renderer.width) * request.renderer.height >
          16'000'000)
    throw std::runtime_error("invalid renderer dimensions");
  if (request.renderer.storage_width < 16 ||
      request.renderer.storage_height < 16 ||
      static_cast<int64_t>(request.renderer.storage_width) *
              request.renderer.storage_height >
          16'000'000)
    throw std::runtime_error("invalid renderer storage dimensions");
  if (request.renderer.pixel_aspect < 0.1 ||
      request.renderer.pixel_aspect > 10.0 ||
      request.renderer.font_scale < 0.1 ||
      request.renderer.font_scale > 10.0)
    throw std::runtime_error("invalid renderer scale");
  if (request.renderer.line_position < -50 ||
      request.renderer.line_position > 100)
    throw std::runtime_error("invalid renderer line position");
  if (request.renderer.margin_left < 0 ||
      request.renderer.margin_right < 0 ||
      request.renderer.margin_top < 0 ||
      request.renderer.margin_bottom < 0 ||
      request.renderer.margin_left + request.renderer.margin_right >=
          request.renderer.width ||
      request.renderer.margin_top + request.renderer.margin_bottom >=
          request.renderer.height)
    throw std::runtime_error("invalid renderer margins");
  if (request.renderer.line_spacing < -100 ||
      request.renderer.line_spacing > 200 ||
      (request.renderer.hinting != "none" &&
       request.renderer.hinting != "light" &&
       request.renderer.hinting != "normal" &&
       request.renderer.hinting != "native") ||
      (request.renderer.shaper != "simple" &&
       request.renderer.shaper != "complex") ||
      (request.renderer.override_mode != "no" &&
       request.renderer.override_mode != "yes" &&
       request.renderer.override_mode != "scale") ||
      request.renderer.default_family.empty() ||
      request.renderer.default_family.size() > 256 ||
      request.renderer.font_provider.empty() ||
      request.renderer.font_provider.size() > 64)
    throw std::runtime_error("invalid renderer option");
  int previous_end = -1;
  for (const GeometryUnitRequest& unit : request.units) {
    if (unit.position < 0 || unit.display_start_utf16 < 0 ||
        unit.display_end_utf16 <= unit.display_start_utf16 ||
        unit.display_start_utf16 < previous_end)
      throw std::runtime_error("invalid or overlapping unit span");
    previous_end = unit.display_end_utf16;
  }
  return request;
}

Json geometry_error(
    const std::string& request_id, const std::string& reason,
    const std::string& detail) {
  Json::Object object{
      {"ok", false},
      {"protocol", 1},
      {"requestId", request_id},
      {"reason", reason},
  };
  if (!detail.empty()) object.emplace("detail", detail);
  return object;
}

}  // namespace iinatan::protocol
