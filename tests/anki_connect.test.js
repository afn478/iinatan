const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const files = [
  "src/main/15_profile_settings.js",
  "src/main/51_anki_connect.js",
];
const filesByPath = Object.create(null);
let fastTimers = false;
let activePrefs = {};

const context = {
  console,
  Date,
  Math,
  setTimeout(callback, delay) {
    if (fastTimers && Number(delay) < 50000) return setTimeout(callback, 0);
    if (Number(delay) >= 50000) return { ignored: true };
    return setTimeout(callback, delay);
  },
  clearTimeout(timer) {
    if (timer && timer.ignored) return;
    clearTimeout(timer);
  },
  scheduleOneShot(callback, delay) {
    return context.setTimeout(callback, delay);
  },
  cancelOneShot(timer) {
    context.clearTimeout(timer);
  },
  compactError(error) {
    return error && error.message ? error.message : String(error);
  },
  ankiActiveProfilePreferences() {
    return context.normalizeProfilePreferences(activePrefs);
  },
  dataRoot() {
    return "/data";
  },
  dataPath(...parts) {
    return ["/data"].concat(parts).join("/");
  },
  debugVerbose() {},
  http: {
    async post() {
      return { statusCode: 200, data: { result: null, error: null } };
    },
  },
  normalizePopupThemePreference(value) {
    return value;
  },
  file: {
    write(path, value) {
      filesByPath[String(path || "")] = String(value || "");
    },
    exists() {
      return false;
    },
  },
  utils: {
    async exec() {
      return { status: 0, stdout: "{}", stderr: "" };
    },
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function setActiveAnkiPrefs(prefs) {
  activePrefs = Object.assign({}, prefs || {});
}

vm.createContext(context);
vm.runInContext(
  files
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n"),
  context,
);

async function testAnkiConnectRetriesAndTimeouts() {
  const previousPost = context.http.post;
  const hungCalls = [];
  fastTimers = true;
  setActiveAnkiPrefs({
    ankiConnectUrl: "http://127.0.0.1:8765",
    ankiConnectTimeoutSeconds: 1,
  });
  context.http.post = async (url, options) => {
    hungCalls.push({ url, options });
    return new Promise(() => {});
  };
  try {
    await context.ankiConnectInvoke("version", {}, {});
    assert(false, "Hung AnkiConnect should fail after retries");
  } catch (error) {
    assert(
      /after 3 attempts in [0-9.]+ seconds \(timeout 1 seconds per attempt\)/.test(
        String(error && error.message),
      ),
      "Hung AnkiConnect should report the retry count and timeout",
    );
  }
  assert(
    hungCalls.length === 3,
    "Hung AnkiConnect should be retried with three fresh HTTP requests",
  );
  fastTimers = false;

  const httpCalls = [];
  setActiveAnkiPrefs({
    ankiConnectUrl: "http://127.0.0.1:8765",
    ankiConnectTimeoutSeconds: 3,
  });
  context.http.post = async (url, options) => {
    httpCalls.push({ url, options });
    throw { reason: "Failed to connect" };
  };
  try {
    await context.ankiConnectInvoke(
      "version",
      {},
      { url: "http://127.0.0.1:8765", timeoutSeconds: 20 },
    );
    assert(false, "Missing AnkiConnect should fail after retries");
  } catch (error) {
    assert(
      /after 3 attempts in [0-9.]+ seconds \(timeout 3 seconds per attempt\)/.test(
        String(error && error.message),
      ),
      "Missing AnkiConnect should report the retry count and timeout",
    );
  }
  assert(
    httpCalls.length === 3,
    "Missing AnkiConnect should be retried with three fresh HTTP requests",
  );
  assert(
    httpCalls.every(
      (call) =>
        call.url === "http://127.0.0.1:8765" &&
        call.options.headers["Content-Type"] === "application/json" &&
        call.options.data.action === "version",
    ),
    "AnkiConnect requests should use IINA's JSON HTTP transport",
  );

  context.http.post = previousPost;
}

async function testAnkiConnectActionErrorsAreNotRetried() {
  const previousPost = context.http.post;
  const actionErrorCalls = [];
  setActiveAnkiPrefs({
    ankiConnectUrl: "http://127.0.0.1:8765",
    ankiConnectTimeoutSeconds: 3,
  });
  context.http.post = async (url, options) => {
    actionErrorCalls.push({ url, options });
    return {
      statusCode: 200,
      data: { error: "bad action", result: null },
    };
  };
  try {
    await context.ankiConnectInvoke("badAction", {}, {});
    assert(false, "AnkiConnect action errors should be surfaced");
  } catch (error) {
    assert(
      /bad action/.test(String(error && error.message)),
      "AnkiConnect action errors should keep the original message",
    );
  }
  assert(
    actionErrorCalls.length === 1,
    "AnkiConnect action errors should not be retried as connection failures",
  );
  context.http.post = previousPost;
}

function testAnkiConnectParserBehavior() {
  assert(
    context.ankiConnectParseResponse('{"result":["Default"],"error":null}', 200)
      .length === 1,
    "AnkiConnect parser should return successful result payloads",
  );
  assert(
    context.ankiConnectParseResponse({ result: 6, error: null }, 200) === 6,
    "AnkiConnect parser should accept already-parsed envelopes",
  );
  try {
    context.ankiConnectParseResponse("{", 200);
    assert(false, "Invalid JSON should be treated as a transport failure");
  } catch (error) {
    assert(
      error.ankiConnectRetryable &&
        /invalid JSON/.test(String(error && error.message)),
      "Invalid JSON should be retryable and include parser context",
    );
  }
  try {
    context.ankiConnectParseResponse('{"result":null,"error":null}', 503);
    assert(false, "HTTP failures should be treated as transport failures");
  } catch (error) {
    assert(
      error.ankiConnectRetryable &&
        /status 503/.test(String(error && error.message)),
      "HTTP failures should be retryable and include the status code",
    );
  }
}

testAnkiConnectRetriesAndTimeouts()
  .then(testAnkiConnectActionErrorsAreNotRetried)
  .then(testAnkiConnectParserBehavior)
  .then(() => {
    console.log("anki connect tests passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
