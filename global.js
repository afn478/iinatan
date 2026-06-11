/** Global setup menu for iinatan. */
const { menu, preferences, console, file, http, utils } = iina;
const VERSION = "1.2.4";
const RECOMMENDED_JITENDEX_URL = "https://github.com/stephenmk/stephenmk.github.io/releases/latest/download/jitendex-yomitan.zip";

function pref(key, fallback) {
  const value = preferences.get(key);
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}
function prefBool(key, fallback) {
  const value = pref(key, fallback);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true";
  return !!value;
}
function prefNumber(key, fallback) {
  const value = Number(pref(key, fallback));
  return Number.isFinite(value) ? value : fallback;
}
function compactError(error) {
  const msg = error && error.message ? String(error.message) : String(error || "Unknown error");
  return msg.replace(/\s+/g, " ").slice(0, 1200);
}
function alert(message) { try { console.log(String(message || "")); } catch (_) {} }
function pathJoin() {
  return Array.prototype.slice.call(arguments)
    .filter(part => part !== null && part !== undefined && String(part).length)
    .map((part, index) => {
      const s = String(part);
      if (index === 0) return s.replace(/\/+$/, "");
      return s.replace(/^\/+|\/+$/g, "");
    })
    .join("/");
}
let cachedDataRoot = null;
function dataRoot() {
  if (cachedDataRoot) return cachedDataRoot;
  const resolved = utils.resolvePath("@data/");
  if (!resolved || String(resolved).charAt(0) !== "/") throw new Error("Could not resolve @data/ to an absolute plugin data directory; got: " + String(resolved));
  cachedDataRoot = String(resolved).replace(/\/+$/, "");
  return cachedDataRoot;
}
function dataPath() { return pathJoin.apply(null, [dataRoot()].concat(Array.prototype.slice.call(arguments))); }
function binPath() { return pathJoin(dataRoot(), "bin", "iina-hoshi-dicts"); }
function dictRoot() { return pathJoin(dataRoot(), "dictionaries"); }
function downloadRoot() { return pathJoin(dataRoot(), "downloads"); }
function buildRoot() { return pathJoin(dataRoot(), "build"); }
function manifestPath() { return pathJoin(dataRoot(), "manifest.json"); }
function workerRoot() { return pathJoin(dataRoot(), "worker"); }
async function execChecked(command, args, cwd, stdoutHook, stderrHook) {
  const result = await utils.exec(command, args || [], cwd || undefined, stdoutHook, stderrHook);
  if (!result || result.status !== 0) throw new Error(command + " exited with " + (result ? result.status : "unknown") + ": " + ((result && result.stderr) || (result && result.stdout) || ""));
  return result;
}
async function ensureDataDirs() {
  await execChecked("/bin/mkdir", ["-p", dataRoot(), pathJoin(dataRoot(), "bin"), dictRoot(), downloadRoot(), buildRoot(), workerRoot(), pathJoin(workerRoot(), "queue"), pathJoin(workerRoot(), "responses"), pathJoin(workerRoot(), "state")]);
}
function backendInstalled() { try { return file.exists(binPath()); } catch (_) { return false; } }
async function writeBackendSources() {
  await ensureDataDirs();
  file.write(dataPath("build", "iina_hoshi.cpp"), HOSHI_WRAPPER_CPP);
  file.write(dataPath("build", "build_hoshi_backend.sh"), BUILD_SCRIPT);
  await execChecked("/bin/chmod", ["755", pathJoin(buildRoot(), "build_hoshi_backend.sh")]);
}
async function buildOrUpdateBackend() {
  let log = "";
  try {
    await writeBackendSources();
    alert("Building HoshiDicts backend. This can take a while; check the IINA log or build/last_build.log for progress.");
    const script = pathJoin(buildRoot(), "build_hoshi_backend.sh");
    const hook = data => { log += String(data || ""); };
    const result = await execChecked("/bin/bash", [script, dataRoot()], dataRoot(), hook, hook);
    log += "\n--- stdout ---\n" + String((result && result.stdout) || "");
    log += "\n--- stderr ---\n" + String((result && result.stderr) || "");
    try { file.write(dataPath("build", "last_build.log"), log); } catch (_) {}
    console.log(result.stdout || log);
    rebuildMenu();
    alert("HoshiDicts backend ready. Rebuild done for v1.2.4 worker mode.");
  } catch (error) {
    try { file.write(dataPath("build", "last_build.log"), log + "\n--- error ---\n" + compactError(error)); } catch (_) {}
    alert("Could not build HoshiDicts backend. Details: " + compactError(error) + "\n\nA full log was saved to build/last_build.log.");
  }
}
async function runBackendJson(args, timeoutMs) {
  if (!backendInstalled()) throw new Error("HoshiDicts backend is not installed. Use Build/Update HoshiDicts Backend first.");
  let timer = null;
  const timeout = Math.max(1000, timeoutMs || prefNumber("backendTimeoutMs", 30000));
  try {
    const result = await Promise.race([
      utils.exec(binPath(), args || [], dataRoot()),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("HoshiDicts backend timed out after " + timeout + " ms")), timeout); })
    ]);
    const raw = String((result && result.stdout) || "").trim();
    let parsed = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { throw new Error("Backend returned non-JSON: " + raw.slice(0, 500)); }
    if (!result || result.status !== 0 || (parsed && parsed.ok === false)) throw new Error((parsed && parsed.error) || (result && result.stderr) || "Backend failed");
    return parsed;
  } finally { if (timer !== null) clearTimeout(timer); }
}
function readManifest() {
  try {
    if (!file.exists(manifestPath())) return { dictionaries: {}, disabled: {} };
    const parsed = JSON.parse(file.read(manifestPath()));
    if (!parsed || typeof parsed !== "object") return { dictionaries: {}, disabled: {} };
    if (!parsed.dictionaries) parsed.dictionaries = {};
    if (!parsed.disabled) parsed.disabled = {};
    return parsed;
  } catch (_) { return { dictionaries: {}, disabled: {} }; }
}
function writeManifest(manifest) { try { file.write(manifestPath(), JSON.stringify(manifest || { dictionaries: {}, disabled: {} }, null, 2)); } catch (_) {} }
function updateManifestAfterImport(importResult, zipPath) {
  if (!importResult || !importResult.title) return;
  const manifest = readManifest();
  manifest.dictionaries[importResult.title] = {
    title: importResult.title,
    zipPath: zipPath || "",
    importedAt: new Date().toISOString(),
    termCount: importResult.term_count || 0,
    metaCount: importResult.meta_count || 0,
    tagCount: importResult.tag_count || 0,
    mediaCount: importResult.media_count || 0
  };
  writeManifest(manifest);
}
async function importDictionaryZip(zipPath) {
  if (!zipPath) return;
  await ensureDataDirs();
  const result = await runBackendJson(["import", zipPath, dictRoot(), prefBool("lowRamImport", true) ? "--low-ram" : "--normal-ram"], Math.max(30000, prefNumber("importTimeoutMs", 1800000)));
  if (!result || !result.ok) throw new Error((result && result.error) || "Import failed");
  updateManifestAfterImport(result, zipPath);
  rebuildMenu();
  alert("Imported " + result.title + " (" + (result.term_count || 0) + " terms).");
}
async function chooseAndImportDictionary() {
  try {
    const zipPath = utils.chooseFile("Choose a Yomitan dictionary .zip", { allowedFileTypes: ["zip"] });
    if (zipPath) await importDictionaryZip(zipPath);
  } catch (error) { alert("Dictionary import failed: " + compactError(error)); }
}
async function getRecommendedDictionaries() {
  try {
    await ensureDataDirs();
    const dest = pathJoin(downloadRoot(), "jitendex-yomitan.zip");
    alert("Downloading recommended Jitendex dictionary, then importing it.");
    await http.download(RECOMMENDED_JITENDEX_URL, dest);
    await importDictionaryZip(dest);
  } catch (error) { alert("Recommended dictionary install failed: " + compactError(error)); }
}
function dictionaryDirs() {
  try {
    if (!file.exists(dictRoot())) return [];
    return file.list(dictRoot(), { includeSubDir: false }).filter(item => item && item.isDir).map(item => ({ name: item.filename, path: item.path })).sort((a, b) => a.name.localeCompare(b.name));
  } catch (_) { return []; }
}
function showInstalledDictionaries() {
  const dicts = dictionaryDirs();
  const disabled = readManifest().disabled || {};
  if (!dicts.length) { alert("No dictionaries installed yet. Use Get Recommended Dictionaries or Import Yomitan Dictionary ZIP."); return; }
  alert("Installed HoshiDicts dictionaries:\n\n" + dicts.map(d => (disabled[d.name] ? "[disabled] " : "[enabled] ") + d.name).join("\n"));
}
function rebuildMenu() {
  try { menu.removeAllItems(); } catch (_) {}
  menu.addItem(menu.item("Build/Update HoshiDicts Backend", () => { buildOrUpdateBackend(); }));
  menu.addItem(menu.item("Get Recommended Dictionaries", () => { getRecommendedDictionaries(); }));
  menu.addItem(menu.item("Import Yomitan Dictionary ZIP…", () => { chooseAndImportDictionary(); }));
  menu.addItem(menu.item("Show Installed Dictionaries", () => { showInstalledDictionaries(); }));
  menu.addItem(menu.item("Reveal Plugin Data Folder", () => { utils.open(dataRoot()); }));
}

const BUILD_SCRIPT = String.raw`#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Xcode.app/Contents/Developer/usr/bin:$PATH"
DATA_ROOT="$1"
if ! printenv HOME >/dev/null 2>&1 || [ -z "$(printenv HOME)" ]; then
  HOME_FROM_DATA="$(printf "%s\n" "$DATA_ROOT" | sed 's#/Library/Application Support/.*##')"
  if [ -n "$HOME_FROM_DATA" ] && [ "$HOME_FROM_DATA" != "$DATA_ROOT" ]; then
    export HOME="$HOME_FROM_DATA"
  else
    export HOME="$DATA_ROOT/home"
    mkdir -p "$HOME"
  fi
fi
export GIT_TERMINAL_PROMPT=0
SRC_DIR="$DATA_ROOT/vendor/hoshidicts"
BIN_DIR="$DATA_ROOT/bin"
WRAPPER_SRC="$DATA_ROOT/build/iina_hoshi.cpp"
mkdir -p "$DATA_ROOT/vendor" "$BIN_DIR"
if ! command -v git >/dev/null 2>&1; then echo "git is required" >&2; exit 10; fi
if ! command -v cmake >/dev/null 2>&1; then echo "cmake is required. Install it with Homebrew or another package manager." >&2; exit 11; fi
GIT_URL_FIX_1="url.https://github.com/.insteadOf=git@github.com:"
GIT_URL_FIX_2="url.https://github.com/.insteadOf=ssh://git@github.com/"
if [ -d "$SRC_DIR" ] && [ ! -d "$SRC_DIR/.git" ]; then rm -rf "$SRC_DIR"; fi
if [ ! -d "$SRC_DIR/.git" ]; then git -c "$GIT_URL_FIX_1" -c "$GIT_URL_FIX_2" clone --depth 1 https://github.com/Manhhao/hoshidicts.git "$SRC_DIR"; fi
git -C "$SRC_DIR" remote set-url origin https://github.com/Manhhao/hoshidicts.git
git -c "$GIT_URL_FIX_1" -c "$GIT_URL_FIX_2" -C "$SRC_DIR" fetch --depth 1 origin main
git -C "$SRC_DIR" checkout main
git -C "$SRC_DIR" reset --hard origin/main
git -C "$SRC_DIR" config -f .gitmodules submodule.external/utf8proc.url https://github.com/JuliaStrings/utf8proc.git
git -C "$SRC_DIR" config submodule.external/utf8proc.url https://github.com/JuliaStrings/utf8proc.git
git -C "$SRC_DIR" submodule sync --recursive
git -C "$SRC_DIR" submodule deinit -f external/utf8proc >/dev/null 2>&1 || true
rm -rf "$SRC_DIR/.git/modules/external/utf8proc" "$SRC_DIR/external/utf8proc"
git -c "$GIT_URL_FIX_1" -c "$GIT_URL_FIX_2" -C "$SRC_DIR" submodule update --init --recursive --depth 1
cp "$WRAPPER_SRC" "$SRC_DIR/cli/iina_hoshi.cpp"
if ! grep -q "iina-hoshi-dicts" "$SRC_DIR/CMakeLists.txt"; then
  cat >> "$SRC_DIR/CMakeLists.txt" <<'CMAKEEOF'

add_executable(iina-hoshi-dicts cli/iina_hoshi.cpp)
target_link_libraries(iina-hoshi-dicts PRIVATE hoshidicts)
CMAKEEOF
fi
cmake -S "$SRC_DIR" -B "$SRC_DIR/build-iina" -DCMAKE_BUILD_TYPE=Release
cmake --build "$SRC_DIR/build-iina" --target iina-hoshi-dicts --config Release -j "$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"
cp "$SRC_DIR/build-iina/iina-hoshi-dicts" "$BIN_DIR/iina-hoshi-dicts"
chmod 755 "$BIN_DIR/iina-hoshi-dicts"
echo "installed $BIN_DIR/iina-hoshi-dicts"
`;

const HOSHI_WRAPPER_CPP = String.raw`#include <algorithm>
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

#include "hoshidicts/deinflector.hpp"
#include "hoshidicts/importer.hpp"
#include "hoshidicts/lookup.hpp"
#include "hoshidicts/query.hpp"

static constexpr const char* WRAPPER_VERSION = "1.2.4";
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
static std::string lookup_to_json(Lookup& lookup, const std::string& lookup_string, int max_results, int scan_length) {
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
    for (size_t g = 0; g < r.term.glossaries.size(); ++g) {
      const auto& gl = r.term.glossaries[g];
      if (g) out << ",";
      out << "{\"dict\":" << json_quote(gl.dict_name)
          << ",\"glossary\":" << json_quote(gl.glossary)
          << ",\"definitionTags\":" << json_quote(gl.definition_tags)
          << ",\"termTags\":" << json_quote(gl.term_tags) << "}";
    }
    out << "]}}";
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
static std::vector<std::string> parse_lookup_args(int argc, char** argv, std::string& lookup_string, int& max_results, int& scan_length) {
  std::vector<std::string> dict_paths;
  max_results = 8; scan_length = 24;
  for (int i = 2; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--max-results" && i + 1 < argc) max_results = std::max(1, to_int(argv[++i], max_results));
    else if (arg == "--scan-length" && i + 1 < argc) scan_length = std::max(1, to_int(argv[++i], scan_length));
    else if (arg == "--" && i + 1 < argc) { lookup_string = argv[++i]; break; }
    else dict_paths.push_back(arg);
  }
  return dict_paths;
}
static void cmd_lookup(int argc, char** argv) {
  std::string lookup_string; int max_results = 8; int scan_length = 24;
  auto dict_paths = parse_lookup_args(argc, argv, lookup_string, max_results, scan_length);
  if (dict_paths.empty()) { print_error("no dictionary paths supplied"); std::exit(2); }
  if (lookup_string.empty()) { print_error("no lookup string supplied"); std::exit(2); }
  DictionaryQuery dict_query;
  for (const auto& p : dict_paths) dict_query.add_term_dict(p);
  Deinflector deinflector;
  Lookup lookup(dict_query, deinflector);
  std::cout << lookup_to_json(lookup, lookup_string, max_results, scan_length);
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
  if (argc < 3) { print_error("usage: worker <worker_dir>"); std::exit(2); }
  fs::path root = argv[2];
  fs::path queue = root / "queue";
  fs::path responses = root / "responses";
  fs::path state = root / "state";
  fs::path stop = root / "stop";
  fs::path config_path = root / "config.tsv";
  fs::create_directories(queue); fs::create_directories(responses); fs::create_directories(state);
  WorkerConfig cfg = read_worker_config(config_path);
  if (cfg.dicts.empty()) throw std::runtime_error("worker config has no dictionaries");
  DictionaryQuery dict_query;
  for (const auto& p : cfg.dicts) dict_query.add_term_dict(p);
  Deinflector deinflector;
  Lookup lookup(dict_query, deinflector);
  write_file_atomic(state / "ready.json", std::string("{\"ok\":true,\"worker\":true,\"wrapperVersion\":") + json_quote(WRAPPER_VERSION) + ",\"fingerprint\":" + json_quote(cfg.fingerprint) + ",\"dictCount\":" + std::to_string(cfg.dicts.size()) + "}\n");
  std::cerr << "iina-hoshi-dicts worker ready with " << cfg.dicts.size() << " dictionaries\n";
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
        int max_results = std::max(1, json_get_int(body, "maxResults", 8));
        int scan_length = std::max(1, json_get_int(body, "scanLength", 24));
        if (text.empty()) throw std::runtime_error("lookup request did not include text");
        std::cerr << "lookup request " << request_id << " text_bytes=" << text.size() << " scan=" << scan_length << " max=" << max_results << "\n";
        std::string out = lookup_to_json(lookup, text, max_results, scan_length);
        write_file_atomic(resp, out);
        std::cerr << "lookup response " << request_id << " bytes=" << out.size() << "\n";
      } catch (const std::exception& e) {
        write_file_atomic(resp, error_json(e.what()));
      }
      fs::remove(req, ec);
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(45));
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
  if (argc < 4) { print_error("usage: client <worker_dir> [--max-results n] [--scan-length n] [--timeout-ms n] -- <lookup_string>"); std::exit(2); }
  fs::path root = argv[2];
  int max_results = 8;
  int scan_length = 24;
  int timeout_ms = 30000;
  std::string lookup_string;
  for (int i = 3; i < argc; ++i) {
    std::string arg = argv[i];
    if (arg == "--max-results" && i + 1 < argc) max_results = std::max(1, to_int(argv[++i], max_results));
    else if (arg == "--scan-length" && i + 1 < argc) scan_length = std::max(1, to_int(argv[++i], scan_length));
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
          << ",\"maxResults\":" << max_results << "}\n";
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
  std::cout << "{\"ok\":true,\"name\":\"iina-hoshi-dicts\",\"backend\":\"Manhhao/hoshidicts\",\"wrapperVersion\":" << json_quote(WRAPPER_VERSION) << ",\"worker\":true,\"serve\":false}\n";
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
`;


rebuildMenu();
