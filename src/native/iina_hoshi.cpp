#include <algorithm>
#include <chrono>
#include <cctype>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <functional>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include <utf8.h>

#include "hoshidicts/deinflector.hpp"
#include "hoshidicts/importer.hpp"
#include "hoshidicts/lookup.hpp"
#include "hoshidicts/query.hpp"

static constexpr const char* WRAPPER_VERSION = "1.6.0";
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
static std::string read_file(const fs::path& p) {
  std::ifstream in(p, std::ios::binary);
  std::ostringstream ss; ss << in.rdbuf(); return ss.str();
}
static void write_file_atomic(const fs::path& p, const std::string& data) {
  fs::create_directories(p.parent_path());
  fs::path tmp = p;
  tmp += ".tmp";
  { std::ofstream out(tmp, std::ios::binary | std::ios::trunc); out << data; }
  std::error_code ec;
  fs::rename(tmp, p, ec);
  if (ec) { fs::remove(p, ec); fs::rename(tmp, p, ec); }
  if (ec) throw std::runtime_error("could not write " + p.string() + ": " + ec.message());
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
  if (argc < 3) { print_error("usage: worker <worker_dir> [--sleep-ms n]"); std::exit(2); }
  fs::path root = argv[2];
  int sleep_ms = 2;
  for (int i = 3; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--sleep-ms" && i + 1 < argc) sleep_ms = std::max(1, to_int(argv[++i], sleep_ms));
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
  write_file_atomic(state / "ready.json", std::string("{\"ok\":true,\"worker\":true,\"wrapperVersion\":") + json_quote(WRAPPER_VERSION) + ",\"fingerprint\":" + json_quote(cfg.fingerprint) + ",\"dictCount\":" + std::to_string(cfg.dicts.size()) + "}\n");
  std::cerr << "iina-hoshi-dicts worker ready with " << cfg.dicts.size() << " dictionaries; sleep_ms=" << sleep_ms << "\n";
  while (!fs::exists(stop)) {
    std::vector<fs::path> requests;
    std::error_code ec;
    for (const auto& entry : fs::directory_iterator(queue, ec)) {
      if (!entry.is_regular_file()) continue;
      if (entry.path().extension() == ".json") requests.push_back(entry.path());
    }
    std::sort(requests.begin(), requests.end());
    for (const auto& req : requests) {
      std::string request_id = req.stem().string();
      fs::path resp = responses / (request_id + ".json");
      try {
        std::string body = read_file(req);
        std::string provided_id = json_get_string(body, "requestId");
        if (!provided_id.empty()) request_id = provided_id;
        resp = responses / (request_id + ".json");
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
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(sleep_ms));
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

static void cmd_version() {
  std::cout << "{\"ok\":true,\"name\":\"iina-hoshi-dicts\",\"backend\":\"Manhhao/hoshidicts\",\"wrapperVersion\":" << json_quote(WRAPPER_VERSION) << ",\"worker\":true,\"serve\":false,\"modes\":[\"yomitan-japanese\",\"exact\",\"prefix\"]}\n";
}
int main(int argc, char** argv) {
  try {
    if (argc < 2) { print_error("expected command: import, lookup, worker, client, version"); return 2; }
    std::string command = argv[1];
    if (command == "import") cmd_import(argc, argv);
    else if (command == "lookup") cmd_lookup(argc, argv);
    else if (command == "worker") cmd_worker(argc, argv);
    else if (command == "client") cmd_client(argc, argv);
    else if (command == "version") cmd_version();
    else { print_error("unknown command: " + command); return 2; }
    return 0;
  } catch (const std::exception& e) { print_error(e.what()); return 1; }
  catch (...) { print_error("unknown native exception"); return 1; }
}
