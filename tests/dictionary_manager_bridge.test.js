const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const handlers = Object.create(null);
const posts = [];
const updates = [];
const confirmations = [];
const profileDeletes = [];
const accentCommands = [];

const context = {
  VERSION: "1.6.0",
  dictionaryManagerHandlerGeneration: 0,
  dictionaryManagerActionInFlight: false,
  standaloneWindow: {
    onMessage(name, handler) {
      if (!handlers[name]) handlers[name] = [];
      handlers[name].push(handler);
    },
    postMessage(name, data) {
      posts.push({ name, data });
    },
  },
  utils: {
    prompt() {
      return "New Profile";
    },
    ask(title) {
      confirmations.push(title);
      return true;
    },
    exec(command, args, cwd) {
      accentCommands.push({ command, args, cwd });
      return Promise.resolve({ status: 0, stdout: "6\n" });
    },
  },
  compactError(error) {
    return error && error.message ? error.message : String(error);
  },
  debugVerbose() {},
  debugWarn() {},
  debugError() {},
  alert() {},
  postDictionaryManagerState() {},
  readManifest() {
    return {
      activeProfileId: "default",
      profiles: { default: { preferences: {} } },
    };
  },
  activeDictionaryProfile() {
    return { preferences: {} };
  },
  normalizeProfilePreferences(prefs) {
    return Object.assign(
      { ankiConnectUrl: "http://127.0.0.1:8765", ankiModelName: "" },
      prefs || {},
    );
  },
  updateDictionaryProfilePreferences(profileId, preferences) {
    updates.push({ profileId, preferences });
  },
  updateGlobalSettings() {},
  setDictionaryEnabled() {},
  setDictionaryOrder() {},
  getRecommendedDictionaries() {},
  runDictionaryManagerZipImport() {},
  setActiveDictionaryProfile() {},
  createDictionaryProfile() {
    return { id: "new-profile" };
  },
  renameDictionaryProfile() {},
  deleteDictionary() {},
  deleteDictionaryProfile(profileId) {
    profileDeletes.push(profileId);
  },
  dataRoot() {
    return "/tmp/iinatan-test";
  },
  Promise,
  console,
  setTimeout,
  clearTimeout,
  scheduleOneShot(callback, delay) {
    return setTimeout(callback, delay);
  },
};

vm.createContext(context);
vm.runInContext(
  fs.readFileSync(
    path.join(root, "src/main/65_dictionary_manager_window.js"),
    "utf8",
  ),
  context,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

context.registerDictionaryManagerHandlers();
context.registerDictionaryManagerHandlers();

const saveHandlers =
  handlers["dictionary-manager-update-profile-preferences"] || [];
assert(
  saveHandlers.length === 2,
  "Repeated settings registration should install a fresh handler generation",
);
saveHandlers.forEach((handler) =>
  handler({
    profileId: "default",
    preferences: { pauseWhilePopupVisible: true },
  }),
);

assert(
  updates.length === 1,
  "Only the newest settings handler generation should process a save command",
);
assert(
  updates[0].profileId === "default",
  "Settings save should pass through the active profile id",
);
assert(
  updates[0].preferences.pauseWhilePopupVisible === true,
  "Settings save should pass through checkbox state",
);
assert(
  posts.some(
    (post) =>
      post.name === "dictionary-manager-status" &&
      post.data.message === "Profile settings saved.",
  ),
  "Settings save should acknowledge persistence",
);

const profileNameHandlers =
  handlers["dictionary-manager-request-profile-name"] || [];
profileNameHandlers[profileNameHandlers.length - 1]({ mode: "create" });
assert(
  posts.some(
    (post) =>
      post.name === "dictionary-manager-profile-name-result" &&
      post.data.mode === "create" &&
      post.data.name === "New Profile" &&
      post.data.cancelled === false,
  ),
  "Native profile-name prompt should return its result to the webview",
);

const confirmationHandlers =
  handlers["dictionary-manager-request-confirmation"] || [];
confirmationHandlers[confirmationHandlers.length - 1]({
  mode: "delete-profile",
  profileId: "profile-2",
  label: 'Delete profile "Profile 2"?',
});
assert(
  confirmations[0] === 'Delete profile "Profile 2"?',
  "Profile deletion should use the native confirmation title",
);
assert(
  profileDeletes[0] === "profile-2",
  "Confirmed profile deletion should reach the profile manager",
);

(async () => {
  const accent = await context.dictionaryManagerSystemAccentColor();
  assert(
    accent === "#ff2d55",
    "macOS pink accent should map to the custom switch accent color",
  );
  assert(
    accentCommands[0].command === "/usr/bin/defaults" &&
      accentCommands[0].args.join(" ") === "read -g AppleAccentColor",
    "System accent lookup should read AppleAccentColor through defaults",
  );
  console.log("dictionary manager bridge tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
