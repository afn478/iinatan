const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = [
  "src/main/15_profile_settings.js",
  "src/main/10_subtitle_text_style.js",
]
  .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
  .join("\n");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadContext({ prefs, defaults }) {
  const commands = [];
  const pushes = [];
  const timers = [];
  const context = {
    console,
    JSON,
    Object,
    String,
    Number,
    Math,
    Date,
    Promise,
    systemGlassTint: null,
    systemGlassTintRefreshInFlight: false,
    systemGlassTintLastRefreshAt: 0,
    systemGlassTintPollTimer: null,
    systemGlassTintPollCount: 0,
    systemReduceTransparency: false,
    scheduleRepeating(callback, delayMs) {
      const task = { callback, delayMs, cancelled: false };
      timers.push(task);
      return task;
    },
    cancelRepeating(task) {
      task.cancelled = true;
    },
    pref(name, fallback) {
      return Object.prototype.hasOwnProperty.call(prefs, name)
        ? prefs[name]
        : fallback;
    },
    prefBool(name, fallback) {
      return Object.prototype.hasOwnProperty.call(prefs, name)
        ? !!prefs[name]
        : fallback;
    },
    prefNumber(name, fallback) {
      return Object.prototype.hasOwnProperty.call(prefs, name)
        ? Number(prefs[name])
        : fallback;
    },
    dataRoot() {
      return "/tmp";
    },
    execExternalProcess(command, args) {
      const key = args.join(" ");
      commands.push(key);
      if (Object.prototype.hasOwnProperty.call(defaults, key)) {
        const value = defaults[key];
        return value instanceof Error
          ? Promise.reject(value)
          : Promise.resolve({ status: 0, stdout: value + "\n" });
      }
      return Promise.reject(new Error("does not exist"));
    },
    pushOverlayConfigForProfileChange(plan) {
      pushes.push(plan);
    },
    debugVerbose() {},
    compactError(error) {
      return String(error && error.message);
    },
  };
  vm.createContext(context);
  vm.runInContext(
    source +
      "\nglobalThis.__glass = { popupGlassTintConfig, readSystemGlassTint, getSystem: () => systemGlassTint };",
    context,
  );
  return { glass: context.__glass, commands, pushes, timers, defaults };
}

(async () => {
  {
    const { glass, commands } = loadContext({
      prefs: { popupGlassTint: 0.72 },
      defaults: { "read -g NSGlassTintAmount": "0.2" },
    });
    assert(
      glass.popupGlassTintConfig() === 0.72 && commands.length === 0,
      "Custom glass tint should apply without reading system settings",
    );
  }
  {
    const { glass } = loadContext({ prefs: {}, defaults: {} });
    assert(
      glass.popupGlassTintConfig() === 0.5,
      "Popup glass should default to the built-in material",
    );
  }
  {
    const prefs = { popupGlassFollowSystem: true, popupGlassTint: 0.9 };
    const { glass, pushes, timers, defaults } = loadContext({
      prefs,
      defaults: {
        "read com.apple.universalaccess reduceTransparency": "0",
        "read -g NSGlassTintAmount": "0.5256087",
      },
    });
    assert(
      glass.popupGlassTintConfig() === 0.5,
      "Following the system should use the middle until macOS has been read",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(
      glass.getSystem() === 0.526 && pushes.length === 1,
      "System glass tint should be read and pushed to the overlay",
    );
    assert(
      glass.popupGlassTintConfig() === 0.526 &&
        timers.length === 1 &&
        timers[0].delayMs === 1500,
      "Following the system should override the custom slider and keep polling",
    );
    defaults["read -g NSGlassTintAmount"] = "0";
    timers[0].callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(
      glass.getSystem() === 0 && pushes.length === 2,
      "Moving the macOS slider should reach the popup without a restart",
    );
    timers[0].callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert(
      pushes.length === 2,
      "Unchanged system glass should not re-push the overlay config",
    );
    prefs.popupGlassFollowSystem = false;
    assert(
      glass.popupGlassTintConfig() === 0.9 && timers[0].cancelled,
      "Turning off system follow should stop polling and restore the custom slider",
    );
  }
  {
    const { glass } = loadContext({
      prefs: {},
      defaults: {
        "read com.apple.universalaccess reduceTransparency": "1",
        "read -g NSGlassTintAmount": "0.1",
      },
    });
    assert(
      (await glass.readSystemGlassTint(true)) === 1,
      "Reduce Transparency should make followed glass fully tinted",
    );
  }
  {
    const { glass } = loadContext({ prefs: {}, defaults: {} });
    assert(
      (await glass.readSystemGlassTint(true)) === 0.5,
      "An unset macOS glass slider should resolve to its middle position",
    );
  }
  console.log("popup glass tint tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
