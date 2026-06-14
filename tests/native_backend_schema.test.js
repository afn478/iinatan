const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const nativeSource = fs.readFileSync(
  path.join(root, "src/native/iina_hoshi.cpp"),
  "utf8",
);
assert(
  /append_term_metadata_json/.test(nativeSource),
  "Native bridge should serialize term metadata",
);
assert(
  /\\?"frequencies\\?"/.test(nativeSource),
  "Native bridge should emit frequency metadata",
);
assert(
  /\\?"pitches\\?"/.test(nativeSource),
  "Native bridge should emit pitch metadata",
);
assert(
  /add_freq_dict/.test(nativeSource),
  "Native bridge should load frequency dictionaries",
);
assert(
  /add_pitch_dict/.test(nativeSource),
  "Native bridge should load pitch dictionaries",
);
assert(
  /prefix_lookup_to_json/.test(nativeSource),
  "Native bridge should expose prefix lookup",
);
assert(
  /"prefix"/.test(nativeSource),
  "Native version/mode handling should include prefix mode",
);

const buildScript = fs.readFileSync(
  path.join(root, "scripts/build_plugin.py"),
  "utf8",
);
assert(
  /validate_hoshidicts_submodule/.test(buildScript),
  "Package validation should check the HoshiDicts submodule",
);
assert(
  /vendor\/hoshidicts\/include\/hoshidicts\/query\.hpp/.test(buildScript),
  "Submodule validation should check HoshiDicts headers",
);
assert(
  /git submodule update --init --recursive/.test(buildScript),
  "Submodule validation should give the initialization command",
);

const gitmodules = fs.readFileSync(path.join(root, ".gitmodules"), "utf8");
assert(
  /path = vendor\/hoshidicts/.test(gitmodules),
  ".gitmodules should define vendor/hoshidicts",
);
assert(
  /github\.com\/afn478\/hoshidicts\.git/.test(gitmodules),
  ".gitmodules should point at afn478/hoshidicts",
);

console.log("native backend schema and submodule validation tests passed");
