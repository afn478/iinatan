#include <algorithm>
#include <chrono>
#include <cctype>
#include <cmath>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <functional>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <signal.h>
#include <string>
#include <sys/types.h>
#include <thread>
#include <vector>

#include <CoreFoundation/CoreFoundation.h>
#include <CoreText/CoreText.h>
#include <utf8.h>

#include "hoshidicts/deinflector.hpp"
#include "hoshidicts/importer.hpp"
#include "hoshidicts/lookup.hpp"
#include "hoshidicts/query.hpp"
#include "ass_geometry.hpp"
#include "worker_protocol.hpp"

// This is the native command/protocol implementation version, not the plugin
// release version. Plugin release metadata is owned by Info.json.
static constexpr const char* WRAPPER_VERSION = "1.9.0";
static constexpr int FONT_METRIC_RESOLVER_VERSION = 2;
static constexpr const char* FONT_METRIC_SOURCE = "coretext-libass-os2-win-v2";
namespace fs = std::filesystem;

static std::string json_escape(const std::string& s) {
  std::string out;
  out.reserve(s.size() + 16);
  for (unsigned char c : s) {
    switch (c) {
      case '\\': out += "\\\\"; break;
      case '"': out += "\\\""; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          const char* hex = "0123456789abcdef";
          out += "\\u00";
          out += hex[(c >> 4) & 0xf];
          out += hex[c & 0xf];
        } else out += static_cast<char>(c);
    }
  }
  return out;
}
static std::string json_quote(const std::string& s) { return std::string("\"") + json_escape(s) + "\""; }
static std::string error_json(const std::string& message) { return std::string("{\"ok\":false,\"error\":") + json_quote(message) + "}\n"; }
static void print_error(const std::string& message) { std::cout << error_json(message); }
static void print_string_array(const std::vector<std::string>& values) {
  std::cout << "[";
  for (size_t i = 0; i < values.size(); ++i) { if (i) std::cout << ","; std::cout << json_quote(values[i]); }
  std::cout << "]";
}
static int to_int(const std::string& s, int fallback) { try { return std::stoi(s); } catch (...) { return fallback; } }
static bool to_bool(const std::string& s, bool fallback) {
  std::string value;
  value.reserve(s.size());
  for (unsigned char c : s) value += static_cast<char>(std::tolower(c));
  if (value == "yes" || value == "true" || value == "1" || value == "on") return true;
  if (value == "no" || value == "false" || value == "0" || value == "off") return false;
  return fallback;
}
static std::string cf_string_utf8(CFStringRef value) {
  if (!value) return "";
  CFIndex length = CFStringGetLength(value);
  CFIndex capacity = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
  std::vector<char> buffer(static_cast<size_t>(std::max<CFIndex>(capacity, 1)));
  if (!CFStringGetCString(value, buffer.data(), capacity, kCFStringEncodingUTF8)) return "";
  return std::string(buffer.data());
}
static CFStringRef utf8_cf_string(const std::string& value) {
  return CFStringCreateWithBytes(
      kCFAllocatorDefault,
      reinterpret_cast<const UInt8*>(value.data()),
      static_cast<CFIndex>(value.size()),
      kCFStringEncodingUTF8,
      false);
}
static std::string normalized_font_name(const std::string& value) {
  std::string normalized;
  normalized.reserve(value.size());
  for (unsigned char c : value) {
    if (c >= 0x80) normalized += static_cast<char>(c);
    else if (std::isalnum(c)) normalized += static_cast<char>(std::tolower(c));
  }
  return normalized;
}
static bool font_name_matches(const std::string& requested, const std::string& candidate) {
  const std::string left = normalized_font_name(requested);
  const std::string right = normalized_font_name(candidate);
  return !left.empty() && left == right;
}
static bool libass_font_name_matches(
    const std::string& requested, const std::string& candidate) {
  if (requested.size() != candidate.size() || requested.empty()) return false;
  for (size_t index = 0; index < requested.size(); ++index) {
    const unsigned char left =
        static_cast<unsigned char>(requested[index]);
    const unsigned char right =
        static_cast<unsigned char>(candidate[index]);
    if (left < 0x80 && right < 0x80) {
      if (std::tolower(left) != std::tolower(right)) return false;
    } else if (left != right) {
      return false;
    }
  }
  return true;
}
static std::string libass_coretext_font_substitution(
    const std::string& requested) {
  std::string normalized;
  normalized.reserve(requested.size());
  for (unsigned char character : requested)
    normalized += static_cast<char>(std::tolower(character));
  if (normalized == "sans-serif") return "Helvetica";
  if (normalized == "serif") return "Times";
  if (normalized == "monospace") return "Courier";
  return requested;
}
static std::string cf_url_path(CFURLRef url) {
  if (!url) return "";
  CFStringRef path = CFURLCopyFileSystemPath(url, kCFURLPOSIXPathStyle);
  const std::string result = cf_string_utf8(path);
  if (path) CFRelease(path);
  return result;
}
static std::string font_descriptor_name(
    CTFontDescriptorRef descriptor, CFStringRef attribute) {
  if (!descriptor) return "";
  CFTypeRef value = CTFontDescriptorCopyAttribute(descriptor, attribute);
  if (!value) return "";
  const std::string result =
      CFGetTypeID(value) == CFStringGetTypeID()
      ? cf_string_utf8(static_cast<CFStringRef>(value))
      : "";
  CFRelease(value);
  return result;
}
static std::string font_descriptor_path(CTFontDescriptorRef descriptor) {
  if (!descriptor) return "";
  CFTypeRef value =
      CTFontDescriptorCopyAttribute(descriptor, kCTFontURLAttribute);
  if (!value) return "";
  const std::string result =
      CFGetTypeID(value) == CFURLGetTypeID()
      ? cf_url_path(static_cast<CFURLRef>(value))
      : "";
  CFRelease(value);
  return result;
}
static CTFontFormat coretext_font_format(CTFontRef font) {
  if (!font) return kCTFontFormatUnrecognized;
  CFTypeRef value = CTFontCopyAttribute(font, kCTFontFormatAttribute);
  int raw_format = static_cast<int>(kCTFontFormatUnrecognized);
  if (value && CFGetTypeID(value) == CFNumberGetTypeID())
    CFNumberGetValue(
        static_cast<CFNumberRef>(value), kCFNumberIntType, &raw_format);
  if (value) CFRelease(value);
  return static_cast<CTFontFormat>(raw_format);
}
static std::string libass_coretext_discovered_path(
    const std::string& requested_font, const std::string& resolved_postscript) {
  CFStringRef requested = utf8_cf_string(requested_font);
  if (!requested) return "";
  const CFStringRef attributes[] = {
      kCTFontFamilyNameAttribute,
      kCTFontDisplayNameAttribute,
      kCTFontNameAttribute,
  };
  CTFontDescriptorRef descriptors[3] = {nullptr, nullptr, nullptr};
  std::string result;
  for (size_t index = 0; index < 3; ++index) {
    const void* keys[] = {attributes[index]};
    const void* values[] = {requested};
    CFDictionaryRef dictionary = CFDictionaryCreate(
        kCFAllocatorDefault,
        keys,
        values,
        1,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks);
    if (dictionary) {
      descriptors[index] = CTFontDescriptorCreateWithAttributes(dictionary);
      CFRelease(dictionary);
    }
  }
  CFArrayRef descriptor_array = CFArrayCreate(
      kCFAllocatorDefault,
      reinterpret_cast<const void**>(descriptors),
      3,
      &kCFTypeArrayCallBacks);
  int remove_duplicates = 1;
  CFNumberRef remove_duplicates_value = CFNumberCreate(
      kCFAllocatorDefault, kCFNumberIntType, &remove_duplicates);
  const void* option_keys[] = {kCTFontCollectionRemoveDuplicatesOption};
  const void* option_values[] = {remove_duplicates_value};
  CFDictionaryRef options =
      remove_duplicates_value
      ? CFDictionaryCreate(
            kCFAllocatorDefault,
            option_keys,
            option_values,
            1,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks)
      : nullptr;
  CTFontCollectionRef collection =
      descriptor_array && options
      ? CTFontCollectionCreateWithFontDescriptors(descriptor_array, options)
      : nullptr;
  CFArrayRef matches =
      collection
      ? CTFontCollectionCreateMatchingFontDescriptors(collection)
      : nullptr;
  if (matches) {
    for (CFIndex index = 0; index < CFArrayGetCount(matches); ++index) {
      CTFontDescriptorRef descriptor = static_cast<CTFontDescriptorRef>(
          const_cast<void*>(CFArrayGetValueAtIndex(matches, index)));
      const std::string postscript =
          font_descriptor_name(descriptor, kCTFontNameAttribute);
      const std::string path = font_descriptor_path(descriptor);
      std::error_code error;
      if (libass_font_name_matches(resolved_postscript, postscript) &&
          !path.empty() && fs::is_regular_file(path, error) && !error) {
        result = path;
        break;
      }
    }
  }
  if (matches) CFRelease(matches);
  if (collection) CFRelease(collection);
  if (options) CFRelease(options);
  if (remove_duplicates_value) CFRelease(remove_duplicates_value);
  if (descriptor_array) CFRelease(descriptor_array);
  for (CTFontDescriptorRef descriptor : descriptors)
    if (descriptor) CFRelease(descriptor);
  CFRelease(requested);
  return result;
}
static bool libass_name_can_select_face(
    const std::string& requested_font,
    const std::string& postscript,
    const std::vector<std::string>& legacy_families,
    const std::vector<std::string>& legacy_full_names,
    CTFontFormat format) {
  for (const std::string& family : legacy_families)
    if (libass_font_name_matches(requested_font, family)) return true;
  const bool matches_full_name = std::any_of(
      legacy_full_names.begin(),
      legacy_full_names.end(),
      [&](const std::string& full_name) {
        return libass_font_name_matches(requested_font, full_name);
      });
  const bool matches_postscript_name =
      libass_font_name_matches(requested_font, postscript);
  if (matches_full_name == matches_postscript_name)
    return matches_full_name;
  // libass only treats a PostScript-name-only match as authoritative for a
  // PostScript-outline face. Conversely, its full-name-only match is
  // authoritative for TrueType outlines.
  const bool postscript_outlines =
      format == kCTFontFormatOpenTypePostScript ||
      format == kCTFontFormatPostScript;
  return postscript_outlines
      ? matches_postscript_name
      : matches_full_name;
}
static std::string read_private_font_metric_cue(const fs::path& path) {
  const std::string filename = path.filename().string();
  if (filename.rfind("iinatan-font-metrics-cue-", 0) != 0)
    throw std::runtime_error("font-metrics-invalid-cue-input");
  std::error_code error;
  if (!fs::is_regular_file(path, error) || error)
    throw std::runtime_error("font-metrics-invalid-cue-input");
  const fs::perms permissions = fs::status(path, error).permissions();
  const fs::perms non_owner_permissions =
      fs::perms::group_all | fs::perms::others_all;
  if (error || (permissions & non_owner_permissions) != fs::perms::none) {
    fs::remove(path, error);
    throw std::runtime_error("font-metrics-invalid-cue-input");
  }
  const uintmax_t size = fs::file_size(path, error);
  if (error || size > 128 * 1024) {
    fs::remove(path, error);
    throw std::runtime_error("font-metrics-invalid-cue-input");
  }
  std::ifstream input(path, std::ios::binary);
  if (!input.is_open()) {
    fs::remove(path, error);
    throw std::runtime_error("font-metrics-invalid-cue-input");
  }
  // Unlink immediately after opening so a timeout, crash, or plugin reload
  // cannot leave subtitle text behind on disk.
  fs::remove(path, error);
  if (error) {
    input.close();
    throw std::runtime_error("font-metrics-invalid-cue-input");
  }
  std::ostringstream contents;
  contents << input.rdbuf();
  const bool read_ok = input.good() || input.eof();
  input.close();
  if (!read_ok)
    throw std::runtime_error("font-metrics-invalid-cue-input");
  return contents.str();
}
static uint16_t read_be_u16(const UInt8* bytes, CFIndex length, CFIndex offset) {
  if (!bytes || offset < 0 || offset + 2 > length)
    throw std::runtime_error("font-metrics-invalid-table");
  return static_cast<uint16_t>(
      (static_cast<uint16_t>(bytes[offset]) << 8) |
      static_cast<uint16_t>(bytes[offset + 1]));
}
static std::vector<std::string> microsoft_font_names(
    CTFontRef font, uint16_t requested_name_id) {
  std::vector<std::string> names;
  CFDataRef table = CTFontCopyTable(
      font, kCTFontTableName, kCTFontTableOptionNoOptions);
  if (!table) return names;
  const UInt8* bytes = CFDataGetBytePtr(table);
  const CFIndex length = CFDataGetLength(table);
  try {
    const uint16_t count = read_be_u16(bytes, length, 2);
    const uint16_t string_offset = read_be_u16(bytes, length, 4);
    for (uint16_t index = 0; index < count; ++index) {
      const CFIndex record = 6 + static_cast<CFIndex>(index) * 12;
      const uint16_t platform = read_be_u16(bytes, length, record);
      const uint16_t name_id = read_be_u16(bytes, length, record + 6);
      const uint16_t byte_length = read_be_u16(bytes, length, record + 8);
      const uint16_t byte_offset = read_be_u16(bytes, length, record + 10);
      const CFIndex start =
          static_cast<CFIndex>(string_offset) + byte_offset;
      if (platform != 3 || name_id != requested_name_id ||
          start < 0 || start + byte_length > length)
        continue;
      CFStringRef name = CFStringCreateWithBytes(
          kCFAllocatorDefault,
          bytes + start,
          byte_length,
          kCFStringEncodingUTF16BE,
          false);
      const std::string value = cf_string_utf8(name);
      if (name) CFRelease(name);
      if (!value.empty() &&
          std::none_of(
              names.begin(), names.end(),
              [&](const std::string& existing) {
                return font_name_matches(existing, value);
              }))
        names.push_back(value);
    }
  } catch (...) {
    names.clear();
  }
  CFRelease(table);
  return names;
}
static std::vector<std::string> legacy_family_names(CTFontRef font) {
  return microsoft_font_names(font, 1);
}
static std::vector<std::string> legacy_full_names(CTFontRef font) {
  return microsoft_font_names(font, 4);
}
static bool coverage_codepoint_ignored(uint32_t codepoint) {
  return codepoint <= 0x20 ||
      (codepoint >= 0x7f && codepoint <= 0xa0) ||
      codepoint == 0x1680 ||
      (codepoint >= 0x2000 && codepoint <= 0x200f) ||
      (codepoint >= 0x2028 && codepoint <= 0x202f) ||
      (codepoint >= 0x205f && codepoint <= 0x206f) ||
      codepoint == 0x3000 ||
      codepoint == 0xfeff ||
      (codepoint >= 0xfe00 && codepoint <= 0xfe0f) ||
      (codepoint >= 0xe0100 && codepoint <= 0xe01ef);
}
static std::vector<UniChar> coverage_characters(CFStringRef cue) {
  std::vector<UniChar> result;
  if (!cue) return result;
  const CFIndex length = CFStringGetLength(cue);
  std::vector<UniChar> characters(static_cast<size_t>(length));
  if (length > 0)
    CFStringGetCharacters(cue, CFRangeMake(0, length), characters.data());
  for (CFIndex index = 0; index < length; ++index) {
    const UniChar first = characters[static_cast<size_t>(index)];
    uint32_t codepoint = first;
    bool surrogate_pair = false;
    if (CFStringIsSurrogateHighCharacter(first) && index + 1 < length) {
      const UniChar second = characters[static_cast<size_t>(index + 1)];
      if (CFStringIsSurrogateLowCharacter(second)) {
        codepoint = CFStringGetLongCharacterForSurrogatePair(first, second);
        surrogate_pair = true;
      }
    }
    if (!coverage_codepoint_ignored(codepoint)) {
      result.push_back(first);
      if (surrogate_pair)
        result.push_back(characters[static_cast<size_t>(index + 1)]);
    }
    if (surrogate_pair) ++index;
  }
  return result;
}
static bool process_exists(int pid) {
  if (pid <= 0) return true;
  if (::kill(static_cast<pid_t>(pid), 0) == 0) return true;
  return errno == EPERM;
}
static std::string read_file(const fs::path& p) {
  std::ifstream in(p, std::ios::binary);
  if (!in) throw std::runtime_error("could not open " + p.string());
  std::ostringstream ss;
  ss << in.rdbuf();
  if (in.bad()) throw std::runtime_error("could not read " + p.string());
  return ss.str();
}
static std::string read_file_limited(const fs::path& p, uintmax_t max_bytes) {
  std::error_code ec;
  const uintmax_t size = fs::file_size(p, ec);
  if (ec)
    throw std::runtime_error(
        "could not inspect " + p.string() + ": " + ec.message());
  if (size > max_bytes)
    throw std::runtime_error(
        "request file exceeds " + std::to_string(max_bytes) + " bytes");
  return read_file(p);
}
static void write_file_atomic(const fs::path& p, const std::string& data) {
  fs::create_directories(p.parent_path());
  fs::path tmp = p;
  tmp += ".tmp";
  {
    std::ofstream out(tmp, std::ios::binary | std::ios::trunc);
    if (!out) throw std::runtime_error("could not open " + tmp.string());
    out << data;
    out.flush();
    if (!out) throw std::runtime_error("could not write " + tmp.string());
  }
  std::error_code ec;
  fs::rename(tmp, p, ec);
  if (ec) { fs::remove(p, ec); fs::rename(tmp, p, ec); }
  if (ec) throw std::runtime_error("could not write " + p.string() + ": " + ec.message());
}
static bool valid_worker_request_id(const std::string& value) {
  if (value.empty() || value.size() > 128) return false;
  return std::all_of(value.begin(), value.end(), [](unsigned char character) {
    return std::isalnum(character) || character == '-' || character == '_';
  });
}
static std::string utf8_prefix(const std::string& s, size_t max_bytes) {
  std::string out;
  out.reserve(std::min(max_bytes, s.size()));
  for (size_t i = 0; i < s.size();) {
    unsigned char c = static_cast<unsigned char>(s[i]);
    size_t n = 1;
    if ((c & 0x80) == 0) n = 1;
    else if ((c & 0xE0) == 0xC0) n = 2;
    else if ((c & 0xF0) == 0xE0) n = 3;
    else if ((c & 0xF8) == 0xF0) n = 4;
    if (i + n > s.size() || out.size() + n > max_bytes) break;
    out.append(s, i, n);
    i += n;
  }
  if (out.size() < s.size()) out += "…";
  return out;
}
static std::string compact_glossary(const std::string& s) {
  // Jitendex structured-content is JSON encoded as a string. Truncating it
  // makes the overlay fall back to showing raw JSON, so keep structured
  // payloads intact. Plain text glossaries are safe to shorten.
  std::string trimmed = s;
  size_t start = trimmed.find_first_not_of(" \t\r\n");
  if (start != std::string::npos && (trimmed[start] == '[' || trimmed[start] == '{')) return s;
  return utf8_prefix(s, 2000);
}
static void append_int_array(std::ostringstream& out, const std::vector<int>& values) {
  out << "[";
  for (size_t i = 0; i < values.size(); ++i) {
    if (i) out << ",";
    out << values[i];
  }
  out << "]";
}
static void append_term_metadata_json(std::ostringstream& out, const TermResult& term) {
  out << ",\"frequencies\":[";
  for (size_t i = 0; i < term.frequencies.size(); ++i) {
    const auto& entry = term.frequencies[i];
    if (i) out << ",";
    out << "{\"dict\":" << json_quote(entry.dict_name) << ",\"frequencies\":[";
    for (size_t j = 0; j < entry.frequencies.size(); ++j) {
      const auto& freq = entry.frequencies[j];
      if (j) out << ",";
      out << "{\"value\":" << freq.value
          << ",\"displayValue\":" << json_quote(freq.display_value) << "}";
    }
    out << "]}";
  }
  out << "],\"pitches\":[";
  for (size_t i = 0; i < term.pitches.size(); ++i) {
    const auto& entry = term.pitches[i];
    if (i) out << ",";
    out << "{\"dict\":" << json_quote(entry.dict_name)
        << ",\"positions\":";
    append_int_array(out, entry.pitch_positions);
    out << ",\"transcriptions\":[";
    for (size_t j = 0; j < entry.transcriptions.size(); ++j) {
      if (j) out << ",";
      out << json_quote(entry.transcriptions[j]);
    }
    out << "]}";
  }
  out << "]";
}
static void add_all_dictionary_types(DictionaryQuery& query, const std::vector<std::string>& dict_paths) {
  for (const auto& p : dict_paths) {
    query.add_term_dict(p);
    query.add_freq_dict(p);
    query.add_pitch_dict(p);
  }
}
static std::vector<size_t> utf8_prefix_end_offsets(const std::string& s, size_t max_chars) {
  std::vector<size_t> ends;
  for (size_t i = 0; i < s.size() && ends.size() < max_chars;) {
    unsigned char c = static_cast<unsigned char>(s[i]);
    size_t n = 1;
    if ((c & 0x80) == 0) n = 1;
    else if ((c & 0xE0) == 0xC0) n = 2;
    else if ((c & 0xF0) == 0xE0) n = 3;
    else if ((c & 0xF8) == 0xF0) n = 4;
    if (i + n > s.size()) break;
    i += n;
    ends.push_back(i);
  }
  return ends;
}
static std::string lookup_to_json(Lookup& lookup, const std::string& lookup_string, int max_results, int scan_length, int max_glossaries) {
  auto results = lookup.lookup(lookup_string, max_results, static_cast<size_t>(std::max(1, scan_length)));
  std::ostringstream out;
  out << "{\"ok\":true,\"lookupString\":" << json_quote(lookup_string)
      << ",\"scanLength\":" << scan_length
      << ",\"resultCount\":" << results.size()
      << ",\"results\":[";
  for (size_t i = 0; i < results.size(); ++i) {
    const auto& r = results[i];
    if (i) out << ",";
    out << "{\"matched\":" << json_quote(r.matched)
        << ",\"deinflected\":" << json_quote(r.deinflected)
        << ",\"preprocessorSteps\":" << r.preprocessor_steps
        << ",\"trace\":[";
    for (size_t j = 0; j < r.trace.size(); ++j) {
      if (j) out << ",";
      out << "{\"name\":" << json_quote(r.trace[j].name)
          << ",\"description\":" << json_quote(r.trace[j].description) << "}";
    }
    out << "],\"term\":{\"expression\":" << json_quote(r.term.expression)
        << ",\"reading\":" << json_quote(r.term.reading)
        << ",\"rules\":" << json_quote(r.term.rules)
        << ",\"glossaries\":[";
    size_t glossary_limit = std::min<size_t>(r.term.glossaries.size(), static_cast<size_t>(std::max(1, max_glossaries)));
    for (size_t g = 0; g < glossary_limit; ++g) {
      const auto& gl = r.term.glossaries[g];
      if (g) out << ",";
      out << "{\"dict\":" << json_quote(gl.dict_name)
          << ",\"glossary\":" << json_quote(compact_glossary(gl.glossary))
          << ",\"definitionTags\":" << json_quote(gl.definition_tags)
          << ",\"termTags\":" << json_quote(gl.term_tags) << "}";
    }
    out << "]";
    append_term_metadata_json(out, r.term);
    out << "}}";
  }
  out << "]}\n";
  return out.str();
}
static std::string exact_lookup_to_json(DictionaryQuery& query, const std::string& lookup_string, int max_results, int max_glossaries) {
  auto terms = query.query(lookup_string);
  if (terms.size() > static_cast<size_t>(max_results)) terms.resize(static_cast<size_t>(std::max(1, max_results)));
  std::ostringstream out;
  out << "{\"ok\":true,\"lookupString\":" << json_quote(lookup_string)
      << ",\"scanLength\":" << utf8::distance(lookup_string.begin(), lookup_string.end())
      << ",\"mode\":\"exact\""
      << ",\"resultCount\":" << terms.size()
      << ",\"results\":[";
  for (size_t i = 0; i < terms.size(); ++i) {
    const auto& term = terms[i];
    if (i) out << ",";
    out << "{\"matched\":" << json_quote(lookup_string)
        << ",\"deinflected\":" << json_quote(lookup_string)
        << ",\"preprocessorSteps\":0"
        << ",\"trace\":[],\"term\":{\"expression\":" << json_quote(term.expression)
        << ",\"reading\":" << json_quote(term.reading)
        << ",\"rules\":" << json_quote(term.rules)
        << ",\"glossaries\":[";
    size_t glossary_limit = std::min<size_t>(term.glossaries.size(), static_cast<size_t>(std::max(1, max_glossaries)));
    for (size_t g = 0; g < glossary_limit; ++g) {
      const auto& gl = term.glossaries[g];
      if (g) out << ",";
      out << "{\"dict\":" << json_quote(gl.dict_name)
          << ",\"glossary\":" << json_quote(compact_glossary(gl.glossary))
          << ",\"definitionTags\":" << json_quote(gl.definition_tags)
          << ",\"termTags\":" << json_quote(gl.term_tags) << "}";
    }
    out << "]";
    append_term_metadata_json(out, term);
    out << "}}";
  }
  out << "]}\n";
  return out.str();
}
static std::string prefix_lookup_to_json(DictionaryQuery& query, const std::string& lookup_string, int max_results, int scan_length, int max_glossaries) {
  const auto ends = utf8_prefix_end_offsets(lookup_string, static_cast<size_t>(std::max(1, scan_length)));
  std::string matched;
  std::vector<TermResult> terms;
  for (size_t i = ends.size(); i > 0; --i) {
    std::string candidate = lookup_string.substr(0, ends[i - 1]);
    auto found = query.query(candidate);
    if (!found.empty()) {
      matched = candidate;
      terms = std::move(found);
      break;
    }
  }
  if (terms.size() > static_cast<size_t>(max_results)) terms.resize(static_cast<size_t>(std::max(1, max_results)));
  std::ostringstream out;
  out << "{\"ok\":true,\"lookupString\":" << json_quote(lookup_string)
      << ",\"scanLength\":" << scan_length
      << ",\"mode\":\"prefix\""
      << ",\"resultCount\":" << terms.size()
      << ",\"results\":[";
  for (size_t i = 0; i < terms.size(); ++i) {
    const auto& term = terms[i];
    if (i) out << ",";
    out << "{\"matched\":" << json_quote(matched)
        << ",\"deinflected\":" << json_quote(matched)
        << ",\"preprocessorSteps\":0"
        << ",\"trace\":[],\"term\":{\"expression\":" << json_quote(term.expression)
        << ",\"reading\":" << json_quote(term.reading)
        << ",\"rules\":" << json_quote(term.rules)
        << ",\"glossaries\":[";
    size_t glossary_limit = std::min<size_t>(term.glossaries.size(), static_cast<size_t>(std::max(1, max_glossaries)));
    for (size_t g = 0; g < glossary_limit; ++g) {
      const auto& gl = term.glossaries[g];
      if (g) out << ",";
      out << "{\"dict\":" << json_quote(gl.dict_name)
          << ",\"glossary\":" << json_quote(compact_glossary(gl.glossary))
          << ",\"definitionTags\":" << json_quote(gl.definition_tags)
          << ",\"termTags\":" << json_quote(gl.term_tags) << "}";
    }
    out << "]";
    append_term_metadata_json(out, term);
    out << "}}";
  }
  out << "]}\n";
  return out.str();
}
static std::string parse_json_string_at(const std::string& body, size_t& i) {
  std::string out;
  if (i >= body.size() || body[i] != '"') return out;
  ++i;
  while (i < body.size()) {
    char c = body[i++];
    if (c == '"') break;
    if (c == '\\' && i < body.size()) {
      char e = body[i++];
      switch (e) {
        case 'n': out += '\n'; break;
        case 'r': out += '\r'; break;
        case 't': out += '\t'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case '\\': out += '\\'; break;
        case '"': out += '"'; break;
        default: out += e; break;
      }
    } else out += c;
  }
  return out;
}
static std::string json_get_string(const std::string& body, const std::string& key) {
  std::string pattern = "\"" + key + "\"";
  size_t k = body.find(pattern);
  if (k == std::string::npos) return "";
  size_t colon = body.find(':', k + pattern.size());
  if (colon == std::string::npos) return "";
  size_t i = colon + 1;
  while (i < body.size() && std::isspace(static_cast<unsigned char>(body[i]))) ++i;
  if (i < body.size() && body[i] == '"') return parse_json_string_at(body, i);
  size_t end = body.find_first_of(",}\r\n", i);
  if (end == std::string::npos) end = body.size();
  return body.substr(i, end - i);
}
static int json_get_int(const std::string& body, const std::string& key, int fallback) {
  std::string pattern = "\"" + key + "\"";
  size_t k = body.find(pattern);
  if (k == std::string::npos) return fallback;
  size_t colon = body.find(':', k + pattern.size());
  if (colon == std::string::npos) return fallback;
  size_t i = colon + 1;
  while (i < body.size() && std::isspace(static_cast<unsigned char>(body[i]))) ++i;
  size_t end = body.find_first_of(",}\r\n", i);
  if (end == std::string::npos) end = body.size();
  return to_int(body.substr(i, end - i), fallback);
}
static void cmd_import(int argc, char** argv) {
  if (argc < 4) { print_error("usage: import <zip_path> <output_dir> [--low-ram]"); std::exit(2); }
  std::string zip_path = argv[2];
  std::string output_dir = argv[3];
  bool low_ram = true;
  for (int i = 4; i < argc; ++i) { std::string arg = argv[i]; if (arg == "--normal-ram") low_ram = false; if (arg == "--low-ram") low_ram = true; }
  auto r = dictionary_importer::import(zip_path, output_dir, low_ram);
  std::cout << "{\"ok\":" << (r.success ? "true" : "false") << ",\"title\":" << json_quote(r.title)
            << ",\"term_count\":" << r.term_count << ",\"meta_count\":" << r.meta_count
            << ",\"freq_count\":" << r.freq_count << ",\"pitch_count\":" << r.pitch_count
            << ",\"media_count\":" << r.media_count << ",\"tag_count\":0,\"errors\":";
  print_string_array(r.errors);
  if (!r.success && !r.errors.empty()) std::cout << ",\"error\":" << json_quote(r.errors.front());
  std::cout << "}\n";
  if (!r.success) std::exit(1);
}
static std::vector<std::string> parse_lookup_args(int argc, char** argv, std::string& lookup_string, int& max_results, int& scan_length, int& max_glossaries, std::string& mode) {
  std::vector<std::string> dict_paths;
  max_results = 8; scan_length = 24; max_glossaries = 4; mode = "yomitan-japanese";
  for (int i = 2; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--max-results" && i + 1 < argc) max_results = std::max(1, to_int(argv[++i], max_results));
    else if (arg == "--scan-length" && i + 1 < argc) scan_length = std::max(1, to_int(argv[++i], scan_length));
    else if (arg == "--max-glossaries" && i + 1 < argc) max_glossaries = std::max(1, to_int(argv[++i], max_glossaries));
    else if (arg == "--mode" && i + 1 < argc) mode = argv[++i];
    else if (arg == "--" && i + 1 < argc) { lookup_string = argv[++i]; break; }
    else dict_paths.push_back(arg);
  }
  return dict_paths;
}
static void cmd_lookup(int argc, char** argv) {
  std::string lookup_string; int max_results = 8; int scan_length = 24; int max_glossaries = 4; std::string mode;
  auto dict_paths = parse_lookup_args(argc, argv, lookup_string, max_results, scan_length, max_glossaries, mode);
  if (dict_paths.empty()) { print_error("no dictionary paths supplied"); std::exit(2); }
  if (lookup_string.empty()) { print_error("no lookup string supplied"); std::exit(2); }
  DictionaryQuery dict_query;
  add_all_dictionary_types(dict_query, dict_paths);
  if (mode == "exact") {
    std::cout << exact_lookup_to_json(dict_query, lookup_string, max_results, max_glossaries);
    return;
  }
  if (mode == "prefix") {
    std::cout << prefix_lookup_to_json(dict_query, lookup_string, max_results, scan_length, max_glossaries);
    return;
  }
  Deinflector deinflector;
  Lookup lookup(dict_query, deinflector);
  std::cout << lookup_to_json(lookup, lookup_string, max_results, scan_length, max_glossaries);
}
struct WorkerConfig { std::string fingerprint; std::vector<std::string> dicts; };
static WorkerConfig read_worker_config(const fs::path& config_path) {
  WorkerConfig cfg;
  std::ifstream in(config_path);
  std::string line;
  while (std::getline(in, line)) {
    size_t tab = line.find('\t');
    if (tab == std::string::npos) continue;
    std::string key = line.substr(0, tab);
    std::string val = line.substr(tab + 1);
    if (key == "fingerprint") cfg.fingerprint = val;
    else if (key == "dict") cfg.dicts.push_back(val);
  }
  return cfg;
}
static void cmd_worker(int argc, char** argv) {
  if (argc < 3) { print_error("usage: worker <worker_dir> [--sleep-ms n] [--owner-pid pid]"); std::exit(2); }
  fs::path root = argv[2];
  int sleep_ms = 2;
  int owner_pid = 0;
  for (int i = 3; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--sleep-ms" && i + 1 < argc) sleep_ms = std::max(1, to_int(argv[++i], sleep_ms));
    else if (arg == "--owner-pid" && i + 1 < argc) owner_pid = std::max(0, to_int(argv[++i], 0));
  }
  fs::path queue = root / "queue";
  fs::path responses = root / "responses";
  fs::path state = root / "state";
  fs::path stop = root / "stop";
  fs::path config_path = root / "config.tsv";
  fs::create_directories(queue); fs::create_directories(responses); fs::create_directories(state);
  WorkerConfig cfg = read_worker_config(config_path);
  if (cfg.dicts.empty()) throw std::runtime_error("worker config has no dictionaries");
  DictionaryQuery dict_query;
  add_all_dictionary_types(dict_query, cfg.dicts);
  Deinflector deinflector;
  Lookup lookup(dict_query, deinflector);
  iinatan::ass::GeometryService geometry_service;
  write_file_atomic(state / "ready.json", std::string("{\"ok\":true,\"worker\":true,\"wrapperVersion\":") + json_quote(WRAPPER_VERSION) + ",\"fingerprint\":" + json_quote(cfg.fingerprint) + ",\"dictCount\":" + std::to_string(cfg.dicts.size()) + ",\"assGeometry\":{\"protocol\":1,\"available\":" +
#ifdef IINATAN_ASS_GEOMETRY
      "true"
#else
      "false"
#endif
      ",\"patch\":" + json_quote(iinatan::ass::kAssGeometryPatch) + ",\"observedPlain\":true}}\n");
  const int active_sleep_ms = std::max(1, sleep_ms);
  const int idle_sleep_ms = std::max(active_sleep_ms, 16);
  int current_sleep_ms = active_sleep_ms;
  std::cerr << "iina-hoshi-dicts worker ready with " << cfg.dicts.size()
            << " dictionaries; active_sleep_ms=" << active_sleep_ms
            << "; idle_sleep_ms=" << idle_sleep_ms
            << "; owner_pid=" << owner_pid << "\n";
  auto next_owner_check = std::chrono::steady_clock::now() + std::chrono::seconds(1);
  while (!fs::exists(stop)) {
    if (owner_pid > 0 && std::chrono::steady_clock::now() >= next_owner_check) {
      if (!process_exists(owner_pid)) {
        std::cerr << "iina-hoshi-dicts worker stopping because owner pid " << owner_pid << " exited\n";
        break;
      }
      next_owner_check = std::chrono::steady_clock::now() + std::chrono::seconds(1);
    }
    std::vector<fs::path> requests;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(queue, ec)) {
      if (!entry.is_regular_file()) continue;
      if (entry.path().extension() == ".json") requests.push_back(entry.path());
    }
    std::sort(requests.begin(), requests.end());
    for (const auto& req : requests) {
      std::string request_id = req.stem().string();
      if (!valid_worker_request_id(request_id)) {
        fs::remove(req, ec);
        fs::remove(queue / (request_id + ".request"), ec);
        continue;
      }
      fs::path resp = responses / (request_id + ".json");
      fs::path committed_body = queue / (request_id + ".request");
      try {
        const fs::path body_path =
            fs::exists(committed_body) ? committed_body : req;
        std::string body = read_file_limited(body_path, 4 * 1024 * 1024);
        std::string provided_id = json_get_string(body, "requestId");
        if (!provided_id.empty() && provided_id != request_id)
          throw std::runtime_error(
              "requestId must match the queue filename");
        iinatan::protocol::Json parsed_request =
            iinatan::protocol::Json::parse(body);
        if (iinatan::protocol::is_geometry_request(parsed_request)) {
          const iinatan::protocol::GeometryRequest geometry_request =
              iinatan::protocol::parse_geometry_request(parsed_request);
          const std::string out =
              geometry_service.handle(geometry_request).dump() + "\n";
          if (out.size() > 1024 * 1024)
            throw std::runtime_error("geometry response exceeds 1 MiB");
          write_file_atomic(resp, out);
          std::cerr << "ass geometry response " << request_id
                    << " bytes=" << out.size() << "\n";
          fs::remove(req, ec);
          fs::remove(committed_body, ec);
          continue;
        }
        std::string text = json_get_string(body, "text");
        std::string mode = json_get_string(body, "mode");
        if (mode.empty()) mode = "yomitan-japanese";
        int max_results = std::max(1, json_get_int(body, "maxResults", 8));
        int max_glossaries = std::max(1, json_get_int(body, "maxGlossaries", 4));
        int scan_length = std::max(1, json_get_int(body, "scanLength", 24));
        if (text.empty()) throw std::runtime_error("lookup request did not include text");
        std::cerr << "lookup request " << request_id << " text_bytes=" << text.size() << " scan=" << scan_length << " max=" << max_results << " glossaries=" << max_glossaries << " mode=" << mode << "\n";
        std::string out = (mode == "exact")
            ? exact_lookup_to_json(dict_query, text, max_results, max_glossaries)
            : (mode == "prefix")
                ? prefix_lookup_to_json(dict_query, text, max_results, scan_length, max_glossaries)
                : lookup_to_json(lookup, text, max_results, scan_length, max_glossaries);
        write_file_atomic(resp, out);
        std::cerr << "lookup response " << request_id << " bytes=" << out.size() << "\n";
      } catch (const std::exception& e) {
        write_file_atomic(resp, error_json(e.what()));
      }
      fs::remove(req, ec);
      fs::remove(committed_body, ec);
    }
    current_sleep_ms = requests.empty()
        ? std::min(idle_sleep_ms, current_sleep_ms * 2)
        : active_sleep_ms;
    std::this_thread::sleep_for(
        std::chrono::milliseconds(current_sleep_ms));
  }
  std::cerr << "iina-hoshi-dicts worker stopping\n";
}

static long long now_millis() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
static std::string make_request_id() {
  auto wall = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
  auto tid = std::hash<std::thread::id>{}(std::this_thread::get_id());
  return std::string("c") + std::to_string(wall) + "-" + std::to_string(static_cast<unsigned long long>(tid));
}
static void cmd_client(int argc, char** argv) {
  if (argc < 4) { print_error("usage: client <worker_dir> [--max-results n] [--max-glossaries n] [--scan-length n] [--mode mode] [--timeout-ms n] -- <lookup_string>"); std::exit(2); }
  fs::path root = argv[2];
  int max_results = 8;
  int scan_length = 24;
  int max_glossaries = 4;
  int timeout_ms = 30000;
  std::string mode = "yomitan-japanese";
  std::string lookup_string;
  for (int i = 3; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--max-results" && i + 1 < argc) max_results = std::max(1, to_int(argv[++i], max_results));
    else if (arg == "--scan-length" && i + 1 < argc) scan_length = std::max(1, to_int(argv[++i], scan_length));
    else if (arg == "--max-glossaries" && i + 1 < argc) max_glossaries = std::max(1, to_int(argv[++i], max_glossaries));
    else if (arg == "--mode" && i + 1 < argc) mode = argv[++i];
    else if (arg == "--timeout-ms" && i + 1 < argc) timeout_ms = std::max(1000, to_int(argv[++i], timeout_ms));
    else if (arg == "--" && i + 1 < argc) { lookup_string = argv[++i]; break; }
  }
  if (lookup_string.empty()) { print_error("no lookup string supplied"); std::exit(2); }
  fs::path queue = root / "queue";
  fs::path responses = root / "responses";
  fs::path state = root / "state";
  fs::path ready = state / "ready.json";
  fs::path stop = root / "stop";
  fs::create_directories(queue);
  fs::create_directories(responses);
  if (!fs::exists(ready)) { print_error("worker is not ready; no ready.json found"); std::exit(1); }
  if (fs::exists(stop)) { print_error("worker stop file exists; restart the worker"); std::exit(1); }
  std::string request_id = make_request_id();
  fs::path req = queue / (request_id + ".json");
  fs::path resp = responses / (request_id + ".json");
  std::ostringstream payload;
  payload << "{\"requestId\":" << json_quote(request_id)
          << ",\"text\":" << json_quote(lookup_string)
          << ",\"scanLength\":" << scan_length
          << ",\"maxResults\":" << max_results
          << ",\"maxGlossaries\":" << max_glossaries
          << ",\"mode\":" << json_quote(mode) << "}\n";
  write_file_atomic(req, payload.str());
  const long long deadline = now_millis() + timeout_ms;
  std::error_code ec;
  while (now_millis() < deadline) {
    if (fs::exists(resp)) {
      std::string body = read_file(resp);
      fs::remove(resp, ec);
      fs::remove(req, ec);
      std::cout << body;
      if (body.empty() || body.back() != '\n') std::cout << "\n";
      return;
    }
    if (fs::exists(stop)) { fs::remove(req, ec); print_error("worker stopped before lookup completed"); std::exit(1); }
    std::this_thread::sleep_for(std::chrono::milliseconds(25));
  }
  fs::remove(req, ec);
  print_error("worker client timed out after " + std::to_string(timeout_ms) + " ms waiting for response to " + request_id);
  std::exit(1);
}

static void cmd_font_metrics(int argc, char** argv) {
  std::string requested_font;
  std::string cue_file;
  std::string cue;
  bool requested_bold = false;
  bool requested_italic = false;
  for (int index = 2; index < argc; ++index) {
    const std::string arg = argv[index];
    if (arg == "--font" && index + 1 < argc)
      requested_font = argv[++index];
    else if (arg == "--bold" && index + 1 < argc)
      requested_bold = to_bool(argv[++index], false);
    else if (arg == "--italic" && index + 1 < argc)
      requested_italic = to_bool(argv[++index], false);
    else if (arg == "--cue-file" && index + 1 < argc)
      cue_file = argv[++index];
    else
      throw std::runtime_error("font-metrics-invalid-arguments");
  }
  if (requested_font.empty()) throw std::runtime_error("font-metrics-missing-font");
  if (cue_file.empty()) throw std::runtime_error("font-metrics-missing-cue-input");
  cue = read_private_font_metric_cue(cue_file);
  const std::string selection_font =
      libass_coretext_font_substitution(requested_font);

  CFStringRef requested_name = utf8_cf_string(selection_font);
  if (!requested_name) throw std::runtime_error("font-metrics-invalid-font-name");
  CTFontRef base_font = CTFontCreateWithName(requested_name, 100.0, nullptr);
  CFRelease(requested_name);
  if (!base_font) throw std::runtime_error("font-metrics-font-not-found");

  CFStringRef base_postscript_ref = CTFontCopyPostScriptName(base_font);
  CFStringRef base_family_ref = CTFontCopyFamilyName(base_font);
  CFStringRef base_full_ref = CTFontCopyFullName(base_font);
  const std::string base_postscript = cf_string_utf8(base_postscript_ref);
  const std::string base_family = cf_string_utf8(base_family_ref);
  const std::string base_full = cf_string_utf8(base_full_ref);
  std::vector<std::string> base_legacy_families =
      legacy_family_names(base_font);
  if (base_legacy_families.empty() && !base_family.empty())
    base_legacy_families.push_back(base_family);
  const std::vector<std::string> base_legacy_full_names =
      legacy_full_names(base_font);
  if (base_postscript_ref) CFRelease(base_postscript_ref);
  if (base_family_ref) CFRelease(base_family_ref);
  if (base_full_ref) CFRelease(base_full_ref);
  const bool requested_postscript = font_name_matches(selection_font, base_postscript);
  const bool requested_full = std::any_of(
      base_legacy_full_names.begin(),
      base_legacy_full_names.end(),
      [&](const std::string& full_name) {
        return font_name_matches(selection_font, full_name);
      });
  const bool requested_extended_family =
      font_name_matches(selection_font, base_family) ||
      font_name_matches(selection_font, base_full);
  const bool requested_family = std::any_of(
      base_legacy_families.begin(),
      base_legacy_families.end(),
      [&](const std::string& family) {
        return libass_font_name_matches(selection_font, family);
      });
  if (!requested_postscript && !requested_full && !requested_family) {
    CFRelease(base_font);
    throw std::runtime_error(
        requested_extended_family
        ? "font-metrics-provider-unverified"
        : "font-metrics-font-not-found");
  }

  CTFontRef resolved_font = base_font;
  if (requested_family) {
    CTFontSymbolicTraits desired = 0;
    if (requested_bold) desired |= kCTFontBoldTrait;
    if (requested_italic) desired |= kCTFontItalicTrait;
    const CTFontSymbolicTraits mask = kCTFontBoldTrait | kCTFontItalicTrait;
    CTFontRef styled_font = CTFontCreateCopyWithSymbolicTraits(
        base_font, 100.0, nullptr, desired, mask);
    if (!styled_font) {
      CFRelease(base_font);
      throw std::runtime_error("font-metrics-style-unavailable");
    }
    const CTFontSymbolicTraits styled_traits = CTFontGetSymbolicTraits(styled_font);
    if ((styled_traits & mask) != desired) {
      CFRelease(styled_font);
      CFRelease(base_font);
      throw std::runtime_error("font-metrics-style-unavailable");
    }
    CFStringRef styled_family_ref = CTFontCopyFamilyName(styled_font);
    const std::string styled_family = cf_string_utf8(styled_family_ref);
    if (styled_family_ref) CFRelease(styled_family_ref);
    if (!font_name_matches(base_family, styled_family)) {
      CFRelease(styled_font);
      CFRelease(base_font);
      throw std::runtime_error("font-metrics-family-mismatch");
    }
    resolved_font = styled_font;
  }
  const CTFontSymbolicTraits traits = CTFontGetSymbolicTraits(resolved_font);

  CFStringRef postscript_ref = CTFontCopyPostScriptName(resolved_font);
  CFStringRef family_ref = CTFontCopyFamilyName(resolved_font);
  CFStringRef full_ref = CTFontCopyFullName(resolved_font);
  CFStringRef version_ref = CTFontCopyName(resolved_font, kCTFontVersionNameKey);
  const std::string postscript = cf_string_utf8(postscript_ref);
  const std::string family = cf_string_utf8(family_ref);
  const std::string full = cf_string_utf8(full_ref);
  const std::string version = cf_string_utf8(version_ref);
  std::vector<std::string> resolved_legacy_families =
      legacy_family_names(resolved_font);
  if (resolved_legacy_families.empty() && !family.empty())
    resolved_legacy_families.push_back(family);
  const std::vector<std::string> resolved_legacy_full_names =
      legacy_full_names(resolved_font);
  if (postscript_ref) CFRelease(postscript_ref);
  if (family_ref) CFRelease(family_ref);
  if (full_ref) CFRelease(full_ref);
  if (version_ref) CFRelease(version_ref);
  if (postscript.empty() || family.empty() || full.empty() || version.empty()) {
    if (resolved_font != base_font) CFRelease(resolved_font);
    CFRelease(base_font);
    throw std::runtime_error("font-metrics-missing-name");
  }
  const std::string provider_path =
      libass_coretext_discovered_path(selection_font, postscript);
  const CTFontFormat font_format = coretext_font_format(resolved_font);
  if (provider_path.empty() ||
      !libass_name_can_select_face(
          selection_font,
          postscript,
          resolved_legacy_families,
          resolved_legacy_full_names,
          font_format)) {
    if (resolved_font != base_font) CFRelease(resolved_font);
    CFRelease(base_font);
    throw std::runtime_error("font-metrics-provider-unverified");
  }

  CFArrayRef variation_axes = CTFontCopyVariationAxes(resolved_font);
  const bool variable_font =
      variation_axes && CFArrayGetCount(variation_axes) > 0;
  if (variation_axes) CFRelease(variation_axes);
  if (variable_font) {
    if (resolved_font != base_font) CFRelease(resolved_font);
    CFRelease(base_font);
    throw std::runtime_error("font-metrics-variable-font-unsupported");
  }

  CFDataRef head_table = CTFontCopyTable(
      resolved_font, kCTFontTableHead, kCTFontTableOptionNoOptions);
  CFDataRef os2_table = CTFontCopyTable(
      resolved_font, kCTFontTableOS2, kCTFontTableOptionNoOptions);
  if (!head_table || !os2_table) {
    if (head_table) CFRelease(head_table);
    if (os2_table) CFRelease(os2_table);
    if (resolved_font != base_font) CFRelease(resolved_font);
    CFRelease(base_font);
    throw std::runtime_error("font-metrics-missing-table");
  }
  const uint16_t units_per_em = read_be_u16(
      CFDataGetBytePtr(head_table), CFDataGetLength(head_table), 18);
  const uint16_t win_ascent = read_be_u16(
      CFDataGetBytePtr(os2_table), CFDataGetLength(os2_table), 74);
  const uint16_t win_descent = read_be_u16(
      CFDataGetBytePtr(os2_table), CFDataGetLength(os2_table), 76);
  CFRelease(head_table);
  CFRelease(os2_table);
  const uint32_t win_height =
      static_cast<uint32_t>(win_ascent) + static_cast<uint32_t>(win_descent);
  if (units_per_em == 0 || win_height == 0) {
    if (resolved_font != base_font) CFRelease(resolved_font);
    CFRelease(base_font);
    throw std::runtime_error("font-metrics-invalid-table");
  }
  const double metric_scale =
      static_cast<double>(units_per_em) / static_cast<double>(win_height);
  if (!std::isfinite(metric_scale) || metric_scale <= 0.1 || metric_scale > 2.0) {
    if (resolved_font != base_font) CFRelease(resolved_font);
    CFRelease(base_font);
    throw std::runtime_error("font-metrics-invalid-scale");
  }

  CFStringRef cue_ref = utf8_cf_string(cue);
  if (!cue_ref) {
    if (resolved_font != base_font) CFRelease(resolved_font);
    CFRelease(base_font);
    throw std::runtime_error("font-metrics-invalid-cue");
  }
  const std::vector<UniChar> characters = coverage_characters(cue_ref);
  CFRelease(cue_ref);
  std::vector<CGGlyph> glyphs(characters.size());
  const bool covered = characters.empty() ||
      CTFontGetGlyphsForCharacters(
          resolved_font,
          characters.data(),
          glyphs.data(),
          static_cast<CFIndex>(characters.size()));
  const size_t glyph_count = static_cast<size_t>(
      std::count_if(glyphs.begin(), glyphs.end(), [](CGGlyph glyph) {
        return glyph != 0;
      }));
  if (!covered || glyph_count != characters.size()) {
    if (resolved_font != base_font) CFRelease(resolved_font);
    CFRelease(base_font);
    throw std::runtime_error("font-metrics-cue-not-covered");
  }

  CFDictionaryRef traits_dictionary = CTFontCopyTraits(resolved_font);
  double weight_trait = 0.0;
  if (traits_dictionary) {
    CFNumberRef weight_ref = static_cast<CFNumberRef>(
        CFDictionaryGetValue(traits_dictionary, kCTFontWeightTrait));
    if (weight_ref)
      CFNumberGetValue(weight_ref, kCFNumberDoubleType, &weight_trait);
    CFRelease(traits_dictionary);
  }

  std::ostringstream output;
  output << std::setprecision(12);
  output << "{\"ok\":true"
      << ",\"metricResolverVersion\":" << FONT_METRIC_RESOLVER_VERSION
      << ",\"metricSource\":" << json_quote(FONT_METRIC_SOURCE)
      << ",\"resolvedPostScriptName\":" << json_quote(postscript)
      << ",\"resolvedFamilyName\":" << json_quote(family)
      << ",\"resolvedFullName\":" << json_quote(full)
      << ",\"fontVersion\":" << json_quote(version)
      << ",\"unitsPerEm\":" << units_per_em
      << ",\"usWinAscent\":" << win_ascent
      << ",\"usWinDescent\":" << win_descent
      << ",\"fontMetricScale\":" << metric_scale
      << ",\"libassProviderVerified\":true"
      << ",\"resolvedFontFormat\":" << static_cast<int>(font_format)
      << ",\"resolvedBold\":"
      << ((traits & kCTFontBoldTrait) ? "true" : "false")
      << ",\"resolvedItalic\":"
      << ((traits & kCTFontItalicTrait) ? "true" : "false")
      << ",\"syntheticBold\":"
      << ((requested_bold && !(traits & kCTFontBoldTrait)) ? "true" : "false")
      << ",\"syntheticItalic\":"
      << ((requested_italic && !(traits & kCTFontItalicTrait)) ? "true" : "false")
      << ",\"weightTrait\":" << weight_trait
      << ",\"cueCoverage\":{\"ok\":true,\"utf16Units\":"
      << characters.size() << ",\"glyphCount\":" << glyph_count << "}}\n";
  std::cout << output.str();
  if (resolved_font != base_font) CFRelease(resolved_font);
  CFRelease(base_font);
}

static void cmd_version() {
  std::cout << "{\"ok\":true,\"name\":\"iina-hoshi-dicts\",\"backend\":\"Manhhao/hoshidicts\",\"wrapperVersion\":" << json_quote(WRAPPER_VERSION) << ",\"worker\":true,\"serve\":false,\"fontMetrics\":true,\"fontMetricResolverVersion\":" << FONT_METRIC_RESOLVER_VERSION << ",\"assGeometry\":{\"protocol\":" << iinatan::ass::kAssGeometryProtocol << ",\"available\":"
#ifdef IINATAN_ASS_GEOMETRY
            << "true"
#else
            << "false"
#endif
            << ",\"patch\":" << json_quote(iinatan::ass::kAssGeometryPatch)
            << ",\"observedPlain\":true"
            << ",\"ffmpeg\":" << json_quote(iinatan::ass::ffmpeg_geometry_version())
            << ",\"libass\":" << json_quote(iinatan::ass::libass_geometry_version())
            << ",\"architecture\":\"arm64\"},\"modes\":[\"yomitan-japanese\",\"exact\",\"prefix\"]}\n";
}
static void cmd_ass_geometry(int argc, char** argv) {
  if (argc < 3) {
    print_error("usage: ass-geometry <request_json_path> [...]");
    std::exit(2);
  }
  iinatan::ass::GeometryService service;
  for (int index = 2; index < argc; ++index) {
    const std::string body = read_file(argv[index]);
    const iinatan::protocol::Json root = iinatan::protocol::Json::parse(body);
    if (!iinatan::protocol::is_geometry_request(root))
      throw std::runtime_error("request type must be ass-geometry");
    std::cout
        << service.handle(iinatan::protocol::parse_geometry_request(root)).dump()
        << "\n";
  }
}
int main(int argc, char** argv) {
  try {
    if (argc < 2) { print_error("expected command: import, lookup, worker, client, font-metrics, ass-geometry, version"); return 2; }
    std::string command = argv[1];
    if (command == "import") cmd_import(argc, argv);
    else if (command == "lookup") cmd_lookup(argc, argv);
    else if (command == "worker") cmd_worker(argc, argv);
    else if (command == "client") cmd_client(argc, argv);
    else if (command == "font-metrics") cmd_font_metrics(argc, argv);
    else if (command == "ass-geometry") cmd_ass_geometry(argc, argv);
    else if (command == "version") cmd_version();
    else { print_error("unknown command: " + command); return 2; }
    return 0;
  } catch (const std::exception& e) { print_error(e.what()); return 1; }
  catch (...) { print_error("unknown native exception"); return 1; }
}
