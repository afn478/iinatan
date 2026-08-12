let ankiConnectVersionCache = {
  key: "",
  version: null,
  expiresAt: 0,
  promise: null,
};

const ANKI_CONNECT_VERSION = 6;
const ANKI_CONNECT_RECONNECT_ATTEMPTS = 3;
const ANKI_CONNECT_VERSION_CACHE_MS = 30000;

function safeAnkiConnectUrl(rawUrl) {
  const value = normalizeAnkiConnectUrl(rawUrl);
  try {
    if (typeof safeExternalHttpUrl === "function")
      return safeExternalHttpUrl(value);
  } catch (_) {}
  return /^https?:\/\/[^\s<>"']+$/i.test(value) ? value : "";
}
function ankiRequestPath() {
  return dataPath(
    "anki-connect-request-" +
      String(Date.now()) +
      "-" +
      String(Math.random()).slice(2) +
      ".json",
  );
}
function ankiConnectTransportError(message) {
  const error = new Error(message);
  error.ankiConnectRetryable = true;
  return error;
}
function ankiConnectAttemptCount(options) {
  const opts = options || {};
  if (opts.retry === false) return 1;
  const attempts = Math.round(
    Number(opts.attempts || opts.retryAttempts) ||
      ANKI_CONNECT_RECONNECT_ATTEMPTS,
  );
  return Math.max(1, Math.min(5, attempts));
}
function ankiConnectResponseTimeoutSeconds(options, prefs) {
  const opts = options || {};
  const configured = normalizeAnkiConnectTimeoutSeconds(
    opts.responseTimeoutSeconds !== undefined
      ? opts.responseTimeoutSeconds
      : prefs && prefs.ankiConnectTimeoutSeconds,
  );
  const rawCeiling =
    opts.timeoutSeconds !== undefined && opts.timeoutSeconds !== null
      ? Number(opts.timeoutSeconds)
      : configured;
  const ceiling =
    Number.isFinite(rawCeiling) && rawCeiling > 0 ? rawCeiling : configured;
  return Math.max(1, Math.min(60, Math.min(configured, ceiling)));
}
function ankiConnectElapsedSecondsText(startedAt) {
  const elapsedMs = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  const seconds = elapsedMs / 1000;
  return seconds < 10
    ? String(Math.round(seconds * 10) / 10)
    : String(Math.round(seconds));
}
function ankiConnectJsonEnvelope(value) {
  return !!(
    value &&
    typeof value === "object" &&
    (Object.prototype.hasOwnProperty.call(value, "result") ||
      Object.prototype.hasOwnProperty.call(value, "error"))
  );
}
function ankiConnectParseResponse(response, statusCode) {
  if (statusCode && (statusCode < 200 || statusCode >= 300))
    throw ankiConnectTransportError(
      "AnkiConnect HTTP request failed with status " + String(statusCode),
    );
  let parsed = null;
  if (ankiConnectJsonEnvelope(response)) {
    parsed = response;
  } else {
    try {
      parsed = JSON.parse(String(response || ""));
    } catch (error) {
      throw ankiConnectTransportError(
        "AnkiConnect returned invalid JSON: " + compactError(error),
      );
    }
  }
  if (parsed && parsed.error) throw new Error(String(parsed.error));
  return parsed ? parsed.result : null;
}
async function ankiConnectWithTimeout(promise, action, timeout) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = scheduleOneShot(
          () =>
            reject(
              ankiConnectTransportError(
                "AnkiConnect " +
                  String(action || "request") +
                  " timed out after " +
                  String(timeout) +
                  " seconds",
              ),
            ),
          Math.max(1000, Math.round(Number(timeout) * 1000)),
        );
      }),
    ]);
  } finally {
    if (timer) cancelOneShot(timer);
  }
}
async function ankiConnectInvokeCurlOnce(payload, url, timeout) {
  const requestPath = ankiRequestPath();
  file.write(requestPath, JSON.stringify(payload));
  let result = null;
  try {
    result = await ankiConnectWithTimeout(
      utils.exec(
        "/usr/bin/curl",
        [
          "--silent",
          "--show-error",
          "--location",
          "--connect-timeout",
          String(timeout),
          "--max-time",
          String(timeout),
          "--header",
          "Content-Type: application/json",
          "--data-binary",
          "@" + requestPath,
          url,
        ],
        dataRoot(),
      ),
      payload && payload.action,
      timeout,
    );
  } finally {
    try {
      if (typeof file.delete === "function" && file.exists(requestPath))
        file.delete(requestPath);
    } catch (_) {}
  }
  if (!result || result.status !== 0) {
    throw ankiConnectTransportError(
      "AnkiConnect request failed: " +
        String(
          (result && (result.stderr || result.stdout)) || "curl failed",
        ).slice(0, 500),
    );
  }
  return ankiConnectParseResponse(result.stdout, 200);
}
async function ankiConnectInvokeOnce(payload, url, timeout) {
  return ankiConnectInvokeCurlOnce(payload, url, timeout);
}
async function ankiConnectInvoke(action, params, options) {
  const opts = options || {};
  const prefs = ankiActiveProfilePreferences();
  const url = safeAnkiConnectUrl(opts.url || prefs.ankiConnectUrl);
  if (!url) throw new Error("Invalid AnkiConnect URL.");
  const payload = {
    action: String(action || ""),
    version: ANKI_CONNECT_VERSION,
    params: params || {},
  };
  const timeout = ankiConnectResponseTimeoutSeconds(opts, prefs);
  const attempts = ankiConnectAttemptCount(opts);
  const startedAt = Date.now();
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await ankiConnectInvokeOnce(payload, url, timeout);
    } catch (error) {
      lastError = error;
      if (!error || !error.ankiConnectRetryable || attempt >= attempts) break;
      if (typeof debugVerbose === "function")
        debugVerbose(
          "Retrying AnkiConnect " +
            String(payload.action || "request") +
            " after failed attempt " +
            String(attempt) +
            "/" +
            String(attempts) +
            ": " +
            compactError(error),
        );
    }
  }
  if (lastError && lastError.ankiConnectRetryable && attempts > 1) {
    throw new Error(
      "AnkiConnect did not respond after " +
        String(attempts) +
        " attempts in " +
        ankiConnectElapsedSecondsText(startedAt) +
        " seconds (timeout " +
        String(timeout) +
        " seconds per attempt).",
    );
  }
  throw lastError || new Error("AnkiConnect request failed.");
}
function ankiConnectVersionCacheKey(prefs) {
  return safeAnkiConnectUrl(prefs && prefs.ankiConnectUrl);
}
async function ankiCachedConnectVersion(prefs) {
  const key = ankiConnectVersionCacheKey(prefs);
  if (!key) throw new Error("Invalid AnkiConnect URL.");
  const now = Date.now();
  if (
    ankiConnectVersionCache.key === key &&
    ankiConnectVersionCache.version !== null &&
    ankiConnectVersionCache.expiresAt > now
  )
    return ankiConnectVersionCache.version;
  if (ankiConnectVersionCache.key === key && ankiConnectVersionCache.promise)
    return ankiConnectVersionCache.promise;
  const promise = ankiConnectInvoke("version", {}, { url: key }).then(
    (version) => {
      ankiConnectVersionCache = {
        key,
        version,
        expiresAt: Date.now() + ANKI_CONNECT_VERSION_CACHE_MS,
        promise: null,
      };
      return version;
    },
  );
  ankiConnectVersionCache = {
    key,
    version: null,
    expiresAt: 0,
    promise,
  };
  try {
    return await promise;
  } catch (error) {
    if (
      ankiConnectVersionCache.key === key &&
      ankiConnectVersionCache.promise === promise
    )
      ankiConnectVersionCache = {
        key: "",
        version: null,
        expiresAt: 0,
        promise: null,
      };
    throw error;
  }
}
async function ankiRequireConnectable(prefs) {
  const version = await ankiCachedConnectVersion(prefs);
  if (version === undefined || version === null)
    throw new Error("AnkiConnect did not return a version.");
}
